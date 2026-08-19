# Offline Score Management Remaining Implementation Plan

> **For Codex/Claude Code:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Use `superpowers:test-driven-development` for every behavior change, `superpowers:systematic-debugging` for any failure not already understood, and `superpowers:verification-before-completion` before claiming a task/phase complete.

**Goal:** Bring `kaisei-kspo-point` from the currently implemented foundation through the user-approved v1.0 formal design, without rewriting completed work and without violating the event-day fully-offline / Host-authority / immutable-history invariants.

**Architecture:** Preserve the existing separation among `domain`, `config`, `transfer`, `db`, and `app`. Add missing domain services and adapters rather than moving domain logic into React components. Host remains authoritative for scoring and tournament aggregation; Court emits immutable raw Result/Revision history and TransferBatch data. QR transport uses one framed protocol for Result, ACK, and Config Update. Persist all state required for crash/reload recovery in IndexedDB. Treat the formal design spec as normative when existing code differs.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest 4, IndexedDB/Dexie-style repository layer already present, Zod, Web Crypto, `vite-plugin-pwa`.

---

## 0. Audited baseline and execution rules

This plan was produced from the GitHub state on 2026-08-19, not from prior conversation phase numbers.

### Repository state used for this plan

- `main` head: `4c802605aba661b2523b98a6e41f893d6ed4aa7c`.
- PR #1 (`feat/foundation-mvp`), #2 (`feat/qr-transfer-ack`), and #3 (`feat/tournament-config-foundation`) are already merged into `main` and must be preserved rather than rebuilt.
- PR #5 (`feat/scoring-simulator-regression`) is OPEN at `6b7313609fe68c78b8d6ef6a2e8ea11a72db5eb3` and contains substantial Scoring Simulator / Calculation Trace / ScoringTestCase / ConfigVersion regression-gate work.
- PR #7 (`docs/formal-design-v1`) is OPEN at `a07092a0471e0e95740d4a7407ae7ebd2691e863` and contains the user-approved normative v1.0 design specification.
- PR #5 and PR #7 were both based on the same `main` commit, so neither may be assumed present in the other branch.
- The latest observed GitHub Actions run for PR #5 (`32216609967`) is red. The run-level result is `failure`; the exact test failure must be reproduced/obtained before any CI fix is attempted. Do not guess at a fix from the PR body.

### Formal-design conformance already confirmed in code

Preserve these behaviors unless a focused test proves a defect:

- Result correction creates a new Revision and retains prior revisions.
- Result and Revision persistence exists in IndexedDB.
- `CourtRun` and `ScoringSession` are distinct domain concepts, and a ScoringSession can span multiple runs/courts.
- Result transfer already fragments payloads, checks checksums, supports out-of-order fragments, rejects conflicting duplicate fragments, and suppresses already-imported batch IDs.
- Incoming transfer sessions are persisted in the transfer repository and can be restored after interruption.
- ConfigVersion / ScoringTestCase regression machinery on PR #5 includes fingerprint-bound approvals and detects actual ScoringProfile differences even if the operator labels a change incorrectly.
- Simulator/test-case scoring on PR #5 shares the existing scoring engine and Calculation Trace path.

### Confirmed gaps / deviations that drive the tasks below

1. PR #5 is not merged and currently has red CI.
2. Conflict handling does not yet provide the formal-design Host projection rule: while divergent heads are unresolved, aggregate the previous common confirmed ancestor.
3. There is no complete production Host scoring/standings flow wired from imported Result/Revision history.
4. TransferBatch persistence currently permits a record with the same batch ID to be overwritten via `put`, which violates post-generation immutability.
5. ACKed old batches are retained, but there is no complete query/history/re-display/re-send workflow for Court disaster-recovery resend.
6. Result transfer uses `TRANSFER_FRAGMENT`; ACK uses a separate `ACK_FRAME`; `RESULT_BATCH` / `ACK_BATCH` / `CONFIG_UPDATE` do not yet share the required common frame.
7. Config Update QR transport/application is not implemented.
8. Scoring/input canonical values use JavaScript `number`, including division for averages/tie awards, so binary floating-point can enter authoritative results.
9. `WIN_POINTS` / `CUSTOM` are represented in scoring types but are not implemented by the engine. These must either be implemented when required by the authoritative current-year rules or rejected by configuration validation; silent acceptance is not allowed.
10. PWA dependency exists but the Vite config does not currently install/configure a production Service Worker/precache/update policy. Event-day version pinning is therefore not implemented.
11. There is no portable Host backup/restore workflow.
12. The present UI is still largely demo/config/simulator oriented: Court production entry, Host aggregate/standings, Display mode, transfer history, diagnostics, and data-management operations are incomplete.
13. Safe browser reload exists as a reload action and does not itself wipe IndexedDB, but destructive reset/initialization must be explicitly separated and guarded.
14. The authoritative 2026 competition-rule data was not found as a verified repository source during this audit. Do not infer current-year team names, event composition, or point tables from an old score sheet.

