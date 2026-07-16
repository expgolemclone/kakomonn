# kakomonn-reader

中小企業診断士試験の過去問ページ向けユーザースクリプトです.

## 機能

- 問題文と解説の連続読み上げ.
- 次の問題へ移動した回数の日次カウント. 当日の値は`localStorage`へ保存され, ページを開き直しても引き継がれます.
- 問題文と解説のクリップボードへのコピー.
- 1日100問の完了判定.

## ビルド

```bash
python3 build.py
```

`src/part-*.js`を順番に結合し, `kakomonn-reader.user.js`を生成します. Tampermonkeyなどのユーザースクリプトマネージャーには, 生成されたファイルを登録してください.

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
