# Tournament Setup Wizard and Settings Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Host tournament configuration raw editor with an autosaved guided setup wizard and post-creation settings home while preserving the existing `TournamentConfigSnapshot`, ConfigVersion, scoring regression, QR, result/revision, and backup semantics.

**Architecture:** New tournaments are edited as a human-oriented `TournamentSetupDraft` persisted in `localSettings`, then compiled once through `compileTournamentSetup()` into the existing `TournamentConfigSnapshot`. Existing tournaments are edited through a full-snapshot `ConfigEditDraft`; changes are classified and impact-checked automatically before the existing validation/regression/apply path creates a new ConfigVersion.

**Tech Stack:** React, TypeScript, Material UI, Dexie/IndexedDB, Zod, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-tournament-setup-wizard-design.md`

## Global Constraints

- Formal Design v1.0 remains normative for scoring, Result/Revision, QR transfer, backup/restore, and offline operation.
- Do not change `TournamentConfigSnapshot` as part of the UX rewrite unless an independently justified compatibility requirement is discovered.
- Do not expose internal IDs, input schema keys, or raw enum values in the normal Host configuration UI.
- New tournament drafts must not create/apply a ConfigVersion before the final apply action.
- Draft persistence must remain fully local/offline.
- Do not add cloud services, CDN dependencies, authentication, or online template fetching.
- Existing Result/Revision data must never be destructively rewritten by configuration editing.
- Scoring rule changes must continue through the existing regression/test approval safety path.
- `ERROR` blocks apply; `WARNING` may proceed only after explicit acknowledgement.
- Use TDD for every task: RED → GREEN → REFACTOR.
- Before implementation, re-read current `main`; `ca99b8169476414fb881198252c94617010aad90` is planning context, not a fixed future execution baseline.

---

## File structure locked by this plan

### New configuration/setup domain files

- `src/config/setup/setup-types.ts` — setup/edit draft types and UI-safe semantic enums.
- `src/config/setup/setup-draft-repository.ts` — localSettings persistence and stale edit-draft checks.
- `src/config/setup/template-schema.ts` — Zod schema/parser for built-in and imported setup templates.
- `src/config/setup/builtin-templates.ts` — registry for four generic templates plus bundled event templates.
- `src/config/setup/setup-compiler.ts` — compile human-oriented setup draft to `TournamentConfigSnapshot`.
- `src/config/setup/setup-validation.ts` — wizard-level, human-targeted validation and issue navigation.
- `src/config/setup/config-change-classifier.ts` — infer existing `ConfigChangeClass`.
- `src/config/setup/config-change-impact.ts` — detect dangerous changes against existing Results.

### New Host UI files

- `src/app/tournament-setup/TournamentConfigWorkspace.tsx` — top-level Host CONFIG workspace/router.
- `src/app/tournament-setup/TournamentSetupWizard.tsx` — wizard state orchestration and autosave status.
- `src/app/tournament-setup/SetupProgress.tsx`
- `src/app/tournament-setup/BasicStep.tsx`
- `src/app/tournament-setup/TeamsStep.tsx`
- `src/app/tournament-setup/TemplateStep.tsx`
- `src/app/tournament-setup/CompetitionStep.tsx`
- `src/app/tournament-setup/CompetitionQuickEditor.tsx`
- `src/app/tournament-setup/CompetitionAdvancedEditor.tsx`
- `src/app/tournament-setup/ScheduleStep.tsx`
- `src/app/tournament-setup/ScheduleGridEditor.tsx`
- `src/app/tournament-setup/ScoringReviewStep.tsx`
- `src/app/tournament-setup/CourtInputPreview.tsx`
- `src/app/tournament-setup/FinalCheckStep.tsx`
- `src/app/tournament-settings/TournamentSettingsHome.tsx`
- `src/app/tournament-settings/TournamentSettingsEditor.tsx`
- `src/app/tournament-settings/SettingsSummaryCard.tsx`

### Existing files expected to change

- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/app/TournamentConfigEditor.tsx`
- `src/app/TournamentConfigEditorBase.tsx` (remove from normal render path; delete only after parity is proven)
- `src/index.css` only for layout rules not expressible cleanly with existing MUI props
- existing config tests where regression contract assertions are shared

---

### Task 1: Define setup drafts and persist them safely

**Files:**
- Create: `src/config/setup/setup-types.ts`
- Create: `src/config/setup/setup-draft-repository.ts`
- Create: `src/config/setup/setup-draft-repository.test.ts`

