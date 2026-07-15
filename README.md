# browser-extensions

個人用のブラウザ拡張機能とユーザースクリプトを管理するリポジトリです.

## Extensions

- [`chatgpt-initial-prompt`](chatgpt-initial-prompt/README.md): ChatGPTの新しい会話へ学習支援用プロンプトを1回だけ入力するスクリプト.
- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げ・日次カウントスクリプト.

## テスト

```bash
npm ci
npm test
npm run test:smoke
```

`npm ci`でPlaywrightと対応するChromiumもインストールします. ユーザースクリプトのメタデータがTampermonkeyの仕様に沿っていること, JavaScriptがES2020構文で解釈できること, Chromium上で主要な操作が動作することを検証します.
