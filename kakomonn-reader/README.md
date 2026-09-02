# kakomonn-reader

中小企業診断士試験の過去問ページ向けユーザースクリプトです.

## 機能

- 選択肢を除く問題文と解説の自動連続読み上げ. 回答前は解説を隠し, 読み上げません.
- `n`で現在の問題を誤答として記録して次問へ進み, `Space`で読み上げの一時停止と再開を切り替え, `Shift+H`でBrowser backを実行します.
- `q,w,e,r,t`で解答用の選択肢1から5を選びます.
- `a,s,d,f,g`で表示選択肢1から5の取り消し線を切り替えます.
- 問題pageを開くたびに, `問題`見出しがpage topへ来る位置まで自動でscrollします. `z`で100px下へ,`x`で100px上へscrollし,`gg`でpage topへ戻ります. 検索欄や計算欄などへ入力中はkeyboard shortcutを無効にします.
- 正解時は`NORMAL` 88.9%, `RARE` 10%, `SUPER RARE` 1%, `SSR` 0.1%からsecure randomで1種類を選び, tierごとの`That's Right`表示, chime, 同梱した英語音声を再生します. 続けて解答保存responseの`dueCardsRemaining + newQuestionsRemaining`を数字だけで読み上げます. 不正解の定型音声は同梱assetだけを使用します.
- WindowsとiPhoneの起動経路は, [`kakomonn-sync`の次の問題を開く手順](../kakomonn-sync/README.md#次の問題を開く)を使用します. bridgeからreaderと問題iframeまでは同じuserscript session内で切り替えます.
- 解答操作と解答後の処理は[学習記録の同期設定](#学習記録の同期設定)を参照してください.
- 問題ページと操作画面を常時dark表示にします.問題文,選択肢,解説,入力欄,link,問題画像,選択肢画像,解説画像を固定selectorで配色し,正誤などの意味色を維持します.
- 問題画面はtopのstatus, KPI, 同期設定, copy button, 次問buttonを表示せず, 問題iframeを画面全体へ広げます. 5分の残り時間は問題iframe上端の4px barへ重ねて表示します.
- 通常進行のstatusは表示せず, 処理に失敗した場合だけerror内容, context, code, HTTP statusをdialogへ表示します. tokenとresponse bodyは表示しません.
- 問題catalogは固定の`question/no`範囲を持ちません. 24時間ごとに`/createques`と`/list`から年度listを再発見し, 各listの全paginationにある実在の問題IDを1回取得します. 取得後はlist集合と各listの先頭, 末尾pageを再取得して件数と境界IDを検証してから同期します. サイトが同じ構造で新年度を追加する限り, コード変更は不要です.

## ビルド

```bash
python3 build.py
```

`src/`にはmetadataとruntime,correct feedback,style,syncとcatalog,次問launcher,UI,本文抽出,speech,page lifecycle,Markdown copy,navigation,shortcutの責務別sourceがあります.`build.py`の明示manifest順に結合し, `assets/feedback/`の5音声をbase64 data URLとして埋め込み, 全sourceと音声を含むfingerprintを付けて`kakomonn-reader.user.js`を生成します. 通常installでは[Latest Release asset](https://github.com/expgolemclone/kakomonn/releases/latest/download/kakomonn-reader.user.js)をTampermonkeyへ登録してください.

## Release

Windowsローカルから,同期済みの`main`先端をGitHub Releaseへ公開します. [repositoryのtest要件](../README.md#テスト)に加えてjjとGitHub CLIを用意し, `gh auth login`を完了してください.

変更をjjで`main`へ統合してoriginへpushした後,repository rootで次の1commandを実行します.

```powershell
npm run release:kakomonn-reader
```

このcommandはlockfileどおりに依存関係をinstallし, [repositoryの完全test](../README.md#テスト)をWindowsで実行します. すべての検証後にmainが変わっていないことを再確認し, 生成した`kakomonn-reader.user.js`を公開します.

release用のChrome profile, Tampermonkey, `.env`は, [完全testと同じ手順](../README.md#テスト)で準備します.

Releaseのtagは`kakomonn-reader-v<version>`,titleは`kakomonn-reader v<version>`です. `@version`はSemVerで手動更新し, 同期済みの`main`先端だけを`Latest`として公開します. 生成fileはrepositoryの差分へ含めません. 作業内容とmainの不一致,localとoriginまたはGitHub上のmainの不一致,local検証の失敗,検証中のmain更新,同一tagの既存Releaseのいずれかを検出した場合は公開せず終了します. 原因を解消して同じcommandを最初から実行してください. skip,force,任意revisionを指定するoptionはありません.

公開されたファイルは[GitHub Releases](https://github.com/expgolemclone/kakomonn/releases)から取得できます.

## 動作環境

Windows 11 Chrome + Tampermonkey Beta 5.6以上の`UserScripts API Dynamic` modeとiPhone Safari + Tampermonkeyだけに対応します. Windows launcherはcold Chromeでは`about:blank`だけを開き, 起動済みChromeから再実行した場合だけ固定`/open`へ遷移します. 両端末とも問題文と解説にはAzure Speechの`ja-JP-NanamiNeural`を使用し, 短期tokenの取得後はAzureから音声を直接受信します. 長文では現在のchunk再生開始時に次の1chunkを先読みします. 同期と問題pageの準備が完了すると, 問題文の自動読み上げを試みます. iPhone Safariが初回の自動再生を拒否した場合は, 最初の画面tapで読み上げを再試行し, 以降の問題は自動で読み上げます. 問題文と解説の読み上げにはインターネット接続が必要です.

## 学習記録の同期設定

読み上げに必要なWorkerとAzure Speechは, [`kakomonn-sync`のデプロイ手順](../kakomonn-sync/README.md#デプロイ)で準備します. 生成されたAPI URLを`src/metadata-and-runtime.js`の`SYNC_API_URL`と`@connect`へ設定してビルドします.

同期tokenが未保存または認証失敗の場合だけ, 入力dialogが開きます. Win11とiPhoneへ, Worker Secretの`SYNC_TOKEN`と同じ値を入力してください. tokenは各userscript managerの専用storageへ保存され, 対象siteの`localStorage`には保存されません. 接続済みのreaderには設定buttonを表示しません.

remote stateはreader sessionの開始時に取得します. tabへ戻るたびの再取得は行わず, 同じsessionでの解答後は解答保存responseに含まれる最新指標と次問を使用します. 別端末で行った更新は, readerを再読み込みするか新しいsessionを開始した時に反映します.

未解答時の`Enter`は解答を実行します. 正解と不正解のどちらでも, 正誤表示時に解答記録を同期し, 問題番号, 問題文, 選択肢, 自分の回答, 画像, 解説をMarkdown形式でclipboardへ自動copyします. `n`または問題時間切れによるskipではcopyしません. 同期またはcopyに失敗した場合は同じ解説pageへ留まり, error dialogの`同期を再試行`または`コピーを再試行`から再開します. 同じ操作の再送は二重加算されません. 同期とcopyの成功後, 正解時は保存responseで取得済みの次問へ自動で移動します. 不正解時の`Enter`は次問への移動を予約し, 同期またはcopyの処理中に押した場合も処理完了後に移動します. Browser forwardでも移動できます. どの遷移も追加のWorker通信は行いません. 解説時間切れでは移動しません. Browser backまたは`Shift+H`では解答済みのReader履歴を飛ばしてdashboardへ戻り, dashboardからBrowser forwardすると最新の問題へ復帰します.

同期Workerが解答responseで`celebration`を返した場合は, readerがそのeventをUserscript専用storageへ保存します. 同期とcopyの成功後, 正解時は正解feedbackの完了後に祝福pageへ自動で移動し, 不正解時は前段と同じ`Enter`またはBrowser forwardで移動します. 移動前にpageを閉じても, 次回起動時に同じeventから再開します.

## バージョン管理

userscript metadataの`@version`をSemVerで管理します. TampermonkeyはLatest Release assetの`@version`を比較し, 新しいversionを自動更新します. 変更履歴はjjで管理します.

## 動作確認

[repository rootのテスト手順](../README.md#テスト)を正本とします. Actual Mobile Safari E2Eの環境と実行方法は, [iOS Safari CI](../README.md#ios-safari-ci)に記載しています.

## Acknowledgements

`kakomonn-reader`のbuild検証とMobile Safari E2Eに次のopen-source projectを使用しています.

| Purpose | Source repository |
| --- | --- |
| Appium automation server | [appium/appium](https://github.com/appium/appium) |
| Appium XCUITest driver | [appium/appium-xcuitest-driver](https://github.com/appium/appium-xcuitest-driver) |
| Generated userscript syntax validation | [yowainwright/es-check](https://github.com/yowainwright/es-check) |
