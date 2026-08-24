# JSON Config Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace multi-frame tournament configuration QR distribution in the normal operator flow with one reusable `.json` configuration file shared to every Court device, while preserving Court assignment QR, result QR, ACK, deterministic scoring, and offline safety.

**Architecture:** Reuse the existing `TournamentConfigFileDocument` serializer/parser/import/activation path as the single configuration-file format. Add a small distribution service that turns the active immutable `ConfigVersionRecord` into a human-downloadable JSON file and stages imported files without activation; add purpose-built Host/Court operator panels around that service. Keep `CONFIG_UPDATE` QR protocol code intact but remove `ConfigUpdatePanel` from normal Host/Court routes. Explicit cross-tournament activation is a separate, confirmed repository operation so a staged file never silently replaces the current active tournament.

**Tech Stack:** React, TypeScript, MUI, Dexie/IndexedDB, Vitest, Testing Library, existing QR transfer modules.

**Spec:** `docs/superpowers/specs/2026-08-24-json-config-distribution-design.md`

## Global Constraints

- The normal tournament configuration distribution format is standard `.json`; do not introduce a custom extension or MIME type.
- All Court devices receive the same configuration file; do not serialize `deviceId`, `CourtAssignment`, unsent Result/Revision state, ACK state, camera state, or other device-local state into the file.
- Continue using the existing `KAISEI_TOURNAMENT_CONFIG` / `schemaVersion: 1` envelope produced by `serializeTournamentConfigFile()`; do not invent a second raw-snapshot format.
- File selection/import and activation are distinct operations. An invalid or rejected file must not change the active tournament/configuration.
- A different `tournamentId` must never activate silently. The UI must show the current and imported tournament and require an explicit switch confirmation.
- Same-tournament new ConfigVersion activation must continue to use the existing regression/approval gates.
- `COURT_ASSIGNMENT`, `RESULT_BATCH`, and ACK transfer semantics remain unchanged.
- `CONFIG_UPDATE` QR protocol and its tests may remain in the codebase, but `ConfigUpdatePanel` must not be part of the normal Host/Court operator flow after this plan.
- No network, LAN server, AirDrop API, Nearby Share API, ZIP, encryption, or new transfer engine is required.
- At execution time, refresh `main` and use the then-current `main` HEAD as source of truth. The design-time baseline was `50f4b8c33c7a5ffa9ac8b40b77ba04d720298f1e`; do not blindly reset to it if `main` has advanced.

---

## File Structure

- `src/config/config-file.ts` — remains the canonical JSON document parser/serializer and activation policy; add explicit switch intent to activation.
- `src/db/config-repository.ts` — add one atomic Host-tournament replacement activation path that removes only the old normalized configuration rows and preserves result/transfer history tables.
- `src/app/config-distribution-service.ts` — new operator-facing service: active summary, JSON export metadata, staged import summary, explicit activation.
- `src/app/json-file-download.ts` — new browser-only utility that downloads text as `application/json` and revokes object URLs.
- `src/app/HostConfigDistributionPanel.tsx` — new Host normal-flow UI for saving one JSON file.
- `src/app/CourtConfigImportPanel.tsx` — new Court normal-flow UI for selecting, validating, summarizing, and explicitly activating a JSON file.
- `src/app/App.tsx` — route the new Host/Court panels into normal flows; keep `ConfigFilePanel` in detailed management; remove normal-flow `ConfigUpdatePanel` rendering.
- `src/app/tournament-settings/TournamentSettingsHome.tsx` — rename distribution action/copy from QR-centric wording to file-distribution wording while retaining Court assignment QR as step 2.
- `src/integration/tournament-operations-ux-rehearsal.test.ts` — convert configuration distribution in the executable rehearsal from multi-frame QR to JSON file import, including identical-file/multiple-Court coverage and existing result QR/ACK coverage.

---

### Task 1: Add the JSON distribution service and browser download primitive

