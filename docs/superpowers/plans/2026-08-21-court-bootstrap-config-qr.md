# Court Bootstrap and Config QR Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Headquarters distribute one common active tournament configuration to any Court device through a real QR display, let a fresh Court device scan and activate it in one continuous camera session, then require a local Court responsibility selection before production scoring appears.

**Architecture:** Preserve the existing versioned `CONFIG_UPDATE` payload, frame codec, transfer repository, validation, import, and explicit activation semantics. Add visual QR rendering and a reusable ZXing camera component, enrich the config-update service with scan progress/summary data, and introduce a `CourtModeScreen` gate backed by an explicit local allowed-ScoringSession set in `localSettings`. A single Headquarters export is common to every Court device; physical QR frames are static when `N=1` and automatically cycle at 900 ms when `N>1`.

**Tech Stack:** React, TypeScript, Material UI, Dexie/IndexedDB, `@zxing/browser`, `qrcode.react@4.2.0`, Vitest, Testing Library, fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-08-21-display-and-court-bootstrap-design.md`

## Global Constraints

- The application remains fully offline after installation; QR rendering and scanning must require no runtime network access.
- Headquarters exports the currently active immutable `ConfigVersion`.
- The same Headquarters distribution is used for every Court/replacement device.
- One operator scan session may contain one or many physical QR frames.
- Multi-frame QR display interval is exactly `900 ms` unless changed by a later evidence-backed design revision.
- Imported ConfigVersions remain inactive until the operator explicitly selects `この大会を使用`.
- A fresh Court device must not expose production scoring controls until configuration is active and a valid local responsibility set exists.
- Court responsibility is local device state, not part of `TournamentConfigSnapshot` or `ConfigVersion`.
- A later ConfigVersion update keeps the stored responsibility only when every stored `ScoringSessionId` still exists; otherwise the device returns to `CONFIGURED_UNASSIGNED`.
- Existing Result/Revision, result QR transfer, ACK, backup/restore, scoring, and ConfigVersion integrity semantics remain unchanged.
- Use `qrcode.react@4.2.0`; it is bundled into the PWA and must not be loaded from a CDN.
- Keep manual encoded-text input only as a secondary recovery path.
- Use TDD for every task: RED → GREEN → REFACTOR.
- Before implementation, re-read current `main`; `9514ad83fe2b0b813a8b8ab541ea55a1df4a6d77` is planning context, not a fixed future execution baseline.

---

## File structure locked by this plan

### New QR/UI files

- `src/app/qr/QrFrameDisplay.tsx` — render one encoded frame as a high-contrast SVG QR with quiet zone.
- `src/app/qr/QrFrameDisplay.test.tsx` — rendering contract.
- `src/app/qr/QrCameraScanner.tsx` — reusable explicit-start ZXing camera scanner.
- `src/app/qr/QrCameraScanner.test.tsx` — start/stop, decode de-duplication, and error behavior with mocked ZXing.
- `src/app/config-transfer/ConfigDistributionPanel.tsx` — Headquarters active-ConfigVersion QR export and 900 ms frame cycling.
- `src/app/config-transfer/ConfigDistributionPanel.test.tsx`
- `src/app/config-transfer/CourtConfigTransfer.tsx` — Court camera/manual ingest, progress, review, and explicit activation.
- `src/app/config-transfer/CourtConfigTransfer.test.tsx`
- `src/app/court-bootstrap-service.ts` — active-config gate state, local responsibility persistence/validation, quick Court derivation, and allowed-session set.
- `src/app/court-bootstrap-service.test.ts`
- `src/app/CourtResponsibilityPanel.tsx` — operator-facing quick Court and explicit grouped-session responsibility selection.
- `src/app/CourtResponsibilityPanel.test.tsx`
- `src/app/CourtModeScreen.tsx` — `UNCONFIGURED` / `CONFIGURED_UNASSIGNED` / `READY` orchestration.
- `src/app/CourtModeScreen.test.tsx`
- `src/app/court-bootstrap-integration.test.ts` — two-database Host→Court transfer/activation/responsibility integration.

### Existing files expected to change

- `package.json`
- `package-lock.json`
- `src/app/config-update-service.ts`
- `src/app/config-update-service.test.ts`
- `src/app/ConfigUpdatePanel.tsx` — remove from normal Host/Court render path after replacement; retain only if another test/import still depends on the recovery UI.
- `src/app/ConfigUpdatePanel.test.tsx` — migrate/delete assertions that are replaced by new components.
- `src/app/TransferDemo.tsx` — use reusable `QrCameraScanner` for Host result reception without changing result-transfer semantics.
- `src/app/TransferDemo.test.tsx`
- `src/app/CourtScoringSession.tsx` — accept an allowed-session filter.
- `src/app/CourtScoringSession.test.tsx`
- `src/app/App.tsx` — mount Headquarters distribution and `CourtModeScreen`.
- `src/app/App.test.tsx`
- `src/app/phase4-court-entry-gate.test.tsx` — replace the old assertion that a fresh Court always sees the scoring selector.
- `src/index.css` — QR presentation, camera/bootstrap progress, and responsibility layout.

---

### Task 1: Add bundled visual QR rendering

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/app/qr/QrFrameDisplay.tsx`
- Create: `src/app/qr/QrFrameDisplay.test.tsx`

**Interfaces:**
- Add dependency:

```json
"qrcode.react": "4.2.0"
```

- Produce:

```ts
export interface QrFrameDisplayProps {
  value: string
  label: string
  size?: number
}

export function QrFrameDisplay(props: QrFrameDisplayProps): JSX.Element
```

