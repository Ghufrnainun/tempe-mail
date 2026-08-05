import { describe, it, expect } from 'vitest';
import { parseEmail } from '../src/email/ingest';
import { extractDeliverability } from '../src/email/headers';

describe('parseEmail', () => {
  it('extracts subject, from, text from a simple email', async () => {
    const raw = [
      'From: Test Sender <test@example.com>',
      'To: inbox@tempe-mail.dev',
      'Subject: Hello World',
      'Date: Thu, 6 Aug 2026 15:00:00 +0700',
      'Message-ID: <abc123@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hello from test',
    ].join('\r\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    });

    const result = await parseEmail(stream);

    expect(result.subject).toBe('Hello World');
    expect(result.fromAddress).toBe('test@example.com');
    expect(result.fromName).toBe('Test Sender');
    expect(result.text).toBe('Hello from test');
    expect(result.html).toBe('');
  });

  it('extracts HTML body from multipart email', async () => {
    const boundary = '----boundary123';
    const raw = [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      'From: Dev <dev@example.com>',
      'Subject: HTML Test',
      'Date: Thu, 6 Aug 2026 16:00:00 +0700',
      'Message-ID: <xyz@example.com>',
      '',
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      'Plain version',
      `--${boundary}`,
      'Content-Type: text/html',
      '',
      '<h1>HTML version</h1>',
      `--${boundary}--`,
    ].join('\r\n');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    });

    const result = await parseEmail(stream);

    expect(result.text).toBe('Plain version');
    expect(result.html).toBe('<h1>HTML version</h1>');
    expect(result.subject).toBe('HTML Test');
  });
});

describe('extractDeliverability', () => {
  it('detects SPF pass', () => {
    const headers = [
      'Received-SPF: pass (example.com: domain of test@example.com designates 1.2.3.4 as permitted sender)',
      'DKIM-Signature: v=1; a=rsa-sha256; d=example.com',
    ].join('\r\n');

    const result = extractDeliverability(headers);
    expect(result.spf).toBe('pass');
  });

  it('detects DKIM pass from Authentication-Results', () => {
    const headers = [
      'Authentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com',
      'Received-SPF: pass',
      'ARC-Authentication-Results: i=1; mx.cloudflare.net; dkim=pass; spf=pass; dmarc=pass',
    ].join('\r\n');

    const result = extractDeliverability(headers);
    expect(result.spf).toBe('pass');
    expect(result.dkim).toBe('pass');
    expect(result.dmarc).toBe('pass');
  });

  it('detects failures', () => {
    const headers = [
      'Received-SPF: fail (example.com: domain of test@spammer.com does not designate permitted sender)',
      'Authentication-Results: mx.cloudflare.net; dkim=fail; spf=fail; dmarc=fail',
    ].join('\r\n');

    const result = extractDeliverability(headers);
    expect(result.spf).toBe('fail');
    expect(result.dkim).toBe('fail');
    expect(result.dmarc).toBe('fail');
  });
});
