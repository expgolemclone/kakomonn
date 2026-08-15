import { parseCelebration } from "../celebration-contract.js";

const READY_MESSAGE = "kakomonn:celebration-ready";

const celebrations = {
  hikakin: {
    name: "HIKAKIN STYLE PRAISE",
    mark: "HK",
    signal: "CREATOR STUDIO / ACHIEVEMENT LIVE",
    eyebrow: "TODAY'S RESULT / NO FILTER NEEDED",
    title: ["今日の伸び,", "ちゃんとデカい."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標の{target}日をクリアしました. 盛らなくても, 数字だけで十分に強い達成です.",
    action: "もう一度, 派手に祝う",
    status: "祝砲をもう一度. 達成値はそのままです.",
    quote: "大げさに見せなくても, 達成した数字はちゃんと強い.",
    artLabel: "CREATOR MODE",
    artNote: "RESULT ON AIR",
  },
  "void-conductor": {
    name: "THE NIGHT APPLAUDS",
    mark: "NC",
    signal: "PRIVATE CONCERT / RESULT CONFIRMED",
    eyebrow: "ONE NIGHT ONLY / THE SCORE IS COMPLETE",
    title: ["今夜の結果に,", "ちゃんと拍手を."],
    lead: "todayStabilityDaysDeltaは{delta}日. dailyStabilityDaysDeltaGoalの{target}日を超えました. 静かな達成ほど, きちんと受け取る価値があります.",
    action: "もう一度, 喝采を鳴らす",
    status: "夜のorchestraが, 達成をもう一度称えました.",
    quote: "静かな結果でも, 価値まで小さくなるわけではない.",
    artLabel: "NIGHT SCORE",
    artNote: "APPLAUSE LOCKED",
  },
  "midnight-emcee": {
    name: "MIDNIGHT EMCEE",
    mark: "ME",
    signal: "HOUSE OPEN / RESULT ANNOUNCED",
    eyebrow: "TONIGHT'S HEADLINE / TARGET CLEARED",
    title: ["本日のheadlineは,", "目標達成."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標は{target}日でした. 今夜は説明を足さなくても, この結果だけで主役になれます.",
    action: "encoreを起こす",
    status: "客席から, もう一度拍手が返ってきました.",
    quote: "達成した日は, 自分の結果を脇役にしなくていい.",
    artLabel: "CURTAIN CALL",
    artNote: "HEADLINE SECURED",
  },
  "midnight-orbit": {
    name: "MIDNIGHT ORBIT",
    mark: "MO",
    signal: "ORBITAL SIGNAL / TARGET CLEARED",
    eyebrow: "TRANSMISSION 01 / RESULT IN RANGE",
    title: ["今日の伸びは,", "目標軌道を越えた."],
    lead: "todayStabilityDaysDeltaは{delta}日. dailyStabilityDaysDeltaGoalは{target}日. 今日の結果は, 目標より先まで届いています.",
    action: "達成信号を再送する",
    status: "達成信号を, もう一度全周波数へ送りました.",
    quote: "目標を越えた事実は, 次の一日まで持ち越さなくても残る.",
    artLabel: "ORBITAL LOG",
    artNote: "VECTOR POSITIVE",
  },
  "clearance-officer": {
    name: "CELEBRATION BUREAU",
    mark: "CB",
    signal: "OFFICIAL RECORD / CLEARANCE GRANTED",
    eyebrow: "CASE REVIEW / REQUIREMENT SATISFIED",
    title: ["審査結果,", "達成を認可."],
    lead: "todayStabilityDaysDeltaは{delta}日. 必要条件の{target}日を満たしました. 今日の達成は, これ以上の自己審査を必要としません.",
    action: "認可stampを再発行する",
    status: "達成記録へ, 認可stampを再発行しました.",
    quote: "条件を満たした結果は, 何度も疑い直さなくていい.",
    artLabel: "CASE CLEARED",
    artNote: "REVIEW CLOSED",
  },
  "night-archivist": {
    name: "MIDNIGHT STUDY ARCHIVE",
    mark: "MA",
    signal: "ARCHIVE SYNC / RESULT SAVED",
    eyebrow: "ENTRY SEALED / TODAY IS ON RECORD",
    title: ["今日の達成は,", "もう記録に残った."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標の{target}日を上回りました. 一日の結果として, これで十分に保存する価値があります.",
    action: "記録をもう一度照らす",
    status: "今日の達成記録を, もう一度highlightしました.",
    quote: "記録に残る結果は, 気分が変わっても消えない.",
    artLabel: "ARCHIVE ENTRY",
    artNote: "SEALED TODAY",
  },
  "gouten-stomp": {
    name: "GOUTEN VICTORY STOMP",
    mark: "轟",
    signal: "BLACK DOHYO / VICTORY CONFIRMED",
    eyebrow: "RESULT IMPACT / HOLD NOTHING BACK",
    title: ["今日は,", "遠慮なく鳴らせ."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標の{target}日をクリアしました. 達成した日くらい, 結果を小さく扱う必要はありません.",
    action: "もう一丁, 勝ち四股",
    status: "ゴウテンの勝ち四股が, もう一度響きました.",
    quote: "結果が出た日は, 喜び方まで静かにしなくていい.",
    artLabel: "VICTORY RITUAL",
    artNote: "GROUND IMPACT",
  },
  "imura-rally": {
    name: "IMURA RALLY LIVE",
    mark: "IR",
    signal: "CLOSING BELL / TARGET OUTPERFORMED",
    eyebrow: "EFFORT INDEX / SESSION CLOSED GREEN",
    title: ["今日の結果は,", "目標を上回った."],
    lead: "todayStabilityDaysDeltaは{delta}日. dailyStabilityDaysDeltaGoalは{target}日. 比喩を足さなくても, 今日の数字はきれいな上振れです.",
    action: "closing bellをもう一度",
    status: "closing bellが, 今日の達成をもう一度知らせました.",
    quote: "上振れは, 明日の義務ではなく今日の達成として受け取る.",
    artLabel: "CLOSING BOARD",
    artNote: "ABOVE TARGET",
  },
  "taiko-oni": {
    name: "UNDERGROUND TAIKO",
    mark: "祝",
    signal: "RITUAL BEAT / TARGET CLEARED",
    eyebrow: "ONE RESULT / FOUR BEATS",
    title: ["今日の達成を,", "ちゃんと鳴らし切る."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標は{target}日. 今日の結果を一度きちんと祝ってから, 次のことは次の日に考えれば十分です.",
    action: "もう一度, 太鼓を鳴らす",
    status: "達成の四連打が, もう一度響きました.",
    quote: "達成した事実を受け取る時間も, 学習の一区切りになる.",
    artLabel: "RITUAL BEAT",
    artNote: "FOUR BEATS READY",
  },
  "night-examiner": {
    name: "NIGHT EXAMINER",
    mark: "合",
    signal: "RESULT FILED / PASS CONFIRMED",
    eyebrow: "FINAL REVIEW / CONDITION MET",
    title: ["本日の判定,", "合格."],
    lead: "todayStabilityDaysDeltaは{delta}日. dailyStabilityDaysDeltaGoalの{target}日を満たしました. 今日の判定は, これで確定です.",
    action: "合格印をもう一度押す",
    status: "答案ではなく, 今日の達成記録へ合格印を押しました.",
    quote: "条件を満たした日は, 追加採点をしなくても合格のままです.",
    artLabel: "FINAL MARK",
    artNote: "PASS FILED",
  },
  kotonoha: {
    name: "KOTONOHA TWIN LIVE",
    mark: "琴",
    signal: "AKANE + AOI / RESULT CELEBRATION",
    eyebrow: "TWIN MESSAGE / TODAY'S WIN",
    title: ["今日はええ日やな.", "目標, ちゃんと越えたで."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標の{target}日をクリアしました. 茜は大きく, 葵は丁寧に, 今日の結果をそのまま祝います.",
    action: "琴葉姉妹ともう一回祝う",
    status: "茜と葵から, もう一度拍手が届きました.",
    quote: "今日できたことは, 今日のうちにちゃんと褒めてええんやで.",
    artLabel: "TWIN LIVE",
    artNote: "AKANE + AOI",
    license: "琴葉茜 琴葉葵 © AI Inc. 非公式fan-made作品です.",
  },
  "forge-fury": {
    name: "GARA'S NIGHT FORGE",
    mark: "GF",
    signal: "FORGE LOG / RESULT TEMPERED",
    eyebrow: "HEAT DOWN / ACHIEVEMENT HOLDS",
    title: ["火花が消えても,", "今日の結果は残る."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標は{target}日. 達成をさらに叩き続けなくても, 今日できた結果は十分に形になっています.",
    action: "祝賀hammerをもう一度",
    status: "GARAが, 今日の達成をもう一度刻みました.",
    quote: "達成を強くするために, 達成後まで無理を重ねる必要はない.",
    artLabel: "FORGE RESULT",
    artNote: "TEMPER COMPLETE",
  },
  "study-complete": {
    name: "STUDY COMPLETE",
    mark: "SC",
    signal: "SESSION RESULT / COMPLETE",
    eyebrow: "TODAY IS DONE / TARGET CLEARED",
    title: ["今日は,", "ちゃんと達成した."],
    lead: "todayStabilityDaysDeltaは{delta}日. 目標の{target}日をクリアしました. 今日はここまで積み上がった, という事実をそのまま受け取れます.",
    action: "達成burstをもう一度",
    status: "今日の達成を, もう一度画面いっぱいに再生しました.",
    quote: "達成した日は, 次を急ぐ前に今日できたことを確認して終われる.",
    artLabel: "SESSION COMPLETE",
    artNote: "TODAY RECORDED",
  },
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

function sentence(template, delta, target) {
  return template.replaceAll("{delta}", delta).replaceAll("{target}", target);
}

function renderCelebration(root, config, celebration) {
  const delta = signed(celebration.todayStabilityDaysDelta);
  const target = signed(celebration.dailyStabilityDaysDeltaGoal);
  const margin = signed(
    celebration.todayStabilityDaysDelta - celebration.dailyStabilityDaysDeltaGoal,
  );

  root.dataset.celebrationRoot = "";
  root.dataset.ready = "false";
  root.innerHTML = `
    <div class="ambient" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="burst-field" data-burst-field aria-hidden="true"></div>
    <header class="masthead">
      <div class="brand">
        <span class="brand-mark">${config.mark}</span>
        <span class="brand-copy"><b>${config.name}</b><small>ACHIEVEMENT CEREMONY</small></span>
      </div>
      <p class="signal"><i aria-hidden="true"></i>${config.signal}</p>
    </header>
    <section class="hero" aria-labelledby="celebration-title">
      <div class="hero-copy">
        <p class="eyebrow">${config.eyebrow}</p>
        <h1 id="celebration-title"><span>${config.title[0]}</span><strong>${config.title[1]}</strong></h1>
        <p class="lead">${sentence(config.lead, delta, target)}</p>
        <div class="achievement-metric" aria-label="todayStabilityDaysDelta ${delta}日, dailyStabilityDaysDeltaGoal ${target}日">
          <p><small>todayStabilityDaysDelta</small><span><strong data-today-stability-days-delta>${delta}</strong><b>日</b></span></p>
          <p><small>dailyStabilityDaysDeltaGoal</small><span><strong data-daily-stability-days-delta-goal>${target}</strong><b>日</b></span></p>
        </div>
        <div class="hero-actions">
          <button class="replay-button" type="button" data-replay><span>${config.action}</span><i aria-hidden="true">↗</i></button>
          <p class="live-status" role="status" aria-live="polite" data-status>祝福の準備が整いました.</p>
        </div>
      </div>
      <div class="art-stage" data-art aria-label="${escapeAttribute(config.name)}の祝福演出">
        <div class="art-grid" aria-hidden="true"></div>
        <div class="art-orbit orbit-a" aria-hidden="true"></div>
        <div class="art-orbit orbit-b" aria-hidden="true"></div>
        <div class="art-beam beam-a" aria-hidden="true"></div>
        <div class="art-beam beam-b" aria-hidden="true"></div>
        <div class="art-core" aria-hidden="true"><span>${config.mark}</span></div>
        <div class="art-token"><small>${config.artLabel}</small><strong data-today-stability-days-delta>${delta}</strong><span>days</span></div>
        <div class="art-note"><i></i><span>${config.artNote}</span></div>
      </div>
    </section>
    <section class="proof" aria-label="達成記録">
      <div class="proof-heading">
        <p>RESULT / ${celebration.date}</p>
        <h2>数字で見ても, 今日の目標は達成済み.</h2>
      </div>
      <div class="proof-grid">
        <article><small>01 / TARGET</small><strong>${target}<span>日</span></strong><p>dailyStabilityDaysDeltaGoal</p></article>
        <article><small>02 / RESULT</small><strong>${delta}<span>日</span></strong><p>todayStabilityDaysDelta</p></article>
        <article><small>03 / MARGIN</small><strong>${margin}<span>日</span></strong><p>目標との差分</p></article>
      </div>
      <blockquote>${config.quote}</blockquote>
    </section>
    <footer class="site-footer">
      <span>${config.name}</span>
      <span>${config.license ?? `${celebration.site} / ${celebration.date}`}</span>
    </footer>`;
}

function createBurst(root) {
  const field = root.querySelector("[data-burst-field]");
  if (!(field instanceof HTMLElement)) {
    throw new Error("Burst field is missing.");
  }
  field.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 48; index += 1) {
    const particle = document.createElement("i");
    particle.style.setProperty("--particle-index", String(index));
    particle.style.setProperty("--particle-x", `${(index * 43) % 100}%`);
    particle.style.setProperty("--particle-drift", `${((index * 37) % 180) - 90}px`);
    particle.style.setProperty("--particle-delay", `${(index % 12) * 24}ms`);
    particle.style.setProperty("--particle-turn", `${160 + (index % 9) * 55}deg`);
    particle.style.setProperty("--particle-size", `${0.28 + (index % 4) * 0.11}rem`);
    particle.style.setProperty("--particle-height", `${0.6 + (index % 3) * 0.22}rem`);
    particle.style.setProperty("--particle-duration", `${1.45 + (index % 7) * 0.12}s`);
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
  if (output) output.textContent = message;
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
