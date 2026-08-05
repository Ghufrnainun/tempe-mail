import type { Env } from '../env';

export interface WebhookPayload {
  event: 'new_message';
  inbox_address: string;
  message: {
    id: string;
    from_address: string;
    from_name: string;
    subject: string;
    body_preview: string;
    received_at: string;
  };
}

/**
 * Deliver a webhook event to all subscriptions for an inbox.
 * Uses HMAC-SHA256 signature (X-TempeMail-Signature) with per-webhook secret.
 * Failures are swallowed — webhooks are best-effort (email already stored).
 */
export async function deliverWebhooks(
  env: Env,
  inboxAddress: string,
  payload: WebhookPayload
): Promise<{ delivered: number; failed: number }> {
  try {
    const rows = await env.DB.prepare('SELECT id, url, secret FROM webhooks WHERE inbox_address = ?')
      .bind(inboxAddress)
      .all<{ id: number; url: string; secret: string }>();
    if (!rows.results.length) return { delivered: 0, failed: 0 };

    const body = JSON.stringify(payload);
    let delivered = 0;
    let failed = 0;

    await Promise.all(
      rows.results.map(async (hook) => {
        try {
          const sig = await signPayload(body, hook.secret || '');
          const res = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-TempeMail-Event': 'new_message',
              'X-TempeMail-Signature': sig,
              'User-Agent': 'TempeMail-Webhook/1.0',
            },
            body,
          });
          if (res.ok) delivered++;
          else failed++;
        } catch {
          failed++;
        }
      })
    );

    return { delivered, failed };
  } catch {
    return { delivered: 0, failed: 0 };
  }
}

/** HMAC-SHA256 signature: "v1=<hex>" */
async function signPayload(body: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `v1=${hex}`;
}
