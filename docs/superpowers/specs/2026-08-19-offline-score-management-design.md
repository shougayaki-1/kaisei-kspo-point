# 開成運動交流祭 得点管理システム 設計仕様

## 1. 目的

開成運動交流祭の得点管理を、当日インターネット接続に依存せず運用できる単一PWAとして実装する。

- 本部端末1台を大会全体の正本とする。
- コート端末は完全オフラインで結果を入力・保存する。
- コートから本部へのデータ転送はQRコードを使用する。
- 本部は受信した生結果から順位・競技得点・総合得点を再計算する。
- 訂正履歴、競合解決、バックアップ、当日設定変更を保持する。
- Chromebook / Chromeを主対象とし、Windows / macOS / iPadでも同一アプリを利用できる構成とする。

## 2. 基本アーキテクチャ

同一コードベースのPWAに以下の3 UIを持たせる。

- `Court UI`: コート担当者向け
- `Host UI`: 本部スタッフ向け
- `Display UI`: 外部ディスプレイ表示向け

アプリケーション層はUIから分離し、結果管理、Revision、得点計算、QR転送、ACK、バックアップを独立したサービスとして持つ。

データは各端末のIndexedDBに保存する。アプリ本体はService Worker / Cache Storageで事前キャッシュし、本番中は外部API、CDN、オンライン認証、クラウドDBへ依存しない。

### データの正本

- 大会設定: 本部端末
- コートで入力した生結果: 各コート端末
- 大会全体の統合結果・総合得点: 本部端末

得点計算結果そのものを正本にせず、`Raw Result + ScoringProfile` から再計算可能にする。

## 3. 大会・試合データモデル

主要エンティティは以下とする。

- `Tournament`
- `Team`
- `Competition`
- `CompetitionEntry`
- `ScheduleSlot`
- `CourtRun`
- `ScoringSession`
- `Result`
- `ResultRevision`
- `ScoringProfile`
- `ConfigVersion`

### Team / CompetitionEntry

最終集計対象の組と、競技内の参加単位を分離する。

例:

- Team: `1組`
- CompetitionEntry: `1組①`, `1組②`, `1組α`, `1組β`

CompetitionEntryは必ずTeamへ紐付き、最終得点はTeamへ集約する。

### ScheduleSlot / CourtRun / ScoringSession

`ScheduleSlot` は「第1展開」等の時間単位、`CourtRun` は実際のコート上の実施単位、`ScoringSession` は結果を一度に入力する単位とする。

物理コートと入力単位を一致させない。

入力範囲は以下をサポートする。

- `PER_COURT`: コートごと
- `WHOLE_SLOT`: 同一展開の全コートをまとめる
- `CUSTOM_GROUP`: 指定した複数コートをまとめる

玉入れのように4面を1端末でまとめて入力する運用を許可する。

## 4. 入力方式

競技の入力画面は原則設定駆動とし、特殊競技のみ専用UIを持つ。

標準入力型:

- `NUMBER`
- `TIME`
- `RANK`
- `BOOLEAN`
- `SELECT`
- `PENALTY`
- `WIN_LOSS`
- `SPECIAL`

同一競技でもScoringSession単位で入力方式を選択できる。

例: リレー

- `TIMER`: アプリ内タイマー
- `TIME_MANUAL`: 計測済みタイム手入力
- `RANK_MANUAL`: 順位直接入力

順位直接入力では同順位を許可する。例: `1, 1, 3, 4`。

タイムは内部では整数ミリ秒で保存し、表示時に時分秒へ変換する。ペナルティは実測値と分離して保持する。

## 5. 得点計算モデル

結果処理は以下の段階に分離する。

1. Raw Result
2. Derived Result
3. Match Outcome
4. Award Score
5. Tournament Total

`ScoringProfile` は最低限以下を持つ。

- `RankingRule`
- `TieRule`
- `AwardRule`
- `AggregationRule`

標準テンプレート:

