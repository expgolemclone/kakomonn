# kakomonn-sync

`kakomonn-reader`のサイト別の定着状態と解答履歴を端末間で共有するCloudflare Workerです. 認証済み端末へAzure Speechの短期tokenも発行します.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-sync.kakomonn.workers.dev/
```

同じbrowser profileで最新の`kakomonn-reader`をTampermonkeyへinstallして使用します. dashboardはreaderのUserscript専用storageに保存された同期tokenで自動接続し, tokenの入力と変更はreaderの同期設定だけで行います. dashboardのDOM, JavaScript state, URL, `localStorage`へtokenを渡しません. `localStorage`には最後に表示したサイトだけを保存します.

dashboardは[`learningMetrics`](#learningmetrics-contract)のprimary KPIと残件数を同じcardへ表示し, それ以外を詳細指標として扱います. 31日graphは[`history`](#history-contract)のstability変化をbar, 正答率を0%から100%のline, 勉強時間を独立したduration軸のbarで表示します. graphの日付を選択すると, 該当する`study_time_daily`, `stability_history`, `attempts`の全columnをDBのcolumn名と保存値のまま確認できます.

## 次の問題を開く

固定URLの起動先は現在`chushoks.kakomonn.com`です. 他の資格サイトでは, 対象サイトの問題ページを直接開いて`kakomonn-reader`を使用します.

Windowsのopen commandまたはiPhone Safariから, 次の固定URLでFSRSに基づく次の問題へ移動できます. iPhoneでは最新の`kakomonn-reader`をTampermonkeyへinstallして同期tokenを保存し, URLをbookmarkまたはshortcutへ設定します.

```text
https://kakomonn-sync.kakomonn.workers.dev/open
```

`/open`はdashboard bridgeでreader userscriptが専用storageの同期tokenを読み, read-onlyの`GET /v12/next`が成功するまで待ちます. 応答に次問がある場合だけ安全な問題URLをDOMへ渡して直接移動するため, cold transportを問題siteへ持ち込みません. 次問がない場合とtokenが未設定または不正な場合は問題siteへ移動せず, bridge上で理由と再読み込み操作を表示します. 15秒以内に準備できない場合は, Tampermonkeyとreaderを確認するerrorを表示します. tokenをDOM, URL, dashboardの`localStorage`へ保存しません. readerでbrowser backを実行するとbridgeが`/`へ戻し, Userscript専用storageの同じtokenで最新のdashboardを読み込みます.

token未設定または認証失敗の場合は, redirect先の同期設定でtokenを保存し, 再読込せず次の問題へ進みます. 通信失敗, 問題catalog未同期, 次問なしの場合は, 原因と再試行操作を表示します.

## ローカルテスト

repository rootで実行します.

```bash
npm run test:kakomonn-sync
npm run test:kakomonn-dashboard
```

## デプロイ

CloudflareへloginしてWorkerをデプロイします.

先にAzureへloginし,`Japan East`に無料F0のSpeech resourceを作成します. `<unique-name>`はAzure全体で一意な名前へ置き換えます.

```powershell
az login
az group create --name kakomonn-reader --location japaneast
az cognitiveservices account create --name <unique-name> --resource-group kakomonn-reader --kind SpeechServices --sku F0 --location japaneast --yes
$speechKey = az cognitiveservices account keys list --name <unique-name> --resource-group kakomonn-reader --query key1 --output tsv
```

続いてCloudflareへloginし,同期tokenとAzure Speech keyをSecretへ登録してデプロイします.

```powershell
npx wrangler login
npx wrangler secret put SYNC_TOKEN --config kakomonn-sync/wrangler.jsonc
$speechKey | npx wrangler secret put AZURE_SPEECH_KEY --config kakomonn-sync/wrangler.jsonc
npm run deploy:kakomonn-sync
```

このcommandはWorker testとdashboard E2Eを実行してからdeploymentし, productionの全公開assetがrepositoryと一致することと, 実Tampermonkeyのreader tokenでdashboardが自動接続することまで検証します.

`SYNC_TOKEN`には暗号学的に安全な256bit以上のrandom値を設定します.デプロイで表示された`workers.dev` URLは`kakomonn-reader`の`SYNC_API_URL`へ設定します.tokenとkeyはsourceや設定fileへ保存しません.

## コピー失敗の自動報告

Readerのコピー失敗を[Issue #29](https://github.com/expgolemclone/kakomonn/issues/29)のcommentへ記録します. site, 問題ID, 段階ごとの初回だけを報告し, 件数は更新しません. 段階はMarkdown生成またはclipboard書き込みです. Workerの受付後はSQLite Durable Objectへ保存した配送状態を正本とし, GitHub commentはその公開結果です. 問題本文, 解説, 学習履歴, clipboard内容, tokenは送信しません.

GitHub PATは全Reader共通でWorker側のSecretに1つだけ登録します. GitHubで対象repositoryを`expgolemclone/kakomonn`だけに限定したfine-grained PATを作成し, `Issues: Read and write`を付与してください. PATをrepository, .env, browser, URLへ保存しません.

```powershell
node --use-system-ca node_modules/wrangler/bin/wrangler.js secret put GITHUB_COPY_FAILURE_TOKEN --config kakomonn-sync/wrangler.jsonc
```

未送信報告がある場合だけalarmを使用し, 配送失敗は1分から最大6時間の指数backoffで再送します. GitHubのrate limit待機指示は優先します. SecretまたはGitHub配送先の設定を変更した後の次の報告受理時には, 配送設定のfingerprintだけで変更を検出し, 古い設定による待機を解除します. 投稿結果が不明な場合はcomment内のmarkerを照合してから再送します. Secret未設定でも報告を受け付け, 配送待ちとして保持します. queueが空ならalarmを停止します. Cron, polling, 永続log, traceは使用しません.

Readerは報告の応答を待たず学習を継続します. Worker受付前の通信失敗とReader終了前に未受付の報告は再送保証の対象外です. APIはコピー失敗時だけ呼び出し, 通常の解答は従来どおり1回のWorker requestと1回のLearningState RPCで処理します. Worker deploymentのproduction検証後にReaderをreleaseします.

deployment後は`npm run test:kakomonn-copy-failure-production`で, 実Chromeと実Tampermonkey, 本番同期とGitHub配送を検証します. 実問題pageの解説番号DOMだけを欠落させてMarkdown生成失敗を発生させ, 同期後の自動遷移, comment到達と重複抑止を確認します. GitHubの確認と検証注記には認証済みgh CLIを使用します. 収集commentには制御下の本番検証であり, 元pageの不具合を示す記録ではないことを追記します. この検証は本番に解答を記録するため, deploymentごとに1回だけ実行し, 完全testの代わりにはしません.

## API

APIは`/v12`だけを提供し, 学習状態はLearningState Durable Object, コピー失敗報告の配送状態はCopyFailureReports Durable Objectで管理します.

### Endpoints

- `GET /v12/sites`は, 問題catalogを登録済みのサイト一覧を返します.
- `GET /v12/dashboard?site=<host>`は, dashboard用のsite一覧, 選択siteのstate, 直近31日間のhistoryを1回で返します. site未指定または未登録の場合は, 登録済みsiteの先頭を選択します.
- `GET /v12/state?site=<host>`は, `learningMetrics`と問題catalog情報を返します.
- `GET /v12/history?site=<host>&days=<1-31>`は, 日本時間の日別historyを返します.
- `GET /v12/daily-details?site=<host>&date=<YYYY-MM-DD>`は, 指定した日本時間の日付に対応する`study_time_daily`, `stability_history`, `attempts`の全raw rowを返します.
- `POST /v12/study-time`は, `site`と累積`studyTimeSnapshots`を受け取り, sessionごとの差分だけを日次勉強時間へ反映して更新後の`state`を返します. 同じsnapshotの再送と古いsnapshotの後着では二重加算しません.
- `POST /v12/attempts`は, `site`, `questionId`, `operationId`, `answerResult`, `studyTimeSnapshots`を受け取り, 勉強時間snapshotと解答を同じDurable Object transactionで反映して`learningMetrics`と解答保存後の`nextQuestion`を返します. `attempt`には`answerResult`, `attemptedAtMs`, card単位の`previousCardStabilityDays`と`resultingCardStabilityDays`, 集計値の`previousStabilityDays`と`resultingStabilityDays`を含めます. 同じ操作の再送は重複記録せず, 異なるpayloadで同じ操作IDを使用した場合は拒否します.
- `GET /v12/next`は, FSRSに基づく次の問題と同時点の`state`を1回のDurable Object RPCで返します.
- `POST /v12/questions`は, siteの問題catalogを世代番号付きで置き換え, 更新後の次の問題を返します. 世代競合時は現在のcatalogと次の問題を返します.
- `POST /v12/speech-token`は, 有効期間600秒のAzure Speech tokenを返します.
- 同じCloudflare accountの`smec-second-private`は, `SpeechTokenEntrypoint.issueToken()`をService Bindingから呼び出して同じ短期tokenを取得します. このRPCはpublic HTTP routeを追加せず, Azure Speech keyの登録先をこのWorkerだけに保ちます.
- `POST /v12/copy-failures`は, 同期tokenで認証し, `site`, `questionId`, `reason`だけを受け取ります. `reason`は`markdown_unavailable`, `clipboard_write_failed`, `clipboard_write_timeout`に限定し, 永続受付後に`{ accepted: true }`を返します. 問題URLはWorkerで生成します.

### learningMetrics contract

`GET /v12/state`と`POST /v12/attempts`は次の値を`learningMetrics`として返します. 日付の境界は日本時間です.
学習APIのvalidationと達成eventの正本はrepository rootの`contracts/kakomonn.mjs`です. 祝福URLの契約は[congratulations](https://github.com/expgolemclone/congratulations)のpackageを使用します.

| Field | Definition |
| --- | --- |
| `dailyKpiCompleted` | 当日に`dueCardsCompleted`が`true`かつ`newQuestionsRemaining`が0へ到達すると`true`になり, その後に新たなcardが期限到達しても当日中は`true`を維持する. Primary KPIはこの値だけで判定する. |
| `dueCardsCompleted` | `dueCardsRemaining`が0なら`true`. |
| `dueCardsRemaining` | 現在の問題catalogにあり, `due_ms`が現在時刻以前であるcardの件数. |
| `todayNewQuestionCount` | site内で初めて解答した問題IDのうち, 初回解答日が当日である件数. 正誤を問わず1問だけ数え, 再解答は同日でも別日でも加算しない. |
| `newQuestionGoal` | serverが定める正の整数. 現在は10. Consumerはこのfieldをgoalのsource of truthとして使用する. |
| `newQuestionsRemaining` | `max(0, newQuestionGoal - todayNewQuestionCount)`. |
| `stabilityDays` | 現在の問題catalogに含まれる全cardのFSRS stabilityを合計して整数へ切り捨てた値. 未回答問題は0日とし, catalog外のcardは含めない. |
| `todayStabilityDaysDelta` | 当日の`closing_stability_days - opening_stability_days`. Primary KPIには使用しない. |
| `attemptedQuestionCount` | 過去に解答したsite内の問題IDの種類数. catalogから外れた問題も含む. |
| `todayAttemptedQuestionCount` | 当日に解答した問題IDの種類数. 同じ問題の当日中の再解答は1問として数える. |
| `todayCorrectRatePercent` | 当日の`correct` attempt数を全attempt数で割り, 四捨五入した0から100の整数. 同じ問題の再解答も別attemptとし, attemptが0件なら`null`. Primary KPIには使用しない. |
| `todayStudyTimeMs` | Readerで当該siteをforegroundかつengaged状態で学習した当日の累積時間をmillisecondで表す非負整数. 5分間user操作がない区間は5分到達後を数えず, Primary KPIには使用しない. |

正答, 誤答, スキップはいずれも解答履歴と解答問題数へ含めます.

### History contract

`GET /v12/history`は次の日別値を返します.

| Field | Definition |
| --- | --- |
| `closingStabilityDays` | その日の終了時点の`stabilityDays`. 計測開始前は`null`. |
| `stabilityDaysDelta` | `closing_stability_days - opening_stability_days`. 計測開始前は`null`, 計測開始後にrowがない日は0. |
| `dailyAttemptedQuestionCount` | その日に解答した問題IDの種類数. 同じ問題を別の日に解答した場合は, 各日で1問ずつ数える. |
| `dailyNewQuestionCount` | 問題IDの初回解答日だけ1問として数える. `todayNewQuestionCount`と同じ規則を使う. |
| `dailyCorrectRatePercent` | その日の全attemptに対する`correct` attemptの割合. `todayCorrectRatePercent`と同じ丸めと`null`規則を使う. |
| `dailyStudyTimeMs` | Readerから受理したその日のstudy session累積snapshotをsession単位で差分集計したmillisecond. 解答が0件の日も0以上の値を持てる. |

### Scheduling and persistence

`answerResult`が`correct`の場合はFSRSの`Easy`, `incorrect`の場合は`Again`としてcardを更新します. 保存済みのcardは再計算せず, 次の解答時から現在のmappingを適用します.

未回答問題と`due_ms`へ到達した問題だけをFSRSの更新対象にします. 期限前の再解答はattemptとして集計しますが, cardとstabilityは変更しません.

`learningMetrics`はsiteごとの`learning_metrics` rowへ保持し, 解答と同じtransactionで更新します. 勉強時間は`study_time_sessions`へsession/dateごとの最新累積値, `study_time_daily`へ日次合計を保持し, `todayStudyTimeMs`だけを当日の`learning_metrics`へ反映します. 過去日の遅延snapshotは`study_time_daily`だけを更新します. `stabilityDays`はcatalog置換時に現在のcatalogから再集計し, catalogから外れたcardの影響と増分更新の誤差を補正して, その日のhistoryへ新しい値を記録します. catalogから外れたcardの学習状態は再登録時に復元できるよう保存しますが, stabilityと次問候補には含めません.

問題catalogの再同期では, 保存済みIDと新しいIDの差分だけを書き込みます. 内容が同一の場合は`updatedAtMs`だけを更新し, 問題row, generation, 学習指標, 履歴を書き直しません.

`kakomonn-reader`はSpeech tokenを約9分間再利用し, `ja-JP-NanamiNeural`のMP3をAzureから直接取得します. Workerは音声dataを中継せず, Workers AI, Durable Objects, R2も音声処理には使用しません. Azure Speech F0の無料枠を超過した場合は読み上げを停止し, 別の音声へ切り替えません.

### Celebration contract

解答によって`dailyKpiCompleted`が`false`から`true`へ変わった場合だけ, `POST /v12/attempts`は`site`, `date`, `dailyKpiCompleted`を`celebration`として返します. 10問目の新規問題と最後の期限到達cardのどちらが後になっても同じです. siteと日本時間の日付ごとに1回だけ記録し, 同じ`operationId`の再送では同じeventを返します. catalog変更, schema移行, すでに達成済みの状態での解答では祝福を作成しません.

## Acknowledgements

`kakomonn-sync`のschedulingとWorker testに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| FSRS scheduling | [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) |
| Worker unit testing | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |

## 互換性方針

v1からv11のAPIは提供しません. legacy v4 schemaとschema v2からv11のcard, attempt, catalog, 解答履歴はschema v12へ明示的に移行します. schema v11以前には勉強時間dataがないため, 過去日のstudy timeは推測せず0から開始します. 新規問題の日別件数は, siteと問題IDごとの最初のattempt日時から再集計します. 旧KPIの祝福履歴は破棄し, `dailyKpiCompleted`の祝福履歴を新しく開始します. 旧APIへのfallbackや互換routeは追加しません. API契約を破壊的に変更する場合はversionを上げ, clientとserverを同時に更新します.
