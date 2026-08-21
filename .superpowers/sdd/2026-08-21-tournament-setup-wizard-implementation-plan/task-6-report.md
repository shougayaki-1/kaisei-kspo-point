# Task 6 Report

## Status
- Completed on branch `feat/tournament-setup-wizard`
- Commit: `24aee689a4bd24f39804f3a3c3370a54629eec37` (`feat: add guided competition templates`)

## RED Evidence
- Command: `npm run test:run -- src/app/tournament-setup/TemplateStep.test.tsx src/app/tournament-setup/CompetitionStep.test.tsx`
- Result: failed before implementation because `./TemplateStep` and `./CompetitionStep` did not exist yet.
- Key evidence:
  - `Failed to resolve import "./TemplateStep" from "src/app/tournament-setup/TemplateStep.test.tsx"`
  - `Failed to resolve import "./CompetitionStep" from "src/app/tournament-setup/CompetitionStep.test.tsx"`

## GREEN Evidence
- Command: `npm run test:run -- src/app/tournament-setup/TemplateStep.test.tsx src/app/tournament-setup/CompetitionStep.test.tsx src/app/tournament-setup/TournamentSetupWizard.test.tsx`
- Result: PASS (`3` files, `10` tests)
- Command: `npm run typecheck`
- Result: PASS

## Files
- `src/app/tournament-setup/TemplateStep.tsx`
- `src/app/tournament-setup/TemplateStep.test.tsx`
- `src/app/tournament-setup/CompetitionStep.tsx`
- `src/app/tournament-setup/CompetitionQuickEditor.tsx`
- `src/app/tournament-setup/CompetitionAdvancedEditor.tsx`
- `src/app/tournament-setup/CompetitionStep.test.tsx`
- `src/app/tournament-setup/TournamentSetupWizard.tsx`
- `.superpowers/sdd/2026-08-21-tournament-setup-wizard-implementation-plan/task-6-report.md`

## Concerns
- The quick editor maps `記録の表示名` onto the shared `SetupCompetitionDraft.name` field because Task 6 is constrained to the current Task 3 draft shape; later tasks may still want a separate input-label field if compiled scoring inputs need independent labels.
- Imported templates are persisted as a local-only browser registry and validated before insertion, but there is not yet a repository-backed template registry or cross-device sync path.
- `tsconfig.app.tsbuildinfo` and `tsconfig.node.tsbuildinfo` remain untracked and were intentionally left out of the Task 6 commit.

## Fix Round 1

### Scope
- Review issue 1: `TemplateStep.handleCompetitionToggle()` reset still-selected competitions back to template defaults.
- Review issue 2: `CompetitionQuickEditor` exposed a custom-group quick-edit choice even though Task 6 has no custom-group definition UI.

### RED Evidence
- Command: `npm run test:run -- src/app/tournament-setup/TemplateStep.test.tsx src/app/tournament-setup/CompetitionStep.test.tsx`
- Result: FAIL (`2` files, `2` targeted regressions after fixing one incidental expectation mismatch)
- Key evidence:
  - `preserves edited competitions that stay selected when another template competition is toggled` failed because `ball-carry` reverted from edited `name/inputGrouping/groupsPerTeam/rankingDirection` to template defaults.
  - `lets users edit quantity competitions with human labels only` failed because `任意のコートをまとめて入力` was still present in the quick editor.

### GREEN Evidence
- Command: `npm run test:run -- src/app/tournament-setup/TemplateStep.test.tsx src/app/tournament-setup/CompetitionStep.test.tsx`
- Result: PASS (`2` files, `5` tests)
- Command: `npm run typecheck`
- Result: PASS

### Fix Round 1 Files
- `src/app/tournament-setup/TemplateStep.tsx`
- `src/app/tournament-setup/TemplateStep.test.tsx`
- `src/app/tournament-setup/CompetitionQuickEditor.tsx`
- `src/app/tournament-setup/CompetitionStep.test.tsx`
- `.superpowers/sdd/2026-08-21-tournament-setup-wizard-implementation-plan/task-6-report.md`