**Files:**
- Create: `src/app/config-distribution-service.ts`
- Create: `src/app/config-distribution-service.test.ts`
- Create: `src/app/json-file-download.ts`
- Create: `src/app/json-file-download.test.ts`
- Reuse: `src/config/config-file.ts`
- Reuse: `src/db/config-repository.ts`

**Interfaces:**
- Consumes: `serializeTournamentConfigFile(record)`, `importTournamentConfigFile(repository, json)`, `activateImportedConfigFile(repository, configVersionId, activation, options)`.
- Produces:

```ts
export interface TournamentConfigSummary {
  tournamentId: string
  tournamentName: string
  configVersionId: string
  version: number
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

export function createConfigDistributionServices(db: AppDatabase): ConfigDistributionServices
export function buildTournamentConfigFileName(summary: Pick<TournamentConfigSummary, 'version'>): string
export function downloadJsonFile(file: Pick<ExportedTournamentConfigFile, 'fileName' | 'json'>): void
```

- [ ] **Step 1: Write failing service tests for deterministic export metadata and staged import**

Add `src/app/config-distribution-service.test.ts` with a real temporary Dexie database. Seed/apply one valid tournament configuration, then assert:

```ts
const services = createConfigDistributionServices(db)
const exported = await services.exportActiveFile()

expect(exported.fileName).toBe('kaisei-kspo-2026-config-v1.json')
expect(exported.summary).toMatchObject({
  tournamentName: '開成運動交流祭',
  version: 1,
  competitionCount: snapshot.competitions.length,
  courtCount: snapshot.courtStations.length,
})
expect(parseTournamentConfigFile(exported.json).configVersionId)
  .toBe(exported.summary.configVersionId)
```

Use `eventDate: '2026-09-01'` so the file-name year is deterministic. Add a second empty Court DB and assert that `importJson(exported.json)` persists the immutable version but leaves `getHostTournament()` undefined until activation.

- [ ] **Step 2: Run the service tests and verify RED**

Run:

```bash
npm test -- src/app/config-distribution-service.test.ts --run
```

Expected: FAIL because `config-distribution-service.ts` and the new interfaces do not exist.

- [ ] **Step 3: Implement summary and file-name helpers plus the service**

Create `src/app/config-distribution-service.ts`. The summary must be derived from the immutable `ConfigVersionRecord`, not from UI state:

```ts
function summarize(record: ConfigVersionRecord): TournamentConfigSummary {
  return {
    tournamentId: record.tournamentId,
    tournamentName: record.snapshot.tournament.name,
    configVersionId: record.configVersionId,
    version: record.version,
    competitionCount: record.snapshot.competitions.length,
    courtCount: record.snapshot.courtStations.length,
  }
}

export function buildTournamentConfigFileName(
  summary: Pick<TournamentConfigSummary, 'version'> & { eventDate?: string },
): string {
  const year = summary.eventDate?.match(/^(\d{4})-/)?.[1] ?? String(new Date().getFullYear())
  return `kaisei-kspo-${year}-config-v${summary.version}.json`
}
```

For production determinism, pass the record's `snapshot.tournament.eventDate` into the helper when exporting; if the event date is absent, use the current calendar year only as a fallback.

`exportActiveFile()` must call `getHostTournament()` → `getActiveVersion()` → `serializeTournamentConfigFile()`. `importJson()` must call `importTournamentConfigFile()` and then inspect the current Host tournament without activating anything. It must return `tournamentSwitchRequired: current !== null && current.tournamentId !== imported.tournamentId`.

`activate()` delegates to `activateImportedConfigFile()` and forwards `allowTournamentSwitch`.

- [ ] **Step 4: Run the service tests and verify GREEN**

Run:

```bash
npm test -- src/app/config-distribution-service.test.ts --run
```

Expected: PASS. Also assert the exported JSON is semantically stable by parsing two successive exports and comparing parsed `ConfigVersionRecord`s.

- [ ] **Step 5: Write failing tests for browser JSON download behavior**

