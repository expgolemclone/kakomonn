# kakomonn-sync

`kakomonn-reader`の当日正解数を端末間で共有するCloudflare Workerです.

## ローカルテスト

リポジトリのルートで実行します.

```bash
npm run test:kakomonn-sync
```

## デプロイ

CloudflareへログインしてWorkerをデプロイします.

```bash
npx wrangler login
npx wrangler secret put SYNC_TOKEN --config kakomonn-sync/wrangler.jsonc
npm run deploy:kakomonn-sync
```

`SYNC_TOKEN`には暗号学的に安全な256ビット以上のランダム値を設定します.デプロイで表示された`workers.dev` URLは`kakomonn-reader`の`SYNC_API_URL`へ設定します.トークンはソースや設定ファイルへ保存しません.

APIは日本時間の当日分だけを保持し,正解数には上限を設けません.同じ操作IDの再送は再加算せず,日付が変わると正解数と操作IDを破棄します.

`GET /v1/count`は`date`,`count`,`milestoneInterval`を返します.`POST /v1/correct`は同じ状態を`state`へ入れ,その操作が50問ごとの区切りへ到達した場合だけ`completedMilestone`へ50,100,150のような値を返します.操作ごとの到達値を保存するため,通信失敗後の再送でも同じ`completedMilestone`を返します.

以前の50問上限付きSQLite schemaは起動時に移行します.既存の日次正解数を維持し,移行前の操作IDは再加算しません.
