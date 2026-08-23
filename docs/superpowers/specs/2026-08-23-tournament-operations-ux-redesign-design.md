# 大会設定・コート端末運用 UX 再設計

- 作成日: 2026-08-23
- 対象: 開成運動交流祭 得点管理 PWA
- 状態: 会話内で方針承認済み。実装前のユーザーレビュー待ち
- 前提: まだ本番運用前であり、開発中データに対する後方互換性は要件としない

## 1. 背景

現在のアプリには大会設定ウィザードの部品が存在するが、実際の本部導線は旧来の `TournamentConfigEditor` へ接続されている。大会構成、入力形式、配点、時程、内部管理機能が一画面に混在し、運営者が内部データモデルや独自用語を理解しないと設定しにくい。

コート端末も、全 `ScoringSession` から操作対象を選ばせ、`ScoringSession`、`Result`、`Revision`、`ConfigVersion` 等の内部用語を表示している。端末の担当競技・担当コート、次に入力する試合、送信状態が一目で分からない。

本設計は、既存の決定的な得点計算、immutable ConfigVersion、Revision、競合解決、QR 転送、ACK、完全オフライン運用を維持しつつ、運営者が触る画面と設定モデルを運用中心に作り直す。

## 2. 目標

### 2.1 大会設定

- 開成運動交流祭では、標準設定または前年設定から開始し、今年の変更点だけ確認すれば大会を作成できる。
- 通常の設定導線から内部 ID、enum、schema key、英語の内部用語を排除する。
- 競技、時程、入力方式、得点ルールの整合性を、適用前のプレビューと回帰テストで確認できる。
- 適用後はウィザードではなく、目的別の設定ホームから変更箇所へ直接入れる。

### 2.2 コート端末

- 担当競技・担当コートを QR または手動選択で設定できる。
- 担当範囲内の未入力試合を実施順に表示し、「次に入力」が分かる。
- QR は近道であり、手動選択を常に同等の代替手段として提供する。
- 結果入力は競技ごとに分かりやすいフォームを表示する。
- 当日の事情に応じて、本部が許可した範囲内で入力方式を試合単位に変更できる。
- 保存、訂正、QR 送信、ACK の状態を試合単位で把握できる。

## 3. 非目標

- 本部から各コート端末へリアルタイムに指示を配信するオンライン配車システムは作らない。
- 選手個人情報は保持しない。
- 任意の大会種別を同等の使いやすさで作成する汎用大会ビルダーは優先しない。
- 開発中の旧設定・旧 IndexedDB データを自動移行する互換レイヤーは作らない。
- 競技名ごとの得点ロジックをアプリへハードコードしない。

## 4. 設計原則

1. 設定する人には「今年変わること」を見せる。
2. コート担当者には「いま自分がすること」を見せる。
3. 既定値を安全に用意し、例外時だけ詳細操作を開く。
4. QR と手動操作は、入口だけが異なる同一処理として扱う。
5. UI の入力方式と、得点計算の正本を分離する。
6. 保存した結果には、実際に使った設定・入力方式・スキーマを固定する。
7. 二重操作やオフライン競合を黙って二重加点せず、明示的な競合として扱う。

## 5. 大会設定 UX

### 5.1 新規大会の 4 段階フロー

#### 手順 1: 元になる大会

- 「前年の交流祭をコピー」
- 「交流祭の標準設定から作る」

通常は交流祭用テンプレートを最上位に表示する。汎用テンプレートや JSON 読み込みは詳細設定へ移す。

#### 手順 2: 今年の変更

確認対象を次に絞る。

- 大会名、開催日
- 組数と組名
- 実施する競技
- 競技ごとの回数、コート数
- 実施順と必要な予定時刻

前年または標準設定から変わっていない項目は要約表示し、詳細を閉じた状態にする。

#### 手順 3: 入力と得点

競技カードごとに次を表示する。

- 通常使う結果入力方式
- 当日コート端末で選択可能な入力方式
- 入力値から勝敗・順位を導く要約
- 勝敗・順位から大会得点を導く要約
- 得点回帰テストの状態

運営者は内部の `InputMode` や `InputSchema` を直接編集しない。

