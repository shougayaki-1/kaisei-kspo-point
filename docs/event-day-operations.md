# Event-day operations and release gate

This document is the operator runbook for the fully offline Kaisei Sports Festival scoring PWA. Formal Design v1.0 remains normative. This runbook does not create or override competition rules.

## Current release-gate status

- Phase 7 automated implementation: exercised by GitHub Actions and the test suites named below.
- physical/manual: NOT EXECUTED in the GitHub automation environment.
- authoritative 2026 data source blocker: the current authoritative document, 「第3回開成運動交流祭競技要領【詳細版】」, explicitly states that scoring allocations and competition times may change. Final Team identifiers/names and a final immutable rule set sufficient for the production ConfigVersion have not been confirmed here. A production `config/2026-kaisei-tournament.json` must not be created from older score sheets, prior-year Team counts, memory, or inference.
- The 王様ドッジボール rule shape in the current document is win/draw based and therefore requires an explicitly supported/approved scoring rule before activation; the existing fail-closed `WIN_POINTS`/`CUSTOM` capability boundary must not be bypassed.
- Production release ready remains blocked until a final authoritative 2026 ConfigVersion is supplied, validated, regression-tested, and the physical rehearsal below is completed.

## Release identifier

Before distributing an event-day build, record one immutable release identifier for every Host, Court, and Display device:

| Field | Required value / source |
|---|---|
| App version | `0.1.0` from the local installed artifact |
| Git release SHA | Full 40-character approved final commit SHA |
| Active ConfigVersion ID | Exact approved production ConfigVersion ID shown by diagnostics / config UI |
| DB schema version | `5` |
| Backup format version | `1` |

The code-level `buildReleaseIdentifier()` gate refuses an empty/abbreviated SHA or missing ConfigVersion ID. Do not treat the Phase 7 PR head alone as a production release identifier while the production 2026 ConfigVersion is blocked.

## Preflight

- [ ] Record the five release-identifier fields above and retain them with the event log.
- [ ] Confirm Host, every Court, Display, and spare Host use the same approved App version and release SHA.
- [ ] Confirm the active ConfigVersion ID is the approved 2026 ConfigVersion on every required device.
- [ ] Confirm every ScoringTestCase for that ConfigVersion is GREEN immediately before activation/release.
- [ ] Confirm Device role: one authoritative Host, assigned Courts, read-only Display, and spare Host.
- [ ] Open Device diagnostics and confirm offline readiness, IndexedDB/storage availability, and event-day update pin state.
- [ ] Confirm no waiting Service Worker is auto-activated. If an update is available, leave it waiting during the event unless an explicit controlled change is approved.
- [ ] Create a fresh Host portable backup and record its creation time/checksum.
- [ ] Restore that backup on the spare Host before the event and compare ConfigVersion ID and standings.
- [ ] Disable network physically and perform the Manual physical rehearsal below.

## Court

1. Confirm App version, Device ID, active ConfigVersion, and Court role.
2. Select the configured ScoringSession. Do not derive a session from a physical court label.
3. Enter only the raw InputSchema values configured for the CompetitionEntries shown.
4. Save the Result. The Court does not determine authoritative event points or aggregate standings.
5. If correction is required, append a correction Revision. Never overwrite an older Revision.
6. Generate/store the immutable RESULT_BATCH QR fragments.
7. Present all QR fragments to Host. Fragment order may vary; do not recreate a different batch with the same batch ID.
8. Scan the Host ACK. Confirm the historical batch becomes ACKNOWLEDGED.
9. If ACK is forgotten or Host recovery requires it, reopen the historical batch and resend the exact stored fragments.

## Host

