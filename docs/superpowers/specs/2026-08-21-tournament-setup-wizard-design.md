# 開成運動交流祭 大会設定ウィザード／設定ホーム UX 改善 設計仕様

- 作成日: 2026-08-21
- 対象: `shougayaki-1/kaisei-kspo-point`
- planning reference main: `ca99b8169476414fb881198252c94617010aad90`
- 位置づけ: 既存 Formal Design v1.0 を変更せず、その大会設定 UX を具体化する追加設計
- 状態: 会話内で主要方針承認済み
- 実装開始時の注意: 上記 SHA を固定 baseline とせず、必ず current `main` を再確認する

## 1. 目的

本部画面の大会設定を、現在の内部データモデルを直接編集する方式から、運営者が大会運営上の言葉だけで設定できる方式へ置き換える。

特に、新規大会作成で利用者が `CompetitionEntry`、`ScheduleSlot`、`CourtRun`、`ScoringSession`、`InputSchema`、`ScoringProfile`、内部 enum、field key 等を理解しなくても、質問に答えるだけで正しい `TournamentConfigSnapshot` を生成できることを目的とする。

一方で、既存 Formal Design の次の原則は変更しない。

- 大会設定の正本は本部の適用済み `ConfigVersion`
- 得点計算は生結果 + immutable configuration から決定的に再計算する
- QR / ACK / Revision / Conflict / Audit / Backup の既存意味論を変更しない
- 大会固有ルールをアプリの固定ロジックに埋め込まない
- 本番当日は完全オフラインで動作する
- 選手個人情報を保持しない

## 2. 採用する UX

### 2.1 新規大会

初回だけ一本道のウィザードを使う。

1. 大会情報
2. チーム
3. 年度・競技テンプレート
4. 競技ごとの簡単設定
5. 時程・コート
6. 得点・入力方法の確認
7. 最終チェックと適用

各入力はローカルへ自動保存する。正式適用前は `ConfigVersion` を作らない。

### 2.2 作成後

正式適用後はウィザードではなく「大会設定ホーム」を表示する。

設定ホームの主要カード:

- 基本情報
- チーム
- 競技
- 時程・コート
- 得点・入力
- コート端末へ配布
- 設定チェック

利用者は変更したい場所へ直接入る。例えば玉入れだけ変更する場合、競技一覧から玉入れを開く。

### 2.3 簡単設定と詳細設定

簡単設定と詳細設定は別データモデルを持たない。

- 通常表示: 大会運営に必要な最低限の質問
- 「詳細設定」展開時: 同じ編集状態に対する追加項目

内部 ID、schema key、enum 値を直接編集する画面は廃止する。

表示用語の例:

| 内部概念 | UI 表示 |
| --- | --- |
| `PER_COURT` | コートごとに入力 |
| `WHOLE_SLOT` | 同じ回の全コートをまとめて入力 |
| `CUSTOM_GROUP` | 指定した複数コートをまとめて入力 |
| `HIGHER_IS_BETTER` | 大きい方が上位 |
| `LOWER_IS_BETTER` | 小さい方が上位 |
| `TieAwardRule` | 同順位のときの配点 |
| `AggregationRule` | 複数回の結果をどう集計するか |

## 3. 状態モデル

### 3.1 `TournamentSetupDraft`

新規大会ウィザード専用の、人間向けデータモデル。

```ts
export type SetupStep =
  | 'BASIC'
  | 'TEAMS'
  | 'TEMPLATES'
  | 'COMPETITIONS'
  | 'SCHEDULE'
  | 'SCORING_REVIEW'
  | 'FINAL_CHECK'

export interface TournamentSetupDraft {
  draftFormatVersion: 1
  draftId: string
  createdAt: string
  updatedAt: string
  currentStep: SetupStep

  tournament: {
    name: string
    eventDate?: string
  }

  teams: SetupTeamDraft[]

  templateSource:
    | { type: 'NONE' }
    | { type: 'BUILT_IN'; templateId: string; templateVersion: number }
    | { type: 'IMPORTED'; templateId: string; templateVersion: number }

  competitions: SetupCompetitionDraft[]
}
```

`SetupTeamDraft` と `SetupCompetitionDraft` は UI 内の安定した local key を持つが、正式 domain ID は compile 時に生成する。

### 3.2 自動保存