#### 手順 4: 当日確認

- コート端末の入力画面プレビュー
- 担当別の試合一覧プレビュー
- コートのみ QR と、競技＋コート QR の生成
- 未設定・矛盾・未承認の得点変更
- ConfigVersion 適用前の最終確認

すべてのエラーが解消され、必要な得点テストが通るまで適用を無効にする。

### 5.2 適用後の設定ホーム

適用後はウィザードを再表示せず、次のカードを表示する。

- 基本情報・組
- 競技と入力
- 時程とコート
- 子端末への配布
- 設定チェック
- 詳細管理

`JSON import / export`、ConfigVersion の詳細、計算トレース等は「詳細管理」に置き、通常設定と視覚的に分離する。

### 5.3 下書き

- 入力は IndexedDB へ自動保存する。
- 保存中、保存済み、保存失敗を明示する。
- 適用前の下書きと、適用済み immutable ConfigVersion を分離する。
- 適用後の変更は新しい ConfigVersion を作成する。

## 6. コートと担当のモデル

### 6.1 安定したコート定義

大会設定へ物理的なコートを表す `CourtStation` を追加する。

```ts
interface CourtStation {
  courtStationId: string
  tournamentId: TournamentId
  label: string
  shortLabel?: string
  displayOrder: number
}
```

`CourtRun` は表示文字列だけでなく `courtStationId` を参照する。これにより、A コート QR を複数競技・複数時程で再利用できる。

### 6.2 担当範囲

```ts
interface CourtAssignment {
  tournamentId: TournamentId
  courtStationId: string
  competitionId?: CompetitionId
  assignedAt: string
  source: 'QR' | 'MANUAL'
}
```

- コートのみ: そのコートで行う全競技を対象にする。
- 競技＋コート: その競技・コートだけを対象にする。
- 選択内容は端末へ保存し、「担当を変更」するまで再読み込み後も保持する。
- active config から参照先が消えた場合は自動解除せず、無効理由を表示して再選択させる。

### 6.3 QR と手動選択

担当 QR は次の小さな payload を持つ。

```ts
interface CourtAssignmentQrPayload {
  type: 'COURT_ASSIGNMENT'
  schemaVersion: 1
  tournamentId: TournamentId
  courtStationId: string
  competitionId?: CompetitionId
}
```

ConfigVersion ID は含めない。同じ大会内の設定更新後も QR を再利用し、読み取り時に現在の active config に対して参照を検証する。

手動選択は、active config の `CourtStation` と `Competition` から同じ `CourtAssignment` を生成する。QR と手動選択は共通の検証・保存サービスを使う。

## 7. コート端末のタスクホーム

### 7.1 タスク生成

`ScoringSession` を 1 回の論理的な入力タスクとして扱う。設定コンパイラは次を保証する。

- `PER_COURT`: 1 コート入力ごとに 1 ScoringSession
- `WHOLE_SLOT`: 同じ回の全コートをまとめて 1 ScoringSession
- `CUSTOM_GROUP`: 指定したコート群ごとに 1 ScoringSession

`WHOLE_SLOT` と `CUSTOM_GROUP` には代表 `CourtStation` を設定し、その担当端末へ表示する。同じタスクを複数コートへ同時表示しない。

### 7.2 並びと状態

担当範囲に一致するタスクを設定済みの実施順で並べる。予定時刻は補助情報であり、現在時刻だけで「次」を決めない。

ホームでは次を分けて表示する。

- 次に入力
- この後の未入力
- 保存済み・未送信
- 本部確認待ち
- 完了済み
- 訂正が必要

進行変更に備え、担当範囲内の別の未入力タスクも選択できる。

### 7.3 二重入力の扱い

各 ScoringSession から安定した論理 Result ID を決定する。同じタスクを複数端末が入力した場合、別 Result として二重集計せず、同じ Result の分岐 Revision として本部の競合解決へ送る。

### 7.4 ConfigVersion 更新時の ID

最初の適用後は、変更されていない Tournament、Competition、CourtStation、ScoringSession の ID を次の ConfigVersion でも維持する。これにより、印刷済みの担当 QR、保存済み Result、未送信 Revision が同じ論理対象を参照し続ける。

