# JSON Config Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace multi-frame tournament configuration QR distribution in the normal operator flow with one reusable `.json` configuration file shared to every Court device, while preserving Court assignment QR, result QR, ACK, deterministic scoring, and offline safety.

**Architecture:** Keep the existing `KAISEI_TOURNAMENT_CONFIG` schema-v1 document as the only tournament configuration file format. First extend the existing activation boundary so a different tournament remains rejected by default but can be switched only through an explicit, atomic operator-approved path; then expose that core through a small distribution service, Host download UI, and Court import UI. `CONFIG_UPDATE` QR protocol code remains available for legacy/diagnostic coverage, but `ConfigUpdatePanel` is removed from normal Host/Court routes.

**Tech Stack:** React, TypeScript, MUI, Dexie/IndexedDB, Vitest, Testing Library, existing QR transfer modules.

**Spec:** `docs/superpowers/specs/2026-08-24-json-config-distribution-design.md`

## Global Constraints

- Use standard `.json` only; no custom extension or MIME type.
- Every Court receives the exact same configuration file.
- Do not serialize `deviceId`, `CourtAssignment`, unsent Result/Revision state, ACK state, camera state, or other device-local state into the tournament configuration file.
- Continue using `serializeTournamentConfigFile()` / `parseTournamentConfigFile()` and the existing `KAISEI_TOURNAMENT_CONFIG` / `schemaVersion: 1` envelope. Do not create a raw-snapshot file format.
- File import and activation remain separate. Importing/staging a file must not change the active configuration.
- Invalid JSON, unsupported file schema, validation failure, or failed scoring regression must leave the current active tournament/configuration unchanged.
- A different `tournamentId` is rejected by default. Switching tournaments requires an explicit operator confirmation and an explicit activation option.
- Same-tournament ConfigVersion updates retain the existing regression and approval gates.
- `COURT_ASSIGNMENT`, `RESULT_BATCH`, and ACK transfer semantics remain unchanged.
- Keep `src/transfer/config-update.ts`, `src/transfer/frame.ts`, `src/app/ConfigUpdatePanel.tsx`, and their protocol/unit tests unless a separate cleanup is approved. This plan only removes `ConfigUpdatePanel` from normal routes.
- No network dependency, LAN server, Web Share/AirDrop API, Nearby Share API, ZIP, encryption layer, or new QR codec.
- At execution time, refresh `main` and use the current `main` HEAD as source of truth. The design-time baseline was `50f4b8c33c7a5ffa9ac8b40b77ba04d720298f1e`; do not reset to it if `main` has advanced.

---

## File Structure

- `src/config/config-file.ts` — canonical file parser/serializer and imported-config activation policy.
- `src/db/config-repository.ts` — atomic activation of an imported ConfigVersion, including explicit cross-tournament replacement of normalized config rows only.
- `src/app/config-distribution-service.ts` — operator-facing active summary, export metadata, staged import summary, and activation façade.
- `src/app/json-file-download.ts` — browser download utility for JSON text.
- `src/app/HostConfigDistributionPanel.tsx` — normal Host UI for saving one JSON file.
- `src/app/CourtConfigImportPanel.tsx` — normal Court UI for selecting, validating, reviewing, and activating one JSON file.
- `src/app/App.tsx` — normal-route state machine: Host distribution via JSON; Court receives JSON before Court assignment.
- `src/app/tournament-settings/TournamentSettingsHome.tsx` — operator copy and two-step distribution flow.
- `src/integration/tournament-operations-ux-rehearsal.test.ts` — end-to-end JSON setup plus unchanged result QR/ACK rehearsal.
- `docs/event-day-operations.md` — event-day runbook updated so JSON is the normative Court configuration distribution flow; CONFIG_UPDATE QR is legacy/diagnostic only.

---

### Task 1: Add explicit, atomic cross-tournament imported-config activation

**Files:**
- Modify: `src/config/config-file.ts`
- Modify: `src/config/config-file.test.ts`
- Modify: `src/db/config-repository.ts`
- Modify: `src/db/config-repository.test.ts`

**Interfaces:**
- Consumes: existing `ConfigActivationMetadata`, immutable `ConfigVersionRecord`, `previewRegression()`, `activateVersion()` validation semantics.
- Produces:

```ts
export interface ImportedConfigActivationOptions {
  allowTournamentSwitch?: boolean
}

export function activateImportedConfigFile(
  repository: ConfigFileRepository,
  configVersionId: string,
  activation: ConfigActivationMetadata,
  options?: ImportedConfigActivationOptions,
): Promise<AppliedConfigVersion>

activateVersionForHost(
  configVersionId: string,
  activation: ConfigActivationMetadata,
  options?: { allowTournamentSwitch?: boolean },
): Promise<AppliedConfigVersion>
```

- [ ] **Step 1: Extend `config-file.test.ts` with explicit-switch policy tests**

Keep the existing test that rejects a different tournament with no option. Add a second test using the same imported Tournament B fixture:

```ts
await expect(activateImportedConfigFile(
  repository,
  imported.configVersionId,
  { operator: 'コート担当', activatedAt: '2026-08-24T12:00:00.000Z' },
  { allowTournamentSwitch: true },
)).resolves.toMatchObject({ version: imported.version })

expect(repository.activateVersionForHost).toHaveBeenCalledWith(
  imported.configVersionId,
  expect.objectContaining({ operator: 'コート担当' }),
  { allowTournamentSwitch: true },
)
```

The test repository still returns PASS for every ScoringTestCase so the assertion proves the switch option is only reached after fresh regression.

- [ ] **Step 2: Run the focused config-file tests and verify RED**

```bash
npm test -- src/config/config-file.test.ts --run
```

Expected: FAIL because the fourth argument and repository option are not implemented.

- [ ] **Step 3: Add repository integration tests for default rejection and explicit replacement**

In `src/db/config-repository.test.ts`, create Tournament A as the current Host tournament. Add one Result, one ResultRevision, and one TransferBatch row for A using existing test helpers/fixtures. Import Tournament B v1 into `configVersions` without activating it.

First assert:

```ts
await expect(repository.activateVersionForHost(configBId, activation))
  .rejects.toThrow(/explicit tournament switch|required|tournament mismatch/i)
expect((await repository.getHostTournament())?.tournamentId).toBe(tournamentAId)
```

Then explicitly switch:

```ts
await repository.activateVersionForHost(
  configBId,
  activation,
  { allowTournamentSwitch: true },
)

expect((await repository.getHostTournament())?.tournamentId).toBe(tournamentBId)
expect((await repository.getActiveVersion(tournamentBId))?.configVersionId).toBe(configBId)
expect(await db.results.count()).toBe(resultCountBefore)
expect(await db.resultRevisions.count()).toBe(revisionCountBefore)
expect(await db.transferBatches.count()).toBe(transferCountBefore)
```

Also assert there is exactly one row in `db.tournaments` after the switch.

- [ ] **Step 4: Run the repository test and verify RED**

```bash
npm test -- src/db/config-repository.test.ts --run
```

Expected: the explicit-switch test fails because `activateVersionForHost()` currently rejects different tournaments.

- [ ] **Step 5: Extract normalized-config deletion into one helper**

Refactor the deletion half of `replaceNormalizedRows()` into:

```ts
private async deleteNormalizedRowsForTournament(tournamentId: TournamentId): Promise<void>
```

It deletes only normalized configuration rows associated with the supplied tournament from:

```text
tournaments
teams
competitions
competitionEntries
courtStations
scheduleSlots
courtRuns
scoringSessions
inputSchemas
scoringProfiles
scoringTestCases
resultEntryPolicies
```

It must not delete `configVersions`, `results`, `resultRevisions`, `conflictResolutions`, `transferBatches`, `receivedQrParts`, `acknowledgements`, `revisionDeliveries`, `operators`, `auditEvents`, `localSettings`, or `appMeta`.

Update `replaceNormalizedRows()` to call this helper before writing the target snapshot.

- [ ] **Step 6: Refactor activation so an explicit switch is one Dexie transaction**

Introduce a private activation helper that accepts the already-loaded record plus an optional previous tournament ID:

```ts
private async activateVersionRecord(
  record: ConfigVersionRecord,
  expectedTournamentId: TournamentId,
  activation: ConfigActivationMetadata,
  switchFromTournamentId?: TournamentId,
): Promise<AppliedConfigVersion>
```

This helper performs all mutation in one transaction over `normalizedConfigTables()` plus `auditEvents`:

