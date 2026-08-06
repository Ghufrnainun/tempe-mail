import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { getDomains } from '../cf/zones-loader';
import { classifyEmail } from './tagging';
import { handleSse } from './realtime';
import { generateApiKey, hashKey } from './keys';

const api = new Hono<{ Bindings: Env }>();

type AppContext = Context<{ Bindings: Env }>;

// Zod schema for inbox creation (robust input validation)
const createInboxSchema = z.object({
  localPart: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,28}[a-z0-9]$/i, 'invalid local part')
    .optional(),
  domain: z.string().min(3).max(253).optional(),
  ttlHours: z.number().int().min(1).max(168).optional(),
});

const webhookSchema = z.object({
  url: z
    .string()
    .url('invalid webhook URL')
    .refine(isPublicUrl, 'webhook URL must be a public HTTPS endpoint'),
  secret: z.string().min(8, 'secret must be at least 8 chars').max(256).optional().default(''),
  events: z.string().default('new_message'),
});

/**
 * Block SSRF: webhook URLs must be public. Rejects loopback, private,
 * link-local, and cloud metadata IPs (169.254.169.254 etc).
 */
function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const hostname = parsed.hostname.toLowerCase();

    // Allow localhost in dev? No — SSRF guard applies always.
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;

    // Resolve the hostname to catch IP literals (127.0.0.1, 10.x, 192.168.x, 169.254.x)
    // For hostnames, we can't resolve DNS here, but we block obvious internal names
    // and IP-literal forms.
    const blockedPatterns = [
      /^127\./,
      /^10\./,
      /^192\.168\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^169\.254\./,
      /^0\./,
      /^100\.(6[4-9]|[7-9]\d|1\d\d)\./, // CGNAT
      /^\[?::1\]?$/,
      /^\[?fc/,
      /^\[?fd/,
      /^\[?fe8/,
    ];
    for (const p of blockedPatterns) {
      if (p.test(hostname)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

// NOTE: no `.api_key_inboxes`-based list — inboxes created by a key are linked.
interface Principal {
  type: 'session';
  sessionId: string;
}

/**
 * Resolve the authenticated principal from the request.
 * Supports browser session (x-session-id) or API key (Authorization: Bearer tmk_...).
 * Returns null when unauthenticated.
 */
async function getPrincipal(c: AppContext): Promise<Principal | null> {
  const db = c.env.DB;

  const sid = c.req.header('x-session-id');
  if (sid) {
    const session = await db
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .bind(sid)
      .first<{ id: string }>();
    if (session) return { type: 'session', sessionId: sid };
    return null;
  }

  const authHeader = c.req.header('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(tmk_.+)$/i);
  if (match) {
    const hash = await hashKey(match[1]);
    const key = await db
      .prepare('SELECT id, revoked FROM api_keys WHERE key_hash = ?')
      .bind(hash)
      .first<{ id: number; revoked: number }>();
    if (key && !key.revoked) {
      return { type: 'session', sessionId: `apikey:${key.id}` };
    }
    return null;
  }

  return null;
}

/** Check whether the principal owns an inbox (session or API key). */
async function ownsInbox(c: AppContext, principal: Principal, address: string): Promise<boolean> {
  const db = c.env.DB;
  const sid = principal.sessionId;

  if (sid.startsWith('apikey:')) {
    const keyId = parseInt(sid.slice(7), 10);
    const owned = await db
      .prepare('SELECT 1 FROM api_key_inboxes WHERE api_key_id = ? AND inbox_address = ?')
      .bind(keyId, address)
      .first();
    return !!owned;
  }

  const owned = await db
    .prepare('SELECT 1 FROM session_inboxes WHERE session_id = ? AND inbox_address = ?')
    .bind(sid, address)
    .first();
  return !!owned;
}

// ---- GET /api/config ----
api.get('/config', (c) => {
  const domains = getDomains(c.env);
  return c.json({
    appName: c.env.APP_NAME || 'TempeMail',
    mailDomain: domains[0] || 'example.com',
    domains,
    workerName: c.env.WORKER_NAME || 'tempe-mail',
  });
});

// ---- POST /api/session (create/ensure browser session) ----
api.post('/session', async (c) => {
  const db = c.env.DB;
  const id = crypto.randomUUID();
  await db.prepare('INSERT INTO sessions (id, created_at) VALUES (?, ?)').bind(id, new Date().toISOString()).run();
  return c.json({ sessionId: id });
});

// ---- POST /api/keys (create API key — requires browser session) ----
api.post('/keys', async (c) => {
  const principal = await getPrincipal(c);
  if (!principal || principal.sessionId.startsWith('apikey:')) {
    return c.json({ error: 'browser session required to create API keys' }, 401);
  }
  const db = c.env.DB;
  const rawKey = generateApiKey();
  const hash = await hashKey(rawKey);
  const name = (c.req.header('x-key-name') || '').slice(0, 64);
  const res = await db
    .prepare('INSERT INTO api_keys (key_hash, name) VALUES (?, ?)')
    .bind(hash, name)
    .run();
  const keyId = res.meta.last_row_id;
  return c.json({ id: keyId, key: rawKey, name }, 201);
});

// ---- GET /api/keys (list API keys — requires browser session) ----
api.get('/keys', async (c) => {
  const principal = await getPrincipal(c);
  if (!principal || principal.sessionId.startsWith('apikey:')) {
    return c.json({ error: 'browser session required' }, 401);
  }
  const rows = await c.env.DB.prepare(
    'SELECT id, name, created_at, last_used_at, revoked FROM api_keys ORDER BY id DESC'
  ).all<{ id: number; name: string; created_at: string; last_used_at: string; revoked: number }>();
  return c.json(rows.results);
});

// ---- DELETE /api/keys/:id (revoke API key) ----
api.delete('/keys/:id', async (c) => {
  const principal = await getPrincipal(c);
  if (!principal || principal.sessionId.startsWith('apikey:')) {
    return c.json({ error: 'browser session required' }, 401);
  }
  const id = parseInt(c.req.param('id'), 10);
  if (!id) return c.json({ error: 'invalid key id' }, 400);
  await c.env.DB.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').bind(id).run();
  return c.json({ revoked: true });
});

// ---- GET /api/inboxes (list inboxes for principal) ----
api.get('/inboxes', async (c) => {
  const db = c.env.DB;
  const principal = await getPrincipal(c);
  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);

  if (principal.sessionId.startsWith('apikey:')) {
    const keyId = parseInt(principal.sessionId.slice(7), 10);
    const rows = await db
      .prepare(
        `SELECT i.address, i.created_at, i.expires_at
         FROM inboxes i
         JOIN api_key_inboxes aki ON i.address = aki.inbox_address
         WHERE aki.api_key_id = ? AND i.expires_at > datetime('now')
         ORDER BY i.created_at DESC`
      )
      .bind(keyId)
      .all<{ address: string; created_at: string; expires_at: string }>();
    return c.json(rows.results);
  }

  const rows = await db
    .prepare(
      `SELECT i.address, i.created_at, i.expires_at
       FROM inboxes i
       JOIN session_inboxes si ON i.address = si.inbox_address
       WHERE si.session_id = ? AND i.expires_at > datetime('now')
       ORDER BY i.created_at DESC`
    )
    .bind(principal.sessionId)
    .all<{ address: string; created_at: string; expires_at: string }>();

  return c.json(rows.results);
});

// ---- POST /api/inboxes (create new inbox) ----
api.post('/inboxes', async (c) => {
  const db = c.env.DB;
  const principal = await getPrincipal(c);
  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);

  // Parse + validate body; malformed JSON → 400, invalid fields → 400
  let body: z.infer<typeof createInboxSchema>;
  try {
    const raw = await c.req.text();
    body = createInboxSchema.parse(raw ? JSON.parse(raw) : {});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'invalid body', details: err.issues.map((i) => i.message) }, 400);
    }
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const domains = getDomains(c.env);
  const domain = body.domain || domains[0] || 'example.com';

  // Zod already validated localPart format; use it or generate random
  let localPart: string;
  if (body.localPart) {
    localPart = body.localPart.toLowerCase();
  } else {
    // Random address
    const adjectives = ['cool', 'fast', 'quiet', 'fresh', 'crisp', 'sharp', 'bold', 'kind', 'warm'];
    const nouns = ['fox', 'owl', 'bear', 'hawk', 'wolf', 'deer', 'finch', 'dove', 'lynx'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 900) + 100;
    localPart = `${adj}${noun}${num}`;
  }

  const address = `${localPart}@${domain}`;

  // Create inbox (session guaranteed by getPrincipal)
  if (principal.sessionId.startsWith('apikey:')) {
    const keyId = parseInt(principal.sessionId.slice(7), 10);
    await db.prepare('INSERT OR IGNORE INTO api_keys (id) VALUES (?)').bind(keyId).run();
  } else {
    await db
      .prepare('INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)')
      .bind(principal.sessionId, new Date().toISOString())
      .run();
  }

  // Clamp TTL to sane bounds: min 1 hour, max 7 days (168h)
  const rawTtl = body.ttlHours ?? 24;
  const ttlHours = Math.min(168, Math.max(1, Math.floor(rawTtl)));
  await db
    .prepare('INSERT OR IGNORE INTO inboxes (address, created_at, expires_at) VALUES (?, datetime(\'now\'), datetime(\'now\', ?))')
    .bind(address, `+${ttlHours * 3600} seconds`)
    .run();

  // Link to principal
  if (principal.sessionId.startsWith('apikey:')) {
    await db
      .prepare('INSERT OR IGNORE INTO api_key_inboxes (api_key_id, inbox_address) VALUES (?, ?)')
      .bind(parseInt(principal.sessionId.slice(7), 10), address)
      .run();
  } else {
    await db
      .prepare('INSERT OR IGNORE INTO session_inboxes (session_id, inbox_address) VALUES (?, ?)')
      .bind(principal.sessionId, address)
      .run();
  }

  return c.json({ address, domain, ttlHours });
});

// ---- GET /api/inboxes/:address/messages ----
api.get('/inboxes/:address/messages', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);
  if (!(await ownsInbox(c, principal, address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }

  const rows = await db
    .prepare(
      `SELECT m.*, GROUP_CONCAT(a.filename || '|' || a.content_type || '|' || a.size, ',') as attachment_data
       FROM messages m
       LEFT JOIN attachments a ON a.message_id = m.id
       WHERE m.inbox_address = ?
       GROUP BY m.id
       ORDER BY m.received_at DESC`
    )
    .bind(address)
    .all<Record<string, string>>();

  const messages = rows.results.map((row: Record<string, string>) => {
    const attData = row.attachment_data;
    const attachments = attData
      ? attData.split(',').map((s: string) => {
          const [filename, contentType, sizeStr] = s.split('|');
          return { filename: filename || '', contentType: contentType || '', size: parseInt(sizeStr || '0') };
        })
      : [];

    const classification = classifyEmail(row.subject || '', row.from_address || '');

    return {
      id: row.id,
      inbox_address: row.inbox_address,
      from_address: row.from_address,
      from_name: row.from_name || '',
      subject: row.subject,
      body: row.body,
      body_html: row.body_html || '',
      spf: row.spf || 'unknown',
      dkim: row.dkim || 'unknown',
      dmarc: row.dmarc || 'unknown',
      attachments,
      tag: classification.tag,
      tag_label: classification.label,
      received_at: row.received_at,
    };
  });

  return c.json(messages);
});

// ---- GET /api/inboxes/:address/search?q= (inbox search) ----
api.get('/inboxes/:address/search', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const q = (c.req.query('q') || '').trim();
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);
  if (!(await ownsInbox(c, principal, address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }
  if (!q || q.length < 2) {
    return c.json({ error: 'q parameter required (min 2 chars)' }, 400);
  }

  const like = `%${q
    .replace(/[\\%_]/g, (m) => `\\${m}`)
    .toLowerCase()}%`;

  const rows = await db
    .prepare(
      `SELECT id, subject, from_address, from_name, received_at
       FROM messages
       WHERE inbox_address = ? AND (
         LOWER(subject) LIKE ? ESCAPE '\\' OR
         LOWER(body) LIKE ? ESCAPE '\\' OR
         LOWER(from_address) LIKE ? ESCAPE '\\'
       )
       ORDER BY received_at DESC
       LIMIT 50`
    )
    .bind(address, like, like, like)
    .all<{ id: string; subject: string; from_address: string; from_name: string; received_at: string }>();

  return c.json(rows.results);
});

// ---- POST /api/inboxes/:address/webhooks (subscribe) ----
api.post('/inboxes/:address/webhooks', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);
  if (!(await ownsInbox(c, principal, address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }

  let body: z.infer<typeof webhookSchema>;
  try {
    const raw = await c.req.text();
    body = webhookSchema.parse(raw ? JSON.parse(raw) : {});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'invalid body', details: err.issues.map((i) => i.message) }, 400);
    }
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const res = await db
    .prepare('INSERT INTO webhooks (inbox_address, url, secret, events) VALUES (?, ?, ?, ?)')
    .bind(address, body.url, body.secret, body.events)
    .run();

  return c.json({ id: res.meta.last_row_id, inbox_address: address, url: body.url, events: body.events }, 201);
});