### Global implementation constraints

- Do not start a later phase while an earlier phase's acceptance gate is red.
- Every behavior change starts with a failing test (RED), then the smallest implementation (GREEN), then local cleanup only (REFACTOR).
- If a test/CI failure is not understood, stop feature work and use `systematic-debugging`; do not stack speculative fixes.
- Run focused tests during RED/GREEN loops; run full `npm test`, `npm run typecheck`, and `npm run build` at each phase gate and before every PR-ready claim.
- Do not make large unrelated refactors. Where touched files already mix responsibilities, extract only the responsibility required by the current task.
- Do not hardcode number of teams, team names, event list, court topology, or point tables in TypeScript/React.
- Do not add external runtime APIs, CDN assets, cloud DBs, online auth, analytics, remote fonts, or other event-day network dependencies.

---

## Phase 0 — Establish a green, normative baseline

### Task 1: Make the approved design and PR #5 a clean execution baseline

**Files:**
- Read: `docs/superpowers/specs/2026-08-19-offline-score-management-design.md`
- Read: `.github/workflows/ci.yml`
- Read/test: files named by the actual failing Vitest output on PR #5
- Modify: **only** the smallest source/test file(s) proven responsible by the failing test; exact path must be recorded after reproduction rather than guessed in advance
- No architectural refactor in this task

**RED**
1. First land/merge PR #7 (documentation-only) or otherwise ensure the execution branch contains the exact approved v1.0 spec unchanged.
2. Rebase/update PR #5 onto the normative baseline without altering scoring behavior merely to resolve conflicts.
3. Re-run/inspect the failing PR #5 test from GitHub Actions run `32216609967`.
4. Capture: failing test name, assertion, expected value, actual value, first bad commit if determinable, and the smallest reproduction.

**GREEN**
1. Apply only the root-cause fix supported by the reproduction.
2. Run the single failing test.
3. Run the affected test file.
4. Run the complete existing suite.

**REFACTOR**
- Only if the root-cause fix introduced duplication; otherwise leave structure unchanged.

**Acceptance criteria:**
- PR #5 behavior survives rebasing/merging against the approved design branch/main.
- Stale approval cannot be reused for a different result fingerprint.
- Actual ScoringProfile changes cannot bypass regression review through a misleading change category.
- All existing tests pass.
- No new product feature is added in this task.

**CI checkpoint:** `npm test && npm run typecheck && npm run build`; GitHub Actions must be green before Phase 1.

---

## Phase 1 — Deterministic scoring core before production aggregation

### Task 2: Replace authoritative floating-point arithmetic with deterministic decimal/rational arithmetic

**Create:**
- `src/domain/exact-decimal.ts`
- `src/domain/exact-decimal.test.ts`

**Modify:**
- `src/config/input-schema.ts`
- `src/config/input-schema.test.ts`
- `src/domain/scoring.ts`
- `src/domain/scoring.test.ts`
- `src/domain/scoring-engine.ts`
- `src/domain/scoring-engine.test.ts`
- PR #5 scoring simulator/test-case files that serialize or fingerprint scoring outputs
- `src/db/config-repository.ts` only where persisted expected/result values require canonical representation
- corresponding repository tests

