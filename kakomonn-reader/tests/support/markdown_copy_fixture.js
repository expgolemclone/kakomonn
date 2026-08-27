const assert = require("node:assert/strict");

const MARKDOWN_QUESTION_URL =
  "https://chushoks.kakomonn.com/questions/54914";
const MARKDOWN_QUESTION_HEADING =
  "中小企業診断士試験 令和2年度（2020年） 問19（経済学・経済政策 問19）";
const MARKDOWN_QUESTION_TEXT =
  "農業保護を目的とした農家への補助金政策の効果を考える。下図において、Dは農産物の需要曲線、Sは補助金交付前の農産物の供給曲線、S’は補助金交付後の農産物の供給曲線である。政府は、農産物1単位当たりEFまたはHGの補助金を交付する。この図に関する記述として、最も適切なものの組み合わせを下記の解答群から選べ。 a 政府が交付した補助金は四角形ACFEである。 b 補助金の交付によって、消費者の余剰は四角形ABGEだけ増加する。 c 補助金の交付によって、総余剰は三角形EFGだけ増加する。 d 補助金の交付によって、農家の余剰は四角形BCFGだけ増加する。";
const MARKDOWN_ANSWER_TEXT = "b と d";
const MARKDOWN_ANSWER_SUMMARY = "選択肢4: b と d";
const MARKDOWN_INCORRECT_ANSWER_TEXT = "a と b";
const MARKDOWN_INCORRECT_ANSWER_SUMMARY = "選択肢1: a と b";
const MARKDOWN_CHOICES = ["a と b", "a と c", "b と c", "b と d"];
const MARKDOWN_EXPLANATION_PREFIXES = [
  "ミクロ経済学における余剰分析が政府の介入",
  "補助金政策の効果を踏まえた余剰分析です",
  "余剰分析問題です",
];
const MARKDOWN_QUESTION_IMAGE_URLS = [
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/question/chushoks/2020/A17.jpg",
];
const MARKDOWN_EXPLANATION_IMAGE_URLS = [
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/cl/expound/chushoks/44914/gP0GXvEGxcXBlXqlyfyR_403736.webp",
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/cl/expound/chushoks/44914/TOoIgrKbHDVDGDV30wx8_403736.webp",
  "https://s3.ap-northeast-1.amazonaws.com/img.kakomonn.com/images/cl/expound/chushoks/44914/vp82EPWKAlXtoun1ZLsK_403736.webp",
];

function normalizeContent(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function compactCopiedContent(markdown) {
  return markdown
    .replace(/^!\[[^\]]*]\([^)]+\)$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\\([*_`\[\]#>+-])/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/<\/?(?:sup|sub)>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, "");
}

function assertMarkdownCopy({
  answerSummary = MARKDOWN_ANSWER_SUMMARY,
  choices,
  copiedMarkdown,
  explanationContents,
  questionText,
}) {
  assert.equal(
    copiedMarkdown.startsWith(`# ${MARKDOWN_QUESTION_HEADING}\n\n`),
    true,
  );
  assert.equal(copiedMarkdown.includes("\n\n## 問題文\n\n"), true);
  assert.equal(copiedMarkdown.includes("\n\n### 選択肢\n\n"), true);
  assert.equal(
    copiedMarkdown.includes(
      `\n\n### 自分の回答\n\n${answerSummary}\n\n`,
    ),
    true,
  );
  assert.equal(copiedMarkdown.includes("\n\n## 解説\n\n"), true);
  for (const choice of choices) {
    assert.equal(
      copiedMarkdown.includes(`- ${choice.replace(/\s+/g, " ").trim()}`),
      true,
    );
  }

  const compactMarkdown = compactCopiedContent(copiedMarkdown);
  assert.equal(
    compactMarkdown.includes(questionText.replace(/\s+/g, "")),
    true,
  );
  for (const explanationContent of explanationContents) {
    assert.equal(
      compactMarkdown.includes(explanationContent.replace(/\s+/g, "")),
      true,
    );
  }

  const expectedImageURLs = [
    ...MARKDOWN_QUESTION_IMAGE_URLS,
    ...MARKDOWN_EXPLANATION_IMAGE_URLS,
  ];
  const copiedImageURLs = Array.from(
    copiedMarkdown.matchAll(/!\[[^\]]*]\((https:\/\/[^)]+)\)/g),
    (match) => match[1],
  );
  assert.deepEqual(copiedImageURLs, expectedImageURLs);
  for (const imageURL of expectedImageURLs) {
    assert.equal(copiedMarkdown.split(imageURL).length - 1, 1);
  }

  assert.equal(copiedMarkdown.includes("訂正依頼・報告はこちら"), false);
  assert.equal(copiedMarkdown.includes("参考になった数"), false);
  assert.equal(copiedMarkdown.includes("Advertisement"), false);
}

module.exports = {
  assertMarkdownCopy,
  MARKDOWN_ANSWER_TEXT,
  MARKDOWN_CHOICES,
  MARKDOWN_INCORRECT_ANSWER_SUMMARY,
  MARKDOWN_INCORRECT_ANSWER_TEXT,
  MARKDOWN_EXPLANATION_IMAGE_URLS,
  MARKDOWN_EXPLANATION_PREFIXES,
  MARKDOWN_QUESTION_HEADING,
  MARKDOWN_QUESTION_IMAGE_URLS,
  MARKDOWN_QUESTION_TEXT,
  MARKDOWN_QUESTION_URL,
  normalizeContent,
};