結果が存在する ScoringSession の削除・分割・統合は通常編集として黙って適用しない。影響する結果と担当 QR を表示し、イベント開始前の初期化または明示的な新タスク作成を要求する。

## 8. 結果入力方式

### 8.1 結果入力ポリシー

競技ごとに結果入力ポリシーを持つ。

```ts
interface ResultEntryPolicy {
  competitionId: CompetitionId
  defaultMethodKey: string
  allowedMethodKeys: string[]
  methods: ResultEntryMethodDefinition[]
}

interface ResultEntryMethodDefinition {
  methodKey: string
  label: string
  kind: 'DETAIL' | 'SCORE' | 'OUTCOME' | 'TIME' | 'RANK'
  inputMode: InputMode
  inputSchemaId: string
  projection: ResultProjectionRule
}
```

各 method は専用 `InputSchema` と、入力値を共通の勝敗・順位表現へ変換する projection rule を参照する。得点エンジンは UI method ではなく、projection 後の勝敗・順位を消費する。

初期実装で必要な projection は次に限定する。

- 1 個の数値・タイム・順位フィールドを使う
- 複数の数値フィールドを合計して競技内スコアにする
- 勝ち・引き分け・負けを直接選ぶ

競技固有の名称は設定データに持たせ、アプリの分岐条件にしない。

### 8.2 本部の設定

本部は競技ごとに次を設定する。

- 通常使う既定方式
- 当日選択を許可する方式
- 方式ごとの表示名、入力項目、単位
- 入力値から勝敗・順位への変換
- 大会得点の規則

許可するすべての方式について、同じ代表ケースが期待する勝敗・順位・大会得点になることを回帰テストする。

### 8.3 子端末の変更

- 子端末は本部が許可した方式だけ選べる。
- 既定方式を最初から開き、「入力方法を変更」を副操作として表示する。
- 変更はその試合だけに適用し、次の試合では本部の既定へ戻る。
- 入力済みの状態で方式を変更する場合は、値が消えることを確認してから切り替える。
- 保存した Revision には実際に使った `inputMode`、`inputSchemaId`、schema version を固定する。
- 訂正時は元の方式を初期表示する。方式変更を伴う訂正も新しい Revision として残す。
- コートのプレビューと本部の再計算は、単なる active config ではなく Revision の `configVersion` に属する method と schema を参照する。

### 8.4 入力画面

共通構造を次に固定する。

1. 競技、コート、試合、参加組を大きく表示
2. 現在の入力方式と変更ボタン
3. その方式に必要な入力欄だけを表示
4. 導出した勝敗・順位を日本語でプレビュー
5. 確認後に保存

通常入力、訂正、転送履歴を一画面に混在させない。

## 9. データフロー

```text
交流祭テンプレート／前年設定
  -> 人間向け Setup Draft
  -> config compiler
  -> validation + scoring regression
  -> immutable ConfigVersion
  -> CONFIG_UPDATE QR でコート端末へ配布
  -> QR または手動で CourtAssignment を保存
  -> active config から担当タスクを導出
  -> 既定または許可済み method で入力
  -> method 固有 schema で検証
  -> 勝敗・順位をプレビュー
  -> Result Revision を保存
  -> RESULT_BATCH QR
  -> 本部で再検証・得点計算・ACK
```

担当 QR は設定配布 QR を代替しない。コート端末には先に互換性のある active ConfigVersion が必要である。

## 10. エラー処理

### 10.1 担当設定

- active config なし: 「先に大会設定 QR を読み取ってください」
- 別大会 QR: 現在の担当を維持したまま拒否
- 存在しないコート・競技: QR が現在の大会設定で使えないことを表示し、手動選択へ案内
- カメラ利用不可: 手動選択を主要な代替操作として表示

### 10.2 結果入力

- 必須値不足・範囲外: 項目の近くに運営者向け日本語で表示
- 入力途中の方式変更: 明示確認なしに値を破棄しない
- 入力済みタスク: 新規入力を作らず確認・訂正へ誘導
- 未保存下書き中の ConfigVersion 更新: 保存または破棄するまで activation を止める
- 保存失敗: 入力値を画面に保持し、再試行できるようにする

