# Foundation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完全オフライン得点管理PWAの土台として、React/TypeScriptアプリ、ドメイン型、得点計算トレース、Revision競合モデル、IndexedDB永続化、最小の本部/コートモード画面を実装する。

**Architecture:** UIからドメインロジックと永続化を分離する。Phase 1ではQR通信そのものは実装せず、後続フェーズが利用する `ResultRevision`、`ScoringProfile`、`CalculationTrace`、Dexie DBの安定したインターフェースを先に確定する。UIは同一PWA内で `COURT` / `HOST` を切り替える最小シェルとし、業務ロジックは純粋TypeScript関数としてVitestでテストする。

**Tech Stack:** React + TypeScript + Vite、Vitest、Dexie 4、Zod、Web Crypto UUID。Node.js 22.12+ を開発・CI基準とする。

**Spec:** `docs/superpowers/specs/2026-08-19-offline-score-management-design.md`

## Global Constraints

- 当日本番は外部API、クラウドDB、CDN、オンライン認証へ依存しない。
- Chromebook / Chromeを主対象とし、Windows / macOS / iPadでも同一アプリコードを使用する。
- Resultの正本はRaw Result + ScoringProfileであり、派生得点だけを正本にしない。
- Result訂正は上書きせずRevisionとして保存する。
- 同じ親Revisionから複数の子Revisionが生えた場合は競合とし、自動採用しない。
- 時刻だけでRevisionの新旧を判定しない。
- IDはオフライン生成可能なUUIDを使用する。
- UI・ドメイン・永続化の責務を分離する。
- Phase 1ではQR Transfer / ACK、CSVインポート、バックアップ、Service Worker本番キャッシュは実装しない。

---

## File Structure

Phase 1終了時の責務分割は以下とする。

```text
src/
├─ app/
│  ├─ App.tsx                    # アプリモード選択と最小シェル
│  └─ App.test.tsx               # モード切替UIのテスト
├─ domain/
│  ├─ ids.ts                     # UUID生成とブランド型
│  ├─ tournament.ts              # Tournament/Team/Competition等の型
│  ├─ result.ts                  # Result/ResultRevision/入力方式
│  ├─ revision.ts                # Revision graph解析・競合判定
│  ├─ revision.test.ts
│  ├─ scoring.ts                 # ScoringProfile/CalculationTrace型
│  ├─ scoring-engine.ts          # 標準得点計算の純粋関数
│  └─ scoring-engine.test.ts
├─ db/
│  ├─ schema.ts                  # Dexieテーブル型とschema version
│  ├─ database.ts                # AppDatabase singleton/factory
│  ├─ result-repository.ts       # Result/Revision保存・取得
│  └─ result-repository.test.ts
├─ device/
│  ├─ device-service.ts          # deviceId生成・保持
│  └─ device-service.test.ts
├─ test/
│  └─ setup.ts                   # jsdom/fake-indexeddb setup
├─ main.tsx
└─ index.css
```

---

### Task 1: Scaffold the React/TypeScript application and test harness

**Files:**
- Create: `package.json`
- Create: `package-lock.json` via `npm install`
- Create: `index.html`
- Create: `tsconfig.json`
- Create: `tsconfig.app.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/App.test.tsx`
- Create: `src/index.css`
- Create: `src/test/setup.ts`
- Create: `.gitignore`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: none.
- Produces: `App` React component; npm scripts `dev`, `build`, `test`, `test:run`, `typecheck`; CI that runs typecheck, tests, and build.

- [ ] **Step 1: Initialize the Vite React TypeScript dependency set**

Create `package.json` with these scripts and dependencies; install with npm so the lockfile records exact resolved versions.

```json
{
  "name": "kaisei-kspo-point",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc -b --pretty false"
  },
  "dependencies": {
    "dexie": "latest",
    "react": "latest",
    "react-dom": "latest",
    "zod": "latest"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "latest",
    "@testing-library/react": "latest",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "@vitejs/plugin-react": "latest",
    "fake-indexeddb": "latest",
    "jsdom": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  }
}
```

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and install exits 0 on Node 22.12+.

- [ ] **Step 2: Write the failing app shell test**

Create `src/app/App.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from './App'

describe('App', () => {
  it('offers host and court modes', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: '本部モード' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'コートモード' })).toBeInTheDocument()
  })
})
```

Create `src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
```

- [ ] **Step 3: Configure Vite, TypeScript, and Vitest, then verify the test fails**