**RED**
Add tests proving deterministic behavior for cases that binary floating-point cannot represent exactly, including:
- `0.1 + 0.2`-equivalent raw/aggregate scenarios;
- tie-average awards that produce fractional points;
- AVERAGE aggregation with repeating fractions;
- stable canonical serialization/fingerprint for semantically identical values;
- round-trip persistence without changing authoritative value.

**GREEN**
- Introduce a canonical exact numeric type backed by integer coefficient + explicit scale, or another integer/rational representation that never relies on binary floating-point for authoritative arithmetic.
- Parse DECIMAL input from canonical decimal text rather than from `number` as the source of truth.
- Convert scoring/tie/aggregation arithmetic and Calculation Trace operands/results to the canonical representation.
- Keep presentation formatting at the UI boundary.
- Migrate ScoringTestCase expected/result fingerprints to canonical serialized values.

**REFACTOR**
- Keep conversion helpers in `exact-decimal.ts`; do not scatter scale/rounding logic across UI or repositories.
- If `scoring.ts` grows, extract tie-allocation helpers rather than expanding a monolith.

**Acceptance criteria:**
- No authoritative score or configured decimal point value depends on JS binary floating-point arithmetic.
- Calculation Trace is deterministic and serializes identically across reloads.
- Simulator and ScoringTestCase remain on the same engine.
- Existing integer-only behavior remains unchanged.

**CI checkpoint:** focused numeric/scoring tests after each GREEN; full CI at Task completion.

### Task 3: Make unsupported scoring modes impossible to activate silently

**Modify:**
- `src/config/scoring-profile.ts`
- `src/config/scoring-profile.test.ts`
- `src/config/tournament-config.ts`
- `src/config/tournament-config.test.ts`
- `src/domain/scoring-engine.ts`
- `src/domain/scoring-engine.test.ts`
- Host config editor files only for validation/error presentation

**RED**
- A config using a scoring/aggregation mode that the engine cannot execute must fail validation before ConfigVersion activation.
- If authoritative 2026 rules require `WIN_POINTS` or `CUSTOM`, add tests for those exact rules before implementing them.

**GREEN**
- Make configuration capability validation explicit and exhaustive.
- Implement `WIN_POINTS`/`CUSTOM` only if the verified current-year rules require them; otherwise reject them with a clear validation error.

**REFACTOR**
- Keep capability checks in config/domain code, not React.

**Acceptance criteria:** no active ConfigVersion can reference a scoring operation the production engine will later reject.

**CI checkpoint:** full CI before Phase 2.

---

## Phase 2 — Revision graph and Host-authoritative conflict semantics

### Task 4: Implement revision graph projection and explicit conflict resolution

**Create:**
- `src/domain/revision-graph.ts`
- `src/domain/revision-graph.test.ts`
- `src/domain/result-projection.ts`
- `src/domain/result-projection.test.ts`

**Modify:**
- `src/domain/revision.ts`
- `src/domain/result.ts`
- `src/db/result-repository.ts`
- `src/db/result-repository.test.ts`
- transfer import tests where divergent children are imported

**RED**
Cover at least:
- linear correction selects newest confirmed descendant;
- two children of the same ancestor create a conflict and are not auto-resolved by timestamp or arrival order;
- a deeper divergence finds the latest common confirmed ancestor;
- unresolved conflict projects that common ancestor for aggregation;
- explicit operator resolution creates/records a new resolution decision without deleting either branch;
- importing the same revision again is idempotent.

**GREEN**
- Build a pure revision-graph service that identifies heads, ancestry, divergence, and latest common confirmed ancestor.
- Add a Host projection service returning `{effectiveRevision, conflictState, candidateHeads}`.
- Persist explicit resolution metadata/history rather than rewriting old revisions.
- Keep arrival timestamps informational only.

**REFACTOR**
- Do not put graph traversal into `result-repository.ts`; repository loads/saves, domain service decides semantics.

**Acceptance criteria:** invariants 3–5 hold under order changes, retries, and reloads.

**CI checkpoint:** domain/repository tests, then full CI.

---

## Phase 3 — One immutable QR protocol for Result, ACK, and Config Update

### Task 5: Introduce the common QR frame without losing existing fragmentation guarantees

**Create:**
- `src/transfer/frame.ts`
- `src/transfer/frame.test.ts`

