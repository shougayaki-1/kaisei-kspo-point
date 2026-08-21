import type { SetupCompetitionDraft, SetupTeamDraft } from './setup-types'

export interface SetupCompetitionScheduleEntry {
  entryKey: string
  teamKey: string
  teamName: string
  label: string
  groupNumber: number
}

export interface SetupCompetitionScheduleCell {
  cellKey: string
  roundNumber: number
  courtNumber: number
  courtLabel: string
  entryKeys: string[]
}

export interface SetupCompetitionScheduleRound {
  roundKey: string
  roundNumber: number
  label: string
  startTime: string
  cells: SetupCompetitionScheduleCell[]
}

export interface SetupCompetitionScheduleInputGroup {
  groupKey: string
  label: string
  roundNumber: number
  courtNumbers: number[]
}

export interface SetupCompetitionSchedule {
  roundCount: number
  courtCount: number
  inputGrouping: SetupCompetitionDraft['inputGrouping']
  entries: SetupCompetitionScheduleEntry[]
  rounds: SetupCompetitionScheduleRound[]
  inputGroups: SetupCompetitionScheduleInputGroup[]
}

declare module './setup-types' {
  interface SetupCompetitionDraft {
    schedule?: SetupCompetitionSchedule
  }
}

interface TeamEntryQueue {
  teamKey: string
  entries: SetupCompetitionScheduleEntry[]
}

function courtLabel(courtNumber: number): string {
  return `${String.fromCharCode(64 + courtNumber)}コート`
}

function roundLabel(roundNumber: number): string {
  return `第${roundNumber}回`
}

function entryLabel(teamName: string, groupsPerTeam: number, groupNumber: number): string {
  return groupsPerTeam === 1 ? teamName : `${teamName} ${groupNumber}`
}

function buildEntries(
  competition: SetupCompetitionDraft,
  teams: SetupTeamDraft[],
): SetupCompetitionScheduleEntry[] {
  return teams.flatMap((team) =>
    Array.from({ length: competition.groupsPerTeam }, (_, groupIndex) => {
      const groupNumber = groupIndex + 1

      return {
        entryKey: `${team.teamKey}:group-${groupNumber}`,
        teamKey: team.teamKey,
        teamName: team.name,
        label: entryLabel(team.name, competition.groupsPerTeam, groupNumber),
        groupNumber,
      }
    }),
  )
}

function buildRounds(
  competition: SetupCompetitionDraft,
): SetupCompetitionScheduleRound[] {
  return Array.from({ length: competition.rounds }, (_, roundIndex) => {
    const roundNumber = roundIndex + 1

    return {
      roundKey: `round-${roundNumber}`,
      roundNumber,
      label: roundLabel(roundNumber),
      startTime: '',
      cells: Array.from({ length: competition.courts }, (_, courtIndex) => {
        const courtNumber = courtIndex + 1

        return {
          cellKey: `round-${roundNumber}-court-${courtNumber}`,
          roundNumber,
          courtNumber,
          courtLabel: courtLabel(courtNumber),
          entryKeys: [],
        }
      }),
    }
  })
}

function buildInputGroups(
  competition: SetupCompetitionDraft,
): SetupCompetitionScheduleInputGroup[] {
  if (competition.inputGrouping === 'WHOLE_ROUND') {
    return Array.from({ length: competition.rounds }, (_, roundIndex) => {
      const roundNumber = roundIndex + 1

      return {
        groupKey: `round-${roundNumber}-whole`,
        label: `${roundLabel(roundNumber)} まとめて入力`,
        roundNumber,
        courtNumbers: Array.from({ length: competition.courts }, (_, courtIndex) => courtIndex + 1),
      }
    })
  }

  if (competition.inputGrouping === 'PER_COURT') {
    return Array.from({ length: competition.rounds }, (_, roundIndex) =>
      Array.from({ length: competition.courts }, (_, courtIndex) => {
        const roundNumber = roundIndex + 1
        const courtNumber = courtIndex + 1

        return {
          groupKey: `round-${roundNumber}-court-${courtNumber}`,
          label: `${roundLabel(roundNumber)} ${courtLabel(courtNumber)}`,
          roundNumber,
          courtNumbers: [courtNumber],
        }
      }),
    ).flat()
  }

  return (competition.customGroups ?? []).map((group) => ({
    groupKey: group.groupKey,
    label: group.label,
    roundNumber: group.round,
    courtNumbers: [...group.courtIndexes],
  }))
}

function isCompatibleSchedule(
  schedule: SetupCompetitionSchedule | undefined,
  competition: SetupCompetitionDraft,
  entries: SetupCompetitionScheduleEntry[],
): schedule is SetupCompetitionSchedule {
  if (!schedule) return false
  if (schedule.roundCount !== competition.rounds) return false
  if (schedule.courtCount !== competition.courts) return false
  if (schedule.inputGrouping !== competition.inputGrouping) return false

  const expectedKeys = entries.map((entry) => entry.entryKey)
  const scheduleKeys = schedule.entries.map((entry) => entry.entryKey)

  return JSON.stringify(scheduleKeys) === JSON.stringify(expectedKeys)
}

