# congratulations

kakomonn-readerが当日50問ごとのmilestoneへ到達した時に表示する,静的な祝福site集です.

root shellは登録済みsiteを均等確率で1つ選び,全画面iframeで表示します.画面下の`週間の記録を見る`を押すと,同期Workerの今週の学習ログを同じtabで開きます.学習ログから戻ると,準備済みの次問へ戻ります.

## 収録site

- `normal/kotonoha`,琴葉姉妹をイメージした非公式fan-made animation.
- `dance/hikakin`,dance形式の祝福.
- `sensational/study-complete`,一日の学習完了を祝うGSAP体験.
- `sensational/imura-rally`,投資家風の創作characterと上昇chartによるGSAP演出.

抽選対象は`celebrations.json`へ明示します.存在しないentry,重複ID,空のmanifestはbuild errorになります.

`playful/zundamon-dance`は公式画像のhotlinkへ依存するため, 抽選対象へ登録していません.

## 開発

```bash
cd congratulations
npm ci
npx playwright install chromium
npm start
```

`http://127.0.0.1:4173/?milestone=50`を開きます.

登録済みの全siteと共通shellをデザイン確認する場合は,次のcommandを実行します.Vite開発serverとPlaywright Chromiumが起動し,1つのwindowへ6個のtabを開きます.編集内容はHMRで反映され,browserを閉じるか`Ctrl+C`を入力するとserverも終了します.

```bash
npm run preview:all
```

## buildと検証

```bash
npm run build
npm test
```

Viteのmulti-page buildは`dist/`へ全siteを出力します.`npm test`はmanifest,全entry,desktopとmobile,共通の学習ログ導線をChromiumで検証します.

## Cloudflare

production URLは`https://kakomonn-congratulations.expgolem-lab.workers.dev`です.Viteの`dist/`をCloudflare Workers Static Assetsとして配信します.

repository rootからbuildとdeployを実行します.

```bash
npm run deploy:congratulations
```

公開環境そのものへbrowser E2Eを実行する場合は,`CONGRATULATIONS_ORIGIN=https://kakomonn-congratulations.expgolem-lab.workers.dev`を設定して`node tests/browser.mjs`を実行します.

## 権利表記

琴葉茜 琴葉葵 © AI Inc.

該当pageは非公式のfan-made作品です.
