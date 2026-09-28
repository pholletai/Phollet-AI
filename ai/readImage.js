/**
 * src/ai/readImage.js — Khmer AI
 * Analyze images using Claude Vision API
 */

const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Download image from URL and return base64
 * @param {string} url
 * @returns {Promise<{base64: string, mediaType: string}>}
 */
async function fetchImageAsBase64(url) {
  const response = await axios.get(url, { responseType: "arraybuffer" });
  const base64 = Buffer.from(response.data).toString("base64");
  const contentType = response.headers["content-type"] || "image/jpeg";
  const mediaType = contentType.split(";")[0].trim();
  return { base64, mediaType };
}

/**
 * Analyze an image from a URL using Claude Vision
 * @param {string} imageUrl
 * @param {string} [prompt]
 * @returns {Promise<string>}
 */
async function readImageFromUrl(imageUrl, prompt = "សូមពិពណ៌នាអំពីរូបភាពនេះជាភាសាខ្មែរ។ អ្វីដែលអ្នកឃើញ?") {
  try {
    const { base64, mediaType } = await fetchImageAsBase64(imageUrl);

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    return response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (err) {
    console.error("❌ readImageFromUrl error:", err.message);
    throw err;
  }
}

module.exports = { readImageFromUrl };
