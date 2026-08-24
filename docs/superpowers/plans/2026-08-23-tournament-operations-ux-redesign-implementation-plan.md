# Tournament Operations UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the internal-model-oriented tournament setup and Court result entry screens with a four-stage exchange-festival setup, persistent Court assignment, ordered task home, and method-aware result entry that remains fully offline and conflict-safe.

**Architecture:** Make `CourtStation`, `ResultEntryPolicy`, stable task identity, and revision-pinned input metadata part of the immutable tournament configuration. Compile human-facing setup drafts into that model, derive Court assignments and task status from the active configuration plus local Result/transfer state, and project every allowed input method into one canonical rank/outcome representation before tournament award scoring. Keep `CONFIG_UPDATE`, Result/Revision, QR transfer, ACK, and immutable ConfigVersion semantics, but intentionally replace the pre-production snapshot/DB shapes without a legacy compatibility layer.

**Tech Stack:** React, TypeScript, Material UI 9, Dexie/IndexedDB, Zod, ZXing Browser, Vitest, Testing Library, Vite PWA.

**Spec:** `docs/superpowers/specs/2026-08-23-tournament-operations-ux-redesign-design.md`

## Global Constraints

- Before the first implementation edit, obey `AGENTS.md`: use the context7 MCP server to retrieve current documentation for Dexie schema upgrades, Material UI form patterns, Zod discriminated unions, and Vitest/Testing Library. Record the retrieved document titles/versions in the execution notes.
- Use TDD for every implementation task: RED -> GREEN -> REFACTOR. Do not combine multiple tasks into one unreviewable change.
- This product has not entered real operation. Do not build readers, migrations, feature flags, or dual-write paths for the old development snapshot. Bump the DB schema, update every fixture/template/test in the same task, and use the existing full-reset action for stale local development data.
- After the new model is applied, preserve immutable ConfigVersion and ResultRevision semantics. A later configuration must retain unchanged Tournament, Competition, CourtStation, and ScoringSession IDs.
- QR and manual Court selection are two inputs to the same validation/persistence service. Manual selection must remain available whenever QR scanning is unavailable.
- Assignment QR is not a configuration-distribution QR. A Court device must have a compatible active ConfigVersion before assignment can be accepted.
- The Court may select only methods allowed by the Host. A per-match override never changes the next match's default.
- Save the actual `methodKey`, `inputMode`, `inputSchemaId`, schema version, ConfigVersion ID, and ConfigVersion number on every ResultRevision.
- Scoring uses the Revision's immutable ConfigVersion, method, schema, and projection rule, never merely the current active schema.
- Do not store player names, student IDs, or other player PII. Existing production-field validation remains mandatory.
- No cloud service, login, realtime dispatch, CDN dependency, or network requirement may be introduced.
- Normal Host/Court screens must not display `ScoringSession`, `CourtRun`, `Result`, `Revision`, `ConfigVersion`, raw IDs, enum literals, or schema keys. These may appear only in detailed management/diagnostics.
- Preserve unrelated user changes and untracked `.superpowers/brainstorm/` and `*.tsbuildinfo` files.

## File Structure Locked by This Plan

### New domain/config files

- `src/config/result-entry-policy.ts` - method definitions, projection-rule types, and policy lookup.
- `src/domain/result-entry-projection.ts` - schema validation and canonical rank/outcome projection shared by Court preview, regression, and Host scoring.
- `src/config/config-identity-impact.ts` - unchanged-ID checks and destructive-task change detection.

### New Court operations files

- `src/app/court-assignment-service.ts` - active-config validation plus assignment persistence.
- `src/app/court-task-service.ts` - assignment-filtered ordered tasks and transfer/ACK status derivation.
- `src/app/court/CourtAssignmentPanel.tsx` - QR/manual assignment UI.
- `src/app/court/CourtTaskHome.tsx` - next/later/saved/pending/completed/correction task groups.
- `src/app/court/ResultEntryScreen.tsx` - result entry and correction orchestration.
- `src/app/court/MethodSelector.tsx` - allowed method selection with destructive-switch confirmation.
- `src/app/court/DynamicResultForm.tsx` - InputSchema-driven, Japanese-labelled fields.
- `src/app/court/ResultPreview.tsx` - projected outcome/rank confirmation.

### New Host operations files

- `src/app/tournament-settings/TournamentSettingsHome.tsx` - post-apply settings cards.
- `src/app/tournament-settings/CourtAssignmentQrPanel.tsx` - Court-only and competition+Court QR generation.
- `src/app/tournament-settings/OperationsPreview.tsx` - Court input/task preview and final validation summary.
- `src/app/tournament-settings/config-edit-service.ts` - editing of applied snapshots while retaining stable IDs.

### Existing files expected to change

- Domain/config: `src/domain/ids.ts`, `src/domain/tournament.ts`, `src/domain/result.ts`, `src/domain/revision.ts`, `src/domain/revision-graph.ts`, `src/domain/result-projection.ts`, `src/domain/scoring.ts`, `src/domain/scoring-engine.ts`, `src/config/input-schema.ts`, `src/config/tournament-config.ts`, setup draft/schema/compiler/validation/templates and scoring test files.
- Persistence: `src/db/schema.ts`, `src/db/database.ts`, `src/db/config-repository.ts`, `src/db/result-repository.ts`, backup/reset tests and fixtures.
- Transfer: `src/transfer/types.ts`, `src/transfer/codec.ts`, `src/transfer/import-service.ts`, `src/transfer/ack.ts`, `src/transfer/config-update.ts`, transfer-history services.
- UI/routing: `src/app/App.tsx`, `src/app/CourtScoringSession.tsx`, `src/app/court-result-service.ts`, `src/app/host-scoring-service.ts`, setup wizard/steps, app and integration tests.
- Delete after replacement parity: `src/app/TournamentConfigEditor.tsx`, `src/app/TournamentConfigEditorBase.tsx`, and their obsolete tests.

---

### Task 0: Retrieve current documentation and lock the baseline

**Files:**
- Read: `AGENTS.md`
- Read: `package.json`
- Read: `docs/superpowers/specs/2026-08-23-tournament-operations-ux-redesign-design.md`
- Create during execution: `docs/superpowers/execution-notes/2026-08-23-tournament-operations-ux-redesign.md`

**Interfaces:** None; this is the mandatory pre-code gate.

- [ ] **Step 1: Retrieve current primary documentation through context7**

Use context7 before any code edit and record the returned library/version/title for:

