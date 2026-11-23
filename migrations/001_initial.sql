CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
 preferred_currency TEXT NOT NULL DEFAULT 'INR',
 disabled INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE TABLE IF NOT EXISTS calculator_types (
 type TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 category TEXT NOT NULL,
 fields_json TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS calculations (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 calculator_type TEXT NOT NULL REFERENCES calculator_types(type),
 name TEXT NOT NULL,
 currency TEXT NOT NULL,
 inputs_json TEXT NOT NULL,
 outputs_json TEXT NOT NULL,
 assumptions_json TEXT NOT NULL,
 formula_version TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS calculations_user_date_idx ON calculations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comparisons (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 metric TEXT NOT NULL,
 best_plan TEXT NOT NULL,
 assumptions_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS comparison_plans (
 id INTEGER PRIMARY KEY,
 comparison_id INTEGER NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 calculator_type TEXT NOT NULL REFERENCES calculator_types(type),
 inputs_json TEXT NOT NULL,
 outputs_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS exchange_rates (
 id INTEGER PRIMARY KEY,
 base_currency TEXT NOT NULL,
 quote_currency TEXT NOT NULL,
 rate REAL NOT NULL CHECK(rate > 0),
 source TEXT NOT NULL,
 effective_at TEXT NOT NULL,
 valid_until TEXT,
 created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK(base_currency <> quote_currency)
);
CREATE INDEX IF NOT EXISTS rates_pair_date_idx ON exchange_rates(base_currency, quote_currency, effective_at DESC);

CREATE TABLE IF NOT EXISTS reports (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 calculation_id INTEGER NOT NULL REFERENCES calculations(id) ON DELETE CASCADE,
 format TEXT NOT NULL CHECK(format IN ('pdf','xlsx')),
 include_graph INTEGER NOT NULL DEFAULT 1,
 filename TEXT NOT NULL,
 content_type TEXT NOT NULL,
 file_data BLOB NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS reports_user_date_idx ON reports(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_activity (
 id INTEGER PRIMARY KEY,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL,
 details_json TEXT NOT NULL DEFAULT '{}',
 ip TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS activity_date_idx ON system_activity(created_at DESC);
