/**
 * src/ai/readVoiceFromUrl.js — Khmer AI
 * Transcribe voice messages from URL using Deepgram (or fallback)
 */

const axios = require("axios");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

/**
 * Transcribe audio from a public URL
 * @param {string} audioUrl
 * @returns {Promise<string>} transcribed text
 */
async function readVoiceFromUrl(audioUrl) {
  if (!DEEPGRAM_API_KEY) {
    console.warn("⚠️ DEEPGRAM_API_KEY not set — voice transcription unavailable");
    return "";
  }

  try {
    const response = await axios.post(
      "https://api.deepgram.com/v1/listen?language=km&model=nova-2",
      { url: audioUrl },
      {
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    const transcript =
      response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🎙️ Transcribed:", transcript);
    return transcript;
  } catch (err) {
    console.error("❌ readVoiceFromUrl error:", err.response?.data || err.message);
    return "";
  }
}

module.exports = { readVoiceFromUrl };