**Modify:**
- `src/transfer/types.ts`
- `src/transfer/codec.ts`
- `src/transfer/codec.test.ts`
- `src/transfer/receiver.ts`
- `src/transfer/receiver.test.ts`
- `src/transfer/ack.ts`
- `src/transfer/ack.test.ts`

**RED**
- Encode/decode all three payload kinds: `RESULT_BATCH`, `ACK_BATCH`, `CONFIG_UPDATE`.
- Reject unknown protocol version/type.
- Preserve checksum validation.
- Preserve out-of-order scan and exact-duplicate fragment acceptance.
- Reject a conflicting duplicate fragment at the same index.
- Complete transfer after restoring a partially scanned session from persistence.

**GREEN**
- Define one protocol envelope with protocol version, payload kind, transfer ID, fragment metadata, checksum, and data.
- Adapt Result and ACK code to the common envelope.
- Reserve/implement Config Update payload support through the same codec.
- Keep payload-specific validation behind the common framing layer.

**REFACTOR**
- Remove duplicated Result-vs-ACK framing/checksum code only after parity tests pass.

**Acceptance criteria:** invariant 10 and all of invariant 11 are covered by automated tests.

**CI checkpoint:** transfer tests + full CI.

### Task 6: Enforce TransferBatch immutability and add complete Court resend history

**Create:**
- `src/domain/transfer-history.ts` if domain policy is needed
- `src/app/CourtTransferHistory.tsx`
- `src/app/CourtTransferHistory.test.tsx`

**Modify:**
- `src/db/transfer-repository.ts`
- `src/db/transfer-repository.test.ts`
- `src/app/TransferDemo.tsx` (or replace demo wiring with production service/UI)
- corresponding transfer service/controller tests

**RED**
- Saving a different payload/fragments under an existing `batchId` must fail.
- Saving the exact same batch again is idempotent.
- ACK changes only delivery metadata/status; it never mutates batch payload/fragments/revisionIds.
- list/history query returns ACKed and unACKed batches in deterministic order.
- an ACKed historical batch can be re-opened and rendered as the exact original QR fragments.
- resend does not create a new authoritative result or cause Host double-add.

**GREEN**
- Replace unconditional same-key overwrite with immutable insert-or-identical semantics.
- Separate immutable batch content from mutable delivery acknowledgement metadata if necessary.
- Add repository list/query API and Court history UI/service.
- Re-render stored fragments for resend; do not regenerate a semantically new batch.

**REFACTOR**
- Keep persistence rules out of React.

**Acceptance criteria:** invariants 6, 7, and 12 are satisfied, including Host restore followed by Court resend of an old ACKed batch.

**CI checkpoint:** transfer repository/UI tests + full CI.

### Task 7: Implement Config Update QR application as immutable ConfigVersion data

**Create:**
- `src/transfer/config-update.ts`
- `src/transfer/config-update.test.ts`
- `src/app/config-update-service.ts`
- `src/app/config-update-service.test.ts`

**Modify:**
- `src/db/config-repository.ts`
- `src/db/config-repository.test.ts`
- `src/transfer/receiver.ts`
- relevant Court config/version status UI

**RED**
- Host exports a specific immutable ConfigVersion snapshot into `CONFIG_UPDATE` frames.
- Court receives fragments in arbitrary order, resumes after interruption, validates checksum/schema/version, and imports once.
- importing the same ConfigVersion is idempotent.
- same configVersionId with different content is rejected.
- receiving a new ConfigVersion does not mutate the previous version.
- active-version switch is explicit and validates compatibility.

**GREEN**
- Add snapshot export/import boundary around ConfigRepository.
- Route `CONFIG_UPDATE` through common transfer receiver.
- Persist imported version before activating it.
- Surface current ConfigVersion ID on Court/Host screens for operator verification.

**REFACTOR**
- `config-repository.ts` already combines snapshot construction, validation, and DB writes. While touching this path, extract only a pure snapshot validation/serialization helper so Config QR and backup do not duplicate repository internals.

**Acceptance criteria:** ConfigVersion remains immutable and Court can be updated without network access.

**CI checkpoint:** config/transfer tests + full CI before Phase 4.

