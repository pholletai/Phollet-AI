/**
 * src/ai/sendVoiceMessage.js — Khmer AI
 * Convert text to speech then send as audio via Messenger
 */

const { textToSpeech } = require("./textToSpeech");
const { sendAudioMessage } = require("../messenger/sendVoiceMessage");

/**
 * Convert text to audio and send to user on Messenger
 * @param {string} pageId
 * @param {string} recipientId
 * @param {string} text
 */
async function sendVoiceReply(pageId, recipientId, text) {
  try {
    const audioBuffer = await textToSpeech(text);
    await sendAudioMessage(pageId, recipientId, audioBuffer);
    console.log("✅ Voice message sent to", recipientId);
  } catch (err) {
    console.error("❌ sendVoiceReply error:", err.message);
    throw err;
  }
}

module.exports = { sendVoiceReply };