function seedExistingSchedule(
  rounds: SetupCompetitionScheduleRound[],
  existingSchedule: SetupCompetitionSchedule | undefined,
  validEntryKeys: Set<string>,
): void {
  if (!existingSchedule) return

  for (const round of rounds) {
    const existingRound = existingSchedule.rounds.find(
      (candidate) => candidate.roundNumber === round.roundNumber,
    )
    if (!existingRound) continue

    round.startTime = existingRound.startTime

    for (const cell of round.cells) {
      const existingCell = existingRound.cells.find(
        (candidate) => candidate.courtNumber === cell.courtNumber,
      )
      if (!existingCell) continue

      cell.entryKeys = existingCell.entryKeys.filter((entryKey) => validEntryKeys.has(entryKey))
    }
  }
}

function buildQueues(
  entries: SetupCompetitionScheduleEntry[],
): TeamEntryQueue[] {
  const queuesByTeam = new Map<string, TeamEntryQueue>()

  for (const entry of entries) {
    const existing = queuesByTeam.get(entry.teamKey)

    if (existing) {
      existing.entries.push(entry)
      continue
    }

    queuesByTeam.set(entry.teamKey, {
      teamKey: entry.teamKey,
      entries: [entry],
    })
  }

  return [...queuesByTeam.values()]
}

function removeUsedEntries(
  queues: TeamEntryQueue[],
  usedEntryKeys: Set<string>,
): void {
  for (const queue of queues) {
    queue.entries = queue.entries.filter((entry) => !usedEntryKeys.has(entry.entryKey))
  }
}

function fillPrimaryAssignments(
  rounds: SetupCompetitionScheduleRound[],
  queues: TeamEntryQueue[],
  entryMap: Map<string, SetupCompetitionScheduleEntry>,
): void {
  for (const round of rounds) {
    const roundTeamKeys = new Set<string>()

    for (const cell of round.cells) {
      if (cell.entryKeys.length > 0) {
        cell.entryKeys.forEach((entryKey) => {
          const existingEntry = entryMap.get(entryKey)
          if (existingEntry) roundTeamKeys.add(existingEntry.teamKey)
        })
        continue
      }

      const nextQueue = queues.find(
        (queue) => queue.entries.length > 0 && !roundTeamKeys.has(queue.teamKey),
      )
      if (!nextQueue) continue

      const nextEntry = nextQueue.entries.shift()
      if (!nextEntry) continue

      cell.entryKeys = [nextEntry.entryKey]
      roundTeamKeys.add(nextEntry.teamKey)
    }
  }
}

function teamCountInRound(
  round: SetupCompetitionScheduleRound,
  teamKey: string,
  entryMap: Map<string, SetupCompetitionScheduleEntry>,
): number {
  return round.cells.reduce((count, cell) =>
    count + cell.entryKeys.filter((entryKey) => entryMap.get(entryKey)?.teamKey === teamKey).length,
  0)
}

function compareScores(
  left: [number, number, number, number],
  right: [number, number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue
    return left[index] - right[index]
  }
  return 0
}

function pickBestCellDeterministic(
  rounds: SetupCompetitionScheduleRound[],
  entry: SetupCompetitionScheduleEntry,
  entryMap: Map<string, SetupCompetitionScheduleEntry>,
): SetupCompetitionScheduleCell | undefined {
  let bestCell: SetupCompetitionScheduleCell | undefined
  let bestScore: [number, number, number, number] | undefined

  rounds.forEach((round, roundIndex) => {
    const roundTeamCount = teamCountInRound(round, entry.teamKey, entryMap)

    round.cells.forEach((cell, cellIndex) => {
      const score: [number, number, number, number] = [
        roundTeamCount,
        cell.entryKeys.length,
        roundIndex,
        cellIndex,
      ]

      if (!bestScore || compareScores(score, bestScore) < 0) {
        bestScore = score
        bestCell = cell
      }
    })
  })

  return bestCell
}

function fillRemainingAssignments(
  rounds: SetupCompetitionScheduleRound[],
  queues: TeamEntryQueue[],
  entryMap: Map<string, SetupCompetitionScheduleEntry>,
): void {
  while (queues.some((queue) => queue.entries.length > 0)) {
    let assignedInCycle = false

    for (const queue of queues) {
      const nextEntry = queue.entries.shift()
      if (!nextEntry) continue

      const targetCell = pickBestCellDeterministic(rounds, nextEntry, entryMap)
      if (!targetCell) {
        queue.entries.unshift(nextEntry)
        continue
      }

      targetCell.entryKeys = [...targetCell.entryKeys, nextEntry.entryKey]
      assignedInCycle = true
    }

    if (!assignedInCycle) break
  }
}

export function autoAssignCompetitionSchedule(
  competition: SetupCompetitionDraft,
  teams: SetupTeamDraft[],
): SetupCompetitionSchedule {
  const entries = buildEntries(competition, teams)
  const rounds = buildRounds(competition)
  const inputGroups = buildInputGroups(competition)
  const entryMap = new Map(entries.map((entry) => [entry.entryKey, entry]))
  const entryKeys = new Set(entries.map((entry) => entry.entryKey))
  const existingSchedule = isCompatibleSchedule(competition.schedule, competition, entries)
    ? competition.schedule
    : undefined

  seedExistingSchedule(rounds, existingSchedule, entryKeys)

  const queues = buildQueues(entries)
  const usedEntryKeys = new Set(
    rounds.flatMap((round) => round.cells.flatMap((cell) => cell.entryKeys)),
  )

  removeUsedEntries(queues, usedEntryKeys)
  fillPrimaryAssignments(rounds, queues, entryMap)
  fillRemainingAssignments(rounds, queues, entryMap)

  return {
    roundCount: competition.rounds,
    courtCount: competition.courts,
    inputGrouping: competition.inputGrouping,
    entries,
    rounds,
    inputGroups,
  }
}
