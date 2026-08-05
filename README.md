# 🥢 TempeMail

> Zero-config multi-domain disposable email on Cloudflare Workers.

Deploy a temporary email service in minutes. One worker handles everything — web UI, REST API, inbound email delivery, and automatic provisioning. No VPS. No Docker. No SMTP.

```bash
cp .env.example .env   # fill 3 values
npm run setup          # provisions everything
npx wrangler deploy    # go live
```

---

## Why TempeMail?

| | TempeMail | tempik | inbix |
|---|---|---|---|
| Multi-domain | ✅ | ❌ | ❌ |
| Zero-config setup | ✅ automated | ❌ manual | ❌ manual |
| HTML email render | ✅ | ❌ | ✅ |
| OTP auto-highlight | ✅ | ❌ | ❌ |
| SPF/DKIM/DMARC viewer | ✅ | ❌ | ❌ |
| Semantic tags | ✅ | ❌ | ❌ |
| Custom address | ✅ | ❌ | ❌ |
| Self-hosted | ✅ | ✅ | ✅ |
| Cloudflare free tier | ✅ | ✅ | ✅ |

---

## Features

- **Zero-config setup** — `npm run setup` provisions D1, Email Routing, zone catch-all rules, and renders `wrangler.toml` automatically
- **Multi-domain** — serve disposable inboxes across 1 or N domains
- **HTML email rendering** — full HTML email support in sandboxed iframes
- **OTP auto-highlight** — verification codes are automatically detected and displayed prominently
- **Semantic tagging** — emails are classified as 🔑 Verification, 🔒 Security, 🧪 Testing, or 📣 Marketing
- **SPF/DKIM/DMARC viewer** — inspect deliverability headers for every message (useful for QA/testing)
- **Custom addresses** — choose your own local part or generate random addresses
- **Auto-expire** — inboxes expire after a configurable TTL (default 24h)
- **RSS feeds** — every inbox has a public RSS feed (agent-friendly, no API key needed)
- **Realtime updates** — new messages appear via SSE without refreshing
- **Starred messages** — pin important emails
- **i18n** — English and Bahasa Indonesia
- **Dark mode** — by default, with toggle

---

## Quick Start

### Prerequisites

- A Cloudflare account
- A domain managed by Cloudflare DNS
- Node.js 18+

### 1. Clone & install

```bash
git clone https://github.com/ghufronainun/tempe-mail.git
cd tempe-mail
npm install
```

### 2. Configure

Copy the environment template and fill in your values:

```bash
cp .env.example .env
```

Edit `.env` — only 3 values are required:

```env
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
DOMAINS=mail.example.com
WEB_HOST=temp.example.com
```

### 3. Setup & deploy

```bash
npm run setup    # provisions D1 + Email Routing + wrangler config
npx wrangler deploy
```

Open your `WEB_HOST` URL and start receiving email.

---

## Architecture

```
Sender → Cloudflare MX → Worker email() handler
                              │
                    PostalMime parse (text + html + headers)
                              │
                         D1 Database
                              │
                  ┌───────────┴───────────┐
                  │                       │
            REST API (Hono)         Web UI (static assets)
          /api/session               index.html
          /api/inboxes               app.js (vanilla)
          /api/inboxes/:addr/msgs     dark theme
          /api/inboxes/:addr/feed.xml
          /api/inboxes/:addr/events (SSE)
```

- **Cloudflare Workers** — edge runtime
- **Hono** — HTTP router (REST API)
- **PostalMime** — MIME email parsing
- **D1** — SQLite database (inboxes, messages, attachments)
- **Vanilla JS** — zero-framework frontend
- **Durable Objects** — SSE realtime rooms

---

## API Reference

### Authentication

Browser sessions via `x-session-id` header. Create one with `POST /api/session`.

### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | App config (name, domains) |
| `POST` | `/api/session` | Create browser session |
| `GET` | `/api/inboxes` | List active inboxes (needs session header) |
| `POST` | `/api/inboxes` | Create inbox (optional: localPart, domain, ttlHours) |
| `GET` | `/api/inboxes/:address/messages` | List messages with attachments + tags + deliverability |
| `DELETE` | `/api/inboxes/:address` | Remove inbox from session |
| `GET` | `/api/inboxes/:address/feed.xml` | RSS feed (public) |
| `GET` | `/api/inboxes/:address/events` | SSE stream (public) |

Detailed API reference in [API.md](./API.md).

---

## Configuration

| `.env` variable | Required | Description |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | CF API token (Workers, D1, Email Routing, Zone permissions) |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | Your Cloudflare account ID |
| `DOMAINS` | ✅ | Comma-separated mail domains |
| `WEB_HOST` | ✅ | Subdomain for the web UI |
| `APP_NAME` | ❌ | App name in UI (default: TempeMail) |
| `ADMIN_KEY` | ❌ | Key for maintenance endpoints |
| `CF_ZONE_MAP` | ❌ | Manual domain→zone mapping (auto-discovered by setup) |

---

## License

MIT © 2026 masantoid, TempeMail contributors.

Derived from [hirotomasato/tempik](https://github.com/hirotomasato/tempik). TempeMail has been rewritten from scratch with multi-domain support, deliverability diagnostics, zero-config provisioning, and an original UI.