**Interfaces:**
- Produces:
  - `TournamentSetupDraft`
  - `ConfigEditDraft`
  - `SetupStep`
  - `SetupDraftRepository`
  - `SETUP_DRAFT_KEY = 'host.tournamentSetupDraft.v1'`
  - `configEditDraftKey(tournamentId)`

- [ ] **Step 1: Write failing persistence tests**

Cover:
1. setup draft save/load round-trip through fake IndexedDB.
2. clearing setup draft removes only that `localSettings` key.
3. config edit draft key is tournament-scoped.
4. loading an edit draft with a different active `configVersionId` returns a stale result instead of a usable draft.
5. setup and edit drafts survive closing/reopening the Dexie database.

- [ ] **Step 2: Run the focused test**

Run:

```bash
npm run test:run -- src/config/setup/setup-draft-repository.test.ts
```

Expected: FAIL because setup types/repository do not exist.

- [ ] **Step 3: Implement the types**

Use exact public shapes:

```ts
export type SetupStep =
  | 'BASIC'
  | 'TEAMS'
  | 'TEMPLATES'
  | 'COMPETITIONS'
  | 'SCHEDULE'
  | 'SCORING_REVIEW'
  | 'FINAL_CHECK'

export interface ConfigEditDraft {
  draftFormatVersion: 1
  tournamentId: TournamentId
  baseConfigVersionId: string
  baseConfigVersion: number
  createdAt: string
  updatedAt: string
  snapshot: TournamentConfigSnapshot
}
```

Define `TournamentSetupDraft` with tournament, teams, templateSource, competitions, timestamps and currentStep as specified by the design.

- [ ] **Step 4: Implement persistence over `AppDatabase.localSettings`**

Repository methods:

```ts
loadSetupDraft(): Promise<TournamentSetupDraft | undefined>
saveSetupDraft(draft: TournamentSetupDraft): Promise<void>
clearSetupDraft(): Promise<void>
loadEditDraft(
  tournamentId: TournamentId,
  activeConfigVersionId: string,
): Promise<
  | { status: 'NONE' }
  | { status: 'READY'; draft: ConfigEditDraft }
  | { status: 'STALE'; draft: ConfigEditDraft }
>
saveEditDraft(draft: ConfigEditDraft): Promise<void>
clearEditDraft(tournamentId: TournamentId): Promise<void>
```

Always structured-clone on read/write boundaries.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Run existing backup tests**

```bash
npm run test:run -- src/backup/backup-schema.test.ts src/backup/backup-service.test.ts src/backup/restore-service.test.ts
```

Expected: PASS; no backup schema change is required because `localSettings` is already backed up.

- [ ] **Step 7: Commit**

```bash
git add -- src/config/setup/setup-types.ts src/config/setup/setup-draft-repository.ts src/config/setup/setup-draft-repository.test.ts
git commit -m "feat: add persisted tournament setup drafts"
```

---

### Task 2: Add versioned template parsing and four generic templates

**Files:**
- Create: `src/config/setup/template-schema.ts`
- Create: `src/config/setup/template-schema.test.ts`
- Create: `src/config/setup/builtin-templates.ts`
- Create: `src/config/setup/builtin-templates.test.ts`

**Interfaces:**
- Produces:
  - `TournamentSetupTemplateFile`
  - `CompetitionSetupTemplate`
  - `parseTournamentSetupTemplate(value: unknown)`
  - `GENERIC_SETUP_TEMPLATES`

- [ ] **Step 1: Write failing parser tests**

Assert that the parser:
- accepts `templateFormatVersion: 1`.
- rejects unknown format version.
- rejects duplicate competition template keys.
- rejects unsupported competition kind.
- rejects zero/negative rounds and courts.
- rejects invalid rank point values.
- rejects unsupported input/scoring combinations.

- [ ] **Step 2: Write failing built-in template tests**

Require exactly these generic template IDs:

```text
generic-ranking-v1
generic-time-v1
generic-quantity-v1
generic-win-loss-v1
```