Create `vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

Run:

```bash
npm run test:run -- src/app/App.test.tsx
```

Expected: FAIL because `App` does not exist yet.

- [ ] **Step 4: Implement the minimal app shell**

Create `src/app/App.tsx`:

```tsx
import { useState } from 'react'

type AppMode = 'HOST' | 'COURT' | null

export function App() {
  const [mode, setMode] = useState<AppMode>(null)

  if (mode === 'HOST') {
    return <main><h1>本部モード</h1><button onClick={() => setMode(null)}>モード選択へ戻る</button></main>
  }

  if (mode === 'COURT') {
    return <main><h1>コートモード</h1><button onClick={() => setMode(null)}>モード選択へ戻る</button></main>
  }

  return (
    <main>
      <h1>開成運動交流祭 得点管理</h1>
      <p>使用するモードを選択してください。</p>
      <button onClick={() => setMode('HOST')}>本部モード</button>
      <button onClick={() => setMode('COURT')}>コートモード</button>
    </main>
  )
}
```

Create `src/main.tsx` rendering `<App />` into `#root` and a minimal local-only `src/index.css`; do not reference remote fonts or assets.

- [ ] **Step 5: Add CI and run all foundation checks**

Create `.github/workflows/ci.yml` using `actions/checkout`, `actions/setup-node` with Node 22, `npm ci`, `npm run typecheck`, `npm run test:run`, and `npm run build`.

Run locally:

```bash
npm run typecheck
npm run test:run
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json index.html tsconfig*.json vite.config.ts src .gitignore .github/workflows/ci.yml
git commit -m "chore: scaffold offline score app"
```

---

### Task 2: Define domain IDs and tournament/result types

**Files:**
- Create: `src/domain/ids.ts`
- Create: `src/domain/tournament.ts`
- Create: `src/domain/result.ts`
- Create: `src/domain/scoring.ts`
- Create: `src/domain/ids.test.ts`

**Interfaces:**
- Consumes: browser `crypto.randomUUID()`.
- Produces: branded ID aliases, `createId()`, tournament entities, `Result`, `ResultRevision`, `ScoringProfile`, `CalculationTrace` types used by every later task.

- [ ] **Step 1: Write the failing ID test**

```ts
import { describe, expect, it } from 'vitest'
import { createId } from './ids'

describe('createId', () => {
  it('creates distinct UUID-shaped IDs', () => {
    const first = createId()
    const second = createId()
    expect(first).not.toBe(second)
    expect(first).toMatch(/^[0-9a-f-]{36}$/)
  })
})
```

Run:

```bash
npm run test:run -- src/domain/ids.test.ts
```

Expected: FAIL because `ids.ts` does not exist.

- [ ] **Step 2: Implement IDs**

Create branded string aliases for `TournamentId`, `TeamId`, `CompetitionId`, `CompetitionEntryId`, `ScheduleSlotId`, `CourtRunId`, `ScoringSessionId`, `ResultId`, `RevisionId`, `ScoringProfileId`, `DeviceId`, `BatchId`, plus:

```ts
export function createId<T extends string = string>(): T {
  return crypto.randomUUID() as T
}
```

- [ ] **Step 3: Define tournament scheduling types**

In `src/domain/tournament.ts`, define interfaces for `Tournament`, `Team`, `Competition`, `CompetitionEntry`, `ScheduleSlot`, `CourtRun`, `ScoringSession` and `InputScope = 'PER_COURT' | 'WHOLE_SLOT' | 'CUSTOM_GROUP'`.

`ScoringSession` must reference one or more `courtRunIds` and an `inputScope`.

- [ ] **Step 4: Define Result/Revision types**

In `src/domain/result.ts`, define:

```ts
export type InputMode = 'TIMER' | 'TIME_MANUAL' | 'RANK_MANUAL' | 'NUMBER' | 'WIN_LOSS' | 'SPECIAL'
export type RevisionSource = 'COURT' | 'HOST' | 'CONFLICT_RESOLUTION'
export type RawValue = number | boolean | string | null | { [key: string]: RawValue } | RawValue[]

export interface Result { /* IDs and currentRevisionId */ }
export interface ResultRevision { /* revisionId, resultId, parentRevisionIds, source, operator, inputMode, rawData, configVersion, createdAt */ }
```

Use ISO date strings only for display/audit metadata; do not use them to decide ancestry.

- [ ] **Step 5: Define scoring and trace types**

In `src/domain/scoring.ts`, define standard rule unions for ranking direction, tie award, aggregation, rank award map, and:

