# kakomonn

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-00485B?style=flat-square&logo=tampermonkey&logoColor=white)](https://www.tampermonkey.net/)
[![ts-fsrs](https://img.shields.io/badge/ts--fsrs-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/open-spaced-repetition/ts-fsrs)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![License](https://img.shields.io/badge/License-MIT-A31F34?style=flat-square)](LICENSE)

中小企業診断士試験の過去問学習を支援するユーザースクリプトと関連serviceを管理するリポジトリです.

## Extensions

- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げとFSRS定着日数管理スクリプト.
- [`kakomonn-sync`](kakomonn-sync/README.md): kakomonn-readerの定着状態,解答履歴,目標設定を端末間で共有し,学習logを表示するCloudflare Worker.
- [`congratulations`](congratulations/README.md): `todayStabilityDaysDelta`が日次目標へ到達したときに表示する13種類の祝福体験.

## 普段使いのChrome

次のcommandは, production同期WorkerからFSRSに基づく次の問題を取得し, `%LOCALAPPDATA%\kakomonn-chrome-e2e` の専用profileでChromeを起動して, `https://chushoks.kakomonn.com/questions/<questionId>` を開きます. この専用Chrome processでは音声の自動再生を許可し, 画面をクリックせずに最初の問題文から読み上げます. `KAKOMONN_SYNC_TOKEN` はprocess環境変数またはrepository rootのignore済み`.env`へ設定します. token未設定, API error, 不正responseの場合はChromeを起動しません.

```powershell
npm run open:kakomonn
```

Chromeが同じprofileで起動済みの場合は, 既存windowへ新しいtabを追加します. 自動再生を許可せずに起動した古いprocessには新しい起動optionが反映されないため, この変更後の初回だけ同じprofileのChromeを終了してからcommandを実行してください. `npm test`のlive E2Eはこのprofileの既存Chrome processを終了するため, test前に普段使いの作業を保存してください.

## iPhone Safari

iPhone Safariでは, 最新の`kakomonn-reader`をTampermonkeyへinstallして同期tokenを保存した後, 次の固定URLをbookmarkまたはshortcutへ設定します. URLを開くと, Tampermonkeyが既に動作する`chushoks.kakomonn.com`へredirectしてから, FSRSに基づく次の問題へ移動します. 同期tokenはURLやpageの`localStorage`へ保存しません.

```text
https://kakomonn-sync.kakomonn.workers.dev/open
```

token未設定, 認証失敗, 通信失敗, 問題catalog未同期, 次問なしの場合は移動せず, redirect先へ原因と再試行操作を表示します.

## テスト

Node.js 22.12以上とPython 3を使用します.

```bash
npm ci
npm run build:kakomonn-reader
```

通常利用するChrome profileはlive E2Eに使用しません. 初回だけ専用のuser data directoryでChromeを起動し, そのprofileへTampermonkeyをinstallして`Allow User Scripts`を有効にしてからChromeを閉じます. userscriptの更新とbrowser操作はtest scriptが行います.

```powershell
$env:KAKOMONN_CHROME_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'kakomonn-chrome-e2e'
$chromeExecutable = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
Start-Process -FilePath $chromeExecutable -ArgumentList "--user-data-dir=$env:KAKOMONN_CHROME_USER_DATA_DIR"
```

専用profileのpathは, repository rootのignore済み`.env`へ`KAKOMONN_CHROME_USER_DATA_DIR`として保存できます. test scriptはこの値を読み, 指定されたprofileだけを起動します. process環境変数が設定されている場合は, 明示的な上書きとしてその値を優先します.

本番同期Workerのtokenをprocess環境変数へ設定するか, 同じ`.env`へ保存して完全testを実行します. process環境変数が設定されている場合は, その値を優先します. どちらも未設定の場合は, test scriptが専用Chrome profileと標準Chrome profileのTampermonkey storageから候補を読み取り, productionで認証できる1種類の値だけを`.env`へ保存します.

```powershell
$env:KAKOMONN_SYNC_TOKEN='<SYNC_TOKEN>'
npm test
```

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

`npm ci`でPlaywrightと対応するChromiumおよびWebKitもインストールします. `npm test`はlocal testとsmoke testに続けて, 実サイトE2Eと, 専用profileの最小化Chrome, 実Tampermonkey, 本番同期Workerを使用するlive E2Eを実行します. test scriptは専用profileのChromeを起動し, Tampermonkeyを`UserScripts API Dynamic`に固定して, 最新userscriptを更新します. その後, 実OS clipboardへのMarkdownコピーまでを検証します. 専用profile, Tampermonkey, 本番token, 最新buildのいずれかが欠けている場合は失敗し, live E2Eをskipするoptionはありません.

## License

このリポジトリは[MIT License](LICENSE)で提供します.
