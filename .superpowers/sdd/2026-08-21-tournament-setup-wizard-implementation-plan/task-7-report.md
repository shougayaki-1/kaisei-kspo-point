# Task 7 Report

## Status
- Completed on 2026-08-21.
- Commit: `8c9c597`

## RED Evidence
- `npm run test:run -- src/config/setup/schedule-assignment.test.ts`
  - Failed because `src/config/setup/schedule-assignment.ts` did not exist.
- `npm run test:run -- src/app/tournament-setup/ScheduleStep.test.tsx`
  - Failed because `src/app/tournament-setup/ScheduleStep.tsx` did not exist.

## GREEN Evidence
- `npm run test:run -- src/config/setup/schedule-assignment.test.ts src/app/tournament-setup/ScheduleStep.test.tsx src/app/tournament-setup/TournamentSetupWizard.test.tsx`
  - Passed: 3 files, 15 tests.
- `npm run typecheck`
  - Passed.

## Files
- `src/config/setup/schedule-assignment.ts`
- `src/config/setup/schedule-assignment.test.ts`
- `src/app/tournament-setup/ScheduleStep.tsx`
- `src/app/tournament-setup/ScheduleGridEditor.tsx`
- `src/app/tournament-setup/ScheduleStep.test.tsx`
- `src/app/tournament-setup/TournamentSetupWizard.tsx`

## Concerns
- The step keeps the default schedule controls intentionally narrow (`回数`, `コート数`, `入力のまとめ方`). Existing custom-group schedules are preserved in draft data, but custom group editing is not expanded in this Task 7 UI.

## Review Fix Pass

### Scope
- Honor edited `competition.schedule` data during compile so manual `startTime` and cell assignments affect the compiled config.
- Preserve `CUSTOM_GROUP` truthfully in `ScheduleStep` without selecting or rewriting a simpler grouping.

### RED Evidence
- `npm run test:run -- src/config/setup/setup-compiler.test.ts`
  - Failed at `uses edited schedule start times and cell assignments when a compatible manual schedule exists` because `plannedStart` was `undefined`.
- `npm run test:run -- src/app/tournament-setup/ScheduleStep.test.tsx`
  - Failed at `preserves custom grouped input truthfully without selecting a simpler grouping` because the retained-grouping notice was missing and the UI still coerced the grouping display.

### GREEN Evidence
- `npm run test:run -- src/config/setup/schedule-assignment.test.ts src/config/setup/setup-compiler.test.ts src/app/tournament-setup/ScheduleStep.test.tsx src/app/tournament-setup/TournamentSetupWizard.test.tsx`
  - Passed: 4 files, 26 tests.
- `npm run typecheck`
  - Passed.

### Changed Files
- `src/config/setup/setup-compiler.ts`
- `src/config/setup/setup-compiler.test.ts`
- `src/app/tournament-setup/ScheduleStep.tsx`
- `src/app/tournament-setup/ScheduleStep.test.tsx`
- `.superpowers/sdd/2026-08-21-tournament-setup-wizard-implementation-plan/task-7-report.md`

### Review Fix Concerns
- `CUSTOM_GROUP` is now preserved and clearly marked as retained, but its detailed grouping still is not editable from this Task 7 screen by design.