```text
Dexie: versioned stores, upgrade transactions, test database deletion
Material UI: accessible Select/RadioGroup/TextField patterns and responsive cards
Zod: discriminatedUnion and superRefine
Vitest + Testing Library: fake-indexeddb, async UI queries, user-event-equivalent patterns available in this repo
```

- [ ] **Step 2: Create the execution note**

Start it with this exact checklist and fill the source fields with context7 results:

```md
# Tournament Operations UX Redesign Execution Notes

- Dexie source:
- Material UI source:
- Zod source:
- Vitest/Testing Library source:
- Baseline commit:
- Baseline test result:
```

- [ ] **Step 3: Verify the repository baseline**

Run:

```bash
git status --short
npm run test:run
npm run typecheck
npm run build
```

Expected: the product suite, typecheck, and build pass. Record pre-existing untracked files without adding them.

- [ ] **Step 4: Commit only the execution note**

```bash
git add -- docs/superpowers/execution-notes/2026-08-23-tournament-operations-ux-redesign.md
git commit -m "docs: record operations redesign implementation baseline"
```

---

### Task 1: Replace the configuration and persistence model

**Files:**
- Modify: `src/domain/ids.ts`
- Modify: `src/domain/tournament.ts`
- Modify: `src/config/input-schema.ts`
- Create: `src/config/result-entry-policy.ts`
- Modify: `src/config/tournament-config.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/db/database.ts`
- Modify: `src/db/config-repository.ts`
- Modify: `src/db/data-reset.ts`
- Test: `src/config/tournament-config.test.ts`
- Test: `src/db/config-repository.test.ts`
- Test: `src/db/data-reset.test.ts`

**Interfaces:**
- Produces `CourtStationId`, `CourtStation`, `ResultEntryPolicy`, `ResultEntryMethodDefinition`, `ResultProjectionRule`.
- Adds `courtStations` and `resultEntryPolicies` to `TournamentConfigSnapshot` and normalized storage.
- Bumps `DATABASE_SCHEMA_VERSION` from 5 to 6 with no legacy data upgrade logic.

- [ ] **Step 1: Write failing configuration-contract tests**

Add focused fixtures using these public shapes:

```ts
const policy: ResultEntryPolicy = {
  competitionId,
  defaultMethodKey: 'detail',
  allowedMethodKeys: ['detail', 'score', 'outcome'],
  methods: [
    {
      methodKey: 'detail',
      label: '綱を取った本数',
      kind: 'DETAIL',
      inputMode: 'NUMBER',
      inputSchemaId: 'schema-detail',
      projection: { type: 'SUM_FIELDS', fieldKeys: ['first', 'second'], direction: 'HIGHER_IS_BETTER' },
    },
    {
      methodKey: 'score',
      label: '競技内ポイント',
      kind: 'SCORE',
      inputMode: 'NUMBER',
      inputSchemaId: 'schema-score',
      projection: { type: 'SINGLE_FIELD', fieldKey: 'score', direction: 'HIGHER_IS_BETTER' },
    },
    {
      methodKey: 'outcome',
      label: '勝敗',
      kind: 'OUTCOME',
      inputMode: 'WIN_LOSS',
      inputSchemaId: 'schema-outcome',
      projection: { type: 'DIRECT_OUTCOME', fieldKey: 'outcome' },
    },
  ],
}

expect(validateTournamentConfig(snapshotWith({ resultEntryPolicies: [policy] })))
  .not.toContainEqual(expect.objectContaining({ severity: 'ERROR' }))
```

Also assert errors for: default not allowed, duplicate method keys, allowed unknown method, schema from another competition, duplicate Court display order, CourtRun without a CourtStation, and ScoringSession without a valid representative Court.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
npm run test:run -- src/config/tournament-config.test.ts src/db/config-repository.test.ts src/db/data-reset.test.ts
```

Expected: FAIL because the new types/tables do not exist.

- [ ] **Step 3: Add the exact domain contracts**

```ts
export type CourtStationId = Brand<string, 'CourtStationId'>

export interface CourtStation {
  courtStationId: CourtStationId
  tournamentId: TournamentId
  label: string
  shortLabel?: string
  displayOrder: number
}

export interface ScheduleSlot {
  slotId: ScheduleSlotId
  competitionId: CompetitionId
  label: string
  displayOrder: number
  plannedStart?: string
  plannedEnd?: string
}

export interface CourtRun {
  courtRunId: CourtRunId
  slotId: ScheduleSlotId
  courtStationId: CourtStationId
  participantEntryIds: CompetitionEntryId[]
}

export interface ScoringSession {
  scoringSessionId: ScoringSessionId
  competitionId: CompetitionId
  slotId: ScheduleSlotId
  label: string
  displayOrder: number
  leadCourtStationId: CourtStationId
  courtRunIds: CourtRunId[]
  inputScope: InputScope
}
```

Use this projection union in `result-entry-policy.ts`:

```ts
export type ResultProjectionRule =
  | { type: 'SINGLE_FIELD'; fieldKey: string; direction: RankingDirection }
  | { type: 'SUM_FIELDS'; fieldKeys: string[]; direction: RankingDirection }
  | { type: 'DIRECT_RANK'; fieldKey: string }
  | { type: 'DIRECT_OUTCOME'; fieldKey: string }
