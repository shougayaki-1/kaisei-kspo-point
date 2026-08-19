# 開成運動交流祭 得点管理システム 正式設計仕様書

- 文書バージョン: 1.0
- 作成日: 2026-08-19
- 対象リポジトリ: `shougayaki-1/kaisei-kspo-point`
- 文書の位置づけ: 実装に対する規範的な設計仕様
- 対象: 開成運動交流祭の本部・コート・表示用の完全オフライン得点管理PWA

## 1. 目的

本システムは、開成運動交流祭の競技結果入力、得点計算、総合集計、訂正、監査、バックアップを、当日のインターネット接続に依存せず実行できるようにする。

本部端末1台を大会全体の統合状態の正本とし、複数のコート端末はそれぞれ完全オフラインで結果を入力・保持する。コートから本部への結果転送はQRコードを標準経路とし、本部は受け取った生結果から順位・競技得点・総合得点を決定的に再計算する。

設計上の最重要原則は次のとおりである。

1. ネットワーク障害で大会運営を止めない。
2. 同じ結果を再送しても二重加算しない。
3. 訂正・競合・設定変更の履歴を失わない。
4. 得点の「結果」だけでなく「なぜその得点になったか」を説明できる。
5. 本部端末が故障しても、バックアップとコート端末の保持データから復旧できる。
6. 大会固有の競技・配点・チーム構成をコードへ固定せず、設定として管理できる。

## 2. 適用範囲と非目標

### 2.1 適用範囲

本仕様は以下を含む。

- `Court UI`: コート担当者の結果入力・訂正・QR送信・ACK確認
- `Host UI`: 本部のQR取込・集計・訂正・設定・監査・バックアップ
- `Display UI`: 本部端末から外部ディスプレイへ表示する総合順位等
- 大会設定、時程、チーム、競技、入力Schema、得点ルール
- Result / Revisionによる履歴管理
- QR Transfer / ACK / Config Update
- Scoring Engine / Calculation Trace / Simulator / Scoring Test Cases
- IndexedDB永続化
- Service Workerを用いた完全オフラインPWA
- バックアップ・復元・予備本部端末への切替
- 本番前リハーサルと運用上の安全策

### 2.2 非目標

初期仕様では以下を目的としない。

- クラウドDBによるリアルタイム同期
- 当日インターネットへの依存
- ログイン、SSO、オンライン認証
- 電子署名によるQRの真正性保証
- 選手個人情報の管理
- LAN、Git、Bluetooth等を必須とする端末間同期
- 汎用的な数式プログラミング言語や任意コード実行による得点ルール作成

## 3. ルール・設定の正本

競技ルールの正本は、その大会年度で承認された最新の競技要領とする。2026年度の設計確認では「第3回 開成運動交流祭 競技要領【詳細版】」を現行ルールの根拠として扱い、昨年度の時程表・スコアシートは構造や運用を理解するための参考資料としてのみ扱う。

過年度資料と現行競技要領が異なる場合、過年度資料に合わせて計算ロジックを固定してはならない。大会固有の配点・参加構造・実施回数は `Tournament` / `Competition` / `ScoringProfile` / `Schedule` の設定へ反映する。

現行ルールの例として、台風の目は各レースの順位点を1位50点、2位30点、3位20点、4位10点とし、2レース分の合計で競技内順位を決める。一方、この数値自体をアプリコードの不変定数にはしない。

## 4. 運用前提

- 本番当日は完全オフラインで運用可能でなければならない。
- 事前準備時にはインターネットを利用してアプリ更新や設定作成を行ってよい。
- 本部端末は通常1台、予備本部端末を用意する。
- 同時稼働するコート端末は概ね1〜5台を想定する。
- 主対象ブラウザはChrome系とし、Chromebook / Windows / macOSで同一PWAを利用する。
- iPadではSafariのホーム画面Webアプリとして利用できる構成とする。
- 本番中は外部API、CDN、外部フォント、クラウドDB、オンライン認証へ依存しない。
- 担当者名は選択または入力する。PIN認証は要求しない。
- 本システムは選手個人の氏名等を保持しない。扱う主体はチーム、組、競技内サブグループ、担当者名である。
- Host / Court / Displayはアプリ内の運用モードであり、セキュリティ上の認証境界ではない。

## 5. 全体アーキテクチャ

同一コードベースのPWAに `Host UI`、`Court UI`、`Display UI` を持たせる。UIからドメインロジックと永続化を分離し、同じ得点計算・Revision・QR・設定検証ロジックを複数画面から再利用する。

