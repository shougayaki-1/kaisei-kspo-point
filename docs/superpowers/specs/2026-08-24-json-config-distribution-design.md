# 大会設定 JSON ファイル配布設計

- 作成日: 2026-08-24
- 対象: 開成運動交流祭 得点管理 PWA
- 状態: 会話内で方針承認済み。実装前のユーザーレビュー待ち
- ベースライン: `main` `50f4b8c33c7a5ffa9ac8b40b77ba04d720298f1e`
- 関連仕様:
  - `docs/superpowers/specs/2026-08-19-offline-score-management-design.md`
  - `docs/superpowers/specs/2026-08-23-tournament-operations-ux-redesign-design.md`

## 1. 背景

現在の大会設定共有は、active ConfigVersion の `TournamentConfigSnapshot` 全体を `CONFIG_UPDATE` payload として QR 転送する経路を持つ。QR フレームは安全な読取密度を優先して小さく分割されるため、実運用規模の大会設定では 100 枚を超える QR フレームになる場合がある。

実際の大会準備で 112 枚の QR が必要となり、カメラを向けたまま全フレームを読み取る方式は、技術的には成立しても運用上は現実的でないことが確認された。

一方、既存コードには `ConfigVersionRecord` を JSON として export / import し、検証後に明示的に activate する仕組みがすでにある。また、担当コートの割当 QR は大会設定全体を含まず、`tournamentId`、`courtStationId`、任意の `competitionId` のみを持つ小さい payload であり、同一大会内で使い回せる。

本設計では、QR を大量データ転送媒体として使うことをやめ、大会設定は通常の `.json` ファイルで配布する。QR は、担当コート割当、試合結果、ACK 等の小さくイベント当日に頻繁に扱う情報に限定する。

## 2. 決定事項

1. 大会設定の通常配布経路は `.json` ファイルとする。
2. 独自拡張子は導入しない。
3. 全コート端末へ同一の JSON ファイルを配布する。
4. JSON には担当コートを含めない。
5. JSON 取込後、各コート端末は担当コート QR または手動選択で担当範囲を設定する。
6. 大会設定 JSON の取込は、検証と有効化を分離する。検証に失敗したファイルで現在の active config を置き換えない。
7. コートから本部への結果 QR、ACK、担当コート QR の既存方式は維持する。
8. `CONFIG_UPDATE` QR プロトコルは即時削除を必須としないが、通常運用の主導線から外す。既存互換・診断・非常用として残す場合も、運営者が通常配布手段だと誤認しない UI にする。

## 3. 目標

### 3.1 運用目標

大会設定を作成した本部担当者が、1 つの JSON ファイルを保存し、その同じファイルを AirDrop、USB、OS の共有機能、クラウド経由の事前配布等で必要な端末へ渡せること。

受信したコート端末では、ファイルを 1 回選択して内容を検証し、安全に大会設定を有効化できること。その後は小さい担当コート QR を 1 枚読み取るだけで、対象コートのタスクホームへ進めること。

### 3.2 技術目標

- 既存 `TournamentConfigFile` / ConfigVersion の正本性を維持する。
- JSON import 時に既存の schema validation、TournamentConfig validation、ScoringTestCase 回帰確認を再利用する。
- ファイル配布経路の追加によって、決定的得点計算、Revision、競合解決、結果 QR、ACK の意味を変更しない。
- 完全オフライン運用を維持する。大会当日にインターネット接続を必須にしない。
- 同じファイルを複数端末へ安全に取り込めるよう、端末固有情報を大会設定ファイルに混ぜない。

## 4. 非目標

- 本部端末からコート端末へリアルタイム同期する LAN サーバーは作らない。
- AirDrop、Nearby Share 等の OS 固有転送 API をアプリから直接制御しない。
- JSON ファイルに担当コートを焼き込んだ端末別ファイルを生成しない。
- 結果提出をファイル方式へ変更しない。
- 大会設定を ZIP や独自バイナリ形式へ変換しない。
- 暗号化ファイル形式や DRM を導入しない。

## 5. 通常運用フロー

### 5.1 本部で大会作成

1. 本部端末で大会設定ウィザードを完了する。
2. ConfigVersion を適用する。
3. 適用成功後、「コート端末へ配布」画面へ進む。
4. 「大会設定 JSON を保存」を押す。
5. active ConfigVersion を 1 つの JSON ファイルとして保存する。
6. 同じファイルを必要な全コート端末へ配布する。

本部側では QR の枚数を表示して大量 QR の読取りを促す画面を通常導線に置かない。

### 5.2 コート端末で大会設定を受信

1. コートモードを開く。
2. active tournament がない場合、「大会設定を受け取る」を最初の主要アクションとして表示する。
3. 「大会設定 JSON を選択」から `.json` ファイルを選ぶ。
4. ファイルを parse / validate / stage import する。
5. 成功時に大会名、ConfigVersion、競技数、コート数等の要約を表示する。
6. 「この大会設定を使用」を押した時点で activate する。
7. activate 後、「担当コートを設定」へ進む。
8. コート QR を 1 枚読み取るか、同等の手動選択を行う。
9. 担当範囲のタスクホームを表示する。