Add `src/app/json-file-download.test.ts` and mock `URL.createObjectURL`, `URL.revokeObjectURL`, and an anchor click. Assert the helper creates a `Blob` with `type: 'application/json'`, sets the exact `.json` filename, clicks once, and revokes the URL.

- [ ] **Step 6: Run the download tests and verify RED**

Run:

```bash
npm test -- src/app/json-file-download.test.ts --run
```

Expected: FAIL because `downloadJsonFile()` is not implemented.

- [ ] **Step 7: Implement the minimal download utility**

Create `src/app/json-file-download.ts`:

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

Do not add Web Share API behavior in this task.

- [ ] **Step 8: Run both Task 1 test files and typecheck**

Run:

```bash
npm test -- src/app/config-distribution-service.test.ts src/app/json-file-download.test.ts --run
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/config-distribution-service.ts src/app/config-distribution-service.test.ts src/app/json-file-download.ts src/app/json-file-download.test.ts
git commit -m "feat: add JSON config distribution service"
```

---

### Task 2: Support explicit, atomic cross-tournament activation without a full data reset

**Files:**
- Modify: `src/config/config-file.ts`
- Modify: `src/config/config-file.test.ts`
- Modify: `src/db/config-repository.ts`
- Modify: `src/db/config-repository.test.ts`

**Interfaces:**
- Consumes: existing `ConfigActivationMetadata`, immutable imported `ConfigVersionRecord`, existing regression/approval validation.
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

// ConfigRepository method used only after explicit UI confirmation.
activateVersionForHost(
  configVersionId: string,
  activation: ConfigActivationMetadata,
  options?: { allowTournamentSwitch?: boolean },
): Promise<AppliedConfigVersion>
```

- [ ] **Step 1: Extend the existing config-file tests with explicit-switch semantics**

Keep the existing test that rejects a different tournament by default. Add a second test:

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

The regression/approval gates must still run before repository activation.

- [ ] **Step 2: Run the focused config-file test and verify RED**

Run:

```bash
npm test -- src/config/config-file.test.ts --run
```

Expected: FAIL because the activation option is not supported.

- [ ] **Step 3: Add repository integration tests for atomic switch behavior**

In `src/db/config-repository.test.ts`, create Tournament A and one saved result/transfer-history row, import Tournament B v1, then explicitly activate B. Assert after activation:

```ts
expect((await repository.getHostTournament())?.tournamentId).toBe(tournamentBId)
expect((await repository.getActiveVersion(tournamentBId))?.configVersionId).toBe(configBId)
expect(await db.results.count()).toBe(resultCountBefore)
expect(await db.resultRevisions.count()).toBe(revisionCountBefore)
expect(await db.transferBatches.count()).toBe(transferCountBefore)
```

Also assert the default call without `{ allowTournamentSwitch: true }` rejects and leaves Tournament A active.

- [ ] **Step 4: Run the repository test and verify RED**

Run:

```bash
npm test -- src/db/config-repository.test.ts --run
```

Expected: the new cross-tournament switch test fails because `activateVersionForHost()` currently rejects mismatched tournaments.

- [ ] **Step 5: Refactor normalized configuration deletion into one private helper**

In `ConfigRepository`, extract the deletion half of `replaceNormalizedRows()` into:

```ts
private async deleteNormalizedRowsForTournament(tournamentId: TournamentId): Promise<void>
```

It must delete only these configuration tables for that tournament: `tournaments`, `teams`, `competitions`, `competitionEntries`, `courtStations`, `scheduleSlots`, `courtRuns`, `scoringSessions`, `inputSchemas`, `scoringProfiles`, `scoringTestCases`, `resultEntryPolicies`.

It must not delete `configVersions`, `results`, `resultRevisions`, `conflictResolutions`, `transferBatches`, `receivedQrParts`, `acknowledgements`, `revisionDeliveries`, `auditEvents`, or local device state.

Update `replaceNormalizedRows()` to call this helper before inserting the new snapshot.

- [ ] **Step 6: Implement one-transaction explicit Host tournament replacement**

Update `activateVersionForHost()` so:

```ts
if (hostTournament && hostTournament.tournamentId !== record.tournamentId && !options?.allowTournamentSwitch) {
  throw new Error('ConfigVersion tournament mismatch; explicit tournament switch required')
}
```

For an allowed switch, perform old normalized-config deletion and target snapshot activation within one Dexie transaction covering `normalizedConfigTables()` plus `auditEvents`. Do not call full `resetAllPersistentData()`.

Record an audit event with `action: 'EXPLICIT_TOURNAMENT_SWITCH'`, `previousTournamentId`, `tournamentId`, `configVersionId`, operator/device/timestamp. Same-tournament activation retains `action: 'EXPLICIT_ACTIVATION'`.

Do not weaken `activateVersion()` tournament identity validation.

- [ ] **Step 7: Forward the option through `activateImportedConfigFile()`**

After all existing fresh regression and approval checks pass, call:

```ts
return repository.activateVersionForHost(configVersionId, activation, {
  allowTournamentSwitch: options?.allowTournamentSwitch === true,
})
```

The default remains `false`.

- [ ] **Step 8: Run config core tests and typecheck**

Run:

```bash
npm test -- src/config/config-file.test.ts src/db/config-repository.test.ts --run
npm run typecheck
```

Expected: PASS, including default reject and explicit-switch cases.

- [ ] **Step 9: Commit**

```bash
git add src/config/config-file.ts src/config/config-file.test.ts src/db/config-repository.ts src/db/config-repository.test.ts
git commit -m "feat: add explicit tournament config switching"
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
- Consumes: `ConfigDistributionServices.exportActiveFile()`, `downloadJsonFile()`.
- Produces: `HostConfigDistributionPanel` normal-flow UI.

