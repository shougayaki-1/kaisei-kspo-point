# Display Mode and Court Bootstrap Design

Date: 2026-08-21
Repository: `shougayaki-1/kaisei-kspo-point`
Baseline: `main@9514ad83fe2b0b813a8b8ab541ea55a1df4a6d77`

## 1. Purpose

This design improves two event-day workflows without changing the offline-first architecture:

1. Make Display mode render cleanly on a 16:9 projector, TV, or external monitor.
2. Make a newly opened Court device able to receive the authoritative tournament configuration from Headquarters and begin scoring without manual text transfer or device-specific configuration QR codes.

The application remains fully usable without network connectivity. Each physical device retains its own local IndexedDB state. Cross-device transfer continues to use QR-based payloads.

## 2. Existing Behavior

### Display mode

Display mode currently reuses the normal application shell. The global app bar, centered `Container`, normal page padding, device diagnostics entry point, and bottom status bar remain present. `DisplayDashboard` renders a simple heading and ordered list.

This is suitable for operator inspection but not for a fixed 16:9 public display.

### Court configuration

A Headquarters device can already export a `ConfigVersion` through the existing `CONFIG_UPDATE` transfer format. The payload contains the complete tournament configuration snapshot and is split into one or more QR frames by the transfer codec.

A Court device can already ingest those frames and activate the imported version. However, the current UI exposes encoded frame text in textareas and places the configuration update controls below the Court scoring UI. A fresh Court device therefore reaches a scoring screen before it has a usable tournament configuration.

## 3. Goals

### Display mode goals

- Present the authoritative standings in a visually stable 16:9 stage.
- Use the full available screen while preserving a strict 16:9 content area.
- Keep text legible from a distance.
- Remove operator-only chrome from the public display.
- Continue refreshing from the local authoritative Headquarters database.
- Degrade safely if browser fullscreen is unavailable or rejected.

### Court bootstrap goals

- A fresh Court device must not show production scoring controls until a tournament configuration is active.
- Headquarters must expose one common configuration-transfer experience for all Court devices.
- The same Headquarters transfer can initialize Court 1, Court 2, Court 3, Court 4, replacement devices, and spare devices.
- Court assignment is selected on the Court device after configuration import; it is not encoded as a device-specific configuration payload.
- A configuration that fits in one QR frame is shown as one QR code.
- A configuration that requires multiple frames is shown as one automatically cycling QR display, so the operator performs one continuous scan session.
- Existing `CONFIG_UPDATE` validation, versioning, and persistence rules remain authoritative.

## 4. Non-goals

- No network synchronization, WebSocket, local LAN server, Bluetooth, or cloud backend.
- No automatic remote discovery of Headquarters devices.
- No device-specific tournament configuration format.
- No change to Court result transfer semantics or ACK semantics.
- No attempt to force an entire tournament configuration into a single physical QR symbol when doing so would make scanning unreliable.
- No change to scoring rules, ranking rules, or tournament configuration semantics.

## 5. Display Mode Architecture

### 5.1 Dedicated display shell

When `mode === 'DISPLAY'`, the application must render a dedicated display shell rather than the normal operator shell.

The following normal-shell elements are not rendered in Display mode:

- application AppBar,
- device diagnostics button,
- normal `Container` width constraint,
- normal page vertical padding,
- data-management accordion,
- bottom status bar,
- reload control.

Display mode retains a small non-intrusive exit affordance that is not part of the standings stage. It may auto-hide while the pointer is inactive, but it must remain keyboard reachable.

### 5.2 16:9 stage

The public display content is rendered in a centered stage with an exact 16:9 aspect ratio.

The stage must fit inside the viewport without cropping:

- width: `min(100vw, calc(100vh * 16 / 9))`
- height: `min(100vh, calc(100vw * 9 / 16))`

If the viewport is not 16:9, unused space appears outside the stage. The standings layout itself must not stretch to a different aspect ratio.

The stage design uses 1920x1080 as the visual reference coordinate system, while implementation remains responsive rather than relying on a literal fixed-pixel canvas.

### 5.3 Fullscreen

Selecting Display mode should attempt `requestFullscreen()` from the user gesture that opens Display mode when the Fullscreen API is available.

Fullscreen failure is non-fatal. The app continues in the same 16:9 fitted stage inside the browser viewport.

The app must not require fullscreen permission to display standings.

### 5.4 Standings layout

The primary view contains:

- tournament title or configured event title,
- prominent `総合順位` heading,
- current ConfigVersion indicator in secondary visual weight,
- ranked team rows,
- rank,
- team name,
- total score.

Typography must scale with the stage dimensions using responsive sizing such as `clamp()` and viewport-relative units. Rank, team name, and score must remain readable on a typical projector from across a room.

The layout must handle the configured number of teams without vertical overflow. If team count exceeds the primary design capacity, rows compact proportionally before any scrolling is introduced. Display mode must not require user scrolling during normal event operation.

### 5.5 Refresh behavior

`DisplayDashboard` continues reading `HostScoringState` from `loadAuthoritativeState()` on the existing refresh interval.

If a refresh fails after at least one successful state load, the previous standings remain visible and a small update-warning indicator is shown. A transient read failure must not blank the public display.

## 6. Court Bootstrap Architecture

### 6.1 Court entry gate

On entering Court mode, the app determines whether a valid active tournament configuration exists locally.

There are three states:

1. `UNCONFIGURED`: no imported/active tournament configuration is available.
2. `CONFIGURED_UNASSIGNED`: configuration is active, but this device has not selected its Court assignment.
3. `READY`: configuration is active and the device has an assignment.

Production scoring UI is rendered only in `READY`.

`UNCONFIGURED` renders the configuration scanner first.

`CONFIGURED_UNASSIGNED` renders Court assignment selection first.

### 6.2 Headquarters distribution screen

Headquarters adds a clear action in tournament configuration management: `コート端末へ配布`.

That action exports the currently active `ConfigVersion` through the existing `createConfigUpdatePayload` / `encodeConfigUpdateFrames` path.

The distribution UI shows:

- tournament name,
- Config version,
- QR display,
- frame progress (`1 / N`),
- a short instruction telling Court devices to point their camera at the screen.

The exported payload is common to all Court devices.

### 6.3 One scan session, one or many physical frames

The requirement is one operator scan session, not necessarily one physical QR symbol.

If `frames.length === 1`, Headquarters displays a static QR.

If `frames.length > 1`, Headquarters automatically cycles through the QR frames in a loop. The default cycle interval should be long enough for stable camera recognition and short enough for quick setup; the implementation plan should start from approximately 700-1000 ms per frame and validate this with real-device testing.

The Court scanner stores each unique frame using the existing transfer repository and displays progress such as `3 / 5 読み取り済み`.

Duplicate frames are harmless and do not reset progress.

When all frames are present, the complete payload is validated and imported automatically.

### 6.4 QR rendering

The current application already decodes QR codes with ZXing but does not provide a visual QR encoder component.

Introduce a small QR-rendering abstraction that receives an encoded frame string and renders a high-contrast QR symbol suitable for another device camera.

The implementation should use a mature QR encoding library rather than a custom QR algorithm. The component must provide sufficient quiet zone and render at a size appropriate for a laptop/tablet Headquarters screen.

Transfer payload encoding remains unchanged; the new renderer only converts the existing encoded frame string into a visual QR symbol.

### 6.5 Court scanner

Reuse the existing browser camera-scanning pattern already used by Headquarters result reception.

The Court bootstrap scanner:

- requests camera permission only after an explicit user action,
- feeds decoded text to `ConfigUpdatePanel`/config-update service semantics,
- accepts frames in any order,
- ignores duplicate frames safely,
- persists partial progress so an accidental view change does not lose already scanned parts,
- shows received/total progress,
- automatically proceeds to validation when complete.

Manual text entry may remain as a secondary recovery path but is not the primary UI.

### 6.6 Import review and activation

After a complete configuration is received, the Court device shows a confirmation summary before production scoring:

- tournament name,
- Config version,
- number of competitions,
- number of available scoring sessions.

The user selects `この大会を使用` to activate the imported ConfigVersion.

Activation continues through the existing config repository activation path and records operator/device metadata.

### 6.7 Court assignment

After activation, the device selects which Court responsibility it is handling.

The assignment UI is derived from the active configuration. It must not create or modify tournament configuration records.

Assignment is local device preference/state. It filters the scoring-session choices shown to the operator so the device primarily presents sessions relevant to its selected Court/CourtRun responsibility.

The operator can change assignment later from Court mode settings without re-importing the tournament configuration.

A replacement device therefore uses the same Headquarters configuration QR session, activates the same ConfigVersion, and selects the failed device's Court assignment.

### 6.8 Later configuration updates

When Headquarters creates Config v2 or later, the same distribution mechanism is reused.

A configured Court device exposes `大会設定を更新`.