1. Validate activation metadata and target identity exactly as `activateVersion()` does now.
2. If `switchFromTournamentId` is present, call `deleteNormalizedRowsForTournament(switchFromTournamentId)`.
3. Call `replaceNormalizedRows(targetSnapshot)`.
4. Add exactly one audit event.

Audit metadata for a switch must contain:

```ts
{
  action: 'EXPLICIT_TOURNAMENT_SWITCH',
  previousTournamentId: switchFromTournamentId,
  tournamentId: record.tournamentId,
  configVersionId: record.configVersionId,
  operator: activation.operator,
  activatedAt: activation.activatedAt,
  deviceId: activation.deviceId,
  version: record.version,
}
```

Normal same-tournament activation keeps `action: 'EXPLICIT_ACTIVATION'`.

`activateVersion()` should load the record and delegate to this helper with no switch source. `activateVersionForHost()` should reject mismatched tournaments unless `options?.allowTournamentSwitch === true`; on explicit approval it delegates with `switchFromTournamentId = hostTournament.tournamentId` and `expectedTournamentId = record.tournamentId`.

Do not call `resetAllPersistentData()`.

- [ ] **Step 7: Forward switch intent through `activateImportedConfigFile()` only after existing gates**

Preserve all current validation, ScoringTestCase coverage, regression PASS, and approval-provenance checks. Replace the final activation call with:

```ts
return repository.activateVersionForHost(
  configVersionId,
  activation,
  { allowTournamentSwitch: options?.allowTournamentSwitch === true },
)
```

Do not let `allowTournamentSwitch` bypass any scoring validation.

- [ ] **Step 8: Run core tests and typecheck**

```bash
npm test -- src/config/config-file.test.ts src/db/config-repository.test.ts --run
npm run typecheck
```

Expected: PASS, including default rejection, explicit replacement, preserved Result/Revision/TransferBatch rows, and existing regression-gate tests.

- [ ] **Step 9: Commit**

```bash
git add src/config/config-file.ts src/config/config-file.test.ts src/db/config-repository.ts src/db/config-repository.test.ts
git commit -m "feat: add explicit tournament config switching"
```

---

### Task 2: Add the shared JSON distribution service and browser download primitive

**Files:**
- Create: `src/app/config-distribution-service.ts`
- Create: `src/app/config-distribution-service.test.ts`
- Create: `src/app/json-file-download.ts`
- Create: `src/app/json-file-download.test.ts`

**Interfaces:**
- Consumes: Task 1 `activateImportedConfigFile(..., options)`, existing `serializeTournamentConfigFile()`, `importTournamentConfigFile()`.
- Produces:

```ts
export interface TournamentConfigSummary {
  tournamentId: string
  tournamentName: string
  configVersionId: string
  version: number
  eventDate?: string
  competitionCount: number
  courtCount: number
}

export interface ExportedTournamentConfigFile {
  fileName: string
  json: string
  summary: TournamentConfigSummary
}

export interface ImportedTournamentConfigFile {
  configVersionId: string
  summary: TournamentConfigSummary
  currentTournament: TournamentConfigSummary | null
  tournamentSwitchRequired: boolean
}

export interface ConfigDistributionServices {
  loadActiveSummary(): Promise<TournamentConfigSummary | null>
  exportActiveFile(): Promise<ExportedTournamentConfigFile>
  importJson(json: string): Promise<ImportedTournamentConfigFile>
  activate(
    configVersionId: string,
    activation: ConfigActivationMetadata,
    options?: { allowTournamentSwitch?: boolean },
  ): Promise<AppliedConfigVersion>
}

export function buildTournamentConfigFileName(
  summary: Pick<TournamentConfigSummary, 'version' | 'eventDate'>,
): string

export function createConfigDistributionServices(db: AppDatabase): ConfigDistributionServices
export function downloadJsonFile(file: { fileName: string; json: string }): void
```

- [ ] **Step 1: Write failing service tests for active export and staged import**

Use real temporary databases. Apply a valid Host snapshot with `eventDate: '2026-09-01'`, then:

```ts
const services = createConfigDistributionServices(hostDb)
const exported = await services.exportActiveFile()

expect(exported.fileName).toBe('kaisei-kspo-2026-config-v1.json')
expect(exported.summary).toMatchObject({
  tournamentName: '開成運動交流祭',
  version: 1,
  eventDate: '2026-09-01',
  competitionCount: snapshot.competitions.length,
  courtCount: snapshot.courtStations.length,
})
expect(parseTournamentConfigFile(exported.json).configVersionId)
  .toBe(exported.summary.configVersionId)
```

