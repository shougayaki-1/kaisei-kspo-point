# Tournament Operations UX Redesign Execution Notes

- Dexie source: Context7 — Dexie, library `/websites/dexie`, version not returned (installed `4.4.5`), “Upgrade Database Version”; https://dexie.org/docs/API-Reference
- Material UI source: Context7 — Material UI, library `/mui/material-ui/v9.2.0`, version `v9.2.0` (installed `9.3.1`), “Select Accessibility Labeling”; https://github.com/mui/material-ui/blob/v9.2.0/docs/data/material/components/selects/selects.md
- Zod source: Context7 — Zod, library `/colinhacks/zod/v4.0.1`, version `v4.0.1` (installed `4.4.3`), “Zod Schema Methods: `z.discriminatedUnion` and `z.intersection`”; https://github.com/colinhacks/zod/blob/v4.0.1/packages/docs/content/api.mdx
- Vitest/Testing Library source: Context7 — Vitest, library `/vitest-dev/vitest/v4.1.6`, version `v4.1.6`, “Examples > Best Practices”; https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/guide/browser/index.md; Testing Library, library `/testing-library/testing-library-docs`, version not returned (installed React Testing Library `16.3.2`; fake-indexeddb `6.2.5`), “Quickstart Test Implementation”; https://github.com/testing-library/testing-library-docs/blob/main/docs/react-testing-library/example-intro.mdx
- Baseline commit: `487800111052ca12024fd95b1e3062002911a90c`
- Baseline test result: `npm run test:run` passed (80 files, 388 tests); `npm run typecheck` passed; `npm run build` passed (with the existing Vite >500 kB chunk-size warning).

## Documentation retrieval scope

- Dexie documentation covered versioned stores, upgrade transactions, and deleting test databases/tables.
- Material UI documentation covered accessible `Select`, `RadioGroup`, and `TextField` labeling and responsive card/form composition.
- Zod documentation covered `discriminatedUnion` and `superRefine` validation.
- Vitest documentation covered browser-mode `userEvent`; repository inspection confirmed `fake-indexeddb/auto` and `@testing-library/react` are configured in `src/test/setup.ts`.

## Baseline worktree state

`git status --short` produced no output before the baseline commands; there were no pre-existing untracked files to record.

## Completion summary (2026-08-24)

- All 14 tasks in `docs/superpowers/plans/2026-08-23-tournament-operations-ux-redesign-implementation-plan.md` are implemented and committed on `feature/tournament-operations-ux-redesign`.
- Final verification: `npm run test:run` passed (93 files, 461 tests); `npm run typecheck` passed; `npm run build` passed (pre-existing >500 kB chunk-size warning only); `git diff --check` reported no whitespace errors.
- Browser check at 390px width (in-app browser, dev server): Host CONFIG tab shows the four-stage setup wizard with no horizontal scrolling; Court mode shows the "no active configuration" assignment guidance above the legacy QR/Config-Update panels, also with no horizontal scrolling.
- Self-review scans: `rg "ScoringSession|CourtRun|Result|Revision|ConfigVersion|inputSchemaId" src/app/court src/app/tournament-settings --glob '*.tsx'` (excluding tests) showed no matches in user-visible text — only in type/prop identifiers. Pre-existing diagnostic/advanced-management panels (`ConfigFilePanel`, `ConfigUpdatePanel`, `TransferDemo`, `ConflictResolutionPanel`, `HostScoringDashboard`, `DeviceDiagnostics`, `HostBackupPanel`) still show internal terms; these files are outside every task's file list and were left unchanged. `rg "TODO|FIXME|placeholder|not implemented"` showed only legitimate HTML `placeholder=` attributes.
- Code review (medium effort, `main...HEAD`): two CONFIRMED findings — (1) `validateResolutionRecord` in `src/domain/result-projection.ts` trusted a stored `commonConfirmedAncestorRevisionId: null` without re-verifying it against the actual revision graph; (2) `refreshCourtState` in `src/app/App.tsx` had no request-ordering guard against out-of-order async resolution, unlike every other effect in the file. Both fixed with regression coverage in commit `fix: verify virtual-root resolution claims and guard Court refresh races`.
- Known scoping decisions carried forward (not defects): `TournamentSettingsHome`'s per-stage "edit" deep links currently surface a "詳細管理から編集してください" notice rather than reopening the wizard on an existing tournament, because no task in the plan builds a snapshot→draft reverse-compiler; editing an applied configuration goes through the retained JSON import/export path under 詳細管理. Custom-`ScoringRule` competitions (WEIGHTED_SUM/KING_DODGEBALL) in `host-scoring-service.ts` still resolve their schema from the *current* active config rather than each Revision's pinned ConfigVersion — only the common method-projection (RANK_POINTS) path was migrated to per-Revision pinned resolution, to keep the change bounded and tested.
- Physical-device rehearsal (printed/on-screen QR scans, network interfaces disabled) was not performed in this session — recommended before production use, per the plan.
