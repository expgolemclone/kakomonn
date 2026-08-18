# congratulations

`kakomonn-reader`で解答した結果, `todayStabilityDaysDelta`が`dailyStabilityDaysDeltaGoal`へ初めて到達した時に表示する静的な祝福site集です.

13作品は共通のdesign token, responsive layout, reduced motion, replay, ready通知contractを使用します. root shellは全作品から均等確率で1つを選び, 全画面iframeで表示します. 読み込み失敗時に別作品へfallbackしません.

query parameterには`site`, `date`, `todayStabilityDaysDelta`, `dailyStabilityDaysDeltaGoal`の4項目が必要です. 表示値はAPIのidentifierと達成時点の値をそのまま使用します.

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
