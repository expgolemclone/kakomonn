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
- [`kakomonn-sync`](kakomonn-sync/README.md): kakomonn-readerの定着状態と解答履歴を端末間で共有し, その日に解くべきcardの完了状況と学習logを表示するCloudflare Worker.
- [`congratulations`](congratulations/README.md): その日に解くべきcardをすべて完了したときに表示する16種類の祝福体験.

## 普段使いのChrome

次のcommandは, `%LOCALAPPDATA%\kakomonn-chrome-e2e` の専用profileでChromeを起動し, iPhoneと同じ固定`/open` URLを開きます. redirect先のuserscriptがTampermonkey専用storageの同期tokenでFSRSに基づく次の問題を取得します. この専用Chrome processでは音声の自動再生を許可し, 画面をクリックせずに最初の問題文から読み上げます. command自体はrepository rootの`.env`にある`KAKOMONN_SYNC_TOKEN`を使用しません. token未設定またはAPI errorの場合は, 起動後の画面で同期設定または再試行を行えます.

```powershell
npm run open:kakomonn
```

Chromeが同じ専用profileで起動済みの場合は, processの起動optionを確認します. 自動再生が許可済みなら既存windowへ新しいtabを追加し, 許可されていなければその専用profileのChromeだけを終了してから起動し直します. 通常利用するChrome profileまたはその配下は指定できません. `npm test`のlive E2Eもこの専用profileの既存Chrome processを終了するため, test前に専用profileでの作業を保存してください.

## iPhone Safari

iPhone Safariでは, 最新の`kakomonn-reader`をTampermonkeyへinstallして同期tokenを保存した後, 次の固定URLをbookmarkまたはshortcutへ設定します. URLを開くと, Tampermonkeyが既に動作する`chushoks.kakomonn.com`へredirectし, 同じuserscript sessionのreader内でFSRSに基づく次の問題を開きます. 同期tokenはURLやpageの`localStorage`へ保存しません.

```text
https://kakomonn-sync.kakomonn.workers.dev/open
```

token未設定または認証失敗の場合は, redirect先で同期設定画面を直接表示してtokenを保存できます. 通信失敗, 問題catalog未同期, 次問なしの場合は, 原因と再試行操作を表示します.

iPhone Safariでも問題文の自動再生を最初に試します. Safariが音声付きmediaの初回再生を拒否した場合は, 画面上の最初のtapで読み上げを開始します.

## テスト

Node.js 22.12以上とPython 3を使用します.

```bash
npm ci
npm run build:kakomonn-reader
```

通常利用するChrome profileはlive E2Eに使用しません. 初回だけ専用のuser data directoryでChromeを起動し, そのprofileへTampermonkeyをinstallして`Allow User Scripts`を有効にしてからChromeを閉じます. userscriptの更新とbrowser操作はtest scriptが行います.

```powershell
$profileDirectory = Join-Path $env:LOCALAPPDATA 'kakomonn-chrome-e2e'
$chromeExecutable = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
Start-Process -FilePath $chromeExecutable -ArgumentList "--user-data-dir=$profileDirectory"
```

`.env.example`を`.env`へcopyし, 専用profileのpathを`KAKOMONN_CHROME_USER_DATA_DIR`へ保存できます. test scriptは`.env`の値だけを読み, 指定されたprofileだけを起動します. process環境変数の`KAKOMONN_*`は参照しません.

本番同期Workerのtokenを同じ`.env`へ保存して完全testを実行します. `.env`でtokenが未設定の場合だけ, test scriptが専用Chrome profileと標準Chrome profileのTampermonkey storageから候補を読み取り, productionで認証できる1種類の値を`.env`へ保存します. `.env`に不正なtokenがある場合は, 自動置換せず失敗します.

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

```powershell
npm test
```

対応する`KAKOMONN_*`設定は`.env.example`に列挙されています. 未対応keyと重複keyは設定errorになります. 空の任意設定は未指定として扱います.

`npm ci`でPlaywrightと対応するChromiumおよびWebKitもインストールします. `npm test`はlocal testとsmoke testに続けて, 実サイトE2Eと, 専用profileの最小化Chrome, 実Tampermonkey, 本番同期Workerを使用するlive E2Eを実行します. test scriptは専用profileのChromeを起動し, Tampermonkeyを`UserScripts API Dynamic`に固定して, 最新userscriptを更新します. その後, 実OS clipboardへのMarkdownコピーまでを検証します. 専用profile, Tampermonkey, 本番token, 最新buildのいずれかが欠けている場合は失敗し, live E2Eをskipするoptionはありません.

## iOS Safari CI

GitHub Actionsはreaderまたは関連test設定が変更されたpull requestと`main`へのpushで, `macos-26`, Xcode 26.6, iPhone 17, iOS 26.5 Simulatorを使用するMobile Safari E2Eを実行します. Appium XCUITestで実際のSafariをnative tapし, SimulatorのpasteboardへMarkdownが書き込まれたことまで検証します. productionの固定問題pageを使用しますが, 同期APIとTampermonkeyの`GM` APIはtest doubleへ置換するため, secretとproductionの学習dataは使用しません.

同じ構成を用意したMacでは, 次のcommandで再実行できます. 指定したXcodeまたはSimulatorがない場合は, 別versionへ切り替えず失敗します.

```bash
npm run test:kakomonn-ios-safari
```

このE2Eはactual Mobile Safariのuserscript動作, layout, 回答, Markdown copy, 次問遷移を対象とします. actual Tampermonkey extension, iPhone実機, production同期, actual音声再生は対象外です.

## Acknowledgements

Repository共通の開発, test, deploymentに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| Cloudflare Workers development and deployment | [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk) |
| Browser automation and E2E testing | [microsoft/playwright](https://github.com/microsoft/playwright) |

## License

このリポジトリは[MIT License](LICENSE)で提供します.