```

- [ ] **Step 4: Replace the snapshot and DB schema atomically**

Add `courtStations: CourtStation[]` and `resultEntryPolicies: ResultEntryPolicy[]` to the snapshot. Add Dexie stores:

```ts
export const schemaV6 = {
  ...schemaV5,
  courtStations: 'courtStationId,tournamentId,displayOrder',
  resultEntryPolicies: 'competitionId',
} as const
```

Register only a normal `version(6).stores(schemaV6)` declaration; do not write a migration that fabricates CourtStation references for old rows. Update normalized config read/replace transactions and the full-reset table list.

- [ ] **Step 5: Update all TypeScript fixtures to the new required shape**

Use a shared test helper where practical. Do not add optional fallbacks such as `snapshot.courtStations ?? []` in production code.

- [ ] **Step 6: Run focused tests, then repository-wide typecheck**

```bash
npm run test:run -- src/config/tournament-config.test.ts src/db/config-repository.test.ts src/db/data-reset.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/domain/ids.ts src/domain/tournament.ts src/config/input-schema.ts src/config/result-entry-policy.ts src/config/tournament-config.ts src/db/schema.ts src/db/database.ts src/db/config-repository.ts src/db/data-reset.ts src/config/tournament-config.test.ts src/db/config-repository.test.ts src/db/data-reset.test.ts
git commit -m "refactor: replace tournament operations config model"
```

---

### Task 2: Compile stable Courts, tasks, and entry policies

**Files:**
- Modify: `src/config/setup/setup-types.ts`
- Modify: `src/config/setup/template-schema.ts`
- Modify: `src/config/setup/builtin-templates.ts`
- Modify: `src/config/setup/setup-compiler.ts`
- Modify: `src/config/setup/setup-validation.ts`
- Modify: `src/config/setup/schedule-assignment.ts`
- Test: corresponding `*.test.ts` files under `src/config/setup/`

**Interfaces:**
- Replaces the seven-step setup draft with `SOURCE | CHANGES | INPUT_AND_SCORING | OPERATIONS_CHECK`.
- Adds stable draft keys for Court stations, schedule slots, and logical scoring tasks.
- Guarantees one task per Court for `PER_COURT`, one representative-Court task for `WHOLE_SLOT`, and one representative-Court task per configured group for `CUSTOM_GROUP`.

- [ ] **Step 1: Write failing compiler tests for all input scopes**

Use deterministic IDs and assert exact task topology:

```ts
const snapshot = compileTournamentSetup(draft, {
  createId: (kind, key) => `${kind}:${key}`,
})

expect(snapshot.courtStations.map(({ label, displayOrder }) => ({ label, displayOrder })))
  .toEqual([{ label: 'Aコート', displayOrder: 0 }, { label: 'Bコート', displayOrder: 1 }])
expect(snapshot.scoringSessions.map((session) => ({
  scope: session.inputScope,
  lead: session.leadCourtStationId,
  runs: session.courtRunIds.length,
}))).toEqual(expectedSessions)
```

Separate tests must cover `PER_COURT`, `WHOLE_SLOT`, `CUSTOM_GROUP`, explicit schedule order, planned time remaining auxiliary, and repeated compilation of one draft producing identical IDs.

- [ ] **Step 2: Write failing policy/template tests**

Require the exchange-festival template to define, per competition, a default method, allowed methods, schemas, projection rules, and scoring tests. Assert every allowed method projects the same representative case to identical ranks and award points.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/config/setup
```

- [ ] **Step 4: Replace setup draft contracts**

```ts
export type SetupStep =
  | 'SOURCE'
  | 'CHANGES'
  | 'INPUT_AND_SCORING'
  | 'OPERATIONS_CHECK'

export interface SetupCourtStationDraft {
  stationKey: string
  label: string
  shortLabel?: string
  displayOrder: number
}

export interface TournamentSetupDraft {
  draftFormatVersion: 2
  draftId: string
  createdAt: string
  updatedAt: string
  currentStep: SetupStep
  source: { type: 'STANDARD'; templateId: string } | { type: 'PREVIOUS'; configVersionId: string }
  tournament: { name: string; eventDate?: string }
  teams: SetupTeamDraft[]
  courtStations: SetupCourtStationDraft[]
  competitions: SetupCompetitionDraft[]
}
```

The standard exchange-festival template is first; generic templates and JSON import remain available only through detailed management.

- [ ] **Step 5: Implement deterministic draft compilation**

Change the compiler option to semantic keys:

```ts
export interface SetupCompilerOptions {
  createId: <T extends string>(kind: string, stableKey: string) => T
}

const defaultOptions: SetupCompilerOptions = {
  createId: (kind, stableKey) => `${kind}:${stableKey}` as never,
}
```

Derive each stable key from `draftId` plus its persisted draft key, never array index alone. New-tournament compilation occurs once; applied-snapshot editing later retains existing IDs rather than recompiling unchanged entities.

- [ ] **Step 6: Generate methods and schemas as a single unit**

For every competition, emit one `InputSchema` per method and one `ResultEntryPolicy`. Fail compilation if a method has no schema/projection or if two methods reuse a key with incompatible definitions.

- [ ] **Step 7: Update validation and built-in fixtures**

Map all messages to the four human steps. Remove old step names and update `2026-taihu-no-me.scoring.json` plus every built-in template to snapshot format v2.

- [ ] **Step 8: Run focused tests and typecheck**

```bash
npm run test:run -- src/config/setup src/config/tournament-config.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -- src/config/setup/setup-types.ts src/config/setup/template-schema.ts src/config/setup/template-schema.test.ts src/config/setup/builtin-templates.ts src/config/setup/builtin-templates.test.ts src/config/setup/setup-compiler.ts src/config/setup/setup-compiler.test.ts src/config/setup/setup-validation.ts src/config/setup/setup-validation.test.ts src/config/setup/schedule-assignment.ts src/config/setup/schedule-assignment.test.ts src/config/fixtures/2026-taihu-no-me.scoring.json
git commit -m "feat: compile Court tasks and result entry policies"
```

---

### Task 3: Project every input method into canonical results

**Files:**
- Create: `src/domain/result-entry-projection.ts`
- Create: `src/domain/result-entry-projection.test.ts`
- Modify: `src/domain/scoring.ts`
- Modify: `src/domain/scoring-engine.ts`
- Modify: `src/domain/scoring-engine.test.ts`
- Modify: `src/config/scoring-test-case.ts`
- Modify: `src/config/scoring-test-case.test.ts`
- Modify: `src/config/scoring-test-config-validation.test.ts`

**Interfaces:**
- Produces `CanonicalCompetitionResult` and `projectResultEntry()`.
- Adds a projected-result branch to the scoring scenario without hard-coding competition names.

- [ ] **Step 1: Write failing projection tests**

Cover single numeric/time value, sum of detail fields, direct rank with ties, direct outcome, missing/extra fields, range failures, non-complementary two-team outcomes, and more than two entries for direct outcome.

Use this expected output:

```ts
export interface CanonicalCompetitionEntryResult {
  entryId: CompetitionEntryId
  rank: number
  comparisonValue?: ExactValue
  outcome?: MatchOutcome
}

export interface CanonicalCompetitionResult {
  entries: CanonicalCompetitionEntryResult[]
}
```

Example assertion:

```ts
expect(projectResultEntry({
  method,
  schema,
  entries: {
    red: { first: '2', second: '1' },
    white: { first: '1', second: '1' },
  },
})).toEqual({
  entries: [
    { entryId: 'red', rank: 1, comparisonValue: 3 },
    { entryId: 'white', rank: 2, comparisonValue: 2 },
  ],
})
```