### 10.3 転送

- 未送信、送信 QR 作成済み、ACK 待ち、ACK 済みをタスクカードへ表示
- 同じ論理タスクの分岐は本部で競合として扱う
- 設定不一致は ACK の `CONFIG_MISMATCH` と運営者向け案内へ変換する

## 11. 開発中データと切り替え方針

本番運用前のため、旧形式に対する自動 migration や読み書き互換性は実装しない。

- 新しい `TournamentConfigSnapshot`、DB schema、QR payload に必要な破壊的変更を許容する。
- 開発中の IndexedDB は必要に応じて初期化する。
- テスト fixture と組み込みテンプレートは新形式へ一括更新する。
- 旧大会設定エディタは新導線が完成した時点で削除する。
- 既存の未接続ウィザード部品は、採用する UX に合うものだけ再利用し、7 段階を維持すること自体を目的にしない。

本番運用開始後に作成される ConfigVersion と Result Revision の不変性は維持する。

## 12. テスト戦略

### 12.1 ドメイン・設定

- ResultEntryPolicy の既定方式が allowed methods に含まれる。
- 各 method が同一競技の InputSchema を参照する。
- 許可方式ごとの projection と大会得点回帰。
- CourtStation、CourtRun、ScoringSession、代表コートの参照整合性。
- PER_COURT / WHOLE_SLOT / CUSTOM_GROUP のタスク生成。
- 同一 ScoringSession から安定した論理 Result ID を生成する。
- ConfigVersion 更新で変更されていない CourtStation と ScoringSession の ID を維持する。
- 結果が存在するタスクの破壊的な ID 変更を拒否する。

### 12.2 QR

- コートのみ QR と競技＋コート QR の encode/decode。
- QR と手動選択が同一 CourtAssignment を生成する。
- 別大会、未知のコート、削除済み競技を fail closed で拒否する。
- CONFIG_UPDATE、RESULT_BATCH、ACK の既存意味論を維持する。

### 12.3 UI

- 交流祭テンプレートから 4 段階で適用まで進める。
- 自動保存状態と再開。
- 担当未設定、QR 設定、手動設定、担当変更。
- 次タスク、別の未入力タスク、完了・送信状態。
- 方式ごとのフォーム、当日変更、保存前プレビュー、訂正。
- 内部用語が通常画面へ露出しないこと。
- スマートフォン幅で主要操作がスクロール迷子にならないこと。

### 12.4 統合・実機

- 設定作成 -> コート配布 -> 担当設定 -> 入力 -> QR 転送 -> ACK の完全オフライン通し試験。
- 複数端末による同一タスク入力が二重加点にならず競合化する。
- 入力途中の再読み込み、設定更新、送信中断、ACK 再送。
- 本番前に実端末、実 QR、物理的なネットワーク切断でリハーサルする。

## 13. 実装の分割方針

一つの設計として整合性を保ちつつ、実装は次の順に分割する。

1. 新 config model: CourtStation、ResultEntryPolicy、タスク identity、validation/compiler
2. 本部 UX: 4 段階セットアップ、設定ホーム、プレビュー、QR 生成
3. コート UX: QR/手動担当、タスクホーム、方式別入力、訂正導線
4. 転送・競合・統合: 安定 Result identity、状態表示、完全オフライン通し試験

各段階で既存テストを新形式へ更新し、得点計算の回帰を維持する。

## 14. 受け入れ条件

- 初見の運営者が内部用語を知らずに交流祭の大会設定を完了できる。
- 子端末で QR または手動により担当を設定できる。
- 担当範囲内の次の未入力試合が先頭に表示される。
- 本部の既定入力方式が自動表示され、許可方式へ試合単位で変更できる。
- 詳細、競技内スコア、勝敗の各入力が同じ得点規則へ安全に接続される。
- 入力方式、訂正、転送、ACK の履歴を追跡できる。
- 同一タスクの二重入力が二重加点されない。
- 設定から結果回収まで、ネットワークなしで完了できる。
