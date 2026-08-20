import { describe, expect, it, vi } from 'vitest'
import { createDatabase } from './database'
import { DATA_RESET_TABLE_NAMES, resetAllPersistentData } from './data-reset'

const recordByTable: Record<string, Record<string, unknown>> = {
  appMeta: { key: 'meta', value: 'x' },
  tournaments: { tournamentId: 't-1', currentConfigVersion: 3 },
  teams: { teamId: 'team-1', tournamentId: 't-1' },
  competitions: { competitionId: 'competition-1', tournamentId: 't-1' },
  competitionEntries: { entryId: 'entry-1', competitionId: 'competition-1', teamId: 'team-1' },
  scheduleSlots: { slotId: 'slot-1', competitionId: 'competition-1' },
  courtRuns: { courtRunId: 'court-1', slotId: 'slot-1' },
  scoringSessions: { scoringSessionId: 'session-1', competitionId: 'competition-1', slotId: 'slot-1' },
  inputSchemas: { inputSchemaId: 'input-1', competitionId: 'competition-1', version: 1 },
  scoringProfiles: { scoringProfileId: 'profile-1', competitionId: 'competition-1', version: 1 },
  scoringTestCases: {
    testCaseId: 'test-1',
    competitionId: 'competition-1',
    name: 'regression',
    rounds: [],
    expected: [],
    lastApprovedChange: { operator: 'operator', approvedAt: '2026-08-20T00:00:00.000Z' },
  },
  configVersions: {
    id: 1,
    configVersionId: 'cfg-3',
    tournamentId: 't-1',
    version: 3,
    createdAt: '2026-08-20T00:00:00.000Z',
    operator: 'operator',
    changeClass: 'SCORING',
    snapshot: {},
  },
  results: { resultId: 'result-1', tournamentId: 't-1', competitionId: 'competition-1', scoringSessionId: 'session-1' },
  resultRevisions: { revisionId: 'revision-1', resultId: 'result-1', revisionNumber: 1 },
  conflictResolutions: { resolutionId: 'resolution-1', resultId: 'result-1', effectiveRevisionId: 'revision-1' },
  transferBatches: {
    batchId: 'batch-1', tournamentId: 't-1', status: 'PENDING', createdAt: '2026-08-20T00:00:00.000Z',
    batch: {}, encodedParts: ['part'], currentPartIndex: 0,
  },
  receivedQrParts: {
    id: 1, batchId: 'batch-1', tournamentId: 't-1', partIndex: 0, totalParts: 2, resultCount: 1,
    batchChecksum: 'batch-checksum', chunkChecksum: 'chunk-checksum', encoded: 'part', receivedAt: '2026-08-20T00:00:00.000Z',
  },
  acknowledgements: { ackId: 'ack-1', batchId: 'batch-1', createdAt: '2026-08-20T00:00:00.000Z', ack: {} },
  revisionDeliveries: { revisionId: 'revision-1', batchId: 'batch-1', status: 'PENDING', updatedAt: '2026-08-20T00:00:00.000Z' },
  operators: { operatorId: 'operator-1', name: 'operator' },
  auditEvents: { eventId: 'audit-1', type: 'TEST', timestamp: '2026-08-20T00:00:00.000Z' },
  localSettings: { key: 'setting', value: 'value' },
}

async function seedEveryTable(databaseName: string) {
  const db = createDatabase(databaseName)
  await db.open()
  for (const table of db.tables) {
    await table.put(structuredClone(recordByTable[table.name]))
  }
  return db
}

describe('destructive persistent-data reset', () => {
  it('keeps the explicit reset table list synchronized with the complete database graph', () => {
    const db = createDatabase(`reset-list-${crypto.randomUUID()}`)
    expect([...DATA_RESET_TABLE_NAMES].sort()).toEqual(db.tables.map((table) => table.name).sort())
    db.close()
  })

  it('clears every persistent table as one integrity-coupled reset', async () => {
    const name = `reset-all-${crypto.randomUUID()}`
    const db = await seedEveryTable(name)

    await resetAllPersistentData(db)

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
    db.close()
    await createDatabase(name).delete()
  })

  it('rolls back earlier clears if any coupled table cannot be cleared', async () => {
    const name = `reset-atomic-${crypto.randomUUID()}`
    const db = await seedEveryTable(name)
    const revisions = db.table('resultRevisions')
    const originalClear = revisions.clear.bind(revisions)
    revisions.clear = vi.fn(async () => { throw new Error('forced reset failure') }) as unknown as typeof revisions.clear

    await expect(resetAllPersistentData(db)).rejects.toThrow('forced reset failure')

    expect(await db.table('results').count()).toBe(1)
    expect(await db.table('resultRevisions').count()).toBe(1)
    expect(await db.table('configVersions').count()).toBe(1)
    revisions.clear = originalClear
    db.close()
    await createDatabase(name).delete()
  })

  it('is idempotent when the operator repeats the reset action', async () => {
    const name = `reset-repeat-${crypto.randomUUID()}`
    const db = await seedEveryTable(name)

    await resetAllPersistentData(db)
    await resetAllPersistentData(db)

    for (const table of db.tables) expect(await table.count(), table.name).toBe(0)
    db.close()
    await createDatabase(name).delete()
  })
})
