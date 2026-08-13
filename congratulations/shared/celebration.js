import { parseCelebration } from "../celebration-contract.js";

const READY_MESSAGE = "kakomonn:celebration-ready";

const celebrations = {
  hikakin: {
    name: "HIKAKIN STYLE PRAISE",
    mark: "HK",
    signal: "CREATOR STUDIO LIVE",
    eyebrow: "TODAY'S HERO / EFFORT ON CAMERA",
    title: ["今日の努力が,", "主役になった."],
    lead: "一問ずつ積み上げた時間は, もう小さくありません. 今日のあなたへ, 最大の拍手を送ります.",
    action: "もう一度, 盛り上げる",
    status: "cameraと紙吹雪を再起動しました.",
    quote: "本気で続けた人だけが立てるstageです.",
    proof: ["努力の瞬間", "主役確定", "拍手最大"],
    art: "creator",
  },
  "void-conductor": {
    name: "THE NIGHT APPLAUDS",
    mark: "NC",
    signal: "PRIVATE PERFORMANCE",
    eyebrow: "CELESTIAL CONCERT / ONE NIGHT ONLY",
    title: ["夜空すべてが,", "あなたへ喝采する."],
    lead: "静かに重ねた一問一問が, 今夜の星座になりました. 指揮棒を振れば, 星々がもう一度応えます.",
    action: "星の喝采を指揮する",
    status: "夜空のorchestraが喝采しました.",
    quote: "積み重ねた音は, 暗闇の中でも消えません.",
    proof: ["星図完成", "独奏達成", "次章開演"],
    art: "conductor",
  },
  "midnight-emcee": {
    name: "MIDNIGHT EMCEE",
    mark: "ME",
    signal: "THE HOUSE IS FULL",
    eyebrow: "VELVET THEATRE / TONIGHT'S HEADLINER",
    title: ["今日の主役は,", "あなたです."],
    lead: "最後の一問まで走り切ったことを, 満員の劇場が祝っています. 幕はまだ下ろしません.",
    action: "もう一度, 拍手を浴びる",
    status: "満員の客席からencoreが届きました.",
    quote: "努力を終えた瞬間, stageはあなたのものになります.",
    proof: ["満員御礼", "主役登場", "喝采継続"],
    art: "emcee",
  },
  "midnight-orbit": {
    name: "MIDNIGHT ORBIT",
    mark: "MO",
    signal: "SPECIAL TRANSMISSION",
    eyebrow: "ORBITAL BROADCAST / SIGNAL LOCKED",
    title: ["努力の軌道が,", "夜空を追い越した."],
    lead: "これは偶然ではなく, 積み上げた選択の軌道です. 達成信号を全周波数へ送信します.",
    action: "祝賀放送を起動する",
    status: "達成信号を宇宙全域へ送信しました.",
    quote: "継続は, やがて重力さえ越えていきます.",
    proof: ["軌道安定", "信号最大", "航路更新"],
    art: "orbit",
  },
  "clearance-officer": {
    name: "CELEBRATION BUREAU",
    mark: "CB",
    signal: "ACHIEVEMENT VERIFIED",
    eyebrow: "OFFICIAL RECORD / CLEARANCE GRANTED",
    title: ["CHECKPOINT", "CLEARED."],
    lead: "前進を確認しました. この達成は, 祝賀局の規定により正式に認可されます.",
    action: "達成印を再発行する",
    status: "達成記録へ認可stampを再発行しました.",
    quote: "結果は記録されました. 次のcheckpointへ進めます.",
    proof: ["審査完了", "記録認可", "通過確定"],
    art: "officer",
  },
  "night-archivist": {
    name: "MIDNIGHT STUDY ARCHIVE",
    mark: "MA",
    signal: "RECORD SYNCHRONIZED",
    eyebrow: "CELESTIAL ARCHIVE / CHAPTER SEALED",
    title: ["積み上げた軌跡が,", "星座になった."],
    lead: "今日の一問ずつを, 深夜の記録庫へ保存しました. 星図は次の達成へ続いています.",
    action: "星図をもう一度描く",
    status: "達成の星図を再生成しました.",
    quote: "記録は過去ではなく, 次へ進むための光です.",
    proof: ["記録封印", "星図生成", "次章待機"],
    art: "archivist",
  },
  "gouten-stomp": {
    name: "GOUTEN VICTORY STOMP",
    mark: "轟",
    signal: "BLACK DOHYO CEREMONY",
    eyebrow: "VICTORY RITUAL / GROUND IMPACT",
    title: ["積み上げた分だけ,", "地面を踏み抜け."],
    lead: "正解も, 間違いも, ここまで運んできた力です. 祝砲鬼ゴウテンが勝ち四股で称えます.",
    action: "もう一丁, 勝ち四股",
    status: "ゴウテンの四股が大地を揺らしました.",
    quote: "答えは静かでも, 達成は静かでなくていい.",
    proof: ["土俵制覇", "地響最大", "気合充填"],
    art: "gouten",
  },
  "imura-rally": {
    name: "IMURA RALLY LIVE",
    mark: "IR",
    signal: "CELEBRATION MARKET OPEN",
    eyebrow: "EFFORT INDEX / ALL TIME HIGH",
    title: ["努力の相場が,", "史上最高値を更新."],
    lead: "積み上げた一問が買いを呼び, 達成指数が急騰しました. 本日の主役は完全にあなたです.",
    action: "祝賀bellを鳴らす",
    status: "祝賀bellとともに努力指数が急騰しました.",
    quote: "継続への投資は, 今日も最高の結果を返しました.",
    proof: ["努力指数", "+999.9%", "LIMIT UP"],
    art: "market",
  },
  "taiko-oni": {
    name: "UNDERGROUND TAIKO",
    mark: "祝",
    signal: "RITUAL BEAT READY",
    eyebrow: "THE GROUND HEARD IT FIRST",
    title: ["積み上げた分だけ,", "地面を鳴らせ."],
    lead: "一問ずつ戻ってきた音は, もう小さくありません. 四本腕の太鼓鬼ゴンが達成を叩きつけます.",
    action: "もう一度, 地鳴りを起こす",
    status: "四連打の地鳴りが響きました.",
    quote: "続けた回数だけ, 音は太くなります.",
    proof: ["四連打", "地鳴発生", "祭礼続行"],
    art: "taiko",
  },
  "night-examiner": {
    name: "NIGHT EXAMINER",
    mark: "合",
    signal: "MIDNIGHT RESULT FILED",
    eyebrow: "FINAL MARKING / PASS CONFIRMED",
    title: ["採点は終わった.", "今夜は, 合格だ."],
    lead: "難問へ戻るたび, 昨日の自分より理解度が上がりました. 夜間採点官ノクスが結果を通達します.",
    action: "合格印をもう一度",
    status: "答案へ鮮明な合格印を押しました.",
    quote: "迷った跡も, やり切った証拠として残ります.",
    proof: ["採点終了", "理解更新", "合格確定"],
    art: "examiner",
  },
  kotonoha: {
    name: "KOTONOHA TWIN LIVE",
    mark: "琴",
    signal: "AKANE + AOI ON STAGE",
    eyebrow: "THIS MOMENT IS YOURS",
    title: ["ほんまに最高や!", "今日の勝ちはあなたのもの!"],
    lead: "とんでもなく最高です. あなたがやり切った瞬間を, 琴葉姉妹が全力で称えます.",
    action: "琴葉姉妹ともう一回祝う",
    status: "茜と葵の祝福が最大出力になりました.",
    quote: "茜と葵から, 今日いちばん大きな拍手を送ります.",
    proof: ["茜も絶賛", "葵も絶賛", "祝福MAX"],
    art: "kotonoha",
    license: "琴葉茜 琴葉葵 © AI Inc. 非公式fan-made作品です.",
  },
  "forge-fury": {
    name: "GARA'S NIGHT FORGE",
    mark: "GF",
    signal: "FURNACE ONLINE",
    eyebrow: "PRIMARY KPI SECURED / HEAT MAX",
    title: ["終わらせただけじゃない.", "実績へ鍛え上げた."],
    lead: "積み上げた一問ずつが, 鉄より硬い実績になりました. 勝利鍛冶師GARAが達成数を刻みます.",
    action: "もう一度, 叩いて祝う",
    status: "GARAが達成数を熱い鋼へ刻印しました.",
    quote: "逃げずに打ち続けた分だけ, 実績は強くなります.",
    proof: ["炉温最大", "実績鍛造", "刻印完了"],
    art: "forge",
  },
  "study-complete": {
    name: "STUDY COMPLETE",
    mark: "SC",
    signal: "TODAY'S STUDY SEALED",
    eyebrow: "EFFORT ACCOUNTED / SESSION COMPLETE",
    title: ["今日も,", "やり切った."],
    lead: "手応えがなくて焦った日も, 問題が重くて逃げたくなった日もありました. それでも結果だけで自分を裁かず, 今日積むべき一問へ戻ってきました.",
    action: "達成burstを再生する",
    status: "今日の達成記録を最大出力で再生しました.",
    quote: "完璧ではなく, 続けた事実が今日を完成させます.",
    proof: ["SESSION", "COMPLETE", "NEXT READY"],
    art: "complete",
  },
};

