/**
 * src/handlers/handleText.js — Khmer AI
 * Handle plain-text Messenger messages
 */

const { askAI } = require("../ai/claude");
const { addHistory, getUserMemory, saveUserMemory } = require("../memory/memory");
const { detectStage, getHigherStage } = require("../ai/salesStage");
const { sendTextMessage } = require("../../sendTextMessage");

/**
 * @param {string} senderId
 * @param {string} text
 * @param {string} pageId
 */
async function handleText(senderId, text, pageId) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;

  // Update sales stage
  const userMemory = getUserMemory(senderId);
  const detected = detectStage(trimmed);
  const stage = getHigherStage(userMemory.stage, detected);
  saveUserMemory(senderId, { stage });

  addHistory(senderId, "user", trimmed);

  let reply;
  try {
    reply = await askAI(senderId, trimmed);
  } catch (err) {
    console.error("❌ handleText askAI error:", err.message);
    reply = "សូមទោស! មានបញ្ហាបណ្ដោះអាសន្ន។ សូមព្យាយាមម្ដងទៀត។";
  }

  addHistory(senderId, "assistant", reply);

  await sendTextMessage(pageId, senderId, reply);
}

module.exports = handleText;