```ts
export interface CalculationTraceStep {
  code: string
  label: string
  expression?: string
  value?: number | string
}

export interface TeamScoreResult {
  teamId: TeamId
  rank: number
  awardScore: number
  trace: CalculationTraceStep[]
}
```

- [ ] **Step 6: Run typecheck and tests, then commit**

```bash
npm run typecheck
npm run test:run
```

Expected: PASS.

```bash
git add src/domain
git commit -m "feat: define tournament and result domain model"
```

---

### Task 3: Implement the standard scoring engine with calculation traces

**Files:**
- Create: `src/domain/scoring-engine.ts`
- Create: `src/domain/scoring-engine.test.ts`
- Modify: `src/domain/scoring.ts`

**Interfaces:**
- Consumes: `TeamId`, standard `ScoringProfile` rules.
- Produces: `calculateRankedScores(input, profile): TeamScoreResult[]`.

- [ ] **Step 1: Write failing normal ranking and trace tests**

Create tests for four teams with values `80,70,60,50` and award map `1→30, 2→20, 3→10, 4→0`.

Assert both final scores and that team 1 trace contains a step describing `1位 → 30点`.

- [ ] **Step 2: Run the focused test**

```bash
npm run test:run -- src/domain/scoring-engine.test.ts
```

Expected: FAIL because the engine is not implemented.

- [ ] **Step 3: Implement unique-rank scoring**

Implement a pure function that sorts values according to `HIGHER_IS_BETTER` or `LOWER_IS_BETTER`, derives competition ranking, maps ranks to award points, and emits trace steps.

No database or React imports are allowed in this module.

- [ ] **Step 4: Add failing tied-rank average test**

Input values `100,100,80,70` with award map `30,20,10,0` and `AVERAGE_OCCUPIED_PLACES` must yield:

```text
1組 25
2組 25
3組 10
4組 0
```

The trace for tied teams must include `(30 + 20) ÷ 2 = 25`.

- [ ] **Step 5: Implement average occupied-place tie scoring**

For a tie spanning positions `start..end`, average each occupied rank's award points; the next rank follows competition ranking (`1,1,3,4`).

- [ ] **Step 6: Add and pass lower-is-better test**

Use relay-like millisecond values and verify lower corrected time ranks first. The input to this generic function is already the comparable derived value; penalty derivation will be a later specialized adapter.

- [ ] **Step 7: Run full checks and commit**

```bash
npm run typecheck
npm run test:run
npm run build
```

Expected: PASS.

```bash
git add src/domain/scoring.ts src/domain/scoring-engine.ts src/domain/scoring-engine.test.ts
git commit -m "feat: add traceable scoring engine"
```

---

### Task 4: Implement Revision graph analysis and conflict resolution primitives

**Files:**
- Create: `src/domain/revision.ts`
- Create: `src/domain/revision.test.ts`

**Interfaces:**
- Consumes: `ResultRevision[]`.
- Produces: `analyzeRevisionGraph()`, `createResolutionRevision()`.

- [ ] **Step 1: Write failing linear-history test**

Create revisions `rev1 -> rev2 -> rev3`. Assert analysis returns `status: 'CLEAN'` and `heads: [rev3]`.

- [ ] **Step 2: Write failing sibling-conflict test**

Create `rev2Court` and `rev2Host` with the same parent `rev1`. Assert analysis returns:

```ts
{
  status: 'CONFLICT',
  heads: expect.arrayContaining([rev2Court.revisionId, rev2Host.revisionId])
}
```

- [ ] **Step 3: Run tests and verify failure**

```bash
npm run test:run -- src/domain/revision.test.ts
```

Expected: FAIL because `revision.ts` does not exist.

- [ ] **Step 4: Implement ancestry/head calculation**

`analyzeRevisionGraph(revisions)` must determine heads by ID/parent edges, never by timestamp or revisionNumber alone. Zero or one head is `CLEAN`; multiple heads are `CONFLICT`.

- [ ] **Step 5: Add failing resolution-revision test**

`createResolutionRevision()` must create a new `CONFLICT_RESOLUTION` Revision with both conflicting heads in `parentRevisionIds`, a new UUID, provided operator/rawData/configVersion, and `revisionNumber = max(parent revisionNumber) + 1`.

- [ ] **Step 6: Implement resolution revision and pass tests**

Use `createId<RevisionId>()`. Do not delete or mutate parent revisions.

- [ ] **Step 7: Run checks and commit**

```bash
npm run typecheck
npm run test:run
```

Expected: PASS.

```bash
git add src/domain/revision.ts src/domain/revision.test.ts
git commit -m "feat: add revision conflict model"
```

