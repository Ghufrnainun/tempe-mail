import PostalMime from 'postal-mime';
import { extractDeliverability, type Deliverability } from './headers';

export interface ParsedEmail {
  subject: string;
  fromAddress: string;
  fromName: string;
  date: string;
  messageId: string;
  text: string;
  html: string;
  rawHeaders: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    content?: Uint8Array | string | null;
  }>;
  spf: Deliverability['spf'];
  dkim: Deliverability['dkim'];
  dmarc: Deliverability['dmarc'];
}

/**
 * Parse a raw MIME email ReadableStream into structured fields.
 * Uses PostalMime for MIME parsing and extracts deliverability-relevant headers.
 */
export async function parseEmail(raw: ReadableStream): Promise<ParsedEmail> {
  const parser = new PostalMime();
  const parsed = await parser.parse(raw);

  const fromAddress = parsed.from?.address || '';
  const fromName = parsed.from?.name || '';
  const subject = parsed.subject || '(no subject)';
  const date = parsed.date || '';
  const messageId = parsed.messageId || '';
  const text = parsed.text?.trim() || '';
  const html = parsed.html ? parsed.html.trim() : '';

  // Reconstruct raw headers for deliverability extraction
  const rawHeaderLines: string[] = [];
  if (parsed.headers) {
    for (const header of parsed.headers) {
      rawHeaderLines.push(`${header.key}: ${header.value}`);
    }
  }
  const rawHeaders = rawHeaderLines.join('\r\n');

  // Attachments metadata + content (for R2 storage)
  const attachments = (parsed.attachments || []).map((a) => ({
    filename: a.filename || 'unnamed',
    contentType: a.mimeType || 'application/octet-stream',
    size: ((a.content as Uint8Array)?.byteLength) || (typeof a.content === 'string' ? a.content.length : 0),
    content: (a.content as Uint8Array | string | null) ?? undefined,
  }));

  const deliverability = extractDeliverability(rawHeaders);

  return {
    subject,
    fromAddress,
    fromName,
    date,
    messageId,
    text,
    html,
    rawHeaders,
    attachments,
    ...deliverability,
  };
}
