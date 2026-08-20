import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import type { BatchId, DeviceId, RevisionId } from '../domain/ids'
import type { ResultRevision } from '../domain/result'
import { createCourtResultService } from '../app/court-result-service'
import { createCourtTransferHistoryServices } from '../app/court-transfer-history-service'
import { createHostScoringService } from '../app/host-scoring-service'
import { processCompletedHostBatch } from '../app/host-transfer-import-service'
import { createDatabase, type AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import { createTransferBatch, encodeBatchFragments } from '../transfer/codec'
import { backupTestIds, seedBackupConfig } from '../backup/test-helpers'
import { buildReleaseIdentifier } from '../release/release-identifier'

const opened: AppDatabase[] = []
const names = new Set<string>()
function db(name = `event-day-${crypto.randomUUID()}`) {
  names.add(name)
  const value = createDatabase(name)
  opened.push(value)
  return value
}
afterEach(async () => {
  for (const value of opened.splice(0)) value.close()
  for (const name of names) {
    const value = createDatabase(name)
    await value.delete()
  }
  names.clear()
})

function branchFrom(
  parent: ResultRevision,
  revisionId: string,
  red: string,
  blue: string,
): ResultRevision {
  const rawData = structuredClone(parent.rawData) as {
    entries: Record<string, Record<string, unknown>>
  }
  rawData.entries[backupTestIds.entryA]!.score = red
  rawData.entries[backupTestIds.entryB]!.score = blue
  return {
    ...structuredClone(parent),
    revisionId: revisionId as RevisionId,
    revisionNumber: parent.revisionNumber + 1,
    parentRevisionIds: [parent.revisionId],
    rawData,
    createdAt: `2026-08-20T04:${revisionId === 'branch-left' ? '20' : '21'}:00.000Z`,
  }
}

describe('event-day automated rehearsal', () => {
  it('runs Court correction through persisted QR receive, Host scoring, ACK, conflict and explicit resolution', async () => {
    const court = db('event-court')
    const hostName = 'event-host'
    const host = db(hostName)
    await seedBackupConfig(court)
    await seedBackupConfig(host)

    const timestamps = [
      '2026-08-20T04:00:00.000Z',
      '2026-08-20T04:01:00.000Z',
    ]
    const courtService = createCourtResultService(court, {
      deviceId: 'court-event' as DeviceId,
      now: () => timestamps.shift() ?? '2026-08-20T04:02:00.000Z',
    })
    const created = await courtService.saveResult({
      scoringSessionId: backupTestIds.session,
      operator: 'Court operator',
      inputMode: 'NUMBER',
      values: {
        [backupTestIds.entryA]: { score: '2' },
        [backupTestIds.entryB]: { score: '1' },
      },
    })
    const corrected = await courtService.correctResult({
      resultId: created.result.resultId,
      operator: 'Court operator',
      inputMode: 'NUMBER',
      values: {
        [backupTestIds.entryA]: { score: '9' },
        [backupTestIds.entryB]: { score: '1' },
      },
    })
    const history = await courtService.getHistory(created.result.resultId)
    expect(history.revisions.map((item) => item.revisionId)).toEqual([
      created.revision.revisionId,
      corrected.revision.revisionId,
    ])
    expect(history.projection.effectiveRevision?.revisionId).toBe(corrected.revision.revisionId)

    const batch = createTransferBatch({
      tournamentId: backupTestIds.tournament,
      sourceDeviceId: 'court-event' as DeviceId,
      results: [corrected.result],
      revisions: history.revisions,
      createdAt: '2026-08-20T04:05:00.000Z',
      batchId: 'event-batch' as BatchId,
    })
    const encodedParts = await encodeBatchFragments(batch, 90)
    expect(encodedParts.length).toBeGreaterThan(2)
    const courtTransfer = new TransferRepository(court)
    await courtTransfer.saveOutgoingBatch(batch, encodedParts)

    const hostTransfer = new TransferRepository(host)
    await hostTransfer.saveReceivedPart(encodedParts.at(-1)!, '2026-08-20T04:06:00.000Z')
    await hostTransfer.saveReceivedPart(encodedParts[0]!, '2026-08-20T04:06:01.000Z')
    await hostTransfer.saveReceivedPart(encodedParts.at(-1)!, '2026-08-20T04:06:02.000Z')
    expect(await host.receivedQrParts.count()).toBe(2)
    expect((await hostTransfer.restoreReceiver(backupTestIds.tournament)).getProgress(batch.batchId)?.complete).toBe(false)

    host.close()
    const resumedHost = db(hostName)
    const resumedTransfer = new TransferRepository(resumedHost)
    const restoredReceiver = await resumedTransfer.restoreReceiver(backupTestIds.tournament)
    expect(restoredReceiver.getProgress(batch.batchId)?.receivedCount).toBe(2)
    for (const encoded of encodedParts.slice(1, -1).reverse()) {
      await resumedTransfer.saveReceivedPart(encoded, '2026-08-20T04:07:00.000Z')
    }
    expect((await resumedTransfer.restoreReceiver(backupTestIds.tournament)).getProgress(batch.batchId)?.complete).toBe(true)

    const ack = await processCompletedHostBatch(resumedHost, {
      batchId: batch.batchId,
      hostDeviceId: 'host-event' as DeviceId,
      now: '2026-08-20T04:08:00.000Z',
    })
    expect(ack.results.map((item) => item.status)).toEqual(['ACCEPTED', 'ACCEPTED'])
    expect(await resumedTransfer.listImportedBatchIds(backupTestIds.tournament)).toContain(batch.batchId)

    await courtTransfer.applyAcknowledgement(ack)
    const transferHistory = await createCourtTransferHistoryServices(court).listHistory()
    expect(transferHistory.find((item) => item.batchId === batch.batchId)?.status).toBe('ACKNOWLEDGED')
    expect((await createCourtTransferHistoryServices(court).reopen(batch.batchId)).encodedParts).toEqual(encodedParts)

    const hostService = createHostScoringService(resumedHost)
    const scored = await hostService.loadAuthoritativeState()
    expect(scored.projections[0]?.effectiveRevisionId).toBe(corrected.revision.revisionId)
    expect(scored.events[0]?.participants.every((item) => item.rounds.every((round) => round.trace.length > 0))).toBe(true)
    expect(scored.events[0]?.participants.every((item) => item.aggregateTrace.length > 0)).toBe(true)
    const standingsBeforeConflict = structuredClone(scored.standings)

    const resultRepository = new ResultRepository(resumedHost)
    const storedResult = await resultRepository.getResult(created.result.resultId)
    if (!storedResult) throw new Error('Host Result missing after import')
    const left = branchFrom(corrected.revision, 'branch-left', '1', '9')
    const right = branchFrom(corrected.revision, 'branch-right', '8', '2')
    await resultRepository.importRevision(storedResult, left)
    await resultRepository.importRevision(storedResult, right)

    const conflicted = await hostService.loadAuthoritativeState()
    const conflictProjection = conflicted.projections.find((item) => item.resultId === storedResult.resultId)!
    expect(conflictProjection.conflictState.status).toBe('UNRESOLVED')
    expect(conflictProjection.effectiveRevisionId).toBe(corrected.revision.revisionId)
    expect(conflicted.standings).toEqual(standingsBeforeConflict)

    await hostService.resolveConflict({
      resultId: storedResult.resultId,
      operator: 'Host operator',
      createdAt: '2026-08-20T04:22:00.000Z',
      choice: { kind: 'SELECT_REVISION', selectedRevisionId: left.revisionId },
    })
    const resolved = await hostService.loadAuthoritativeState()
    const resolvedProjection = resolved.projections.find((item) => item.resultId === storedResult.resultId)!
    expect(resolvedProjection.conflictState.status).toBe('RESOLVED')
    expect(resolvedProjection.resolutionHistory).toHaveLength(1)
    expect(resolved.standings).not.toEqual(standingsBeforeConflict)
    expect(await resultRepository.hasRevision(right.revisionId)).toBe(true)
  })

  it('records the release identifier contract and keeps player PII out of production Result/config schema sources', () => {
    expect(buildReleaseIdentifier({
      releaseSha: '0123456789abcdef0123456789abcdef01234567',
      activeConfigVersionId: 'config-approved',
    })).toEqual({
      appVersion: '0.1.0',
      releaseSha: '0123456789abcdef0123456789abcdef01234567',
      activeConfigVersionId: 'config-approved',
      databaseSchemaVersion: 5,
      backupFormatVersion: 1,
    })

    const productionSchemaText = [
      '../domain/result.ts',
      '../domain/tournament.ts',
      '../config/tournament-config.ts',
      '../db/schema.ts',
    ].map((relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')).join('\n')
    for (const forbidden of [
      /playerName/i,
      /birthdate/i,
      /dateOfBirth/i,
      /contactInfo/i,
      /studentPersonalIdentifier/i,
      /studentId/i,
    ]) {
      expect(productionSchemaText).not.toMatch(forbidden)
    }
  })

  it('keeps an executable operator runbook with preflight, role, recovery and manual physical gates', () => {
    const runbook = readFileSync(new URL('../../docs/event-day-operations.md', import.meta.url), 'utf8')
    for (const heading of [
      'Preflight', 'Court', 'Host', 'Display', 'Config update', 'Recovery', 'Failure handling',
      'Manual physical rehearsal', 'Coverage matrix', 'Release identifier',
    ]) {
      expect(runbook).toContain(heading)
    }
    expect(runbook).toContain('Formal Design §24 は18個')
    expect(runbook).toContain('authoritative 2026 data source blocker')
    expect(runbook).toContain('physical/manual: NOT EXECUTED')
  })
})
