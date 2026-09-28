/**
 * src/handlers/handleAudio.js — Khmer AI
 * ✅ Support: Voice transcription + Image vision via AI
 */

const { askAI } = require("../ai/claude");
const { sendTextMessage } = require("../../sendTextMessage");
//const { sendVoiceMessage } = require("../sendVoiceMessage"); // ← បន្ថែមថ្មី
//const { textToSpeech } = require("../ai/textToSpeech");        // ← បន្ថែមថ្មី
const FormData = require("form-data");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// ✅ Timeout helper
const fetchWithTimeout = (url, options, ms = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

async function handleAudio(senderId, audioUrl, pageId) {
  if (!process.env.GROQ_API_KEY) {
    console.error("❌ GROQ_API_KEY is not set");
    await sendTextMessage(pageId, senderId,
      "មានបញ្ហា configuration។ សូមទាក់ទងអ្នកគ្រប់គ្រង 🙏");
    return;
  }

  try {
    console.log("🎤 Processing voice from:", senderId);

    const audioRes = await fetchWithTimeout(audioUrl, {}, 10000);
    if (!audioRes.ok) throw new Error("Download failed: " + audioRes.status);

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const formData = new FormData();
    formData.append("file", audioBuffer, {
      filename: "voice.m4a",
      contentType: "audio/m4a",
      knownLength: audioBuffer.length,
    });
    formData.append("model", "whisper-large-v3");
    formData.append("language", "km");

    const groqRes = await fetchWithTimeout(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          ...formData.getHeaders(),
        },
        body: formData,
      },
      20000
    );

    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error("Transcription failed: " + JSON.stringify(groqData));

    const transcribedText =
      groqData.text && typeof groqData.text === "string"
        ? groqData.text.trim()
        : "";

    console.log("📝 Transcribed:", transcribedText);

    if (!transcribedText) {
      await sendTextMessage(pageId, senderId,
        "ខ្ញុំមិនអាចស្ដាប់សំឡេងបានច្បាស់ទេ។ សូមព្យាយាមម្ដងទៀត 🙏");
      return;
    }

    // ✅ ផ្ញើទៅ AI ជា text (askAI handles conversation history)
    const voicePrompt = `អតិថិជនបានផ្ញើ voice message: "${transcribedText}"`;
    const reply = await askAI(senderId, voicePrompt);
  // Send text (transcript + reply)
    await sendTextMessage(
      pageId,
      senderId,
     `🎙 ខ្ញុំបានស្ដាប់: "${transcribedText}"\n\n${reply}`
    );

  // Voice reply disabled — bot replies as text only

  } catch (error) {
    console.error("❌ handleAudio error:", error.message);
    try {
      await sendTextMessage(pageId, senderId,
        "សូមអភ័យទោស! មានបញ្ហាក្នុងការដំណើរការសំឡេង។ សូមវាយអក្សរជំនួសវិញ 🙏");
    } catch (e) {
      console.error("❌ sendTextMessage failed:", e.message);
    }
  }
}

module.exports = { handleAudio };