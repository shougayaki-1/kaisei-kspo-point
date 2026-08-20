import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { ConfigRepository } from '../db/config-repository'
import { TransferRepository } from '../db/transfer-repository'
import { createHostScoringService } from '../app/host-scoring-service'
import { createHostBackup, serializeHostBackup } from './backup-service'
import { sealHostBackup } from './backup-schema'
import { prepareHostRestore, restoreHostBackupFromJson, restorePreparedHostBackup } from './restore-service'
import { backupTestIds, backupTestResult, backupTestRevision, seedBackupConfig } from './test-helpers'

const opened: AppDatabase[] = []
const names = new Set<string>()
function db(prefix: string) {
  const name = `${prefix}-${crypto.randomUUID()}`
  names.add(name)
  const value = createDatabase(name)
  opened.push(value)
  return { name, value }
}
afterEach(async () => {
  for (const value of opened.splice(0)) value.close()
  for (const name of names) { const value = createDatabase(name); await value.delete() }
  names.clear()
})

async function sourceBackup() {
  const { value } = db('restore-source')
  await seedBackupConfig(value)
  const repository = new ResultRepository(value)
  const result = backupTestResult('base')
  const base = backupTestRevision('base', 1, [], '2', '1')
  const left = backupTestRevision('left', 2, ['base'], '7', '1')
  const right = backupTestRevision('right', 2, ['base'], '1', '7')
  await repository.saveResultWithRevision(result, base)
  await repository.saveResultWithRevision(result, left)
  await repository.saveResultWithRevision(result, right)
  await createHostScoringService(value).resolveConflict({
    resultId: result.resultId,
    operator: 'Host resolver',
    createdAt: '2026-08-20T01:20:00.000Z',
    choice: { kind: 'SELECT_REVISION', selectedRevisionId: left.revisionId },
  })
  await new TransferRepository(value).markImportedBatch('imported-before-backup' as never, backupTestIds.tournament, '2026-08-20T01:30:00.000Z')
  await value.operators.put({ operatorId: 'source-operator', name: 'Source Host' })
  await value.localSettings.put({ key: 'backup.reminderMinutes', value: 10 })
  const expectedState = await createHostScoringService(value).loadAuthoritativeState()
  const backup = await createHostBackup(value, { createdAt: '2026-08-20T02:00:00.000Z' })
  return { backup, expectedState }
}

describe('transactional Host restore', () => {
  it('does not touch IndexedDB for malformed JSON or a fully checksummed but referentially invalid backup', async () => {
    const { value: destination } = db('restore-guard')
    await destination.operators.put({ operatorId: 'keep-me', name: 'Existing Host' })
    await expect(restoreHostBackupFromJson(destination, '{broken')).rejects.toThrow(/json|parse|backup/i)
    expect(await destination.operators.toArray()).toEqual([{ operatorId: 'keep-me', name: 'Existing Host' }])

    const { backup: valid } = await sourceBackup()
    const invalidPayload = structuredClone(valid.payload)
    invalidPayload.tables.configVersions = []
    const { checksum: _checksum, ...manifestInput } = valid.manifest
    const resealed = await sealHostBackup(manifestInput, invalidPayload)
    await expect(restoreHostBackupFromJson(destination, serializeHostBackup(resealed))).rejects.toThrow(/ConfigVersion|active|referential|integrity/i)
    expect(await destination.operators.toArray()).toEqual([{ operatorId: 'keep-me', name: 'Existing Host' }])
  })

  it('restores the complete authoritative state exactly and persists it across DB reopen', async () => {
    const { backup, expectedState } = await sourceBackup()
    const destinationName = `restore-target-${crypto.randomUUID()}`
    names.add(destinationName)
    const first = createDatabase(destinationName)
    opened.push(first)
    await restoreHostBackupFromJson(first, serializeHostBackup(backup))

    const config = new ConfigRepository(first)
    const active = await config.getActiveVersion(backupTestIds.tournament)
    expect(active?.configVersionId).toBe(backup.manifest.activeConfigVersionId)
    expect(active?.snapshot.scoringTestCases[0]?.lastApprovedChange?.operator).toBe('Host')
    expect(await first.results.count()).toBe(1)
    expect(await first.resultRevisions.count()).toBe(4)
    expect(await first.conflictResolutions.count()).toBe(1)
    expect(await new TransferRepository(first).listImportedBatchIds(backupTestIds.tournament)).toContain('imported-before-backup')
    const beforeReload = await createHostScoringService(first).loadAuthoritativeState()
    expect(beforeReload).toEqual(expectedState)

    first.close()
    const reopened = createDatabase(destinationName)
    opened.push(reopened)
    const afterReload = await createHostScoringService(reopened).loadAuthoritativeState()
    expect(afterReload).toEqual(beforeReload)
  })

  it('rolls back the entire replace transaction if any store write fails', async () => {
    const { backup } = await sourceBackup()
    const { value: destination } = db('restore-rollback')
    await destination.operators.put({ operatorId: 'keep-me', name: 'Existing Host' })
    await destination.localSettings.put({ key: 'existing', value: 42 })
    const prepared = await prepareHostRestore(serializeHostBackup(backup))

    const table = destination.resultRevisions as unknown as { bulkAdd: (rows: unknown[]) => Promise<unknown> }
    const original = table.bulkAdd.bind(table)
    table.bulkAdd = async () => { throw new Error('injected restore failure') }
    await expect(restorePreparedHostBackup(destination, prepared)).rejects.toThrow('injected restore failure')
    table.bulkAdd = original

    expect(await destination.operators.toArray()).toEqual([{ operatorId: 'keep-me', name: 'Existing Host' }])
    expect(await destination.localSettings.toArray()).toEqual([{ key: 'existing', value: 42 }])
    expect(await destination.tournaments.count()).toBe(0)
  })

  it('is deterministic when the same prepared backup is restored repeatedly', async () => {
    const { backup } = await sourceBackup()
    const { value: destination } = db('restore-repeat')
    const prepared = await prepareHostRestore(serializeHostBackup(backup))
    await restorePreparedHostBackup(destination, prepared)
    const first = await createHostScoringService(destination).loadAuthoritativeState()
    await restorePreparedHostBackup(destination, prepared)
    const second = await createHostScoringService(destination).loadAuthoritativeState()
    expect(second).toEqual(first)
  })
})