Export twice and assert parsing both JSON strings yields equal `ConfigVersionRecord`s.

On an empty Court DB:

```ts
const staged = await createConfigDistributionServices(courtDb).importJson(exported.json)
expect(staged.tournamentSwitchRequired).toBe(false)
expect(await new ConfigRepository(courtDb).getHostTournament()).toBeUndefined()
expect(await new ConfigRepository(courtDb).getVersionById(staged.configVersionId)).toBeDefined()
```

- [ ] **Step 2: Run the service tests and verify RED**

```bash
npm test -- src/app/config-distribution-service.test.ts --run
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement summary, filename, export, import, and activation façade**

Derive summaries only from immutable `ConfigVersionRecord`s:

```ts
function summarize(record: ConfigVersionRecord): TournamentConfigSummary {
  return {
    tournamentId: record.tournamentId,
    tournamentName: record.snapshot.tournament.name,
    configVersionId: record.configVersionId,
    version: record.version,
    eventDate: record.snapshot.tournament.eventDate,
    competitionCount: record.snapshot.competitions.length,
    courtCount: record.snapshot.courtStations.length,
  }
}
```

Filename logic:

```ts
export function buildTournamentConfigFileName(
  summary: Pick<TournamentConfigSummary, 'version' | 'eventDate'>,
): string {
  const eventYear = summary.eventDate?.match(/^(\d{4})-/)?.[1]
  const year = eventYear ?? String(new Date().getFullYear())
  return `kaisei-kspo-${year}-config-v${summary.version}.json`
}
```

`exportActiveFile()` calls `getHostTournament()` → `getActiveVersion()` → `serializeTournamentConfigFile()` and returns one `{ fileName, json, summary }` object.

`importJson()` calls `importTournamentConfigFile()` only. It then inspects the current active Host tournament/version and returns a staged summary plus `tournamentSwitchRequired`; it must not call activation.

`activate()` delegates to Task 1's `activateImportedConfigFile()`.

- [ ] **Step 4: Add and run browser download tests**

Mock `URL.createObjectURL`, `URL.revokeObjectURL`, and `HTMLAnchorElement.prototype.click`. Assert:

```ts
downloadJsonFile({ fileName: 'kaisei-kspo-2026-config-v1.json', json: '{"ok":true}' })
expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
expect(click).toHaveBeenCalledOnce()
expect(URL.revokeObjectURL).toHaveBeenCalledOnce()
```

Read the passed Blob and assert `blob.type === 'application/json'` and text equals the supplied JSON.

- [ ] **Step 5: Implement `json-file-download.ts`**

```ts
export function downloadJsonFile({ fileName, json }: { fileName: string; json: string }): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 6: Run Task 2 tests and typecheck**

```bash
npm test -- src/app/config-distribution-service.test.ts src/app/json-file-download.test.ts --run
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/config-distribution-service.ts src/app/config-distribution-service.test.ts src/app/json-file-download.ts src/app/json-file-download.test.ts
git commit -m "feat: add JSON config distribution service"
```

---

### Task 3: Replace Host configuration QR distribution with one JSON download

**Files:**
- Create: `src/app/HostConfigDistributionPanel.tsx`
- Create: `src/app/HostConfigDistributionPanel.test.tsx`
- Modify: `src/app/tournament-settings/TournamentSettingsHome.tsx`
- Modify: `src/app/tournament-settings/TournamentSettingsHome.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- Consumes: Task 2 `ConfigDistributionServices.exportActiveFile()` and `downloadJsonFile()`.
- Produces:

```ts
export function HostConfigDistributionPanel({
  services,
  saveFile = downloadJsonFile,
}: {
  services: Pick<ConfigDistributionServices, 'exportActiveFile'>
  saveFile?: (file: { fileName: string; json: string }) => void
})
```

- [ ] **Step 1: Write the Host panel failing test**

Mock `exportActiveFile()` to return `kaisei-kspo-2026-config-v1.json`. Assert:

```ts
expect(screen.getByRole('heading', { name: '大会設定を配布' })).toBeInTheDocument()
expect(screen.getByText(/全コート端末に同じファイル/)).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '大会設定 JSON を保存' }))
await waitFor(() => expect(saveFile).toHaveBeenCalledWith({
  fileName: 'kaisei-kspo-2026-config-v1.json',
  json: expect.stringContaining('KAISEI_TOURNAMENT_CONFIG'),
}))
expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
```

- [ ] **Step 2: Run the Host panel test and verify RED**

```bash
npm test -- src/app/HostConfigDistributionPanel.test.tsx --run
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the Host panel**

