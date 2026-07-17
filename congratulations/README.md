# congratulations

kakomonn-readerが当日50問ごとのmilestoneへ到達した時に表示する,静的な祝福site集です.

root shellは登録済みsiteを均等確率で1つ選び,全画面iframeで表示します.画面下の`次の50問へ`を押すと,準備済みの次問へ戻ります.

## 収録site

- `normal/kotonoha`,琴葉姉妹をイメージした非公式fan-made animation.
- `dance/hikakin`,dance形式の祝福.
- `sensational/study-complete`,一日の学習完了を祝うGSAP体験.
- `sensational/gsap-study`,学習の積み重ねを辿るGSAP長編.
- `sensational/victory-observatory`,cinematicな観測装置とkinetic typographyを組み合わせた演出.
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

## buildと検証

```bash
npm run build
npm test
```

Viteのmulti-page buildは`dist/`へ全siteを出力します.`npm test`はmanifest,全entry,desktopとmobile,共通の戻る導線をChromiumで検証します.

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
