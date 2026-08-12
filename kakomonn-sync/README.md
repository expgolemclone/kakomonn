# kakomonn-sync

`kakomonn-reader`のサイト別の定着状態と解答履歴を端末間で共有し,直近7日間の定着日数と日別解答問題数をgraphで表示するCloudflare Workerです. 認証済み端末へAzure Speechの短期tokenも発行します.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-count-sync.expgolem-lab.workers.dev/
```

初回だけ`kakomonn-reader`と同じ同期tokenを入力します.tokenと最後に表示したサイトだけをこのoriginの`localStorage`へ保存します.今日の定着日数純増目標はsiteごとにWorkerへ保存するため,同じ同期tokenを使用する他の端末でも共有されます.旧目標値は単位が異なるため移行せず,各siteを30日で初期化します.

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

APIは`/v5`だけを提供し,StabilityState Durable Objectを唯一のsource of truthとします.

- `GET /v5/sites`は,問題catalogを登録済みのサイト一覧を返します.
- `GET /v5/state?site=<host>`は,定着日数,解いた問題数,今日解いた問題数,今日の定着日数純増,問題catalog情報を返します.
- `GET /v5/history?site=<host>&days=<1-31>`は,日本時間の日別定着日数と解いた問題数を返します.計測開始前の定着日数は`null`です.
- `POST /v5/attempts`は,`site`,`questionId`,`operationId`,`result`を受け取ります.同じ操作の再送は重複記録せず,異なるpayloadで同じ操作IDを使用した場合は拒否します.
- `GET /v5/next`は,FSRSに基づく次の問題を返します.
- `POST /v5/questions`は,siteの問題catalogを世代番号付きで置き換えます.
- `GET /v5/settings?site=<host>`は,site別の`dailyStabilityDaysGoal`を返します.`PUT /v5/settings`は,siteと1以上の整数で同じ値を更新します.
- `POST /v5/speech-token`は,有効期間600秒のAzure Speech tokenを返します.

`kakomonn-reader`はSpeech tokenを約9分間再利用し,`ja-JP-NanamiNeural`のMP3をAzureから直接取得します.Workerは音声dataを中継せず,Workers AI,Durable Objects,R2も音声処理には使用しません.Azure Speech F0の無料枠を超過した場合は読み上げを停止し,別の音声へ切り替えません.

定着日数は,現在の問題catalogに含まれる全cardのFSRS stabilityを合計してから整数へ切り捨てた値です.未回答問題は0日として扱います.catalogから外れたcardは再登録時に学習状態を復元できるよう保存しますが,定着日数と次問候補には含めません.catalog置換で定着日数が変化した場合も,その日の履歴へ新しい値を記録します.

解いた問題数はsite内の問題IDの種類数です.同じ問題を複数回解いても累計では1問として数え,日別では同じ日に繰り返しても1問として数えます.別の日に同じ問題を解いた場合は,各日の解いた問題数へ1問ずつ数えます.正答,誤答,スキップはいずれも解答履歴へ含めます.過去に解いた問題は,現在の問題catalogから外れても累計へ含めます.

## 互換性方針

v1,v2,v3,v4 APIは提供しません.v4 StabilityStateのcard,attempt,catalog,解答履歴はschema v2へ明示的に移行し,30日判定の履歴と目標設定は破棄します.旧APIへのfallbackや互換routeは追加しません.API契約を変更する場合はversionを上げ,clientとserverを同時に更新します.
