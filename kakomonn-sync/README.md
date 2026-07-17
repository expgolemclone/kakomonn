# kakomonn-sync

`kakomonn-reader`の正解数を端末間で共有し,日別履歴を週と月のgraphで表示するCloudflare Workerです.

## 学習ログ

productionのWorker rootを開くと,独立した学習ログを表示します.

```text
https://kakomonn-count-sync.expgolem-lab.workers.dev/
```

初回だけ`kakomonn-reader`と同じ同期tokenを入力します.tokenはこのoriginの`localStorage`へ保存されます.初期表示は月曜から日曜の現在週です.月表示,過去期間,期間合計,0問の日を含む1日平均も確認できます.

## ローカルテスト

repository rootで実行します.

```bash
npm run test:kakomonn-sync
npm run test:kakomonn-dashboard
```

## デプロイ

CloudflareへloginしてWorkerをデプロイします.

```bash
npx wrangler login
npx wrangler secret put SYNC_TOKEN --config kakomonn-sync/wrangler.jsonc
npm run deploy:kakomonn-sync
```

`SYNC_TOKEN`には暗号学的に安全な256bit以上のrandom値を設定します.デプロイで表示された`workers.dev` URLは`kakomonn-reader`の`SYNC_API_URL`へ設定します.tokenはsourceや設定fileへ保存しません.

APIは日本時間で日次正解数を保持し,正解数と履歴の保存期間には上限を設けません.同じ操作IDの再送は再加算しません.日付が変わると当日の正解数を履歴へ保存し,操作IDだけを破棄します.履歴追加前の日付は復元せず,deploy時の当日分から記録します.

`GET /v1/count`は`date`,`count`,`milestoneInterval`を返します.`POST /v1/correct`は同じ状態を`state`へ入れ,その操作が50問ごとの区切りへ到達した場合だけ`completedMilestone`へ50,100,150のような値を返します.操作ごとの到達値を保存するため,通信失敗後の再送でも同じ`completedMilestone`を返します.

`GET /v1/history?from=YYYY-MM-DD&to=YYYY-MM-DD`は,両端を含む最大31日の日別正解数を返します.`count: null`は記録開始前または未来日,追跡期間内の欠損日は`count: 0`です.

現行の日次SQLite schemaは起動時に履歴schemaへ移行します.既存の当日正解数と操作IDを維持し,想定外のschemaは起動errorにします.