Use MUI `Stack`, `Typography`, `Button`, and `Alert`. On click: clear old error, call `exportActiveFile()`, call `saveFile({ fileName, json })`, then show `大会設定 JSON を保存しました。全コート端末に同じファイルを渡してください。`.

On failure show `大会設定 JSON を保存できませんでした。` without displaying a raw JSON textarea.

- [ ] **Step 4: Update `TournamentSettingsHome` from QR-centric to distribution-centric copy**

Change the distribution card action label from `QRを表示` to `配布する`.

On the distribution view use:

```text
コート端末への配布
1. 大会設定 JSON を保存・共有
2. 担当コートを割り当て
```

Keep `CourtAssignmentQrPanel` unchanged in step 2.

Update `TournamentSettingsHome.test.tsx` to click `配布する` and assert the JSON-sharing content is rendered before `コート配布用QR`.

- [ ] **Step 5: Replace Host `ConfigUpdatePanel` normal-route wiring in `App.tsx`**

Add:

```ts
const browserConfigDistributionServices = useMemo(
  () => createConfigDistributionServices(appDatabase),
  [appDatabase],
)
const configDistributionServices = injectedConfigDistributionServices ?? browserConfigDistributionServices
```

Add this optional App prop for tests:

```ts
configDistributionServices?: ConfigDistributionServices
```

Use:

```tsx
distributionManagement={
  <HostConfigDistributionPanel services={configDistributionServices} />
}
```

Keep `ConfigFilePanel` as `advancedManagement`.

Remove Host normal-route imports/state for `ConfigUpdatePanel`/`createConfigUpdateService` once Task 4 removes the Court usage too; until Task 4, leave the Court-specific wiring compiling.

- [ ] **Step 6: Update Host App tests**

In `App.test.tsx`, inject `configDistributionServices` where necessary. After opening an active Host tournament and `コート端末への配布`, assert:

```ts
expect(screen.getByRole('button', { name: '大会設定 JSON を保存' })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: '大会設定QRを表示' })).not.toBeInTheDocument()
expect(screen.getByLabelText('コート配布用QR')).toBeInTheDocument()
```

Do not alter the Host `QR受信` tab; it is for result QR receipt and remains part of normal operation.

- [ ] **Step 7: Run Host UI tests and typecheck**

```bash
npm test -- src/app/HostConfigDistributionPanel.test.tsx src/app/tournament-settings/TournamentSettingsHome.test.tsx src/app/App.test.tsx --run
npm run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/HostConfigDistributionPanel.tsx src/app/HostConfigDistributionPanel.test.tsx src/app/tournament-settings/TournamentSettingsHome.tsx src/app/tournament-settings/TournamentSettingsHome.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: distribute tournament config as JSON"
```

---

### Task 4: Make JSON import the Court configuration entry flow

**Files:**
- Create: `src/app/CourtConfigImportPanel.tsx`
- Create: `src/app/CourtConfigImportPanel.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.court-config-availability.test.tsx`
- Modify: `src/app/App.test.tsx`
- Keep unchanged: `src/app/court/CourtAssignmentPanel.tsx`
- Keep unchanged: `src/app/court-assignment-service.ts`
- Keep unchanged: `src/app/ConfigUpdatePanel.tsx`
- Keep unchanged: `src/app/config-update-service.ts`

**Interfaces:**
- Consumes: Task 2 `ConfigDistributionServices.importJson()` / `activate()`.
- Produces:

```ts
export function CourtConfigImportPanel({
  services,
  operatorName,
  deviceId,
  now = () => new Date().toISOString(),
  onActivated,
}: {
  services: Pick<ConfigDistributionServices, 'importJson' | 'activate'>
  operatorName: string
  deviceId: string
  now?: () => string
  onActivated: (result: {
    tournamentId: string
    configVersionId: string
    version: number
  }) => void
})
```

