# browser-extensions

個人用のブラウザ拡張機能とユーザースクリプトを管理するリポジトリです.

## Extensions

- [`kakomonn-reader`](kakomonn-reader/README.md): 中小企業診断士試験の過去問ページ向け読み上げ・日次カウントスクリプト.

## テスト

```bash
npm ci
npm test
```

ユーザースクリプトのメタデータがTampermonkeyの仕様に沿っていることと, JavaScriptがES2020構文で解釈できることを検証します.
