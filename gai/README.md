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

```bash
python3 build.py
```

`src/userscript.js`へ`system-prompt.md`をJSON文字列として埋め込み, `gai.user.js`を生成します. Tampermonkeyなどのユーザースクリプトマネージャーには, 生成されたファイルを登録してください.

## 動作確認

リポジトリのルートで次を実行します.

```bash
npm test
npm run test:smoke
```