- [ ] **Step 1: Install the exact dependency**

Run:

```bash
npm install qrcode.react@4.2.0
```

Expected: `package.json` and `package-lock.json` update; no CDN/runtime URL is introduced.

- [ ] **Step 2: Write the failing render test**

Render:

```tsx
<QrFrameDisplay value="KSPO1:test-frame" label="大会設定QR 1/1" size={320} />
```

Assert:

```ts
expect(screen.getByRole('img', { name: '大会設定QR 1/1' })).toBeInTheDocument()
expect(screen.queryByText('KSPO1:test-frame')).not.toBeInTheDocument()
```

The encoded text must not be primary visible UI.

- [ ] **Step 3: Run the focused test and verify RED**

```bash
npm run test:run -- src/app/qr/QrFrameDisplay.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 4: Implement the renderer**

Use the library's SVG component:

```tsx
import { QRCodeSVG } from 'qrcode.react'

export function QrFrameDisplay({
  value,
  label,
  size = 360,
}: QrFrameDisplayProps) {
  return (
    <div className="qr-frame-display" role="img" aria-label={label}>
      <QRCodeSVG
        value={value}
        size={size}
        level="M"
        marginSize={4}
      />
    </div>
  )
}
```

Do not modify the encoded frame value before passing it to `QRCodeSVG`.

- [ ] **Step 5: Run focused test, typecheck, and build**

```bash
npm run test:run -- src/app/qr/QrFrameDisplay.test.tsx
npm run typecheck
npm run build
```

Expected: all exit 0.

- [ ] **Step 6: Commit**

```bash
git add -- package.json package-lock.json src/app/qr/QrFrameDisplay.tsx src/app/qr/QrFrameDisplay.test.tsx
git commit -m "feat: render transfer frames as qr codes"
```

---

### Task 2: Extract a reusable explicit-start QR camera scanner

**Files:**
- Create: `src/app/qr/QrCameraScanner.tsx`
- Create: `src/app/qr/QrCameraScanner.test.tsx`
- Modify: `src/app/TransferDemo.tsx`
- Modify: `src/app/TransferDemo.test.tsx`

**Interfaces:**
- Produce:

```ts
export interface QrCameraScannerProps {
  onDecoded(text: string): void
  disabled?: boolean
  startLabel?: string
  stopLabel?: string
  previewLabel?: string
}

export function QrCameraScanner(props: QrCameraScannerProps): JSX.Element
```

- [ ] **Step 1: Write failing scanner tests with mocked `BrowserQRCodeReader`**

Cover:
1. no camera request occurs before the start button is clicked;
2. clicking start calls `decodeFromVideoDevice`;
3. a decoded text calls `onDecoded(text)`;
4. the same text emitted consecutively is delivered once;
5. a different next frame is delivered;
6. clicking stop calls scanner controls `stop()`;
7. camera-start rejection renders an actionable `role="alert"` message.

Use a hoisted mock for `@zxing/browser` so no real camera is touched in jsdom.

- [ ] **Step 2: Run the scanner test and verify RED**

```bash
npm run test:run -- src/app/qr/QrCameraScanner.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the scanner**

Keep all ZXing lifecycle state inside the component. Core callback logic:

```ts
const lastScannedTextRef = useRef<string | null>(null)

const handleResult = (result: Result | undefined) => {
  if (!result) return
  const text = result.getText()
  if (text === lastScannedTextRef.current) return
  lastScannedTextRef.current = text
  onDecoded(text)
}
```

On start:
- clear the last text;
- call `new BrowserQRCodeReader().decodeFromVideoDevice(undefined, video, callback)`;
- store returned `IScannerControls`.

On unmount/stop:
- call `controls.stop()`;
- clear the ref.

Render start/stop buttons and `<video muted playsInline>` only after explicit start.

- [ ] **Step 4: Run scanner tests and verify GREEN**

```bash
npm run test:run -- src/app/qr/QrCameraScanner.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Replace the Host-only inline camera code in `TransferDemo`**

Remove its direct `BrowserQRCodeReader`/`IScannerControls` refs and render:

```tsx
<QrCameraScanner
  disabled={busy}
  onDecoded={(text) => {
    setHostInput(text)
    void ingestHost(text)
  }}
  startLabel="カメラを起動"
  stopLabel="カメラを停止"
  previewLabel="QRコード読み取り用カメラ"
/>
```

Do not change `ingestHostFragment`, batch processing, ACK generation, or Court result-send semantics.

- [ ] **Step 6: Run result-transfer regressions**

```bash
npm run test:run -- src/app/qr/QrCameraScanner.test.tsx src/app/TransferDemo.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/qr/QrCameraScanner.tsx src/app/qr/QrCameraScanner.test.tsx src/app/TransferDemo.tsx src/app/TransferDemo.test.tsx
git commit -m "refactor: share qr camera scanner"
```

---

### Task 3: Enrich the config-update service for QR progress and review

**Files:**
- Modify: `src/app/config-update-service.ts`
- Modify: `src/app/config-update-service.test.ts`
- Modify: `src/app/ConfigUpdatePanel.tsx`
- Modify: `src/app/ConfigUpdatePanel.test.tsx`

**Interfaces:**
- Replace/extend status with:

```ts
export interface ConfigUpdateStatus {
  tournamentId: TournamentId | null
  tournamentName: string | null
  activeConfigVersionId: string | null
  activeVersion: number | null
  versions: Array<{ configVersionId: string; version: number }>
}