- [ ] **Step 2: Write failing scoring-regression tests**

One representative competition must be entered through DETAIL, SCORE, and OUTCOME methods and produce the same ranks and award scores. Explicitly assert that DETAIL values are competition measurements, not tournament award points.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/domain/result-entry-projection.test.ts src/domain/scoring-engine.test.ts src/config/scoring-test-case.test.ts src/config/scoring-test-config-validation.test.ts
```

- [ ] **Step 4: Implement the pure projection pipeline**

`projectResultEntry()` must:

1. validate raw rows through the referenced schema;
2. apply only the method's declared projection rule;
3. produce deterministic ranks/ties;
4. validate direct outcomes for exactly two participants;
5. return Japanese-display-neutral canonical data.

Do not import React, Dexie, the active ConfigRepository, or competition-name constants.

- [ ] **Step 5: Extend scoring to consume canonical ranks/outcomes**

Add this scenario branch:

```ts
export interface ScoringScenarioRound<TId extends string = string> {
  roundId: string
  values?: RankedParticipantValue<TId>[]
  rawValues?: RawParticipantValue<TId>[]
  projected?: Array<{
    participantId: TId
    rank: number
    comparisonValue?: ExactValue
    outcome?: MatchOutcome
  }>
}
```

Require exactly one of `values`, `rawValues`, or `projected`. Award points from projected rank using the existing tie rule and preserve outcome/comparison data in traces.

- [ ] **Step 6: Make scoring tests method-aware**

Persist test inputs by `methodKey`; run every allowed method for each representative case and report which user-facing method failed.

- [ ] **Step 7: Run focused tests and full domain/config suite**

```bash
npm run test:run -- src/domain src/config
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- src/domain/result-entry-projection.ts src/domain/result-entry-projection.test.ts src/domain/scoring.ts src/domain/scoring-engine.ts src/domain/scoring-engine.test.ts src/config/scoring-test-case.ts src/config/scoring-test-case.test.ts src/config/scoring-test-config-validation.test.ts
git commit -m "feat: project result entry methods into canonical scoring"
```

---

### Task 4: Protect stable configuration identity after first apply

**Files:**
- Create: `src/config/config-identity-impact.ts`
- Create: `src/config/config-identity-impact.test.ts`
- Create: `src/app/tournament-settings/config-edit-service.ts`
- Create: `src/app/tournament-settings/config-edit-service.test.ts`
- Modify: `src/config/setup/setup-draft-repository.ts`
- Modify: `src/db/config-repository.ts`
- Modify: `src/db/config-repository.test.ts`

**Interfaces:**
- Produces `analyzeConfigIdentityImpact(current, next, resultCounts)`.
- Blocks deletion, split, merge, or identity change of a ScoringSession that already has Results.

- [ ] **Step 1: Write failing identity-impact tests**

Assert unchanged IDs remain unchanged when labels, planned time, display order, allowed methods, or award rules change. Assert hard blocking for a result-bearing task that is removed, changes competition, changes member CourtRuns, or changes representative Court.

```ts
expect(analyzeConfigIdentityImpact(current, next, new Map([[sessionId, 1]])))
  .toEqual(expect.objectContaining({
    blocked: true,
    issues: [expect.objectContaining({ code: 'RESULT_BEARING_TASK_CHANGED' })],
  }))
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run test:run -- src/config/config-identity-impact.test.ts src/app/tournament-settings/config-edit-service.test.ts src/db/config-repository.test.ts
```

- [ ] **Step 3: Implement explicit existing-snapshot editing**

Edits start from a structured clone of the active snapshot. Existing entity IDs stay on their entity; only newly added Competition/CourtStation/ScoringSession receives a new ID. Never match identity by display label.

- [ ] **Step 4: Gate ConfigRepository.apply**

Before applying version 2+, query Result counts by ScoringSession and reject blocked identity changes with a typed error containing affected user-facing competition/task labels. Keep first apply unaffected.

- [ ] **Step 5: Test safe and destructive edits**

Also test that an event-start reset with zero Results can replace task topology, and that copied previous-year settings create a new Tournament identity rather than sharing Results.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
npm run test:run -- src/config/config-identity-impact.test.ts src/app/tournament-settings/config-edit-service.test.ts src/db/config-repository.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -- src/config/config-identity-impact.ts src/config/config-identity-impact.test.ts src/app/tournament-settings/config-edit-service.ts src/app/tournament-settings/config-edit-service.test.ts src/config/setup/setup-draft-repository.ts src/db/config-repository.ts src/db/config-repository.test.ts
git commit -m "feat: protect stable tournament task identity"
```

---

### Task 5: Make logical Results deterministic and root conflicts resolvable

**Files:**
- Modify: `src/domain/result.ts`
- Modify: `src/domain/revision.ts`
- Modify: `src/domain/revision-graph.ts`
- Modify: `src/domain/result-projection.ts`
- Modify: `src/db/result-repository.ts`
- Modify: corresponding domain/DB tests
- Modify: `src/app/court-result-service.ts`
- Modify: `src/app/court-result-service.test.ts`

**Interfaces:**
- Produces `resultIdForScoringSession(tournamentId, scoringSessionId)`.
- Makes logical Result metadata device-independent and moves origin metadata to each Revision.
- Supports a conflict between two root revisions with no real common ancestor.

- [ ] **Step 1: Write failing deterministic identity tests**

```ts
expect(resultIdForScoringSession(tournamentId, sessionId))
  .toBe(resultIdForScoringSession(tournamentId, sessionId))
expect(resultIdForScoringSession(tournamentId, otherSessionId))
  .not.toBe(resultIdForScoringSession(tournamentId, sessionId))
```

Simulate two Court devices saving the same session. Assert one Result ID, two root Revisions, unresolved conflict at Host, and no double score.

- [ ] **Step 2: Write failing root-conflict resolution tests**

Create two revisions with empty `parentRevisionIds`; verify selecting either or merging them creates a valid resolution even though `commonConfirmedAncestorRevisionId` is `null`.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/domain/revision-graph.test.ts src/domain/result-projection.test.ts src/db/result-repository.test.ts src/app/court-result-service.test.ts
```

- [ ] **Step 4: Replace Result/Revision metadata**

```ts
export interface Result {
  resultId: ResultId
  tournamentId: TournamentId
  competitionId: CompetitionId
  scoringSessionId: ScoringSessionId
  currentRevisionId: RevisionId | null
}