// ---- GET /api/inboxes/:address/webhooks (list subscriptions) ----
api.get('/inboxes/:address/webhooks', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);
  if (!(await ownsInbox(c, principal, address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }

  const rows = await db
    .prepare('SELECT id, url, events, created_at FROM webhooks WHERE inbox_address = ? ORDER BY id DESC')
    .bind(address)
    .all<{ id: number; url: string; events: string; created_at: string }>();

  return c.json(rows.results);
});

// ---- DELETE /api/inboxes/:address/webhooks/:id (remove subscription) ----
api.delete('/inboxes/:address/webhooks/:id', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const id = parseInt(c.req.param('id'), 10);
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);
  if (!(await ownsInbox(c, principal, address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }
  if (!id) return c.json({ error: 'invalid webhook id' }, 400);

  await db.prepare('DELETE FROM webhooks WHERE id = ? AND inbox_address = ?').bind(id, address).run();
  return c.json({ deleted: true });
});

// ---- GET /api/messages/:id (single message, ownership-checked) ----
api.get('/messages/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);

  const row = await db
    .prepare('SELECT * FROM messages WHERE id = ?')
    .bind(id)
    .first<Record<string, string>>();
  if (!row) return c.json({ error: 'message not found' }, 404);

  if (!(await ownsInbox(c, principal, row.inbox_address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }

  return c.json({
    id: row.id,
    inbox_address: row.inbox_address,
    from_address: row.from_address,
    from_name: row.from_name || '',
    subject: row.subject,
    body: row.body,
    body_html: row.body_html || '',
    spf: row.spf || 'unknown',
    dkim: row.dkim || 'unknown',
    dmarc: row.dmarc || 'unknown',
    received_at: row.received_at,
  });
});

// ---- GET /api/messages/:id/attachments/:filename (R2 download) ----
api.get('/messages/:id/attachments/:filename', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const filename = c.req.param('filename');
  const principal = await getPrincipal(c);

  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);

  // Find the attachment + its inbox for ownership
  const att = await db
    .prepare(
      `SELECT a.filename, a.content_type, a.size, a.r2_key, m.inbox_address
       FROM attachments a
       JOIN messages m ON m.id = a.message_id
       WHERE a.message_id = ? AND a.filename = ?`
    )
    .bind(id, filename)
    .first<{ filename: string; content_type: string; size: number; r2_key: string; inbox_address: string }>();

  if (!att) return c.json({ error: 'attachment not found' }, 404);
  if (!(await ownsInbox(c, principal, att.inbox_address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }

  // If R2 has the object, stream it; else 410 (metadata-only)
  if (c.env.ATTACHMENTS && att.r2_key) {
    const obj = await c.env.ATTACHMENTS.get(att.r2_key);
    if (obj) {
      // Strip CR/LF and quotes — prevents header/response splitting via
      // a malicious attachment filename.
      const safeFilename = att.filename.replace(/[\r\n"]/g, '');
      return new Response(obj.body, {
        headers: {
          'Content-Type': att.content_type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'Cache-Control': 'private, max-age=300',
        },
      });
    }
  }

  return c.json({ error: 'attachment body not stored (metadata only)', size: att.size }, 410);
});

// ---- GET /api/inboxes/:address/events (SSE realtime) ----
api.get('/inboxes/:address/events', async (c) => {
  const address = c.req.param('address');
  const principal = await getPrincipal(c);

  // Require ownership — otherwise anyone who knows an inbox address can
  // listen to its realtime stream (privacy leak).
  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);
  if (!(await ownsInbox(c, principal, address))) {
    return c.json({ error: 'inbox not found' }, 404);
  }

  return handleSse(c.env, address);
});

// ---- DELETE /api/inboxes/:address ----
api.delete('/inboxes/:address', async (c) => {
  const db = c.env.DB;
  const principal = await getPrincipal(c);
  const address = c.req.param('address');
  if (!principal) return c.json({ error: 'x-session-id or Bearer API key required' }, 401);

  if (principal.sessionId.startsWith('apikey:')) {
    await db
      .prepare('DELETE FROM api_key_inboxes WHERE api_key_id = ? AND inbox_address = ?')
      .bind(parseInt(principal.sessionId.slice(7), 10), address)
      .run();
  } else {
    await db.prepare('DELETE FROM session_inboxes WHERE session_id = ? AND inbox_address = ?').bind(principal.sessionId, address).run();
  }
  return c.json({ deleted: true });
});

export default api;
