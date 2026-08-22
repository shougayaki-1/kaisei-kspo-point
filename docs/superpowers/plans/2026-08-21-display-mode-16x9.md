# 16:9 Display Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Display mode a clean, read-only 16:9 presentation surface that uses the Host-authoritative standings, shows the configured tournament name, and remains usable when browser fullscreen is unavailable.

**Architecture:** Keep `HostScoringState` as the single read model and add the tournament name to it. Render Display mode through a dedicated `DisplayModeScreen` outside the normal operator AppBar/Container/footer shell, with a centered 16:9 stage and non-fatal fullscreen request. `DisplayDashboard` remains responsible for polling and last-known-good state retention, but renders projector-oriented standings cards instead of the current ordered list.

**Tech Stack:** React, TypeScript, Material UI, CSS, Dexie/IndexedDB, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-21-display-and-court-bootstrap-design.md`

## Global Constraints

- Display mode is read-only and must not expose controls that mutate scoring state.
- Display mode must use the existing Host-authoritative `loadAuthoritativeState()` path.
- The public content stage must preserve an exact 16:9 aspect ratio without cropping.
- Browser fullscreen is an enhancement only; fullscreen rejection must not block Display mode.
- A refresh failure after one successful load must keep the previous standings visible.
- Do not add network synchronization, cloud services, or a second standings projection.
- Keep existing scoring/ranking semantics unchanged.
- Use TDD for every behavior change: RED → GREEN → REFACTOR.
- Before implementation, re-read current `main`; `9514ad83fe2b0b813a8b8ab541ea55a1df4a6d77` is planning context, not a fixed future execution baseline.

---

## File structure locked by this plan

### New files

- `src/app/DisplayModeScreen.tsx` — dedicated Display-mode viewport, 16:9 stage wrapper, exit control, and fullscreen-safe entry point integration.
- `src/app/DisplayModeScreen.test.tsx` — focused structural and interaction tests for the presentation shell.

### Existing files expected to change

- `src/app/host-scoring-service.ts` — include `tournamentName` in `HostScoringState`.
- `src/app/host-scoring-service.test.ts` — verify the name comes from the active immutable ConfigVersion snapshot.
- `src/app/DisplayDashboard.tsx` — projector-oriented standings markup while preserving polling behavior.
- `src/app/DisplayDashboard.test.tsx` — update expectations and preserve refresh/error regression coverage.
- `src/app/App.tsx` — bypass operator shell for Display mode and request fullscreen from the user gesture.
- `src/app/App.test.tsx` — verify operator chrome is absent in Display mode and fullscreen failure is non-fatal.
- `src/index.css` — exact 16:9 stage sizing, letterbox background, scalable typography, standings grid/rows, and unobtrusive exit control.

---

### Task 1: Add tournament identity to the Host-authoritative display state

**Files:**
- Modify: `src/app/host-scoring-service.ts`
- Modify: `src/app/host-scoring-service.test.ts`
- Modify: `src/app/DisplayDashboard.test.tsx` fixture builders that construct `HostScoringState`

**Interfaces:**
- Produces the exact added field:

```ts
export interface HostScoringState {
  tournamentId: TournamentId
  tournamentName: string
  configVersionId: string
  configVersion: number
  projections: HostProjectionView[]
  events: HostEventScore[]
  standings: AggregateStanding[]
}
```

- [ ] **Step 1: Write the failing service assertion**

In the existing `loadAuthoritativeState()` test fixture, give the tournament a distinctive name and assert:

```ts
const state = await service.loadAuthoritativeState()
expect(state.tournamentName).toBe('表示テスト大会')
```

Also update any literal `HostScoringState` fixtures in `DisplayDashboard.test.tsx` with:

```ts
tournamentName: '表示テスト大会',
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
npm run test:run -- src/app/host-scoring-service.test.ts src/app/DisplayDashboard.test.tsx
```

Expected: FAIL because `HostScoringState` does not yet expose `tournamentName`.

- [ ] **Step 3: Implement the minimal read-model change**

In `loadAuthoritativeState()`, return the name from the same active snapshot already used for standings:

```ts
return {
  tournamentId: snapshot.tournament.tournamentId,
  tournamentName: snapshot.tournament.name,
  configVersionId: active.configVersionId,
  configVersion: active.version,
  projections: views,
  events,
  standings: buildAggregateStandings(snapshot.teams, eventScores),
}
```

Do not read the tournament name from a separate mutable table after the active snapshot has been selected.

- [ ] **Step 4: Run the focused tests and verify GREEN**

```bash
npm run test:run -- src/app/host-scoring-service.test.ts src/app/DisplayDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -- src/app/host-scoring-service.ts src/app/host-scoring-service.test.ts src/app/DisplayDashboard.test.tsx
git commit -m "feat: expose tournament name in host scoring state"
```

---

### Task 2: Introduce a dedicated Display-mode shell and remove operator chrome

**Files:**
- Create: `src/app/DisplayModeScreen.tsx`
- Create: `src/app/DisplayModeScreen.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