- [ ] **Step 1: Write stage-before-activate Court panel tests**

Select a synthetic `File` named `kaisei-kspo-2026-config-v1.json`. The panel must call `importJson(await file.text())` automatically, display the staged summary, and not activate yet:

```ts
expect(await screen.findByText('開成運動交流祭')).toBeInTheDocument()
expect(screen.getByText('Config v1')).toBeInTheDocument()
expect(screen.getByText('競技 6')).toBeInTheDocument()
expect(screen.getByText('コート 4')).toBeInTheDocument()
expect(services.activate).not.toHaveBeenCalled()
```

After pressing `この大会設定を使用`, assert `activate()` and `onActivated()` are called.

- [ ] **Step 2: Write invalid/unsupported/activation-error message tests**

For parser/validation failure, primary alert:

```text
大会設定ファイルを読み込めませんでした。正しい JSON ファイルを選択してください。
```

For unsupported schema version:

```text
この大会設定ファイルは、このアプリのバージョンでは使用できません。
```

For activation failure:

```text
大会設定を有効化できませんでした。現在の設定は変更されていません。
```

Every failure case asserts `onActivated` is not called.

- [ ] **Step 3: Write explicit different-tournament confirmation test**

Mock staged data with current Tournament A and imported Tournament B:

```ts
{
  configVersionId: 'config-b-v1',
  summary: {
    tournamentId: 'b', tournamentName: '大会B', configVersionId: 'config-b-v1',
    version: 1, competitionCount: 6, courtCount: 4,
  },
  currentTournament: {
    tournamentId: 'a', tournamentName: '大会A', configVersionId: 'config-a-v1',
    version: 1, competitionCount: 6, courtCount: 4,
  },
  tournamentSwitchRequired: true,
}
```

Assert both tournament names are visible. `この大会設定を使用` stays disabled until the checkbox `大会Bへ切り替えることを確認しました` is checked. Then assert:

```ts
expect(services.activate).toHaveBeenCalledWith(
  'config-b-v1',
  expect.objectContaining({ operator: 'コート担当' }),
  { allowTournamentSwitch: true },
)
```

Same-tournament activation calls with `{ allowTournamentSwitch: false }`.

- [ ] **Step 4: Run the Court panel tests and verify RED**

```bash
npm test -- src/app/CourtConfigImportPanel.test.tsx --run
```

Expected: FAIL because the component does not exist.

- [ ] **Step 5: Implement `CourtConfigImportPanel`**

Use:

```tsx
<input type="file" accept="application/json,.json" />
```

Selecting a file clears previous staged state/errors, reads text, and stages it through `services.importJson()`. Do not show a raw JSON textarea in this operator flow.

After successful activation show:

```text
大会設定を有効化しました。続けて担当コートを設定してください。
```

Then call `onActivated()` using the staged `tournamentId`, `configVersionId`, and activation result version.

- [ ] **Step 6: Reorder Court normal flow in `App.tsx`**

Use this state order:

```tsx
!courtSnapshot ? (
  <CourtConfigImportPanel
    services={configDistributionServices}
    operatorName={operatorName}
    deviceId={deviceId}
    onActivated={handleCourtConfigActivated}
  />
) : !courtAssignment ? (
  <CourtAssignmentPanel ... />
) : courtEntryTask ? (
  <ResultEntryScreen ... />
) : (
  <CourtTaskHome ... />
)
```

`handleCourtConfigActivated` must set `activeTournamentId`, `knownConfigVersion`, and `knownConfigVersionId`, then call `refreshCourtState()`.

Delete the normal Court rendering of `<ConfigUpdatePanel mode="COURT" ...>`.

Now remove these obsolete App-only dependencies and state hooks:

```text
ConfigUpdatePanel import
ConfigUpdatePanelServices import
createConfigUpdateService import
configUpdateServices App prop
browserConfigUpdateServices/configUpdateServices memo state
handleConfigUpdateActivated
```

Do not delete the underlying ConfigUpdate component/service/protocol files or tests.

Keep `TransferDemo mode="COURT"` and `CourtTransferHistory` unchanged because result QR transfer remains normal operation.

- [ ] **Step 7: Update App tests from Config Update QR activation to JSON activation**

In `App.test.tsx`, remove the `ConfigUpdatePanelServices` fixture and replace it with a `ConfigDistributionServices` fixture that stages/activates `config-v2`.

