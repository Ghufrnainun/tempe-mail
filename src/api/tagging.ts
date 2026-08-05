/**
 * Semantic email classifier — assigns a tag and human-readable label
 * based on subject-line patterns and sender address heuristics.
 *
 * Tags are ordered by priority: the first match wins, so more specific
 * categories are checked before the fallback 'general'.
 */

export type EmailTag = 'verification' | 'security' | 'testing' | 'marketing' | 'general';

export interface ClassifiedTag {
  tag: EmailTag;
  label: string;
}

interface Rule {
  tag: EmailTag;
  label: string;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    tag: 'verification',
    label: 'Verification',
    patterns: [
      /\bverify\b/i,
      /\bverification\b/i,
      /\botp\b/i,
      /\bone.?time.?pass/i,
      /passcode/i,
      /\bconfirm\b/i,
      /\bactivate\b/i,
      /\bactivation\b/i,
      /\bemail\s*verif/i,
      /\bvalidate\b/i,
    ],
  },
  {
    tag: 'security',
    label: 'Security',
    patterns: [
      /\blog\s*in\b/i,
      /\blogin\b/i,
      /\bsign\s*in\b/i,
      /\bsignin\b/i,
      /\b2fa\b/i,
      /\btwo.?factor\b/i,
      /\bpassword\b/i,
      /\bpasswd\b/i,
      /\baccess\b/i,
      /\bunauthorized\b/i,
      /\bauthori[sz]ation\b/i,
      /\bcredential/i,
      /\bsuspicious\b/i,
      /\bsecurity\b/i,
      /\bauthenticate/i,
    ],
  },
  {
    tag: 'testing',
    label: 'Testing',
    patterns: [
      /\btest\b/i,
      /\btrial\b/i,
      /\bsandbox\b/i,
      /\bdev\b/i,
      /\bstaging\b/i,
      /\bdemo\b/i,
      /\bdebug\b/i,
    ],
  },
  {
    tag: 'marketing',
    label: 'Marketing',
    patterns: [
      /\boffer\b/i,
      /\bnewsletter\b/i,
      /\bpromo\b/i,
      /\bpromotion\b/i,
      /\bdiscount\b/i,
      /\bsale\b/i,
      /\bcoupon\b/i,
      /\bdeal\b/i,
      /\bunsubscribe\b/i,
      /\bmarketing\b/i,
      /\bcampaign\b/i,
      /\bwelcome\b/i,
    ],
  },
];

/**
 * Classify an email based on its subject and sender address.
 * Rules are checked in priority order; the first match wins.
 * Falls back to 'general'.
 */
export function classifyEmail(subject: string, fromAddress: string): ClassifiedTag {
  const haystack = `${subject} ${fromAddress}`;

  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(haystack)) {
        return { tag: rule.tag, label: rule.label };
      }
    }
  }

  return { tag: 'general', label: 'General' };
}