export interface ResultRevision {
  revisionId: RevisionId
  resultId: ResultId
  revisionNumber: number
  parentRevisionIds: RevisionId[]
  source: RevisionSource
  createdByDeviceId: DeviceId
  operator: string
  methodKey: string
  inputMode: InputMode
  inputSchemaId: string
  inputSchemaVersion: number
  rawData: RawResultData
  configVersionId: string
  configVersion: number
  createdAt: string
}
```

Use a deterministic, versioned string namespace such as `result:v1:${tournamentId}:${scoringSessionId}`.

- [ ] **Step 5: Support virtual-root conflicts**

Change conflict metadata to `commonConfirmedAncestorRevisionId: RevisionId | null`. Validate root conflicts by requiring all candidate roots to have no parent; resolution Revisions still list all candidate heads as parents.

- [ ] **Step 6: Pin correction metadata**

Normal correction starts with the effective Revision's method/schema/config. If the operator switches to another allowed method, save a new Revision with that method and the current head as parent. Never overwrite rawData.

- [ ] **Step 7: Run focused tests plus transfer typecheck**

```bash
npm run test:run -- src/domain/revision-graph.test.ts src/domain/result-projection.test.ts src/db/result-repository.test.ts src/app/court-result-service.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add -- src/domain/result.ts src/domain/revision.ts src/domain/revision-graph.ts src/domain/result-projection.ts src/domain/revision-graph.test.ts src/domain/result-projection.test.ts src/db/result-repository.ts src/db/result-repository.test.ts src/app/court-result-service.ts src/app/court-result-service.test.ts
git commit -m "feat: make Court result identity conflict safe"
```

---

### Task 6: Add assignment QR and the shared assignment service

**Files:**
- Create: `src/transfer/court-assignment.ts`
- Create: `src/transfer/court-assignment.test.ts`
- Create: `src/app/court-assignment-service.ts`
- Create: `src/app/court-assignment-service.test.ts`
- Modify: `src/transfer/types.ts`

**Interfaces:**
- Produces `CourtAssignmentQrPayload`, `CourtAssignment`, encode/decode, validate/save/load/clear.
- Stores the assignment under `court.assignment.v1` in `localSettings`.

- [ ] **Step 1: Write failing codec tests**

Use the exact payload:

```ts
const payload: CourtAssignmentQrPayload = {
  type: 'COURT_ASSIGNMENT',
  schemaVersion: 1,
  tournamentId,
  courtStationId,
  competitionId,
}
```

Assert Court-only and competition+Court round trips, malformed/version-unknown rejection, checksum corruption rejection, and no `configVersionId` in encoded or decoded data.

- [ ] **Step 2: Write failing service tests**

Cover: no active config, QR success, manual success producing the same scope, wrong tournament preserving the current assignment, unknown/deleted Court, unknown/deleted competition, reload persistence, explicit change, and clear.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/transfer/court-assignment.test.ts src/app/court-assignment-service.test.ts
```

- [ ] **Step 4: Implement a standalone small-payload codec**

Use a distinct `KSPOA1:` prefix and checksum. Do not add assignment to `QrPayloadKind`; that union remains for multi-frame transfer/config payloads.

- [ ] **Step 5: Implement one validation path**

```ts
export interface CourtAssignment {
  tournamentId: TournamentId
  courtStationId: CourtStationId
  competitionId?: CompetitionId
  assignedAt: string
  source: 'QR' | 'MANUAL'
}

validateAndSave(input: {
  tournamentId: TournamentId
  courtStationId: CourtStationId
  competitionId?: CompetitionId
  source: 'QR' | 'MANUAL'
}): Promise<CourtAssignment>
```

Both decoded QR and manual selections call `validateAndSave()`. On validation failure, perform no write.

- [ ] **Step 6: Run focused tests and transfer suite**

```bash
npm run test:run -- src/transfer src/app/court-assignment-service.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -- src/transfer/court-assignment.ts src/transfer/court-assignment.test.ts src/transfer/types.ts src/app/court-assignment-service.ts src/app/court-assignment-service.test.ts
git commit -m "feat: add persistent Court assignment"
```

---

### Task 7: Derive ordered Court tasks and operational states

**Files:**
- Create: `src/app/court-task-service.ts`
- Create: `src/app/court-task-service.test.ts`
- Modify: `src/app/court-transfer-history-service.ts`
- Modify: `src/app/court-transfer-history-service.test.ts`

**Interfaces:**
- Produces `CourtTaskCard`, `CourtTaskGroup`, and `listAssignedTasks(assignment)`.
- Uses explicit schedule/session order, not IDs or current time.

- [ ] **Step 1: Write failing filtering and ordering tests**

Test Court-only assignment, competition+Court assignment, lead-Court ownership for WHOLE_SLOT/CUSTOM_GROUP, alternate unfinished task selection, and sorting by `(slot.displayOrder, session.displayOrder)` while planned time is display-only.

- [ ] **Step 2: Write failing state derivation tests**

Use these states:

```ts
export type CourtTaskState =
  | 'NEXT'
  | 'LATER'
  | 'SAVED_UNSENT'
  | 'QR_CREATED'
  | 'AWAITING_ACK'
  | 'COMPLETED'
  | 'CORRECTION_REQUIRED'
```

Assert unresolved local conflict or rejected/config-mismatch ACK maps to `CORRECTION_REQUIRED`; delivered/ACK accepted maps to `COMPLETED`; an existing effective Revision prevents a second new Result action.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/app/court-task-service.test.ts src/app/court-transfer-history-service.test.ts
```

- [ ] **Step 4: Implement a read-only task projection**

Join active snapshot, assignment, Results/Revisions, transfer batches, revision deliveries, and acknowledgements. Keep this service free of React and do not mutate delivery state while listing.

- [ ] **Step 5: Run focused tests**

```bash
npm run test:run -- src/app/court-task-service.test.ts src/app/court-transfer-history-service.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add -- src/app/court-task-service.ts src/app/court-task-service.test.ts src/app/court-transfer-history-service.ts src/app/court-transfer-history-service.test.ts
git commit -m "feat: derive ordered Court task status"
```

---

### Task 8: Connect the four-stage Host setup flow

**Files:**
- Modify: `src/app/tournament-setup/TournamentSetupWizard.tsx`
- Modify: `src/app/tournament-setup/TournamentSetupWizard.test.tsx`
- Modify/reuse: step components under `src/app/tournament-setup/`
- Create: `src/app/tournament-settings/OperationsPreview.tsx`
- Create: `src/app/tournament-settings/OperationsPreview.test.tsx`
- Modify: `src/app/tournament-setup/tournament-config-apply-service.ts`
- Modify: its test

**Interfaces:**
- Four visible steps: `元になる大会`, `今年の変更`, `入力と得点`, `当日確認`.
- Applies only after config validation and all required method-aware scoring regressions pass/are approved.

- [ ] **Step 1: Replace wizard tests before UI code**

Assert the visible flow starts with exchange-festival standard/previous choices, moves through exactly four steps, autosaves/reloads, summarizes unchanged values, opens a competition card directly from an issue, previews a Court screen/task list, and disables apply on any error or unapproved regression.

- [ ] **Step 2: Add an internal-language guard test**

```ts
for (const forbidden of ['ScoringSession', 'CourtRun', 'Result', 'Revision', 'ConfigVersion', 'inputSchemaId']) {
  expect(screen.queryByText(new RegExp(forbidden, 'i'))).not.toBeInTheDocument()
}
```

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/app/tournament-setup src/app/tournament-settings/OperationsPreview.test.tsx
```

