import { parseCelebration } from "../celebration-contract.js";

const stories = {
  hikakin: {
    motif: "studio",
    kicker: "AFTERSHOW / RESULT CHECK",
    title: "派手に祝って, 数字は冷静に見る.",
    meaning: "今日の結果は, 見せ方ではなく数値そのものが強い.",
    next: "この上振れを明日のノルマにしなくていい. 今日の達成として閉じれば十分です.",
  },
  "void-conductor": {
    motif: "score",
    kicker: "CODA / RESULT CHECK",
    title: "喝采のあとに, 今日のscoreを確認する.",
    meaning: "静かな達成でも, 目標を超えた事実ははっきり残る.",
    next: "余韻は残しても, 追加課題までは持ち越さなくていい. 次の一音は次の日で十分です.",
  },
  "midnight-emcee": {
    motif: "stage",
    kicker: "CURTAIN CALL / RESULT CHECK",
    title: "幕を下ろす前に, 今日のheadlineを確認する.",
    meaning: "今日の主役は演出ではなく, 目標を超えた結果そのもの.",
    next: "encoreは祝福だけでいい. 明日の学習まで今夜に前倒しする必要はありません.",
  },
  "midnight-orbit": {
    motif: "orbit",
    kicker: "FLIGHT LOG / RESULT CHECK",
    title: "軌道を見れば, 今日の到達点は明確.",
    meaning: "目標線より先へ出た分まで, 今日の結果として記録できる.",
    next: "次のvectorは明日決めればいい. 今日の軌道は, 今日の達成として閉じます.",
  },
  "clearance-officer": {
    motif: "record",
    kicker: "CASE FILE / FINAL REVIEW",
    title: "認可後に, もう一度だけ事実を確認する.",
    meaning: "条件を満たした以上, 達成を何度も再審査する必要はない.",
    next: "caseはclosed. 次の学習日は, 新しい記録として始めれば十分です.",
  },
  "night-archivist": {
    motif: "archive",
    kicker: "ARCHIVE / RESULT CHECK",
    title: "今日の記録を, 正しい大きさで保存する.",
    meaning: "目標を超えた日として残せば, 気分が変わっても結果は変わらない.",
    next: "archiveには余白があっていい. 次の記録は, 次の日に追加します.",
  },
  "gouten-stomp": {
    motif: "impact",
    kicker: "AFTERSHOCK / RESULT CHECK",
    title: "地響きのあとに, 数字だけ確認する.",
    meaning: "今日の達成は, 遠慮して小さく言い換える必要がない.",
    next: "踏み込みは今日で終わり. 次の一歩まで勢いで消費しなくていい.",
  },
  "imura-rally": {
    motif: "market",
    kicker: "CLOSE / RESULT CHECK",
    title: "closing bellのあとに, 今日の数字を確定する.",
    meaning: "上振れは予想ではなく, 今日すでに出た結果として扱える.",
    next: "今日の上振れを, 明日の最低ラインにはしない. sessionはここでcloseです.",
  },
  "taiko-oni": {
    motif: "beat",
    kicker: "FINAL BEAT / RESULT CHECK",
    title: "最後の一打のあとに, 達成を確認する.",
    meaning: "目標を超えた日は, その事実を一度きちんと鳴らして終われる.",
    next: "次の拍は空けておく. 今日の達成に, 追加の一打は要りません.",
  },
  "night-examiner": {
    motif: "paper",
    kicker: "FINAL MARK / RESULT CHECK",
    title: "合格印のあとに, 判定根拠だけ残す.",
    meaning: "達成条件を満たしているので, 今日の判定は合格のまま変わらない.",
    next: "再採点は不要. 次の答案は, 次の学習日に開けば十分です.",
  },
  kotonoha: {
    motif: "twin",
    kicker: "AFTER TALK / RESULT CHECK",
    title: "喜んだあとに, 今日できたことをもう一回だけ確認する.",
    meaning: "目標を超えた日は, 遠慮せず今日の勝ちとして受け取ってええ.",
    next: "明日の分まで頑張らんでええで. 今日の達成は今日のまま, きれいに終わろう.",
  },
  "forge-fury": {
    motif: "forge",
    kicker: "COOL DOWN / RESULT CHECK",
    title: "火花が落ち着いたあとも, 結果は変わらない.",
    meaning: "達成後まで叩き続けなくても, 今日の数字はすでに形になっている.",
    next: "冷ます時間も仕上げの一部. 次に鍛えるのは, 次の学習日で十分です.",
  },
  "study-complete": {
    motif: "complete",
    kicker: "SESSION CLOSE / RESULT CHECK",
    title: "終わる前に, 今日の達成を正しく受け取る.",
    meaning: "todayStabilityDaysDeltaが目標以上なら, 今日の達成条件は満たされています.",
    next: "今日はここで閉じていい. 次の学習は, 次の一日として始めれば十分です.",
  },
};

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value.toLocaleString("ja-JP")}`;
}

function storyMarkup(story, celebration) {
  const delta = signed(celebration.todayStabilityDaysDelta);
  const target = signed(celebration.dailyStabilityDaysDeltaGoal);
  const marginValue =
    celebration.todayStabilityDaysDelta - celebration.dailyStabilityDaysDeltaGoal;
  const margin = signed(marginValue);
  const resultTitle = marginValue === 0
    ? `目標${target}日に, ${delta}日で届いた.`
    : `目標${target}日を, ${margin}日上回った.`;

  const chapters = [
    [
      "01",
      "TARGET",
      resultTitle,
      `todayStabilityDaysDeltaは${delta}日, dailyStabilityDaysDeltaGoalは${target}日. 今日の達成条件は満たされています.`,
    ],
    ["02", "MEANING", story.meaning, "結果を小さく言い換えず, 今日できたこととしてそのまま扱います."],
    ["03", "CLOSE", "今日は, 達成した日として閉じる.", story.next],
  ];

  return `
    <section class="scroll-epilogue" data-scroll-epilogue data-motif="${story.motif}" aria-labelledby="scroll-story-title">
      <div class="scroll-intro">
        <div class="scroll-intro-copy">
          <p class="scroll-kicker">${story.kicker}</p>
          <h2 id="scroll-story-title">${story.title}</h2>
          <p class="scroll-lead">達成値は${delta}日, 目標は${target}日. ここから先は, 今日の結果を過不足なく受け取るための3つの確認です.</p>
        </div>
        <div class="scroll-totem" aria-hidden="true">
          <span></span><span></span><span></span>
          <b>${marginValue === 0 ? "ON TARGET" : `MARGIN ${margin}`}</b>
        </div>
      </div>
      <div class="scroll-rail">
        ${chapters.map(([number, label, title, body], index) => `
          <article class="scroll-chapter" data-scroll-chapter="${index + 1}">
            <div class="scroll-chapter-copy">
              <p><span>${number}</span>${label}</p>
              <h3>${title}</h3>
              <div class="scroll-rule" aria-hidden="true"><i></i></div>
              <p class="scroll-body">${body}</p>
            </div>
            <div class="scroll-visual" aria-hidden="true">
              <span class="scroll-index">${number}</span>
              <i class="scroll-shape shape-a"></i>
              <i class="scroll-shape shape-b"></i>
              <i class="scroll-shape shape-c"></i>
            </div>
          </article>`).join("")}
      </div>
    </section>`;
}

function mountScrollDepth(root) {
  if (root.dataset.ready !== "true") return false;
  if (root.querySelector("[data-scroll-epilogue]")) return true;

  const siteId = document.documentElement.dataset.site;
  const story = stories[siteId];
  const footer = root.querySelector(".site-footer");
  if (!story) throw new Error("Scroll story is missing for this celebration site.");
  if (!(footer instanceof HTMLElement)) throw new Error("Celebration footer is missing.");

  const celebration = parseCelebration(window.location.search);
  footer.insertAdjacentHTML("beforebegin", storyMarkup(story, celebration));
  document.documentElement.dataset.scrollDepth = "ready";
  return true;
}

const root = document.querySelector("#celebration-root");
if (!(root instanceof HTMLElement)) throw new Error("Celebration root is missing.");

if (!mountScrollDepth(root)) {
  const observer = new MutationObserver(() => {
    if (mountScrollDepth(root)) observer.disconnect();
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-ready"] });
}