**Interfaces:**
- `DisplayModeScreen` consumes:

```ts
export interface DisplayModeScreenProps {
  service: DisplayDashboardService
  onExit(): void
}
```

- `App` gains an injectable fullscreen adapter for deterministic tests:

```ts
export interface AppProps {
  // existing props...
  requestDisplayFullscreen?: () => Promise<void> | void
}
```

Default behavior:

```ts
const defaultRequestDisplayFullscreen = () => document.documentElement.requestFullscreen?.()
```

- [ ] **Step 1: Write failing `DisplayModeScreen` structure tests**

Create tests that render:

```tsx
<DisplayModeScreen
  service={{ loadAuthoritativeState: vi.fn().mockResolvedValue(authoritativeState()) }}
  onExit={onExit}
/>
```

Assert:

```ts
expect(screen.getByRole('region', { name: '16:9 表示ステージ' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '表示モードを終了' })).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: '表示モードを終了' }))
expect(onExit).toHaveBeenCalledOnce()
```

- [ ] **Step 2: Write failing App shell/fullscreen tests**

Enter Display mode by clicking `表示モード`. Assert that these normal-shell elements are absent:

```ts
expect(screen.queryByText('端末状態')).not.toBeInTheDocument()
expect(screen.queryByRole('contentinfo', { name: '端末状態' })).not.toBeInTheDocument()
expect(screen.queryByText('アプリの設定・データ管理')).not.toBeInTheDocument()
```

Inject:

```ts
const requestDisplayFullscreen = vi.fn().mockRejectedValue(new Error('denied'))
```

and assert Display mode still renders the `16:9 表示ステージ`.

- [ ] **Step 3: Run the focused tests and verify RED**

```bash
npm run test:run -- src/app/DisplayModeScreen.test.tsx src/app/App.test.tsx
```

Expected: FAIL because the dedicated screen and injected fullscreen adapter do not exist.

- [ ] **Step 4: Implement `DisplayModeScreen`**

Use this structural contract:

```tsx
export function DisplayModeScreen({ service, onExit }: DisplayModeScreenProps) {
  return (
    <main className="display-viewport">
      <div className="display-stage" role="region" aria-label="16:9 表示ステージ">
        <DisplayDashboard service={service} />
      </div>
      <button
        type="button"
        className="display-exit-button"
        aria-label="表示モードを終了"
        onClick={onExit}
      >
        戻る
      </button>
    </main>
  )
}
```

The exit control is outside the `.display-stage` so it never changes the 16:9 public composition.

- [ ] **Step 5: Bypass the normal App shell for Display mode**

In `App.tsx`, add:

```ts
const requestFullscreen =
  requestDisplayFullscreen ??
  (() => document.documentElement.requestFullscreen?.())

const enterDisplayMode = () => {
  setMode('DISPLAY')
  try {
    const result = requestFullscreen()
    if (result) void Promise.resolve(result).catch(() => {})
  } catch {
    // Fullscreen is optional. Display mode remains active.
  }
}
```

Use `enterDisplayMode` for the `表示を開く` action.

Before returning the normal `.app-shell`, branch:

```tsx
if (mode === 'DISPLAY' && !releaseGateBlocksMode) {
  return (
    <DisplayModeScreen
      service={hostScoringServices}
      onExit={returnToModeSelection}
    />
  )
}
```

Remove the old `mode === 'DISPLAY'` branch from the normal `content` tree.

- [ ] **Step 6: Run the focused tests and verify GREEN**

```bash
npm run test:run -- src/app/DisplayModeScreen.test.tsx src/app/App.test.tsx
```

Expected: PASS, including fullscreen rejection.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/DisplayModeScreen.tsx src/app/DisplayModeScreen.test.tsx src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add dedicated display mode shell"
```

---

### Task 3: Render a projector-oriented 16:9 standings dashboard

**Files:**
- Modify: `src/app/DisplayDashboard.tsx`
- Modify: `src/app/DisplayDashboard.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Keep the existing polling interface unchanged:

```ts
export interface DisplayDashboardService {
  loadAuthoritativeState(): Promise<HostScoringState>
}
```

- Preserve `refreshIntervalMs` and the current sequential `setTimeout` refresh model.

- [ ] **Step 1: Rewrite failing dashboard expectations around semantic rows**

Replace text-coupled assertions such as:

```ts
screen.getByText('1位 Configured Red: 7.5')
```

with projector markup expectations:

```ts
expect(await screen.findByRole('heading', { name: '表示テスト大会' })).toBeInTheDocument()
expect(screen.getByRole('heading', { name: '総合順位' })).toBeInTheDocument()

const row = screen.getByRole('listitem', { name: '1位 Configured Red 7.5点' })
expect(row).toBeInTheDocument()
expect(within(row).getByText('1')).toBeInTheDocument()
expect(within(row).getByText('Configured Red')).toBeInTheDocument()
expect(within(row).getByText('7.5')).toBeInTheDocument()
```

Keep the existing tests for:
- no write actions,
- offline/remount,
- refresh without remount,
- no overlapping refresh,
- last-known-good standings after later failure.

- [ ] **Step 2: Run the dashboard tests and verify RED**

```bash
npm run test:run -- src/app/DisplayDashboard.test.tsx
```

Expected: FAIL because the current dashboard is an `<ol>` with a compact text sentence.

- [ ] **Step 3: Implement semantic presentation markup**

Use a structure equivalent to:

```tsx
<section className="display-dashboard" aria-label="Display standings">
  <header className="display-dashboard__header">
    <div>
      <p className="display-dashboard__eyebrow">開成運動交流祭 得点管理</p>
      <h1>{state.tournamentName}</h1>
    </div>
    <div className="display-dashboard__version">Config v{state.configVersion}</div>
  </header>

  <div className="display-dashboard__title-row">
    <h2>総合順位</h2>
    {error ? <p className="display-dashboard__warning" role="alert">更新失敗・前回値を表示中</p> : null}
  </div>

  <ol className="display-standings" aria-label="総合順位一覧">
    {state.standings.map((standing) => (
      <li
        className="display-standing"
        key={standing.teamId}
        aria-label={`${standing.rank}位 ${standing.teamName} ${String(standing.totalScore)}点`}
      >
        <span className="display-standing__rank">{standing.rank}</span>
        <span className="display-standing__team">{standing.teamName}</span>
        <span className="display-standing__score">{String(standing.totalScore)}</span>
        <span className="display-standing__unit">点</span>
      </li>
    ))}
  </ol>
</section>
```

For initial load failure, keep the error inside the stage. For later failure, keep the prior state and show only the compact warning.

- [ ] **Step 4: Add exact 16:9 and scaling CSS**