1. Confirm App version, active ConfigVersion, storage, and Host role.
2. Receive RESULT_BATCH fragments. Out-of-order and exact duplicate fragments are safe; conflicting duplicates are an error.
3. If scanning is interrupted, reload/restart safely and resume the persisted partial batch.
4. Import a completed batch once through the production Host import path. Confirm imported-batch metadata persists.
5. Review the Host-authoritative projection, event scoring, Calculation Trace, and aggregate standings.
6. If divergence creates a Conflict, inspect all candidate heads and the latest common confirmed ancestor. Do not pick a winner by timestamp/arrival order.
7. Resolve a Conflict only through an explicit SELECT_REVISION or MERGE action; losing branches remain immutable history.
8. Generate ACK and return it to the Court.
9. Create periodic portable backups, especially before/after significant config or conflict-resolution changes.

## Display

1. Confirm App version and active ConfigVersion visibility.
2. Select Display mode.
3. Confirm standings match Host-authoritative state.
4. Confirm there are no Result/revision/config/transfer/conflict/backup/restore/reset/update-activation write actions.
5. Display may be safely reloaded offline; it must not become a second scoring authority.

## Config update

### Config file import/export on Host

1. Export the active immutable ConfigVersion as a `KAISEI_TOURNAMENT_CONFIG` schema-v1 JSON document when an archival/transfer copy is required.
2. For an incoming config file, use `設定ファイルを検証・取り込む` first. Import persists an immutable version but does not activate it.
3. Review validation results. Duplicate IDs, broken CompetitionEntry/CourtRun/ScoringSession references, invalid InputSchema/rank point tables, and unsupported scoring modes must fail closed.
4. Run fresh ScoringTestCase regression. Any non-PASS result blocks activation; stale approvals are not reusable.
5. Only then use the explicit activation action.

### CONFIG_UPDATE QR to Court

1. Host exports the exact immutable ConfigVersion ID through CONFIG_UPDATE.
2. Court receives/persists all QR parts; interrupted reception can resume after reload.
3. Reception does not auto-activate.
4. Confirm tournament/config compatibility, then explicitly activate on Court.
5. Keep prior ConfigVersions immutable for history and old Result interpretation.

## Recovery

1. Stop destructive actions. Do not clear browser data or reinstall as a normal recovery step.
2. On spare Host, confirm the same approved App version and DB compatibility.
3. Restore the most recent valid portable Host backup transactionally.
4. Verify active ConfigVersion ID and restored Host standings.
5. Determine which Court batches were created/ACKed after the backup.
6. Reopen those historical ACKed batches on Court and resend exact stored QR fragments.
7. Confirm only missing Revisions are recovered, imported-batch metadata is restored/recreated, duplicate rescans return duplicate-safe behavior, and no revision is double-added.
8. Compare final projections, Calculation Trace, event scores, and standings against the pre-failure Host record.
9. Create a new backup after recovery.

## Failure handling

### Safe reload

Use the normal reload action first. It must preserve IndexedDB: Results, immutable Revisions, conflicts/resolutions, transfer/partial QR/ACK state, ConfigVersions, and regression state.

### App update

A newly detected Service Worker version remains waiting during event-day pinning. Update detection is separate from explicit activation and from reload. Display mode does not expose update activation.

### Destructive reset

Reset is a separate two-stage destructive operation. Do not use it to troubleshoot a normal reload/update problem. Verify backup and operational authorization before any reset.

### Restore

Restore is separate from reload, Service Worker activation, and destructive reset. Validate the whole backup before mutation and retain the prior database if transaction/read-back verification fails.

## Manual physical rehearsal

This section requires actual devices and cannot be satisfied by GitHub Actions alone. Current status: physical/manual: NOT EXECUTED.

Use at least Host, Court, Display, and spare Host devices. For the full Formal Design rehearsal, use Host 1 + Court 3–5 + spare Host 1 where available.