- [ ] **Step 4: Refactor orchestration, reusing only suitable controls**

Collapse Basic/Teams/Competition/Schedule into the `今年の変更` stage with closed summaries for unchanged sections. Combine method policy, projection summary, award summary, and regression state in `入力と得点`. Put input/task/QR previews and final issues in `当日確認`.

- [ ] **Step 5: Preserve autosave and retry semantics**

Keep `保存中`, `保存済み`, and retryable `保存できませんでした` states. Apply must clear the setup draft only after ConfigRepository.apply succeeds.

- [ ] **Step 6: Run focused tests and typecheck**

```bash
npm run test:run -- src/app/tournament-setup src/app/tournament-settings/OperationsPreview.test.tsx
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -- src/app/tournament-setup src/app/tournament-settings/OperationsPreview.tsx src/app/tournament-settings/OperationsPreview.test.tsx
git commit -m "feat: connect four-stage tournament setup"
```

---

### Task 9: Add the post-apply settings home and assignment QR generation

**Files:**
- Create: `src/app/tournament-settings/TournamentSettingsHome.tsx`
- Create: `src/app/tournament-settings/TournamentSettingsHome.test.tsx`
- Create: `src/app/tournament-settings/CourtAssignmentQrPanel.tsx`
- Create: `src/app/tournament-settings/CourtAssignmentQrPanel.test.tsx`
- Modify: `src/app/ConfigFilePanel.tsx`
- Modify: `src/app/ConfigUpdatePanel.tsx`

**Interfaces:**
- Cards: Basic/teams, competitions/input, schedule/Courts, Court-device distribution, validation, advanced management.
- Generates one reusable Court-only QR and optional competition+Court QRs.

- [ ] **Step 1: Write failing settings-home tests**

Assert a newly applied tournament opens the settings home rather than the wizard. Each card displays a Japanese summary and deep-links to the relevant editor stage. JSON import/export, version details, and calculation traces appear only after opening `詳細管理`.

- [ ] **Step 2: Write failing assignment-QR panel tests**

Assert every Court has a Court-only QR, competition filtering generates a competition+Court QR, the payload excludes ConfigVersion ID, print labels identify tournament/Court/competition, and manual-selection instructions appear beside QR instructions.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/app/tournament-settings
```

- [ ] **Step 4: Implement card routing and advanced separation**

Use local component routing/state rather than introducing a router dependency. Existing config file/update panels move under advanced management or distribution as appropriate.

- [ ] **Step 5: Run focused tests and responsive render check**

```bash
npm run test:run -- src/app/tournament-settings
npm run typecheck
```

Render at 390px width in the browser during execution and attach the observation to execution notes.

- [ ] **Step 6: Commit**

```bash
git add -- src/app/tournament-settings src/app/ConfigFilePanel.tsx src/app/ConfigUpdatePanel.tsx
git commit -m "feat: add tournament settings home and Court QR"
```

---

### Task 10: Build Court assignment and task-home screens

**Files:**
- Create: `src/app/court/CourtAssignmentPanel.tsx`
- Create: `src/app/court/CourtAssignmentPanel.test.tsx`
- Create: `src/app/court/CourtTaskHome.tsx`
- Create: `src/app/court/CourtTaskHome.test.tsx`
- Modify: `src/app/CourtScoringSession.tsx`
- Modify: `src/app/CourtScoringSession.test.tsx`

**Interfaces:**
- Unassigned Court opens assignment UI with QR and manual choices.
- Assigned Court opens task home with the next task first and an explicit `担当を変更` action.

- [ ] **Step 1: Write failing assignment UI tests**

Cover no config guidance, successful scan, camera denial/failure, always-visible manual path, Court then optional competition selection, wrong-tournament rejection preserving current assignment, invalid saved assignment prompting reselection, and reload persistence.

- [ ] **Step 2: Write failing task-home tests**

Assert large tournament/Court/competition identity, `次に入力`, grouped later/status cards, ability to choose another unfinished task, completed task review/correction action, and no internal terms.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/app/court src/app/CourtScoringSession.test.tsx
```

- [ ] **Step 4: Implement assignment-first orchestration**

Use the existing ZXing/browser scanning adapter already used elsewhere, but expose manual selection at the same hierarchy level as scanning. Keep the saved assignment if a new scan fails validation.

- [ ] **Step 5: Replace the global ScoringSession selector**

`CourtScoringSession` becomes a thin orchestration boundary or is renamed during the final routing task. It must not list all sessions sorted by ID.

- [ ] **Step 6: Run focused tests and phone-width check**

```bash
npm run test:run -- src/app/court src/app/CourtScoringSession.test.tsx
npm run typecheck
```

