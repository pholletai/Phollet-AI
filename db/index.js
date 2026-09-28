// db/index.js
// Postgres connection (Neon) + tiny helpers that mirror the better-sqlite3 API style.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set in .env');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL
});

// Run a parameterized query. Returns the full pg Result object.
const query = (text, params) => pool.query(text, params);

// First row or null. Mirrors db.prepare(...).get() from better-sqlite3.
const queryOne = async (text, params) => {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
};

// All rows (empty array if none). Mirrors db.prepare(...).all().
const queryAll = async (text, params) => {
  const r = await pool.query(text, params);
  return r.rows;
};

// Run every statement in db/schema.sql. Safe to call on every startup.
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✅ Schema ready');
}

module.exports = { pool, query, queryOne, queryAll, initSchema };
