# kakomonn-sync

`kakomonn-reader`のサイト別の定着状態と解答履歴を端末間で共有するCloudflare Workerです. 認証済み端末へAzure Speechの短期tokenも発行します.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-sync.kakomonn.workers.dev/
```

初回だけ`kakomonn-reader`と同じ同期tokenを入力します. tokenと最後に表示したサイトだけをこのoriginの`localStorage`へ保存します.

dashboardは[`learningMetrics`](#learningmetrics-contract)のprimary KPIと残件数を同じcardへ表示し, それ以外を詳細指標として扱います. 31日graphは[`history`](#history-contract)のstability変化をbar, 正答率を0%から100%のlineで表示します. graphの日付を選択すると, 該当する`stability_history`と`attempts`の全columnをDBのcolumn名と保存値のまま確認できます.

## 次の問題を開く

Windowsのopen commandまたはiPhone Safariから, 次の固定URLでFSRSに基づく次の問題へ移動できます. iPhoneでは最新の`kakomonn-reader`をTampermonkeyへinstallして同期tokenを保存し, URLをbookmarkまたはshortcutへ設定します.

```text
https://kakomonn-sync.kakomonn.workers.dev/open
```

`/open`はdashboard bridgeでreader userscriptが専用storageの同期tokenを読み, read-onlyの`GET /v9/next`が成功するまで待ちます. 応答に次問がある場合だけ安全な問題URLをDOMへ渡して直接移動するため, cold transportを問題siteへ持ち込みません. 次問がない場合とtokenが未設定または不正な場合は問題siteへ移動せず, bridge上で理由と再読み込み操作を表示します. 15秒以内に準備できない場合は, Tampermonkeyとreaderを確認するerrorを表示します. tokenをDOM, URL, dashboardの`localStorage`へ保存しません. readerでbrowser backを実行するとbridgeが`/`へ戻し, 最新のdashboardを読み込みます.

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

このcommandはWorker testとdashboard E2Eを実行してからdeploymentし,productionの全公開assetがrepositoryと一致することまで検証します.

`SYNC_TOKEN`には暗号学的に安全な256bit以上のrandom値を設定します.デプロイで表示された`workers.dev` URLは`kakomonn-reader`の`SYNC_API_URL`へ設定します.tokenとkeyはsourceや設定fileへ保存しません.

## API

APIは`/v9`だけを提供し, LearningState Durable Objectを唯一のsource of truthとします.

### Endpoints

- `GET /v9/sites`は, 問題catalogを登録済みのサイト一覧を返します.
- `GET /v9/dashboard?site=<host>`は, dashboard用のsite一覧, 選択siteのstate, 直近31日間のhistoryを1回で返します. site未指定または未登録の場合は, 登録済みsiteの先頭を選択します.
- `GET /v9/state?site=<host>`は, `learningMetrics`と問題catalog情報を返します.
- `GET /v9/history?site=<host>&days=<1-31>`は, 日本時間の日別historyを返します.
- `GET /v9/daily-details?site=<host>&date=<YYYY-MM-DD>`は, 指定した日本時間の日付に対応する`stability_history`と`attempts`の全raw rowを返します.
- `POST /v9/attempts`は, `site`, `questionId`, `operationId`, `answerResult`だけを受け取り, `learningMetrics`と解答保存後の`nextQuestion`を返します. `attempt`には`answerResult`, `attemptedAtMs`, card単位の`previousCardStabilityDays`と`resultingCardStabilityDays`, 集計値の`previousStabilityDays`と`resultingStabilityDays`を含めます. 同じ操作の再送は重複記録せず, 異なるpayloadで同じ操作IDを使用した場合は拒否します.
- `GET /v9/next`は, FSRSに基づく次の問題を返します.
- `POST /v9/questions`は, siteの問題catalogを世代番号付きで置き換えます.
- `POST /v9/speech-token`は, 有効期間600秒のAzure Speech tokenを返します.

### learningMetrics contract

`GET /v9/state`と`POST /v9/attempts`は次の値を`learningMetrics`として返します. 日付の境界は日本時間です.

| Field | Definition |
| --- | --- |
| `dailyKpiCompleted` | `dueCardsCompleted`が`true`で, `newQuestionsRemaining`が0のときだけ`true`. Primary KPIはこの値だけで判定する. |
| `dueCardsCompleted` | `dueCardsRemaining`が0なら`true`. |
| `dueCardsRemaining` | 現在の問題catalogにあり, `due_ms`が現在時刻以前であるcardの件数. |
| `todayNewQuestionCount` | site内で初めて解答した問題IDのうち, 初回解答日が当日である件数. 正誤を問わず1問だけ数え, 再解答は同日でも別日でも加算しない. |
| `newQuestionGoal` | 100. |
| `newQuestionsRemaining` | `max(0, newQuestionGoal - todayNewQuestionCount)`. |
| `stabilityDays` | 現在の問題catalogに含まれる全cardのFSRS stabilityを合計して整数へ切り捨てた値. 未回答問題は0日とし, catalog外のcardは含めない. |
| `todayStabilityDaysDelta` | 当日の`closing_stability_days - opening_stability_days`. Primary KPIには使用しない. |
| `attemptedQuestionCount` | 過去に解答したsite内の問題IDの種類数. catalogから外れた問題も含む. |
| `todayAttemptedQuestionCount` | 当日に解答した問題IDの種類数. 同じ問題の当日中の再解答は1問として数える. |
| `todayCorrectRatePercent` | 当日の`correct` attempt数を全attempt数で割り, 四捨五入した0から100の整数. 同じ問題の再解答も別attemptとし, attemptが0件なら`null`. Primary KPIには使用しない. |

正答, 誤答, スキップはいずれも解答履歴と解答問題数へ含めます.

### History contract

`GET /v9/history`は次の日別値を返します.

| Field | Definition |
| --- | --- |
| `closingStabilityDays` | その日の終了時点の`stabilityDays`. 計測開始前は`null`. |
| `stabilityDaysDelta` | `closing_stability_days - opening_stability_days`. 計測開始前は`null`, 計測開始後にrowがない日は0. |
| `dailyAttemptedQuestionCount` | その日に解答した問題IDの種類数. 同じ問題を別の日に解答した場合は, 各日で1問ずつ数える. |
| `dailyNewQuestionCount` | 問題IDの初回解答日だけ1問として数える. `todayNewQuestionCount`と同じ規則を使う. |
| `dailyCorrectRatePercent` | その日の全attemptに対する`correct` attemptの割合. `todayCorrectRatePercent`と同じ丸めと`null`規則を使う. |

### Scheduling and persistence

`answerResult`が`correct`の場合はFSRSの`Easy`, `incorrect`の場合は`Again`としてcardを更新します. 保存済みのcardは再計算せず, 次の解答時から現在のmappingを適用します.

未回答問題と`due_ms`へ到達した問題だけをFSRSの更新対象にします. 期限前の再解答はattemptとして集計しますが, cardとstabilityは変更しません.

`learningMetrics`はsiteごとの`learning_metrics` rowへ保持し, 解答と同じtransactionで更新します. `stabilityDays`はcatalog置換時に現在のcatalogから再集計し, catalogから外れたcardの影響と増分更新の誤差を補正して, その日のhistoryへ新しい値を記録します. catalogから外れたcardの学習状態は再登録時に復元できるよう保存しますが, stabilityと次問候補には含めません.

問題catalogの再同期では, 保存済みIDと新しいIDの差分だけを書き込みます. 内容が同一の場合は`updatedAtMs`だけを更新し, 問題row, generation, 学習指標, 履歴を書き直しません.

`kakomonn-reader`はSpeech tokenを約9分間再利用し, `ja-JP-NanamiNeural`のMP3をAzureから直接取得します. Workerは音声dataを中継せず, Workers AI, Durable Objects, R2も音声処理には使用しません. Azure Speech F0の無料枠を超過した場合は読み上げを停止し, 別の音声へ切り替えません.

### Celebration contract

解答によって`dailyKpiCompleted`が`false`から`true`へ変わった場合だけ, `POST /v9/attempts`は`site`, `date`, `dailyKpiCompleted`を`celebration`として返します. 100問目の新規問題と最後の期限到達cardのどちらが後になっても同じです. siteと日本時間の日付ごとに1回だけ記録し, 同じ`operationId`の再送では同じeventを返します. catalog変更, schema移行, すでに達成済みの状態での解答では祝福を作成しません.

## Acknowledgements

`kakomonn-sync`のschedulingとWorker testに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| FSRS scheduling | [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) |
| Worker unit testing | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |

## 互換性方針

v1からv8のAPIは提供しません. legacy v4 schemaとschema v2からv10のcard, attempt, catalog, 解答履歴はschema v11へ明示的に移行します. 新規問題の日別件数は, siteと問題IDごとの最初のattempt日時から再集計します. 旧KPIの祝福履歴は破棄し, `dailyKpiCompleted`の祝福履歴を新しく開始します. 旧APIへのfallbackや互換routeは追加しません. API契約を破壊的に変更する場合はversionを上げ, clientとserverを同時に更新します.
