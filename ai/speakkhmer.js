/**
 * src/ai/speakkhmer.js — Khmer AI
 * Khmer language text normalization and speech helpers
 */

/**
 * Normalize Khmer text for TTS — remove markdown, trim whitespace
 * @param {string} text
 * @returns {string}
 */
function normalizeForSpeech(text = "") {
  return String(text)
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Detect if text is primarily Khmer script
 * @param {string} text
 * @returns {boolean}
 */
function isKhmer(text = "") {
  const khmerChars = (text.match(/[ក-៿]/g) || []).length;
  return khmerChars > text.length * 0.3;
}

/**
 * Choose reply language based on input language
 * @param {string} userText
 * @returns {"km"|"en"|"th"}
 */
function detectLanguage(userText = "") {
  const t = String(userText);
  if (isKhmer(t)) return "km";
  const thaiChars = (t.match(/[฀-๿]/g) || []).length;
  if (thaiChars > t.length * 0.3) return "th";
  return "en";
}

module.exports = { normalizeForSpeech, isKhmer, detectLanguage };