Each must parse through the same schema used for imported files.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
npm run test:run -- src/config/setup/template-schema.test.ts src/config/setup/builtin-templates.test.ts
```

- [ ] **Step 4: Implement the Zod template schema**

Use UI-semantic values such as:

```ts
type SetupCompetitionKind = 'RANKING' | 'TIME' | 'QUANTITY' | 'WIN_LOSS'
type SetupInputGrouping = 'PER_COURT' | 'WHOLE_ROUND' | 'CUSTOM_GROUP'
type SetupRankingDirection = 'HIGHER' | 'LOWER' | 'MANUAL'
```

Do not expose domain enum strings as imported-template authoring requirements.

- [ ] **Step 5: Implement four generic templates**

Defaults:

- Ranking: manual rank, 1 group/team, 1 round, 1 court.
- Time: time manual default, lower-is-better, 1 group/team.
- Quantity: numeric measurement, higher-is-better, 1 group/team.
- Win/Loss: win-loss input, 1 group/team.

Do not invent event-specific points in generic templates; rank points begin empty and therefore force explicit scoring confirmation.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/config/setup/template-schema.ts src/config/setup/template-schema.test.ts src/config/setup/builtin-templates.ts src/config/setup/builtin-templates.test.ts
git commit -m "feat: add tournament setup templates"
```

---

### Task 3: Compile setup drafts into the existing domain model

**Files:**
- Create: `src/config/setup/setup-compiler.ts`
- Create: `src/config/setup/setup-compiler.test.ts`
- Read/Reuse: `src/config/tournament-config.ts`
- Read/Reuse: `src/domain/tournament.ts`
- Read/Reuse: `src/config/input-schema.ts`

**Interfaces:**
- Produces:

```ts
export interface SetupCompilerOptions {
  createId: <T extends string>() => T
}

export function compileTournamentSetup(
  draft: TournamentSetupDraft,
  options?: Partial<SetupCompilerOptions>,
): TournamentConfigSnapshot
```

- [ ] **Step 1: Write a failing QUANTITY compile test**

Input: four teams, one quantity competition, four courts, one round, `WHOLE_ROUND`.

Expected output:
- 1 Tournament
- 4 Teams
- 1 Competition
- 4 CompetitionEntries
- 1 ScheduleSlot
- 4 CourtRuns
- 1 ScoringSession
- ScoringSession references all 4 CourtRuns
- ScoringSession `inputScope === 'WHOLE_SLOT'`
- NUMBER InputSchema
- higher-is-better ScoringProfile

- [ ] **Step 2: Write failing mapping tests for all generic kinds**

Require:
- `RANKING` → rank-compatible input/scoring.
- `TIME` → time-compatible input/scoring and lower-is-better.
- `QUANTITY` → NUMBER input.
- `WIN_LOSS` → WIN_LOSS input.
- groupsPerTeam=2 produces two CompetitionEntries per Team.
- `PER_COURT` produces one scoring session per court-run unit.
- custom grouping produces only explicitly selected grouped sessions.

- [ ] **Step 3: Run RED**

```bash
npm run test:run -- src/config/setup/setup-compiler.test.ts
```

- [ ] **Step 4: Implement the compiler as pure transformations**

Keep helpers focused:

```ts
compileTeams()
compileCompetitionEntries()
compileSchedule()
compileInputSchema()
compileScoringProfile()
```

The compiler must not access IndexedDB or React state.

- [ ] **Step 5: Validate compiler output using existing validator in tests**

Every valid fixture must satisfy:

```ts
validateTournamentConfig(snapshot)
  .filter((issue) => issue.severity === 'ERROR')
```

equals `[]`.

- [ ] **Step 6: Run tests**

```bash
npm run test:run -- src/config/setup/setup-compiler.test.ts src/config/tournament-config.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/config/setup/setup-compiler.ts src/config/setup/setup-compiler.test.ts
git commit -m "feat: compile setup drafts to tournament config"
```

---

### Task 4: Build human-targeted setup validation and issue navigation

**Files:**
- Create: `src/config/setup/setup-validation.ts`
- Create: `src/config/setup/setup-validation.test.ts`

**Interfaces:**
- Produces:

```ts
export interface SetupIssue {
  severity: 'ERROR' | 'WARNING'
  code: string
  message: string
  step: SetupStep
  competitionKey?: string
}

export function validateSetupDraft(draft: TournamentSetupDraft): SetupIssue[]
export function mapConfigIssuesToSetupIssues(
  draft: TournamentSetupDraft,
  issues: ConfigValidationIssue[],
): SetupIssue[]
```

- [ ] **Step 1: Write failing tests for missing data and navigation**