- 大きい数値が上位
- 小さい数値が上位
- 順位→得点
- 複数試合の合計
- 平均
- 上位N件
- 勝敗ポイント
- 特殊計算

王様ドッジ等の特殊ロジックは専用計算モジュールへ分離する。

### 同順位

同順位を許可し、競技設定ごとのTieRuleで配点する。順位枠の平均点を使う方式を標準としてサポートする。

### 計算根拠

計算関数は最終値だけでなく `CalculationTrace` を返す。

例:

- 実測タイム
- ペナルティ
- 判定タイム
- 順位
- 順位得点
- 合算式

本部の実結果画面と設定シミュレーターは同じ計算エンジン・同じCalculationTraceを利用する。

### 得点シミュレーター・回帰テスト

ScoringProfileごとに仮入力で計算結果を確認できるシミュレーターを持つ。

テストケースを大会設定の一部として保存する。

- 入力データ
- 期待する順位・得点
- テスト名

ルール変更時は保存済みテストを再実行する。

- 全成功: 適用可能
- 期待値変化: 原則ブロック
- 意図した変更として各失敗を承認した場合のみ期待値更新と新Config Version適用を許可

## 6. Result / Revision

`Result` は論理的な結果の箱とし、値は `ResultRevision` に保存する。

Result:

- `resultId`
- `tournamentId`
- `competitionId`
- `scoringSessionId`
- `currentRevisionId`
- `createdAt`
- `createdByDeviceId`

ResultRevision:

- `revisionId`
- `resultId`
- `revisionNumber`
- `parentRevisionIds[]`
- `source`: `COURT | HOST | CONFLICT_RESOLUTION`
- `operator`
- `inputMode`
- `rawData`
- `configVersion`
- `createdAt`

IDはオフラインで衝突しないUUIDを基本とする。

### 競合

同じ親Revisionから複数の子Revisionが作られた場合を競合とする。

競合時:

- システムは勝手に最新版を選ばない。
- 本部画面で差分を表示する。
- 人間が採用内容を決める。
- 解決時は両候補を親に持つ新しいRevisionを作る。
- 競合解決までは直前の確定Revisionを集計対象として維持する。

単に古いRevisionが後着した場合は競合ではなく `OLD_REVISION` として集計へ反映しない。

## 7. QR通信プロトコル

コート端末は未送信Revisionを任意のタイミングで `TransferBatch` にまとめる。

結果がQR1枚に収まらない場合は自動分割する。自動ページ切り替えは行わず、送信側で手動ページ送りする。

各QR断片に必ず以下を持つ。

- `protocolVersion`
- `type`
- `tournamentId`
- `batchId`
- `partIndex`
- `totalParts`
- `resultCount`
- `chunkChecksum`
- `batchChecksum`
- `payload`

本部は最初の1枚を読んだ時点で全枚数を認識し、以下を表示する。

- 読取済み枚数 / 総枚数
- 残り枚数
- 未読のpart番号
- 完了状態

順不同読取を許可し、同じpartの重複読取はカウントしない。異なるbatchIdのQRは混ぜず、複数の未完了バッチを保持可能にする。

QR破損検出として各断片チェックサムとバッチ全体チェックサムを検証する。電子署名・偽造防止は初期要件に含めない。

### ACK

本部がバッチを正常処理した後、`ACK_BATCH` QRを生成する。

Revision単位の状態例:

- `ACCEPTED`
- `ALREADY_RECEIVED`
- `REJECTED`
- `CONFIG_MISMATCH`
- `INVALID_DATA`

コートがACKを読むことで正式な受領済みにする。ACKを読めない場合は担当者が手動で送信済みにでき、その事実を監査ログへ残す。

## 8. コートUI

初期設定:

1. コートモード選択
2. 担当者選択・入力
3. 担当競技選択
4. 入力範囲選択

担当者・競技・入力範囲は端末内に保持する。

ホーム画面では以下を優先表示する。

