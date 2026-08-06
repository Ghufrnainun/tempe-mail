/**
 * Redact sensitive-looking codes from text sent to external webhooks.
 * Replaces 4-8 digit codes (OTP) and common verification tokens with [REDACTED].
 */
export function redactSecrets(text: string): string {
  return text
    // 4-8 digit standalone codes (OTP, verification)
    .replace(/\b\d{4,8}\b/g, '[REDACTED]')
    // 6+ char codes that mix letters AND digits (verification tokens),
    // but NOT plain words (all letters) or years (pure digits, already handled)
    .replace(/\b(?=[a-zA-Z]*\d)(?=\d*[a-zA-Z])[a-zA-Z0-9]{6,12}\b/g, '[REDACTED]');
}