既存 IndexedDB の `localSettings` を利用し、新規テーブル追加を避ける。

固定キー:

```text
host.tournamentSetupDraft.v1
```

保存状態は UI 上で必ず以下のいずれかを表示する。

- 保存中
- 保存済み
- 保存に失敗

IndexedDB 書き込み失敗時に「保存済み」と表示してはならない。

画面遷移時には保存完了を確認する。`pagehide` / unmount でも最後の変更を flush する。

### 3.3 `ConfigEditDraft`

大会作成後の編集は、完全な `TournamentConfigSnapshot` の作業コピーを使う。

```ts
export interface ConfigEditDraft {
  draftFormatVersion: 1
  tournamentId: TournamentId
  baseConfigVersionId: string
  baseConfigVersion: number
  createdAt: string
  updatedAt: string
  snapshot: TournamentConfigSnapshot
}
```

保存キー:

```text
host.configEditDraft.v1:<tournamentId>
```

再開時に active config と `baseConfigVersionId` が一致しなければ、古い下書きを盲目的に適用しない。初期実装では自動 rebase を行わず、「最新設定から編集をやり直す」を安全側の既定動作とする。

## 4. テンプレートモデル

### 4.1 テンプレート種別

2 系統を同じ registry で扱う。

1. 開成運動交流祭の年度別テンプレート
2. 汎用競技テンプレート

汎用テンプレートの初期 4 種:

- `RANKING`
- `TIME`
- `QUANTITY`
- `WIN_LOSS`

### 4.2 年度別テンプレート

年度別テンプレートは「設定の初期値」であり、作成後の大会と live link しない。

```text
年度別テンプレート
  ↓ copy
TournamentSetupDraft
  ↓ user edits
大会固有設定
```

後からテンプレートファイルを更新しても、既存大会を勝手に変更しない。

### 4.3 外部テンプレート

外部ファイルは JSON とし、`templateFormatVersion` を必須にする。

```ts
export interface TournamentSetupTemplateFile {
  templateFormatVersion: 1
  templateId: string
  templateVersion: number
  name: string
  eventYear?: number
  competitions: CompetitionSetupTemplate[]
}
```

読み込み時に少なくとも以下を検証する。

- JSON shape
- format version
- template ID / competition template key の重複
- 利用可能な competition kind
- 入力方式
- ranking direction
- tie handling
- aggregation
- 配点値
- コート数 / 実施回数
- 未対応 scoring rule が含まれていないこと

不正なテンプレートを正式 Config へ直接適用する経路は作らない。

### 4.4 2026 テンプレート

2026 年度の組・競技・配点・特殊競技詳細は、当年度の承認済み競技要領／authoritative configuration を正本としてテンプレート化する。

テンプレートに値を持つことは許容するが、それは「2026 テンプレートのデータ」であり、得点エンジンの不変定数にはしない。

## 5. 競技作成 UX

### 5.1 年度テンプレート利用時

年度テンプレートを選ぶと競技一覧をすべてチェック済みで表示する。

利用者は「今年実施しない競技」だけチェックを外す。

各競技カードは:

- 競技名
- 1 行要約
- `設定済み` / `要確認` / `エラーあり`
- 「設定を変更」

を表示する。

### 5.2 汎用テンプレート利用時

競技作成は「テンプレート + 2〜4 問」に制限する。

例: `QUANTITY`

1. 入力する値の名前
2. 大きい方 / 小さい方が上位
3. 1 チームを何グループに分けるか（標準 1 の場合は省略可能）
4. コート別入力 / 同じ回をまとめて入力

### 5.3 参加単位

テンプレートに標準 `groupsPerTeam` を持たせる。

- 通常競技: 1
- 分割競技: 2 以上

表示名はテンプレートの label pattern から自動生成する。例:

```text
1組
1組① / 1組②
1組α / 1組β
```

最終集計先は必ず Team とし、CompetitionEntry は競技内参加単位として生成する。

## 6. 時程・コート UX

通常設定で尋ねるのは原則:

- 実施回数
- 使用コート数
- 入力方法

のみ。

自動割当後、表形式で確認する。

```text
           Aコート    Bコート    Cコート    Dコート
第1回      1組①      2組①      3組①      4組①
第2回      1組②      2組②      3組②      4組②
```

「時程を編集」でのみ次を変更可能にする。

