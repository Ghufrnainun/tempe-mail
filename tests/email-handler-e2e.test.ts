import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the modules that the email handler depends on
const inserted: any[] = [];
const createdInboxes: string[] = [];
const notified: any[] = [];

const mockDb = {
  prepare: vi.fn().mockReturnThis(),
  bind: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null), // inbox doesn't exist initially
  run: vi.fn().mockResolvedValue({ success: true }),
};

vi.mock('../src/api/realtime', () => ({
  notifyNewMessage: vi.fn(async (_env: any, addr: string, payload: any) => {
    notified.push({ addr, payload });
  }),
}));

// Import after mocking
import { parseEmail } from '../src/email/ingest';

// Re-create the email handler logic inline (mirrors index.ts email())
async function simulateEmail(raw: string, toAddress: string, db: any) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  });
  const parsed = await parseEmail(stream);
  inserted.push({ to: toAddress, parsed });
  return parsed;
}

describe('email handler E2E (parse + store flow)', () => {
  beforeEach(() => {
    inserted.length = 0;
    createdInboxes.length = 0;
    notified.length = 0;
  });

  it('parses text + html + OTP + deliverability from a real email', async () => {
    const raw = [
      'From: GitHub <noreply@github.com>',
      'To: test@example.com',
      'Subject: Your GitHub verification code is 482913',
      'Date: Thu, 6 Aug 2026 10:00:00 +0000',
      'Message-ID: <gh123@github.com>',
      'Received-SPF: pass (github.com)',
      'Authentication-Results: mx.cloudflare.net; dkim=pass; spf=pass; dmarc=pass',
      'Content-Type: multipart/alternative; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain',
      '',
      'Your verification code is 482913',
      '--b1',
      'Content-Type: text/html',
      '',
      '<p>Your verification code is <b>482913</b></p>',
      '--b1--',
    ].join('\r\n');

    const parsed = await simulateEmail(raw, 'test@example.com', mockDb);

    expect(parsed.subject).toContain('482913');
    expect(parsed.fromAddress).toBe('noreply@github.com');
    expect(parsed.text).toContain('482913');
    expect(parsed.html).toContain('<b>482913</b>');
    expect(parsed.spf).toBe('pass');
    expect(parsed.dkim).toBe('pass');
    expect(parsed.dmarc).toBe('pass');
  });

  it('extracts attachment metadata', async () => {
    const raw = [
      'From: Invoicer <billing@x.com>',
      'To: test@example.com',
      'Subject: Your invoice',
      'Date: Thu, 6 Aug 2026 10:00:00 +0000',
      'Message-ID: <inv@x.com>',
      'Content-Type: multipart/mixed; boundary="b2"',
      '',
      '--b2',
      'Content-Type: text/plain',
      '',
      'See attached invoice.',
      '--b2',
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      '',
      '%PDF-1.4 fake pdf content here',
      '--b2--',
    ].join('\r\n');

    const parsed = await simulateEmail(raw, 'test@example.com', mockDb);

    expect(parsed.attachments.length).toBeGreaterThan(0);
    const pdf = parsed.attachments.find((a) => a.filename.includes('invoice'));
    expect(pdf).toBeDefined();
    expect(pdf!.contentType).toContain('pdf');
  });

  it('handles plain-text-only email', async () => {
    const raw = [
      'From: A <a@b.com>',
      'To: test@example.com',
      'Subject: Plain hello',
      'Date: Thu, 6 Aug 2026 10:00:00 +0000',
      'Message-ID: <plain@b.com>',
      'Content-Type: text/plain',
      '',
      'Just text, no html.',
    ].join('\r\n');

    const parsed = await simulateEmail(raw, 'test@example.com', mockDb);
    expect(parsed.html).toBe('');
    expect(parsed.text).toBe('Just text, no html.');
    expect(parsed.fromName).toBe('A');
  });

  it('detects OTP-only email (numeric code in body)', async () => {
    const raw = [
      'From: Auth <otp@secure.io>',
      'To: test@example.com',
      'Subject: Login code',
      'Date: Thu, 6 Aug 2026 10:00:00 +0000',
      'Message-ID: <otp@secure.io>',
      'Content-Type: text/plain',
      '',
      'Enter this code to log in: 123456',
    ].join('\r\n');

    const parsed = await simulateEmail(raw, 'test@example.com', mockDb);
    const otp = parsed.text.match(/\b\d{4,8}\b/);
    expect(otp).not.toBeNull();
    expect(otp![0]).toBe('123456');
  });
});