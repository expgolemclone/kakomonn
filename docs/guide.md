# 利用と開発

[README](../README.md) / [Reader](../kakomonn-reader/README.md) / [Sync](../kakomonn-sync/README.md)

## 普段使いのChrome

次のcommandは, `%LOCALAPPDATA%\kakomonn-chrome-e2e` の専用profileでChromeを起動し, [`kakomonn-sync`の次問bridge](../kakomonn-sync/README.md#次の問題を開く)を開きます. command自体はrepository rootの`.env`にある`KAKOMONN_SYNC_TOKEN`を使用しません.

```powershell
npm run open:kakomonn
```

Chromeが同じ専用profileで起動済みの場合は, processの起動optionを確認します. 必要なoptionで起動済みなら再起動せず, そうでなければその専用profileのChromeだけを終了して起動し直します. commandは内部でbrowser起動とURL表示を別processとして直列実行し, 1回の実行でChromeを準備した後にTampermonkey Betaを確認して固定`/open`の専用tabを追加します. 起動直後にuserscriptのruntimeまたは通信が一時的に利用できない場合は, 同じtabを30秒以内で再読み込みします. 固定URLをChromeのcold起動引数として渡す経路はありません. 通常利用するChrome profileまたはその配下は指定できません. 完全testもこの専用profileの既存Chrome processを終了するため, test前に専用profileでの作業を保存してください.

Readerで同期tokenを設定すると, 同じbrowser profileのsync dashboardもUserscript専用storageの同じtokenで自動接続します. Dashboardへtokenを再入力する必要はありません.

## iPhone Safari

iPhone Safariの設定と固定URLは, [`kakomonn-sync`の次の問題を開く手順](../kakomonn-sync/README.md#次の問題を開く)を参照してください. Readerの対応環境と再生動作は, [`kakomonn-reader`の動作環境](../kakomonn-reader/README.md#動作環境)に記載しています.

## テスト

Node.js 22.12以上を使用します. rootの単一npm packageがreaderとsyncのbuildとtestを管理します. 共通祝福は独立したcongratulations repositoryが管理します.

Repositoryの変更をpushまたはdeployする前に, このsectionの完全testを通過させます. 以下のcommandはrepository rootで実行します.

```bash
pwsh -NoProfile -File C:/dev/settings/envx/runtimes/manage.ps1 -Operation Install
npm run build
```

通常利用するChrome profileはlive E2Eに使用しません. Windowsでは管理者権限のPowerShell 7で次を実行し, Chromeの公式`ExtensionSettings` machine policyへTampermonkey Beta 5.6以上を追加します. Chrome Web Storeからinstallし, 全Chrome profileへ適用されます. `DeveloperToolsAvailability=1`により, policy管理extensionを含む全contextでDevToolsとCDPを許可します. 開発PC向けのmachine設定であり, 全Chrome profileへ適用されます. 他のextension設定は保持し, 既存policyと競合する場合は変更せず失敗します. UACや外部installerは使用しません. PolicyのtestにはPester 6.2.0を使用します.

```powershell
npm run test:chrome-policy
pwsh -NoProfile -File scripts/provision-chrome.ps1 -Operation Install -WhatIf
pwsh -NoProfile -File scripts/provision-chrome.ps1 -Operation Install
pwsh -NoProfile -File scripts/provision-chrome.ps1 -Operation Verify
```

専用profileのuserscript導入, `Allow User Scripts`の有効化, 更新, cold再起動はlive testが所有します. Browser storageやSecure Preferencesを直接書き換えません.

`.env.example`を`.env`へcopyし, 専用profileのpathを`KAKOMONN_CHROME_USER_DATA_DIR`へ保存できます. `KAKOMONN_CHROME_EXECUTABLE`を省略した場合は`%ProgramFiles%\Google\Chrome\Application\chrome.exe`, profileを省略した場合は`%LOCALAPPDATA%\kakomonn-chrome-e2e`を使用します. 対応keyは[`.env.example`](../.env.example)を正本とし, 未対応keyと重複keyは設定errorになります. 空の任意設定は未指定として扱います. test scriptは`.env`の値だけを読み, process環境変数の`KAKOMONN_*`は参照しません.

本番同期Workerのtokenを同じ`.env`へ保存して完全testを実行します. `.env`でtokenが未設定の場合だけ, test scriptが専用Chrome profileと標準Chrome profileのTampermonkey storageから候補を読み取り, productionで認証できる1種類の値を`.env`へ保存します. `.env`に不正なtokenがある場合は, 自動置換せず失敗します.

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

```powershell
npm test
```

共通環境のinstallでPlaywrightと対応するChromiumおよびWebKitも導入します. repo内のnode_modulesは作成しません. 完全testはlocal testとsmoke testに続けて, 実サイトE2Eと, 専用profileの最小化Chrome, 実Tampermonkey Beta, 本番同期Workerを使用するlive E2Eを実行します. test scriptは専用profileの既存processの終了から起動, userscript更新, test後の終了までを所有し, Tampermonkey Betaを`UserScripts API Dynamic` modeへ設定します. userscript更新と同期token設定後にChromeをcold再起動し, production launcherから本番の固定`/open`を開く解答なしE2Eを実行します. 解答履歴と定着状態を変更せずforegroundの勉強時間だけが記録されることを検証してから, 実Chrome上で解答記録を送信します. 本番の解答履歴と定着状態, 外側URLとiframeの次問遷移, 実OS clipboardへのMarkdownコピーまでを検証します. Tampermonkeyを模した`GM`実装や`force` clickは使用しません. 専用profile, Tampermonkey Beta, 本番token, 最新buildのいずれかが欠けている場合は失敗し, live E2Eをskipまたはforce通過させるoptionはありません. 解答E2Eのremote state検証は, browser cookieを共有しない専用APIRequestContextをscenario全体で所有し, 成否にかかわらず破棄します. 状態取得のtimeoutは15秒で, transport retryとredirectは許可しません.

実サイトE2Eと解答live E2Eは同じ第三者広告filterを使用します. 問題site, 同期Worker, Azure Speechはこのfilterの遮断対象ではありません. 解答live E2Eも本番launcherから起動し, 同期完了を確認してから解答します.

ReaderのTampermonkey metadata, ES2020構文, build fingerprintもこの完全testで検証します. cold起動からのproduction launcherの解答なしE2Eだけを再実行する場合は`npm run test:kakomonn-live-open`, 解答を含むlive E2Eだけを再実行する場合は`npm run test:kakomonn-live-sync`, Chromiumとmobile相当のPlaywright WebKitを使うsmoke testだけを実行する場合は`npm run test:smoke`を使用します. いずれも完全な完了条件の代替にはなりません.

## iOS Safari CI

GitHub Actionsはreaderまたは関連test設定が変更されたpull requestと`main`へのpushで, `macos-26`, Xcode 26.6, iPhone 17, iOS 26.5 Simulatorを使用するMobile Safari E2Eを実行します. Appium XCUITestで実際のSafariをnative tapし, SimulatorのpasteboardへMarkdownが書き込まれたことまで検証します. productionの固定問題pageを使用しますが, 同期APIとTampermonkeyの`GM` APIはtest doubleへ置換するため, secretとproductionの学習dataは使用しません.

同じ構成を用意したMacでは, 次のcommandで再実行できます. 指定したXcodeまたはSimulatorがない場合は, 別versionへ切り替えず失敗します.

```bash
npm run test:kakomonn-ios-safari
```

このE2Eはactual Mobile Safariのuserscript動作, layout, 回答, Markdown copy, 次問遷移を対象とし, `navigator.clipboard`にはactual Safari implementationを使用します. actual Tampermonkey extension, iPhone実機, production同期, actual音声再生は対象外です.

## Release and deployment

単一componentの手順は, [`kakomonn-sync`のデプロイ](../kakomonn-sync/README.md#デプロイ), [共通祝福のdeployment](https://github.com/expgolemclone/congratulations#development-and-testing), [`kakomonn-reader`のrelease](../kakomonn-reader/README.md#release)をそれぞれ正本とします.

sync API, reader, congratulationsを跨ぐ破壊的変更は, 次の順序で完了します.

1. [完全test](#テスト)を通過させます.
2. jjの`main`だけをoriginへpushします.
3. sync Workerをdeployし, 同期serviceのproduction検証を完了します.
4. 共通祝福の変更がある場合は独立repoからdeployし, production検証を完了します.
5. readerをreleaseし, 本番syncを使うlive E2EとGitHub Releaseを完了します.

途中の工程を省略した状態は完了として扱いません.

## Acknowledgements

Repository共通の開発, test, deploymentに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| Cloudflare Workers development and deployment | [cloudflare/workers-sdk](https://github.com/cloudflare/workers-sdk) |
| Browser automation and E2E testing | [microsoft/playwright](https://github.com/microsoft/playwright) |
