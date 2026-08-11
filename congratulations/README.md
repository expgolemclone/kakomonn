# congratulations

kakomonn-readerが当日50問ごとのmilestoneへ到達した時に表示する,静的な祝福site集です.13作品は同じ品質基準とaccessibility contractを共有しながら,それぞれ異なる世界観,配色,造形,motionで達成を祝います.

root shellは達成数に対応するtierからsiteを均等確率で1つ選び,全画面iframeで表示します.250問を超えた場合は250tierを使い,全作品のtitle,本文,visualには実際の達成数を表示します.画面下の`週間の記録を見る`を押すと,同期Workerの直近7日間の学習ログを同じtabで開きます.

## 実装contract

全作品は`shared/foundation.css`のdesign tokenとresponsive基盤,`shared/celebration.js`のmilestone,replay,ready通知を使用します.作品固有の色,構図,visual DOM,motionは`data-site`単位で定義します.remote画像やremote fontには依存しません.

全作品は`data-celebration-root`,`data-milestone`,`data-replay`,`data-status`,`data-ready`を公開し,root shellとbrowser E2Eはこのcontractだけを参照します.子作品が初期化を完了するまでshellはiframeを表示せず,初期化失敗時に別作品へfallbackしません.

## 収録site

| milestone | site |
| ---: | --- |
| 50 | `50/hikakin`, `50/void-conductor`, `50/midnight-emcee` |
| 100 | `100/midnight-orbit`, `100/clearance-officer`, `100/night-archivist` |
| 150 | `150/gouten-stomp`, `150/imura-rally`, `150/taiko-oni` |
| 200 | `200/night-examiner`, `200/kotonoha` |
| 250 | `250/forge-fury`, `250/study-complete` |

割り当ては,再編前のHTML,CSS,JSの実file byte数を昇順に並べ,3,3,3,2,2件へ分割して決めています.README,test,dependency,生成物は計測対象外です.

抽選対象は`celebrations.json`へ明示します.manifestには50から250までの5個のtierが必要です.存在しないentry,重複ID,空tier,tierとfolderが一致しないentryはbuild errorになります.

`experiments/zundamon-dance`は公式画像のhotlinkへ依存する実験作品のため,buildと抽選対象へ登録していません.

## 開発

```bash
npm ci
npx playwright install chromium
npm start --workspace congratulations
```

`http://127.0.0.1:4173/?milestone=50`を開きます.

登録済みの全siteと共通shellを確認する場合は,次のcommandを実行します.Vite開発serverとPlaywright Chromiumが起動し,1つのwindowへ14個のtabを開きます.編集内容はHMRで反映され,browserを閉じるか`Ctrl+C`を入力するとserverも終了します.

```bash
npm run preview:all --workspace congratulations
```

## buildと検証

```bash
npm run build --workspace congratulations
npm test --workspace congratulations
```

Viteのmulti-page buildは`dist/`へ全siteを出力します.`npm test`はmanifest,全entry,50から250までのtier,250問を超えた場合の選択,320px幅,desktop,mobile,reduced motion,replay,実達成数,scroll量,共通の学習ログ導線をChromiumで検証します.

## Cloudflare

production URLは`https://kakomonn-congratulations.expgolem-lab.workers.dev`です.Viteの`dist/`をCloudflare Workers Static Assetsとして配信します.

repository rootからbuildとdeployを実行します.

```bash
npm run deploy:congratulations
```

公開環境そのものへbrowser E2Eを実行する場合は,`CONGRATULATIONS_ORIGIN=https://kakomonn-congratulations.expgolem-lab.workers.dev`を設定して`node congratulations/tests/browser.mjs`を実行します.

## 権利表記

琴葉茜 琴葉葵 © AI Inc.

該当pageは非公式のfan-made作品です.