- 現在の予定
- 次の予定
- 結果入力
- 未送信件数
- 本部へ送信
- 結果履歴
- 担当変更

予定時刻は次の試合を提示する補助情報であり、時刻で強制的に試合を切り替えない。手動で別の試合を選択できる。

Result状態:

- `DRAFT`
- `CONFIRMED`
- `SENDING`
- `ACKNOWLEDGED`
- `MANUALLY_ACKNOWLEDGED`
- `CORRECTION_REQUIRED`

入力は `入力 → 確認 → 確定` の2段階とし、確定時にRevisionを作る。下書き保存をサポートする。

## 9. 本部UI

本部ホーム:

- 総合順位
- ScoringSession提出進捗
- 要確認件数
- 訂正件数
- QR読取
- 競技別結果
- 全結果
- 表示画面
- 大会設定
- バックアップ

QRは全partが揃い検証に成功したら原則自動取込・自動再集計する。

設定Versionが古い場合、得点変更のみ等でRaw Resultが互換なら現在ルールで再計算して受理する。入力Schema変更で不足情報がある場合は要確認とする。

未提出は予定終了時刻を超えても即エラーにせず「未提出候補」とする。

表示専用画面は同じ本部端末の別ウィンドウまたは別タブで開き、HDMI等で外部ディスプレイへ表示する。IndexedDB更新に合わせて自動更新する。

## 10. 大会設定

設定領域:

1. 基本情報
2. 組・チーム
3. 競技
4. 時程・試合表
5. 入力・得点ルール
6. 設定配布・Version

チーム数・名称は可変とし、表示名と不変IDを分離する。

### CSV

時程・試合表はCSV一括インポートと手動編集の両方を提供する。

CSVインポート時は列マッピングとプレビューを行い、ERRORはブロック、WARNINGは確認後続行可能とする。

### Config Version

設定は編集中状態を持ち、適用時に新Versionを作る。変更種別:

- `DISPLAY_ONLY`
- `SCHEDULE`
- `SCORING`
- `INPUT_SCHEMA`

本部から `CONFIG_UPDATE` QRを生成し、必要なコート端末へ配布する。差分適用ができない場合は完全設定QRを生成できる。

## 11. IndexedDB

主要ストア:

- `appMeta`
- `tournaments`
- `teams`
- `competitions`
- `competitionEntries`
- `scheduleSlots`
- `courtRuns`
- `scoringSessions`
- `scoringProfiles`
- `configVersions`
- `results`
- `resultRevisions`
- `transferBatches`
- `receivedQrParts`
- `acknowledgements`
- `operators`
- `auditEvents`
- `localSettings`

TransferBatch生成後は、そのバッチが参照するRevisionを固定し、途中の訂正で既存バッチ内容を変えない。

本部は未完了QR断片もIndexedDBへ保存し、アプリ再読み込み後に続きから読めるようにする。

## 12. 監査ログ

最低限以下のイベントを保存する。

- `RESULT_CREATED`
- `RESULT_CORRECTED`
- `RESULT_MANUALLY_ACKNOWLEDGED`
- `QR_BATCH_CREATED`
- `QR_BATCH_RECEIVED`
- `CONFIG_UPDATED`
- `BACKUP_CREATED`
- `BACKUP_RESTORED`
- `RESULT_CONFLICT_RESOLVED`

端末時刻は補助情報として扱い、Revisionの新旧判定を時刻だけに依存させない。

## 13. バックアップ

本部バックアップはアプリ独自の移植可能な単一ファイルとし、IndexedDBの内部実装そのものには依存させない。

バックアップに含めるもの:

- Tournament
- Teams
- Competitions
- Schedule
- ScoringProfiles
- ConfigVersions
- Results / Revisions
- Transfer履歴
- Operators
- AuditEvents
- Settings

`backupFormatVersion` と `databaseSchemaVersion` を持たせ、将来Migration可能にする。

復元は既存データへ部分マージせず、大会全体をバックアップ時点へ復元する方式を初期実装とする。

