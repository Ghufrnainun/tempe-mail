/**
 * RSS 2.0 feed per inbox — public endpoint keyed by the inbox address.
 * The address is the secret (no session auth). Returns valid XML with
 * message items.
 */
import { Hono } from 'hono';
import type { Env } from '../env';

const rss = new Hono<{ Bindings: Env }>();

rss.get('/:address/feed.xml', async (c) => {
  const db = c.env.DB;
  const address = c.req.param('address');
  const webHost = c.env.WEB_HOST || 'https://tempe-mail.pages.dev';

  // Check the inbox actually exists
  const inbox = await db
    .prepare('SELECT address, created_at FROM inboxes WHERE address = ?')
    .bind(address)
    .first<{ address: string; created_at: string }>();

  if (!inbox) {
    return c.text('Inbox not found', 404);
  }

  const rows = await db
    .prepare(
      `SELECT id, from_address, from_name, subject, body, received_at
       FROM messages
       WHERE inbox_address = ?
       ORDER BY received_at DESC
       LIMIT 50`
    )
    .bind(address)
    .all<{
      id: string;
      from_address: string;
      from_name: string;
      subject: string;
      body: string;
      received_at: string;
    }>();

  const items = rows.results
    .map((msg) => {
      const title = escapeXml(msg.subject || '(no subject)');
      const description = escapeXml(msg.body || '');
      const pubDate = msg.received_at
        ? new Date(msg.received_at.replace(' ', 'T') + 'Z').toUTCString()
        : '';
      const link = `${webHost}/inbox/${encodeURIComponent(address)}/${msg.id}`;
      const author = escapeXml(msg.from_name || msg.from_address || '');

      return [
        '    <item>',
        `      <title>${title}</title>`,
        `      <description>${description}</description>`,
        pubDate ? `      <pubDate>${pubDate}</pubDate>` : '',
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="false">${escapeXml(msg.id)}</guid>`,
        author ? `      <author>${author}</author>` : '',
        '    </item>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  const feedTitle = escapeXml(`TempeMail — ${address}`);
  const feedLink = `${webHost}/inbox/${encodeURIComponent(address)}`;
  const lastBuildDate = new Date().toUTCString();

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${feedTitle}</title>`,
    `    <link>${escapeXml(feedLink)}</link>`,
    `    <description>${escapeXml(`Incoming email for ${address}`)}</description>`,
    `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
    `    <atom:link href="${escapeXml(c.req.url)}" rel="self" type="application/rss+xml"/>`,
    items,
    '  </channel>',
    '</rss>',
    '\n',
  ].join('\n');

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
});

/** Escape XML special characters and control chars. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

export default rss;