概念的な層は以下とする。

```text
UI
├─ Host UI
├─ Court UI
└─ Display UI
        ↓
Application Services
├─ Result / Revision Service
├─ Scoring Service
├─ Config Service
├─ QR Transfer Service
├─ Backup / Restore Service
└─ Audit Service
        ↓
Domain
├─ Tournament / Schedule
├─ Result / Revision
├─ Scoring Rules / Trace / Test Cases
└─ Transfer / ACK
        ↓
Persistence / Platform
├─ IndexedDB
├─ Cache Storage
├─ Service Worker
├─ Camera / USB QR Input
└─ File Import / Export
```

### 5.1 データの正本

- 大会設定の正本: 本部端末の適用済み `ConfigVersion`
- コートで発生した生結果の発生元: 当該コート端末
- 大会全体の統合されたResult / Revision集合: 本部端末
- 総合順位・競技得点: 本部が生結果と適用ルールから算出した派生値

得点計算結果そのものを正本としない。正本は `Raw Result + immutable ScoringProfile / ConfigVersion` であり、派生値は再計算可能とする。

### 5.2 バージョン軸

以下を別々に管理する。

- `appVersion`: アプリケーション本体
- `protocolVersion`: QR転送形式
- `configVersion`: 大会設定
- `databaseSchemaVersion`: IndexedDB論理Schema
- `backupFormatVersion`: バックアップ形式

これらを混同しない。特に「アプリ更新」と「大会設定更新」は独立した操作とする。

## 6. ドメインモデル

### 6.1 主要エンティティ

- `Tournament`
- `Team`
- `Competition`
- `CompetitionEntry`
- `ScheduleSlot`
- `CourtRun`
- `ScoringSession`
- `InputSchema`
- `ScoringProfile`
- `ScoringTestCase`
- `ConfigVersion`
- `Result`
- `ResultRevision`
- `TransferBatch`
- `Acknowledgement`
- `Operator`
- `AuditEvent`

IDは表示名から分離し、オフラインで衝突しにくいUUIDを基本とする。表示用の短いコードは別フィールドとして持ってよい。

### 6.2 Team / CompetitionEntry

最終集計単位と競技内参加単位を分ける。

例:

- `Team`: `1組`
- `CompetitionEntry`: `1組①`, `1組②`, `1組α`, `1組β`

`CompetitionEntry` は必ず最終集計先の `Team` へ紐付く。チーム数・表示名は可変であり、1〜4組へコード上固定しない。

### 6.3 ScheduleSlot / CourtRun / ScoringSession

- `ScheduleSlot`: 「第1展開」等の時間・展開単位
- `CourtRun`: 物理コート上で実施される競技単位
- `ScoringSession`: 1回の入力操作で確定する論理的な採点単位

物理コート数と入力単位を同一視しない。

`ScoringSession` の入力範囲は少なくとも以下を扱う。

- `PER_COURT`: 1物理コート単位
- `WHOLE_SLOT`: 同じ展開の複数コートを一括
- `CUSTOM_GROUP`: 任意の複数 `CourtRun` を一括

1つの `Result` が複数の `CourtRun` を包含でき、1つの `TransferBatch` が複数の `ResultRevision` を包含できる。この3概念を分離する。

## 7. 入力Schemaとコート入力

競技入力画面は原則として `InputSchema` から生成し、設定駆動にする。汎用Schemaで表現しにくい競技のみ専用UI / 専用ロジックを持つ。

標準フィールド型は少なくとも以下を扱う。

- `NUMBER`
- `TIME`
- `RANK`
- `BOOLEAN`
- `SELECT`
- `PENALTY`
- `WIN_LOSS`
- `SPECIAL`

入力値の検証は `ERROR` と `WARNING` を分離する。

- `ERROR`: 必須欠落、型不一致、不可能な参照等。確定をブロックする。
- `WARNING`: 予定外、極端な値、通常ではない順位等。内容を確認したうえで続行可能にする。

### 7.1 リレー等の入力モード

同じ競技でも `ScoringSession` ごとに次の入力方式を選択できる。

- `TIMER`: アプリ内タイマー
- `TIME_MANUAL`: 計測済みタイム手入力
- `RANK_MANUAL`: 順位直接入力

1つの比較単位となる `ScoringSession` 内では、全参加者に同一の入力モードを用いる。別Sessionでは別モードを選んでよい。

直接順位入力では同順位を許可する。例: `1, 1, 3, 4`。