At 390px width, verify the next-task action appears before later/history sections without horizontal scrolling.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/court/CourtAssignmentPanel.tsx src/app/court/CourtAssignmentPanel.test.tsx src/app/court/CourtTaskHome.tsx src/app/court/CourtTaskHome.test.tsx src/app/CourtScoringSession.tsx src/app/CourtScoringSession.test.tsx
git commit -m "feat: add Court assignment and task home"
```

---

### Task 11: Build method-aware result entry and correction

**Files:**
- Create: `src/app/court/ResultEntryScreen.tsx`
- Create: `src/app/court/ResultEntryScreen.test.tsx`
- Create: `src/app/court/MethodSelector.tsx`
- Create: `src/app/court/MethodSelector.test.tsx`
- Create: `src/app/court/DynamicResultForm.tsx`
- Create: `src/app/court/DynamicResultForm.test.tsx`
- Create: `src/app/court/ResultPreview.tsx`
- Create: `src/app/court/ResultPreview.test.tsx`
- Modify: `src/app/court-result-service.ts`
- Modify: `src/app/court-result-service.test.ts`
- Modify: `src/app/host-scoring-service.ts`
- Modify: `src/app/host-scoring-service.test.ts`

**Interfaces:**
- `loadTask()` returns policy, default method, allowed methods, schemas, participants, and original revision metadata for correction.
- `preview()` and Host scoring both call the same pure projection function.

- [ ] **Step 1: Write failing service tests**

Assert default method load, allowed-only override, next-task reset to default, schema-specific validation, preview parity with Host scoring, Revision metadata pinning, historical ConfigVersion lookup, retry after save failure preserving values, and correction defaulting to the original method.

- [ ] **Step 2: Write failing UI tests**

Cover DETAIL fields such as `1本目/2本目`, SCORE field, direct OUTCOME choices, TIME and RANK, projected Japanese preview, confirm-before-save, forbidden method omission, entered-value clearing confirmation on method switch, save error with retained inputs, and separation of normal input/correction/transfer history.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/app/court src/app/court-result-service.test.ts src/app/host-scoring-service.test.ts
```

- [ ] **Step 4: Implement the method-aware service contract**

```ts
export interface SaveCourtResultInput {
  scoringSessionId: ScoringSessionId
  operator: string
  methodKey: string
  values: Record<string, Record<string, unknown>>
}

export interface CourtResultPreview {
  methodKey: string
  schema: InputSchema
  projection: CanonicalCompetitionResult
}
```

The service resolves `inputMode` from the selected method; the UI never submits an arbitrary enum.

- [ ] **Step 5: Resolve Host scoring by Revision config**

For each effective Revision, load `configVersionId`, then find its method and exact schema ID/version. Reject with `CONFIG_MISMATCH`-style operator guidance if that immutable configuration is unavailable; never silently substitute the active schema.

- [ ] **Step 6: Implement screen structure**

Render in this order: competition/Court/task/teams, current method with secondary change action, schema-specific fields, Japanese result preview, confirmation, save. After save, return to task home and reset method state.

- [ ] **Step 7: Run focused tests and domain parity tests**

```bash
npm run test:run -- src/app/court src/app/court-result-service.test.ts src/app/host-scoring-service.test.ts src/domain/result-entry-projection.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add -- src/app/court/ResultEntryScreen.tsx src/app/court/ResultEntryScreen.test.tsx src/app/court/MethodSelector.tsx src/app/court/MethodSelector.test.tsx src/app/court/DynamicResultForm.tsx src/app/court/DynamicResultForm.test.tsx src/app/court/ResultPreview.tsx src/app/court/ResultPreview.test.tsx src/app/court-result-service.ts src/app/court-result-service.test.ts src/app/host-scoring-service.ts src/app/host-scoring-service.test.ts
git commit -m "feat: add method-aware Court result entry"
```

---

### Task 12: Integrate transfer, ACK, draft activation gate, and status refresh

**Files:**
- Modify: `src/transfer/types.ts`
- Modify: `src/transfer/codec.ts`
- Modify: `src/transfer/import-service.ts`
- Modify: `src/transfer/ack.ts`
- Modify: `src/transfer/config-update.ts`
- Modify: related transfer tests
- Modify: `src/app/config-update-service.ts`
- Modify: `src/app/config-update-service.test.ts`
- Modify: `src/app/host-transfer-import-service.ts`
- Modify: `src/app/host-transfer-import-service.test.ts`
- Modify: Court transfer history/status components and tests

**Interfaces:**
- Transfer validates pinned Revision configuration/method/schema.
- Config activation reports `UNSAVED_DRAFT` until the Court saves or discards in-progress values.

- [ ] **Step 1: Write failing end-to-end transfer tests**

Cover accepted pinned revision, duplicate accepted as already received, same logical Result with two device roots becoming conflict, missing historical config, unknown method/schema, config mismatch, ACK state reflected on task card, ACK resend, and no double scoring.

- [ ] **Step 2: Write failing config-update draft-gate tests**

Persist an in-progress result-entry draft in `localSettings`; assert activation is blocked with a Japanese save/discard instruction. After explicit discard or successful save, the same update activates.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/transfer src/app/config-update-service.test.ts src/app/host-transfer-import-service.test.ts src/app/court-transfer-history-service.test.ts
```

- [ ] **Step 4: Update transfer validation atomically**

Validate logical Result metadata separately from device-specific Revision metadata. Accept multiple immutable Revisions for the same deterministic Result. Keep `RESULT_BATCH`, `ACK_BATCH`, and `CONFIG_UPDATE` protocol meanings unchanged; bump protocol version only if the encoded Result/Revision shape requires it, and update all producer/consumer tests together.

- [ ] **Step 5: Implement draft gate and task-status refresh**

Use a versioned local key such as `court.resultEntryDraft.v1`. Activation checks it before replacing normalized config. Task status refreshes after QR creation, ACK scan, save, correction, and conflict response.

- [ ] **Step 6: Run transfer and integration tests**

```bash
npm run test:run -- src/transfer src/app/config-update-service.test.ts src/app/host-transfer-import-service.test.ts src/app/court-transfer-history-service.test.ts
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add -- src/transfer/types.ts src/transfer/codec.ts src/transfer/codec.test.ts src/transfer/import-service.ts src/transfer/import-service.test.ts src/transfer/import-service-phase2.test.ts src/transfer/ack.ts src/transfer/ack.test.ts src/transfer/config-update.ts src/transfer/config-update.test.ts src/app/config-update-service.ts src/app/config-update-service.test.ts src/app/host-transfer-import-service.ts src/app/host-transfer-import-service.test.ts src/app/court-transfer-history-service.ts src/app/court-transfer-history-service.test.ts
git commit -m "feat: integrate Court task transfer and ACK state"
```

---

### Task 13: Switch application routing and remove the legacy editors

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Delete: `src/app/TournamentConfigEditor.tsx`
- Delete: `src/app/TournamentConfigEditorBase.tsx`
- Delete/update: obsolete editor tests
- Modify: `src/index.css` only for responsive rules not expressible with MUI props

**Interfaces:**
- Host CONFIG: no tournament -> four-stage setup; active tournament -> settings home.
- Court: no config -> config guidance; no valid assignment -> assignment; valid assignment -> task home/result entry.

- [ ] **Step 1: Write failing App routing tests**

Test all Host and Court state branches, return navigation, restored/imported config refresh, invalid assignment recovery, and release-gate/backup access. Assert the old raw editor is never rendered.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
npm run test:run -- src/app/App.test.tsx
```

