import { Hono } from 'hono';
import apiRoutes from './api/routes';
import type { ParsedEmail } from './email/ingest';
import { parseEmail } from './email/ingest';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

// Mount API routes
app.route('/api', apiRoutes);

// Serve static assets as fallback (SPA-friendly)
app.get('/*', async (c) => {
  const { ASSETS } = c.env;
  if (!ASSETS) return c.text('No assets binding', 500);

  const url = new URL(c.req.url);
  let pathname = url.pathname;

  // Serve / as index.html
  if (pathname === '/' || pathname === '') pathname = '/index.html';

  try {
    const asset = await ASSETS.fetch(new Request(`https://asset${pathname}`));
    if (asset.ok) return asset;
  } catch {
    // Fall through to SPA fallback
  }

  // SPA fallback
  try {
    const fallback = await ASSETS.fetch(new Request('https://asset/index.html'));
    if (fallback.ok) return fallback;
  } catch {
    // Not found
  }

  return c.text('Not found', 404);
});

// ---- Cloudflare Worker entry ----
export default {
  fetch: app.fetch,

  /**
   * Inbound email handler — Cloudflare Email Workers call this.
   * Parses the incoming MIME email and stores it in D1.
   */
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const parsed = await parseEmail(message.raw);

    // Store in D1
    const db = env.DB;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const localPart = message.to.split('@')[0];
    const domain = message.to.split('@')[1] || '';

    // Reconstruct full address
    const inboxAddress = `${localPart}@${domain}`;

    // Auto-create inbox if it doesn't exist
    const existing = await db
      .prepare('SELECT address FROM inboxes WHERE address = ?')
      .bind(inboxAddress)
      .first<{ address: string }>();

    if (!existing) {
      await db
        .prepare(
          'INSERT INTO inboxes (address, created_at, expires_at) VALUES (?, ?, datetime(?, ?))'
        )
        .bind(inboxAddress, now, now, `+${24 * 3600} seconds`)
        .run();
    }

    await db
      .prepare(
        `INSERT INTO messages (id, inbox_address, from_address, from_name, subject, body, body_html,
         raw_headers, spf, dkim, dmarc, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        inboxAddress,
        parsed.fromAddress,
        parsed.fromName,
        parsed.subject,
        parsed.text,
        parsed.html,
        parsed.rawHeaders,
        parsed.spf,
        parsed.dkim,
        parsed.dmarc,
        now
      )
      .run();

    // Store attachment metadata
    for (const att of parsed.attachments) {
      await db
        .prepare(
          `INSERT INTO attachments (message_id, filename, content_type, size)
           VALUES (?, ?, ?, ?)`
        )
        .bind(id, att.filename, att.contentType, att.size)
        .run();
    }
  },

  /**
   * Scheduled purge — runs on cron to delete expired messages.
   */
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const db = env.DB;
    const now = new Date().toISOString();

    // Delete messages whose inbox has expired
    await db
      .prepare(
        `DELETE FROM messages WHERE inbox_address IN
         (SELECT address FROM inboxes WHERE expires_at < ?)`
      )
      .bind(now)
      .run();

    // Delete expired inboxes
    await db
      .prepare('DELETE FROM inboxes WHERE expires_at < ?')
      .bind(now)
      .run();
  },
};
