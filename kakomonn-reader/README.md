# kakomonn-reader

中小企業診断士試験の過去問ページ向けユーザースクリプトです.

## 機能

- 問題文と解説の連続読み上げ.
- 正解した問題だけを対象にした日次カウント. 当日の値は`localStorage`へ保存され, ページを開き直しても引き継がれます.
- 問題文と解説のクリップボードへのコピー.
- 1日50問の完了判定.

## ビルド

```bash
python3 build.py
```

`src/part-*.js`を順番に結合し, `kakomonn-reader.user.js`を生成します. Tampermonkeyなどのユーザースクリプトマネージャーには, 生成されたファイルを登録してください.

## Release

`main`上の`src/`または`build.py`が変更されると, GitHub Actionsがテストとビルドを行い, 生成した`kakomonn-reader.user.js`をGitHub Releaseへ添付します. Releaseのタグは`kakomonn-reader-<commit SHA>`です. 生成ファイルは`.gitignore`の対象であり, リポジトリの差分には含めません.

Releaseがまだ存在しない`main`のcommitを手動で公開する場合は, ワークフローを実行します. 同じcommitのReleaseは上書きしません.

```bash
gh workflow run release-kakomonn-reader.yml --ref main
```

公開されたファイルは[GitHub Releases](https://github.com/expgolemclone/browser-extensions/releases)から取得できます.

## 動作環境

iOS SafariのUserscriptsとMicrosoft EdgeのTampermonkeyに対応します. 読み上げにはブラウザのWeb Speech APIを使用します. iOSではブラウザ既定の日本語音声を利用し, WindowsではEdgeの`Microsoft Nanami Online (Natural)`を利用するためインターネット接続が必要です.

## バージョン管理

ファイル名およびユーザースクリプトのメタデータにはバージョン番号を付けません. 変更履歴はGitのコミットで管理します.

## 動作確認

リポジトリのルートで依存関係をインストールし, TampermonkeyメタデータとES2020構文を検証します.

```bash
npm ci
npm test
npm run test:smoke
```