### 5.3 当日の結果連携

結果の保存・訂正・送信フローは変更しない。

- コート端末: Result / Revision を保存
- コート端末: 結果 QR を生成
- 本部端末: 結果 QR を読み取り
- 本部端末: import / conflict resolution
- 必要に応じて ACK を返す

大会設定配布方式の変更は、結果転送 payload の互換性へ影響させない。

## 6. JSON ファイル形式

### 6.1 拡張子

標準 `.json` を使用する。

`accept` 属性等も `application/json,.json` とし、独自 MIME type や独自拡張子は要求しない。

### 6.2 内容

既存 `serializeTournamentConfigFile(record)` が生成する検証可能な設定ファイル envelope を正本として利用する。raw `TournamentConfigSnapshot` だけを直接保存する新形式を別に作らない。

ファイルには少なくとも次の意味情報が含まれる。

- file schema version
- config version identity
- tournament identity
- ConfigVersion metadata
- immutable TournamentConfigSnapshot
- 検証に必要な整合性情報

端末固有の次の情報は含めない。

- `deviceId`
- 担当コート
- カメラ設定
- 未送信 Result / Revision
- ACK 状態
- UI 一時状態

### 6.3 ファイル名

人間が見て識別できる安定したファイル名を生成する。

推奨形式:

`kaisei-kspo-<year>-config-v<version>.json`

例:

`kaisei-kspo-2026-config-v1.json`

大会名をファイル名へ直接使う場合は、OS 間互換性のため危険文字を除去する。実装は上記の ASCII ベース命名を既定としてよい。

## 7. import と安全性

### 7.1 段階的 import

ファイルを選んだだけでは active config を置き換えない。

処理は次の 2 段階とする。

1. 検証・取り込み
2. 明示的な有効化

既存 `importTournamentConfigFile()` と `activateImportedConfigFile()` の責務分離を維持する。

### 7.2 検証失敗

次の場合は activate を許可しない。

- JSON syntax error
- 未対応 file schema version
- ConfigVersion metadata 不整合
- TournamentConfig validation error
- tournament / version identity mismatch
- ScoringTestCase が無効
- 必須参照先欠落

エラー時は現在の active tournament / ConfigVersion を維持する。

### 7.3 別大会ファイル

すでに別大会の active config がある端末へ異なる `tournamentId` の JSON を読み込んだ場合、黙って切り替えない。

ユーザーに「現在の大会」と「読み込んだ大会」を明示し、意図した切替であることを確認してから activate する。既存 Result / Revision がある場合は破壊的初期化と混同しない。

この設計で必要な UX は、Phase 5 の「safe reload と destructive reset の分離」を維持する。

### 7.4 同一大会の新 ConfigVersion

同じ `tournamentId` で新しい ConfigVersion の JSON を読み込むことは許可する。

適用前には既存の config impact / scoring regression 確認を行い、現在保存済み Result へ影響する危険な変更を既存ポリシーどおり扱う。

つまり JSON 配布は「初期配布だけの特殊形式」ではなく、必要なら大会設定更新にも利用できる。ただし通常の大会開始時は v1 の初期配布が主用途である。

## 8. UI 設計

### 8.1 本部

通常画面のカード名は「コート端末へ配布」とする。

主要要素:

- 現在の大会名
- Config vN
- 「大会設定 JSON を保存」ボタン
- 「全コート端末に同じファイルを渡してください」という短い説明
- 次の手順として「各端末で担当コートを設定」を表示

開発者向けの語句である `ConfigVersionを書き出す`、`JSON import / export`、長い JSON textarea は通常画面には出さない。

必要なら「詳細管理」配下で raw JSON 表示や既存の開発者向け import / export UI を維持できる。

### 8.2 コート

active config がない場合:

- 見出し: 「大会設定を受け取る」
- 説明: 「本部から受け取った大会設定 JSON を選択してください」
- 主ボタン: 「大会設定 JSON を選択」

検証成功後:

- 大会名
- Config vN
- 競技数
- コート数
- 「この大会設定を使用」

有効化成功後:

- 成功状態を表示
- 主アクションを「担当コートを設定」に切り替える
- QR カメラ起動または手動選択へ進む

### 8.3 QR 設定配布 UI

現在の `ConfigUpdatePanel` が持つ「大会設定 QR を表示」「カメラで大会設定 QR を読み取る」は通常運用から外す。

実装時の選択肢は次のどちらでもよい。

- A: 詳細管理・非常用として残す
- B: UI から隠し、プロトコルとテストだけ当面残す

本設計ではプロトコルそのものの削除を要求しない。理由は、今回の目的が運用ボトルネック解消であり、既存転送プロトコルの撤去まで同時に行う必要がないためである。

## 9. 担当コート割当との関係

大会設定 JSON は全端末共通である。

