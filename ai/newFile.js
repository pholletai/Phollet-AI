/**
 * src/ai/newFile.js — Khmer AI
 * Utility helpers for AI modules
 */

/**
 * Trim and normalize a string (remove extra whitespace, null-safe)
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text = "") {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Truncate text to a max character count, appending "..." if cut
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function truncate(text = "", max = 500) {
  const t = normalizeText(text);
  return t.length > max ? t.slice(0, max) + "..." : t;
}

/**
 * Sleep for ms milliseconds
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { normalizeText, truncate, sleep };