```ts
export function HostConfigDistributionPanel({
  services,
  saveFile = downloadJsonFile,
}: {
  services: Pick<ConfigDistributionServices, 'exportActiveFile'>
  saveFile?: (file: Pick<ExportedTournamentConfigFile, 'fileName' | 'json'>) => void
})
```

- [ ] **Step 1: Write the Host panel failing test**

Render the panel with `exportActiveFile()` returning a known file. Assert visible operator copy and one save action:

```ts
expect(screen.getByRole('heading', { name: '大会設定を配布' })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '大会設定 JSON を保存' }))
await waitFor(() => expect(saveFile).toHaveBeenCalledWith({
  fileName: 'kaisei-kspo-2026-config-v1.json',
  json: expect.stringContaining('KAISEI_TOURNAMENT_CONFIG'),
}))
expect(screen.getByText(/全コート端末に同じファイル/)).toBeInTheDocument()
```

Do not expose a raw JSON textarea in this component.

- [ ] **Step 2: Run the Host panel test and verify RED**

Run:

```bash
npm test -- src/app/HostConfigDistributionPanel.test.tsx --run
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement the Host panel**

Use MUI `Stack`, `Typography`, `Button`, `Alert`. On click, call `exportActiveFile()`, pass its `{ fileName, json }` to `saveFile`, and show a short success status. On failure show `大会設定 JSON を保存できませんでした。` and keep the page usable.

- [ ] **Step 4: Update `TournamentSettingsHome` copy and test expectations**

Change the distribution card action from `QRを表示` to `配布する`. On the distribution page keep the two-step layout but use:

```text
1. 大会設定 JSON を保存・共有
2. 担当コートを割り当て
```

The second section continues to render the existing `CourtAssignmentQrPanel` unchanged.

Update `TournamentSettingsHome.test.tsx` to click `配布する` and assert the JSON-sharing heading appears before `コート配布用QR`.

- [ ] **Step 5: Wire the Host normal flow in `App.tsx`**

Create one memoized `configDistributionServices = createConfigDistributionServices(appDatabase)`. Replace only the `distributionManagement` node:

```tsx
distributionManagement={
  <HostConfigDistributionPanel services={configDistributionServices} />
}
```

Keep `ConfigFilePanel` under `advancedManagement` so raw JSON/version operations remain detailed-management functionality.

Do not render `<ConfigUpdatePanel mode="HOST" ...>` in `TournamentSettingsHome` normal distribution flow.

- [ ] **Step 6: Add an App regression assertion**

In `App.test.tsx`, after entering an already-configured Host tournament and opening `コート端末への配布`, assert:

```ts
expect(screen.getByRole('button', { name: '大会設定 JSON を保存' })).toBeInTheDocument()
expect(screen.queryByRole('button', { name: '大会設定QRを表示' })).not.toBeInTheDocument()
expect(screen.getByLabelText('コート配布用QR')).toBeInTheDocument()
```

- [ ] **Step 7: Run Host UI tests and typecheck**

Run:

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

### Task 4: Make JSON import the Court configuration entry flow, then continue to Court assignment

**Files:**
- Create: `src/app/CourtConfigImportPanel.tsx`
- Create: `src/app/CourtConfigImportPanel.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.court-config-availability.test.tsx`
- Modify: `src/app/App.test.tsx`
- Keep unchanged: `src/app/court/CourtAssignmentPanel.tsx`
- Keep unchanged: `src/app/court-assignment-service.ts`

**Interfaces:**
- Consumes: `ConfigDistributionServices.importJson()`, `ConfigDistributionServices.activate()`, App callback to refresh active configuration.
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

- [ ] **Step 1: Write Court import panel tests for stage-before-activate**

Use a synthetic `File` named `kaisei-kspo-2026-config-v1.json`. Selecting it must call `file.text()`/`importJson()` and show the imported summary, but not call `activate()` until the user presses `この大会設定を使用`.

Assert the summary includes tournament name, `Config v1`, competition count, and Court count.

- [ ] **Step 2: Add invalid-file safety and friendly-message tests**

When `importJson()` rejects with parser/validation errors, assert:

```ts
expect(await screen.findByRole('alert')).toHaveTextContent(
  '大会設定ファイルを読み込めませんでした。正しい JSON ファイルを選択してください。',
)
expect(services.activate).not.toHaveBeenCalled()
```

The component may log/store the technical exception internally for diagnostics, but the primary message must be operator-facing.

- [ ] **Step 3: Add explicit different-tournament confirmation test**

Return:

```ts
{
  configVersionId: 'config-b-v1',
  summary: { tournamentId: 'b', tournamentName: '大会B', version: 1, ... },
  currentTournament: { tournamentId: 'a', tournamentName: '大会A', version: 1, ... },
  tournamentSwitchRequired: true,
}
```

Assert the UI displays both `大会A` and `大会B`, and activation is disabled until a checkbox such as `大会Bへ切り替えることを確認しました` is checked. Then assert `activate(..., { allowTournamentSwitch: true })` is used.

For same-tournament import, activation must call `activate(..., { allowTournamentSwitch: false })` or omit the option.

- [ ] **Step 4: Run the Court panel tests and verify RED**

Run:

```bash
npm test -- src/app/CourtConfigImportPanel.test.tsx --run
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 5: Implement the Court panel**

