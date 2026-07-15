# chatgpt-initial-prompt

ChatGPTの新しい会話を開いたとき, 学習支援用の複数行プロンプトを入力欄へ1回だけ入力するユーザースクリプトです.

## 動作

- `https://chatgpt.com/*`配下で動作します.
- 空の入力欄が表示されたときだけプロンプトを入力します.
- 既に入力されている文章は上書きしません.
- 入力後はカーソルを文章の先頭へ移動します.
- `textarea`と`contenteditable`の入力欄へ対応します.

## インストール

Tampermonkeyなどのユーザースクリプトマネージャーへ`chatgpt-initial-prompt.user.js`を登録してください.

プロンプト上部の空行は, スクリプト内の`LEADING_BLANK_LINES`で調整できます.

## 動作確認

リポジトリのルートで次を実行します.

```bash
npm test
npm run test:smoke
```
