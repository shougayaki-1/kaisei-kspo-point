# Tournament Configuration Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Host-side configuration foundation that can create, validate, version, persist, reopen, and edit a tournament with teams, competitions, schedule structure, scoring sessions, standard input schemas, and rank-point scoring profiles entirely offline.

**Architecture:** Add immutable configuration snapshots on top of the normalized Dexie tables already used by the application. Host edits a draft configuration in memory, validates cross-entity references, previews the next `ConfigVersion`, then atomically applies the snapshot to normalized tables and stores the immutable version record. The first UI is a manual configuration editor; CSV import, Config QR, scoring simulation, and Court result entry remain separate follow-on phases.

**Tech Stack:** TypeScript, React, Vitest, Testing Library, Dexie/IndexedDB, existing Vite toolchain. No external APIs, CDN dependencies, cloud persistence, or online authentication.

**Spec:** `docs/superpowers/specs/2026-08-19-offline-score-management-design.md`

## Global Constraints

- Tournament settings are data, not hard-coded competition rules.
- Team count and team names are configurable.
- `Team` and `CompetitionEntry` remain separate; entries aggregate back to a team.
- Physical `CourtRun` and input `ScoringSession` remain separate.
- `ScoringSession.inputScope` supports `PER_COURT | WHOLE_SLOT | CUSTOM_GROUP`.
- Standard form controls support at least `NUMBER`, `TIME`, `RANK`, `BOOLEAN`, `SELECT`, `PENALTY`, and `WIN_LOSS`; `SPECIAL` is reserved for dedicated competition modules.
- Rank scoring supports `HIGHER_IS_BETTER | LOWER_IS_BETTER`, tie rules, rank-point awards, and configurable aggregation.
- Applied ConfigVersions are immutable. Editing starts from the current snapshot and applying creates the next integer version.
- Applying configuration is atomic: a failed validation or failed IndexedDB transaction must not leave normalized tables partially updated.
- Existing Phase 1/2 Result, Revision, transfer, and ACK behavior must remain compatible.
- This phase is manual editing only. CSV import, Config QR, scoring simulator/test-case approval flow, and Court result-entry UI are intentionally not implemented here.

---

## File Structure

- `src/config/input-schema.ts`: standard input schema domain types and validation helpers.
- `src/config/tournament-config.ts`: complete editable/applied configuration snapshot type plus cross-reference validation.
- `src/config/tournament-config.test.ts`: pure validation tests.
- `src/db/schema.ts`: add `inputSchemas` and versioned configuration storage fields in schema v3.
- `src/db/database.ts`: expose the new table and migration version.
- `src/db/config-repository.ts`: atomic load/apply of immutable configuration snapshots and normalized tables.
- `src/db/config-repository.test.ts`: fake-IndexedDB persistence/versioning/rollback tests.
- `src/config/draft-service.ts`: helpers for creating an empty draft, cloning current config, and generating IDs for added entities.
- `src/config/draft-service.test.ts`: draft behavior tests.
- `src/app/TournamentConfigEditor.tsx`: Host manual editor and validation/apply UI.
- `src/app/TournamentConfigEditor.test.tsx`: UI tests.
- `src/app/App.tsx`: expose the editor from Host mode.
- `src/index.css`: editor layout only.

### Task 1: Standard InputSchema and complete configuration snapshot

**Files:**
- Create: `src/config/input-schema.ts`
- Create: `src/config/tournament-config.ts`
- Create: `src/config/tournament-config.test.ts`

**Interfaces:**
- Produces `InputSchema`, `InputField`, `TournamentConfigSnapshot`, `validateTournamentConfig(snapshot): ConfigValidationIssue[]`.
- `ConfigValidationIssue` has `{ severity: 'ERROR' | 'WARNING'; code: string; message: string; targetId?: string }`.

- [ ] **Step 1: Write failing validation tests.** Cover a valid minimal tournament; duplicate stable IDs; CompetitionEntry referencing an unknown Team; CourtRun referencing an unknown CompetitionEntry; ScoringSession referencing an unknown CourtRun; InputSchema referencing an unknown Competition; ScoringProfile referencing an unknown Competition; invalid NUMBER min/max; invalid SELECT with zero options; and duplicate rank-point keys after numeric normalization.

Use a valid fixture shaped like:

