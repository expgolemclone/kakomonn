# browser-extensions

個人用のブラウザ拡張機能とユーザースクリプトを管理するリポジトリです.

## Extensions

- [`chatgpt-initial-prompt`](chatgpt-initial-prompt/README.md): ChatGPTの新しい会話へ学習支援用プロンプトを1回だけ入力するスクリプト.
- [`gai`](gai/README.md): GAI明電福朗向けのモデル, Thinking, Effort, システムプロンプト自動設定スクリプト.
- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げ・日次累計・50問ごとの祝福スクリプト.
- [`kakomonn-sync`](kakomonn-sync/README.md): kakomonn-readerの正解数と解答数を端末間で共有し,週と月の学習ログを表示するCloudflare Worker.
- [`congratulations`](congratulations/README.md): kakomonn-readerが50問ごとの到達時に開く,Cloudflareで配信するランダムな静的祝福サイト集.

## テスト

Node.js 22.12以上とPython 3を使用します.

```bash
npm ci
npm ci --prefix congratulations
npm run build:kakomonn-reader
```

通常利用するEdge profileは使用しません. 専用のuser data directoryでEdgeを起動し,そのprofileだけにTampermonkeyをinstallして,生成された`kakomonn-reader/kakomonn-reader.user.js`を保存します.

```powershell
$env:KAKOMONN_EDGE_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'kakomonn-edge-e2e'
$edgeExecutable = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
Start-Process -FilePath $edgeExecutable -ArgumentList "--user-data-dir=$env:KAKOMONN_EDGE_USER_DATA_DIR",'edge://inspect/#remote-debugging'
```

専用profileの`edge://inspect/#remote-debugging`でリモートデバッグを有効にします. その後,本番同期Workerのtokenを設定して完全testを実行します.

```powershell
$env:KAKOMONN_SYNC_TOKEN='<SYNC_TOKEN>'
npm test
```

`npm ci`でPlaywrightと対応するChromiumおよびWebKitもインストールします. `npm test`はlocal testとsmoke testに続けて,実サイトE2Eと,専用profileの実Edge,実Tampermonkey,本番同期Workerを使用するlive E2Eを実行します. live E2Eは実OS clipboardへのMarkdownコピーも検証します. 専用profile,Edgeのリモートデバッグ,本番token,最新buildのいずれかが欠けている場合は失敗し,live E2Eをskipするoptionはありません.
