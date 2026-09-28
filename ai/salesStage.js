/**
 * src/ai/salesStage.js — Khmer AI
 * Detect and track customer sales stage
 */

const STAGE_ORDER = ["warm", "interested", "pricing", "ready_to_close", "closed"];

/**
 * Detect sales stage from message text
 * @param {string} text
 * @returns {string} stage
 */
function detectStage(text = "") {
  const t = String(text).toLowerCase();

  if (
    t.includes("ទិញ") ||
    t.includes("ចាប់ផ្ដើម") ||
    t.includes("ចាប់ផ្តើម") ||
    t.includes("ព្រម") ||
    t.includes("ok ហើយ") ||
    t.includes("agree") ||
    t.includes("sign up") ||
    t.includes("pay") ||
    t.includes("បង់")
  ) {
    return "ready_to_close";
  }

  if (
    t.includes("តម្លៃ") ||
    t.includes("ថ្លៃ") ||
    t.includes("price") ||
    t.includes("package") ||
    t.includes("plan") ||
    t.includes("$") ||
    t.includes("dollar") ||
    t.includes("ប៉ុន្មាន")
  ) {
    return "pricing";
  }

  if (
    t.includes("ចង់") ||
    t.includes("interested") ||
    t.includes("bot") ||
    t.includes("chat") ||
    t.includes("ai") ||
    t.includes("messenger") ||
    t.includes("ឆ្លើយ") ||
    t.includes("ស្វ័យប្រវត្តិ") ||
    t.includes("auto")
  ) {
    return "interested";
  }

  return "warm";
}

/**
 * Return the more advanced of two stages
 * @param {string} stage1
 * @param {string} stage2
 * @returns {string}
 */
function getHigherStage(stage1, stage2) {
  const idx1 = STAGE_ORDER.indexOf(stage1 || "warm");
  const idx2 = STAGE_ORDER.indexOf(stage2 || "warm");
  const i1 = idx1 === -1 ? 0 : idx1;
  const i2 = idx2 === -1 ? 0 : idx2;
  return i1 >= i2 ? STAGE_ORDER[i1] : STAGE_ORDER[i2];
}

module.exports = { detectStage, getHigherStage, STAGE_ORDER };

