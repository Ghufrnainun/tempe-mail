import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import apiRoutes from '../src/api/routes';
import type { Env } from '../src/env';

/**
 * Integration tests for Phase 2 routes using Hono's app.request() with
 * a mocked D1 database (in-memory Map-based fake).
 */

function makeDb() {
  const tables: Record<string, any[]> = {
    sessions: [],
    inboxes: [],
    messages: [],
    attachments: [],
    session_inboxes: [],
    api_keys: [],
    api_key_inboxes: [],
    webhooks: [],
  };

  const db = {
    prepare: (sql: string) => {
      const s = sql.trim();
      const bind = (...args: any[]) => ({
        run: async () => {
          if (s.startsWith('INSERT INTO sessions')) {
            tables.sessions.push({ id: args[0] });
            return { meta: { last_row_id: tables.sessions.length } };
          }
          if (s.startsWith('INSERT INTO api_keys')) {
            const id = tables.api_keys.length + 1;
            tables.api_keys.push({ id, key_hash: args[0], name: args[1] || '', revoked: 0 });
            return { meta: { last_row_id: id } };
          }
          if (s.startsWith('INSERT OR IGNORE INTO inboxes') || s.startsWith('INSERT INTO inboxes')) {
            const existing = tables.inboxes.find((r) => r.address === args[0]);
            if (!existing) tables.inboxes.push({ address: args[0], created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() });
            return { meta: { last_row_id: tables.inboxes.length } };
          }
          if (s.startsWith('INSERT OR IGNORE INTO session_inboxes') || s.startsWith('INSERT INTO session_inboxes')) {
            tables.session_inboxes.push({ session_id: args[0], inbox_address: args[1] });
            return { meta: { last_row_id: tables.session_inboxes.length } };
          }
          if (s.startsWith('INSERT OR IGNORE INTO api_key_inboxes')) {
            tables.api_key_inboxes.push({ api_key_id: args[0], inbox_address: args[1] });
            return { meta: { last_row_id: tables.api_key_inboxes.length } };
          }
          if (s.startsWith('INSERT INTO webhooks')) {
            const id = tables.webhooks.length + 1;
            tables.webhooks.push({ id, inbox_address: args[0], url: args[1], secret: args[2], events: args[3] });
            return { meta: { last_row_id: id } };
          }
          if (s.startsWith('UPDATE api_keys SET revoked')) {
            const k = tables.api_keys.find((k2) => k2.id === args[0]);
            if (k) k.revoked = 1;
            return { meta: { last_row_id: 0 } };
          }
          if (s.startsWith('DELETE FROM session_inboxes')) {
            tables.session_inboxes = tables.session_inboxes.filter(
              (r) => !(r.session_id === args[0] && r.inbox_address === args[1])
            );
            return { meta: { last_row_id: 0 } };
          }
          if (s.startsWith('DELETE FROM webhooks')) {
            tables.webhooks = tables.webhooks.filter((r) => !(r.id === args[0] && r.inbox_address === args[1]));
            return { meta: { last_row_id: 0 } };
          }
          return { meta: { last_row_id: 0 } };
        },
        first: async () => {
          if (s.includes('FROM sessions WHERE id = ?')) {
            return tables.sessions.find((r) => r.id === args[0]) || null;
          }
          if (s.includes('FROM api_keys WHERE key_hash = ?')) {
            return tables.api_keys.find((r) => r.key_hash === args[0] && !r.revoked) || null;
          }
          if (s.includes('FROM session_inboxes WHERE session_id = ? AND inbox_address = ?')) {
            return tables.session_inboxes.find(
              (r) => r.session_id === args[0] && r.inbox_address === args[1]
            ) || null;
          }
          if (s.includes('FROM api_key_inboxes WHERE api_key_id = ? AND inbox_address = ?')) {
            return tables.api_key_inboxes.find(
              (r) => r.api_key_id === args[0] && r.inbox_address === args[1]
            ) || null;
          }
          return null;
        },
        all: async () => {
          if (s.includes('FROM api_keys')) {
            return { results: tables.api_keys.map((r) => ({ ...r })) };
          }
          if (s.includes('FROM api_key_inboxes') || s.includes('JOIN api_key_inboxes')) {
            const keyId = args[0];
            const inboxes = tables.api_key_inboxes
              .filter((r) => r.api_key_id === keyId)
              .map((r) => {
                const inbox = tables.inboxes.find((i) => i.address === r.inbox_address);
                return inbox || { address: r.inbox_address, created_at: '', expires_at: '' };
              });
            return { results: inboxes };
          }
          if (s.includes('FROM session_inboxes') || s.includes('JOIN session_inboxes')) {
            const sid = args[0];
            const inboxes = tables.session_inboxes
              .filter((r) => r.session_id === sid)
              .map((r) => {
                const inbox = tables.inboxes.find((i) => i.address === r.inbox_address);
                return inbox || { address: r.inbox_address, created_at: '', expires_at: '' };
              });
            return { results: inboxes };
          }
          if (s.includes('FROM webhooks')) {
            const addr = args[0];
            return { results: tables.webhooks.filter((r) => r.inbox_address === addr) };
          }
          if (s.includes('FROM messages')) {
            return { results: [] };
          }
          if (s.includes('FROM inboxes')) {
            return { results: tables.inboxes.filter((r) => r.address === args[0]) };
          }
          return { results: [] };
        },
      });
      return { bind };
    },
  };

  return { db, tables };
}

