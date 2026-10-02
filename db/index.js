// db/index.js
// Postgres connection (Neon) + tiny helpers that mirror the better-sqlite3 API style.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }, // Neon requires SSL
    })
  : null;

function getPool() {
  if (!pool) {
    throw new Error('DATABASE_URL is not configured');
  }
  return pool;
}

// Run a parameterized query. Returns the full pg Result object.
const query = (text, params) => getPool().query(text, params);

// First row or null. Mirrors db.prepare(...).get() from better-sqlite3.
const queryOne = async (text, params) => {
  const r = await getPool().query(text, params);
  return r.rows[0] || null;
};

// All rows (empty array if none). Mirrors db.prepare(...).all().
const queryAll = async (text, params) => {
  const r = await getPool().query(text, params);
  return r.rows;
};

// Run every statement in db/schema.sql. Safe to call on every startup.
async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await getPool().query(sql);
  console.log('✅ Schema ready');
}

module.exports = { pool, query, queryOne, queryAll, initSchema };