const artTemplates = {
  creator: `
    <div class="camera-frame"><span>REC</span><i></i><i></i><i></i><i></i></div>
    <div class="hype-word">YEAH!</div>
    <div class="character creator-character">
      <div class="creator-hair"></div><div class="creator-head"><i class="glasses"></i><i class="creator-mouth"></i></div>
      <div class="creator-body"><span class="medal">H</span></div><div class="creator-arm arm-left"></div><div class="creator-arm arm-right"></div>
    </div>
    <div class="caption-card"><small>HIKAKIN STYLE PRAISE</small><strong>今日のあなた, 最強です.</strong></div>`,
  conductor: `
    <div class="orbit-ring ring-one"></div><div class="orbit-ring ring-two"></div><div class="star-score"></div>
    <div class="character conductor-character"><div class="conductor-head"></div><div class="conductor-body"></div><div class="conductor-arm"></div><div class="baton"></div></div>
    <div class="vertical-label">CONCERTO FOR SMALL VICTORIES</div>`,
  emcee: `
    <div class="stage-curtain curtain-left"></div><div class="stage-curtain curtain-right"></div><div class="spotlight"></div>
    <div class="character emcee-character"><div class="top-hat"><i></i></div><div class="emcee-head"></div><div class="emcee-body"></div><div class="emcee-arm"></div></div>
    <div class="marquee">BRAVO · BRAVO · BRAVO</div>`,
  orbit: `
    <div class="planet planet-one"></div><div class="planet planet-two"></div><div class="orbit-path path-one"></div><div class="orbit-path path-two"></div>
    <div class="character orbit-host"><div class="helmet"><div class="host-head"></div></div><div class="host-suit"><i></i><i></i><i></i></div><div class="host-hand"></div></div>
    <div class="frequency-card"><span>88.8 MHz</span><strong>SIGNAL LOCKED</strong></div>`,
  officer: `
    <div class="scan-grid"></div><div class="case-number">CASE K-<span data-today-stability-days-delta></span></div>
    <div class="officer-machine"><div class="machine-head"><i></i><b></b></div><div class="machine-body"><span>局</span></div><div class="machine-arm arm-a"></div><div class="machine-arm arm-b"></div></div>
    <div class="approval-stamp">CLEARED</div>`,
  archivist: `
    <svg class="constellation" viewBox="0 0 500 500" aria-hidden="true"><path d="M42 388 102 286 176 320 239 196 322 232 399 104 460 175"/><g><circle cx="42" cy="388" r="6"/><circle cx="102" cy="286" r="8"/><circle cx="176" cy="320" r="5"/><circle cx="239" cy="196" r="9"/><circle cx="322" cy="232" r="6"/><circle cx="399" cy="104" r="8"/><circle cx="460" cy="175" r="5"/></g></svg>
    <div class="character archivist-character"><div class="archive-helmet"><div class="archive-head"></div></div><div class="archive-suit"></div></div>
    <div class="archive-slip"><small>RECORD</small><strong data-today-stability-days-delta></strong><span>SEALED</span></div>`,
  gouten: `
    <div class="dohyo-ring ring-a"></div><div class="dohyo-ring ring-b"></div><div class="ink-sun"></div>
    <div class="character gouten-character"><div class="oni-head"><i></i><i></i><b></b></div><div class="oni-body"></div><div class="oni-arm arm-a"></div><div class="oni-arm arm-b"></div><div class="oni-leg leg-a"></div><div class="oni-leg leg-b"></div></div>
    <div class="impact-type">ドン</div>`,
  market: `
    <div class="market-board"><span>EFFORT</span><strong>+999.9%</strong><i>LIMIT UP</i></div>
    <svg class="rally-chart" viewBox="0 0 500 400" aria-hidden="true"><polyline points="0,350 70,306 128,329 190,224 244,260 310,126 365,172 440,42 500,65"/></svg>
    <div class="character market-host"><div class="market-head"></div><div class="market-suit"></div><div class="market-arm"></div></div>
    <div class="market-bell"><i></i></div>`,
  taiko: `
    <div class="beat-ring beat-a"></div><div class="beat-ring beat-b"></div>
    <div class="character taiko-character"><div class="taiko-head"><i></i><i></i></div><div class="taiko-body"></div><div class="taiko-arm arm-1"></div><div class="taiko-arm arm-2"></div><div class="taiko-arm arm-3"></div><div class="taiko-arm arm-4"></div></div>
    <div class="great-drum"><span data-today-stability-days-delta></span><i></i></div><div class="beat-word">轟</div>`,
  examiner: `
    <div class="answer-moon"><span>○</span><span>○</span><span>○</span></div>
    <div class="character examiner-character"><div class="examiner-head"><i></i></div><div class="examiner-body"></div><div class="examiner-arm"></div></div>
    <div class="exam-paper"><i></i><i></i><i></i><strong>合格</strong></div>`,
  kotonoha: `
    <div class="twin-orbit orbit-a"></div><div class="twin-orbit orbit-b"></div>
    <div class="kotonoha-twin akane"><div class="twin-hair"><i></i></div><div class="twin-head"></div><div class="twin-body">AKANE</div><div class="twin-arm"></div></div>
    <div class="kotonoha-twin aoi"><div class="twin-hair"><i></i></div><div class="twin-head"></div><div class="twin-body">AOI</div><div class="twin-arm"></div></div>
    <div class="speech-chip chip-a">天才やん!</div><div class="speech-chip chip-b">すごい, 最高だよ!</div>`,
  forge: `
    <div class="furnace-ring ring-a"></div><div class="furnace-ring ring-b"></div>
    <div class="character forge-character"><div class="forge-helmet"><i></i></div><div class="forge-body"></div><div class="forge-arm"></div><div class="hammer"><i></i></div></div>
    <div class="anvil"><span data-today-stability-days-delta></span></div><div class="clang">CLANG!</div>`,
  complete: `
    <div class="completion-orbit orbit-a"></div><div class="completion-orbit orbit-b"></div>
    <div class="progress-dial"><div><strong>100%</strong><span>STUDY DONE</span></div></div>
    <div class="data-card card-a">PRIMARY <b>KPI</b></div><div class="data-card card-b">DELTA <b data-today-stability-days-delta></b></div>
    <div class="complete-word">COMPLETE</div>`,
};

