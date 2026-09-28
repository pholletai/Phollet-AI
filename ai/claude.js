// src/ai/claude.js
// Updated to use Groq API instead of local port 5000

const { askGroq } = require("./groq");

/**
 * សួរឆ្លើយ AI ដោយប្រើ Groq API
 * @param {string} senderId - User ID
 * @param {string} message - User message
 * @returns {Promise<string>} - AI response in Khmer
 */
async function askAI(senderId, message) {
    try {
        const userId = senderId || "app-user";
        const reply = await askGroq(userId, message);
        return reply || "សូមភ័យទោស! មិនអាចទាញយកចម្លើយបានទេ។";
    } catch (error) {
        console.error("❌ askAI error:", error.message);
        return "សូមអភ័យទោស! ប្រព័ន្ធ AI មិនដំណើរការទេនៅពេលនេះ។ សូមព្យាយាមម្ដងទៀត។";
    }
}

/**
 * ឆ្លើយសួរជាមួយរូបភាព
 * @param {string} senderId - User ID
 * @param {string} imageBase64 - Base64 encoded image (not used by Groq yet, future enhancement)
 * @param {string} mediaType - Media type of image (not used by Groq yet)
 * @param {string} userCaption - User's caption or question
 * @returns {Promise<string>} - AI response
 */
async function askAIWithImage(senderId, imageBase64, mediaType, userCaption) {
    try {
        const userId = senderId || "app-user";
        const message = userCaption || "សូមវិភាគរូបភាពនេះ";
        const reply = await askGroq(userId, message);
        return reply || "សូមភ័យទោស! មិនអាចវិភាគរូបភាពបានទេ។";
    } catch (error) {
        console.error("❌ askAIWithImage error:", error.message);
        return "សូមអភ័យទោស! មានបញ្ហាក្នុងការវិភាគរូបភាព។";
    }
}

module.exports = { askAI, askAIWithImage };