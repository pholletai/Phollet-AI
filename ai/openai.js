/**
 * src/ai/openai.js — Khmer AI
 * OpenAI GPT fallback (used when Claude is unavailable)
 */

const { getUserMemory, saveUserMemory } = require("../memory/memory");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const conversationHistory = {};
const MAX_HISTORY = 20;

function addToHistory(userId, role, content) {
  if (!conversationHistory[userId]) conversationHistory[userId] = [];
  conversationHistory[userId].push({ role, content });
  if (conversationHistory[userId].length > MAX_HISTORY) {
    conversationHistory[userId] = conversationHistory[userId].slice(-MAX_HISTORY);
  }
}

function getHistory(userId) {
  return conversationHistory[userId] || [];
}

/**
 * Ask OpenAI GPT-4o
 * @param {string} userId
 * @param {string} message
 * @returns {Promise<string>}
 */
async function askOpenAI(userId, message) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const userMemory = userId ? getUserMemory(userId) : {};

  const systemPrompt =
    "អ្នកគឺ Khmer AI ជំនួយការឆ្លាតវៃ។ ឆ្លើយជាភាសាខ្មែរ ច្បាស់ ខ្លី និងរួសរាយ។\n" +
    `User context: ${JSON.stringify(userMemory)}`;

  addToHistory(userId, "user", message);

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1024,
    messages: [
      { role: "system", content: systemPrompt },
      ...getHistory(userId),
    ],
  });

  const reply = response.choices[0]?.message?.content?.trim() || "";

  if (!reply) throw new Error("Empty response from OpenAI");

  addToHistory(userId, "assistant", reply);

  if (userId) {
    saveUserMemory(userId, {
      lastMessage: message,
      lastReply: reply,
      lastSeen: new Date().toISOString(),
    });
  }

  return reply;
}

module.exports = { askOpenAI, getHistory };