---

## Phase 4 — Production Court capture and Host scoring/standings

### Task 8: Replace Court demo entry with a production ScoringSession/Result workflow

**Create:**
- `src/app/court-result-service.ts`
- `src/app/court-result-service.test.ts`
- `src/app/CourtScoringSession.tsx`
- `src/app/CourtScoringSession.test.tsx`

**Modify:**
- `src/app/App.tsx`
- `src/app/CourtRunDemo.tsx` (retire or reduce to wrapper)
- `src/db/result-repository.ts` only for missing persistence APIs proven by tests

**RED**
- operator selects a ScoringSession independent of physical court count;
- InputSchema controls the fields rendered/validated;
- save creates raw Result + initial Revision, not authoritative tournament points;
- correction creates a new child Revision and leaves the previous Revision intact;
- multiple physical courts can feed one ScoringSession when configured;
- simulator state cannot appear in production Result stores;
- reload restores saved production state.

**GREEN**
- Build a thin Court application service around config + ResultRepository.
- Render inputs dynamically from InputSchema.
- Persist only raw result/revision data needed by Host scoring.
- Add clear correction/history affordance.

**REFACTOR**
- UI components handle form state/presentation only; validation/domain construction stays in config/domain/service modules.

**Acceptance criteria:** invariants 1, 3, 8, 9, 20, and 22 hold in the production Court path.

**CI checkpoint:** Court service/UI tests + full CI.

### Task 9: Build Host authoritative projection, scoring, aggregate standings, and conflict UI

**Create:**
- `src/domain/standings.ts`
- `src/domain/standings.test.ts`
- `src/app/host-scoring-service.ts`
- `src/app/host-scoring-service.test.ts`
- `src/app/HostScoringDashboard.tsx`
- `src/app/HostScoringDashboard.test.tsx`
- `src/app/ConflictResolutionPanel.tsx`
- `src/app/ConflictResolutionPanel.test.tsx`

**Modify:**
- `src/app/App.tsx`
- `src/app/QrReceiverDemo.tsx` / receive controller wiring
- shared scoring/trace types only if required by the production service

**RED**
- imported raw revisions are projected by Task 4 conflict semantics;
- Host computes points using the same engine as Simulator/TestCase;
- unresolved conflict contributes the latest common confirmed ancestor, not either divergent head;
- explicit conflict resolution changes the effective projection deterministically;
- duplicate/re-sent batch does not add points twice;
- standings derive team/event structure from active ConfigVersion, not constants;
- Calculation Trace is inspectable for a production result.

**GREEN**
- Compose ResultRepository projection + active ConfigVersion + Scoring Engine into a pure/testable Host scoring service.
- Derive aggregate standings from effective revisions.
- Add dashboard and explicit conflict-resolution UI.

**REFACTOR**
- Keep aggregation in `domain/standings.ts`; React renders view models.

**Acceptance criteria:** invariants 1, 2, 4, 5, 7, 19, 21, and 22 hold end-to-end on Host.

**CI checkpoint:** Host/domain tests + full CI before Phase 5.

---

## Phase 5 — PWA/offline safety and operator data controls

### Task 10: Implement installable offline PWA with event-day update pinning

**Create:**
- `src/pwa/update-policy.ts`
- `src/pwa/update-policy.test.ts`
- `src/app/DeviceDiagnostics.tsx`
- `src/app/DeviceDiagnostics.test.tsx`

**Modify:**
- `vite.config.ts`
- `src/main.tsx`
- `package.json` only if scripts/dependency configuration actually requires it
- `src/app/App.tsx`

**RED**
- production build emits a Service Worker/precache manifest containing all required local assets.
- no required runtime asset URL points to CDN/external API.
- update policy does not auto-activate a new app version during event mode.
- diagnostics exposes installed app version, active ConfigVersion, storage availability, and offline readiness.

**GREEN**
- Configure `vite-plugin-pwa` for complete app-shell/static-asset precache.
- Use explicit/manual update activation; event mode pins the active version for the day.
- Add diagnostics/preflight UI.

**REFACTOR**
- Service Worker/update lifecycle belongs in `src/pwa`, not `App.tsx`.