```ts
const snapshot: TournamentConfigSnapshot = {
  tournament: {
    tournamentId: 'tournament-1' as TournamentId,
    name: '開成運動交流祭',
    eventDate: '2026-09-01',
    currentConfigVersion: 0,
  },
  teams: [
    { teamId: 'team-1' as TeamId, tournamentId: 'tournament-1' as TournamentId, name: '1組' },
  ],
  competitions: [
    {
      competitionId: 'competition-1' as CompetitionId,
      tournamentId: 'tournament-1' as TournamentId,
      name: '玉入れ',
      defaultInputScope: 'WHOLE_SLOT',
    },
  ],
  competitionEntries: [
    {
      entryId: 'entry-1' as CompetitionEntryId,
      competitionId: 'competition-1' as CompetitionId,
      teamId: 'team-1' as TeamId,
      label: '1組',
    },
  ],
  scheduleSlots: [
    {
      slotId: 'slot-1' as ScheduleSlotId,
      competitionId: 'competition-1' as CompetitionId,
      label: '第1展開',
      plannedStart: '09:00',
      plannedEnd: '09:10',
    },
  ],
  courtRuns: [
    {
      courtRunId: 'run-1' as CourtRunId,
      slotId: 'slot-1' as ScheduleSlotId,
      courtLabel: 'A',
      participantEntryIds: ['entry-1' as CompetitionEntryId],
    },
  ],
  scoringSessions: [
    {
      scoringSessionId: 'session-1' as ScoringSessionId,
      competitionId: 'competition-1' as CompetitionId,
      slotId: 'slot-1' as ScheduleSlotId,
      label: '第1展開 全体',
      courtRunIds: ['run-1' as CourtRunId],
      inputScope: 'WHOLE_SLOT',
    },
  ],
  inputSchemas: [
    {
      inputSchemaId: 'schema-1',
      competitionId: 'competition-1' as CompetitionId,
      version: 1,
      fields: [{ key: 'count', label: '個数', type: 'NUMBER', required: true, min: 0, max: 100 }],
    },
  ],
  scoringProfiles: [
    {
      scoringProfileId: 'profile-1' as ScoringProfileId,
      competitionId: 'competition-1' as CompetitionId,
      version: 1,
      rankingRule: { direction: 'HIGHER_IS_BETTER' },
      tieRule: 'AVERAGE_OCCUPIED_PLACES',
      awardRule: { type: 'RANK_POINTS', rankPoints: { 1: 30, 2: 20, 3: 10, 4: 0 } },
      aggregationRule: 'SUM',
    },
  ],
}
```

- [ ] **Step 2: Verify red.** Run `npm run test:run -- src/config/tournament-config.test.ts`; expected failure is unresolved imports for the new config modules.
- [ ] **Step 3: Implement the domain types.** `InputField` is a discriminated union for `NUMBER | TIME | RANK | BOOLEAN | SELECT | PENALTY | WIN_LOSS | SPECIAL`; all fields carry `key`, `label`, and `required`. NUMBER/PENALTY support numeric min/max; SELECT requires non-empty `{ value, label }[]`; RANK carries `allowTies: boolean`.
- [ ] **Step 4: Implement deterministic validation.** All reference errors are `ERROR`; empty display names/labels are errors; missing optional schedule times are allowed; `plannedStart >= plannedEnd` is a `WARNING`, not an error, because overnight/string formats are not interpreted in this phase.
- [ ] **Step 5: Run focused tests, then `npm run typecheck` and `npm run build` and commit.**