時間は整数ミリ秒を基準単位とし、ペナルティは実測値とは分離して保持する。タイマー実装は描画間隔の回数を時間として数えず、経過時間に適した単調増加時計を使用する。タイマー途中でアプリ再読み込み等が発生した場合、未完了計測を推測で復元せず、計測中断として扱い、手入力または再計測を要求する。

## 8. 得点計算エンジン

得点処理を以下の段階へ分離する。

```text
Raw Result
  ↓
Derived Result
  ↓
Match Outcome / Rank
  ↓
Award Score
  ↓
Competition Aggregate
  ↓
Tournament Total
```

`ScoringProfile` は少なくとも以下を表現する。

- `RankingRule`
- `TieRule`
- `AwardRule`
- `AggregationRule`

標準テンプレートは少なくとも以下を提供する。

- 大きい値が上位
- 小さい値が上位
- 順位から配点
- 複数ラウンドの合計 `SUM`
- 平均 `AVERAGE`
- 上位N件 `BEST_N`
- 最終ラウンドのみ `FINAL_ONLY`
- 勝敗ポイント `WIN_POINTS`
- 特殊競技 `CUSTOM`

王様ドッジ等、複数概念を持つ特殊競技では専用計算モジュールを使用できる。専用モジュールも後述の `CalculationTrace` を必ず生成する。

### 8.1 同順位

同順位は競技設定ごとの `TieRule` で処理する。順位枠の得点平均を使用する方式を標準でサポートする。

例として順位点が `[50, 30, 20, 10]` で1位が2チーム同順位の場合、1位・2位の枠を占有するため `(50 + 30) / 2 = 40` 点ずつとする設定を表現できる。

得点計算は同じ入力と同じ設定に対し常に同じ結果を返さなければならない。得点値の内部表現は、JavaScriptの二進浮動小数点誤差を正本へ持ち込まない決定的な表現を採用する。

## 9. Calculation Trace / Simulator / Scoring Test Case

### 9.1 Calculation Trace

得点計算関数は最終数値だけでなく、機械可読な `CalculationTrace` を返す。

概念的なTrace nodeは以下を持つ。

- `stepType`
- `label`
- `inputs`
- `operation`
- `output`
- `ruleRef`

Traceには可能な範囲で `configVersion` と `scoringProfileId / version` の文脈を保持し、どのルールで計算されたかを再現可能にする。

表示例:

```text
入力
  実測タイム: 58.24秒
  ペナルティ: +5秒
↓
判定値
  63.24秒
↓
順位
  2位
↓
順位得点
  30点
↓
競技内集約
  第1レース30点 + 第2レース50点 = 80点
```

実際の結果画面の「計算根拠を見る」と、設定画面のシミュレーターは同じScoring Engine / Trace生成処理を使う。

### 9.2 Simulator

`ScoringProfile` ごとに「このルールをテスト」できるシミュレーターを持つ。

Simulatorは仮のRaw Result、順位、タイム、ペナルティ等を入力し、最終値とCalculation Traceを表示する。Simulatorのデータは本番 `Result` / `ResultRevision` へ一切書き込まず、総合得点へ影響しない。

### 9.3 ScoringTestCase

各ScoringProfileには保存可能な回帰テストケースを持てる。

`ScoringTestCase` は少なくとも以下を保持する。

- 安定した `testCaseId`
- テスト名
- 対象 `scoringProfileId`
- 仮入力
- 期待する派生値、順位、得点等
- 必要に応じた説明

正常系、同順位、ペナルティ、直接順位、特殊競技等を保存できる。

テストケースは大会設定の一部であり、`ConfigVersion` のimmutable snapshotとバックアップに含める。本部の管理・検証用途であるため、コートへ配る最小化 `CONFIG_UPDATE` QRには原則含めない。

### 9.4 得点ルール変更時のActivation Gate

得点ルール変更時は、影響する保存済みテストケースを決定的に再実行する。

- すべて期待値どおり: 適用可能
- 期待値が変化: 新ConfigVersionの有効化を原則ブロック
- 意図した変更: 変化したテストケースを1件ずつレビューし、明示承認した場合のみ期待値を新しい結果へ更新
- 想定外の変更: ルールまたは入力を修正し、再実行する

承認は `testCaseId` だけではなく、レビューした実際の変更結果に結び付ける。承認後に計算結果が再度変わった場合、以前の承認を再利用してはならない。承認・期待値更新は監査ログへ記録する。

得点ルールが実際に変化している場合、変更種別ラベルが誤って `DISPLAY_ONLY` 等になっていても、このレビューを迂回してはならない。実際のScoringProfile差分を基準に判定する。

