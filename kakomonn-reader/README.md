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
- WindowsとiPhoneの起動経路は, [`kakomonn-sync`の次の問題を開く手順](../kakomonn-sync/README.md#次の問題を開く)を使用します. launcherからreaderと問題iframeまでは同じuserscript session内で切り替えます.
- 同期Workerが`celebration`を返すと, primary KPI達成を祝う専用pageへ移動します.
- 問題ページと操作画面を常時dark表示にします.問題文,選択肢,解説,入力欄,link,問題画像,選択肢画像,解説画像を固定selectorで配色し,正誤などの意味色を維持します.
- 問題画面はtopのstatus, KPI, 同期設定を表示せず, 問題iframeを下部操作まで最大化します. 5分の残り時間は問題iframe上端の4px barへ重ねて表示します. KPIはbrowser backでdashboardへ戻って確認します.
- 通常進行のstatusは表示せず, 処理に失敗した場合だけerror内容, context, code, HTTP statusをdialogへ表示します. tokenとresponse bodyは表示しません.
- 問題catalogは固定の`question/no`範囲を持ちません. 24時間ごとに`/createques`と`/list`から年度listを再発見し, 各listの全paginationにある実在の問題IDを同期します. サイトが同じ構造で新年度を追加する限り, コード変更は不要です.
- 解答後に, 問題番号, 問題文, 選択肢, 自分の回答, 画像, 解説をMarkdown形式でクリップボードへコピー. `yy`でもコピーできます.

## ビルド

```bash
python3 build.py
```

`src/`にはmetadataとruntime,correct feedback,style,syncとcatalog,次問launcher,UI,本文抽出,speech,page lifecycle,Markdown copy,navigation,shortcutの責務別sourceがあります.`build.py`の明示manifest順に結合し, `kakomonn-reader.user.js`を生成します. 通常installでは[Latest Release asset](https://github.com/expgolemclone/kakomonn/releases/latest/download/kakomonn-reader.user.js)をTampermonkeyへ登録してください.

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

Windows 11 Chrome + TampermonkeyとiPhone Safari + Tampermonkeyだけに対応します. 両端末ともAzure Speechの`ja-JP-NanamiNeural`を使用し, 短期tokenの取得後はAzureから音声を直接受信します. 同期と問題pageの準備が完了すると, 問題文の自動読み上げを試みます. iPhone Safariが初回の自動再生を拒否した場合は, 最初の画面tapで読み上げを再試行し, 以降の問題は自動で読み上げます. 読み上げにはインターネット接続が必要です.

## 学習記録の同期設定

読み上げに必要なWorkerとAzure Speechは, [`kakomonn-sync`のデプロイ手順](../kakomonn-sync/README.md#デプロイ)で準備します. 生成されたAPI URLを`src/metadata-and-runtime.js`の`SYNC_API_URL`と`@connect`へ設定してビルドします.

同期tokenが未保存または認証失敗の場合だけ, 入力dialogが開きます. Win11とiPhoneへ, Worker Secretの`SYNC_TOKEN`と同じ値を入力してください. tokenは各userscript managerの専用storageへ保存され, 対象siteの`localStorage`には保存されません. 接続済みのreaderには設定buttonを表示しません.

remote stateはreader sessionの開始時に取得します. tabへ戻るたびの再取得は行わず, 同じsessionでの解答後は解答保存responseに含まれる最新指標と次問を使用します. 別端末で行った更新は, readerを再読み込みするか新しいsessionを開始した時に反映します.

正解と不正解のどちらでも,正誤表示時に解答記録を同期します.同期に失敗した場合は次問へ進まず,同じ操作IDで再試行します.通信が復旧した後に`同期を再試行`を押してください.同じ操作の再送は二重加算されません.保存成功後は解説pageへ留まり,`次の問題へ`を押した時だけ保存responseで取得済みの次問へ移動します.

同期Workerが解答responseで`celebration`を返した場合は, readerがそのeventをユーザースクリプトの専用storageへ保存してから祝福pageへ移動します. 移動前にpageを閉じても, 次回起動時に同じeventから再開します.

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