### Task 2: Atomic ConfigVersion persistence and normalized-table application

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/database.ts`
- Create: `src/db/config-repository.ts`
- Create: `src/db/config-repository.test.ts`

**Interfaces:**
- Produces `ConfigRepository.loadCurrent(tournamentId)`, `ConfigRepository.apply(snapshot, metadata)`, and `ConfigRepository.listVersions(tournamentId)`.
- `apply` returns `{ version: number; snapshot: TournamentConfigSnapshot }`.
- `metadata` is `{ operator: string; createdAt: string; changeClass: 'DISPLAY_ONLY' | 'SCHEDULE' | 'SCORING' | 'INPUT_SCHEMA' }`.

- [ ] **Step 1: Write failing fake-IndexedDB tests.** Prove first apply creates v1; second apply creates v2 without mutating v1 snapshot; normalized tables exactly match v2 after apply; another tournament is untouched; invalid snapshots are rejected before any write; and a transaction exception leaves both ConfigVersion and normalized tables at the previous state.
- [ ] **Step 2: Verify red** with `npm run test:run -- src/db/config-repository.test.ts`.
- [ ] **Step 3: Upgrade DB schema to v3.** Add `inputSchemas: 'inputSchemaId,competitionId,version'`. Extend `ConfigVersionRecord` to store `operator`, `changeClass`, and a typed `snapshot`. Keep v1/v2 definitions untouched and register v3 with Dexie.
- [ ] **Step 4: Implement `ConfigRepository.apply`.** Call `validateTournamentConfig`; reject if any `ERROR`; compute `nextVersion = max(existing versions)+1`; deep-clone the snapshot; force `tournament.currentConfigVersion = nextVersion`; in one Dexie transaction replace only this tournament's normalized rows and insert the immutable configVersion record. Rows belonging to other tournaments must not be cleared.
- [ ] **Step 5: Implement `loadCurrent` from the highest stored version, falling back to normalized tables only when no version record exists.** Return a deep clone so UI editing cannot mutate persisted snapshots by reference.
- [ ] **Step 6: Run focused tests and full `npm run test:run`, `npm run typecheck`, `npm run build`; commit.**

### Task 3: Draft creation and editing helpers

**Files:**
- Create: `src/config/draft-service.ts`
- Create: `src/config/draft-service.test.ts`

**Interfaces:**
- Produces `createEmptyTournamentDraft(name, eventDate?)`, `cloneConfigDraft(snapshot)`, `addTeam`, `addCompetition`, `addScheduleSlot`, `addCourtRun`, `addScoringSession`, `ensureDefaultInputSchema`, and `ensureDefaultScoringProfile`.

- [ ] **Step 1: Write failing tests.** Verify empty draft gets a UUID tournament ID and `currentConfigVersion: 0`; added Team/Competition/etc. IDs are UUIDs; new Competition gets one empty standard InputSchema version 1 and one default rank-points ScoringProfile version 1; cloned drafts are deep copies; deleting a Team that is still referenced is not silently cascaded and is surfaced by validation.
- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Implement pure immutable helpers.** Every helper returns a new draft object and never mutates the argument. Default new competition settings are `defaultInputScope: 'WHOLE_SLOT'`, `HIGHER_IS_BETTER`, `AVERAGE_OCCUPIED_PLACES`, empty rank points, and `SUM`; the UI must require the operator to complete meaningful rules before apply.
- [ ] **Step 4: Run focused/full verification and commit.**

### Task 4: Host manual tournament configuration editor

**Files:**
- Create: `src/app/TournamentConfigEditor.tsx`
- Create: `src/app/TournamentConfigEditor.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Props: `{ repository: Pick<ConfigRepository, 'loadCurrent' | 'apply'>; tournamentId?: TournamentId; operatorName: string }`.
- UI supports creating/loading a draft, editing basic tournament info, Teams, Competitions, ScheduleSlots, CourtRuns, ScoringSessions, standard InputSchema fields, rank points, and applying a new ConfigVersion.

- [ ] **Step 1: Write failing React tests.** Cover creating a new tournament; adding/removing teams; adding a competition; adding a NUMBER field; adding slot/run/session; validation errors shown before apply; successful apply displays `Config v1`; editing and reapplying displays `Config v2`; and an InputSchema error prevents repository `apply` from being called.
- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Implement the editor as small sections/components in the same file only while each remains straightforward.** Use stable IDs as values and human labels for display. Do not expose raw UUID editing. Require confirmation before deleting entities. Show validation issues grouped by ERROR/WARNING. WARNINGS do not block apply; ERRORS do.
- [ ] **Step 4: Implement InputSchema field editing for NUMBER, TIME, RANK, BOOLEAN, SELECT, PENALTY, WIN_LOSS.** SPECIAL may be selected but only stores `{ type: 'SPECIAL', specialKey: string }`; no dedicated special UI is implemented here.
- [ ] **Step 5: Implement rank-point editing as explicit rank/points rows and scoring direction/tie/aggregation selects.** Do not add arbitrary formula editing.
- [ ] **Step 6: Run UI tests and full verification; commit.**

### Task 5: Wire configuration into Host mode and protect existing transfer UI

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Host mode gets a simple local tab switch: `大会設定` and `QR受信`.
- The editor uses the shared browser `AppDatabase`/`ConfigRepository`; QR receive continues using the same database.

- [ ] **Step 1: Add failing App tests.** Verify Host mode shows `大会設定` and `QR受信`; default Host view is configuration when no tournament is configured; switching to QR receive still renders the Phase 2 transfer UI; Court mode remains unchanged.
- [ ] **Step 2: Verify red.**
- [ ] **Step 3: Add the Host tab shell and instantiate `ConfigRepository` once per mounted App.** Keep the existing safe reload footer and device identity behavior unchanged.
- [ ] **Step 4: Run `npm run test:run`, `npm run typecheck`, and `npm run build`.** Fix only regressions caused by this phase.
- [ ] **Step 5: Review the PR against this plan and the approved spec, then commit the final integration.**

## Acceptance Gate

Phase 3 is ready for merge only when CI demonstrates all of the following:

- A Host can create a tournament entirely offline without hard-coded team count/name assumptions.
- The snapshot can represent CompetitionEntry, ScheduleSlot, CourtRun, and ScoringSession separately.
- Standard InputSchema and rank-point ScoringProfile rules are persisted as configuration data.
- Invalid cross-references cannot be applied.
- Applying a draft creates an immutable monotonically increasing ConfigVersion and atomically updates normalized tables.
- Reopening the app loads the latest applied snapshot without mutating older versions.
- Host can edit and apply v2 after v1 while retaining v1 history.
- Existing Phase 1 Result/Revision and Phase 2 QR/ACK tests remain green.
- `npm ci`, all Vitest tests, TypeScript typecheck, and production Vite build succeed.