export interface ConfigUpdateProgress {
  transferId: string
  receivedCount: number
  totalParts: number
  remainingCount: number
  missingPartIndexes: number[]
  complete: boolean
}

export interface ConfigUpdateSummary {
  configVersionId: string
  tournamentId: TournamentId
  tournamentName: string
  version: number
  competitionCount: number
  scoringSessionCount: number
}

export interface ConfigUpdateIngestResult {
  progress: ConfigUpdateProgress
  importedConfigVersionId?: string
  tournamentId: TournamentId
}

export interface RestoredConfigUpdate {
  progress: ConfigUpdateProgress
  importedConfigVersionId?: string
}
```

Extend the existing `ConfigUpdatePanelServices` interface so injected App services remain type-compatible:

```ts
export interface ConfigUpdatePanelServices {
  loadStatus(): Promise<ConfigUpdateStatus>
  exportVersion(configVersionId: string): Promise<{
    configVersionId: string
    frames: string[]
  }>
  ingestFrame(encoded: string, receivedAt: string): Promise<ConfigUpdateIngestResult>
  restoreLatestTransfer(): Promise<RestoredConfigUpdate | null>
  getVersionSummary(configVersionId: string): Promise<ConfigUpdateSummary>
  activate(
    configVersionId: string,
    activation: ConfigActivationMetadata,
  ): Promise<ConfigUpdateActivationResult>
}
```

- [ ] **Step 1: Write failing service tests**

Extend existing tests to assert:
- `loadStatus()` returns `tournamentName` and `activeVersion`;
- after the first of multiple frames, `ingestFrame()` returns correct `receivedCount`, `totalParts`, and `missingPartIndexes`;
- duplicate ingest does not increment `receivedCount`;
- final frame returns `progress.complete === true` and `importedConfigVersionId`;
- `getVersionSummary()` returns tournament name, version, competition count, and scoring-session count from the imported immutable record;
- `restoreLatestTransfer()` returns the latest persisted CONFIG_UPDATE progress after database reopen, including `importedConfigVersionId` when that transfer is already complete.

- [ ] **Step 2: Run service tests and verify RED**

```bash
npm run test:run -- src/app/config-update-service.test.ts
```

Expected: FAIL because the richer result/summary API does not exist.

- [ ] **Step 3: Implement status and summary**

For `loadStatus()`, derive the active name/version from the same active tournament/config record.

For summary:

```ts
async getVersionSummary(configVersionId: string): Promise<ConfigUpdateSummary> {
  const record = await configRepository.getVersionById(configVersionId)
  if (!record) throw new Error(`ConfigVersion ${configVersionId} does not exist`)
  return {
    configVersionId: record.configVersionId,
    tournamentId: record.snapshot.tournament.tournamentId,
    tournamentName: record.snapshot.tournament.name,
    version: record.version,
    competitionCount: record.snapshot.competitions.length,
    scoringSessionCount: record.snapshot.scoringSessions.length,
  }
}
```

- [ ] **Step 4: Return progress directly from `ingestFrame()`**

After `saveReceivedPart`, restore the receiver and map its existing progress to `ConfigUpdateProgress`. When incomplete, return it immediately. When complete, preserve the existing validation/import path and return the same progress plus `importedConfigVersionId`.

- [ ] **Step 5: Implement persisted transfer restoration**

Inspect `receivedQrParts`, decode stored `encoded` values defensively with `decodeQrFrame`, discard rows that cannot be decoded by this frame codec or whose `payloadKind !== 'CONFIG_UPDATE'`, group the remaining rows by `batchId`, and choose the batch with the greatest `receivedAt`. Restore its receiver through `TransferRepository`, return the receiver progress, and set `importedConfigVersionId` to `transferId` only when:
- progress is complete; and
- `configRepository.getVersionById(transferId)` exists.

Return `null` when no received CONFIG_UPDATE frame exists.

- [ ] **Step 6: Keep legacy panel compiling while it is still referenced**

Update `ConfigUpdatePanel` to read `result.progress.complete` instead of `result.complete`. Do not expand its UX; later tasks replace it in the normal render path.

- [ ] **Step 7: Run service and legacy component tests**

```bash
npm run test:run -- src/app/config-update-service.test.ts src/app/ConfigUpdatePanel.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- src/app/config-update-service.ts src/app/config-update-service.test.ts src/app/ConfigUpdatePanel.tsx src/app/ConfigUpdatePanel.test.tsx
git commit -m "feat: expose config qr progress and summary"
```

---

### Task 4: Build Headquarters active-configuration QR distribution

**Files:**
- Create: `src/app/config-transfer/ConfigDistributionPanel.tsx`
- Create: `src/app/config-transfer/ConfigDistributionPanel.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consume the service subset:

```ts
export interface ConfigDistributionServices {
  loadStatus(): Promise<ConfigUpdateStatus>
  exportVersion(configVersionId: string): Promise<{
    configVersionId: string
    frames: string[]
  }>
}
```

- Use:

```ts
export const CONFIG_QR_CYCLE_MS = 900
```

- [ ] **Step 1: Write failing Host distribution tests**

Cover:
1. with no active ConfigVersion, `コート端末へ配布` is disabled and no QR is rendered;
2. clicking `コート端末へ配布` calls `exportVersion(activeConfigVersionId)`, not an older version;
3. one frame renders one static `QrFrameDisplay` and no timer-driven index change;
4. three frames render `1 / 3`, then `2 / 3` after exactly 900 ms, then loop `3 / 3` → `1 / 3`;
5. unmount clears the timer;
6. export rejection shows `role="alert"` and no stale QR;
7. the current encoded frame is available only inside a recovery disclosure labeled `QRが表示できない場合`.

