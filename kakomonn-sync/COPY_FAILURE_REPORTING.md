# コピー失敗問題の自動収集

ReaderのMarkdown作成または自動clipboard書き込みに失敗しても, 解答同期と次問遷移を続行します. 失敗問題は[Issue #29](https://github.com/expgolemclone/kakomonn/issues/29)の`自動収集ログ`に問題URLと理由だけを追加します. 同一サイトと問題IDは1回だけ記録します. 問題本文, コピー内容, 解答履歴, SYNC_TOKEN, GitHub tokenはIssueへ送信しません.

## 認証の構成: GitHub PATは全ユーザー共通でWorker側に1つだけ

各ユーザーのReaderは既存の同期tokenでCloudflare Workerの`POST /v12/copy-failures`へ報告します. Workerが自身のSecretに保管した**1つの共通GitHub PAT**を使い, 全ユーザーに代わってIssue #29を編集します. 利用者それぞれにGitHubアカウントやPATを用意してもらう必要はありません. GitHub PATをReaderへ配布したり, API応答, browser storage, repository, URLへ露出したりしてはいけません. Readerの同期tokenとGitHub PATは別の認証情報です.

Workerは認証済み`POST /v12/copy-failures`でのみGitHub APIへ接続します. GitHub認証情報はUserscriptにもGitHub repositoryにも保存せず, Cloudflare Worker Secret `GITHUB_COPY_FAILURE_TOKEN`へ設定します. GitHubのfine-grained personal access tokenは`expgolemclone/kakomonn`だけにアクセスさせ, repository permissionの`Issues: Read and write`を付与します. Issue #29を編集できるtokenを使用してください.

WorkerのSecret設定とdeploymentを実行する前に, repository rootのREADMEに記載された完全testとsync deploymentの前提条件を満たしてください. Secretは次のPowerShell commandで対話入力し, terminal履歴や`.env`へ保存しないでください.

```powershell
npx wrangler secret put GITHUB_COPY_FAILURE_TOKEN --config kakomonn-sync/wrangler.jsonc
npm run deploy:kakomonn-sync
```

続いてReaderをreleaseして全端末のUserscriptを最新版へ更新します. `main`へのpushだけでは本番のUserscriptもWorkerも更新されません. 新しいGitHub Secretを設定していない場合, 報告APIは`server_misconfigured`を返し, Readerは学習を継続しますがIssueへの自動追記は実行されません.

`POST /v12/copy-failures`のbodyは`site`, `questionId`, `reason`の3fieldに限定します. `reason`は`markdown_unavailable`, `clipboard_write_failed`, `clipboard_write_timeout`のいずれかです. Issueへの追記が失敗しても解答保存と次問遷移には影響しません. GitHub APIへのアクセスはコピー失敗時のみです.
