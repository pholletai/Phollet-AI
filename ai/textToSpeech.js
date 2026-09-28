/**
 * src/ai/textToSpeech.js — Khmer AI
 * Convert text to speech audio buffer using ElevenLabs or Google TTS
 */

const axios = require("axios");

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

/**
 * Convert text to audio buffer via ElevenLabs
 * @param {string} text
 * @returns {Promise<Buffer>} audio buffer (mp3)
 */
async function textToSpeech(text) {
  if (!ELEVENLABS_API_KEY) {
    throw new Error("ELEVENLABS_API_KEY not set");
  }

  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
    {
      text: String(text || "").trim(),
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    },
    {
      headers: {
        "xi-api-key": ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      responseType: "arraybuffer",
    }
  );

  return Buffer.from(response.data);
}

module.exports = { textToSpeech };