The Court device scans the new Headquarters QR session, imports the new ConfigVersion, shows the version/configuration review, and explicitly activates it.

Existing version integrity and change-class validation continue to apply.

Scoring must never silently switch to a newly scanned configuration before activation succeeds.

## 7. Data Flow

### Initial Court setup

`Headquarters active ConfigVersion`
→ `CONFIG_UPDATE payload`
→ `encodeConfigUpdateFrames`
→ `visual QR renderer`
→ `automatic frame loop when N > 1`
→ `Court camera scanner`
→ `ingestFrame`
→ `TransferRepository partial persistence`
→ `payload assembly`
→ `validateConfigUpdatePayload`
→ `importVersion`
→ `operator review`
→ `activate`
→ `select Court assignment`
→ `CourtScoringSession`.

### Court result return

The existing result path is unchanged:

`Court result/revision`
→ `result transfer QR frames`
→ `Headquarters camera receiver`
→ `batch processing`
→ `ACK`.

## 8. Integrity and Safety

- Every configuration frame continues to carry tournament and transfer identifiers through the existing frame format.
- Complete payload validation remains mandatory before import.
- Imported configuration remains inactive until explicit activation.
- A Court device must not permit production result entry without an active configuration.
- A configuration update must not destroy previously saved result/revision history.
- Result transfer must continue rejecting mismatched tournaments.
- Display mode is read-only and must not expose controls that mutate scoring state.

## 9. Error Handling

### Headquarters distribution

If export fails, no QR is shown and a clear error is presented.

If QR rendering fails, the encoded text recovery path may be exposed under an advanced/recovery disclosure, but it must not replace the primary QR UI.

### Court scan

The scanner must distinguish:

- camera permission/start failure,
- non-`CONFIG_UPDATE` QR,
- invalid/corrupted frame,
- configuration belonging to an incompatible or conflicting tournament state,
- incomplete multi-frame transfer,
- complete payload validation failure,
- activation failure.

Incomplete transfers remain resumable. Validation or activation failure must not leave a partially active tournament.

### Display mode

Initial load failure shows an error state inside the stage. Subsequent refresh failures retain the last successful standings.

## 10. Testing Requirements

### Unit/component tests

Add coverage for:

- Display mode omits normal operator chrome.
- 16:9 stage class/structure is rendered only in Display mode.
- display refresh keeps previous state after a later load error.
- fresh Court mode renders bootstrap scanner instead of scoring controls.
- configured-but-unassigned Court mode renders assignment selection.
- ready Court mode renders scoring controls.
- Headquarters distribution exports the active version.
- single-frame configuration renders one static QR.
- multi-frame configuration cycles frames and reports index/total.
- Court scanner accepts out-of-order frames and duplicates.
- complete scan transitions to configuration review.
- activation transitions to assignment.
- assignment filters scoring-session choices without mutating ConfigVersion data.
- later ConfigVersion import remains inactive until explicit activation.

### Integration tests

Add an end-to-end service/component integration test that performs:

1. create/apply a Headquarters tournament config,
2. export the active ConfigVersion,
3. ingest all exported frames into a separate Court database,
4. activate the imported version,
5. select a Court assignment,
6. confirm production Court scoring sessions become available.

Also verify that the same exported ConfigVersion initializes two independent Court databases with different local Court assignments.

### Manual real-device verification

Before event-day acceptance, verify on at least:

- Chrome desktop/laptop Headquarters screen,
- Android Chrome Court device if available,
- iPad/Safari or installed PWA where available,
- one projector/TV at 16:9,
- one non-16:9 viewport.

For multi-frame QR, verify reliable continuous scanning at normal viewing distance and tune frame interval/QR size based on observed recognition stability.

## 11. Acceptance Criteria

The work is complete when all of the following are true:

- Display mode visibly occupies a clean 16:9 stage and excludes operator chrome.
- It remains usable without browser fullscreen.
- A fresh Court device cannot accidentally enter production scoring before receiving configuration.
- Headquarters presents the active configuration as a real QR code rather than only encoded text.
- All Court devices can initialize from the same Headquarters distribution.
- The operator performs one continuous scanning action even when the transfer requires multiple QR frames.
- Court assignment is selected locally after import and can differ between devices using the same ConfigVersion.
- Existing QR result transfer and ACK behavior remains intact.
- Existing config validation/version integrity remains intact.
- Automated tests cover bootstrap gating, QR distribution/import, assignment, and 16:9 display behavior.
