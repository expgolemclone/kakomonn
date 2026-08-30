# kakomonn-sync

`kakomonn-reader`のサイト別の定着状態と解答履歴を端末間で共有し, 直近31日間の`stabilityDaysDelta`, `dailyNewQuestionCount`, `dailyCorrectRatePercent`, 日別のraw DB rowを表示するCloudflare Workerです. 認証済み端末へAzure Speechの短期tokenも発行します.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-sync.kakomonn.workers.dev/
```

初回だけ`kakomonn-reader`と同じ同期tokenを入力します. tokenと最後に表示したサイトだけをこのoriginの`localStorage`へ保存します.

dashboardは`dailyKpiCompleted`をprimary KPIとして表示し, `dueCardsRemaining`と`newQuestionsRemaining`を同じcard内に表示します. 日本時間の同じ日に, 現在の問題catalogにある`due_ms`が現在時刻以前のcardが0件で, かつ新規問題を100問以上解答したときだけ達成です. `todayStabilityDaysDelta`, `stabilityDays`, `attemptedQuestionCount`, `todayAttemptedQuestionCount`, `todayCorrectRatePercent`は詳細指標として扱います. 31日graphは`stabilityDaysDelta`をbar, `dailyCorrectRatePercent`を0%から100%のlineで表示します. graphの日付を選択すると, 該当する`stability_history`と`attempts`の全columnをDBのcolumn名と保存値のまま確認できます.

## 次の問題を開く

iPhone SafariのTampermonkeyへ最新の`kakomonn-reader`をinstallして同期tokenを保存すると, 次の固定URLからFSRSに基づく次の問題へ移動できます.

```text
https://kakomonn-sync.kakomonn.workers.dev/open
```

`/open`はTampermonkeyが既に動作する`https://chushoks.kakomonn.com/createques#kakomonn-next`へredirectします. redirect先のuserscriptが専用storageの同期tokenで`GET /v9/next`を呼ぶため, tokenをURLやdashboardの`localStorage`へ保存しません.

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

APIは`/v9`だけを提供し, LearningState Durable Objectを唯一のsource of truthとします. `GET /v9/state`と`POST /v9/attempts`は`dailyKpiCompleted`, `dueCardsCompleted`, `dueCardsRemaining`, `todayNewQuestionCount`, `newQuestionGoal`, `newQuestionsRemaining`, `stabilityDays`, `todayStabilityDaysDelta`, `attemptedQuestionCount`, `todayAttemptedQuestionCount`, `todayCorrectRatePercent`を`learningMetrics`として返します. `newQuestionGoal`は100です. `todayCorrectRatePercent`は0から100の整数で, 当日のattemptが0件なら`null`です. `POST /v9/attempts`は`attempt`として`answerResult`, `attemptedAtMs`, card単位の`previousCardStabilityDays`と`resultingCardStabilityDays`, 集計値の`previousStabilityDays`と`resultingStabilityDays`も返します. 解答によって`dailyKpiCompleted`が`false`から`true`になった場合だけ, `celebration`として`site`, `date`, `dailyKpiCompleted`を返します.

- `GET /v9/sites`は, 問題catalogを登録済みのサイト一覧を返します.
- `GET /v9/dashboard?site=<host>`は, dashboard用のsite一覧, 選択siteのstate, 直近31日間のhistoryを1回で返します. site未指定または未登録の場合は, 登録済みsiteの先頭を選択します.
- `GET /v9/state?site=<host>`は, `learningMetrics`と問題catalog情報を返します.
- `GET /v9/history?site=<host>&days=<1-31>`は, 日本時間の日別`closingStabilityDays`, `stabilityDaysDelta`, `dailyAttemptedQuestionCount`, `dailyNewQuestionCount`, `dailyCorrectRatePercent`を返します. 計測開始前の`closingStabilityDays`と`stabilityDaysDelta`は`null`で, 計測開始後にrowがない日の`stabilityDaysDelta`は`0`です. attemptが0件の日の`dailyCorrectRatePercent`は`null`です.
- `GET /v9/daily-details?site=<host>&date=<YYYY-MM-DD>`は, 指定した日本時間の日付に対応する`stability_history`と`attempts`の全raw rowを返します.
- `POST /v9/attempts`は, `site`, `questionId`, `operationId`, `answerResult`だけを受け取り, 解答保存後の`nextQuestion`も返します. 同じ操作の再送は重複記録せず, 異なるpayloadで同じ操作IDを使用した場合は拒否します.
- `GET /v9/next`は, FSRSに基づく次の問題を返します.
- `POST /v9/questions`は, siteの問題catalogを世代番号付きで置き換えます.
- `POST /v9/speech-token`は, 有効期間600秒のAzure Speech tokenを返します.