- 開始・終了予定
- 使用コート
- 参加グループ
- 実施順
- 複数コートをまとめる範囲

内部では既存 `ScheduleSlot / CourtRun / ScoringSession` を生成するが、通常 UI には内部用語を出さない。

## 7. 得点・入力設定 UX

テンプレート種別ごとに運営者向けの質問へ変換する。

### 7.1 順位競技

- 何位まで得点を与えるか
- 順位ごとの配点
- 同順位の扱い
- 複数回の集計方法

### 7.2 タイム競技

- タイム手入力 / アプリ計測 / 順位直接入力
- ペナルティ使用有無
- 順位配点
- 複数回の集計方法

### 7.3 回数・得点競技

- 入力値の名前
- 大きい / 小さい方が上位
- 最小・最大・刻み（詳細設定）
- 順位配点

### 7.4 勝敗競技

- 勝 / 分 / 負の入力
- 勝点等の扱い
- 順位配点または競技点集約

### 7.5 入力プレビュー

設定画面内にコート担当者が見る簡易プレビューを表示する。

目的は schema の技術的内容ではなく、「当日この入力画面で迷わないか」を確認すること。

## 8. Compile 境界

新規大会では `TournamentSetupDraft` を正式 Config と混ぜない。

```text
TournamentSetupDraft
  ↓ compileTournamentSetup()
TournamentConfigSnapshot
  ↓ validateTournamentConfig()
  ↓ scoring regression / test cases
  ↓ ConfigRepository.apply()
ConfigVersion
```

`compileTournamentSetup()` は既存 domain model を出力する唯一の主要境界とする。

生成対象:

- Tournament
- Team
- Competition
- CompetitionEntry
- ScheduleSlot
- CourtRun
- ScoringSession
- InputSchema
- ScoringProfile
- ScoringTestCase（テンプレートが提供する場合）

compiler は dependency injection された ID factory を受け取り、unit test では固定 ID を使用できるようにする。

## 9. 最終チェック

最終チェックは raw validation code の一覧ではなく、運営者向けカテゴリで表示する。

例:

- 大会情報: OK
- チーム: 4組
- 競技: 8競技
- 時程: すべて割当済み
- 入力方法: すべて設定済み
- 得点ルール: 8/8確認済み
- 得点テスト: 7/8成功
- コート割当: 警告1件

各 issue に:

- 競技名
- 人間向けメッセージ
- `ERROR` / `WARNING`
- 「修正する」リンク先

を持たせる。

`ERROR` は正式適用をブロックする。`WARNING` は確認後続行可能。

内部 validation code はログ・テスト用に保持してよいが、通常 UI の第一表示にはしない。

## 10. 作成後の編集

大会設定ホームから編集を開始すると、active snapshot を `ConfigEditDraft` に clone する。

```text
active ConfigVersion
  ↓ clone
ConfigEditDraft
  ↓ edit/autosave
impact analysis
  ↓ validate
scoring regression
  ↓ apply
new ConfigVersion
```

「変更を破棄」は edit draft のみ削除し、active Config と結果データには触れない。

## 11. changeClass 自動判定

運営者に `DISPLAY_ONLY / SCHEDULE / SCORING / INPUT_SCHEMA` を選ばせない。

`classifyConfigChange(base, next)` で自動判定する。

優先順位:

```text
INPUT_SCHEMA > SCORING > SCHEDULE > DISPLAY_ONLY
```

基本分類:

- InputSchema の変更 → `INPUT_SCHEMA`
- ScoringProfile / ScoringTestCase / Team・Competition・Entry の構造変更 → `SCORING`
- ScheduleSlot / CourtRun / ScoringSession の変更 → `SCHEDULE`
- 大会名、開催日、純粋な表示名のみ → `DISPLAY_ONLY`

複数分類に跨る場合は高リスク側を採用する。

## 12. 結果存在後の安全性

結果が既に存在する大会では、設定変更前に impact analysis を実施する。

少なくとも次をブロックまたは強警告する。

- Result が参照する Competition の削除
- Result が参照する ScoringSession の削除
- 結果の解釈を不可能にする InputSchema 変更
- 既存 scoring test が失敗する ScoringProfile 変更

自動 rebase、既存 Result の destructive migration、結果の黙示的書き換えは行わない。

## 13. バックアップ

setup/edit draft は `localSettings` に保存するため、現行 Host backup の `localSettings` 対象範囲に自然に含まれる。

