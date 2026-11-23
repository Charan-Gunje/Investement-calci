import './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { calculatorCatalog } from './calculators.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Vercel functions have a read-only filesystem; only /tmp is writable.
const defaultFilename = process.env.VERCEL ? '/tmp/investly.sqlite' : './data/investly.sqlite';
const filename = process.env.DATABASE_PATH || defaultFilename;
fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
export const db = new DatabaseSync(filename);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');

db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, filename TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version));
const migrationDir = path.join(root, 'migrations');
for (const filename of fs.readdirSync(migrationDir).filter(name => name.endsWith('.sql')).sort()) {
  const match = filename.match(/^(\d+)_/);
  if (!match) continue;
  const version = Number(match[1]);
  if (applied.has(version)) continue;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(fs.readFileSync(path.join(migrationDir, filename), 'utf8'));
    db.prepare('INSERT INTO schema_migrations(version,filename) VALUES(?,?)').run(version, filename);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

const insertType = db.prepare('INSERT INTO calculator_types(type,name,description,category,fields_json) VALUES(?,?,?,?,?) ON CONFLICT(type) DO NOTHING');
for (const item of calculatorCatalog) insertType.run(item.type, item.name, item.description, item.category, JSON.stringify(item.fields));

export function logActivity(userId, action, details = {}, ip = '') {
  db.prepare('INSERT INTO system_activity(user_id,action,details_json,ip) VALUES(?,?,?,?)').run(userId ?? null, action, JSON.stringify(details), ip);
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = fn(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
