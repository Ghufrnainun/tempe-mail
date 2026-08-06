import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/api/redact';

describe('redactSecrets (webhook body_preview leak fix)', () => {
  it('redacts 4-8 digit OTP codes', () => {
    expect(redactSecrets('Your code is 482913')).toBe('Your code is [REDACTED]');
  });

  it('redacts 6-digit codes', () => {
    expect(redactSecrets('code: 123456')).toContain('[REDACTED]');
  });

  it('redacts 6-char alphanumeric tokens', () => {
    expect(redactSecrets('token ab12cd')).toContain('[REDACTED]');
  });

  it('keeps normal text intact', () => {
    const text = 'Welcome to the service! Please verify your email address.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('redacts codes embedded in sentences', () => {
    expect(redactSecrets('Your verification code is 428913, valid for 10 min.')).toBe(
      'Your verification code is [REDACTED], valid for 10 min.'
    );
  });
});
