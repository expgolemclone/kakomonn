- E2Eテストを通過してからpush/deployすること.
- dashboardとreaderでは, `dueCardsCompleted`だけをprimary KPIとし, stabilityと解いた問題数は表示だけにすること.

- Cloudflare Workers Static Assetsで配信できる静的fileはWorkerを起動せず, 動的APIだけをWorkerへ通すこと.
- 本番のobservability, 永続log, traceは無効にし, 障害調査時だけreal-time tailを使うこと.
- 1回のuser操作を原則1回のWorker requestと1回のDurable Object RPCで処理し, pollingと不要なCronを使わないこと.
- Durable ObjectのSQLはindexを使うpoint queryまたは範囲queryと日次集計rowを使い, requestごとのcatalogとattemptsの全scanを行わないこと.
- index自体もwrite数と保存容量を消費するため, 実際のqueryに必要な最小限だけを作ること.