有効化後の端末ごとの差分は `CourtAssignment` のみとする。

```text
同じ大会設定 JSON
  ├─ A コート端末 → A コート QR
  ├─ B コート端末 → B コート QR
  ├─ C コート端末 → C コート QR
  └─ D コート端末 → D コート QR
```

担当 QR は既存の小さい `COURT_ASSIGNMENT` payload を維持する。

同じ大会・同じ物理コートであれば、コートのみ QR は複数競技をまたいで使い回せる。

QR が使えない場合は、active config からコートを手動選択し、QR と同じ assignment service を通す。

## 10. エラー表示

運営者向け表示では内部例外文をそのまま主メッセージにしない。

代表ケース:

- JSON でない / 壊れている
  - 「大会設定ファイルを読み込めませんでした。正しい JSON ファイルを選択してください。」
- 対応していない形式
  - 「この大会設定ファイルは、このアプリのバージョンでは使用できません。」
- 設定 validation error
  - 「大会設定に不整合があります。本部端末で設定を確認して、もう一度書き出してください。」
- 別大会
  - 現在の大会と新しい大会を表示し、切替操作へ誘導
- activate 失敗
  - 現在の設定が維持されていることを明示

詳細管理では原因コードや内部 ID を確認できてもよい。

## 11. 既存仕様との優先関係

`2026-08-23-tournament-operations-ux-redesign-design.md` では、JSON import / export を「詳細管理」に置く設計としていた。

本設計はその一部を上書きする。

- 一般的な「設定管理用 raw JSON import / export」は引き続き詳細管理に置く。
- ただし「コート端末へ大会設定を配布する」という運用目的の JSON export / import は通常導線へ昇格する。

ユーザーには JSON データ管理機能としてではなく、「大会設定を配布」「大会設定を受け取る」という運用タスクとして見せる。

## 12. 想定変更箇所

実装計画では少なくとも次を確認対象とする。

- `src/app/ConfigFilePanel.tsx`
- `src/app/config-file-panel-service.ts`
- `src/app/ConfigUpdatePanel.tsx`
- `src/app/App.tsx`
- `src/app/tournament-settings/TournamentSettingsHome.tsx`
- `src/app/tournament-setup/FinalCheckStep.tsx` または大会作成後導線
- `src/config/config-file.ts`
- `src/app/court/CourtAssignmentPanel.tsx`
- 関連 unit / integration tests

既存 `src/transfer/config-update.ts` と `src/transfer/frame.ts` は、通常導線から外すだけなら変更不要である可能性がある。削除・再設計を先に行わない。

## 13. テスト要件

### 13.1 ファイル export

- active ConfigVersion を JSON として保存できる。
- 生成 JSON を既存 parser で再読込できる。
- ファイル名が `.json` で終わる。
- 同じ active ConfigVersion から生成した内容が意味的に同一である。

### 13.2 コート import

- valid JSON を stage import できる。
- import だけでは active config が変わらない。
- activate 後に active config が切り替わる。
- invalid JSON で active config が変わらない。
- validation failure で active config が変わらない。

### 13.3 同一ファイルの複数端末利用

- 同じ JSON を複数の空の端末 DB へ取り込める。
- 各端末が別々の CourtAssignment を持てる。
- CourtAssignment が JSON export 内容へ逆流しない。

### 13.4 結果 QR 回帰

- JSON で大会設定を受信した端末から、既存 RESULT_BATCH QR を生成できる。
- 本部が既存経路で import できる。
- ACK が従来どおり成立する。

### 13.5 UX rehearsal

統合テストまたは rehearsal で次を通す。

1. 本部で大会作成
2. JSON export
3. 新規コート端末 DB で JSON import
4. activate
5. A コート assignment
6. A コート対象タスク表示
7. 結果入力
8. 結果 QR 生成
9. 本部 import

大量 ConfigSnapshot でも、大会設定配布のために 100 枚超の QR 読取を要求しないことを acceptance criterion とする。

## 14. 受入条件

実装完了は次を満たすこと。

- 本部の通常運用画面から active 大会設定を `.json` で保存できる。
- 全コートへ同一ファイルを配布できる。
- コート端末の通常運用画面から `.json` を選択して検証・有効化できる。
- invalid file で既存 active config を破壊しない。
- 有効化後、担当コート QR または手動設定へ自然に進める。
- 担当コート QR は従来どおり再利用できる。
- 結果 QR / ACK の既存プロトコルに回帰がない。
- 大会設定の通常配布に多分割 QR を要求しない。
- 独自拡張子を導入しない。

## 15. 実装方針の要約

新しい転送エンジンを作る必要はない。

既存の ConfigVersion JSON serialize / import / activate 基盤を、運営者向けの通常導線として再利用する。主な実装対象は UI、ブラウザでの JSON ダウンロード、コート側ファイル選択導線、状態遷移、回帰テストである。

QR 転送の役割は「設定全体を運ぶもの」から「担当割当・結果・ACK 等の小さいイベント情報を運ぶもの」へ明確化する。
