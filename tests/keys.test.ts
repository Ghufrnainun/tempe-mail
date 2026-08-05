import { describe, it, expect } from 'vitest';
import { hashKey, generateApiKey } from '../src/api/keys';

describe('keys', () => {
  it('generateApiKey produces tmk_ prefixed keys', () => {
    const key = generateApiKey();
    expect(key.startsWith('tmk_')).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it('generateApiKey is unique across calls', () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a).not.toBe(b);
  });

  it('hashKey produces a stable 64-char hex hash', async () => {
    const h1 = await hashKey('abc123');
    const h2 = await hashKey('abc123');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashKey differs for different inputs', async () => {
    const h1 = await hashKey('abc123');
    const h2 = await hashKey('abc124');
    expect(h1).not.toBe(h2);
  });

  it('hashKey output is not the plaintext', async () => {
    const h = await hashKey('tmk_super-secret-key');
    expect(h).not.toContain('tmk_');
  });
});
