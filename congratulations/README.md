# congratulations

`kakomonn-reader`で最後のdue cardを解答し, `dueCardsCompleted`がtrueになった時に表示する静的な祝福site集です.

13作品は共通のdesign token, responsive layout, reduced motion, replay, ready通知contractを使用します. root shellは全作品から均等確率で1つを選び, 全画面iframeで表示します. 読み込み失敗時に別作品へfallbackしません.

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

琴葉茜, 琴葉葵 © AI Inc. 該当作品は非公式のfan-made作品です.