Examples:
- blank tournament name → BASIC.
- zero teams → TEAMS.
- competition without scoring confirmation → SCORING_REVIEW.
- court assignment missing → SCHEDULE.
- domain validation issue associated with one competition returns COMPETITIONS or SCORING_REVIEW and includes its display name.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement setup validation and translation**

Do not render raw `UNKNOWN_*` or enum values as the primary message.

- [ ] **Step 4: Run tests**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- src/config/setup/setup-validation.ts src/config/setup/setup-validation.test.ts
git commit -m "feat: add human friendly setup validation"
```

---

### Task 5: Implement wizard shell, autosave, resume, and team setup

**Files:**
- Create: `src/app/tournament-setup/TournamentSetupWizard.tsx`
- Create: `src/app/tournament-setup/TournamentSetupWizard.test.tsx`
- Create: `src/app/tournament-setup/SetupProgress.tsx`
- Create: `src/app/tournament-setup/BasicStep.tsx`
- Create: `src/app/tournament-setup/TeamsStep.tsx`

**Interfaces:**
- Consumes `SetupDraftRepository`.
- Produces UI events `onCancel`, `onReadyToApply(snapshot, draft)` in later tasks.

- [ ] **Step 1: Write failing UI tests**

Verify:
- first screen shows seven-step progress without internal model terms.
- entering tournament name autosaves.
- reload/remount resumes persisted step/data.
- team count 4 creates `1組` through `4組`.
- generated names are editable.
- changing team count preserves existing manually renamed teams where possible.
- failed save shows `保存に失敗` and never `保存済み`.

- [ ] **Step 2: Run RED**

```bash
npm run test:run -- src/app/tournament-setup/TournamentSetupWizard.test.tsx
```

- [ ] **Step 3: Implement wizard state and save status**

Use MUI `Stepper`, form controls, `Alert`, and status text.

Persist every semantic draft update. Serialize writes so an older async save cannot overwrite a newer draft.

- [ ] **Step 4: Implement Basic and Teams steps**

No domain IDs or internal enums appear in labels.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/app/tournament-setup/TournamentSetupWizard.tsx src/app/tournament-setup/TournamentSetupWizard.test.tsx src/app/tournament-setup/SetupProgress.tsx src/app/tournament-setup/BasicStep.tsx src/app/tournament-setup/TeamsStep.tsx
git commit -m "feat: add autosaved tournament setup wizard"
```

---

### Task 6: Add template selection, imported templates, and competition quick editing

**Files:**
- Create: `src/app/tournament-setup/TemplateStep.tsx`
- Create: `src/app/tournament-setup/TemplateStep.test.tsx`
- Create: `src/app/tournament-setup/CompetitionStep.tsx`
- Create: `src/app/tournament-setup/CompetitionQuickEditor.tsx`
- Create: `src/app/tournament-setup/CompetitionAdvancedEditor.tsx`
- Test: `src/app/tournament-setup/CompetitionStep.test.tsx`
- Modify: `src/app/tournament-setup/TournamentSetupWizard.tsx`

**Interfaces:**
- Template import uses `parseTournamentSetupTemplate`.
- Competition editor updates only `SetupCompetitionDraft`.

- [ ] **Step 1: Write failing tests for the two entry paths**

Verify:
- event template list and generic template list are distinct visually.
- selecting an event template checks all competitions by default.
- deselecting a competition excludes it from the draft.
- importing valid JSON adds it to selectable templates for the current device.
- invalid JSON/template shows validation error and does not alter the active draft.

- [ ] **Step 2: Write failing quick-editor tests**

For QUANTITY, verify the user edits:
- value label.
- higher/lower.
- groups per team.
- per-court/whole-round.

Assert the UI never shows `WHOLE_SLOT`, `PER_COURT`, `InputSchema`, `CompetitionEntry`, or `ScoringSession`.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Implement TemplateStep and import flow**

Imported template files are local-only and validated before registry insertion.

- [ ] **Step 5: Implement quick and advanced competition editors**

Advanced UI may expose:
- tie handling
- aggregation
- input bounds
- rank points
- custom grouped courts

