const stories = {
  hikakin: {
    motif: "camera",
    kicker: "AFTERSHOW / KEEP THE CAMERA ROLLING",
    title: "拍手のあとも, 今日の努力は画面に残る.",
    lead: "一瞬の達成で終わらせず, 今日ここまで積み上げた時間を3つのsceneとして残します.",
    chapters: [
      ["01", "SPOTLIGHT", "やり切った瞬間", "正解だけではなく, 戻ってきた回数も今日の主役です. spotlightを当てる価値があります."],
      ["02", "REPLAY", "積み上げた過程", "最後の一問だけを切り取らず, そこへ到達するまでの選択ごと祝います."],
      ["03", "NEXT CUT", "次の自分へ", "今日の勢いを保存して, 次に机へ戻る自分へ最高のopening cutを渡します."],
    ],
  },
  "void-conductor": {
    motif: "orbit",
    kicker: "ENCORE / THE SKY IS STILL LISTENING",
    title: "喝采は, 一瞬で終わらない.",
    lead: "静かな継続を星のscoreに置き換えて, 達成の余韻を夜空の奥まで引き伸ばします.",
    chapters: [
      ["01", "FIRST MOVEMENT", "小さな音が重なった", "一問ごとの小さな音が, 今夜はひとつの旋律として聞こえています."],
      ["02", "FULL ORCHESTRA", "努力が厚みになった", "続けた時間は目立たなくても, 重なるほど簡単には消えない音になります."],
      ["03", "CODA", "次の一音を待つ", "今日の終止線は終わりではなく, 次の演奏を始めるための静かな余白です."],
    ],
  },
  "midnight-emcee": {
    motif: "stage",
    kicker: "ENCORE / THE HOUSE STAYS OPEN",
    title: "幕が下りる前に, 今日の主役をもう一度呼ぶ.",
    lead: "達成の瞬間だけではなく, backstageまで含めてひとつのshowとして見せる長い余韻を作ります.",
    chapters: [
      ["01", "CURTAIN CALL", "最後まで立っていた", "途中で重くなっても, stageを降りずに最後までやり切った事実が残っています."],
      ["02", "HOUSE LIGHTS", "客席まで届いた", "自分では小さく見えた進歩も, 少し離れて見れば十分に大きな変化です."],
      ["03", "ENCORE", "もう一度始められる", "今日の拍手を次回の最初の一歩へ変えて, encoreの入口だけを開けておきます."],
    ],
  },
  "midnight-orbit": {
    motif: "signal",
    kicker: "DEEP SPACE LOG / SIGNAL CONTINUES",
    title: "達成信号は, まだ遠くへ飛んでいく.",
    lead: "目標到達をひとつの点ではなく, 軌道, 通信, 次の航路という3段階のstoryとして展開します.",
    chapters: [
      ["01", "ORBIT LOCK", "軌道に乗った", "繰り返した選択がぶれを減らし, 今日の前進を安定した軌道へ変えました."],
      ["02", "TRANSMISSION", "信号を残した", "やり切った事実は消えません. 次に迷ったときへ届く記録として残ります."],
      ["03", "NEXT VECTOR", "次の方向を持つ", "速度より方向を大切にして, 今日の軌道から次の一歩へ自然につなげます."],
    ],
  },
  "clearance-officer": {
    motif: "stamp",
    kicker: "CASE FILE / SECONDARY REVIEW",
    title: "認可された達成には, 続きの記録がある.",
    lead: "checkpoint通過を一枚のstampで終わらせず, 証跡, 認可, 次の通行証まで正式な記録として並べます.",
    chapters: [
      ["01", "EVIDENCE", "前進を確認", "今日ここまで進んだことを, 気分ではなく完了した行動として記録します."],
      ["02", "CLEARANCE", "達成を正式認可", "迷いや失敗を含めた過程ごと, 今回のcheckpoint通過を有効な結果として扱います."],
      ["03", "NEXT ACCESS", "次区画を開放", "今日の認可は次へ進む権利です. 同じ場所で自分を再審査する必要はありません."],
    ],
  },
  "night-archivist": {
    motif: "archive",
    kicker: "ARCHIVE WING / RECORD EXPANDS",
    title: "今日の記録を, 一行で閉じない.",
    lead: "達成を星図の一部として保存し, 過去, 現在, 次章が連続して見える長いarchiveにします.",
    chapters: [
      ["01", "ENTRY", "今日を保存する", "やり切った瞬間だけでなく, そこへ戻ってきた過程まで今日の記録へ含めます."],
      ["02", "CONSTELLATION", "点を線に変える", "一日だけでは小さな点でも, 続けるほど過去の努力とつながって形になります."],
      ["03", "OPEN SHELF", "次章の余白を残す", "archiveは完成品ではありません. 次に積み上げる一日を受け取る場所を空けておきます."],
    ],
  },
  "gouten-stomp": {
    motif: "impact",
    kicker: "AFTERSHOCK / GROUND STILL MOVING",
    title: "一発の地響きでは, 今日の達成は収まらない.",
    lead: "勝ち四股のimpactを三段階へ広げて, 力をためた時間まで含めて豪快に見せます.",
    chapters: [
      ["01", "STANCE", "踏み込む前の力", "目立つ瞬間の前には, 何度も戻って構え直した時間があります."],
      ["02", "IMPACT", "地面を鳴らした", "今日の前進は小さく扱いません. やり切った分だけ大きく祝ってよい結果です."],
      ["03", "AFTERSHOCK", "余韻を次へ送る", "一度の達成で力を使い切らず, 次に踏み出す足へ地響きを残します."],
    ],
  },
  "imura-rally": {
    motif: "market",
    kicker: "CLOSING BELL / EXTENDED SESSION",
    title: "最高値のあとに, 今日の値動きを読み直す.",
    lead: "結果だけを大きく表示するのではなく, 上昇までの流れと次のsessionまで含めたmarket storyへ広げます.",
    chapters: [
      ["01", "OPEN", "積み上げが始まった", "最初から強かったのではなく, 一問ずつ戻るたびに今日の流れが作られました."],
      ["02", "BREAKOUT", "努力が上抜けた", "停滞した時間を含めても, 最後まで続けたことで今日の基準を更新できました."],
      ["03", "HOLD", "成果を持ち越す", "一日の急騰で終わらせず, 次の学習へ継続できる形で成果を持ち越します."],
    ],
  },
  "taiko-oni": {
    motif: "beat",
    kicker: "SECOND SET / FOUR ARMS STILL READY",
    title: "一打では足りない. 今日の努力を連打で残す.",
    lead: "地鳴りの演出を長いrhythmへ変えて, 続けた回数そのものがbeatとして見える構成にします.",
    chapters: [
      ["01", "COUNT IN", "戻ってきた回数", "集中が切れても, また一問へ戻るたびにrhythmは途切れず続いていました."],
      ["02", "FULL BEAT", "達成を鳴らし切る", "今日の結果を遠慮なく大きく鳴らして, やり切った事実を身体で感じられる余韻にします."],
      ["03", "NEXT RHYTHM", "次の拍を空ける", "最後の一打のあとに静けさを置いて, 次の学習が自然に始まる間を残します."],
    ],
  },
  "night-examiner": {
    motif: "paper",
    kicker: "POST MARKING / FILE REMAINS OPEN",
    title: "合格印のあとに, 今日の答案を読み返す.",
    lead: "判定だけで終わらず, 迷った跡, 更新できた理解, 次の答案まで含めて長い採点記録にします.",
    chapters: [
      ["01", "MARGIN NOTES", "迷った跡も残す", "止まった場所や戻った問題も, 理解を更新するために必要だった有効な痕跡です."],
      ["02", "PASS", "今日の結果を受け取る", "完璧さではなく, 今日やるべきところまで進んだことに合格印を押します."],
      ["03", "NEXT PAPER", "次の答案へ進む", "同じ採点を繰り返さず, 今日の結果を持ったまま次の問題へ進みます."],
    ],
  },
  kotonoha: {
    motif: "twin",
    kicker: "AFTER TALK / AKANE + AOI",
    title: "祝福は一言では足りない. もう少し一緒に喜ぶ.",
    lead: "琴葉姉妹のstageをafter talkまで広げて, 今日の良かったところを3つの場面でしっかり残します.",
    chapters: [
      ["01", "AKANE SIDE", "勢いよく褒める", "今日やり切ったことは遠慮せず大きく喜んでいい. まずは全力で祝います."],
      ["02", "AOI SIDE", "丁寧に振り返る", "派手な結果だけでなく, 投げずに続けたことも同じくらい大切な達成です."],
      ["03", "TWIN MESSAGE", "次も一緒に祝える", "今日の達成を次回の自信へ変えて, また祝える日へ軽く背中を押します."],
    ],
  },
  "forge-fury": {
    motif: "forge",
    kicker: "COOLING LINE / THE METAL HOLDS",
    title: "火花が消えても, 鍛えた実績は残る.",
    lead: "一度のhammer strikeだけで終わらせず, 加熱, 鍛造, 冷却まで通して今日の努力を実績へ変えます.",
    chapters: [
      ["01", "HEAT", "続けた時間を熱にする", "簡単ではなかった時間ほど, 今日の実績を鍛えるための熱として意味があります."],
      ["02", "STRIKE", "実績へ形を与える", "やり切った瞬間にhammerを落として, 曖昧だった努力へ輪郭を与えます."],
      ["03", "TEMPER", "次でも使える強さにする", "達成の熱をそのまま消費せず, 次の課題でも使える落ち着いた自信へ変えます."],
    ],
  },
  "study-complete": {
    motif: "complete",
    kicker: "SESSION ARCHIVE / COMPLETION HAS DEPTH",
    title: "完了画面を, 終了の一枚だけにしない.",
    lead: "今日を閉じる前に, 戻ったこと, やり切ったこと, 次へ残すことを順番に見せます.",
    chapters: [
      ["01", "RETURN", "今日も戻ってきた", "手応えがなくても机へ戻ったことが, 今日のsessionを成立させた最初の達成です."],
      ["02", "COMPLETE", "ここまでを終えた", "途中の不安を含めても, 今日積むべきところまで進めた事実は変わりません."],
      ["03", "READY", "次へ余力を残す", "満足感を使い切らず, 次に始める自分が少し楽になる形で今日を閉じます."],
    ],
  },
};

function storyMarkup(story) {
  return `
    <section class="scroll-epilogue" data-scroll-epilogue data-story-motif="${story.motif}" aria-labelledby="scroll-story-title">
      <div class="scroll-intro">
        <div class="scroll-intro-copy">
          <p class="scroll-kicker">${story.kicker}</p>
          <h2 id="scroll-story-title">${story.title}</h2>
          <p class="scroll-lead">${story.lead}</p>
        </div>
        <div class="scroll-totem" aria-hidden="true"><span></span><span></span><span></span><b>SCROLL</b></div>
      </div>
      <div class="scroll-rail">
        ${story.chapters.map(([number, label, title, body], index) => `
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

  footer.insertAdjacentHTML("beforebegin", storyMarkup(story));
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
