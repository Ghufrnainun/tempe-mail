/**
 * SSE realtime endpoint and notifyNewMessage helper.
 *
 * GET /api/inboxes/:address/events — SSE stream of new-message events.
 * notifyNewMessage(env, address, message) — called from ingest.ts to push
 * a new-message event to all connected SSE clients for an inbox.
 */
import type { Env } from '../env';

/**
 * Handle an SSE connection request by forwarding to the RealtimeRoom DO.
 *
 * Usage in routes.ts:
 *   import { handleSse } from './realtime';
 *   api.get('/inboxes/:address/events', (c) => handleSse(c.env, c.req.param('address'), c.req.raw));
 */
export async function handleSse(
  env: Env,
  address: string,
  _request?: Request
): Promise<Response> {
  const doId = env.REALTIME.idFromName(address);
  const doStub = env.REALTIME.get(doId);

  // Forward the request to the Durable Object for SSE handling
  // Use a synthetic request targeting the DO
  const req = new Request('https://tempe-mail/sse', {
    method: 'GET',
    headers: { 'Content-Type': 'text/event-stream' },
  });

  return doStub.fetch(req);
}

/**
 * Notify all SSE clients listening to an inbox that a new message arrived.
 * Call this from ingest.ts after storing a message.
 */
export async function notifyNewMessage(
  env: Env,
  address: string,
  message: Record<string, unknown>
): Promise<void> {
  const doId = env.REALTIME.idFromName(address);
  const doStub = env.REALTIME.get(doId);

  await doStub.fetch(
    new Request('https://tempe-mail/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_message',
        inbox_address: address,
        ...message,
      }),
    })
  );
}