復元後:

- 適用済み ConfigVersion が正本
- 未完了 setup draft があれば再開可能
- edit draft は `baseConfigVersionId` を再検証してから再開

backup format を今回だけの理由で変更しない。

## 14. エラー処理

- autosave failure: 明示し、最後に成功した保存時刻を表示
- imported template invalid: import を拒否し、具体的な validation issue を表示
- compiler error: 正式適用へ進ませない
- domain validation ERROR: 「修正する」導線を付ける
- regression failure: 既存の明示承認フローを維持
- stale ConfigEditDraft: 適用をブロックし、最新 Config から再編集
- unexpected error: current active Config は変更しない

## 15. コンポーネント境界

新規 UI は既存の巨大な `TournamentConfigEditorBase.tsx` をさらに肥大化させない。

推奨構造:

```text
src/config/setup/
  setup-types.ts
  setup-draft-repository.ts
  template-schema.ts
  builtin-templates.ts
  setup-compiler.ts
  setup-validation.ts
  config-change-classifier.ts
  config-change-impact.ts

src/app/tournament-setup/
  TournamentConfigWorkspace.tsx
  TournamentSetupWizard.tsx
  SetupProgress.tsx
  BasicStep.tsx
  TeamsStep.tsx
  TemplateStep.tsx
  CompetitionStep.tsx
  ScheduleStep.tsx
  ScoringReviewStep.tsx
  FinalCheckStep.tsx
  CompetitionQuickEditor.tsx
  CompetitionAdvancedEditor.tsx
  ScheduleGridEditor.tsx
  CourtInputPreview.tsx

src/app/tournament-settings/
  TournamentSettingsHome.tsx
  TournamentSettingsEditor.tsx
  SettingsSummaryCard.tsx
```

`App.tsx` は host CONFIG tab で `TournamentConfigWorkspace` を表示するだけにし、setup/edit の詳細状態を持たせない。

## 16. 既存 UI の扱い

`TournamentConfigEditorBase` の raw editor を通常 UI から外す。

移行中は内部実装・テストの参照として残してよいが、最終受入時には本部通常操作から到達不能にする。

`TournamentConfigEditor` にある scoring regression gate は削除せず、新 workspace の apply service へ移す／再利用する。

`ConfigFilePanel` と `ConfigUpdatePanel` は別機能として維持する。大会設定ホームから「コート端末へ配布」へ導線を出す。

## 17. アクセシビリティ・表示

- MUI を既存 UI design system として継続
- wizard progress は色だけでなく文字でも状態を表す
- form label を必須にする
- error summary と該当 field を関連付ける
- keyboard 操作で全設定可能
- small viewport / iPad では横長 schedule grid を安全に horizontal scroll
- destructive action は確認ダイアログ
- 内部英語 enum を通常ユーザーへ表示しない

## 18. 非目標

今回実装しない:

- 勝者が次の試合へ自動進出するトーナメント bracket
- online template marketplace
- cloud synchronization
- arbitrary formula language
- automatic migration of already-confirmed results after structural config changes
- template update による既存大会の自動書き換え
- 複数 edit draft の merge

## 19. 受入条件

1. 新規大会を raw internal terms を知らずに作成できる。
2. チーム数入力から標準名を生成し、個別修正できる。
3. 年度テンプレートの競技をチェック方式で一括選択できる。
4. 汎用 4 種の競技テンプレートから 2〜4 問で競技を作れる。
5. 参加単位をテンプレート標準から自動生成できる。
6. 時程・コートを自動生成し、必要時だけ表編集できる。
7. 入力方式・得点方式を日本語 UI で設定できる。
8. コート入力プレビューを確認できる。
9. setup draft が reload 後に復元される。
10. setup draft は正式適用まで ConfigVersion にならない。
11. 最終 check で ERROR は apply をブロックする。
12. apply 後は大会設定ホームへ移る。
13. post-create edit は別 draft として自動保存される。
14. stale edit draft を適用できない。
15. changeClass をユーザーに選ばせない。
16. 既存 scoring regression gate を維持する。
17. QR、Result/Revision、Backup の既存 regression test が green。
18. raw `TournamentConfigEditorBase` は通常 Host UI から到達不能。
19. complete offline operation を損なわない。
20. `npm run test:run`, `npm run typecheck`, `npm run build` が green。