`answerResult`が`correct`の場合はFSRSの`Easy`, `incorrect`の場合は`Again`としてcardを更新します. 保存済みのcardは再計算せず, 次の解答時から現在のmappingを適用します.

未回答問題と`due_ms`へ到達した問題だけをFSRSの更新対象にします. 期限前にURLから再解答した場合はattemptを履歴へ保存し, `attemptedQuestionCount`, `todayAttemptedQuestionCount`, `todayCorrectRatePercent`, `dailyCorrectRatePercent`へ含めますが, card, `stabilityDays`, `todayStabilityDaysDelta`は変更しません. その問題IDの初回解答なら`todayNewQuestionCount`と`dailyNewQuestionCount`にも含めます.

`kakomonn-reader`はSpeech tokenを約9分間再利用し,`ja-JP-NanamiNeural`のMP3をAzureから直接取得します.Workerは音声dataを中継せず,Workers AI,Durable Objects,R2も音声処理には使用しません.Azure Speech F0の無料枠を超過した場合は読み上げを停止し,別の音声へ切り替えません.

`stabilityDays`は, 現在の問題catalogに含まれる全cardのFSRS stabilityを合計してから整数へ切り捨てた値です. 未回答問題は0日として扱います. catalogから外れたcardは再登録時に学習状態を復元できるよう保存しますが, `stabilityDays`と次問候補には含めません. catalog置換で`stabilityDays`が変化した場合も, その日の履歴へ新しい値を記録します.

`learningMetrics`の集計値はsiteごとの`learning_metrics` rowへ保持し, 解答と同じtransactionで更新します. 通常のstate取得と解答ではcatalog, card全体, attempt全履歴をaggregate scanしません. `dueCardsRemaining`は`due_ms <= now`を満たす現在catalog内のcardをindexで数え, 0件なら`dueCardsCompleted`が`true`になります. `newQuestionsRemaining`は`max(0, 100 - todayNewQuestionCount)`です. 両方の残件数が0のときだけ`dailyKpiCompleted`が`true`になります. `stabilityDays`だけはcatalog置換時に現在のcatalogから再集計し, 増分更新の誤差とcatalogから外れたcardの影響を補正します.

問題catalogの再同期では, 保存済みIDと新しいIDの差分だけを書き込みます. 内容が同一の場合は`updatedAtMs`だけを更新し, 問題row, generation, 学習指標, 履歴を書き直しません.

`todayNewQuestionCount`と`dailyNewQuestionCount`は, site内でその問題IDを初めて解答した日本時間の日に, 正誤を問わず1問だけ数えます. 同じ問題の再解答は同日でも別の日でも数えません.

`stabilityDaysDelta`は, 日ごとの`closing_stability_days - opening_stability_days`です. `todayStabilityDaysDelta`は当日の同じ値です. どちらもprimary KPIの達成判定には使用しません.

`todayCorrectRatePercent`と`dailyCorrectRatePercent`は, 日本時間の同じ日に保存された`correct`のattempt数を全attempt数で割り, 四捨五入した整数%です. 同じ問題の繰り返しも別attemptとして数えます. attemptが0件の日は`null`です. どちらもprimary KPIの達成判定には使用しません.

祝福判定は, 解答によって`dailyKpiCompleted`が`false`から`true`へ変わった場合だけ成立します. 100問目の新規問題と最後の期限到達cardのどちらが後になっても同じです. siteと日本時間の日付ごとに1回だけ記録し, 同じ`operationId`の再送では同じeventを返します. catalog変更, schema移行, すでに達成済みの状態での解答では祝福を作成しません.

解いた問題数はsite内の問題IDの種類数です.同じ問題を複数回解いても累計では1問として数え,日別では同じ日に繰り返しても1問として数えます.別の日に同じ問題を解いた場合は,各日の解いた問題数へ1問ずつ数えます.正答,誤答,スキップはいずれも解答履歴へ含めます.過去に解いた問題は,現在の問題catalogから外れても累計へ含めます.

## Acknowledgements

`kakomonn-sync`のschedulingとWorker testに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| FSRS scheduling | [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) |
| Worker unit testing | [vitest-dev/vitest](https://github.com/vitest-dev/vitest) |

## 互換性方針

v1からv8のAPIは提供しません. legacy v4 schemaとschema v2からv9のcard, attempt, catalog, 解答履歴はschema v10へ明示的に移行します. 新規問題の日別件数は, siteと問題IDごとの最初のattempt日時から再集計します. 旧KPIの祝福履歴は破棄し, `dailyKpiCompleted`の祝福履歴を新しく開始します. 旧APIへのfallbackや互換routeは追加しません. API契約を破壊的に変更する場合はversionを上げ, clientとserverを同時に更新します.
