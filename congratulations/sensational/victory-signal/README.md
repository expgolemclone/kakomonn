# Victory Signal celebration

`Congratulations!!!`を, editorial posterとaward ceremonyを組み合わせたhigh-impact animationとして表現したdemoです.

## 実行

```bash
python3 -m http.server 4173
```

browserで`http://127.0.0.1:4173`を開きます.

## 検証

```bash
node --check app.js
node --check vendor/gsap-lite.js
node scripts/smoke.js
python3 scripts/verify.py
```

## 構成

- `index.html`, 画面構造.
- `styles.css`, editorial designとresponsive layout.
- `app.js`, timeline, curtain reveal, kinetic typography, confetti, replay処理.
- `vendor/gsap-lite.js`, Web Animations APIを使った最小GSAP互換runtime.

`vendor/gsap-lite.js`はGreenSock GSAP本体のsource codeではありません.
