/**
 * src/handlers/handleImage.js — Khmer AI
 * Image analysis using Ollama (llava model)
 */

const { sendTextMessage } = require("./../../sendTextMessage");
const { addToHistory } = require("../ai/claude");
const fetch = require("node-fetch");

/**
 * Handle image message from user
 * @param {string} senderId
 * @param {string} imageUrl - URL of the image
 * @param {string} type - "image" | "video"
 * @param {string} pageId
 */
async function handleImage(senderId, imageUrl, type = "image", pageId) {}
  try {
    console.log("🖼️ Processing image from:", senderId);
    console.log("🔗 Image URL:", imageUrl);

    // Step 1: Download image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Failed to download image: ${imgRes.status}`);
    }

    const imageBuffer = await imgRes.buffer();
    const base64Image = imageBuffer.toString("base64");

    // Detect content type
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";

// Step 2: Send to Ollama Vision
const response = await fetch("http://localhost:11434/api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "llava",
    prompt: "សូមវិភាគរូបភាពនេះ ហើយប្រាប់ខញុំថាយ៉ាងម៉េច?",
    images: [base64Image],
    stream: false
  })
});

const data = await response.json();
const reply = data.response.trim();

console.log("✅ Ollama Vision reply:", reply.substring(0, 100));

// Save to history
addToHistory(senderId, "user", "[រូបភព]");
addToHistory(senderId, "assistant", reply);

// Step 3: Send reply
await sendTextMessage(pageId, senderId, `🖼 ${reply}`);

} catch (error) {
  console.error("❌ handleImage error:", error.message);
  try {
    await sendTextMessage(pageId, senderId, 
      "សុំទោស មិនអាច analyze រូបភាពបានទេ។");
  } catch(e) {}
};
