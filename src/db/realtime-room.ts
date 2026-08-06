/**
 * Durable Object class for SSE realtime rooms.
 *
 * Each inbox address gets its own DO instance. Clients connect via
 * fetch() (forwarded from the SSE route), and broadcast pushes events
 * to all connected clients.
 */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';

interface SSEClient {
  id: string;
  writer: WritableStreamDefaultWriter<Uint8Array>;
}

export class RealtimeRoom extends DurableObject<Env> {
  private clients: Map<string, SSEClient> = new Map();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.clients = new Map();
  }

  /**
   * Handle incoming requests:
   * - GET  → establish SSE connection
   * - POST /broadcast → push event to all clients
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Broadcast a new-message event
    if (request.method === 'POST' && url.pathname === '/broadcast') {
      let data: unknown;
      try {
        data = await request.json();
      } catch {
        data = {};
      }
      const count = await this.broadcast(data);
      return new Response(JSON.stringify({ ok: true, clientsNotified: count }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // SSE connection
    return this.handleSse(request.signal);
  }

  /**
   * Establish an SSE (Server-Sent Events) connection.
   */
  private handleSse(signal?: AbortSignal): Response {
    const clientId = crypto.randomUUID();
    const encoder = new TextEncoder();

    const { readable, writable } = new TransformStream<Uint8Array>();
    const writer = writable.getWriter();

    // Register this client
    this.clients.set(clientId, { id: clientId, writer });

    // Send initial connected event
    writer.write(
      encoder.encode(
        `data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`
      )
    );

    // Remove on abort/disconnect — prevents memory leak in the DO
    const cleanup = () => {
      this.clients.delete(clientId);
      writer.close().catch(() => {});
    };

    // Fire cleanup on client disconnect (abort). Without this, the writer
    // stays in the Map forever and the DO instance leaks memory.
    signal?.addEventListener('abort', cleanup, { once: true });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  /**
   * Broadcast a data payload to all connected SSE clients.
   * Returns the number of clients notified.
   */
  async broadcast(data: unknown): Promise<number> {
    const encoder = new TextEncoder();
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = encoder.encode(message);

    const deadClients: string[] = [];

    for (const [id, client] of this.clients) {
      try {
        client.writer.write(encoded);
      } catch {
        deadClients.push(id);
      }
    }

    // Clean up dead clients
    for (const id of deadClients) {
      this.clients.delete(id);
    }

    return this.clients.size;
  }

  /** Add a client (for programmatic use). */
  async addClient(id: string, writer: WritableStreamDefaultWriter<Uint8Array>): Promise<void> {
    this.clients.set(id, { id, writer });
  }

  /** Remove a client. */
  async removeClient(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      try {
        client.writer.close();
      } catch {
        // already closed
      }
      this.clients.delete(id);
    }
  }

  /** Number of connected clients (for testing / monitoring). */
  getConnectionCount(): number {
    return this.clients.size;
  }
}
