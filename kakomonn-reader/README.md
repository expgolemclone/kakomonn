# kakomonn-reader

中小企業診断士試験の過去問ページ向けユーザースクリプトです.

## 機能

- 問題文と解説の自動連続読み上げ.
- 正解数と解答数の日次累計. 値は`kakomonn-sync`へ保存され,Win11 EdgeとiPhone Safariで共有されます.同期Workerのrootでは正解数を主指標,解答数を参考指標にした週と月の日別推移も確認できます.
- 問題文と解説のクリップボードへのコピー.
- 50,100,150問のように50問進むごとに,ランダムな祝福ページを表示します.祝福ページから今週の学習ログを開き,そこから戻ると準備済みの次の問題を再開します.

## ビルド

```bash
python3 build.py
```

`src/part-*.js`を順番に結合し, `kakomonn-reader.user.js`を生成します. Tampermonkeyなどのユーザースクリプトマネージャーには, 生成されたファイルを登録してください.

## Release

Windowsローカルから,同期済みの`main`先端をGitHub Releaseへ公開します. Node.js 22.12以上, Python 3, jj, GitHub CLIを用意し, `gh auth login`を完了してください. iOS Safari検証にGitHub-hosted macOS runnerを使うため, GitHub ActionsのBillingとspending limitもrunnerを起動できる状態にします.

変更をjjで`main`へ統合してoriginへpushした後,repository rootで次の1commandを実行します.

```powershell
npm run release:kakomonn-reader
```

このcommandはlockfileどおりに依存関係をinstallし, `npm test`, smoke test, live-site E2EをWindowsで実行します. 続いて対象commit SHAをGitHub Actionsへ渡し, macOS上のiOS 26 SimulatorでMobile Safari E2Eが成功するまで待ちます. すべての検証後にmainが変わっていないことを再確認し,生成した`kakomonn-reader.user.js`を公開します.

Releaseのtagは`kakomonn-reader-<commit SHA>`,titleは`kakomonn-reader <先頭12文字のSHA>`です.同期済みの`main`先端だけを`Latest`として公開し,生成fileはrepositoryの差分へ含めません. 作業内容とmainの不一致,localとoriginまたはGitHub上のmainの不一致,iOS検証の失敗,Billingによるrunner拒否,検証中のmain更新,同一tagの既存Releaseのいずれかを検出した場合は公開せず終了します. 原因を解消して同じcommandを最初から実行してください. skip,force,任意revisionを指定するoptionはありません.

公開されたファイルは[GitHub Releases](https://github.com/expgolemclone/browser-extensions/releases)から取得できます.

## 動作環境

iOS SafariのUserscriptsとMicrosoft EdgeのTampermonkeyに対応します. 両端末ともAzure Speechの`ja-JP-NanamiNeural`を使用し,短期tokenの取得後はAzureから音声を直接受信します. Windows Edgeでは同期と問題ページの準備が完了すると自動で読み上げを開始します. ブラウザが自動再生を拒否した場合とiOSでは,準備完了後の最初の画面クリックまたはタップで読み上げを開始し,以降の問題は自動で読み上げます. 読み上げにはインターネット接続が必要です.

## 学習記録の同期設定

読み上げを利用する場合は,先に[`kakomonn-sync`](../kakomonn-sync/README.md)へAzure Speech F0のkeyを設定してCloudflareへデプロイし,生成されたAPI URLを`src/part-00.js`の`SYNC_API_URL`と`@connect`へ設定してビルドします. Speech resourceは,音声endpointと同じ`Japan East`に作成します.

初回起動時に同期トークンの入力画面が開きます.Win11とiPhoneへ,Worker Secretの`SYNC_TOKEN`と同じ値を入力してください.トークンは各ユーザースクリプトマネージャーの専用ストレージへ保存され,対象サイトの`localStorage`には保存されません.

正解と不正解のどちらでも,解答記録の同期に失敗した場合は次問へ進まず,同じ操作IDで再試行します.通信が復旧した後に`同期を再試行`を押してください.同じ操作の再送は二重加算されません.

祝福は,正解数が50問の区切りへ到達した操作を送信した端末だけに表示されます.別端末が同期によって50,100,150問を観測しただけでは表示されません.祝福サイトはCloudflare Workers Static Assetsへ公開した`CONGRATULATIONS_URL`を使用します.

## バージョン管理

ファイル名およびユーザースクリプトのメタデータにはバージョン番号を付けません. 変更履歴はjjで管理します.

## 動作確認

リポジトリのルートで依存関係をインストールし, TampermonkeyメタデータとES2020構文を検証します.

```bash
npm ci
npm test
npm run test:smoke
```

実サイト, 実Tampermonkey, デプロイ済みの同期Workerを一続きで確認する場合は, Edgeへ最新の`kakomonn-reader.user.js`を保存し, `edge://inspect/#remote-debugging`でリモートデバッグを有効にしてから次のcommandを実行します. `KAKOMONN_SYNC_TOKEN`はWorkerへ設定したtokenです. このE2EはEdgeの通常clickで正解を1件送信し, 本番の正解数と解答数を1件ずつ増やし, 外側URLとiframeが次の問題へ移動することを確認します. Tampermonkeyを模した`GM`実装や`force` clickは使用しません.

```powershell
$env:KAKOMONN_SYNC_TOKEN='<SYNC_TOKEN>'
npm run test:kakomonn-live-sync
```

Edgeのuser data directoryを標準path以外に置いている場合だけ, `KAKOMONN_EDGE_USER_DATA_DIR`へそのdirectoryを設定します. 初回接続時にEdgeがリモートデバッグの承認を表示した場合は,許可します.

`npm run test:smoke`には,Chromiumの回帰テストに加えて,Playwright WebKitをiPhone相当のviewportとmobile設定で動かすテストが含まれます. Playwright WebKitはSafariそのものではないため,release commandはWindowsで代替できない検証だけをGitHub Actionsへ委譲します. 指定commitをmacOS上でbuildし,iOS 26 SimulatorとAppium XCUITest driverでMobile Safariのfixture E2Eと実サイトE2Eを実行します. このtestは,ネイティブ座標tapが信頼済みのtouch `pointerup`を発生させること,解答記録を同期すること,iframeとbrowser URLが次問へ移動することを検証します. 失敗時は固定buttonの状態,次問候補,iframe URL,screenshot,AppiumとXCUITestの診断logをartifactへ保存し,Releaseは作成しません.