but must still use human-language labels.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/tournament-setup/TemplateStep.tsx src/app/tournament-setup/TemplateStep.test.tsx src/app/tournament-setup/CompetitionStep.tsx src/app/tournament-setup/CompetitionQuickEditor.tsx src/app/tournament-setup/CompetitionAdvancedEditor.tsx src/app/tournament-setup/CompetitionStep.test.tsx src/app/tournament-setup/TournamentSetupWizard.tsx
git commit -m "feat: add guided competition templates"
```

---

### Task 7: Add schedule/court auto-assignment and grid editing

**Files:**
- Create: `src/config/setup/schedule-assignment.ts`
- Create: `src/config/setup/schedule-assignment.test.ts`
- Create: `src/app/tournament-setup/ScheduleStep.tsx`
- Create: `src/app/tournament-setup/ScheduleGridEditor.tsx`
- Create: `src/app/tournament-setup/ScheduleStep.test.tsx`
- Modify: `src/app/tournament-setup/TournamentSetupWizard.tsx`

**Interfaces:**
- Produces:

```ts
export function autoAssignCompetitionSchedule(
  competition: SetupCompetitionDraft,
  teams: SetupTeamDraft[],
): SetupCompetitionSchedule
```

- [ ] **Step 1: Write failing pure assignment tests**

Cover:
- 4 teams / 4 courts / 1 round.
- 4 teams with 2 groups each / 4 courts / 2 rounds.
- fewer entries than courts leaves unused cells rather than duplicating participants.
- auto assignment is deterministic.
- whole-round input groups all court cells in a round.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement deterministic assignment**

Do not silently assign the same entry twice in one logical round unless the draft explicitly requests it.

- [ ] **Step 4: Write failing UI tests**

Verify:
- default screen asks only rounds, court count, input grouping.
- generated table is readable.
- “時程を編集” reveals times and cell assignments.
- small viewport uses an accessible scroll region.

- [ ] **Step 5: Implement schedule UI**

- [ ] **Step 6: Run tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/config/setup/schedule-assignment.ts src/config/setup/schedule-assignment.test.ts src/app/tournament-setup/ScheduleStep.tsx src/app/tournament-setup/ScheduleGridEditor.tsx src/app/tournament-setup/ScheduleStep.test.tsx src/app/tournament-setup/TournamentSetupWizard.tsx
git commit -m "feat: add guided court schedule setup"
```

---

### Task 8: Add scoring review, court-input preview, and final compile check

**Files:**
- Create: `src/app/tournament-setup/ScoringReviewStep.tsx`
- Create: `src/app/tournament-setup/CourtInputPreview.tsx`
- Create: `src/app/tournament-setup/FinalCheckStep.tsx`
- Create: `src/app/tournament-setup/FinalCheckStep.test.tsx`
- Modify: `src/app/tournament-setup/TournamentSetupWizard.tsx`
- Reuse: `src/app/ScoringSimulatorPanel.tsx`

**Interfaces:**
- Wizard final check compiles exactly one snapshot for the current draft revision and passes the same object into validation/regression/apply.

- [ ] **Step 1: Write failing preview tests**

Verify quantity, time, ranking and win/loss competitions render an operator-facing sample input without internal field keys.

- [ ] **Step 2: Write failing final-check tests**

Verify:
- summary rows show tournament/team/competition/schedule/scoring counts.
- ERROR disables apply.
- WARNING requires explicit acknowledgement.
- “修正する” navigates to the correct step/competition.
- compile/domain validation errors are translated to human messages.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Implement scoring review and preview**

Keep actual scoring simulation delegated to existing scoring services where applicable.

- [ ] **Step 5: Implement final-check compile lifecycle**

Pseudo-flow:

```ts
const snapshot = compileTournamentSetup(draft)
const domainIssues = validateTournamentConfig(snapshot)
const setupIssues = [
  ...validateSetupDraft(draft),
  ...mapConfigIssuesToSetupIssues(draft, domainIssues),
]
```