- [ ] **Step 2: Run the component test and verify RED**

```bash
npm run test:run -- src/app/config-transfer/ConfigDistributionPanel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement active-version export**

Core action:

```ts
const distribute = async () => {
  if (!status?.activeConfigVersionId) return
  const exported = await services.exportVersion(status.activeConfigVersionId)
  setFrames(exported.frames)
  setFrameIndex(0)
}
```

Do not offer the normal operator a list of historical ConfigVersions for distribution.

- [ ] **Step 4: Implement the 900 ms loop**

When `frames.length > 1`:

```ts
const timer = window.setInterval(() => {
  setFrameIndex((current) => (current + 1) % frames.length)
}, CONFIG_QR_CYCLE_MS)
```

Clear on frame-list change and unmount.

Render:

```tsx
<QrFrameDisplay
  value={frames[frameIndex]!}
  label={`大会設定QR ${frameIndex + 1}/${frames.length}`}
/>
```

Also show tournament name, `Config vN`, and textual frame progress.

Under the QR, add a subordinate recovery disclosure:

```tsx
<details>
  <summary>QRが表示できない場合</summary>
  <textarea
    aria-label="大会設定QR文字列"
    readOnly
    value={frames[frameIndex] ?? ''}
  />
</details>
```

Do not display the encoded text outside this recovery disclosure.

- [ ] **Step 5: Add presentation CSS**

Use a large centered QR surface with white background and adequate padding. Keep the QR itself at a stable visual size (target 360-480 CSS px on desktop) and never apply CSS blur/filter/animation to the SVG.

- [ ] **Step 6: Run focused tests**

```bash
npm run test:run -- src/app/config-transfer/ConfigDistributionPanel.test.tsx src/app/qr/QrFrameDisplay.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/config-transfer/ConfigDistributionPanel.tsx src/app/config-transfer/ConfigDistributionPanel.test.tsx src/index.css
git commit -m "feat: distribute active config by qr"
```

---

### Task 5: Define and persist explicit Court responsibility sets

**Files:**
- Create: `src/app/court-bootstrap-service.ts`
- Create: `src/app/court-bootstrap-service.test.ts`

**Interfaces:**
- Persist under:

```ts
export const COURT_RESPONSIBILITY_KEY = 'court.responsibility.v1'
```

- Public types:

```ts
export interface PersistedCourtResponsibility {
  formatVersion: 1
  tournamentId: TournamentId
  allowedScoringSessionIds: ScoringSessionId[]
}

export interface CourtQuickResponsibility {
  id: string
  label: string
  courtLabel: string
  scoringSessionIds: ScoringSessionId[]
}

export interface CourtSessionResponsibilityOption {
  scoringSessionId: ScoringSessionId
  label: string
  competitionName: string
  inputScope: InputScope
  courtLabels: string[]
  grouped: boolean
}

export type CourtBootstrapState =
  | { status: 'UNCONFIGURED' }
  | {
      status: 'CONFIGURED_UNASSIGNED'
      tournamentId: TournamentId
      tournamentName: string
      configVersionId: string
      configVersion: number
      quickResponsibilities: CourtQuickResponsibility[]
      sessionOptions: CourtSessionResponsibilityOption[]
    }
  | {
      status: 'READY'
      tournamentId: TournamentId
      tournamentName: string
      configVersionId: string
      configVersion: number
      allowedScoringSessionIds: ScoringSessionId[]
      quickResponsibilities: CourtQuickResponsibility[]
      sessionOptions: CourtSessionResponsibilityOption[]
    }

export interface CourtBootstrapServices {
  loadState(): Promise<CourtBootstrapState>
  saveResponsibility(
    allowedScoringSessionIds: readonly ScoringSessionId[],
  ): Promise<CourtBootstrapState>
  clearResponsibility(): Promise<CourtBootstrapState>
}
```

- [ ] **Step 1: Write failing derivation/persistence tests**

Build a snapshot containing:
- CourtRun `A`;
- CourtRun `B`;
- one ordinary `PER_COURT` session referencing only A;
- one ordinary `PER_COURT` session referencing only B;
- one `PER_COURT` session spanning A+B;
- one `WHOLE_SLOT` session spanning A+B;
- one `CUSTOM_GROUP` session spanning A+B.

Assert quick responsibilities are exactly:
- `コート A` containing only the single-label A ordinary session;
- `コート B` containing only the single-label B ordinary session.

Assert the multi-label `PER_COURT`, `WHOLE_SLOT`, and `CUSTOM_GROUP` sessions are **not** automatically included in either quick Court responsibility.

Assert `sessionOptions` includes all active scoring sessions and marks as `grouped: true` when:
- `inputScope !== 'PER_COURT'`; or
- the session resolves to more than one distinct `courtLabel`.

Also assert:
- no active config → `UNCONFIGURED`;
- active config + no saved responsibility → `CONFIGURED_UNASSIGNED`;
- saving a non-empty subset of active `ScoringSessionId`s → `READY`;
- saving an empty list throws;
- saving an unknown `ScoringSessionId` throws;
- reopening the database restores the same responsibility set;
- same-tournament Config v2 that still contains every stored ID remains `READY`;
- Config v2 that removes any stored ID returns `CONFIGURED_UNASSIGNED`;
- responsibility state from a different tournament is ignored.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npm run test:run -- src/app/court-bootstrap-service.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement responsibility derivation**

Resolve active sessions against `snapshot.courtRuns`.

For each session, compute the distinct sorted `courtLabels`.

A session is eligible for a quick Court responsibility only when:

```ts
session.inputScope === 'PER_COURT' && courtLabels.length === 1
```

Group those eligible sessions by their single `courtLabel` and produce:

```ts
{
  id: `court:${courtLabel}`,
  label: `コート ${courtLabel}`,
  courtLabel,
  scoringSessionIds: [...]
}
```

Sort quick Court responsibilities by `courtLabel.localeCompare(other, 'ja')`.

Produce `sessionOptions` for every active session. Mark:

```ts
grouped =
  session.inputScope !== 'PER_COURT' ||
  courtLabels.length !== 1
