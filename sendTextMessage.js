/**
 * sendTextMessage.js — Khmer AI
 * Send a text message to a Messenger recipient via Facebook Graph API
 */

require("dotenv").config();
const axios = require("axios");
const crypto = require("crypto");

/**
 * Generate appsecret_proof for Facebook API security
 */
function generateAppSecretProof(accessToken) {
  const appSecret = process.env.APP_SECRET;
  if (!appSecret) throw new Error("APP_SECRET is not set in .env");
  return crypto.createHmac("sha256", appSecret).update(accessToken).digest("hex");
}

/**
 * Send a plain-text message to a Messenger user
 * @param {string} pageId        - Facebook Page ID (used to look up page token)
 * @param {string} recipientId   - Messenger sender ID (PSID)
 * @param {string} text          - Message text to send
 * @returns {Promise<object>}    - Facebook API response
 */
async function sendTextMessage(pageId, recipientId, text) {
  // Support per-page tokens (PAGE_TOKEN_<pageId>) or a global fallback
  const pageToken =
    process.env[`PAGE_TOKEN_${pageId}`] || process.env.PAGE_ACCESS_TOKEN;

  if (!pageToken) {
    throw new Error(
      `No page access token found for pageId "${pageId}". ` +
        `Set PAGE_ACCESS_TOKEN or PAGE_TOKEN_${pageId} in your .env file.`
    );
  }

  const body = {
    recipient: { id: recipientId },
    message: { text: String(text || "").trim() },
    messaging_type: "RESPONSE",
  };

  try {
    const response = await axios.post(
      "https://graph.facebook.com/v19.0/me/messages",
      body,
      {
        params: {
          access_token: pageToken,
          appsecret_proof: generateAppSecretProof(pageToken),
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    console.log(`✅ Message sent to ${recipientId} (mid: ${response.data.message_id})`);
    return response.data;
  } catch (err) {
    const fbError = err.response?.data?.error;
    console.error(
      "❌ sendTextMessage error:",
      fbError ? `[${fbError.code}] ${fbError.message}` : err.message
    );
    throw err;
  }
}

module.exports = { sendTextMessage };