## 10. Result / Revision モデル

`Result` は論理的な結果の識別子と現在位置を持ち、値そのものはimmutableな `ResultRevision` へ保存する。

`Result` の概念フィールド:

- `resultId`
- `tournamentId`
- `competitionId`
- `scoringSessionId`
- `currentRevisionId`
- `createdAt`
- `createdByDeviceId`

`ResultRevision` の概念フィールド:

- `revisionId`
- `resultId`
- 表示用 `revisionNumber`
- `parentRevisionIds[]`
- `source`: `COURT | HOST | CONFLICT_RESOLUTION`
- `operator`
- `inputMode`
- `rawData`
- `configVersion`
- `createdAt`

`revisionNumber` や時刻は人間向け情報であり、Revisionの因果関係や新旧判定の正本にしない。

### 10.1 訂正

確定済みResultを訂正する場合、既存Revisionを上書きせず、新しいRevisionを作る。コート訂正・本部訂正のどちらでも同じ原則を用いる。

### 10.2 競合

同じ親Revisionから別々の子Revisionが作成された場合は競合とする。

競合時は以下とする。

1. 自動で一方を採用しない。
2. 本部に双方の差分を表示する。
3. 解決まで直前の共通の確定祖先を集計対象とする。
4. 人間が採用・統合内容を決定する。
5. 解決Revisionは競合した両Revisionを親に持つ。

単に古い既知Revisionが後から到着しただけの場合は競合にせず `OLD_REVISION` として扱い、現在結果を巻き戻さない。

## 11. QR Transfer Protocol

QRの用途は少なくとも次の3種類とする。

- `RESULT_BATCH`
- `ACK_BATCH`
- `CONFIG_UPDATE`

すべて共通のframing、分割、チェックサム検証の考え方を使用する。

### 11.1 Result Batch

コート端末は送信対象の確定済みRevisionを `TransferBatch` にまとめる。TransferBatchは生成した時点で参照Revisionを固定し、後の訂正で既存Batchの内容を書き換えない。訂正は新しいRevisionを新しいBatchで送信する。

Result Batchに権威ある総合得点・競技得点を含めない。本部が必要とする生結果・Revision識別情報・設定文脈を送る。

概念payload:

- `type`
- `protocolVersion`
- `tournamentId`
- `batchId`
- `sourceDeviceId`
- `configVersion`
- `createdAt`
- `results[]`
  - `resultId`
  - `revisionId`
  - `parentRevisionIds`
  - `competitionId`
  - `scoringSessionId`
  - `inputMode`
  - `operator`
  - `rawData`

### 11.2 分割QR

Batchが1枚へ収まらない場合は圧縮・エンコード後に複数partへ分割する。1part当たりの最大サイズは実機リハーサルで読み取り安定性を確認した保守的な値とし、大容量QRを前提にしない。

各partに少なくとも以下を持つ。

- `protocolVersion`
- `type`
- `tournamentId`
- `batchId`
- `partIndex`
- `totalParts`
- `chunkChecksum`
- `batchChecksum`
- `payloadChunk`

送信側は `現在part / 総part数` を表示し、ページ切替は手動とする。本部が何枚読んだかを送信側が推測して表示してはならず、正式な受領状態はACKで確定する。

本部は以下をサポートする。

- 順不同読取
- 同一partの重複無視
- 複数の未完了Batchの同時保持
- `読取済み / 総数`
- 未読part番号
- 再読み込み後の未完了読取再開
- 全part復元後のbatch checksum検証

### 11.3 本部取込

完全なBatchを復元後、以下を順に検証する。

1. framing / checksum
2. `protocolVersion`
3. `tournamentId`
4. payload schema
5. `configVersion` とRaw Result互換性
6. `resultId / revisionId / parentRevisionIds`
7. 既受領、旧Revision、競合の判定

同じRevisionを再送しても二重加算しない。

### 11.4 ACK

本部はBatch処理後に `ACK_BATCH` QRを生成できる。ACKはRevision単位の受理結果を持つ。

代表status:

- `ACCEPTED`
- `ALREADY_RECEIVED`
- `REJECTED`
- `CONFIG_MISMATCH`
- `INVALID_DATA`

コートがACKを読み込んだ時点で正式な `ACKNOWLEDGED` とする。

ACKを読み取れない場合は担当者が「手動で送信済み」にできるが、これは受領の暗号学的証明ではなく、担当者判断として監査ログへ残す。

