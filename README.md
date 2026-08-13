# kakomonn

中小企業診断士試験の過去問学習を支援するユーザースクリプトと関連serviceを管理するリポジトリです.

## Extensions

- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げとFSRS定着日数管理スクリプト.
- [`kakomonn-sync`](kakomonn-sync/README.md): kakomonn-readerの定着状態,解答履歴,目標設定を端末間で共有し,学習logを表示するCloudflare Worker.

## テスト

Node.js 22.12以上とPython 3を使用します.

```bash
npm ci
npm run build:kakomonn-reader
```

通常利用するEdge profileはlive E2Eに使用しません. 初回だけ専用のuser data directoryでEdgeを起動し, そのprofileへTampermonkeyをinstallしてからEdgeを閉じます. userscriptの更新とbrowser操作はtest scriptが行います.

```powershell
$env:KAKOMONN_EDGE_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'kakomonn-edge-e2e'
$edgeExecutable = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
Start-Process -FilePath $edgeExecutable -ArgumentList "--user-data-dir=$env:KAKOMONN_EDGE_USER_DATA_DIR"
```

専用profileのpathは, repository rootのignore済み`.env`へ`KAKOMONN_EDGE_USER_DATA_DIR`として保存できます. test scriptはこの値を読み, 指定されたprofileだけを起動します. process環境変数が設定されている場合は, 明示的な上書きとしてその値を優先します.

本番同期Workerのtokenをprocess環境変数へ設定するか, 同じ`.env`へ保存して完全testを実行します. process環境変数が設定されている場合は, その値を優先します. どちらも未設定の場合は, test scriptが指定された専用profile, Edge, ChromeのTampermonkey storageから候補を読み取り, productionで認証できる1種類の値だけを`.env`へ保存します.

```powershell
$env:KAKOMONN_SYNC_TOKEN='<SYNC_TOKEN>'
npm test
```

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

`npm ci`でPlaywrightと対応するChromiumおよびWebKitもインストールします. `npm test`はlocal testとsmoke testに続けて, 実サイトE2Eと, 専用profileの最小化Edge, 実Tampermonkey, 本番同期Workerを使用するlive E2Eを実行します. test scriptは専用profileのEdgeを起動し, Tampermonkeyを`UserScripts API Dynamic`に固定して, 最新userscriptを更新します. その後, 実OS clipboardへのMarkdownコピーまでを検証します. 専用profile, Tampermonkey, 本番token, 最新buildのいずれかが欠けている場合は失敗し, live E2Eをskipするoptionはありません.
