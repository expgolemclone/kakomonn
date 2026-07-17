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

APIは日本時間の当日分だけを保持します.同じ操作IDの再送は再加算せず,日付が変わると正解数と操作IDを破棄します.
