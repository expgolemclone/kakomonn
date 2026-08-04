# kakomonn-reader

中小企業診断士試験の過去問ページ向けユーザースクリプトです.

## 機能

- 問題文と解説の自動連続読み上げ.
- 数字keyの`1`から`9`,`0`で解答用の選択肢1から10を選び,Spaceで「解答する」を実行します.
- `q,w,e,r,t,y,u,i,o,p`で表示選択肢1から10の取り消し線を切り替えます.
- `j`で100px下へ,`k`で100px上へscrollします. 検索欄や計算欄などへ入力中はkeyboard shortcutを無効にします.
- 解答後は,下部の「次の問題へ」をクリックまたはタップするか,Enterキーを押すと次問へ進みます.
- 問題ページと操作画面を常時dark表示にします.問題文,選択肢,解説,入力欄,link,問題画像,選択肢画像,解説画像を固定selectorで配色し,正誤などの意味色を維持します.
- 正解数と解答数の日次累計. 値は`kakomonn-sync`へ保存され,Win11 EdgeとiPhone Safariで共有されます.同期Workerのrootでは正解数を主指標,解答数を参考指標にした週と月の日別推移も確認できます.
- 解答後に, 問題番号, 問題文, 選択肢, 自分の回答, 画像, 解説をMarkdown形式でクリップボードへコピー. `yy`でもコピーできます. 単発の`y`は400ms後に従来どおり表示選択肢6の取り消し線を切り替えます.
- 50,100,150問のように50問進むごとに,ランダムな祝福ページを表示します.祝福ページから今週の学習ログを開き,そこから戻ると準備済みの次の問題を再開します.

## ビルド

```bash
python3 build.py
```

`src/part-*.js`を順番に結合し, `kakomonn-reader.user.js`を生成します. Tampermonkeyなどのユーザースクリプトマネージャーには, 生成されたファイルを登録してください.

## Release

Windowsローカルから,同期済みの`main`先端をGitHub Releaseへ公開します. Node.js 22.12以上, Python 3, jj, GitHub CLIを用意し, `gh auth login`を完了してください.

変更をjjで`main`へ統合してoriginへpushした後,repository rootで次の1commandを実行します.

```powershell
npm run release:kakomonn-reader
```

このcommandはlockfileどおりに依存関係をinstallし,local test,smoke test,live-site E2E,実Edgeと実Tampermonkeyと本番同期Workerを使うlive E2Eを含む`npm test`をWindowsで実行します. すべての検証後にmainが変わっていないことを再確認し,生成した`kakomonn-reader.user.js`を公開します.

release前に専用のuser data directoryでEdgeを起動し,そのprofileだけにTampermonkeyをinstallします. 最新の`kakomonn-reader.user.js`を保存し, `edge://inspect/#remote-debugging`でリモートデバッグを有効にして, `KAKOMONN_SYNC_TOKEN`へ本番Workerのtokenを設定します. 専用profileを示す`KAKOMONN_EDGE_USER_DATA_DIR`を含め,いずれかが欠けている場合やTampermonkeyへ保存したbuildがmainと一致しない場合は,releaseを作成せず終了します. 通常利用するEdge user data directoryとその配下は拒否します.

Releaseのtagは`kakomonn-reader-<commit SHA>`,titleは`kakomonn-reader <先頭12文字のSHA>`です.同期済みの`main`先端だけを`Latest`として公開し,生成fileはrepositoryの差分へ含めません. 作業内容とmainの不一致,localとoriginまたはGitHub上のmainの不一致,local検証の失敗,検証中のmain更新,同一tagの既存Releaseのいずれかを検出した場合は公開せず終了します. 原因を解消して同じcommandを最初から実行してください. skip,force,任意revisionを指定するoptionはありません.

公開されたファイルは[GitHub Releases](https://github.com/expgolemclone/kakomonn/releases)から取得できます.

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

リポジトリのルートで依存関係をインストールし,最新userscriptを生成します.

```bash
npm ci
npm ci --prefix congratulations
npm run build:kakomonn-reader
```

通常利用するEdge profileは使用しません. 次のcommandで専用のuser data directoryを指定してEdgeを起動し,そのprofileだけにTampermonkeyをinstallして,生成された`kakomonn-reader.user.js`を保存します.

```powershell
$env:KAKOMONN_EDGE_USER_DATA_DIR = Join-Path $env:LOCALAPPDATA 'kakomonn-edge-e2e'
$edgeExecutable = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
Start-Process -FilePath $edgeExecutable -ArgumentList "--user-data-dir=$env:KAKOMONN_EDGE_USER_DATA_DIR",'edge://inspect/#remote-debugging'
```

専用profileの`edge://inspect/#remote-debugging`でリモートデバッグを有効にしてから次の完全testを実行します. `KAKOMONN_SYNC_TOKEN`はWorkerへ設定したtokenです. `npm test`はTampermonkeyメタデータ,ES2020構文,local smoke test,実サイトE2Eに続けて,専用profileの実Edge,実Tampermonkey,デプロイ済みの同期Workerを一続きで検証します. 最後のE2Eは専用Edgeに表示されるリモートデバッグの「許可」をWindows UI Automationで自動操作し,Tampermonkeyへ保存されたbuild fingerprintが生成fileと一致することを確認してから,Edgeの通常clickで正解を1件送信し,問題番号を含むMarkdownが実OS clipboardへ書き込まれたことを確認します. さらに,本番の正解数と解答数を1件ずつ増やし,外側URLとiframeが次の問題へ移動することを確認します. Tampermonkeyを模した`GM`実装や`force` clickは使用しません.

```powershell
$env:KAKOMONN_SYNC_TOKEN='<SYNC_TOKEN>'
npm test
```

`KAKOMONN_EDGE_USER_DATA_DIR`は必須です. 通常利用するEdge user data directoryとその配下は使用できません. 接続時に専用profileのEdgeが表示するリモートデバッグの承認は,testが「許可」を自動操作します.

`npm run test:kakomonn-live-sync`で最後のlive E2Eだけを再実行できますが,build,local test,smoke test,live-site E2Eを含む完全な完了条件は`npm test`です. live-sync E2Eをskipまたはforce通過させるoptionはありません. `npm run test:smoke`には,Chromiumの回帰テストに加えて,Playwright WebKitをiPhone相当のviewportとmobile設定で動かすテストが含まれます.
