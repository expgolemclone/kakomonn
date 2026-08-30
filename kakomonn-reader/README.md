# kakomonn-reader

中小企業診断士試験の過去問ページ向けユーザースクリプトです.

## 機能

- 選択肢を除く問題文と解説の自動連続読み上げ. 回答前は解説を隠し, 読み上げません.
- `n`で現在の問題を誤答として記録して次問へ進み, `Space`で読み上げの一時停止と再開を切り替えます.
- `q,w,e,r,t`で解答用の選択肢1から5を選びます.
- `a,s,d,f,g`で表示選択肢1から5の取り消し線を切り替えます.
- 問題pageを開くたびに, `問題`見出しがpage topへ来る位置まで自動でscrollします. `z`で100px下へ,`x`で100px上へscrollし,`gg`でpage topへ戻ります. 検索欄や計算欄などへ入力中はkeyboard shortcutを無効にします.
- `Enter`は未解答なら解答を実行し,解答後は次問へ進みます. 下部の`次の問題へ`をクリックまたはタップして進むこともできます.
- 正解時は`NORMAL` 88.9%, `RARE` 10%, `SUPER RARE` 1%, `SSR` 0.1%からsecure randomで1種類を選び, tierごとの`That's Right`表示, chime, 英語音声を再生します.
- 正解または不正解が表示された時点で, 解答記録を`kakomonn-sync`へ保存します. 保存responseに含まれる次問を端末へ保持するため, `次の問題へ`の操作では追加のWorker通信を行いません.
- Windowsのopen commandとiPhone Safariは`https://kakomonn-sync.kakomonn.workers.dev/open`を開き, 保存済みの同期tokenでFSRSに基づく次の問題を取得します. launcherからreaderと問題iframeまでは同じuserscript session内で切り替えます. token未設定または認証失敗時は, 同じ画面の同期設定へtokenを保存できます. tokenはURLへ含めません.
- 日本時間の同じ日に, 期限を迎えた全cardの解答と新規問題100問の初回解答を両方完了して`dailyKpiCompleted`が`true`になると, primary KPI達成を祝う専用pageへ移動します. 同じ日の祝福はsiteごとに1回だけです.
- 問題ページと操作画面を常時dark表示にします.問題文,選択肢,解説,入力欄,link,問題画像,選択肢画像,解説画像を固定selectorで配色し,正誤などの意味色を維持します.
- 現在の問題catalogに含まれる全問題のstabilityを合計して切り捨てた定着日数stabilityDaysと解答履歴. 値は`kakomonn-sync`へ保存され, Windows 11 ChromeとiPhone Safariで共有されます. 問題画面では`dueCardsRemaining`と`newQuestionsRemaining`を常時表示し, クリックすると`dailyKpiCompleted`, `dueCardsCompleted`, `todayNewQuestionCount`, `newQuestionGoal`, `todayStabilityDaysDelta`, `todayAttemptedQuestionCount`, `todayCorrectRatePercent`も確認できます. 同期Workerのrootでも同じ指標と, 直近31日間の`dailyNewQuestionCount`と`dailyCorrectRatePercent`を確認できます. 新規問題数はsite内でその問題IDを初めて解答した日に正誤を問わず1問だけ数えます. 解いた問題数は日別では同じ問題を同じ日に繰り返しても1問として数え, 正答率は同じ日の全attemptを分母にするため同じ問題の繰り返しも個別に数えます.
- 問題catalogは固定の`question/no`範囲を持ちません. 24時間ごとに`/createques`と`/list`から年度listを再発見し, 各listの全paginationにある実在の問題IDを同期します. サイトが同じ構造で新年度を追加する限り, コード変更は不要です.
- 解答後に, 問題番号, 問題文, 選択肢, 自分の回答, 画像, 解説をMarkdown形式でクリップボードへコピー. `yy`でもコピーできます.

## ビルド

```bash
python3 build.py
```

`src/`にはmetadataとruntime,correct feedback,style,syncとcatalog,次問launcher,UI,本文抽出,speech,page lifecycle,Markdown copy,navigation,shortcutの責務別sourceがあります.`build.py`の明示manifest順に結合し, `kakomonn-reader.user.js`を生成します. Tampermonkeyへ生成されたファイルを登録してください.

## Release

