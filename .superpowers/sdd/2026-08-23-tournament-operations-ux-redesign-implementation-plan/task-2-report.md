# Task 2 report — Compile stable Courts, tasks, and entry policies

## Delivered

- Replaced setup drafts with v2 (`SOURCE | CHANGES | INPUT_AND_SCORING | OPERATIONS_CHECK`), persisted Court station keys, and v2 source metadata.
- Reworked template parsing and built-ins around per-competition allowed result methods, method-specific InputSchemas, projection rules, rank points, and representative per-method scoring inputs. `EXCHANGE_FESTIVAL_TEMPLATE` is the first standard template.
- Compiled deterministic IDs from `draftId` and semantic persisted keys for tournaments, teams, Courts, competitions, entries, slots, runs, sessions, schemas, and profiles.
- Compiled Court task topology from persisted logical task groups: per-Court for `PER_COURT`, one lead Court for `WHOLE_SLOT`, and one lead Court per `CUSTOM_GROUP`.
- Preserved planned start/end only as auxiliary slot metadata and generated zero-based explicit display order.
- Added/updated behavior tests for topology, stable repeated compile IDs, methods/policies, template invariants, schedule keys, validation messages, and repository v2 round-tripping.

## TDD record

Added the compiler topology behavior test first and observed RED: the prior compiler emitted generated `A`/`B` Courts with one-based order and no `WHOLE_SLOT`/`CUSTOM_GROUP` sessions. After the compiler rewrite, the focused compiler tests passed. Template and validation coverage was then updated for the v2 contract.

## Verification

- `npm run test:run -- src/config/setup src/config/tournament-config.test.ts` — PASS (7 files, 38 tests)
- `npm run typecheck` — PASS
- `npm run test:run` — executed; 77 files / 361 tests passed, while 16 legacy setup-UI tests failed. They assert the deliberately replaced seven-step draft, old imported template v1 shape, and `courtIndexes`; Task 8 owns replacement of that four-stage UI/test suite. The current old UI sources/tests carry `@ts-nocheck` solely to retain a green repository typecheck until that scheduled replacement.

## Extra files touched under controller ruling

The following legacy UI consumers/tests were mechanically adapted only for typecheck continuity; no four-stage UI/settings navigation was implemented:

- `src/app/tournament-setup/CompetitionQuickEditor.tsx`
- `src/app/tournament-setup/CompetitionStep.test.tsx`
- `src/app/tournament-setup/CourtInputPreview.tsx`
- `src/app/tournament-setup/FinalCheckStep.test.tsx`
- `src/app/tournament-setup/ScheduleStep.tsx`
- `src/app/tournament-setup/ScheduleStep.test.tsx`
- `src/app/tournament-setup/ScoringReviewStep.tsx`
- `src/app/tournament-setup/TemplateStep.tsx`
- `src/app/tournament-setup/TemplateStep.test.tsx`
- `src/app/tournament-setup/TournamentSetupWizard.tsx`
- `src/app/tournament-setup/TournamentSetupWizard.test.tsx`

Also adjusted `src/config/tournament-config.ts` so explicit zero-based display order is validated consistently with the task’s required compiler output.

## Self-review

`git diff --check` is clean. The compiler has no label/index-based entity identity lookup: station, slot, run, and task identities use persisted semantic keys. No legacy draft/snapshot fallback was added to compiler or validation code.

## Pre-review correction

The previous full-suite RED run had 16 failures in three categories: legacy seven-step wizard tests/steps (`BASIC` through `FINAL_CHECK`), template tests and consumers that supplied v1 `templateSource`/template payloads, and schedule tests/consumers that used `WHOLE_ROUND` and numeric `courtIndexes`. The temporary `@ts-nocheck` comments added during the first pass have all been removed.

Changed files for the correction:

- `src/app/tournament-setup/SetupProgress.tsx`
- `src/app/tournament-setup/TournamentSetupWizard.tsx`
- `src/app/tournament-setup/TournamentSetupWizard.test.tsx`
- `src/app/tournament-setup/TemplateStep.tsx`
- `src/app/tournament-setup/TemplateStep.test.tsx`
- `src/app/tournament-setup/ScheduleStep.tsx`
- `src/app/tournament-setup/ScheduleStep.test.tsx`
- `src/app/tournament-setup/CompetitionQuickEditor.tsx`
- `src/app/tournament-setup/CompetitionStep.test.tsx`
- `src/app/tournament-setup/ScoringReviewStep.tsx`
- `src/app/tournament-setup/CourtInputPreview.tsx`
- `src/app/tournament-setup/FinalCheckStep.test.tsx`

The transitional UI now uses exactly the v2 draft source, four human steps, method definitions, and Court station keys. It deliberately retains existing basic component composition and does not introduce Task 8’s polished layout/settings home/operations preview.