```

This makes whole-slot/custom-group/multi-court sessions explicit session-level choices instead of silently assigning them to every matching Court.

- [ ] **Step 4: Implement responsibility persistence and validation**

Persist:

```ts
{
  formatVersion: 1,
  tournamentId,
  allowedScoringSessionIds: [...new Set(ids)].sort(),
}
```

On `saveResponsibility()`:
1. require at least one ID;
2. require every ID to exist in the active ConfigVersion;
3. persist to `localSettings[COURT_RESPONSIBILITY_KEY]`;
4. return a fresh `loadState()`.

On every `loadState()`:
1. resolve the single active tournament and active ConfigVersion;
2. derive quick responsibilities and session options;
3. load the persisted record;
4. reject malformed/different-tournament state;
5. require the stored list to be non-empty;
6. require every stored `ScoringSessionId` to still exist in the active ConfigVersion.

If all IDs remain valid, return `READY` with the exact stored ID set. If any ID disappeared, return `CONFIGURED_UNASSIGNED` and do not expose production scoring.

Do not rewrite or infer a new responsibility set automatically after ConfigVersion changes.

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
npm run test:run -- src/app/court-bootstrap-service.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run backup regression**

Because responsibility state uses existing `localSettings`, run:

```bash
npm run test:run -- src/backup/backup-schema.test.ts src/backup/backup-service.test.ts src/backup/restore-service.test.ts
```

Expected: PASS; no database schema migration is required.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/court-bootstrap-service.ts src/app/court-bootstrap-service.test.ts
git commit -m "feat: persist court responsibility sessions"
```

---

### Task 6: Add Court configuration scan, review, and explicit activation

**Files:**
- Create: `src/app/config-transfer/CourtConfigTransfer.tsx`
- Create: `src/app/config-transfer/CourtConfigTransfer.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consume:

```ts
export interface CourtConfigTransferServices {
  ingestFrame(encoded: string, receivedAt: string): Promise<ConfigUpdateIngestResult>
  restoreLatestTransfer(): Promise<RestoredConfigUpdate | null>
  getVersionSummary(configVersionId: string): Promise<ConfigUpdateSummary>
  activate(
    configVersionId: string,
    activation: ConfigActivationMetadata,
  ): Promise<ConfigUpdateActivationResult>
}

export interface CourtConfigTransferProps {
  services: CourtConfigTransferServices
  operatorName: string
  deviceId: string
  onActivated(result: ConfigUpdateActivationResult): void
  now?: () => string
}
```

- [ ] **Step 1: Write failing Court transfer tests**

Cover:
1. on mount, persisted incomplete progress is restored without starting the camera;
2. on mount, a persisted completed-but-inactive transfer restores the review screen;
3. camera is not started until `大会設定QRを読み取る`/scanner start is clicked;
4. first decoded frame updates `1 / N 読み取り済み`;
5. duplicate frame does not advance displayed progress;
6. out-of-order frames are accepted;
7. final frame loads and renders review fields:
   - tournament name,
   - `Config vN`,
   - competition count,
   - scoring-session count;
8. `activate()` is not called automatically;
9. clicking `この大会を使用` sends operator, device ID, and current timestamp;
10. successful activation invokes `onActivated`;
11. a non-`CONFIG_UPDATE`/corrupt frame renders an error but leaves prior progress visible;
12. manual text entry exists only inside a recovery disclosure.

- [ ] **Step 2: Run component test and verify RED**

```bash
npm run test:run -- src/app/config-transfer/CourtConfigTransfer.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Restore persisted scan/review state on mount**

Call:

```ts
const restored = await services.restoreLatestTransfer()
```

If `restored` is incomplete, show its stored progress immediately. If it includes `importedConfigVersionId`, load `getVersionSummary()` and restore the review screen without re-scanning. Restoration must not activate anything.

- [ ] **Step 4: Implement serialized frame ingestion**

Use a ref to prevent overlapping service writes:

```ts
const ingestingRef = useRef(false)

const ingest = async (encoded: string) => {
  if (ingestingRef.current) return
  ingestingRef.current = true
  try {
    const result = await services.ingestFrame(encoded.trim(), now())
    setProgress(result.progress)
    if (result.importedConfigVersionId) {
      const summary = await services.getVersionSummary(result.importedConfigVersionId)
      setImported({ id: result.importedConfigVersionId, summary })
    }
  } finally {
    ingestingRef.current = false
  }
}
```

Because Headquarters loops frames, a frame skipped while ingestion is busy will reappear; do not add an unbounded client queue.

- [ ] **Step 5: Implement explicit review/activation**

Before completion, show progress only.

After completion, show the summary and:

```tsx
<button type="button" onClick={() => void activate()}>
  この大会を使用
</button>
```

Activation:

```ts
const result = await services.activate(imported.id, {
  operator: operatorName,
  activatedAt: now(),
  deviceId,
})
onActivated(result)
```

Never auto-activate on scan completion.

- [ ] **Step 6: Implement recovery text input**

Place the textarea/button under:

```tsx
<details>
  <summary>カメラが使えない場合</summary>
  ...
</details>
```

It calls the same `ingest()` function as the camera path.

- [ ] **Step 7: Run focused tests**

```bash
npm run test:run -- src/app/config-transfer/CourtConfigTransfer.test.tsx src/app/qr/QrCameraScanner.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -- src/app/config-transfer/CourtConfigTransfer.tsx src/app/config-transfer/CourtConfigTransfer.test.tsx src/index.css
git commit -m "feat: scan and activate court configuration"
```

---

### Task 7: Gate Court mode behind configuration and explicit responsibility selection

**Files:**
- Create: `src/app/CourtResponsibilityPanel.tsx`
- Create: `src/app/CourtResponsibilityPanel.test.tsx`
- Create: `src/app/CourtModeScreen.tsx`
- Create: `src/app/CourtModeScreen.test.tsx`
- Modify: `src/app/CourtScoringSession.tsx`
- Modify: `src/app/CourtScoringSession.test.tsx`
- Modify: `src/app/phase4-court-entry-gate.test.tsx`

**Interfaces:**
- `CourtScoringSession` changes to:

```ts
export interface CourtScoringSessionProps {
  services: CourtScoringSessionServices
  allowedScoringSessionIds?: readonly ScoringSessionId[]
}
```

When `allowedScoringSessionIds` is provided, filter loaded options before choosing the default selection.

- `CourtResponsibilityPanel`:

```ts
export interface CourtResponsibilityPanelProps {
  quickResponsibilities: CourtQuickResponsibility[]
  sessionOptions: CourtSessionResponsibilityOption[]
  initialSelectedIds?: readonly ScoringSessionId[]
  onSave(
    allowedScoringSessionIds: readonly ScoringSessionId[],
  ): Promise<void> | void
}
```

The panel owns only temporary selection state. Persistence remains in `CourtBootstrapServices.saveResponsibility()`.

- [ ] **Step 1: Write failing `CourtScoringSession` filter tests**

Given sessions A/B/grouped and:

```tsx
<CourtScoringSession
  services={services}
  allowedScoringSessionIds={['session-a' as ScoringSessionId]}
/>
```

assert the selector includes A and excludes B/grouped.

Also assert that without the prop all sessions remain available, preserving standalone component behavior.

- [ ] **Step 2: Run the scoring-session test and verify RED**

```bash
npm run test:run -- src/app/CourtScoringSession.test.tsx
```

Expected: FAIL because the prop does not exist.

- [ ] **Step 3: Implement minimal filtering**

After `services.listSessions()`:

```ts
const allowed = allowedScoringSessionIds
  ? new Set(allowedScoringSessionIds)
  : null

const visible = allowed
  ? items.filter((item) => allowed.has(item.scoringSessionId))
  : items

setSessions(visible)
setSelectedId(visible[0]?.scoringSessionId ?? '')
```

Pass a stable `allowedScoringSessionIds` array from the parent so the effect does not reload on every render.

- [ ] **Step 4: Write failing responsibility panel tests**

Use quick responsibilities:

```ts
[
  {
    id: 'court:A',
    label: 'コート A',
    courtLabel: 'A',
    scoringSessionIds: ['session-a-1', 'session-a-2'] as ScoringSessionId[],
  },
]
```

and session-level options including:
- one ordinary A session;
- one `WHOLE_SLOT`;
- one `CUSTOM_GROUP`;
- one multi-label `PER_COURT`.

Assert:
1. clicking `コート A` selects exactly `session-a-1` + `session-a-2`;
2. grouped/multi-court session checkboxes are not implicitly selected by the quick action;
3. the operator can explicitly add a grouped session;
4. save sends the exact deduplicated selected ID set;
5. save is disabled when the set is empty.

The normal visual emphasis should show quick Court choices first and grouped/multi-court session-level choices under an explicit section such as `複数コート・全体入力の担当`.

- [ ] **Step 5: Write failing Court gate tests**

For `CourtModeScreen`, mock `bootstrapServices.loadState()` for each state.

`UNCONFIGURED`:

```ts
expect(screen.getByRole('region', { name: '大会設定を受信' })).toBeInTheDocument()
expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
```

`CONFIGURED_UNASSIGNED`:

```ts
expect(screen.getByRole('region', { name: '担当を選択' })).toBeInTheDocument()
expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
```

`READY`:

```ts
expect(await screen.findByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
```

Also assert:
- after `CourtConfigTransfer.onActivated`, `loadState()` is called again;
- after `saveResponsibility()` resolves to `READY`, scoring appears;
- a READY state exposes `担当を変更`;
- changing responsibility never calls config import/activation APIs.

- [ ] **Step 6: Update the Phase 4 entry-gate regression**

Replace the old fresh-device assertion:

```ts
expect(screen.getByRole('combobox', { name: 'ScoringSession' })).toBeInTheDocument()
```

with:

```ts
expect(screen.getByRole('region', { name: '大会設定を受信' })).toBeInTheDocument()
expect(screen.queryByRole('combobox', { name: 'ScoringSession' })).not.toBeInTheDocument()
```

Add a configured+responsibility case proving production scoring still becomes reachable.

- [ ] **Step 7: Implement `CourtResponsibilityPanel` and `CourtModeScreen`**

