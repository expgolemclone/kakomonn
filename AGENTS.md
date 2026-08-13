# codex RULES

## test

- testの実行, 復旧, 検証では, Codexのbrowser, computer-use, Chrome DevTools MCPを直接使用しないこと.
- browser操作はrepositoryのtest scriptへ閉じ込め, Codexは`package.json`で定義されたcommandだけを実行すること.
- 完全testには`npm test`を使用すること. test失敗を手動browser操作, skip, forceで代替しないこと.
- testが失敗した場合は, stdout, stderr, test artifactを調査し, 必要ならtest scriptを修正すること.
- production同期tokenをtool出力, log, 回答, tracked fileへ表示または保存しないこと.