Add:

```css
.display-viewport {
  width: 100dvw;
  height: 100dvh;
  display: grid;
  place-items: center;
  overflow: hidden;
  position: relative;
  background: #0b1220;
}

.display-stage {
  width: min(100dvw, calc(100dvh * 16 / 9));
  height: min(100dvh, calc(100dvw * 9 / 16));
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #f8fafc;
}

.display-dashboard {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: clamp(24px, 3.2vw, 64px);
  display: grid;
  grid-template-rows: auto auto 1fr;
  gap: clamp(14px, 1.6vw, 30px);
}

.display-dashboard__header,
.display-dashboard__title-row,
.display-standing {
  display: grid;
  align-items: center;
}

.display-dashboard__header {
  grid-template-columns: 1fr auto;
}

.display-standing {
  grid-template-columns: minmax(72px, 0.12fr) 1fr auto auto;
  min-height: 0;
  overflow: hidden;
}

.display-standings {
  min-height: 0;
  display: grid;
  grid-auto-rows: 1fr;
  gap: clamp(8px, 0.8vw, 16px);
  margin: 0;
  padding: 0;
  list-style: none;
}

.display-standing__rank {
  font-size: clamp(2rem, 4.2vw, 5rem);
  font-weight: 900;
}

.display-standing__team {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: clamp(1.4rem, 2.6vw, 3.2rem);
  font-weight: 800;
}

.display-standing__score {
  font-size: clamp(2rem, 4vw, 4.8rem);
  font-variant-numeric: tabular-nums;
  font-weight: 900;
}

.display-exit-button {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 2;
  opacity: 0.2;
}

.display-exit-button:hover,
.display-exit-button:focus-visible {
  opacity: 1;
}
```

Keep row content inside the stage; do not add scrolling to `.display-standings`.

- [ ] **Step 5: Run focused tests**

```bash
npm run test:run -- src/app/DisplayDashboard.test.tsx src/app/DisplayModeScreen.test.tsx src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add -- src/app/DisplayDashboard.tsx src/app/DisplayDashboard.test.tsx src/index.css
git commit -m "feat: render projector-ready standings"
```

---

### Task 4: Run Display-mode regression and manual viewport acceptance

**Files:**
- No production file changes expected unless a verification failure requires a fix.

**Interfaces:**
- Verifies the completed Display-mode contract from Tasks 1-3.

- [ ] **Step 1: Run the full automated suite**

```bash
npm run test:run
npm run typecheck
npm run build
```

Expected:
- Vitest: 0 failed tests.
- TypeScript: exit 0.
- Vite build: exit 0.

- [ ] **Step 2: Verify 16:9 desktop behavior manually**

Run:

```bash
npm run dev
```

Open Display mode in a 1920×1080 viewport and verify:
- no AppBar, diagnostics button, data-management accordion, or footer;
- stage fills the viewport;
- tournament title, `総合順位`, ranks, team names, and scores are readable;
- no vertical scroll appears.

- [ ] **Step 3: Verify non-16:9 behavior manually**

Test at 1440×900 (16:10) and 1024×768 (4:3). Verify:
- the stage remains 16:9;
- unused viewport area appears outside the stage;
- no standings content is cropped or stretched.

- [ ] **Step 4: Verify fullscreen rejection behavior manually**

Block fullscreen permission or test in a context where `requestFullscreen()` rejects. Click `表示を開く` and verify the fitted 16:9 stage still appears.

- [ ] **Step 5: Verify last-known-good refresh behavior**

With standings visible, simulate/induce a transient local read failure and confirm:
- previous standings remain visible;
- the warning appears;
- the display does not blank.

- [ ] **Step 6: Record final verification in the implementation PR description**

Include:
- test command results,
- build result,
- tested viewport sizes,
- fullscreen fallback result.

Do not claim projector/event-day acceptance until the real projector/TV check from the design spec has also been performed.