- [ ] Install the exact approved PWA build on every device.
- [ ] Record App version, full release SHA, Device ID/role, and ConfigVersion ID.
- [ ] Physically disable Wi-Fi/network. Do not simulate offline only in DevTools.
- [ ] Fully close and reopen each installed PWA offline.
- [ ] Confirm Host/Court/Display boot and local storage diagnostics without network.
- [ ] Court: create a real Result and correction using the final authoritative config.
- [ ] Court→Host: transfer real QR with device camera/USB reader; test multi-part, out-of-order, duplicate, interrupted/reload/resume.
- [ ] Host: verify import marker, shared scoring, Calculation Trace, standings and ACK.
- [ ] Court: scan ACK and reopen/resend an ACKed historical batch.
- [ ] Create two divergent revisions intentionally; verify unresolved common-ancestor scoring and explicit resolution.
- [ ] Display: confirm read-only surface and exact Host standings.
- [ ] Create Host backup; then create/import another batch after backup.
- [ ] Simulate Host failure; restore the old backup to spare Host.
- [ ] Resend the post-backup historical batch; verify only missing Revision is recovered and duplicate resend is harmless.
- [ ] Exercise CONFIG_UPDATE QR persistence and explicit activation using an approved compatible ConfigVersion.
- [ ] Detect a waiting Service Worker update and confirm event-day pin prevents automatic activation across reload/restart.
- [ ] Create final backup and verify final standings.
- [ ] Confirm no player name, birthdate, contact information, or student personal identifier is requested/stored in production Result/config flow.

Do not mark this section complete from automated test output.

## Coverage matrix

Formal Design §24 は18個 of normative invariants. The user-requested “28 invariants” count does not match Formal Design v1.0. To avoid inventing normative requirements, rows 1–18 below are the exact §24 invariants; rows 19–28 are explicitly labelled supplemental Phase 7 release/rehearsal gates.