Windowsローカルから,同期済みの`main`先端をGitHub Releaseへ公開します. Node.js 22.12以上, Python 3, jj, GitHub CLIを用意し, `gh auth login`を完了してください.

変更をjjで`main`へ統合してoriginへpushした後,repository rootで次の1commandを実行します.

```powershell
npm run release:kakomonn-reader
```

このcommandはlockfileどおりに依存関係をinstallし,local test,smoke test,live-site E2E,実Chromeと実Tampermonkeyと本番同期Workerを使うlive E2Eを含む`npm test`をWindowsで実行します. すべての検証後にmainが変わっていないことを再確認し,生成した`kakomonn-reader.user.js`を公開します.

release前の初回準備では, 専用のuser data directoryでChromeを起動し, そのprofileだけにTampermonkeyをinstallして`Allow User Scripts`を有効にしてからChromeを閉じます. test scriptが専用profileのChromeを最小化して起動し, 最新の`kakomonn-reader.user.js`をTampermonkeyへ更新します. 本番Workerの`KAKOMONN_SYNC_TOKEN`はrepository rootの`.env`だけから読みます. 値が未設定の場合は, 専用Chrome profileと標準Chrome profileのTampermonkey storageからproductionで認証できる値を自動取得して`.env`へ保存します. 専用profile, Tampermonkey, token, 最新buildのいずれかが欠けている場合は, releaseを作成せず終了します. 通常利用するChrome user data directoryとその配下はlive E2Eに使用しません.

Releaseのtagは`kakomonn-reader-<commit SHA>`,titleは`kakomonn-reader <先頭12文字のSHA>`です.同期済みの`main`先端だけを`Latest`として公開し,生成fileはrepositoryの差分へ含めません. 作業内容とmainの不一致,localとoriginまたはGitHub上のmainの不一致,local検証の失敗,検証中のmain更新,同一tagの既存Releaseのいずれかを検出した場合は公開せず終了します. 原因を解消して同じcommandを最初から実行してください. skip,force,任意revisionを指定するoptionはありません.