`CourtModeScreen` state skeleton:

```ts
const [bootstrap, setBootstrap] = useState<CourtBootstrapState | null>(null)

const reload = async () => {
  setBootstrap(await bootstrapServices.loadState())
}
```

Render:
- loading state while null;
- `CourtConfigTransfer` for `UNCONFIGURED`;
- `CourtResponsibilityPanel` for `CONFIGURED_UNASSIGNED`;
- `CourtScoringSession` with `allowedScoringSessionIds` for `READY`.

Saving responsibility:

```ts
await bootstrapServices.saveResponsibility(selectedIds)
await reload()
```

In `READY`:
- include `担当を変更` to reopen `CourtResponsibilityPanel` preselected with the current IDs;
- include a secondary `大会設定を更新` flow using the same `CourtConfigTransfer`;
- after ConfigVersion activation call `reload()` so stored ID validity is rechecked.

Keep result QR transfer and transfer history only in `READY`.

- [ ] **Step 8: Run focused Court tests**

```bash
npm run test:run -- \
  src/app/CourtScoringSession.test.tsx \
  src/app/CourtResponsibilityPanel.test.tsx \
  src/app/CourtModeScreen.test.tsx \
  src/app/phase4-court-entry-gate.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add -- \
  src/app/CourtResponsibilityPanel.tsx \
  src/app/CourtResponsibilityPanel.test.tsx \
  src/app/CourtModeScreen.tsx \
  src/app/CourtModeScreen.test.tsx \
  src/app/CourtScoringSession.tsx \
  src/app/CourtScoringSession.test.tsx \
  src/app/phase4-court-entry-gate.test.tsx
git commit -m "feat: gate court scoring behind responsibility"
```

---

### Task 8: Wire Headquarters and Court workflows into `App`

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/ConfigUpdatePanel.tsx`
- Modify/Delete: `src/app/ConfigUpdatePanel.test.tsx` only if the legacy component is no longer imported anywhere.

**Interfaces:**
- `App` creates:

```ts
const courtBootstrapServices = useMemo(
  () => createCourtBootstrapService(appDatabase),
  [appDatabase],
)
```

- Host CONFIG renders `ConfigDistributionPanel` using the existing `configUpdateServices`.
- Court mode renders `CourtModeScreen`.

- [ ] **Step 1: Write failing App integration assertions**

Host:
1. create/apply or inject an active config state;
2. enter 本部モード → 大会設定;
3. assert `コート端末へ配布` exists;
4. assert the legacy `Config Update QR出力` textarea is not in the normal path.

Fresh Court:
1. enter コートモード;
2. assert configuration reception is primary;
3. assert `ScoringSession` is absent.

Configured+assigned Court:
1. provide/inject database/service state;
2. enter コートモード;
3. assert scoring is present and filtered.

- [ ] **Step 2: Run App tests and verify RED**

```bash
npm run test:run -- src/app/App.test.tsx src/app/phase4-court-entry-gate.test.tsx
```

Expected: FAIL because App still mounts the dual-mode `ConfigUpdatePanel` directly.

- [ ] **Step 3: Replace normal Host config-update UI**

Change:

```tsx
<ConfigUpdatePanel mode="HOST" ... />
```

to:

```tsx
<ConfigDistributionPanel services={configUpdateServices} />
```

Keep configuration file import/export behavior unchanged.

- [ ] **Step 4: Replace normal Court content**

Change the direct sequence of:
- `CourtScoringSession`,
- Court `ConfigUpdatePanel`,
- `TransferDemo`,
- `CourtTransferHistory`

to one `CourtModeScreen` that receives those services/components' dependencies.

- [ ] **Step 5: Remove dead legacy imports**

If `ConfigUpdatePanel` has no production caller after the migration:
- either keep it only as an explicitly labeled recovery/test component with no App route, or
- delete it and its test in the same commit after repository-wide search confirms no imports.

Run:

```bash
grep -R "ConfigUpdatePanel" -n src
```

Expected before deletion: only the file/test themselves. If another production import remains, do not delete it.

- [ ] **Step 6: Run App/Court/Host tests**

```bash
npm run test:run -- \
  src/app/App.test.tsx \
  src/app/phase4-court-entry-gate.test.tsx \
  src/app/config-transfer/ConfigDistributionPanel.test.tsx \
  src/app/CourtModeScreen.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/App.tsx src/app/App.test.tsx src/app/ConfigUpdatePanel.tsx src/app/ConfigUpdatePanel.test.tsx
git commit -m "feat: wire court bootstrap and config distribution"
```

If `ConfigUpdatePanel.tsx` was deleted, use `git add -A -- src/app/ConfigUpdatePanel.tsx src/app/ConfigUpdatePanel.test.tsx`.

---

### Task 9: Prove one Host export initializes multiple independent Court devices

**Files:**
- Create: `src/app/court-bootstrap-integration.test.ts`
- Modify: `src/app/config-update-service.test.ts` only if a shared fixture is extracted without changing semantics.

**Interfaces:**
- Uses real fake-indexeddb databases and the real:
  - `ConfigRepository`,
  - `createConfigUpdateService`,
  - `createCourtBootstrapService`.

- [ ] **Step 1: Write the failing integration test**

Test sequence:

```ts
const hostDb = createDatabase(hostName)
const hostRepository = new ConfigRepository(hostDb)
await hostRepository.apply(snapshot, metadata)

const active = await hostRepository.getActiveVersion(tournamentId)
const exported = await createConfigUpdateService(hostDb)
  .exportVersion(active!.configVersionId, 90)
