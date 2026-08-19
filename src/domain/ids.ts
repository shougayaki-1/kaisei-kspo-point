type Brand<T, B extends string> = T & { readonly __brand: B }

export type TournamentId = Brand<string, 'TournamentId'>
export type TeamId = Brand<string, 'TeamId'>
export type CompetitionId = Brand<string, 'CompetitionId'>
export type CompetitionEntryId = Brand<string, 'CompetitionEntryId'>
export type ScheduleSlotId = Brand<string, 'ScheduleSlotId'>
export type CourtRunId = Brand<string, 'CourtRunId'>
export type ScoringSessionId = Brand<string, 'ScoringSessionId'>
export type ResultId = Brand<string, 'ResultId'>
export type RevisionId = Brand<string, 'RevisionId'>
export type ScoringProfileId = Brand<string, 'ScoringProfileId'>
export type DeviceId = Brand<string, 'DeviceId'>
export type BatchId = Brand<string, 'BatchId'>

export function createId<T extends string = string>(): T {
  return crypto.randomUUID() as T
}
