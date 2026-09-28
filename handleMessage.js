/**
 * src/handlers/handleMessage.js — Khmer AI
 * Routes incoming Messenger events to the right handler
 */

const handleText = require("./handleText");
const handleImage = require("./handleImage");
const handleAudio = require("./handleAudio");

/**
 * @param {string} senderId
 * @param {object} message  - event.message from Messenger webhook
 * @param {string} pageId
 */
async function handleMessage(senderId, message, pageId) {
  if (!senderId || !message) return;
  if (message.is_echo) return;

  const attachments = message.attachments || [];

  // Text message
  if (message.text) {
    return handleText(senderId, message.text, pageId);
  }

  // Attachment messages
  for (const attachment of attachments) {
    const type = attachment.type;
    const url = attachment.payload?.url;

    if (type === "audio") {
      return handleAudio(senderId, url, pageId);
    }

    if (type === "image" || type === "video") {
      return handleImage(senderId, url, type, pageId);
    }

    // Fallback for unknown attachment types
    const { sendTextMessage } = require("../../sendTextMessage");
    await sendTextMessage(pageId, senderId, "បានទទួល attachment រួចហើយ! តើខ្ញុំអាចជួយអ្វីបន្ថែមទៀតទេ?");
  }
}

module.exports = handleMessage;