本部障害から古いバックアップへ復元した場合に再送できるよう、コート端末はACK済みを含む過去のTransferBatchを履歴から再表示・再送できなければならない。本部側のdeduplicationにより再送を安全にする。

### 11.5 QR入力経路

標準はカメラ読取とする。USBキーボード型QRリーダーを代替入力経路としてサポートし、その後のparser / validatorは共通化する。カメラAPI固有の機能だけへ依存せず、QR decoderはアプリへ同梱する。

## 12. Court UI

### 12.1 端末割当

コート端末は以下を保持する。

- 担当者
- 担当競技
- 入力範囲

端末は物理コートや競技へ永久固定しない。必要に応じて当日中に割当変更できる。

### 12.2 ホーム

優先表示:

- 現在の予定
- 次の予定
- 結果入力
- 未送信件数
- 本部へ送信
- 結果履歴
- 担当変更
- Offline / App Version / Config Version / Device

Scheduleは次のScoringSessionを提案するために使うが、時刻だけで強制切替しない。予定外Sessionを手動選択する場合は確認を表示する。

### 12.3 入力状態

ResultのUI状態は少なくとも以下を扱う。

- `DRAFT`
- `CONFIRMED`
- `SENDING`
- `ACKNOWLEDGED`
- `MANUALLY_ACKNOWLEDGED`
- `CORRECTION_REQUIRED`

入力は原則 `入力 → 確認 → 確定` の2段階とする。下書き保存を許可する。訂正は新Revisionを作る。

### 12.4 送信履歴

送信履歴から以下を確認できる。

- Batch ID / 表示用転送コード
- 対象結果
- 作成日時
- 総part数
- ACK状態
- 手動送信済み状態
- 過去Batchの再表示

未送信だけでなくACK済み履歴も保持する。

## 13. Host UI

本部ホームは少なくとも以下を提供する。

- 総合得点・総合順位
- 競技別状況
- 予定ScoringSessionの受領進捗
- 未提出候補
- 要確認
- 競合
- 訂正
- QR読取
- 全結果
- 公開表示
- 大会設定
- バックアップ
- バックアップ経過時間

### 13.1 QR取込後

有効なBatchの全partが揃い検証が成功した場合、原則として以下を自動実行する。

```text
QR復元
→ 検証
→ Revision取込
→ 得点再計算
→ 総合集計更新
→ Display更新
→ ACK生成可能状態
```

通常の正常データに対し、本部担当者へ毎回「公開」操作を要求しない。公開表示は有効な取込後に自動更新する。

### 13.2 Config不一致

古いConfig Versionで入力されたResultを一律拒否しない。

- Scoringのみの変更等でRaw Resultに互換性がある: 現在の本部ルールで再計算して受理可能
- InputSchema変更により必要データが不足する: 要確認または拒否
- 別大会・未知ID・対応外protocol: ERROR

### 13.3 結果詳細

競技結果・Result詳細では少なくとも以下を確認できる。

- Raw Result
- Input Mode
- Derived Result
- Rank / Outcome
- Award Score
- Aggregate
- Calculation Trace
- 適用Config / ScoringProfile
- Revision履歴
- Source device / operator
- 訂正差分

本部から訂正する場合も新しい `HOST` Revisionを作る。

### 13.4 Display UI

Display UIは本部端末の別タブまたは別ウィンドウで開き、HDMI等で外部モニターへ出力する。別ネットワーク端末への配信を前提にしない。

表示内容は本部の統合状態に追従して自動更新する。競合中のResultは直前の確定祖先を使うため、未解決候補を勝手に公開得点へ反映しない。

## 14. 大会設定・Config Version

### 14.1 設定領域

- 大会基本情報
- Team
- Competition
- CompetitionEntry
- Schedule / CourtRun / ScoringSession
- InputSchema
- ScoringProfile
- ScoringTestCase
- 表示設定
- Config配布

### 14.2 CSV Import

時程・試合表はCSV一括Importと手動編集を提供する。

Importフロー:

```text
ファイル選択
→ 列マッピング
→ プレビュー
→ ERROR / WARNING
→ 確認
→ Draftへ反映
```

列名を一種類へ固定せず、利用者が列マッピングできる。ID参照切れ・必須列不足等はERROR、軽微な不整合はWARNINGとして扱う。

### 14.3 Draftとimmutable ConfigVersion

設定は直接適用済み状態を書き換えず、Draftで編集する。適用時に検証と影響確認を行い、新しいimmutable `ConfigVersion` を作成する。

代表的な変更分類:

- `DISPLAY_ONLY`
- `SCHEDULE`
- `SCORING`
- `INPUT_SCHEMA`

分類は説明・影響表示の補助情報であり、安全性判定は実データ差分を優先する。特にScoringProfileに差分がある場合、`SCORING` と明示されていなくてもScoringTestCaseのActivation Gateを実行する。

### 14.4 Config Update QR

本部は `CONFIG_UPDATE` QRを生成できる。

- 通常は必要最小限の差分を送る。
- 差分適用不能・大幅変更時は完全設定Snapshotを送れる。
- コートで必要ないScoringTestCaseや本部管理専用情報は原則除外する。
- コートは適用前に対象Tournament / version / 影響を確認できる。

ConfigVersionは過去版を変更しない。過去Resultの入力時設定文脈を後から確認できるようにする。

## 15. IndexedDBと永続化

主要storeは以下を基本とする。

- `appMeta`
- `tournaments`
- `teams`
- `competitions`
- `competitionEntries`
- `scheduleSlots`
- `courtRuns`
- `scoringSessions`
- `inputSchemas`
- `scoringProfiles`
- `scoringTestCases`
- `configVersions`
- `results`
- `resultRevisions`
- `transferBatches`
- `receivedQrParts`
- `acknowledgements`
- `operators`
- `auditEvents`
- `localSettings`

実装時に正規化の都合でstoreを統合・分割してよいが、ドメイン境界と永続性要件は維持する。

### 15.1 永続化原則

- `ResultRevision` はimmutable
- 適用済み `ConfigVersion` はimmutable
- 作成済み `TransferBatch` のpayloadはimmutable
- 派生得点を唯一の正本にしない
- QR未完了partを永続化する
- 下書きと再読み込み後に必要な画面状態を永続化する
- ACKを受けても原則として生結果や送信履歴を自動削除しない

複数storeを同時更新する操作は、途中失敗で半端な状態を作らないようIndexedDB transactionで原子的に扱う。

## 16. 監査ログ

監査対象には少なくとも以下を含める。

- `RESULT_CREATED`
- `RESULT_CORRECTED`
- `RESULT_MANUALLY_ACKNOWLEDGED`
- `QR_BATCH_CREATED`
- `QR_BATCH_RECEIVED`
- `CONFIG_UPDATED`
- ScoringTestCaseの意図的変更承認
- `BACKUP_CREATED`
- `BACKUP_RESTORED`
- `RESULT_CONFLICT_RESOLVED`

監査イベントには可能な範囲で、操作種別、対象ID、端末ID、担当者、変更前後の参照、端末時刻を残す。

端末時刻は監査表示の補助であり、Revisionの因果関係・優先順位を時刻だけで決めない。

## 17. バックアップ・復元

本部バックアップはブラウザ内部DBのコピーではなく、アプリ独自の移植可能な単一ファイルとしてExportする。通常のブラウザDownload / Uploadで利用でき、特定ブラウザのFile System Access APIを必須としない。

バックアップには少なくとも以下を含める。

- manifest
- Tournament
- Team / Competition / Entry
- Schedule / CourtRun / ScoringSession
- InputSchema / ScoringProfile / ScoringTestCase
- ConfigVersion
- Result / ResultRevision
- Transfer履歴 / ACK
- Operator
- AuditEvent
- 必要なSettings

manifestには以下を持つ。

- `backupFormatVersion`
- `databaseSchemaVersion`
- `appVersion`
- `tournamentId`
- 作成日時
- checksum

### 17.1 Restore

初期仕様のRestoreは、既存大会へ部分マージせず、対象大会をバックアップ時点へ復元する方式とする。

Restore前に以下を行う。

1. ファイル形式検証
2. checksum検証
3. version互換性確認
4. Tournament / 作成日時 / 件数等のプレビュー
5. 明示確認
6. transactionによる復元

### 17.2 本部障害

本部端末が故障した場合:

1. 予備本部端末でアプリを起動
2. 最新バックアップをRestore
3. バックアップ後に本部へ届いた可能性があるBatchを各コートの送信履歴から再表示・再送
4. 本部がRevision dedupe
5. 受領進捗・競合・総合得点を確認
6. 新しいバックアップを作成

本部ダッシュボードには最後のバックアップからの経過時間を表示し、定期的なExportを促す。運用上の具体的な間隔は実装プラン・当日Runbookで決められるよう設定可能にする。

コート側の端末バックアップは任意機能として提供してよい。

## 18. PWA・完全オフライン・バージョン固定

以下をアプリへ同梱する。