function requiredRoot() {
  const root = document.querySelector("#celebration-root");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Celebration root is missing.");
  }
  return root;
}

function escapeAttribute(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("ja-JP")}`;
}

function renderCelebration(root, config, celebration) {
  const delta = signed(celebration.todayStabilityDaysDelta);
  const goal = signed(celebration.dailyStabilityDaysDeltaGoal);
  root.dataset.celebrationRoot = "";
  root.dataset.ready = "false";
  root.innerHTML = `
    <div class="ambient" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
    <div class="burst-field" data-burst-field aria-hidden="true"></div>
    <header class="masthead">
      <div class="brand"><span class="brand-mark">${config.mark}</span><span><b>${config.name}</b><small>ACHIEVEMENT CEREMONY</small></span></div>
      <p class="signal"><i aria-hidden="true"></i>${config.signal}</p>
    </header>
    <section class="hero" aria-labelledby="celebration-title">
      <div class="hero-copy">
        <p class="eyebrow">${config.eyebrow}</p>
        <h1 id="celebration-title"><span>${config.title[0]}</span><strong>${config.title[1]}</strong></h1>
        <div class="achievement-metric" aria-label="todayStabilityDaysDelta ${delta}日, dailyStabilityDaysDeltaGoal ${goal}日">
          <p><small>todayStabilityDaysDelta</small><span><strong data-today-stability-days-delta>${delta}</strong><b>日</b></span></p>
          <p><small>dailyStabilityDaysDeltaGoal</small><span><strong data-daily-stability-days-delta-goal>${goal}</strong><b>日</b></span></p>
        </div>
        <p class="lead">${config.lead}</p>
        <button class="replay-button" type="button" data-replay><span>${config.action}</span><i aria-hidden="true">↗</i></button>
        <p class="live-status" role="status" aria-live="polite" data-status>祝福の準備が整いました.</p>
      </div>
      <div class="art-stage" data-art aria-label="${escapeAttribute(config.name)}の祝福演出">
        ${artTemplates[config.art]}
      </div>
    </section>
    <section class="proof" aria-label="達成記録">
      <div class="proof-grid">
        ${config.proof.map((item, index) => `<div><small>0${index + 1}</small><strong>${item}</strong>${index === 1 ? `<span data-today-stability-days-delta>${delta}</span>` : ""}</div>`).join("")}
      </div>
      <blockquote>${config.quote}</blockquote>
    </section>
    <footer class="site-footer"><span>${config.name}</span><span>${config.license ?? "TODAY'S PRIMARY KPI / ACHIEVED"}</span></footer>`;
  for (const target of root.querySelectorAll("[data-today-stability-days-delta]")) {
    target.textContent = delta;
  }
  for (const target of root.querySelectorAll("[data-daily-stability-days-delta-goal]")) {
    target.textContent = goal;
  }
}

function createBurst(root) {
  const field = root.querySelector("[data-burst-field]");
  if (!(field instanceof HTMLElement)) {
    throw new Error("Burst field is missing.");
  }
  field.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 76; index += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--particle-index", String(index));
    particle.style.setProperty("--particle-x", `${(index * 47) % 100}%`);
    particle.style.setProperty("--particle-drift", `${((index * 31) % 180) - 90}px`);
    particle.style.setProperty("--particle-delay", `${(index % 13) * 28}ms`);
    particle.style.setProperty("--particle-turn", `${180 + (index % 8) * 75}deg`);
    particle.style.setProperty("--particle-size", `${0.35 + (index % 4) * 0.12}rem`);
    particle.style.setProperty("--particle-height", `${0.8 + (index % 3) * 0.24}rem`);
    particle.style.setProperty("--particle-duration", `${1.8 + (index % 8) * 0.11}s`);
    fragment.append(particle);
  }
  field.append(fragment);
}

function replay(root, config, reducedMotion, announce = true) {
  const status = root.querySelector("[data-status]");
  if (!(status instanceof HTMLElement)) {
    throw new Error("Celebration status is missing.");
  }
  root.classList.remove("is-celebrating");
  void root.offsetWidth;
  createBurst(root);
  if (!reducedMotion.matches) {
    root.classList.add("is-celebrating");
  }
  if (announce) {
    status.textContent = config.status;
  }
}

function renderError(root, error) {
  document.documentElement.dataset.state = "error";
  const message = error instanceof Error ? error.message : "祝福を開始できませんでした.";
  root.innerHTML = `<section class="page-error" role="alert"><p>CELEBRATION ERROR</p><h1>祝福を開始できません</h1><pre></pre></section>`;
  const output = root.querySelector("pre");
  if (output) {
    output.textContent = message;
  }
}

const root = requiredRoot();
try {
  const siteId = document.documentElement.dataset.site;
  const config = celebrations[siteId];
  if (!config) {
    throw new Error("Unknown celebration site.");
  }
  const celebration = parseCelebration(window.location.search);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  renderCelebration(root, config, celebration);
  document.title = `todayStabilityDaysDelta達成 | ${config.name}`;
  document.documentElement.dataset.state = "ready";
  root.dataset.ready = "true";

  const replayButton = root.querySelector("[data-replay]");
  if (!(replayButton instanceof HTMLButtonElement)) {
    throw new Error("Replay button is missing.");
  }
  replayButton.addEventListener("click", () => replay(root, config, reducedMotion));
  replay(root, config, reducedMotion, false);

  if (window.parent !== window) {
    window.parent.postMessage(
      { type: READY_MESSAGE, siteId, celebration },
      window.location.origin,
    );
  }
} catch (error) {
  renderError(root, error);
  throw error;
}