Use `<input type="file" accept="application/json,.json">`. File selection immediately stages/validates the JSON; do not require pasting raw JSON in the normal Court flow. Reset prior staged state if a new file is selected.

After successful activation, show `大会設定を有効化しました。続けて担当コートを設定してください。` and call `onActivated()` with imported identity/version.

Map known error classes/messages to the operator copy from Spec §10. At minimum distinguish invalid JSON/file format, unsupported schema version, validation failure, tournament-switch requirement, and activation failure; activation failure must state that the previous active configuration was kept.

- [ ] **Step 6: Reorder the Court flow in `App.tsx`**

Normal Court flow must become:

```tsx
if (!courtSnapshot) {
  <CourtConfigImportPanel ... onActivated={handleCourtConfigActivated} />
} else if (!courtAssignment) {
  <CourtAssignmentPanel hasActiveConfig ... />
} else if (courtEntryTask) {
  <ResultEntryScreen ... />
} else {
  <CourtTaskHome ... />
}
```

`handleCourtConfigActivated` must update `activeTournamentId`, `knownConfigVersion`, and `knownConfigVersionId`, then call `refreshCourtState()` so the next visible primary action is Court assignment.

Remove normal-flow rendering of `<ConfigUpdatePanel mode="COURT" ...>`.

Keep `TransferDemo` and `CourtTransferHistory` behavior unchanged.

