# gai

GAI明電福朗で, Claude Opus 4.8, Thinking, Effort Max, 指定システムプロンプトを自動設定するユーザースクリプトです.

## 動作

- `https://ddu8kbg9xidvx.cloudfront.net/*`配下で動作します.
- モデルを`Claude Opus 4.8`へ変更します.
- Thinkingを有効にします.
- 詳細設定を開き, Effortを`Max`へ変更します.
- 新しい会話のシステムプロンプトを1回だけ入力して適用します.
- 対象コントロールがない画面では何も変更しません.

## ビルド

リポジトリのルートで次を実行します.

```bash
npm run build:gai
```

または, `gai`ディレクトリで次を実行します.

```bash
python3 build.py
```

ビルドは`src/userscript.js`へ`system-prompt.md`の全文をJSON文字列として内蔵し, 単独で実行できる`gai.user.js`を生成します. 外部のプロンプトファイルは実行時に読み込みません.

Tampermonkeyへ登録するファイルは, ビルド後の`gai.user.js`です. `src/userscript.js`はビルド用テンプレートなので, Tampermonkeyへ直接登録しないでください.

## 動作確認

リポジトリのルートで次を実行します.

```bash
npm test
npm run test:smoke
```
