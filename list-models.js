require('dotenv').config();
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

groq.models.list().then(r => {
  r.data.forEach(m => console.log(m.id));
});