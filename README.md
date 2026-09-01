# kakomonn

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflareworkers&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-00485B?style=flat-square&logo=tampermonkey&logoColor=white)](https://www.tampermonkey.net/)
[![ts-fsrs](https://img.shields.io/badge/ts--fsrs-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://github.com/open-spaced-repetition/ts-fsrs)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vite.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=flat-square&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=flat-square&logo=playwright&logoColor=white)](https://playwright.dev/)
[![License](https://img.shields.io/badge/License-MIT-A31F34?style=flat-square)](LICENSE)

中小企業診断士試験の過去問学習を支援するユーザースクリプトと関連serviceを管理するリポジトリです.

## Documents

- [`kakomonn-reader`](kakomonn-reader/README.md)
- [`kakomonn-sync`](kakomonn-sync/README.md)
- [`congratulations`](congratulations/README.md)

## 普段使いのChrome

次のcommandは, `%LOCALAPPDATA%\kakomonn-chrome-e2e` の専用profileでChromeを起動し, [`kakomonn-sync`の次問launcher](kakomonn-sync/README.md#次の問題を開く)を開きます. command自体はrepository rootの`.env`にある`KAKOMONN_SYNC_TOKEN`を使用しません.

```powershell
npm run open:kakomonn
```

Chromeが同じ専用profileで起動済みの場合は, processの起動optionを確認します. 必要なoptionで起動済みなら既存windowへ新しいtabを追加し, そうでなければその専用profileのChromeだけを終了します. 停止中の専用profileはwindowなしで初期化してから固定URLを開きます. 通常利用するChrome profileまたはその配下は指定できません. 完全testもこの専用profileの既存Chrome processを終了するため, test前に専用profileでの作業を保存してください.

## iPhone Safari

iPhone Safariの設定と固定URLは, [`kakomonn-sync`の次の問題を開く手順](kakomonn-sync/README.md#次の問題を開く)を参照してください. Readerの対応環境と再生動作は, [`kakomonn-reader`の動作環境](kakomonn-reader/README.md#動作環境)に記載しています.

## テスト

Node.js 22.12以上とPython 3を使用します.

Repositoryの変更をpushまたはdeployする前に, このsectionの完全testを通過させます.

```bash
npm ci
npm run build:kakomonn-reader
```

通常利用するChrome profileはlive E2Eに使用しません. 初回だけ専用のuser data directoryでChromeを起動し, そのprofileへTampermonkeyと`kakomonn-reader`を1件ずつinstallして`Allow User Scripts`を有効にしてからChromeを閉じます. userscriptの更新とbrowser操作はtest scriptが行います.

```powershell
$profileDirectory = Join-Path $env:LOCALAPPDATA 'kakomonn-chrome-e2e'
$chromeExecutable = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
Start-Process -FilePath $chromeExecutable -ArgumentList "--user-data-dir=$profileDirectory"
```

`.env.example`を`.env`へcopyし, 専用profileのpathを`KAKOMONN_CHROME_USER_DATA_DIR`へ保存できます. `KAKOMONN_CHROME_EXECUTABLE`を省略した場合は`%ProgramFiles%\Google\Chrome\Application\chrome.exe`, profileを省略した場合は`%LOCALAPPDATA%\kakomonn-chrome-e2e`を使用します. 対応keyは`.env.example`を正本とし, 未対応keyと重複keyは設定errorになります. 空の任意設定は未指定として扱います. test scriptは`.env`の値だけを読み, process環境変数の`KAKOMONN_*`は参照しません.

本番同期Workerのtokenを同じ`.env`へ保存して完全testを実行します. `.env`でtokenが未設定の場合だけ, test scriptが専用Chrome profileと標準Chrome profileのTampermonkey storageから候補を読み取り, productionで認証できる1種類の値を`.env`へ保存します. `.env`に不正なtokenがある場合は, 自動置換せず失敗します.

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

```powershell
npm test
```

上記のinstallでPlaywrightと対応するChromiumおよびWebKitも導入します. 完全testはlocal testとsmoke testに続けて, 実サイトE2Eと, 専用profileの最小化Chrome, 実Tampermonkey, 本番同期Workerを使用するlive E2Eを実行します. test scriptは専用profileの既存processの終了から起動, userscript更新, test後の終了までを所有し, Tampermonkeyを`UserScripts API Dynamic`に固定します. 実Chrome上で解答記録を送信し, 本番の解答履歴と定着状態, 外側URLとiframeの次問遷移, 実OS clipboardへのMarkdownコピーまでを検証します. Tampermonkeyを模した`GM`実装や`force` clickは使用しません. 専用profile, Tampermonkey, 本番token, 最新buildのいずれかが欠けている場合は失敗し, live E2Eをskipまたはforce通過させるoptionはありません.

ReaderのTampermonkey metadata, ES2020構文, build fingerprintもこの完全testで検証します. 最後のlive E2Eだけを再実行する場合は`npm run test:kakomonn-live-sync`, Chromiumとmobile相当のPlaywright WebKitを使うsmoke testだけを実行する場合は`npm run test:smoke`を使用します. どちらも完全な完了条件の代替にはなりません.

## iOS Safari CI

GitHub Actionsはreaderまたは関連test設定が変更されたpull requestと`main`へのpushで, `macos-26`, Xcode 26.6, iPhone 17, iOS 26.5 Simulatorを使用するMobile Safari E2Eを実行します. Appium XCUITestで実際のSafariをnative tapし, SimulatorのpasteboardへMarkdownが書き込まれたことまで検証します. productionの固定問題pageを使用しますが, 同期APIとTampermonkeyの`GM` APIはtest doubleへ置換するため, secretとproductionの学習dataは使用しません.

同じ構成を用意したMacでは, 次のcommandで再実行できます. 指定したXcodeまたはSimulatorがない場合は, 別versionへ切り替えず失敗します.

```bash
npm run test:kakomonn-ios-safari
```

このE2Eはactual Mobile Safariのuserscript動作, layout, 回答, Markdown copy, 次問遷移を対象とし, `navigator.clipboard`にはactual Safari implementationを使用します. actual Tampermonkey extension, iPhone実機, production同期, actual音声再生は対象外です.

## Release and deployment

単一componentの手順は, [`kakomonn-sync`のデプロイ](kakomonn-sync/README.md#デプロイ), [`congratulations`のdeployment](congratulations/README.md#development-and-testing), [`kakomonn-reader`のrelease](kakomonn-reader/README.md#release)をそれぞれ正本とします.

sync API, reader, congratulationsを跨ぐ破壊的変更は, 次の順序で完了します.

1. このREADMEの完全testを通過させます.
2. jjの`main`だけをoriginへpushします.
3. sync Workerをdeployし, 同期serviceのproduction検証を完了します.
4. congratulations Workerをdeployし, 祝福serviceのproduction検証を完了します.
5. readerをreleaseし, 本番syncを使うlive E2EとGitHub Releaseを完了します.

途中の工程を省略した状態は完了として扱いません.

## Acknowledgements

Repository共通の開発, test, deploymentに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| Cloudflare Workers development and deployment | [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk) |
| Browser automation and E2E testing | [microsoft/playwright](https://github.com/microsoft/playwright) |

## License

このリポジトリは[MIT License](LICENSE)で提供します.