- [ ] **Step 3: Connect the new services/components**

Keep service construction in `App` memoized. Pass explicit state-change callbacks so apply, config activation, assignment change, result save, transfer, and ACK cause the correct screen projection to reload.

- [ ] **Step 4: Delete legacy editors only after routing parity passes**

Remove imports, production render paths, files, and tests that exclusively verify raw one-screen configuration editing. Preserve low-level config file import/export under detailed management.

- [ ] **Step 5: Run App suite, typecheck, and build**

```bash
npm run test:run -- src/app/App.test.tsx src/app/phase4-court-entry-gate.test.tsx src/app/phase5-data-management-integration.test.tsx src/app/phase6-backup-integration.test.tsx
npm run typecheck
npm run build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/app/App.tsx src/app/App.test.tsx src/app/TournamentConfigEditor.tsx src/app/TournamentConfigEditorBase.tsx src/app/TournamentConfigEditor.test.tsx src/app/TournamentConfigEditorExactConfig.test.tsx src/app/TournamentConfigRegressionIntegration.test.tsx src/index.css
git commit -m "refactor: switch to operations-first Host and Court routing"
```

---

### Task 14: Complete the offline rehearsal and acceptance verification

**Files:**
- Modify: `src/integration/event-day-rehearsal.test.ts`
- Create: `src/integration/tournament-operations-ux-rehearsal.test.ts`
- Modify: `src/backup/backup-schema.ts`
- Modify: backup/restore tests if the new tables are backed up separately
- Modify: `docs/superpowers/execution-notes/2026-08-23-tournament-operations-ux-redesign.md`

**Interfaces:** Complete offline lifecycle from Host setup to Court ACK.

- [ ] **Step 1: Write the failing full rehearsal first**

The integration test must perform:

```text
standard exchange-festival draft
-> four-stage validation/apply
-> CONFIG_UPDATE encode/import/activate on Court
-> manual Court assignment
-> default DETAIL entry and save
-> second task overridden to SCORE only for that task
-> RESULT_BATCH encode/import on Host
-> Host scoring
-> ACK encode/import on Court
-> completed task state
```

Add a second scenario using assignment QR and two Court devices entering the same task, producing one logical Result with a resolvable conflict and no double score.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
npm run test:run -- src/integration/tournament-operations-ux-rehearsal.test.ts src/integration/event-day-rehearsal.test.ts
```

- [ ] **Step 3: Close only integration gaps**

Do not add new architecture in this task. Fix missing wiring, backup inclusion, state refresh, or operator-facing messages exposed by the rehearsal.

- [ ] **Step 4: Run the complete automated verification**

```bash
npm run test:run
npm run typecheck
npm run build
git diff --check
```

Expected: all commands PASS with no whitespace errors.

- [ ] **Step 5: Perform browser and physical-offline checks**

Using the in-app browser at phone width, verify:

- four-stage Host setup and settings home;
- QR and manual assignment equivalence;
- next-task visibility without horizontal scrolling;
- DETAIL/SCORE/OUTCOME forms and one-task override reset;
- correction and transfer history separation;
- no internal-language leakage on normal screens;
- reload during draft, input, QR transfer, and ACK flow.

Before production use, repeat on the actual target phones/tablets, scan printed/on-screen QRs, disable network interfaces physically, and record device/browser results in execution notes.

- [ ] **Step 6: Self-review against the design spec**

Run these scans:

```bash
rg -n "ScoringSession|CourtRun|Result|Revision|ConfigVersion|inputSchemaId" src/app --glob '*.tsx'
rg -n "TODO|FIXME|placeholder|not implemented" src docs/superpowers/execution-notes
rg -n "courtStations|resultEntryPolicies|methodKey|configVersionId" src/config src/domain src/db src/transfer src/app
```

Review every match. Internal-language matches are allowed only in detailed management, diagnostics, types, tests, or developer errors not shown by normal UI.

- [ ] **Step 7: Request code review and verify before completion**

Use `superpowers:requesting-code-review` and resolve findings with `superpowers:receiving-code-review`. Then use `superpowers:verification-before-completion`; re-run complete verification after any change and before making a completion claim.

- [ ] **Step 8: Commit final integration evidence**

```bash
git add -- src/integration/event-day-rehearsal.test.ts src/integration/tournament-operations-ux-rehearsal.test.ts src/backup/backup-schema.ts src/backup/backup-schema.test.ts src/backup/backup-service.test.ts src/backup/restore-service.test.ts docs/superpowers/execution-notes/2026-08-23-tournament-operations-ux-redesign.md
git commit -m "test: verify offline tournament operations flow"
```

---

## Final Acceptance Checklist

- [ ] An unfamiliar operator can create the exchange festival from standard or previous settings without seeing internal IDs or enum/schema terminology.
- [ ] Host sets a default input method and the exact methods allowed for day-of-operation overrides.
- [ ] Every allowed method passes the same representative projection and award-scoring regression.
- [ ] Applied settings open a purpose-based settings home, not the creation wizard or raw editor.
- [ ] Every configured Court has a reusable Court-only QR, optional competition+Court QR, and an equal manual-selection path.
- [ ] A Court device persists its assignment until explicit change and explains invalid/stale assignments without silently clearing them.
- [ ] The next assigned unfinished task appears first by configured order; planned time is auxiliary.
- [ ] DETAIL, SCORE, OUTCOME, TIME, and RANK screens show only their required fields and preview Japanese rank/outcome before save.
- [ ] A per-task method override resets to the Host default on the next task.
- [ ] Corrections retain the original method by default and always create a new immutable Revision.
- [ ] Transfer and Host scoring resolve the method/schema from the Revision's immutable ConfigVersion.
- [ ] Same-task input on two devices creates one logical Result with a visible conflict, never two award-scoring entries.
- [ ] Task cards distinguish unsent, QR created, ACK waiting, complete, and correction-required states.
- [ ] Config activation cannot discard an in-progress Court draft.
- [ ] Setup, distribution, assignment, entry, transfer, scoring, conflict handling, and ACK all work without a network.
- [ ] Full tests, typecheck, build, browser phone-width checks, and physical-device offline rehearsal are recorded as passing.
