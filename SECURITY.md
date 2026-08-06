# Security Policy

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.** Disposable email services process sensitive verification codes — coordinated disclosure matters.

Email the maintainers directly via a **GitHub Security Advisory**:

1. Go to https://github.com/ghufronainun/tempe-mail/security/advisories/new
2. Describe the vulnerability, including:
   - Affected version / commit SHA
   - Attack scenario (who can trigger it, what's the impact)
   - Reproduction steps or proof of concept
3. You'll get an acknowledgment within 7 days

If you prefer not to use GitHub, open a private discussion and mention it's security-related.

## What we consider in scope

- Inbox ownership bypass (reading another user's messages)
- API key leakage or authorization flaws
- Webhook signature forgery
- HTML email injection / XSS in the reader
- SSRF via webhook URLs
- Email header injection
- D1/R2 data exposure

## Out of scope

- DDoS / brute-force on the free tier (Cloudflare rate limits apply)
- Phishing using disposable addresses (inherent to the product)
- Social engineering of operators

## Disclosure timeline

- **Acknowledgment:** within 7 days of report
- **Fix:** typically within 14 days for critical issues
- **Public disclosure:** after a fix is deployed and users can upgrade

## Security features built in

- API keys stored as **SHA-256 hashes** (never plaintext)
- Inbox ownership enforced on every message/attachment endpoint
- Webhooks signed with **HMAC-SHA256** (`X-TempeMail-Signature`)
- HTML emails rendered in **sandboxed iframes** (no scripts)
- Input validation via **Zod** on all endpoints
- TTL-clamped inboxes (1h–168h), auto-purged by cron
- Secrets only in `.env` (gitignored)

## Supported versions

| Version | Supported |
|---|---|
| `main` | ✅ |
| Tagged releases (< 0.1.0) | ⚠️ best-effort |
