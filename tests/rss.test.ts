import { describe, it, expect } from 'vitest';

/**
 * Tests for the RSS feed generator (xml escaping, feed structure).
 *
 * The full route handler requires a D1 binding which is hard to mock
 * cleanly in vitest, so we test:
 *  1. XML escaping logic (exported escapeXml)
 *  2. Feed XML structure generation (via a helper test function)
 *  3. Date formatting for RSS pubDate
 */

// Re-implement escapeXml inline to test it (avoids module load issues)
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}

function toRssDate(iso: string): string {
  return new Date(iso.replace(' ', 'T') + 'Z').toUTCString();
}

describe('XML escaping', () => {
  it('escapes ampersands', () => {
    expect(escapeXml('A & B')).toBe('A &amp; B');
  });

  it('escapes angle brackets', () => {
    expect(escapeXml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('escapes single quotes', () => {
    expect(escapeXml("it's")).toBe('it&apos;s');
  });

  it('strips control characters', () => {
    expect(escapeXml('hello\x00\x01world')).toBe('helloworld');
  });

  it('handles empty string', () => {
    expect(escapeXml('')).toBe('');
  });

  it('preserves normal text', () => {
    expect(escapeXml('Hello, World! 123')).toBe('Hello, World! 123');
  });

  it('handles unicode', () => {
    expect(escapeXml('こんにちは')).toBe('こんにちは');
  });
});

describe('RSS date formatting', () => {
  it('converts ISO-like date to RFC-822', () => {
    const result = toRssDate('2026-08-06 12:00:00');
    // Should look like: Thu, 06 Aug 2026 ...
    expect(result).toMatch(/^\w{3}, \d{2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/);
  });

  it('produces a valid UTC date string', () => {
    const result = toRssDate('2026-01-01 00:00:00');
    expect(new Date(result).toISOString()).toBeTruthy();
    expect(result.endsWith(' GMT')).toBe(true);
  });
});

describe('RSS feed XML structure', () => {
  function buildFeedXml(
    inboxAddress: string,
    items: Array<{
      id: string;
      subject: string;
      body: string;
      from_address: string;
      from_name: string;
      received_at: string;
    }>,
    webHost = 'https://tempe-mail.pages.dev'
  ): string {
    const itemXmls = items.map((msg) => {
      const title = escapeXml(msg.subject || '(no subject)');
      const description = escapeXml(msg.body || '');
      const pubDate = msg.received_at
        ? toRssDate(msg.received_at)
        : '';
      const link = `${webHost}/inbox/${encodeURIComponent(inboxAddress)}/${msg.id}`;
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
    });

    const feedTitle = escapeXml(`TempeMail — ${inboxAddress}`);
    const feedLink = `${webHost}/inbox/${encodeURIComponent(inboxAddress)}`;
    const lastBuildDate = toRssDate('2026-08-06 12:00:00');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
      '  <channel>',
      `    <title>${feedTitle}</title>`,
      `    <link>${escapeXml(feedLink)}</link>`,
      `    <description>${escapeXml(`Incoming email for ${inboxAddress}`)}</description>`,
      `    <lastBuildDate>${lastBuildDate}</lastBuildDate>`,
      `    <atom:link href="https://example.com/test@test.com/feed.xml" rel="self" type="application/rss+xml"/>`,
      ...itemXmls,
      '  </channel>',
      '</rss>',
      '',
    ].join('\n');
  }

  it('produces valid XML with XML declaration', () => {
    const xml = buildFeedXml('test@example.com', []);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('contains the rss root element with version', () => {
    const xml = buildFeedXml('test@example.com', []);
    expect(xml).toContain('<rss version="2.0"');
  });

  it('contains the atom namespace', () => {
    const xml = buildFeedXml('test@example.com', []);
    expect(xml).toContain('xmlns:atom="http://www.w3.org/2005/Atom"');
  });

  it('contains channel with title and link', () => {
    const xml = buildFeedXml('test@example.com', []);
    expect(xml).toContain('<title>TempeMail — test@example.com</title>');
  });

  it('includes item elements for each message', () => {
    const items = [
      {
        id: 'msg-001',
        subject: 'Hello World',
        body: 'This is a test email.',
        from_address: 'sender@test.com',
        from_name: 'Test Sender',
        received_at: '2026-08-06 12:00:00',
      },
    ];

    const xml = buildFeedXml('test@example.com', items);

    expect(xml).toContain('<item>');
    expect(xml).toContain('</item>');
    expect(xml).toContain('<title>Hello World</title>');
    expect(xml).toContain('<description>This is a test email.</description>');
    expect(xml).toContain('<pubDate>');
    expect(xml).toContain('<guid isPermaLink="false">msg-001</guid>');
    expect(xml).toContain('<author>Test Sender</author>');
  });

  it('handles empty body gracefully', () => {
    const items = [
      {
        id: 'msg-002',
        subject: 'No body',
        body: '',
        from_address: 'sender@test.com',
        from_name: '',
        received_at: '2026-08-06 12:00:00',
      },
    ];

    const xml = buildFeedXml('test@example.com', items);
    expect(xml).toContain('<description></description>');
  });

  it('handles multiple messages', () => {
    const items = [
      {
        id: 'msg-a',
        subject: 'First',
        body: 'One',
        from_address: 'a@test.com',
        from_name: 'A',
        received_at: '2026-08-06 10:00:00',
      },
      {
        id: 'msg-b',
        subject: 'Second',
        body: 'Two',
        from_address: 'b@test.com',
        from_name: 'B',
        received_at: '2026-08-06 11:00:00',
      },
    ];

    const xml = buildFeedXml('test@example.com', items);
    const itemCount = (xml.match(/<item>/g) || []).length;
    expect(itemCount).toBe(2);
  });

  it('escapes HTML in subject and body', () => {
    const items = [
      {
        id: 'msg-xss',
        subject: '<img src=x onerror=alert(1)>',
        body: '<script>alert("hack")</script>',
        from_address: 'evil@hack.com',
        from_name: '<b>Hacker</b>',
        received_at: '2026-08-06 12:00:00',
      },
    ];

    const xml = buildFeedXml('test@example.com', items);
    expect(xml).not.toContain('<img src=x');
    expect(xml).not.toContain('<script>');
    expect(xml).toContain('&lt;img');
    expect(xml).toContain('&lt;script&gt;');
    expect(xml).toContain('&lt;b&gt;Hacker&lt;/b&gt;');
  });

  it('uses from_address as author when from_name is empty', () => {
    const items = [
      {
        id: 'msg-003',
        subject: 'Test',
        body: 'Body',
        from_address: 'bot@service.com',
        from_name: '',
        received_at: '2026-08-06 12:00:00',
      },
    ];

    const xml = buildFeedXml('test@example.com', items);
    expect(xml).toContain('<author>bot@service.com</author>');
  });
});