- [ ] **Step 7: Update Court availability integration tests**

`App.court-config-availability.test.tsx` currently verifies that a Court can use a config already active in the same browser DB. Preserve that assertion.

Add a new App-level test using an empty Court state that asserts the first main heading/action is `大会設定を受け取る` / `大会設定 JSON を選択`, not `担当コートを設定してください` and not `カメラで大会設定QRを読み取る`.

After simulating JSON activation through injected/mocked distribution services or a real database test harness, assert `担当コートを設定してください` appears.

- [ ] **Step 8: Run Court UI tests and typecheck**

Run:

```bash
npm test -- src/app/CourtConfigImportPanel.test.tsx src/app/App.court-config-availability.test.tsx src/app/App.test.tsx --run
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/CourtConfigImportPanel.tsx src/app/CourtConfigImportPanel.test.tsx src/app/App.tsx src/app/App.court-config-availability.test.tsx src/app/App.test.tsx
git commit -m "feat: receive tournament config from JSON on Court"
```

---

### Task 5: Convert the executable offline rehearsal to JSON configuration distribution and prove QR regressions are absent

**Files:**
- Modify: `src/integration/tournament-operations-ux-rehearsal.test.ts`
- Modify if operator documentation currently instructs config QR as normal flow: `docs/event-day-operations.md`
- Test existing unchanged protocol modules indirectly: `src/transfer/codec.ts`, `src/transfer/ack.ts`, `src/transfer/court-assignment.ts`

**Interfaces:**
- Consumes: `createConfigDistributionServices()`, existing Court assignment service, existing Result/Revision transfer and ACK pipeline.
- Produces: executable acceptance evidence for Spec §§13–14.

- [ ] **Step 1: Rewrite the rehearsal setup path from CONFIG_UPDATE QR to JSON**

Replace imports/usages of `createConfigUpdateService` in `tournament-operations-ux-rehearsal.test.ts` with `createConfigDistributionServices`.

For the primary lifecycle test:

```ts
const hostDistribution = createConfigDistributionServices(hostDb)
const exported = await hostDistribution.exportActiveFile()
expect(exported.fileName.endsWith('.json')).toBe(true)

const courtDistribution = createConfigDistributionServices(courtDb)
const staged = await courtDistribution.importJson(exported.json)
expect(await new ConfigRepository(courtDb).getHostTournament()).toBeUndefined()
await courtDistribution.activate(staged.configVersionId, {
  operator: 'コート担当',
  activatedAt: '2026-08-24T00:12:00+09:00',
})
```

Then leave assignment → task entry → result QR → Host import → scoring → ACK → completed assertions unchanged.

- [ ] **Step 2: Rewrite the two-Court conflict rehearsal to import the exact same JSON twice**

Export one JSON string from Host, import that exact string into `courtA` and `courtB`, activate both, then continue using the existing single `COURT_ASSIGNMENT` QR payload and conflict/no-double-score assertions.

Add:

```ts
expect((await new ConfigRepository(courtA).getActiveVersion(snapshot.tournament.tournamentId))?.configVersionId)
  .toBe(active!.configVersionId)
expect((await new ConfigRepository(courtB).getActiveVersion(snapshot.tournament.tournamentId))?.configVersionId)
  .toBe(active!.configVersionId)
```

