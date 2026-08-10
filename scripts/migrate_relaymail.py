#!/usr/bin/env python3
"""Migrate relaymail-db -> tempe-mail-db via Cloudflare D1 API (BATCHED, FIXED HTML).

relaymail stores RAW HTML in messages.body, body_html empty.
tempe-mail: body_html = html, body = plaintext (strip tags).
Small batch for messages (huge bodies). Idempotent (INSERT OR IGNORE).
"""
import json, os, re, time, urllib.request, urllib.error
from datetime import datetime, timedelta

ACCOUNT = os.environ["CLOUDFLARE_ACCOUNT_ID"]
TOKEN = os.environ["CLOUDFLARE_API_TOKEN"]
SRC = "a4d1c836-1c92-4d46-ae98-ba34cc3849d1"   # relaymail-db
DST = "b75e5426-9b64-4de3-9727-94cf79f7b358"   # tempe-mail-db
BATCH = 100
MSG_BATCH = 5

def api(dbid, sql):
    url = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{dbid}/query"
    body = json.dumps({"sql": sql}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            if not d.get("success"):
                raise RuntimeError(f"API error: {d.get('errors')}")
            rows = []
            for t in d.get("result", []):
                rows.extend(t.get("results", []))
            return rows
        except (urllib.error.URLError, RuntimeError) as e:
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))

def esc(s):
    if s is None: return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

def expiry(created_at):
    try:
        dt = datetime.strptime(created_at, "%Y-%m-%d %H:%M:%S")
    except Exception:
        return "datetime('now')"
    return "'" + (dt + timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S") + "'"

def html_to_text(html):
    """Crude HTML->text: strip tags, decode common entities, collapse whitespace."""
    if not html: return ""
    t = re.sub(r'<style.*?</style>', ' ', html, flags=re.S | re.I)
    t = re.sub(r'<script.*?</script>', ' ', t, flags=re.S | re.I)
    t = re.sub(r'<br\s*/?>', '\n', t, flags=re.I)
    t = re.sub(r'</(p|div|tr|li|h[1-6])>', '\n', t, flags=re.I)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = t.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"').replace('&#39;', "'")
    return re.sub(r'[ \t]+', ' ', t).strip()

def chunk(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i+n]

def migrate(table, fetch_sql, build_insert, label, batch_size=BATCH):
    total = 0
    offset = 0
    while True:
        rows = api(SRC, fetch_sql(offset, batch_size))
        if not rows:
            break
        for batch in chunk(rows, batch_size):
            sql = build_insert(batch)
            if sql:
                api(DST, sql)
                total += len(batch)
                print(f"  {label}: {total} ({offset+len(batch)} fetched)", flush=True)
        offset += batch_size
    return total

def main():
    print("=== Migrating relaymail-db -> tempe-mail-db (BATCHED v2) ===", flush=True)

    # 1. inboxes
    def fetch_inbox(offset, lim):
        return f"SELECT address, created_at FROM inboxes ORDER BY created_at LIMIT {lim} OFFSET {offset}"
    def ins_inbox(batch):
        vals = ", ".join(f"({esc(r['address'])}, {esc(r['created_at'])}, {expiry(r['created_at'])})" for r in batch)
        return f"INSERT OR IGNORE INTO inboxes (address, created_at, expires_at) VALUES {vals}"
    n_inbox = migrate("inboxes", fetch_inbox, ins_inbox, "inboxes")

    # 2. messages — body_html = raw html body, body = plaintext
    def fetch_msg(offset, lim):
        return f"SELECT id, inbox_address, from_address, subject, body, received_at FROM messages ORDER BY received_at LIMIT {lim} OFFSET {offset}"
    def ins_msg(batch):
        vals = ", ".join(
            f"({esc(r['id'])}, {esc(r['inbox_address'])}, {esc(r['from_address'])}, '', {esc(r['subject'])}, {esc(html_to_text(r['body']))}, {esc(r['body'])}, '', 'unknown', 'unknown', 'unknown', {esc(r['received_at'])})"
            for r in batch)
        return f"INSERT OR IGNORE INTO messages (id, inbox_address, from_address, from_name, subject, body, body_html, raw_headers, spf, dkim, dmarc, received_at) VALUES {vals}"
    n_msg = migrate("messages", fetch_msg, ins_msg, "messages", MSG_BATCH)

    # 3. sessions
    def fetch_sess(offset, lim):
        return f"SELECT id, created_at FROM sessions ORDER BY created_at LIMIT {lim} OFFSET {offset}"
    def ins_sess(batch):
        vals = ", ".join(f"({esc(r['id'])}, {esc(r['created_at'])})" for r in batch)
        return f"INSERT OR IGNORE INTO sessions (id, created_at) VALUES {vals}"
    n_sess = migrate("sessions", fetch_sess, ins_sess, "sessions")

    # 4. session_inboxes
    def fetch_si(offset, lim):
        return f"SELECT session_id, inbox_address FROM session_inboxes ORDER BY session_id LIMIT {lim} OFFSET {offset}"
    def ins_si(batch):
        vals = ", ".join(f"({esc(r['session_id'])}, {esc(r['inbox_address'])})" for r in batch)
        return f"INSERT OR IGNORE INTO session_inboxes (session_id, inbox_address) VALUES {vals}"
    n_si = migrate("session_inboxes", fetch_si, ins_si, "session_inboxes")

    print(f"\n=== DONE: {n_inbox} inboxes, {n_msg} messages, {n_sess} sessions, {n_si} session_inboxes ===", flush=True)

if __name__ == "__main__":
    main()