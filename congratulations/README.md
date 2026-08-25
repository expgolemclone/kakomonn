# congratulations

`kakomonn-reader`で最後のdue cardを解答し, `dueCardsCompleted`がtrueになった時に表示する静的な祝福siteです.

既存designは削除済みで, 新designは未実装です. 調査用にcloneしたupstream repositoryは`upstreams/`に配置し, 親repositoryの追跡対象には含めません.

query parameterには`site`, `date`, `dueCardsCompleted`の3項目が必要です. `dueCardsCompleted`はtrueだけを受け付けます.

## 開発とtest

repository rootで実行します.

```bash
npm run test:congratulations
```

production URLは`https://kakomonn-congratulations.kakomonn.workers.dev/`です. deployとproduction検証は次のcommandへ閉じ込めます.

```bash
npm run deploy:congratulations
```
