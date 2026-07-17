# Victory Observatory celebration

`Congratulations!!!`を, cinematic award revealと未来的な観測装置を組み合わせたhigh-impact animationとして表現したdemoです.

## 体験

- apertureが開き, 巨大なkinetic typographyが二方向から出現します.
- 3層のorbit, 48本のtick, prism medal, spotlightが奥行きを作ります.
- 72個のsparkと160片のconfettiが祝福の頂点で同期します.
- pointer parallaxとambient motionが静止後も画面を生かします.
- desktopとmobileの両方へ最適化しています.

## 実行

```bash
python3 -m http.server 4173
```

browserで`http://127.0.0.1:4173`を開きます.

## 構成

- `index.html`, cinematic stageとcontent structure.
- `styles.css`, aperture, orbit, spotlight, ticker, responsive layout.
- `app.js`, kinetic typography, spark burst, confetti, pointer parallax, replay処理.
- `vendor/gsap-lite.js`, Web Animations APIを使った最小GSAP互換runtime.

`vendor/gsap-lite.js`はGreenSock GSAP本体のsource codeではありません.