| # | Rule / gate | Automated evidence | Integration rehearsal | Operator/manual gate |
|---|---|---|---|---|
| 1 | §24: Court sends Raw Result/Revision, not authoritative aggregate score | `court-result-service.test.ts`, `transfer/codec.test.ts` | `integration/event-day-rehearsal.test.ts` | Inspect Court UI/QR flow |
| 2 | §24: corrections never overwrite old Revision | `result-repository-phase2.test.ts`, `court-result-service.test.ts` | event-day rehearsal correction/history | Verify history after correction |
| 3 | §24: TransferBatch payload immutable after creation | `transfer-history-phase3.test.ts`, `transfer-repository.test.ts` | stored batch reopened in rehearsal | Reopen exact QR on Court |
| 4 | §24: duplicate Revision never double-adds | `import-service.test.ts`, `host-transfer-import-service.test.ts` | `backup/disaster-recovery.integration.test.ts` | Duplicate real QR scan |
| 5 | §24: Conflict not auto-resolved by timestamp/arrival | `revision-graph.test.ts`, `host-scoring-service.test.ts` | event-day conflict branch test | Inspect candidate heads |
| 6 | §24: unresolved Conflict scores latest common confirmed ancestor | `result-projection.test.ts`, `host-scoring-service.test.ts` | event-day conflict keeps pre-conflict standings | Verify Host trace before resolve |
| 7 | §24: applied ConfigVersion immutable | `config-update-service.test.ts`, `config-file.test.ts` | import/activate boundary tests | Verify old version remains selectable/history |
| 8 | §24: Simulator never writes production Result store | simulator/regression integration tests | covered by existing store-boundary regression | Check production result count after simulation |
| 9 | §24: real/Simulator/ScoringTestCase share scoring implementation | `host-scoring-service.test.ts`, scoring engine/simulator tests | Host event scoring in rehearsal | Compare Host trace to approved cases |
| 10 | §24: changed scoring regression cannot activate without review | `TournamentConfigRegressionIntegration.test.tsx`, `config-file.test.ts` | config file fresh regression gate | Operator reviews all ScoringTestCases |
| 11 | §24: QR resend/forgotten ACK/Host-restore resend safe | `resend-phase3.test.ts`, transfer history tests | `backup/disaster-recovery.integration.test.ts` | Historical real QR resend after spare-host restore |
| 12 | §24: safe reload does not delete IndexedDB | `reload-persistence.test.ts`, `phase5-data-management-integration.test.tsx` | partial QR reload/resume in event-day rehearsal | Full app close/reopen offline |
| 13 | §24: Service Worker update not auto-applied during event | `update-policy.test.ts`, `phase5-pwa-integration.test.tsx` | policy automated; browser lifecycle cannot be fully emulated | Real waiting SW across reload/restart |
| 14 | §24: external network request not required in normal flow | Phase 5 production dependency/offline build tests | all DB/QR rehearsal paths run without API dependency | Physically disable network |
| 15 | §24: Team names/count not hardcoded | config validation and Host scoring tests | data-driven Host/Display state | Inspect final production config |
| 16 | §24: physical Court and ScoringSession remain distinct | `court-result-service.test.ts` | production Court selects configured session/run | Multi-court final-config rehearsal |
| 17 | §24: no player personal PII | event-day static production-schema PII gate | `integration/event-day-rehearsal.test.ts` | Confirm forms/config do not request player PII |
| 18 | §24: current rules outrank prior-year material | no production 2026 JSON generated from old data | authoritative-source blocker enforced in Task 14 | Final rule owner signs off exact 2026 ConfigVersion |
| 19 | Supplemental: Display is read-only | `DisplayDashboard.test.tsx`, `App.test.tsx` | same Host service output | Inspect Display controls |
| 20 | Supplemental: Display standings equal Host-authoritative state | `DisplayDashboard.test.tsx` | shared `loadAuthoritativeState` | Side-by-side Host/Display comparison |
| 21 | Supplemental: versioned config file validates/imports without auto-activation | `config-file.test.ts`, `ConfigFilePanel.test.tsx` | production ConfigRepository boundary | Import final config on spare profile first |
| 22 | Supplemental: authoritative 2026 production config is final and approved | intentionally blocked; no guessed fixture | not runnable until source finalized | Mandatory rule-owner signoff |
| 23 | Supplemental: installed PWA boots with physical network disabled | build/PWA tests only | automation cannot prove installed browser behavior | Mandatory physical offline boot |
| 24 | Supplemental: real camera/USB QR path works | codec/frame/receiver automated | logical payload path automated | Mandatory physical scanner/camera test |
| 25 | Supplemental: real multi-device flow works | logical databases simulate device state | software path automated | Mandatory Host + Courts + Display + spare Host rehearsal |
| 26 | Supplemental: actual Service Worker lifecycle/pinning works | runtime/update policy tests | state-machine behavior automated | Mandatory real SW waiting/activation test |
| 27 | Supplemental: spare-Host physical recovery/historical resend works | `backup/disaster-recovery.integration.test.ts` | logical Host A/Host B automated | Mandatory spare-device restore/resend |
| 28 | Supplemental: one approved release identifier is used across roles | `buildReleaseIdentifier` test in event-day rehearsal | constants/config identity automated | Record/compare five identifier fields on every device |

## Automated scenario index

The following requested event-day steps are automated either in the new cross-phase rehearsal or existing focused integration/regression suites: Court Result/correction; immutable RESULT_BATCH; QR fragmentation/out-of-order/duplicate/partial persistence/reload resume; single Host import/import marker; shared scoring/Calculation Trace/standings; divergence/common-ancestor projection/explicit resolution; ACK/history; backup/old-backup restore/historical resend/missing-revision recovery/double-add prevention/final standings equivalence; CONFIG_UPDATE persistence/explicit activation; scoring regression/stale fingerprint rejection; safe reload; update pin policy; Display read-only/equality; and PII schema gate.

Physical install, real camera/USB QR, true radio-offline boot, real multi-device concurrency, actual browser Service Worker lifecycle, and spare-device recovery remain manual gates as explicitly required by Formal Design.
