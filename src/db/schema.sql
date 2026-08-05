-- TempeMail D1 schema
-- All timestamps are stored in ISO 8601 (UTC).

CREATE TABLE IF NOT EXISTS inboxes (
  address TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+24 hours'))
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  inbox_address TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT DEFAULT '',
  subject TEXT DEFAULT '(no subject)',
  body TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  raw_headers TEXT DEFAULT '',
  spf TEXT DEFAULT 'unknown',
  dkim TEXT DEFAULT 'unknown',
  dmarc TEXT DEFAULT 'unknown',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT DEFAULT 'application/octet-stream',
  size INTEGER DEFAULT 0,
  r2_key TEXT DEFAULT '',
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_inboxes (
  session_id TEXT NOT NULL,
  inbox_address TEXT NOT NULL,
  PRIMARY KEY (session_id, inbox_address),
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

-- Phase 2: API key auth (agents/scripts, no browser session)
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT DEFAULT '',
  revoked INTEGER DEFAULT 0
);

-- Phase 2: API key ↔ inbox ownership (agent can only touch its own inboxes)
CREATE TABLE IF NOT EXISTS api_key_inboxes (
  api_key_id INTEGER NOT NULL,
  inbox_address TEXT NOT NULL,
  PRIMARY KEY (api_key_id, inbox_address),
  FOREIGN KEY (api_key_id) REFERENCES api_keys(id),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

-- Phase 2: webhook subscriptions per inbox
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inbox_address TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT DEFAULT '',
  events TEXT DEFAULT 'new_message',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (inbox_address) REFERENCES inboxes(address)
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(inbox_address, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_inbox ON webhooks(inbox_address);
