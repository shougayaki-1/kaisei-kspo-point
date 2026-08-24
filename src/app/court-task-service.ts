import type { CompetitionId, ResultId, ScoringSessionId } from '../domain/ids'
import { resultIdForScoringSession } from '../domain/result'
import { ConfigRepository } from '../db/config-repository'
import type { AppDatabase } from '../db/database'
import { ResultRepository } from '../db/result-repository'
import { TransferRepository } from '../db/transfer-repository'
import type { CourtAssignment } from './court-assignment-service'

export type CourtTaskState =
  | 'NEXT'
  | 'LATER'
  | 'SAVED_UNSENT'
  | 'AWAITING_ACK'
  | 'COMPLETED'
  | 'CORRECTION_REQUIRED'

export interface CourtTaskCard {
  scoringSessionId: ScoringSessionId
  competitionId: CompetitionId
  competitionLabel: string
  taskLabel: string
  state: CourtTaskState
  resultId: ResultId
}

export interface CourtTaskGroup {
  state: CourtTaskState
  tasks: CourtTaskCard[]
}

async function deliveryState(
  transferRepository: TransferRepository,
  db: AppDatabase,
  revisionId: string,
): Promise<'UNSENT' | 'AWAITING_ACK' | 'DELIVERED' | 'REJECTED'> {
  const delivery = await transferRepository.getRevisionDelivery(revisionId as never)
  if (!delivery) return 'UNSENT'
  if (delivery.status === 'DELIVERED') return 'DELIVERED'

  const acknowledgements = await db.acknowledgements.where('batchId').equals(delivery.batchId).toArray()
  const rejected = acknowledgements.some((record) =>
    record.ack.results.some(
      (result) =>
        result.revisionId === revisionId &&
        (result.status === 'REJECTED' || result.status === 'CONFIG_MISMATCH'),
    ),
  )
  if (rejected) return 'REJECTED'
  return 'AWAITING_ACK'
}

export function createCourtTaskService(db: AppDatabase) {
  const configRepository = new ConfigRepository(db)
  const resultRepository = new ResultRepository(db)
  const transferRepository = new TransferRepository(db)

  return {
    async listAssignedTasks(assignment: CourtAssignment): Promise<CourtTaskCard[]> {
      const active = await configRepository.getActiveVersion(assignment.tournamentId)
      if (!active) return []
      const snapshot = active.snapshot

      const slotById = new Map(snapshot.scheduleSlots.map((slot) => [slot.slotId, slot]))
      const competitionById = new Map(snapshot.competitions.map((competition) => [competition.competitionId, competition]))

      const sessions = snapshot.scoringSessions
        .filter((session) => session.leadCourtStationId === assignment.courtStationId)
        .filter((session) => !assignment.competitionId || session.competitionId === assignment.competitionId)
        .sort((left, right) => {
          const slotOrder = (slotById.get(left.slotId)?.displayOrder ?? 0) - (slotById.get(right.slotId)?.displayOrder ?? 0)
          if (slotOrder !== 0) return slotOrder
          return left.displayOrder - right.displayOrder
        })

      const cards: CourtTaskCard[] = []
      let nextAssigned = false

      for (const session of sessions) {
        const resultId = resultIdForScoringSession(assignment.tournamentId, session.scoringSessionId)
        const result = await resultRepository.getResult(resultId)
        const competitionLabel = competitionById.get(session.competitionId)?.name ?? String(session.competitionId)

        if (!result) {
          cards.push({
            scoringSessionId: session.scoringSessionId,
            competitionId: session.competitionId,
            competitionLabel,
            taskLabel: session.label,
            state: nextAssigned ? 'LATER' : 'NEXT',
            resultId,
          })
          nextAssigned = true
          continue
        }

        const projection = await resultRepository.getProjection(resultId)
        let state: CourtTaskState
        if (projection?.conflictState.status === 'UNRESOLVED') {
          state = 'CORRECTION_REQUIRED'
        } else if (!projection?.effectiveRevision) {
          state = 'SAVED_UNSENT'
        } else {
          const delivery = await deliveryState(transferRepository, db, projection.effectiveRevision.revisionId)
          state = delivery === 'UNSENT'
            ? 'SAVED_UNSENT'
            : delivery === 'DELIVERED'
              ? 'COMPLETED'
              : delivery === 'REJECTED'
                ? 'CORRECTION_REQUIRED'
                : 'AWAITING_ACK'
        }

        cards.push({
          scoringSessionId: session.scoringSessionId,
          competitionId: session.competitionId,
          competitionLabel,
          taskLabel: session.label,
          state,
          resultId,
        })
      }

      return cards
    },
  }
}