Do not call repository `apply()` when any ERROR exists.

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/tournament-setup/ScoringReviewStep.tsx src/app/tournament-setup/CourtInputPreview.tsx src/app/tournament-setup/FinalCheckStep.tsx src/app/tournament-setup/FinalCheckStep.test.tsx src/app/tournament-setup/TournamentSetupWizard.tsx
git commit -m "feat: add setup review and final validation"
```

---

### Task 9: Preserve the existing scoring regression gate during apply

**Files:**
- Create: `src/app/tournament-setup/tournament-config-apply-service.ts`
- Create: `src/app/tournament-setup/tournament-config-apply-service.test.ts`
- Modify: `src/app/TournamentConfigEditor.tsx` only to extract/reuse existing regression behavior without changing its semantics.

**Interfaces:**
- Produces:

```ts
export interface TournamentConfigApplyService {
  preview(snapshot: TournamentConfigSnapshot): Promise<ConfigApplyPreview>
  applyApproved(input: ApprovedConfigApply): Promise<ConfigApplyResult>
}
```

- [ ] **Step 1: Port current regression-gate cases into service tests**

Cases:
- INVALID scoring test blocks.
- FAIL scoring test requires explicit per-test approval.
- scoring profile change with no failure still stages review when required by current semantics.
- valid unchanged scoring applies.
- approval metadata records operator/time/fingerprint exactly as existing behavior.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Extract behavior into the apply service**

Do not weaken the current gate.

- [ ] **Step 4: Wire FinalCheckStep to the service**

The user sees human-language review, but the underlying approval fingerprints and ConfigRepository behavior remain unchanged.

- [ ] **Step 5: Run both old and new regression tests**

```bash
npm run test:run -- src/app/TournamentConfigEditor.test.tsx src/app/tournament-setup/tournament-config-apply-service.test.ts src/app/tournament-setup/FinalCheckStep.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/app/tournament-setup/tournament-config-apply-service.ts src/app/tournament-setup/tournament-config-apply-service.test.ts src/app/TournamentConfigEditor.tsx src/app/tournament-setup/FinalCheckStep.tsx src/app/tournament-setup/FinalCheckStep.test.tsx
git commit -m "refactor: preserve scoring regression gate in setup flow"
```

---

### Task 10: Infer change class and analyze dangerous post-result edits

**Files:**
- Create: `src/config/setup/config-change-classifier.ts`
- Create: `src/config/setup/config-change-classifier.test.ts`
- Create: `src/config/setup/config-change-impact.ts`
- Create: `src/config/setup/config-change-impact.test.ts`

**Interfaces:**
- Produces:

```ts
export function classifyConfigChange(
  base: TournamentConfigSnapshot,
  next: TournamentConfigSnapshot,
): ConfigChangeClass

export function analyzeConfigChangeImpact(
  base: TournamentConfigSnapshot,
  next: TournamentConfigSnapshot,
  results: Result[],
): ConfigImpactIssue[]
```

- [ ] **Step 1: Write failing classifier tests**

Require:
- only name/date/display label change → DISPLAY_ONLY.
- schedule/court/session change → SCHEDULE.
- scoring profile/test or team/competition/entry structure change → SCORING.
- input schema change → INPUT_SCHEMA.
- mixed change follows priority `INPUT_SCHEMA > SCORING > SCHEDULE > DISPLAY_ONLY`.

- [ ] **Step 2: Write failing impact tests**

Require blocking issues for:
- deleting a Competition referenced by Result.
- deleting a ScoringSession referenced by Result.

Require a warning for schedule metadata changes that preserve referenced IDs.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Implement pure diff functions**

Do not mutate snapshots/results.

- [ ] **Step 5: Run tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/config/setup/config-change-classifier.ts src/config/setup/config-change-classifier.test.ts src/config/setup/config-change-impact.ts src/config/setup/config-change-impact.test.ts
git commit -m "feat: classify and safety check config edits"
```

---

### Task 11: Build the post-creation Tournament Settings Home

**Files:**
- Create: `src/app/tournament-settings/TournamentSettingsHome.tsx`
- Create: `src/app/tournament-settings/TournamentSettingsHome.test.tsx`
- Create: `src/app/tournament-settings/TournamentSettingsEditor.tsx`
- Create: `src/app/tournament-settings/SettingsSummaryCard.tsx`
- Modify: competition/schedule editor components to support `ConfigEditDraft` adapters where needed.

**Interfaces:**
- Consumes active `TournamentConfigSnapshot`, `ConfigEditDraft`, change classifier, impact analyzer, apply service.

- [ ] **Step 1: Write failing home tests**

Verify cards:
- 基本情報
- チーム
- 競技
- 時程・コート
- 得点・入力
- コート端末へ配布
- 設定チェック

Show summary values and “未適用の変更あり” when edit draft differs.

- [ ] **Step 2: Write failing edit lifecycle tests**

Verify:
- edit starts from active snapshot clone.
- changes autosave.
- “変更を破棄” clears only edit draft.
- stale base version blocks resume/apply.
- inferred changeClass is used; no UI field asks the operator to select it.
- impact ERROR blocks apply.
- successful apply creates a new ConfigVersion then clears edit draft.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Implement settings home and editor orchestration**

