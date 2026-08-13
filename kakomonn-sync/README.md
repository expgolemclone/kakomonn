# kakomonn-sync

`kakomonn-reader`のサイト別の定着状態と解答履歴を端末間で共有し, 直近7日間の`stabilityDaysDelta`と日別のraw DB rowを表示するCloudflare Workerです. 認証済み端末へAzure Speechの短期tokenも発行します.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-sync.expgolem-lab.workers.dev/
```

初回だけ`kakomonn-reader`と同じ同期tokenを入力します. tokenと最後に表示したサイトだけをこのoriginの`localStorage`へ保存します. `dailyStabilityDaysDeltaGoal`はsiteごとにWorkerへ保存するため, 同じ同期tokenを使用する他の端末でも共有されます.

dashboardは`todayStabilityDaysDelta`をprimary KPIとして表示し, `stabilityDays`, `attemptedQuestionCount`, `todayAttemptedQuestionCount`は表示専用の指標として扱います. 各指標の数値は画面内の1か所だけに表示します. graphは`stabilityDaysDelta`だけを表示し, 当日barではprimary KPIと重複する数値labelを省きます. graphの日付を選択すると, 該当する`stability_history`と`attempts`の全columnをDBのcolumn名と保存値のまま確認できます.

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

APIは`/v7`だけを提供し, LearningState Durable Objectを唯一のsource of truthとします. `GET /v7/state`と`POST /v7/attempts`は`stabilityDays`, `todayStabilityDaysDelta`, `attemptedQuestionCount`, `todayAttemptedQuestionCount`を`learningMetrics`として返します. `POST /v7/attempts`は`attempt`として`answerResult`, `attemptedAtMs`, card単位の`previousCardStabilityDays`と`resultingCardStabilityDays`, 集計値の`previousStabilityDays`と`resultingStabilityDays`も返します.

- `GET /v7/sites`は,問題catalogを登録済みのサイト一覧を返します.
- `GET /v7/state?site=<host>`は,`learningMetrics`と問題catalog情報を返します.
- `GET /v7/history?site=<host>&days=<1-31>`は, 日本時間の日別`closingStabilityDays`, `stabilityDaysDelta`, `dailyAttemptedQuestionCount`を返します. 計測開始前の`closingStabilityDays`と`stabilityDaysDelta`は`null`で, 計測開始後にrowがない日の`stabilityDaysDelta`は`0`です.
- `GET /v7/daily-details?site=<host>&date=<YYYY-MM-DD>`は, 指定した日本時間の日付に対応する`stability_history`と`attempts`の全raw rowを返します.
- `POST /v7/attempts`は,`site`,`questionId`,`operationId`,`answerResult`だけを受け取ります.同じ操作の再送は重複記録せず,異なるpayloadで同じ操作IDを使用した場合は拒否します.
- `GET /v7/next`は,FSRSに基づく次の問題を返します.
- `POST /v7/questions`は,siteの問題catalogを世代番号付きで置き換えます.
- `GET /v7/settings?site=<host>`は,site別の`dailyStabilityDaysDeltaGoal`を返します.`PUT /v7/settings`は,siteと1以上の整数で同じ値を更新します.
- `POST /v7/speech-token`は,有効期間600秒のAzure Speech tokenを返します.

`kakomonn-reader`はSpeech tokenを約9分間再利用し,`ja-JP-NanamiNeural`のMP3をAzureから直接取得します.Workerは音声dataを中継せず,Workers AI,Durable Objects,R2も音声処理には使用しません.Azure Speech F0の無料枠を超過した場合は読み上げを停止し,別の音声へ切り替えません.

`stabilityDays`は, 現在の問題catalogに含まれる全cardのFSRS stabilityを合計してから整数へ切り捨てた値です. 未回答問題は0日として扱います. catalogから外れたcardは再登録時に学習状態を復元できるよう保存しますが, `stabilityDays`と次問候補には含めません. catalog置換で`stabilityDays`が変化した場合も, その日の履歴へ新しい値を記録します.

`stabilityDaysDelta`は, 日ごとの`closing_stability_days - opening_stability_days`です. `todayStabilityDaysDelta`は当日の同じ値で, `dailyStabilityDaysDeltaGoal`はこの純増に対する目標です.

解いた問題数はsite内の問題IDの種類数です.同じ問題を複数回解いても累計では1問として数え,日別では同じ日に繰り返しても1問として数えます.別の日に同じ問題を解いた場合は,各日の解いた問題数へ1問ずつ数えます.正答,誤答,スキップはいずれも解答履歴へ含めます.過去に解いた問題は,現在の問題catalogから外れても累計へ含めます.

## 互換性方針

v1からv6のAPIは提供しません. legacy v4 schemaのcard, attempt, catalog, 解答履歴はschema v3へ明示的に移行し, 30日判定の履歴と目標設定は破棄します. schema v2のdataはschema v3へlosslessに移行します. 旧APIへのfallbackや互換routeは追加しません. API契約を破壊的に変更する場合はversionを上げ, clientとserverを同時に更新します.
