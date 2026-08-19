import { describe, expect, it } from 'vitest'
import { createDatabase } from './database'

describe('normal reload persistence', () => {
  it('preserves scoring, conflict, transfer, config, and regression state across database reopen', async () => {
    const name = `reload-persistence-${crypto.randomUUID()}`
    const before = createDatabase(name)
    await before.open()

    await before.table('tournaments').put({ tournamentId: 't-1', currentConfigVersion: 3 })
    await before.table('configVersions').put({
      id: 1,
      configVersionId: 'cfg-3',
      tournamentId: 't-1',
      version: 3,
      createdAt: '2026-08-20T00:00:00.000Z',
      operator: 'operator',
      changeClass: 'SCORING',
      snapshot: {},
    })
    await before.table('scoringTestCases').put({
      testCaseId: 'test-1',
      competitionId: 'competition-1',
      name: 'regression',
      rounds: [],
      expected: [],
      lastApprovedChange: { operator: 'operator', approvedAt: '2026-08-20T00:00:00.000Z' },
    })
    await before.table('results').put({
      resultId: 'result-1', tournamentId: 't-1', competitionId: 'competition-1', scoringSessionId: 'session-1',
    })
    await before.table('resultRevisions').put({ revisionId: 'revision-1', resultId: 'result-1', revisionNumber: 1 })
    await before.table('conflictResolutions').put({ resolutionId: 'resolution-1', resultId: 'result-1', effectiveRevisionId: 'revision-1' })
    await before.table('transferBatches').put({
      batchId: 'batch-1', tournamentId: 't-1', status: 'PENDING', createdAt: '2026-08-20T00:00:00.000Z',
      batch: {}, encodedParts: ['part'], currentPartIndex: 0,
    })
    await before.table('receivedQrParts').put({
      id: 1, batchId: 'batch-1', tournamentId: 't-1', partIndex: 0, totalParts: 2, resultCount: 1,
      batchChecksum: 'batch-checksum', chunkChecksum: 'chunk-checksum', encoded: 'part', receivedAt: '2026-08-20T00:00:00.000Z',
    })
    await before.table('acknowledgements').put({ ackId: 'ack-1', batchId: 'batch-1', createdAt: '2026-08-20T00:00:00.000Z', ack: {} })
    await before.table('revisionDeliveries').put({ revisionId: 'revision-1', batchId: 'batch-1', status: 'DELIVERED', updatedAt: '2026-08-20T00:00:00.000Z' })
    before.close()

    const after = createDatabase(name)
    await after.open()

    expect(await after.table('results').get('result-1')).toBeDefined()
    expect(await after.table('resultRevisions').get('revision-1')).toBeDefined()
    expect(await after.table('conflictResolutions').get('resolution-1')).toBeDefined()
    expect(await after.table('transferBatches').get('batch-1')).toBeDefined()
    expect(await after.table('receivedQrParts').get(1)).toBeDefined()
    expect(await after.table('acknowledgements').get('ack-1')).toBeDefined()
    expect(await after.table('revisionDeliveries').get('revision-1')).toBeDefined()
    expect((await after.table('tournaments').get('t-1'))?.currentConfigVersion).toBe(3)
    expect((await after.table('configVersions').get(1))?.configVersionId).toBe('cfg-3')
    expect((await after.table('scoringTestCases').get('test-1'))?.lastApprovedChange).toEqual({
      operator: 'operator', approvedAt: '2026-08-20T00:00:00.000Z',
    })

    after.close()
    await createDatabase(name).delete()
  })
})