公開されたファイルは[GitHub Releases](https://github.com/expgolemclone/kakomonn/releases)から取得できます.

## 動作環境

Windows 11 Chrome + TampermonkeyとiPhone Safari + Tampermonkeyだけに対応します. 両端末ともAzure Speechの`ja-JP-NanamiNeural`を使用し,短期tokenの取得後はAzureから音声を直接受信します. 同期と問題ページの準備が完了すると, 問題文の自動読み上げを試みます. Windowsのopen commandは専用Chrome processの自動再生optionを確認し, optionなしで起動済みの場合はその専用profileだけを再起動します. iPhone Safariが初回の自動再生を拒否した場合は, 最初の画面tapで読み上げを再試行し, 以降の問題は自動で読み上げます. 読み上げにはインターネット接続が必要です.

## 学習記録の同期設定

読み上げを利用する場合は,先に[`kakomonn-sync`](../kakomonn-sync/README.md)へAzure Speech F0のkeyを設定してCloudflareへデプロイし,生成されたAPI URLを`src/metadata-and-runtime.js`の`SYNC_API_URL`と`@connect`へ設定してビルドします. Speech resourceは,音声endpointと同じ`Japan East`に作成します.

初回起動時に同期トークンの入力画面が開きます.Win11とiPhoneへ,Worker Secretの`SYNC_TOKEN`と同じ値を入力してください.トークンは各ユーザースクリプトマネージャーの専用ストレージへ保存され,対象サイトの`localStorage`には保存されません.

remote stateはreader sessionの開始時に取得します. tabへ戻るたびの再取得は行わず, 同じsessionでの解答後は解答保存responseに含まれる最新指標と次問を使用します. 別端末で行った更新は, readerを再読み込みするか新しいsessionを開始した時に反映します.

WindowsとiPhoneの固定URLは同じユーザースクリプト専用storageからtokenを読みます. token未設定時は固定URLから直接開く同期設定で保存し, 再読込せず次の問題へ進みます.

正解と不正解のどちらでも,正誤表示時に解答記録を同期します.同期に失敗した場合は次問へ進まず,同じ操作IDで再試行します.通信が復旧した後に`同期を再試行`を押してください.同じ操作の再送は二重加算されません.保存成功後は解説pageへ留まり,`次の問題へ`を押した時だけ保存responseで取得済みの次問へ移動します.

同期Workerが解答responseで`celebration`を返した場合は, readerがそのeventをユーザースクリプトの専用storageへ保存してから祝福pageへ移動します. 移動前にpageを閉じても, 次回起動時に同じeventから再開します.

## バージョン管理

ファイル名およびユーザースクリプトのメタデータにはバージョン番号を付けません. 変更履歴はjjで管理します.

## 動作確認

リポジトリのルートで依存関係をインストールし,最新userscriptを生成します.

```bash
npm ci
npm run build:kakomonn-reader
```

通常利用するChrome profileはlive E2Eに使用しません. 初回だけ次のcommandで専用のuser data directoryを指定してChromeを起動し, そのprofileへTampermonkeyをinstallして`Allow User Scripts`を有効にしてからChromeを閉じます. userscriptの保存と更新はtest scriptが行います.

```powershell
$profileDirectory = Join-Path $env:LOCALAPPDATA 'kakomonn-chrome-e2e'
$chromeExecutable = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'
Start-Process -FilePath $chromeExecutable -ArgumentList "--user-data-dir=$profileDirectory"
```

`KAKOMONN_SYNC_TOKEN`はWorkerへ設定したtokenです. `npm test`はTampermonkeyメタデータ, ES2020構文, local smoke test, 実サイトE2Eに続けて, 専用profileの最小化Chrome, 実Tampermonkey, デプロイ済みの同期Workerを一続きで検証します. 最後のE2Eはtest scriptがChromeを起動し, Tampermonkeyを`UserScripts API Dynamic`に固定して, 最新userscriptを更新します. さらに, build fingerprintが生成fileと一致することを確認します. その後, 実Chrome上で解答記録を1件送信し, 問題番号を含むMarkdownが実OS clipboardへ書き込まれたことを確認します. さらに, 本番の解答履歴と定着状態を更新し, 外側URLとiframeが次の問題へ移動することを確認します. Tampermonkeyを模した`GM`実装や`force` clickは使用しません.

repository rootの`.env.example`を`.env`へcopyし, `KAKOMONN_SYNC_TOKEN`を設定してからtestします.

```dotenv
KAKOMONN_SYNC_TOKEN=<SYNC_TOKEN>
```

```powershell
npm test
```

`KAKOMONN_CHROME_USER_DATA_DIR`はrepository rootのignore済み`.env`だけで指定できます. 省略した場合は`%LOCALAPPDATA%\kakomonn-chrome-e2e`を使用します. 通常利用するChrome user data directoryとその配下は使用できません. `KAKOMONN_CHROME_EXECUTABLE`を省略した場合は`%ProgramFiles%\Google\Chrome\Application\chrome.exe`を使用します. process環境変数の`KAKOMONN_*`は参照しません. test scriptが指定された専用profileの既存processを終了し, 最小化Chromeの起動から終了までを所有します.

`npm run test:kakomonn-live-sync`で最後のlive E2Eだけを再実行できますが,build,local test,smoke test,live-site E2Eを含む完全な完了条件は`npm test`です. live-sync E2Eをskipまたはforce通過させるoptionはありません. `npm run test:smoke`には,Chromiumの回帰テストに加えて,Playwright WebKitをiPhone相当のviewportとmobile設定で動かすテストが含まれます.

対応するmacOS, Xcode, iOS Simulatorを用意したローカル環境では, `npm run test:kakomonn-ios-safari`でactual Mobile Safari E2Eを実行できます. Appium XCUITestによるnative tapで回答, Markdown copy, 次問遷移を操作し, copy結果はSimulatorのactual pasteboardから取得します. 同期とTampermonkeyの`GM` APIだけをtest doubleへ置換し, `navigator.clipboard`はactual Safari implementationを使用します. actual Tampermonkey extension, iPhone実機, production同期, actual音声再生はこのtestの対象外です.

## Acknowledgements

`kakomonn-reader`のbuild検証とMobile Safari E2Eに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| Appium automation server | [appium/appium](https://github.com/appium/appium) |
| Appium XCUITest driver | [appium/appium-xcuitest-driver](https://github.com/appium/appium-xcuitest-driver) |
| Generated userscript syntax validation | [yowainwright/es-check](https://github.com/yowainwright/es-check) |