本部端末故障時は予備端末へ最新バックアップを復元し、バックアップ後に受領した結果のみコートから再送する。

コート側にも端末バックアップを任意機能として持たせる。

## 14. PWA / 完全オフライン

- HTML / JS / CSS / アイコン / QR生成 / QR読取等を全て同梱する。
- 外部CDN・外部API・Google Fonts等に依存しない。
- Service Workerで静的資産を事前キャッシュする。
- 大会データはIndexedDBに保存する。
- Persistent Storageを可能な範囲で要求する。
- Chrome系を主対象とし、iPadはホーム画面Webアプリ運用を想定する。
- カメラQRとUSBキーボード型QRリーダーは入力部分だけ分離し、以降のQR Parserは共通化する。

本番中はApp Versionを固定し、アプリ更新と設定更新を別操作にする。

端末画面には `OFFLINE / App Version / Config Version / Device` を確認可能な形で表示する。

## 15. 安全なアプリ再読み込み

全画面からアクセス可能な「アプリを再読み込み」を提供する。

- IndexedDBは削除しない。
- 下書き等の保存可能なUI状態を保存してから再読み込みする。
- 現在端末にあるApp Versionをローカルキャッシュから再起動する。
- アプリ更新処理とは分離する。
- QR途中読取、作成済みTransferBatch等は再読み込み後も復元できる。

「大会データ削除」「初期化」は別の危険操作として隔離し、強い確認を要求する。

## 16. 障害対応

基本原則:

- 再送しても二重加算しない。
- 途中で止まっても続きから再開できる。
- 訂正は履歴として残る。
- 本部故障時もバックアップ＋再送で復旧できる。
- 設定変更後もRaw Resultを保持する。

ERRORとWARNINGを分離する。

ERROR例:

- QR破損
- 別大会
- 未知のTeam ID
- 必須データ欠落
- 対応外Protocol Version

WARNING例:

- 古いConfig Version
- 通常ではない順位
- 予定外ScoringSession
- 極端な数値

エラー表示は「何が起きたか / データはどうなったか / 次に何をするか」を示す。

## 17. テスト・本番前リハーサル

テストを4段階で実施する。

1. 自動テスト
2. 端末単体テスト
3. 複数端末リハーサル
4. 本番前最終チェック

重点自動テスト:

- 得点計算・同順位
- タイム＋ペナルティ
- Revision直線履歴
- Revision競合
- QR単一 / 分割 / 順不同 / 重複 / 欠落 / 破損 / 別バッチ
- ScoringProfile回帰テスト

完全オフライン試験ではWi-Fi等を実際に切り、アプリ完全終了後に再起動して、入力→確定→QR→本部取込→ACK→集計→バックアップまで通す。

意図的に以下の事故も再現する。

- 同じQRの再読取
- 分割QR途中中断
- 別Batch混入
- ACK読み忘れ
- 同じ結果再送
- 訂正再送
- 本部/コート同時訂正による競合
- 古いConfig Result
- 本部端末故障と予備端末復旧
- アプリ再読み込み

## 18. 本番完了条件

以下を満たした時点で大会データを確定可能とする。

- 全予定ScoringSessionの結果が揃っている
- 未解決Conflictが0件
- 要確認が0件
- 得点計算が成功している
- 最終バックアップ作成済み

大会確定後は原則編集をロックし、明示的な解除操作を経て訂正可能とする。

## 19. 初期実装の優先順位

設計全体は複数サブシステムを含むため、実装は段階化する。

1. アプリ基盤・ドメインモデル・IndexedDB・Revision・得点エンジン基礎
2. QR Transfer / ACK
3. コートUI
4. 本部UI・集計・表示画面
5. 大会設定・CSV・Scoring Simulator
6. Config QR・バックアップ・復元
7. PWAオフライン・端末診断・統合リハーサル

各段階で動作するソフトウェアと自動テストを成立させてから次へ進む。