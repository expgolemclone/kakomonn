# kakomonn-sync

`kakomonn-reader`のサイト別の正解数と解答数を端末間で共有し,日別履歴を週と月のgraphで表示するCloudflare Workerです. 認証済み端末へAzure Speechの短期tokenも発行します.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-count-sync.expgolem-lab.workers.dev/
```

初回だけ`kakomonn-reader`と同じ同期tokenを入力します.tokenと最後に表示したサイトはこのoriginの`localStorage`へ保存されます.サイト選択,週表示,月表示,過去期間,正解数と解答数の期間合計,0問の日を含む1日平均を確認できます.graphは解答数を淡い外側の棒,正解数を濃い内側の棒で表示します.

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

`SYNC_TOKEN`には暗号学的に安全な256bit以上のrandom値を設定します.デプロイで表示された`workers.dev` URLは`kakomonn-reader`の`SYNC_API_URL`へ設定します.tokenとkeyはsourceや設定fileへ保存しません.

APIは日本時間でサイト別の日次正解数と解答数を保持し,履歴の保存期間には上限を設けません.同じサイト,操作ID,結果の再送は再加算せず,同じサイトと操作IDへ異なる結果を送った場合は拒否します.日付が変わると当日の値を履歴へ保存し,そのサイトの操作IDだけを破棄します.

`GET /v3/sites`は記録済みのサイト一覧を返します.`GET /v3/state?site=<host>`は`site`,`date`,`counts.correct`,`counts.answered`,`milestoneInterval`を返します.`POST /v3/answers`は`site`,`date`,`operationId`,`result`を受け取り,同じ状態を`state`へ入れます.`result`は`correct`または`incorrect`です.正解数が50問ごとの区切りへ到達した場合だけ`completedMilestone`へ50,100,150のような値を返します.操作ごとの結果と到達値を保存するため,通信失敗後の再送でも同じ応答になります.

`GET /v3/history?site=<host>&view=week|month&anchor=today|YYYY-MM-DD`は,指定日を含む週または月の日別正解数と解答数を返します.週は月曜日から日曜日です.`anchor=today`ではrequest時の日本時間の日付を一度だけ確定して期間を算出します.`counts`の値が`null`なら記録開始前または未来日,追跡期間内の欠損日は`0`です.

`POST /v3/speech-token`は,有効期間600秒のAzure Speech tokenを返します. `kakomonn-reader`はtokenを約9分間再利用し,`ja-JP-NanamiNeural`のMP3をAzureから直接取得します. Workerは音声dataを中継せず,Workers AI,Durable Objects,R2も音声処理には使用しません. Azure Speech F0の無料枠を超過した場合は読み上げを停止し,別の音声へ切り替えません.

旧SQLite schemaは起動時に新schemaへ移行します.既存の正解数,正解履歴,操作ID,milestoneは`chushoks.kakomonn.com`へ割り当てて維持し,復元できない解答数は`null`にします.移行日は解答数を表示せず,最初のv3 requestを受けた次の日本時間の日付から完全な解答数を記録します.想定外のschemaは起動errorにします.v2 APIは提供しません.