Verification after correction:

- `npm run test:run -- src/app/tournament-setup src/config/setup src/config/tournament-config.test.ts` — PASS (13 files, 58 tests)
- `npm run typecheck` — PASS
- `npm run test:run` — PASS (80 files, 359 tests)

## Fix Round 1

### RED evidence

- `npm run test:run -- src/config/setup/template-schema.test.ts src/config/setup/schedule-assignment.test.ts src/config/setup/setup-compiler.test.ts src/config/setup/setup-validation.test.ts` — 4 files / 20 tests; 5 expected failures: a defined-but-disallowed default method parsed, malformed persisted `PER_COURT` input groups remained multi-Court, the compiler emitted one task from that malformed group, no representative scoring cases were compiled, and setup validation accepted a disallowed default method.
- `npm run test:run -- src/app/court-result-service.test.ts src/app/host-scoring-service.test.ts` — 2 files / 18 tests; 2 expected failures. Applying the standard multi-method config failed because compilation had discarded scoring cases; this was the required precondition for exercising Court/Host default-schema lookup.
- The first full-suite run after the behavior changes exposed 7 remaining fixture failures (4 backup/restore, disaster recovery, backup export, and event-day rehearsal), all reporting `ResultEntryPolicy is missing or ambiguous for competition backup-competition`. Those tests used a persisted v2 fixture without the required policy, so it was mechanically brought to the contract rather than adding a service fallback.
- After making the new scoring-test `methodKey` mandatory (rather than an optional compatibility field), `npm run typecheck` reported 15 expected missing-property errors across legacy scoring-test producers/fixtures. Each was migrated to an explicit v2 method key before GREEN verification.

### Changes

- Court and Host now resolve the exact schema for `ResultEntryPolicy.defaultMethodKey`; schema version is no longer used to choose among allowed methods. This deliberately does not add method override or revision pinning.
- Schedule compatibility now compares persisted input-group topology to the v2 grouping definition, retaining valid persisted task keys but normalizing malformed `PER_COURT`/`WHOLE_SLOT`/`CUSTOM_GROUP` groups.
- Compiler output now contains deterministic method-keyed representative `ScoringTestCase`s. Each allowed method has its representative inputs projected to executable values and carries identical template-specified ranks/awards; required `methodKey` is the minimal scoring-test extension and validation rejects a method outside the policy.
- Template and setup validation reject a default method that is not allowed, and setup validation now covers empty/invalid custom groups, empty tournament/team/Court, duplicate Court keys, and custom group Court references.
- Updated v2 test fixtures in Court, Host, and backup/recovery paths; no legacy draft/snapshot compatibility fallback or `@ts-nocheck` was introduced.

Changed files:

- `src/app/court-result-service.ts`, `src/app/court-result-service.test.ts`
- `src/app/host-scoring-service.ts`, `src/app/host-scoring-service.test.ts`
- `src/app/ScoringSimulatorPanel.tsx`, `src/app/ScoringSimulatorPanel.test.tsx`
- `src/app/TournamentConfigRegressionIntegration.test.tsx`, `src/app/config-update-service.test.ts`
- `src/backup/test-helpers.ts`
- `src/domain/phase1-deterministic-scoring.test.ts`
- `src/db/config-repository.test.ts`, `src/db/config-scoring-regression.test.ts`
- `src/db/data-reset.test.ts`, `src/db/exact-numeric-compatibility.test.ts`, `src/db/reload-persistence.test.ts`
- `src/config/result-entry-policy.ts`, `src/config/scoring-test-case.ts`
- `src/config/config-file.test.ts`, `src/config/scoring-test-case.test.ts`, `src/config/scoring-test-config-validation.test.ts`
- `src/config/setup/schedule-assignment.ts`, `src/config/setup/schedule-assignment.test.ts`
- `src/config/setup/setup-compiler.ts`, `src/config/setup/setup-compiler.test.ts`
- `src/config/setup/setup-validation.ts`, `src/config/setup/setup-validation.test.ts`
- `src/config/setup/template-schema.ts`, `src/config/setup/template-schema.test.ts`
- `src/config/tournament-config.ts`, `src/config/tournament-config.test.ts`

### GREEN verification

- `npm run test:run -- src/config/setup src/config/tournament-config.test.ts src/app/court-result-service.test.ts src/app/host-scoring-service.test.ts` — PASS (9 files, 66 tests).
- `npm run test:run -- src/backup src/integration/event-day-rehearsal.test.ts` — PASS (5 files, 15 tests).
- `rg -n "@ts-nocheck" src || true` — no output.
- `git diff --check` — PASS (no output).
- `npm run typecheck` — PASS.
- `npm run test:run` — PASS (80 files, 371 tests).
