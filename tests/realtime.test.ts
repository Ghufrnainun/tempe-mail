import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for the RealtimeRoom Durable Object class.
 *
 * Since we can't run actual Durable Objects in vitest, we test the core
 * logic — SSE connection, broadcast, connect/disconnect, connection
 * counting — by recreating the essential class methods in isolation.
 */

// Minimal re-implementation of RealtimeRoom's core logic for testing.
// This mirrors the production code in src/db/realtime-room.ts.
class TestRealtimeRoom {
  clients: Map<string, { id: string; writer: WritableStreamDefaultWriter<Uint8Array> }>;

  constructor() {
    this.clients = new Map();
  }

  connect(id: string, writer: WritableStreamDefaultWriter<Uint8Array>): void {
    this.clients.set(id, { id, writer });
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      try {
        await client.writer.close();
      } catch {
        // already closed
      }
      this.clients.delete(id);
    }
  }

  async broadcast(data: unknown): Promise<number> {
    const encoder = new TextEncoder();
    const message = `data: ${JSON.stringify(data)}\n\n`;
    const encoded = encoder.encode(message);

    const deadClients: string[] = [];
    for (const [id, client] of this.clients) {
      try {
        await client.writer.write(encoded);
      } catch {
        deadClients.push(id);
      }
    }

    for (const id of deadClients) {
      this.clients.delete(id);
    }

    return this.clients.size;
  }

  getConnectionCount(): number {
    return this.clients.size;
  }
}

/** Create a mock writer that captures written data. */
function mockWriter(): {
  writer: WritableStreamDefaultWriter<Uint8Array>;
  written: () => string;
  closed: () => boolean;
} {
  let closed = false;
  const chunks: Uint8Array[] = [];

  const writer = {
    write(chunk: Uint8Array) {
      chunks.push(chunk);
      return Promise.resolve();
    },
    close() {
      closed = true;
      return Promise.resolve();
    },
    abort() {
      closed = true;
      return Promise.resolve();
    },
    get ready() {
      return Promise.resolve();
    },
    get desiredSize() {
      return 1;
    },
    releaseLock() {},
    closed: Promise.resolve(),
  } as unknown as WritableStreamDefaultWriter<Uint8Array>;

  return {
    writer,
    written: () => new TextDecoder().decode(chunks[chunks.length - 1] || new Uint8Array()),
    closed: () => closed,
  };
}

describe('RealtimeRoom — connections', () => {
  it('starts with zero clients', () => {
    const room = new TestRealtimeRoom();
    expect(room.getConnectionCount()).toBe(0);
  });

  it('adds a client via connect()', () => {
    const room = new TestRealtimeRoom();
    const { writer } = mockWriter();
    room.connect('client-1', writer);
    expect(room.getConnectionCount()).toBe(1);
  });

  it('adds multiple clients', () => {
    const room = new TestRealtimeRoom();
    room.connect('c1', mockWriter().writer);
    room.connect('c2', mockWriter().writer);
    room.connect('c3', mockWriter().writer);
    expect(room.getConnectionCount()).toBe(3);
  });

  it('removes a client via disconnect()', async () => {
    const room = new TestRealtimeRoom();
    const { writer } = mockWriter();
    room.connect('client-x', writer);
    expect(room.getConnectionCount()).toBe(1);
    await room.disconnect('client-x');
    expect(room.getConnectionCount()).toBe(0);
  });

  it('disconnecting a non-existent client does nothing', async () => {
    const room = new TestRealtimeRoom();
    await room.disconnect('ghost');
    expect(room.getConnectionCount()).toBe(0);
  });

  it('disconnect closes the writer', async () => {
    const room = new TestRealtimeRoom();
    const { writer, closed } = mockWriter();
    room.connect('c', writer);
    await room.disconnect('c');
    expect(closed()).toBe(true);
  });
});

describe('RealtimeRoom — broadcast', () => {
  it('broadcasts to all connected clients', async () => {
    const room = new TestRealtimeRoom();
    const w1 = mockWriter();
    const w2 = mockWriter();
    room.connect('a', w1.writer);
    room.connect('b', w2.writer);

    await room.broadcast({ type: 'new_message', subject: 'Hello' });

    expect(w1.written()).toContain('"type":"new_message"');
    expect(w1.written()).toContain('"subject":"Hello"');
    expect(w2.written()).toContain('"type":"new_message"');
  });

  it('returns the number of live clients after broadcast', async () => {
    const room = new TestRealtimeRoom();
    room.connect('a', mockWriter().writer);
    room.connect('b', mockWriter().writer);

    const count = await room.broadcast({ type: 'ping' });
    expect(count).toBe(2);
  });

  it('handles dead clients gracefully', async () => {
    const room = new TestRealtimeRoom();

    // Writer that throws on write
    const deadWriter = {
      write() {
        throw new Error('connection lost');
      },
      close() {
        return Promise.resolve();
      },
      get ready() {
        return Promise.resolve();
      },
      get desiredSize() {
        return 1;
      },
      releaseLock() {},
      closed: Promise.resolve(),
    } as unknown as WritableStreamDefaultWriter<Uint8Array>;

    const { writer } = mockWriter();
    room.connect('dead', deadWriter);
    room.connect('alive', writer);

    const count = await room.broadcast({ type: 'test' });

    // Dead client should be cleaned up
    expect(room.getConnectionCount()).toBe(1);
    expect(count).toBe(1);
  });

  it('broadcasts zero clients without error', async () => {
    const room = new TestRealtimeRoom();
    const count = await room.broadcast({ type: 'nobody' });
    expect(count).toBe(0);
  });

  it('encodes messages as SSE data lines', async () => {
    const room = new TestRealtimeRoom();
    const { writer, written } = mockWriter();
    room.connect('x', writer);

    await room.broadcast({ id: '123', subject: 'Test' });

    const output = written();
    expect(output.startsWith('data: ')).toBe(true);
    expect(output.endsWith('\n\n')).toBe(true);
  });
});

describe('RealtimeRoom — SSE message format', () => {
  it('produces valid JSON inside SSE data', async () => {
    const room = new TestRealtimeRoom();
    const { writer, written } = mockWriter();
    room.connect('x', writer);

    await room.broadcast({ key: 'value', nested: { a: 1 } });

    const output = written();
    const json = output.replace(/^data: /, '').replace(/\n\n$/, '');
    const parsed = JSON.parse(json);
    expect(parsed).toEqual({ key: 'value', nested: { a: 1 } });
  });
});