Replace the existing test `synchronizes App config diagnostics after Court Config Update activation` with a JSON equivalent:

1. Enter Court mode.
2. Select the JSON file.
3. Press `この大会設定を使用`.
4. Assert status bar shows `Config v2`.
5. Assert release-gate/diagnostics behavior still sees `config-v2`.

Also update the empty-Court test to assert:

```ts
expect(await screen.findByRole('heading', { name: '大会設定を受け取る' })).toBeInTheDocument()
expect(screen.getByLabelText('大会設定 JSON を選択')).toBeInTheDocument()
expect(screen.queryByRole('button', { name: 'カメラで大会設定QRを読み取る' })).not.toBeInTheDocument()
```

- [ ] **Step 8: Preserve the already-active Court path**

`App.court-config-availability.test.tsx` must continue proving that a Court device with an active configuration goes directly to `担当コートを設定してください` without re-importing JSON.

Add a second test for an empty Court: first show `大会設定を受け取る`; after staged JSON activation, show `担当コートを設定してください`.

- [ ] **Step 9: Run Court UI tests and typecheck**

```bash
npm test -- src/app/CourtConfigImportPanel.test.tsx src/app/App.court-config-availability.test.tsx src/app/App.test.tsx --run
npm run typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/app/CourtConfigImportPanel.tsx src/app/CourtConfigImportPanel.test.tsx src/app/App.tsx src/app/App.court-config-availability.test.tsx src/app/App.test.tsx
git commit -m "feat: receive tournament config from JSON on Court"
```

---

### Task 5: Convert the executable rehearsal and event-day runbook to JSON distribution

**Files:**
- Modify: `src/integration/tournament-operations-ux-rehearsal.test.ts`
- Modify: `docs/event-day-operations.md`
- Exercise unchanged code indirectly: `src/transfer/codec.ts`, `src/transfer/ack.ts`, `src/transfer/court-assignment.ts`

**Interfaces:**
- Consumes: Task 2 `createConfigDistributionServices()`, existing Court assignment, Result/Revision transfer, Host import, scoring, and ACK paths.
- Produces: executable acceptance evidence for Spec §§13–14 and an operator runbook matching the new normal flow.

- [ ] **Step 1: Rewrite the primary offline lifecycle from CONFIG_UPDATE QR to JSON**

Remove `createConfigUpdateService` from `tournament-operations-ux-rehearsal.test.ts`. After Host apply:

```ts
const hostDistribution = createConfigDistributionServices(hostDb)
const exported = await hostDistribution.exportActiveFile()
expect(exported.fileName).toBe('kaisei-kspo-2026-config-v1.json')

const courtDistribution = createConfigDistributionServices(courtDb)
const staged = await courtDistribution.importJson(exported.json)
expect(await new ConfigRepository(courtDb).getHostTournament()).toBeUndefined()

await courtDistribution.activate(staged.configVersionId, {
  operator: 'コート担当',
  activatedAt: '2026-08-24T00:12:00+09:00',
})
```

Leave assignment → task entry → Result/Revision → result QR → Host import → scoring → ACK → completed assertions unchanged.

- [ ] **Step 2: Rewrite the two-Court conflict rehearsal to use one identical JSON file**

Export exactly once from Host. Call `importJson(exported.json)` separately on `courtA` and `courtB`, activate both, and assert both active ConfigVersion IDs equal the Host active ConfigVersion ID.

Continue using the existing single `COURT_ASSIGNMENT` QR payload and the existing same-Result/different-Revision conflict assertions.

Add a direct assertion that the two Court devices can save different `CourtAssignment` rows while the original `exported.json` string remains unchanged.

- [ ] **Step 3: Add a distribution acceptance assertion with no configuration-frame loop**

The configuration-distribution section of the rehearsal must use one `ExportedTournamentConfigFile` object and contain no call to `encodeConfigUpdateFrames`, no `exportVersion(...frames)`, and no loop ingesting configuration QR parts.

Do not remove result QR fragmentation. The same test must still call `encodeBatchFragments()` for results and `encodeAck()` for ACK.

- [ ] **Step 4: Update `docs/event-day-operations.md` normative operator flow**

Make these concrete edits:

