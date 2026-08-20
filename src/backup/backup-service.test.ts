import { afterEach, describe, expect, it } from 'vitest'
import { APP_VERSION } from '../pwa/app-version'
import { DATABASE_SCHEMA_VERSION } from '../db/schema'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import { createHostScoringService } from '../app/host-scoring-service'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { createAckBatch } from '../transfer/ack'
import type { BatchId, DeviceId, RevisionId } from '../domain/ids'
import { createHostBackup } from './backup-service'
import { backupTestIds, backupTestResult, backupTestRevision, seedBackupConfig } from './test-helpers'

const opened: AppDatabase[] = []
const names = new Set<string>()
function db() {
  const name = `backup-export-${crypto.randomUUID()}`
  names.add(name)
  const value = createDatabase(name)
  opened.push(value)
  return value
}
afterEach(async () => {
  localStorage.clear()
  for (const value of opened.splice(0)) value.close()
  for (const name of names) { const value = createDatabase(name); await value.delete() }
  names.clear()
})

describe('Host backup export', () => {
  it('exports every persistent state required to reproduce authoritative Host state', async () => {
    const database = db()
    const active = await seedBackupConfig(database)
    const results = new ResultRepository(database)
    const stored = backupTestResult('base')
    const base = backupTestRevision('base', 1, [], '2', '1')
    const left = backupTestRevision('left', 2, ['base'], '7', '1')
    const right = backupTestRevision('right', 2, ['base'], '1', '7')
    await results.saveResultWithRevision(stored, base)
    await results.saveResultWithRevision(stored, left)
    await results.saveResultWithRevision(stored, right)
    await createHostScoringService(database).resolveConflict({
      resultId: stored.resultId,
      operator: 'Host resolver',
      createdAt: '2026-08-20T01:20:00.000Z',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: left.revisionId },
    })

    const transfer = new TransferRepository(database)
    const batch = createTransferBatch({
      tournamentId: backupTestIds.tournament,
      sourceDeviceId: 'court-a' as DeviceId,
      results: [backupTestResult(left.revisionId)],
      revisions: [left],
      createdAt: '2026-08-20T01:30:00.000Z',
      batchId: 'batch-export-1' as BatchId,
    })
    const parts = await encodeBatchFragments(batch, 80)
    await transfer.saveOutgoingBatch(batch, parts)
    await transfer.saveReceivedPart(parts[0]!, '2026-08-20T01:31:00.000Z')
    await transfer.applyAcknowledgement(createAckBatch(batch, 'host-a' as DeviceId, '2026-08-20T01:32:00.000Z', [
      { revisionId: left.revisionId as RevisionId, status: 'ACCEPTED' },
    ]))
    await transfer.markImportedBatch(batch.batchId, backupTestIds.tournament, '2026-08-20T01:32:00.000Z')

    await database.operators.put({ operatorId: 'operator-1', name: 'Host operator' })
    await database.auditEvents.put({ eventId: 'audit-1', type: 'TEST_AUDIT', timestamp: '2026-08-20T01:00:00.000Z' })
    await database.localSettings.put({ key: 'backup.reminderMinutes', value: 15 })
    await database.appMeta.put({ key: 'host.custom', value: { enabled: true } })
    localStorage.setItem('kaisei-kspo-point.device-id', 'device-secret-must-not-travel')

    const backup = await createHostBackup(database, { createdAt: '2026-08-20T02:00:00.000Z' })

    expect(backup.manifest.appVersion).toBe(APP_VERSION)
    expect(backup.manifest.databaseSchemaVersion).toBe(DATABASE_SCHEMA_VERSION)
    expect(backup.manifest.activeConfigVersionId).toBe(active?.configVersionId)
    expect(backup.manifest.tournamentId).toBe(backupTestIds.tournament)
    expect(backup.payload.tables.configVersions).toHaveLength(1)
    expect(backup.payload.tables.configVersions[0]?.snapshot.scoringTestCases[0]?.lastApprovedChange).toEqual({
      operator: 'Host', approvedAt: '2026-08-20T01:00:00.000Z',
    })
    expect(backup.payload.tables.results).toHaveLength(1)
    expect(backup.payload.tables.resultRevisions.length).toBe(4)
    expect(backup.payload.tables.conflictResolutions).toHaveLength(1)
    expect(backup.payload.tables.transferBatches).toHaveLength(1)
    expect(backup.payload.tables.receivedQrParts).toHaveLength(1)
    expect(backup.payload.tables.acknowledgements).toHaveLength(1)
    expect(backup.payload.tables.revisionDeliveries).toHaveLength(1)
    expect(backup.payload.importedBatchIds).toContain(batch.batchId)
    expect(backup.payload.tables.operators).toEqual([{ operatorId: 'operator-1', name: 'Host operator' }])
    expect(backup.payload.tables.auditEvents.some((event) => event.type === 'TEST_AUDIT')).toBe(true)
    expect(backup.payload.tables.localSettings).toContainEqual({ key: 'backup.reminderMinutes', value: 15 })
    expect(JSON.stringify(backup)).not.toContain('device-secret-must-not-travel')
  })
})