After assigning different Courts in an additional small test or within the lifecycle setup, assert local assignments can differ while `exported.json` remains byte-for-byte unchanged.

- [ ] **Step 3: Add an acceptance assertion that normal config distribution does not generate QR frames**

Do not assert an arbitrary maximum config size. Instead assert the distribution service contract itself returns one `{ fileName, json }` object and never calls `encodeConfigUpdateFrames`/`createConfigUpdateService`. The executable path must contain no loop over configuration QR frames.

The result-transfer path must still generate QR frames through `encodeBatchFragments()` and ACK through `encodeAck()`.

- [ ] **Step 4: Update the event-day runbook wording if required**

If `docs/event-day-operations.md` currently says initial Court configuration is transferred by Config Update QR, change that operator instruction to:

```text
Host: save the active tournament configuration as a JSON file and distribute the same file to every Court device.
Court: select the JSON file, validate it, activate it, then scan/select the assigned Court.
```

Keep any Config Update QR troubleshooting/reference section clearly labeled as legacy/emergency/diagnostic rather than normal flow.

- [ ] **Step 5: Run the rehearsal tests**

Run:

```bash
npm test -- src/integration/tournament-operations-ux-rehearsal.test.ts src/integration/event-day-rehearsal.test.ts --run
```

Expected: PASS. The first rehearsal proves JSON setup + existing result QR/ACK lifecycle; the second continues proving persisted QR receive/recovery/conflict behavior.

- [ ] **Step 6: Run the full verification suite**

Run:

```bash
npm run typecheck
npm test -- --run
npm run build
```

Expected: all commands exit 0. If any existing ConfigUpdatePanel/unit protocol tests fail only because normal UI no longer mounts the panel, update only the UI-routing expectation; do not delete protocol coverage.

- [ ] **Step 7: Manual operator smoke check**

With `npm run dev`, perform exactly this sequence in browser profiles or separate browsers:

1. Host mode → create/open tournament.
2. 大会設定 → コート端末への配布 → 配布する.
3. Save `kaisei-kspo-<year>-config-v<version>.json`.
4. Open Court mode in a clean browser profile.
5. Select that `.json` file.
6. Confirm tournament/config summary.
7. Activate it.
8. Confirm `担当コートを設定してください` appears.
9. Scan or manually choose one Court.
10. Confirm assigned task list appears.
11. Save one result and verify the existing result QR path still works.

The normal flow must never ask the operator to scan dozens/hundreds of configuration QR frames.

- [ ] **Step 8: Commit**

```bash
git add src/integration/tournament-operations-ux-rehearsal.test.ts docs/event-day-operations.md
git commit -m "test: rehearse JSON tournament config distribution"
```

---

## Final Review Checklist

Before opening the implementation PR, verify all of the following against `docs/superpowers/specs/2026-08-24-json-config-distribution-design.md`:

- Host normal flow downloads one standard `.json` file from the active immutable ConfigVersion.
- The same JSON imports into multiple empty Court databases.
- Import alone never activates.
- Invalid/unsupported/validation-failing JSON never changes the active config.
- Same-tournament ConfigVersion updates still run regression/approval gates.
- Different-tournament activation is rejected by default and requires explicit operator confirmation.
- Explicit tournament switch is atomic for normalized config and does not invoke full persistent-data reset.
- Court assignment remains device-local and is not serialized into the JSON.
- `CourtAssignmentQrPanel`/`COURT_ASSIGNMENT` payload remains reusable.
- Result/Revision QR transfer and ACK remain unchanged and pass rehearsal tests.
- `ConfigUpdatePanel` is absent from normal Host/Court routes; protocol code/tests may remain.
- No custom file extension, online dependency, LAN server, new QR codec, ZIP, or encryption layer was added.
- `npm run typecheck`, `npm test -- --run`, and `npm run build` all pass.
