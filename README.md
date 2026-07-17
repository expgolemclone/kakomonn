# browser-extensions

個人用のブラウザ拡張機能とユーザースクリプトを管理するリポジトリです.

## Extensions

- [`chatgpt-initial-prompt`](chatgpt-initial-prompt/README.md): ChatGPTの新しい会話へ学習支援用プロンプトを1回だけ入力するスクリプト.
- [`gai`](gai/README.md): GAI明電福朗向けのモデル, Thinking, Effort, システムプロンプト自動設定スクリプト.
- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げ・日次累計・50問ごとの祝福スクリプト.
- [`kakomonn-sync`](kakomonn-sync/README.md): kakomonn-readerの正解数を端末間で共有し,週と月の学習ログを表示するCloudflare Worker.
- [`congratulations`](congratulations/README.md): kakomonn-readerが50問ごとの到達時に開く,Cloudflareで配信するランダムな静的祝福サイト集.

## テスト

Node.js 22.12以上とPython 3を使用します.

```bash
npm ci
npm ci --prefix congratulations
npm test
npm run test:smoke
```

`npm ci`でPlaywrightと対応するChromiumもインストールします. 全ユーザースクリプトのメタデータがTampermonkeyの仕様に沿っていること, JavaScriptがES2020構文で解釈できること, Chromium上で主要な操作が動作することを検証します.