```

Create `courtA` and `courtB` databases. For both:
- ingest the exact same `exported.frames` in different orders;
- assert imported but not active;
- activate the same ConfigVersion;
- assert bootstrap state is `CONFIGURED_UNASSIGNED`.

Resolve the quick Court responsibility IDs from each Court's `CONFIGURED_UNASSIGNED` state, then:

```ts
const stateA = await courtA.bootstrap.loadState()
const stateB = await courtB.bootstrap.loadState()

if (stateA.status !== 'CONFIGURED_UNASSIGNED') throw new Error('Court A must be unassigned')
if (stateB.status !== 'CONFIGURED_UNASSIGNED') throw new Error('Court B must be unassigned')

const courtAIds = stateA.quickResponsibilities
  .find((item) => item.courtLabel === 'A')!.scoringSessionIds
const courtBIds = stateB.quickResponsibilities
  .find((item) => item.courtLabel === 'B')!.scoringSessionIds

await courtA.bootstrap.saveResponsibility(courtAIds)
await courtB.bootstrap.saveResponsibility(courtBIds)
```

Assert:
- both become `READY`;
- A's `allowedScoringSessionIds` is exactly the A quick-responsibility set;
- B's is exactly the B quick-responsibility set;
- Host/Court ConfigVersion IDs match;
- persisted responsibility records differ and exist only in each Court's `localSettings`.

- [ ] **Step 2: Run the integration test and verify RED/GREEN state**

```bash
npm run test:run -- src/app/court-bootstrap-integration.test.ts
```

If it passes immediately because prior tasks already satisfy it, still inspect the assertions against the acceptance criteria; this task is an integration proof, not a reason to add production code.

- [ ] **Step 3: Add Config v2 responsibility-ID revalidation to the same integration test**

Apply Host v2 preserving every ScoringSession ID used by Court A but removing at least one ScoringSession ID used by Court B. Export v2 once and ingest/activate it on both Courts.

Assert:
- Court A remains `READY` with the same stored ID set;
- Court B becomes `CONFIGURED_UNASSIGNED` because one stored ID disappeared;
- neither Court lost existing Result/Revision rows.

- [ ] **Step 4: Run the focused integration and result-history regressions**

```bash
npm run test:run -- \
  src/app/court-bootstrap-integration.test.ts \
  src/app/config-update-service.test.ts \
  src/app/court-result-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- src/app/court-bootstrap-integration.test.ts src/app/config-update-service.test.ts
git commit -m "test: prove multi-court config bootstrap"
```

---

### Task 10: Full regression, build, and real-device QR acceptance

**Files:**
- No production changes expected unless verification discovers a defect.

**Interfaces:**
- Verifies the complete accepted Court bootstrap workflow.

- [ ] **Step 1: Run all automated verification**

```bash
npm run test:run
npm run typecheck
npm run build
```

Expected:
- 0 failed Vitest tests;
- TypeScript exit 0;
- Vite build exit 0.

- [ ] **Step 2: Verify single-frame QR manually**

Use a minimal tournament config that exports to one frame. On Headquarters:
- click `コート端末へ配布`;
- verify one stable QR remains on screen;
- scan it from a separate Court device;
- verify review appears;
- verify scoring is still unavailable until `この大会を使用` and responsibility selection finish.

- [ ] **Step 3: Verify multi-frame continuous scanning manually**

Use a realistic event config that exports to multiple frames. On Headquarters:
- confirm visible frame progress loops every 900 ms;
- keep the Court camera pointed at the screen without tapping between frames;
- confirm progress reaches `N / N`;
- confirm duplicates/loops do not reset progress.

Test normal laptop/tablet viewing distance; do not tune the interval unless scanning evidence justifies a spec revision.

- [ ] **Step 4: Verify responsibility behavior**

Initialize two independent Court devices from the same Headquarters QR loop:
- device A uses quick choice `コート A`;
- device B uses quick choice `コート B`;
- verify each quick choice selects only ordinary single-label `PER_COURT` sessions for that Court;
- verify `WHOLE_SLOT`, `CUSTOM_GROUP`, and multi-label sessions remain explicit session-level choices and are not silently selected by either quick Court action;
- on a dedicated device, explicitly select a grouped/whole-slot session and verify only the saved `ScoringSessionId` set becomes available for scoring.

- [ ] **Step 5: Verify replacement-device procedure**

On a fresh spare device:
- scan the same active Headquarters distribution;
- activate;
- select the failed device's same responsibility set;
- verify relevant scoring sessions become available without creating a device-specific QR.

- [ ] **Step 6: Verify camera recovery path**

Deny camera permission:
- verify an actionable error is displayed;
- open `カメラが使えない場合`;
- paste one or more encoded frame strings manually;
- confirm the same progress/import/activation path completes.

- [ ] **Step 7: Verify Config v2 update safety**

On an already configured Court:
- open `大会設定を更新`;
- scan v2;
- confirm v1 remains active before `この大会を使用`;
- activate v2;
- confirm a responsibility whose every stored `ScoringSessionId` still exists remains ready;
- confirm a responsibility with any removed stored ID requires selection again;
- confirm existing Result/Revision history remains present.

- [ ] **Step 8: Record acceptance evidence in the implementation PR**

Include:
- full test/typecheck/build outputs,
- browsers/devices tested,
- single-frame result,
- multi-frame `N` and observed continuous-scan behavior,
- whether 900 ms was retained,
- responsibility/replacement/update results.

Do not claim event-day QR acceptance until this real-device scan check has been performed.
