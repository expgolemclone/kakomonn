# chatgpt-initial-prompt

ChatGPTの新しい会話を開いたとき, 共通の学習支援用プロンプトを入力欄へ1回だけ入力するユーザースクリプトです.

## 動作

- `https://chatgpt.com/*`配下で動作します.
- 空の入力欄が表示されたときだけプロンプトを入力します.
- 既に入力されている文章は上書きしません.
- 入力後はカーソルと表示位置を文章の末尾へ移動します.
- `textarea`と`contenteditable`の入力欄へ対応します.

## ビルド

リポジトリのルートで次を実行します.

```bash
npm run build:chatgpt-initial-prompt
```

または, `chatgpt-initial-prompt`ディレクトリで次を実行します.

```bash
python3 build.py
```

ビルドは`src/userscript.js`へリポジトリ直下の`system-prompt.md`をJSON文字列として内蔵し, 単独で実行できる`chatgpt-initial-prompt.user.js`を生成します. `gai`も同じ`system-prompt.md`を参照します.

Tampermonkeyへ登録するファイルは, ビルド後の`chatgpt-initial-prompt.user.js`です. `src/userscript.js`はビルド用テンプレートなので, Tampermonkeyへ直接登録しないでください.

プロンプト上部の追加空行は, `src/userscript.js`内の`LEADING_BLANK_LINES`で調整できます.

## 動作確認

リポジトリのルートで次を実行します.

```bash
npm test
npm run test:smoke
```
