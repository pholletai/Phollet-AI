/**
 * src/ai/readVoice.js — Khmer AI
 * Transcribe a local audio file buffer using Deepgram
 */

const axios = require("axios");
const fs = require("fs");

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

/**
 * Transcribe a local audio file
 * @param {string} filePath - absolute path to audio file
 * @returns {Promise<string>} transcribed text
 */
async function readVoice(filePath) {
  if (!DEEPGRAM_API_KEY) {
    console.warn("⚠️ DEEPGRAM_API_KEY not set — voice transcription unavailable");
    return "";
  }

  try {
    const audioBuffer = fs.readFileSync(filePath);

    const response = await axios.post(
      "https://api.deepgram.com/v1/listen?language=km&model=nova-2",
      audioBuffer,
      {
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": "audio/wav",
        },
      }
    );

    const transcript =
      response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";

    console.log("🎙️ Transcribed:", transcript);
    return transcript;
  } catch (err) {
    console.error("❌ readVoice error:", err.response?.data || err.message);
    return "";
  }
}

module.exports = { readVoice };