**Acceptance criteria:** app starts and core workflows function with network disabled after installation; no automatic event-day SW replacement.

**CI checkpoint:** production build inspection + automated update-policy tests + full CI.

### Task 11: Separate safe reload from destructive reset/initialization

**Create:**
- `src/db/data-reset.ts`
- `src/db/data-reset.test.ts`
- `src/app/DataManagementPanel.tsx`
- `src/app/DataManagementPanel.test.tsx`

**Modify:**
- `src/app/App.tsx`

**RED**
- normal reload preserves Results, Revisions, transfer state, config versions, and test cases.
- reset is not reachable through the reload action.
- destructive reset requires explicit confirmation and names the data that will be deleted.
- Host/Court reset paths cannot accidentally clear only half of an integrity-coupled dataset.

**GREEN**
- Keep reload as browser reload only.
- Put destructive data deletion in a separately named service and guarded UI.
- Provide role-appropriate reset semantics without hidden side effects.

**Acceptance criteria:** invariant 26 is explicit in code/tests/UI, not just operator convention.

**CI checkpoint:** DB/UI tests + full CI.

---

## Phase 6 — Disaster recovery

### Task 12: Add portable Host backup and transactional restore

**Create:**
- `src/backup/backup-schema.ts`
- `src/backup/backup-schema.test.ts`
- `src/backup/backup-service.ts`
- `src/backup/backup-service.test.ts`
- `src/backup/restore-service.ts`
- `src/backup/restore-service.test.ts`
- `src/app/HostBackupPanel.tsx`
- `src/app/HostBackupPanel.test.tsx`

**Modify:**
- DB repositories only to add explicit export/import transaction APIs where needed
- `src/app/App.tsx`

**RED**
- backup contains schema version, app version, active ConfigVersion and immutable snapshots, Results/Revisions, conflict/resolution state, imported batch IDs, outgoing/ACK metadata required by Host role, ScoringTestCases/approvals as applicable.
- checksum detects damaged backup.
- restore to an empty spare Host reproduces authoritative standings exactly.
- incompatible schema/version is rejected with actionable error.
- failed restore is atomic and leaves the prior database intact.
- after restoring an older backup, re-scanning a Court's historical ACKed batch imports missing revisions once and remains duplicate-safe.

**GREEN**
- Define a versioned portable JSON (or equivalent local file) schema with checksum.
- Export from repositories through a pure backup service.
- Validate fully before transactional restore.
- Add Host download/import UI using browser local file APIs only.

**REFACTOR**
- Do not let backup code reach into component state or Dexie internals ad hoc; expose narrow repository snapshot APIs.

**Acceptance criteria:** invariant 27 plus disaster-recovery resend scenario from invariant 12 passes automatically and in rehearsal.

**CI checkpoint:** backup/restore integration tests + full CI before Phase 7.

---

## Phase 7 — Display role, current-year configuration, and event rehearsal

### Task 13: Add read-only Display role driven by Host-authoritative state

**Create:**
- `src/app/DisplayDashboard.tsx`
- `src/app/DisplayDashboard.test.tsx`

**Modify:**
- `src/app/App.tsx`
- role-selection/bootstrap types if currently embedded in `App.tsx`

**RED**
- Display cannot create/edit Result, Revision, ConfigVersion, conflict resolution, or transfer state.
- displayed standings match Host standings projection.
- reload/offline behavior is safe.

**GREEN**
- Add DISPLAY role as a read-only presentation of local Host-authoritative data.

**REFACTOR**
- If role bootstrap is currently mixed into `App.tsx`, extract only role/bootstrap concerns into a small module while adding DISPLAY.

**Acceptance criteria:** Display is read-only and never becomes a second scoring authority.

**CI checkpoint:** Display tests + full CI.

### Task 14: Load and validate the authoritative 2026 tournament configuration without hardcoding it

**Create:**
- `config/2026-kaisei-tournament.json` **only after** the current-year competition rules are supplied/verified as the authoritative source
- `src/config/config-file.ts`
- `src/config/config-file.test.ts`

**Modify:**
- Host config import/export UI
- ScoringTestCase fixtures for the verified 2026 rules

