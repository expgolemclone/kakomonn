# kakomonn

中小企業診断士試験の過去問学習を支援するユーザースクリプトと関連serviceを管理するリポジトリです.

## Extensions

- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げ・FSRS定着管理・50問ごとの祝福スクリプト.
- [`kakomonn-sync`](kakomonn-sync/README.md): kakomonn-readerの定着状態,解答履歴,目標設定を端末間で共有し,学習logを表示するCloudflare Worker.
- [`congratulations`](congratulations/README.md): kakomonn-readerが50問ごとの到達時に開く,Cloudflareで配信するランダムな静的祝福サイト集.

## テスト

Node.js 22.12以上とPython 3を使用します.

```bash
npm ci
npm run build:kakomonn-reader
```

通常利用するEdge profileは使用しません. 専用のuser data directoryでEdgeを起動し,そのprofileだけにTampermonkeyをinstallして,生成された`kakomonn-reader/kakomonn-reader.user.js`を保存します.

```powershell
$env:KAKOMONN_EDGE_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'kakomonn-edge-e2e'
$edgeExecutable = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
Start-Process -FilePath $edgeExecutable -ArgumentList "--user-data-dir=$env:KAKOMONN_EDGE_USER_DATA_DIR",'edge://inspect/#remote-debugging'
```

専用profileの`edge://inspect/#remote-debugging`でリモートデバッグを有効にします. その後,本番同期Workerのtokenをprocess環境変数へ設定するか,repository rootのignore済み`.env`へ保存して完全testを実行します. process環境変数が設定されている場合は,その値を優先します.

```powershell
$env:KAKOMONN_SYNC_TOKEN='<SYNC_TOKEN>'
npm test
```

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

`npm ci`でPlaywrightと対応するChromiumおよびWebKitもインストールします. `npm test`はlocal testとsmoke testに続けて,実サイトE2Eと,専用profileの実Edge,実Tampermonkey,本番同期Workerを使用するlive E2Eを実行します. live E2Eは実OS clipboardへのMarkdownコピーも検証します. 専用profile,Edgeのリモートデバッグ,本番token,最新buildのいずれかが欠けている場合は失敗し,live E2Eをskipするoptionはありません.