Reuse the same human-language competition/schedule/scoring controls, but adapt them to a full snapshot rather than `TournamentSetupDraft`.

- [ ] **Step 5: Run focused tests**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/app/tournament-settings/TournamentSettingsHome.tsx src/app/tournament-settings/TournamentSettingsHome.test.tsx src/app/tournament-settings/TournamentSettingsEditor.tsx src/app/tournament-settings/SettingsSummaryCard.tsx src/app/tournament-setup/CompetitionQuickEditor.tsx src/app/tournament-setup/CompetitionAdvancedEditor.tsx src/app/tournament-setup/ScheduleGridEditor.tsx
git commit -m "feat: add tournament settings home"
```

---

### Task 12: Integrate the workspace into Host mode and remove the raw editor path

**Files:**
- Create: `src/app/tournament-setup/TournamentConfigWorkspace.tsx`
- Create: `src/app/tournament-setup/TournamentConfigWorkspace.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify/Delete after parity: `src/app/TournamentConfigEditorBase.tsx`
- Modify: `src/app/TournamentConfigEditor.tsx`

**Interfaces:**
- Workspace states:
  - no active tournament + no setup draft → create/start screen.
  - setup draft → resume wizard.
  - active tournament → settings home.
  - active tournament + edit draft → settings home with unsaved-change indicator/editor resume.

- [ ] **Step 1: Write failing workspace state tests**

Cover all four states above.

- [ ] **Step 2: Write failing App integration test**

Host → 大会設定 must render `TournamentConfigWorkspace`, not the raw `TournamentConfigEditorBase` form.

Assert internal labels such as `項目キー`, `PER_COURT`, `WHOLE_SLOT`, `ScoringSession` are not present in the normal initial Host CONFIG screen.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Implement workspace routing**

Keep `ConfigFilePanel` and `ConfigUpdatePanel` available from the settings workspace as separate import/distribution capabilities.

- [ ] **Step 5: Remove raw editor from normal navigation**

If all functionality required by this spec is covered, delete `TournamentConfigEditorBase.tsx` and its raw-editor-only tests. If helper behavior remains useful, extract it into domain/pure helpers first; do not retain a hidden unsafe “escape hatch” reachable from production UI.

- [ ] **Step 6: Run App/UI tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/tournament-setup/TournamentConfigWorkspace.tsx src/app/tournament-setup/TournamentConfigWorkspace.test.tsx src/app/App.tsx src/app/App.test.tsx src/app/TournamentConfigEditor.tsx src/app/TournamentConfigEditorBase.tsx
git commit -m "feat: replace raw tournament config editor"
```

If `TournamentConfigEditorBase.tsx` is deleted, stage it with its exact path using `git add -- src/app/TournamentConfigEditorBase.tsx`.

---

### Task 13: Bundle and validate the authoritative event template without hardcoding engine rules

**Files:**
- Create: `src/config/setup/templates/kaisei-2026.template.json`
- Create: `src/config/setup/templates/kaisei-2026.template.test.ts`
- Modify: `src/config/setup/builtin-templates.ts`
- Read authoritative current-year config/rules present in the execution baseline.

**Interfaces:**
- The bundled template must pass `parseTournamentSetupTemplate`.
- Compiling the template with the standard four-team setup must produce a config equivalent in competition semantics to the authoritative 2026 configuration source.

- [ ] **Step 1: Re-verify the authoritative 2026 source before copying values**

At execution time, locate the authoritative 2026 configuration artifact on current `main`/approved source. Do not derive final values from last-year schedules or scoring sheets.

- [ ] **Step 2: Write the failing template validation test**

The test must assert:
- `templateFormatVersion === 1`.
- expected event year is 2026.
- all authoritative competitions are represented exactly once.
- every competition compiles without `validateTournamentConfig()` ERROR.
- known normative examples (including the current approved 台風の目 configuration) match the authoritative source.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Create the template by transcription from the authoritative source**

The JSON contains configuration data, not special-case scoring code.

- [ ] **Step 5: Register it as a built-in event template**

- [ ] **Step 6: Run focused tests**

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/config/setup/templates/kaisei-2026.template.json src/config/setup/templates/kaisei-2026.template.test.ts src/config/setup/builtin-templates.ts
git commit -m "feat: add 2026 event setup template"
```

---

### Task 14: Verify backup/restore, reload, and offline behavior with drafts

