import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../env';
import { getDomains } from '../cf/zones-loader';
import { classifyEmail } from './tagging';
import { handleSse } from './realtime';

const api = new Hono<{ Bindings: Env }>();

// Zod schema for inbox creation (robust input validation)
const createInboxSchema = z.object({
  localPart: z
    .string()
    .regex(/^[a-z0-9][a-z0-9._-]{0,28}[a-z0-9]$/i, 'invalid local part')
    .optional(),
  domain: z.string().min(3).max(253).optional(),
  ttlHours: z.number().int().min(1).max(168).optional(),
});

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

// ---- GET /api/inboxes (list inboxes for session) ----
api.get('/inboxes', async (c) => {
  const db = c.env.DB;
  const sid = c.req.header('x-session-id');
  if (!sid) return c.json({ error: 'x-session-id header required' }, 401);

  const rows = await db
    .prepare(
      `SELECT i.address, i.created_at, i.expires_at
       FROM inboxes i
       JOIN session_inboxes si ON i.address = si.inbox_address
       WHERE si.session_id = ? AND i.expires_at > datetime('now')
       ORDER BY i.created_at DESC`
    )
    .bind(sid)
    .all<{ address: string; created_at: string; expires_at: string }>();

  return c.json(rows.results);
});

// ---- POST /api/inboxes (create new inbox) ----
api.post('/inboxes', async (c) => {
  const db = c.env.DB;
  const sid = c.req.header('x-session-id');
  if (!sid) return c.json({ error: 'x-session-id header required' }, 401);

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

  // Ensure session exists
  await db.prepare('INSERT OR IGNORE INTO sessions (id, created_at) VALUES (?, ?)').bind(sid, new Date().toISOString()).run();

  // Create inbox
  // Clamp TTL to sane bounds: min 1 hour, max 7 days (168h)
  const rawTtl = body.ttlHours ?? 24;
  const ttlHours = Math.min(168, Math.max(1, Math.floor(rawTtl)));
  await db
    .prepare('INSERT OR IGNORE INTO inboxes (address, created_at, expires_at) VALUES (?, datetime(\'now\'), datetime(\'now\', ?))')
    .bind(address, `+${ttlHours * 3600} seconds`)
    .run();

  // Link to session
  await db.prepare('INSERT OR IGNORE INTO session_inboxes (session_id, inbox_address) VALUES (?, ?)').bind(sid, address).run();

  return c.json({ address, domain, ttlHours });
});

// ---- GET /api/inboxes/:address/messages ----
api.get('/inboxes/:address/messages', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const sid = c.req.header('x-session-id');

  // Require session ownership of this inbox (privacy: temp mail harus private)
  if (!sid) return c.json({ error: 'x-session-id header required' }, 401);
  const owned = await db
    .prepare('SELECT 1 FROM session_inboxes WHERE session_id = ? AND inbox_address = ?')
    .bind(sid, address)
    .first();
  if (!owned) return c.json({ error: 'inbox not found' }, 404);

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

// ---- GET /api/inboxes/:address/events (SSE realtime) ----
api.get('/inboxes/:address/events', async (c) => {
  const address = c.req.param('address');
  return handleSse(c.env, address);
});

// ---- DELETE /api/inboxes/:address ----
api.delete('/inboxes/:address', async (c) => {
  const db = c.env.DB;
  const sid = c.req.header('x-session-id');
  const address = c.req.param('address');
  if (!sid) return c.json({ error: 'x-session-id header required' }, 401);

  await db.prepare('DELETE FROM session_inboxes WHERE session_id = ? AND inbox_address = ?').bind(sid, address).run();
  return c.json({ deleted: true });
});

export default api;
