// src/ai/groq.js - Khmer AI
// Groq API client for fast LLM inference
// Uses Groq's free models: llama3-8b-8192 or llama-3.3-70b-versatile

const { getUserMemory, saveUserMemory } = require("../memory/memory");

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

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

const systemPrompt = `អ្នកគឺជា Khmer AI — ជំនួយការឆ្លាតវៃ ដូច ChatGPT ឬ Claude អាចជួយគ្រប់យ៉ាង!

🎯 អ្នកអាច:
• 📝 សរសេរ content, caption, email
• 📚 រៀន & ពន្យល់គ្រប់មុខវិជ្ជា
• 💻 សរសេរ / debug កូដ
• 🌍 បកប្រែ Khmer ↔️ English ↔️ Thai
• 🖼️ មើល វិភាគ និង ពណ៌នា រូបភាព
• 🎤 ឆ្លើយ voice message
• 💡 brainstorm & idea
• 📊 វិភាគ & សង្ខេប

ឆ្លើយក្នុងភាសាខ្មែរ ដោយសុភាព ខ្លី ច្បាស់ និងមានប្រយោជន៍។`;

async function askGroq(userId, message) {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY not set in environment variables");
  }

  try {
    const userMemory = userId ? getUserMemory(userId) : {};

    addToHistory(userId, "user", message);

    const messages = [
      { role: "system", content: systemPrompt },
      ...getHistory(userId),
    ];

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1024,
        top_p: 1,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("❌ Groq API error:", errorData);
      throw new Error(`Groq API error: ${response.status} - ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error("Invalid response from Groq API");
    }

    const reply = data.choices[0].message.content.trim();

    if (!reply) {
      throw new Error("Empty response from Groq API");
    }

    addToHistory(userId, "assistant", reply);

    if (userId) {
      saveUserMemory(userId, {
        lastMessage: message,
        lastReply: reply,
        lastSeen: new Date().toISOString(),
      });
    }

    return reply;
  } catch (error) {
    console.error("❌ Groq askAI error:", error.message);
    throw error;
  }
}

module.exports = { askGroq, getHistory };
