import { describe, it, expect } from 'vitest';
import { classifyEmail } from '../src/api/tagging';

type TestCase = [string, string]; // [subject, from]

describe('classifyEmail — verification', () => {
  const cases: TestCase[] = [
    ['Please verify your email address', 'noreply@service.com'],
    ['Your OTP code is 123456', 'noreply@auth.com'],
    ['One-time passcode: 987654', 'otp@company.com'],
    ['Activate your account now', 'support@app.io'],
    ['Confirm your email address', 'noreply@site.net'],
    ['Email verification required', 'admin@host.org'],
    ['Validate your account', 'verify@domain.io'],
  ];
  for (const [subject, from] of cases) {
    it(`tags "${subject.slice(0, 40)}" as verification if no security/marketing pattern`, () => {
      // Note: verification patterns are checked LAST, so security & marketing win over verification
      const result = classifyEmail(subject, from);
      expect(result.label).toBe('Verification');
    });
  }
});

describe('classifyEmail — security', () => {
  const cases: TestCase[] = [
    ['New login from Chrome on Windows', 'security@service.com'],
    ['Your 2FA code is 789012', 'auth@app.io'],
    ['Reset your password', 'support@site.net'],
    ['Sign in to your account', 'noreply@host.org'],
    ['Unauthorized access attempt detected', 'alert@org.dev'],
    ['Two-factor authentication enabled', 'security@bank.com'],
    ['Your credentials were used', 'noreply@service.com'],
    ['Suspicious activity on your account', 'alert@app.io'],
  ];
  for (const [subject, from] of cases) {
    it(`tags "${subject.slice(0, 40)}" as security`, () => {
      const result = classifyEmail(subject, from);
      expect(result.tag).toBe('security');
      expect(result.label).toBe('Security');
    });
  }
});

describe('classifyEmail — testing', () => {
  const cases: TestCase[] = [
    ['Test email from sandbox', 'dev@qa.io'],
    ['Debug: staging deployment', 'ci@company.com'],
    ['Welcome to your demo account', 'trial@service.com'],
    ['Trial period ending soon', 'sales@app.net'],
  ];
  for (const [subject, from] of cases) {
    it(`tags "${subject.slice(0, 40)}" as testing`, () => {
      const result = classifyEmail(subject, from);
      expect(result.tag).toBe('testing');
      expect(result.label).toBe('Testing');
    });
  }
});

describe('classifyEmail — marketing', () => {
  const cases: TestCase[] = [
    ['Weekly newsletter — top stories', 'digest@media.com'],
    ['50% off — limited time offer!', 'deals@shop.net'],
    ['Your discount code inside', 'promo@store.io'],
    ['Summer campaign launch', 'marketing@brand.org'],
    ['Unsubscribe from our list', 'noreply@spam.io'],
    ['Welcome to our community!', 'hello@startup.com'],
    ['Exclusive deal just for you', 'vip@club.net'],
    ['Our biggest sale of the year', 'shop@retail.io'],
    ['Use coupon SAVE20 at checkout', 'offers@discount.org'],
  ];
  for (const [subject, from] of cases) {
    it(`tags "${subject.slice(0, 40)}" as marketing`, () => {
      const result = classifyEmail(subject, from);
      expect(result.tag).toBe('marketing');
      expect(result.label).toBe('Marketing');
    });
  }
});

describe('classifyEmail — general fallback', () => {
  it('returns general for benign conversation', () => {
    const result = classifyEmail('Hey, how are you?', 'friend@personal.com');
    expect(result.tag).toBe('general');
    expect(result.label).toBe('General');
  });

  it('returns general for personal email', () => {
    const result = classifyEmail('Dinner tonight?', 'mom@family.org');
    expect(result.tag).toBe('general');
  });

  it('returns general for empty subject and unknown sender', () => {
    const result = classifyEmail('', 'unknown@sender.io');
    expect(result.tag).toBe('general');
  });

  it('returns general for truly empty inputs', () => {
    const result = classifyEmail('', '');
    expect(result.tag).toBe('general');
  });
});

describe('classifyEmail — rule priority', () => {
  it('verification beats security (first-match wins)', () => {
    const result = classifyEmail('Confirm your password change', 'system@host.com');
    expect(result.tag).toBe('verification');
  });

  it('security beats testing', () => {
    const result = classifyEmail('Test your login experience', 'dev@qa.io');
    expect(result.tag).toBe('security');
  });

  it('testing beats marketing', () => {
    const result = classifyEmail('Test our new offer!', 'qa@company.com');
    expect(result.tag).toBe('testing');
  });
});

describe('classifyEmail — sender-address matching', () => {
  it('detects verification from sender domain', () => {
    const result = classifyEmail('Hello', 'noreply@verify.example.com');
    expect(result.tag).toBe('verification');
  });

  it('detects marketing from sender domain', () => {
    const result = classifyEmail('Hi there', 'info@discount.example.net');
    expect(result.tag).toBe('marketing');
  });

  it('detects security from sender domain', () => {
    const result = classifyEmail('Alert', 'alerts@security.example.com');
    expect(result.tag).toBe('security');
  });
});