- HTML / JavaScript / CSS
- アイコン
- QR encode / decode
- 必要ライブラリ
- フォントを使用する場合はローカル資産

本番の正常フローで外部network requestを必要としない。

Service Workerは静的資産を事前cacheし、大会データはIndexedDBへ保存する。可能なブラウザでは `navigator.storage.persist()` 相当のPersistent Storageを要求し、未許可の場合は端末診断で警告する。

### 18.1 App Update

- 本番中にService Workerが勝手に新Versionへ切り替わらない。
- アプリ更新は事前準備用の明示操作とする。
- 本番モードではApp Versionを固定する。
- Config UpdateはApp Updateと分離する。
- 各端末で `App Version / Config Version / Device ID / Offline状態` を確認できる。

### 18.2 安全な「アプリを再読み込み」

常時アクセスできるトラブルシューティングメニューに「アプリを再読み込み」を持つ。

これは以下を行う。

- 保存可能なDraft / UI状態を保存
- IndexedDBを保持
- QR読取途中状態を保持
- 作成済みTransferBatchを保持
- 現在端末にあるApp Versionのcacheを使用して再起動
- 更新確認・新Version取得を実行しない

「アプリを再読み込み」と「大会データ削除 / 初期化」はUI上もコード上も強く分離する。大会データ削除は危険操作として別画面・強い確認を要求する。

通常のトラブル対応でブラウザデータ消去やPWA再インストールを案内しない。

## 19. 障害時の振る舞い

基本原則:

- 同一Revisionの再送は安全
- 未完了QRは続きから再開
- ACK忘れは再送して `ALREADY_RECEIVED` で回復可能
- 訂正は上書きせずRevision追加
- 競合は人間が解決
- Config変更後もRaw Resultを保持
- 本部障害はBackup + コート履歴再送で復旧
- カメラ不調時はUSB QR Readerへ切替可能

### 19.1 ERROR

代表例:

- QR checksum不一致
- 別Tournament
- 未知Team / Competition / Session ID
- 必須Raw Data欠落
- 対応外Protocol Version
- InputSchema互換性がなく再計算不能

ERRORは処理を止め、「何が起きたか」「データが保存されているか」「次に何をすべきか」を表示する。

### 19.2 WARNING

代表例:

- 古いConfig VersionだがRaw互換
- 予定外ScoringSession
- 通常ではない順位
- 極端な値
- Persistent Storage未許可
- バックアップが古い

WARNINGは確認を促すが、設計上安全である場合は続行可能にする。

## 20. セキュリティ・プライバシー

本システムの初期脅威モデルは、閉じた大会運用内での誤操作・破損・重複・端末故障への耐性を重視する。

QR checksumは破損検知を目的とし、送信者の真正性を証明しない。電子署名・公開鍵認証は初期要件に含めない。

Host / Courtモードは認証ではないため、物理的に端末へアクセスできる利用者を完全に防御する設計ではない。危険操作には明示確認と監査を要求する。

保存する個人関連情報は担当者名程度に限定し、選手個人PIIは保持しない。

## 21. テスト戦略

### 21.1 自動テスト

最低限、以下を自動テストする。

- 得点計算正常系
- 同順位
- ペナルティ
- `SUM / AVERAGE / BEST_N / FINAL_ONLY / WIN_POINTS`
- 特殊競技計算
- Calculation Trace
- ScoringTestCase回帰
- 意図変更承認の無効化条件
- Config差分検出
- Result / Revision直線履歴
- 競合生成・解決
- 旧Revision
- QR単一
- QR分割
- 順不同
- 重複part
- 欠落part
- checksum破損
- 別Batch混入
- 同一Revision再送
- ACK
- Config mismatch
- IndexedDB transaction
- Backup round trip / migration

得点ルールの保存テストケースはコードのunit testとは別に、実際の大会Configの回帰テストとして扱う。

### 21.2 端末単体試験

各実機で以下を確認する。

- PWA起動
- 完全オフライン再起動
- IndexedDB persistence
- カメラ権限
- QR読み書き
- USB QR Reader
- 安全な再読み込み
- Persistent Storage状態
- スリープ復帰
- バッテリー運用

### 21.3 複数端末リハーサル

本部1台、コート3〜5台、予備本部1台を使用し、本番相当の設定とデータで通し試験を行う。

意図的に以下を再現する。

- QRの二重読取
- 分割QRの途中中断
- 順不同読取
- 別Batch混入
- ACK読み忘れ
- ACK済みBatch再送
- コート訂正
- 本部訂正
- 同時訂正による競合
- 古いConfig Result
- Config Update QR
- アプリ再読み込み
- 本部端末故障
- 古いBackupから復旧して履歴Batchを再送