function makeEnv(db: any): Env {
  return {
    DB: db,
    REALTIME: {} as any,
    APP_NAME: 'TempeMail',
    MAIL_DOMAIN: 'mail.example.com',
    WEB_HOST: 'temp.example.com',
    CF_ZONE_MAP: 'mail.example.com=zone1',
  };
}

describe('Phase 2 API endpoints', () => {
  it('creates a session', async () => {
    const { db } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);
    const res = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeTruthy();
  });

  it('creates an inbox with session auth', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });

    const res = await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"localPart":"mytest","ttlHours":24}' },
      makeEnv(db)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.address).toBe('mytest@mail.example.com');
  });

  it('rejects malformed JSON with 400', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);
    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });

    const res = await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId }, body: '{bad' },
      makeEnv(db)
    );
    expect(res.status).toBe(400);
  });

  it('creates an API key with session auth and uses it for inbox ops', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });

    const keyRes = await app.request(
      '/api/keys',
      { method: 'POST', headers: { 'x-session-id': sessionId } },
      makeEnv(db)
    );
    expect(keyRes.status).toBe(201);
    const { key } = await keyRes.json();
    expect(key.startsWith('tmk_')).toBe(true);

    const inboxRes = await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: '{}' },
      makeEnv(db)
    );
    expect(inboxRes.status).toBe(200);
    const inbox = await inboxRes.json();
    expect(inbox.address).toBeTruthy();

    const listRes = await app.request(
      '/api/inboxes',
      { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
      makeEnv(db)
    );
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBe(1);
  });

  it('rejects invalid API key', async () => {
    const { db } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);
    const res = await app.request(
      '/api/inboxes',
      { method: 'GET', headers: { Authorization: 'Bearer tmk_invalid' } },
      makeEnv(db)
    );
    expect(res.status).toBe(401);
  });

  it('shows inbox ownership isolation between sessions', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const s1res = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId: s1 } = await s1res.json();
    tables.sessions.push({ id: s1 });
    const s2res = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId: s2 } = await s2res.json();
    tables.sessions.push({ id: s2 });

    await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': s1, 'Content-Type': 'application/json' }, body: '{}' },
      makeEnv(db)
    );

    const res = await app.request(
      '/api/inboxes',
      { method: 'GET', headers: { 'x-session-id': s2 } },
      makeEnv(db)
    );
    const list = await res.json();
    expect(list.length).toBe(0);
  });

  it('registers and lists webhooks for owned inbox', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });

    await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"localPart":"hooky"}' },
      makeEnv(db)
    );

    const createRes = await app.request(
      '/api/inboxes/hooky%40mail.example.com/webhooks',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"url":"https://example.com/hook","secret":"supersecret1"}' },
      makeEnv(db)
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.id).toBeTruthy();

    const listRes = await app.request(
      '/api/inboxes/hooky%40mail.example.com/webhooks',
      { method: 'GET', headers: { 'x-session-id': sessionId } },
      makeEnv(db)
    );
    const list = await listRes.json();
    expect(list.length).toBe(1);
  });

  it('search requires q param and returns 400 otherwise', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });
    await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"localPart":"findme"}' },
      makeEnv(db)
    );

    const res = await app.request(
      '/api/inboxes/findme%40mail.example.com/search',
      { method: 'GET', headers: { 'x-session-id': sessionId } },
      makeEnv(db)
    );
    expect(res.status).toBe(400);
  });

  it('rejects webhook to private IP (SSRF guard)', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });
    await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"localPart":"ssrf"}' },
      makeEnv(db)
    );

    // Cloud metadata IP — must be rejected
    const res = await app.request(
      '/api/inboxes/ssrf%40mail.example.com/webhooks',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"url":"http://169.254.169.254/latest/meta-data/","secret":"supersecret1"}' },
      makeEnv(db)
    );
    expect(res.status).toBe(400);
  });

  it('rejects webhook to loopback (SSRF guard)', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });
    await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"localPart":"ssrf2"}' },
      makeEnv(db)
    );

    const res = await app.request(
      '/api/inboxes/ssrf2%40mail.example.com/webhooks',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"url":"http://127.0.0.1:8080/hook","secret":"supersecret1"}' },
      makeEnv(db)
    );
    expect(res.status).toBe(400);
  });

  it('allows public webhook URL', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });
    await app.request(
      '/api/inboxes',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"localPart":"public"}' },
      makeEnv(db)
    );

    const res = await app.request(
      '/api/inboxes/public%40mail.example.com/webhooks',
      { method: 'POST', headers: { 'x-session-id': sessionId, 'Content-Type': 'application/json' }, body: '{"url":"https://example.com/hook","secret":"supersecret1"}' },
      makeEnv(db)
    );
    expect(res.status).toBe(201);
  });

  it('SSE endpoint requires auth (401 without session)', async () => {
    const { db } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const res = await app.request(
      '/api/inboxes/anyone%40mail.example.com/events',
      { method: 'GET' },
      makeEnv(db)
    );
    expect(res.status).toBe(401);
  });

  it('single message endpoint returns 404 for unknown message', async () => {
    const { db, tables } = makeDb();
    const app = new Hono<{ Bindings: Env }>();
    app.route('/api', apiRoutes);

    const sessRes = await app.request('/api/session', { method: 'POST' }, makeEnv(db));
    const { sessionId } = await sessRes.json();
    tables.sessions.push({ id: sessionId });

    const res = await app.request(
      '/api/messages/does-not-exist',
      { method: 'GET', headers: { 'x-session-id': sessionId } },
      makeEnv(db)
    );
    expect(res.status).toBe(404);
  });
});