---

### Task 5: Add IndexedDB schema and Result repository

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/database.ts`
- Create: `src/db/result-repository.ts`
- Create: `src/db/result-repository.test.ts`

**Interfaces:**
- Consumes: domain `Result`, `ResultRevision`.
- Produces: `createDatabase(name?)`, `ResultRepository.saveResultWithRevision()`, `getResult()`, `getRevisions()`, `getCurrentRevision()`.

- [ ] **Step 1: Write failing repository persistence test**

Using a unique test DB name, save one Result and Revision, close/reopen the DB, and assert both can be retrieved.

- [ ] **Step 2: Run focused test**

```bash
npm run test:run -- src/db/result-repository.test.ts
```

Expected: FAIL because DB modules do not exist.

- [ ] **Step 3: Implement schema version 1**

Use Dexie with typed tables. Include all stores from the design spec in schema v1, even if Phase 1 only actively accesses results/revisions. Create indexes required for:

- Result by `tournamentId`, `competitionId`, `scoringSessionId`
- Revision by `resultId`
- QR parts later by compound `[batchId+partIndex]`

Do not put arbitrary nested `rawData` fields into indexes.

- [ ] **Step 4: Implement ResultRepository atomic save**

`saveResultWithRevision(result, revision)` must use a Dexie transaction covering both tables and validate `result.resultId === revision.resultId` before writing.

- [ ] **Step 5: Add failing current-revision test**

After saving rev1 and rev2 and updating the Result's `currentRevisionId`, `getCurrentRevision(resultId)` must return rev2 exactly.

- [ ] **Step 6: Implement retrieval methods and pass tests**

Sort revision history for display by `revisionNumber` then `createdAt`, but never use this sort to infer ancestry/conflict.

- [ ] **Step 7: Run checks and commit**

```bash
npm run typecheck
npm run test:run
npm run build
```

Expected: PASS.

```bash
git add src/db
git commit -m "feat: persist results and revisions in indexeddb"
```

---

### Task 6: Add persistent device identity and wire foundation status into the UI

**Files:**
- Create: `src/device/device-service.ts`
- Create: `src/device/device-service.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `DeviceId`, browser local storage.
- Produces: `getOrCreateDeviceId(storage?)` and visible app footer showing local/offline-oriented status fields.

- [ ] **Step 1: Write failing device identity test**

Use an in-memory Storage stub. Call `getOrCreateDeviceId` twice and assert the same UUID is returned; a fresh storage gets a different UUID.

- [ ] **Step 2: Implement device identity service**

Persist only the device ID and non-sensitive local preferences in localStorage. Tournament results remain in IndexedDB.

- [ ] **Step 3: Extend App shell test**

Assert the initial UI includes `App 0.1.0` and a visible `Device` label, while host/court mode buttons still exist.

- [ ] **Step 4: Implement foundation status footer and safe reload entry point**

Add a small footer/header status area containing:

```text
App 0.1.0 | Config - | Device <short-id>
```

Add a `アプリを再読み込み` button that asks for confirmation and calls `window.location.reload()` only after confirmation. Do not clear IndexedDB, Cache Storage, localStorage, or invoke any update mechanism.

- [ ] **Step 5: Run complete Phase 1 verification**

```bash
npm run typecheck
npm run test:run
npm run build
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/device src/app src/index.css
git commit -m "feat: add device identity and safe reload control"
```

---

## Phase 1 Acceptance Criteria

- `npm ci && npm run typecheck && npm run test:run && npm run build` succeeds on Node 22.
- App starts with host/court mode selection.
- No production source references a remote CDN, remote font, cloud database, or external API.
- Domain IDs are generated locally with UUIDs.
- Standard ranking calculation supports higher/lower-is-better and tied-rank average points with human-readable CalculationTrace.
- Revision graph detects sibling conflicts by parent relationships, not timestamps.
- Conflict resolution creates a merge-like Revision without deleting history.
- Result + Revision persist atomically to IndexedDB and survive DB reopen.
- Device ID persists locally.
- Safe reload does not delete application data.
- CI checks typecheck, tests, and production build.

## Follow-on Plans

After Phase 1, create separate plans for:

1. QR Transfer / multi-part framing / checksums / ACK.
2. Court workflow and configurable ScoringSession input forms.
3. Host intake, tournament aggregation, conflict-resolution UI, display screen.
4. Tournament configuration, CSV mapping, scoring simulator/test cases.
5. Config QR, backup/restore, PWA Service Worker, persistent storage diagnostics, full offline rehearsal.