1. In **Preflight**, add: `Distribute the same approved tournament configuration JSON file to every Court device and confirm the ConfigVersion ID matches after activation.`
2. At the start of **Court**, add: `If no tournament is active, select the Host-provided .json file, validate it, explicitly activate it, then set the assigned Court by QR or manual selection.`
3. Rename **Config update → Config file import/export on Host** to **Tournament configuration JSON distribution** and document the normal Host-save / Court-select / explicit-activate flow.
4. Rename **CONFIG_UPDATE QR to Court** to **Legacy/diagnostic CONFIG_UPDATE QR** and state it is not the normal event-day distribution path.
5. In **Manual physical rehearsal**, replace `Exercise CONFIG_UPDATE QR persistence and explicit activation...` with `Export one approved JSON file from Host, import that exact file on every Court, activate it, then assign each Court by assignment QR/manual selection.`
6. In the **Coverage matrix**, update supplemental row 21 so evidence includes `config-distribution-service.test.ts`, `HostConfigDistributionPanel.test.tsx`, and `CourtConfigImportPanel.test.tsx` and the manual gate describes JSON distribution.
7. In **Automated scenario index**, replace `CONFIG_UPDATE persistence/explicit activation` as the normal config-distribution claim with `JSON configuration export/staged import/explicit activation`; mention CONFIG_UPDATE only as retained legacy protocol coverage.

Do not change result QR, ACK, backup, recovery, Service Worker, or Display instructions except where they reference the old normal config-distribution method.

- [ ] **Step 5: Run both rehearsal suites**

```bash
npm test -- src/integration/tournament-operations-ux-rehearsal.test.ts src/integration/event-day-rehearsal.test.ts --run
```

Expected: PASS. The tournament-operations rehearsal proves JSON setup plus existing result QR/ACK lifecycle; event-day rehearsal continues proving persisted QR receive/recovery/conflict behavior.

- [ ] **Step 6: Run full verification**

```bash
npm run typecheck
npm test -- --run
npm run build
```

Expected: all commands exit 0. Existing standalone `ConfigUpdatePanel` and `config-update` protocol tests remain passing even though App no longer mounts that panel in normal routes.

- [ ] **Step 7: Perform the manual operator smoke sequence**

Using `npm run dev` and two browser profiles:

1. Host mode → create/open tournament.
2. 大会設定 → コート端末への配布 → 配布する.
3. Save `kaisei-kspo-<year>-config-v<version>.json`.
4. Open Court mode in a clean browser profile.
5. Select that `.json` file.
6. Confirm tournament name, Config version, competition count, and Court count.
7. Activate it.
8. Confirm `担当コートを設定してください` appears.
9. Scan or manually select one Court.
10. Confirm assigned tasks appear.
11. Save one Result and verify the existing result QR transfer path still works.

At no point in the normal configuration flow should the operator be asked to scan dozens or hundreds of configuration QR frames.

- [ ] **Step 8: Commit**

```bash
git add src/integration/tournament-operations-ux-rehearsal.test.ts docs/event-day-operations.md
git commit -m "test: rehearse JSON tournament config distribution"
```

---

## Final Review Checklist

- Host normal flow downloads one standard `.json` file from the active immutable ConfigVersion.
- Filename ends in `.json` and uses `kaisei-kspo-<year>-config-v<version>.json`.
- The same JSON imports into multiple empty Court databases.
- Import alone never activates.
- Invalid/unsupported/validation-failing JSON never changes active config.
- Same-tournament ConfigVersion activation still runs all existing regression/approval gates.
- Different-tournament activation is rejected by default and requires explicit operator confirmation.
- Explicit tournament switch changes normalized configuration atomically and does not invoke full persistent-data reset.
- Existing Result/Revision/TransferBatch rows are not deleted by the config switch path.
- Court assignment remains device-local and never enters the exported JSON.
- `COURT_ASSIGNMENT` QR remains reusable.
- Result/Revision QR and ACK behavior remains unchanged.
- Host `QR受信` remains normal result-receipt functionality.
- `ConfigUpdatePanel` is absent from normal Host/Court routes, while standalone component/protocol tests remain.
- Event-day runbook names JSON distribution as the normative flow and CONFIG_UPDATE QR as legacy/diagnostic only.
- No custom extension, online dependency, LAN server, new QR codec, ZIP, or encryption layer is introduced.
- `npm run typecheck`, `npm test -- --run`, and `npm run build` pass.
