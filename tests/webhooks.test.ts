import { describe, it, expect, vi } from 'vitest';
import { deliverWebhooks } from '../src/api/webhooks';

describe('deliverWebhooks', () => {
  it('returns zero counts when no subscriptions exist', async () => {
    const env: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({ results: [] }),
          }),
        }),
      },
    };
    const result = await deliverWebhooks(env, 'test@example.com', {
      event: 'new_message',
      inbox_address: 'test@example.com',
      message: { id: 'm1', from_address: 'a@b.c', from_name: '', subject: 'Hi', body_preview: '', received_at: '' },
    });
    expect(result).toEqual({ delivered: 0, failed: 0 });
  });

  it('sends POST with signature header and counts success', async () => {
    const fetchMock = vi.fn(async () => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const env: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [{ id: 1, url: 'https://example.com/hook', secret: 'test-secret-123' }],
            }),
          }),
        }),
      },
    };

    const result = await deliverWebhooks(env, 'test@example.com', {
      event: 'new_message',
      inbox_address: 'test@example.com',
      message: { id: 'm1', from_address: 'a@b.c', from_name: '', subject: 'Hi', body_preview: 'preview', received_at: '2026-01-01' },
    });

    expect(result).toEqual({ delivered: 1, failed: 0 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/hook');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['X-TempeMail-Event']).toBe('new_message');
    expect(init.headers['X-TempeMail-Signature']).toMatch(/^v1=[0-9a-f]{64}$/);
    vi.unstubAllGlobals();
  });

  it('counts failures when webhook returns non-ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const env: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [{ id: 1, url: 'https://example.com/hook', secret: 'abcdefgh' }],
            }),
          }),
        }),
      },
    };
    const result = await deliverWebhooks(env, 'test@example.com', {
      event: 'new_message',
      inbox_address: 'test@example.com',
      message: { id: 'm1', from_address: 'a@b.c', from_name: '', subject: 'Hi', body_preview: '', received_at: '' },
    });
    expect(result).toEqual({ delivered: 0, failed: 1 });
    vi.unstubAllGlobals();
  });

  it('tolerates fetch throw and counts as failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net down'); }));
    const env: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => ({
              results: [{ id: 1, url: 'https://example.com/hook', secret: 'abcdefgh' }],
            }),
          }),
        }),
      },
    };
    const result = await deliverWebhooks(env, 'test@example.com', {
      event: 'new_message',
      inbox_address: 'test@example.com',
      message: { id: 'm1', from_address: 'a@b.c', from_name: '', subject: 'Hi', body_preview: '', received_at: '' },
    });
    expect(result).toEqual({ delivered: 0, failed: 1 });
    vi.unstubAllGlobals();
  });

  it('returns zeros when DB query itself fails', async () => {
    const env: any = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => { throw new Error('db down'); },
          }),
        }),
      },
    };
    const result = await deliverWebhooks(env, 'test@example.com', {
      event: 'new_message',
      inbox_address: 'test@example.com',
      message: { id: 'm1', from_address: 'a@b.c', from_name: '', subject: 'Hi', body_preview: '', received_at: '' },
    });
    expect(result).toEqual({ delivered: 0, failed: 0 });
  });
});