完全オフライン試験ではWi-Fi等を実際に切り、アプリを完全終了してから再起動し、結果入力から最終Backupまで一連の流れを通す。

## 22. 本番運用

### 22.1 事前

- App Versionを確定
- 全端末へ同Versionを導入
- 大会Configを確定
- ScoringTestCaseを全実行
- 各端末へ必要Configを配布
- 本番モードへ移行
- 本部Backupを作成
- 予備本部端末でRestore確認

### 22.2 当日開始時

- Device / App / Config Version確認
- Offline起動確認
- Storage診断
- カメラ / USB Reader確認
- 担当割当
- 本部Display確認
- 初期Backup確認

### 22.3 通常フロー

```text
コート
Result入力
→ 確認
→ 確定
→ Batch作成
→ QR提示

本部
QR読取
→ 自動検証
→ Revision取込
→ 自動再計算
→ Display更新
→ ACK QR提示

コート
ACK読取
→ 受領済み
```

### 22.4 事故時の優先順位

1. データを消さない。
2. 安全な再読み込みを試す。
3. 再送・別入力経路を使う。
4. 必要なら予備端末へRestoreする。
5. ブラウザデータ削除や再インストールは通常手順として行わない。

## 23. 大会確定・完了条件

大会全体を確定可能とする条件:

- 全予定ScoringSessionのResultが揃っている、または欠落が明示的に処理済み
- 未解決Conflictが0件
- 未処理ERRORが0件
- 要確認項目が0件、または確定判断済み
- 全得点計算が成功
- 総合順位を確認済み
- 最終Backup作成済み

確定後は原則編集をロックする。訂正が必要な場合は明示的にロック解除し、新Revisionとして処理し、再確定する。

## 24. 設計上の不変条件

実装プランおよび実装は、少なくとも次の条件を破ってはならない。

1. CourtからHostへ「権威ある総合得点」を送らない。Raw ResultとRevisionを送る。
2. Result訂正で過去Revisionを上書きしない。
3. TransferBatch生成後にpayloadを変更しない。
4. 同じRevisionを何度受け取っても二重加算しない。
5. Conflictを時刻や到着順だけで自動解決しない。
6. 未解決Conflictを新しい候補値のまま総合得点へ反映しない。
7. 適用済みConfigVersionを後から書き換えない。
8. Scoring Simulatorを本番Result storeへ書き込まない。
9. 実結果・Simulator・ScoringTestCaseで別々の得点計算実装を持たない。
10. 得点変更で回帰テストが変化したとき、レビューなしで有効化しない。
11. QR再送・ACK忘れ・本部Restore後再送を安全にする。
12. 本番中の安全な再読み込みでIndexedDBを削除しない。
13. 本番中にService Worker更新を自動適用しない。
14. 外部network requestを本番正常フローの必須条件にしない。
15. Team表示名やTeam数をコードへ固定しない。
16. 物理CourtとScoringSessionを同一概念にしない。
17. 選手個人PIIを追加しない。
18. 現行競技ルールより過年度資料を優先しない。

## 25. 実装プランへの引継ぎ

本仕様書は設計の正本であり、実装状況や過去のPhase番号は規範ではない。次のチャットで実装プランを作成するときは、まずリポジトリの現在状態を確認し、本仕様との差分を洗い出したうえで、未実装・設計逸脱・既存テストを整理する。

実装プランは以下を明示する。

- 現在実装済みの機能
- 本仕様に対して不足している機能
- 既存実装で修正が必要な箇所
- フェーズ分割と依存関係
- 各Taskで変更する具体的ファイル
- RED → GREEN → REFACTORのテスト手順
- 各フェーズの受入条件
- CI / 実機確認のタイミング

現在のコードを本仕様より優先しない。既存実装と本仕様が衝突する場合は、本仕様を基準に差分を明示し、変更範囲が大きい場合は実装前に再確認する。

## 26. 参考資料

設計時に参照した資料:

- 「第3回 開成運動交流祭 競技要領【詳細版】」: 現行大会の競技ルール判断の正本
- 「第2回開成運動交流祭 時程（シート1が完成版です）」: 過年度の時程・Court / 展開構造の参考
- 「@スコアシートたち」: 過年度の採点・集計構造の参考

過年度資料の数値・得点方式は、現行競技要領または当年度Configで明示されない限り、本システムの固定ルールとして採用しない。
