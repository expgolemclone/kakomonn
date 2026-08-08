# Study Complete Congratulations

今日の勉強をやり切った瞬間を祝う,GSAPベースのWeb体験です.

このpageは`congratulations`直下のVite multi-page buildへ統合されています.依存packageとlockfileは上位directoryだけで管理します.

## 実行

```bash
cd congratulations
npm ci
npm start
```

`http://127.0.0.1:4173/250/study-complete/?milestone=250`を開きます.

## 検証

```bash
cd congratulations
npm test
```

packageで管理したPlaywrightのChromiumを使い,desktopとmobile,進捗100,紙吹雪,光線,scroll演出,再演操作,横方向のoverflowを検証します.