**RED**
- config file schema rejects missing/duplicate IDs, invalid CourtRun/ScoringSession references, unsupported scoring profiles, and invalid point tables.
- all verified current-year ScoringTestCases pass.
- no test relies on a three-team or fixed 6-3-1 assumption unless that exact rule exists in the 2026 source.

**GREEN**
- Import the current-year tournament data as data, not TypeScript constants.
- Add representative ScoringTestCases for every distinct scoring rule shape.
- Activate only after regression gate passes.

**REFACTOR**
- Keep sample/dev config separate from production 2026 config.

**Acceptance criteria:** invariants 14–18, 22, and 23 are demonstrably satisfied for the actual event configuration.

**CI checkpoint:** config/regression suite + full CI.

### Task 15: Add event-day end-to-end rehearsal scenarios and release gate

**Create:**
- `src/integration/event-day-rehearsal.test.ts` (or split into narrowly named integration tests if it becomes large)
- `docs/event-day-operations.md`

**Modify:**
- `.github/workflows/ci.yml` only if a separate integration command is needed
- `package.json` only if adding that command

**RED scenarios to automate where practical:**
1. install/load offline, then disable network;
2. Court creates initial Result, correction Revision, and immutable Result batch;
3. Result QR scans arrive out of order with duplicates and after receiver restart;
4. Host imports once and scores from raw revisions;
5. divergent revisions create conflict and standings use common confirmed ancestor;
6. operator resolves conflict and standings change deterministically;
7. Host sends ACK; Court still re-opens the ACKed batch from history;
8. Host restores an older portable backup, Court re-sends historical batch, Host recovers without double-add;
9. Host sends Config Update QR; Court imports immutable ConfigVersion;
10. scoring-rule change reruns tests and stale fingerprint approval is rejected;
11. safe reload retains all IndexedDB data;
12. Service Worker does not auto-upgrade the pinned event-day app;
13. no player PII fields exist in production config/result schemas.

**GREEN**
- Add integration harness/tests and operator runbook only; fix product defects in their owning modules with separate RED/GREEN loops, not by weakening the rehearsal.

**REFACTOR**
- Split a rehearsal test once it becomes difficult to diagnose; do not build a single giant e2e fixture.

**Acceptance criteria:**
- All 28 formal invariants have either an automated test or an explicit operator rehearsal check.
- Full test/typecheck/build is green from a clean install.
- Manual rehearsal succeeds with network physically disabled.
- A release identifier is recorded and event-day update policy is pinned before deployment to Court/Host/Display devices.

**Final verification checkpoint:**

```bash
npm ci
npm test
npm run typecheck
npm run build
```

Then perform the offline/manual rehearsal in `docs/event-day-operations.md`. Do not claim completion until fresh output from all commands and the rehearsal checklist is recorded.

---

## Dependency order / PR slicing

Implement as small reviewable PRs after this plan is approved:

1. **Baseline PR work:** land #7; diagnose/fix #5 CI; merge #5 only when green.
2. **Exact arithmetic + capability validation** (Tasks 2–3).
3. **Revision graph/conflict projection** (Task 4).
4. **Unified QR protocol + immutable resend history + Config Update** (Tasks 5–7).
5. **Production Court + Host scoring/standings** (Tasks 8–9).
6. **PWA/update safety + reset separation** (Tasks 10–11).
7. **Portable backup/restore** (Task 12).
8. **Display + verified 2026 config + rehearsal/release gate** (Tasks 13–15).

Do not merge later slices around a red earlier slice. In particular, do not build production Host standings on floating-point scoring or unresolved conflict semantics, and do not treat a QR protocol demo as event-ready until immutable history and disaster-recovery resend are covered.

## Explicit non-goals

- No rewrite of merged Phase 1–3 foundations.
- No replacement of IndexedDB with cloud persistence.
- No online synchronization protocol for event day.
- No player identity/PII model.
- No hardcoded current-year scoring data in React/domain code.
- No broad styling redesign unless needed for operator correctness.
- No speculative cleanup of files unrelated to the active task.

## Approval gate

This document is the implementation plan only. **Do not begin Task 1 or make production-code changes until the user explicitly approves this plan.**