**Files:**
- Modify: `src/backup/disaster-recovery.integration.test.ts`
- Modify: `src/app/App.test.tsx`
- Add integration test if clearer: `src/integration/tournament-setup-lifecycle.integration.test.ts`

- [ ] **Step 1: Write a failing setup-draft recovery integration test**

Flow:
1. create setup draft.
2. save to localSettings.
3. create Host backup.
4. clear database.
5. restore backup.
6. reopen app.
7. verify setup draft resumes with exact values.

- [ ] **Step 2: Write a failing active-config + edit-draft restore test**

After restore, edit draft must be usable only when `baseConfigVersionId` matches restored active ConfigVersion.

- [ ] **Step 3: Run RED**

- [ ] **Step 4: Make only necessary recovery integration changes**

Do not change backup format if existing `localSettings` transport already satisfies the tests.

- [ ] **Step 5: Run backup/recovery suite**

```bash
npm run test:run -- src/backup src/integration/tournament-setup-lifecycle.integration.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- src/backup/disaster-recovery.integration.test.ts src/app/App.test.tsx src/integration/tournament-setup-lifecycle.integration.test.ts
git commit -m "test: cover tournament setup recovery"
```

---

### Task 15: Full regression, accessibility smoke checks, and cleanup

**Files:**
- Modify only files required by failures found in verification.
- Update/add documentation under the same feature branch if user-facing operator instructions exist.

- [ ] **Step 1: Run all unit/integration tests**

```bash
npm run test:run
```

Expected: all PASS.

- [ ] **Step 2: Run TypeScript**

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 3: Build production bundle**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 4: Run targeted manual/browser rehearsal**

On Chrome-class desktop plus iPad/Safari where available:

1. start a new tournament.
2. enter tournament/date.
3. create four teams.
4. select 2026 event template.
5. deselect one competition and re-add a generic competition.
6. configure a whole-round four-court quantity competition.
7. reload mid-wizard and confirm resume.
8. finish final check and apply.
9. verify settings home.
10. modify scoring, verify regression gate.
11. discard a second edit and confirm active Config unchanged.
12. export Host backup, reset, restore, verify active config/drafts.
13. go offline and repeat reload + settings navigation.

- [ ] **Step 5: Verify wording audit**

Search production UI code for raw configuration jargon that must not appear in normal Host setup:

```bash
grep -R "WHOLE_SLOT\|PER_COURT\|CUSTOM_GROUP\|ScoringSession\|CompetitionEntry\|項目キー" src/app
```

Review each match. Domain/test/internal mapping code may contain the terms; normal user-visible strings must not.

- [ ] **Step 6: Verify no accidental protocol/domain changes**

Review diff for:
- transfer protocol types
- Result/Revision semantics
- backup format version
- database schema version
- scoring engine arithmetic

Any unrelated change must be reverted or split into a separately approved task.

- [ ] **Step 7: Final commit if verification required code/doc cleanup**

Stage only exact changed paths, then:

```bash
git commit -m "chore: finalize tournament setup UX"
```

---

## Plan self-review

### Spec coverage

- Setup draft/autosave/resume: Tasks 1, 5, 14.
- Generic + event + imported templates: Tasks 2, 6, 13.
- Draft → existing Config compiler: Task 3.
- Human validation/fix navigation: Tasks 4, 8.
- Teams auto-generation: Task 5.
- 2–4 question competition setup + advanced: Task 6.
- Schedule/court auto-generation and table editor: Task 7.
- Input/scoring preview: Task 8.
- Existing regression gate: Task 9.
- Auto changeClass and result-aware safety: Task 10.
- Post-create settings home/edit draft: Task 11.
- Raw editor replacement: Task 12.
- Backup/recovery/offline: Task 14.
- Full acceptance/regression: Task 15.

### Type consistency

Primary cross-task interfaces are fixed in Tasks 1–4 and reused by later tasks:
- `TournamentSetupDraft`
- `ConfigEditDraft`
- `SetupDraftRepository`
- `TournamentSetupTemplateFile`
- `compileTournamentSetup()`
- `SetupIssue`
- `classifyConfigChange()`
- `analyzeConfigChangeImpact()`

### Execution ordering

Tasks 1–4 are domain foundation. Tasks 5–8 build the new-tournament UX. Task 9 connects existing safety semantics. Tasks 10–12 add post-create editing and replace the old production path. Task 13 injects authoritative current-year data only after the generic mechanism is green. Tasks 14–15 validate disaster recovery, offline behavior, and full regressions.
