# 🥢 TempeMail

<p align="center">
  <img src="assets/logo.png" alt="TempeMail logo" width="120" />
</p>

> **Zero-config, multi-domain disposable email on Cloudflare Workers.**

[![CI](https://github.com/Ghufrnainun/tempe-mail/actions/workflows/ci.yml/badge.svg)](https://github.com/Ghufrnainun/tempe-mail/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-4.105-orange?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ghufronainun/tempe-mail/pulls)

TempeMail is a self-hosted disposable email service that runs entirely on the Cloudflare edge — no VPS, no Docker, no SMTP server. One worker handles the web UI, REST API, inbound email delivery, and automatic provisioning.

Deploy in minutes with **3 environment values**:

```bash
git clone https://github.com/ghufronainun/tempe-mail.git
cd tempe-mail
npm install
cp .env.example .env      # fill 3 values
npm run setup              # provisions everything automatically
npx wrangler deploy        # go live 🚀
```

---

## Table of Contents

- [Why TempeMail?](#why-tempe-mail)
- [Features](#features)
- [How it works](#how-it-works)
- [Quick Start](#quick-start)
- [Development](#development)
- [Project Structure](#project-structure)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

---

## Why TempeMail?

TempeMail is a self-hosted disposable email service that runs entirely on the Cloudflare edge — no VPS, no Docker, no SMTP server. One worker handles the web UI, REST API, inbound email delivery, and automatic provisioning.

What sets it apart from other temp-mail projects:

- **Multi-domain** — serve disposable inboxes across any number of domains from a single worker, without extra config.
- **Zero-config setup** — `npm run setup` provisions D1, Email Routing, and zone catch-all rules automatically. Idempotent and re-runnable.
- **Deliverability diagnostics** — SPF/DKIM/DMARC status for every message, which most temp-mail services don't expose.
- **Agent-ready** — REST API keys, webhooks, RSS feeds, SSE streams, and a built-in MCP server so AI agents can read inboxes natively.
- **Self-hosted** — you own the infrastructure and the data, on Cloudflare's free tier.

---

## Features

### 📬 Core
- **Zero-config setup** — `npm run setup` provisions D1, Email Routing, zone catch-all rules, and renders `wrangler.toml` automatically. Idempotent — safe to re-run anytime.
- **Multi-domain** — serve disposable inboxes across 1 or N domains from a single worker. `DOMAINS=mail.example.com,mail2.example.net` and you're done.
- **HTML email rendering** — full HTML email support, rendered safely in a sandboxed iframe (`sandbox=""`). Email looks exactly as the sender designed it.
- **OTP auto-highlight** — verification codes (4–8 digit) are automatically detected and displayed prominently in monospace, so you never hunt for the code.
- **Semantic tagging** — emails are auto-classified into 🔑 Verification, 🔒 Security, 🧪 Testing, or 📣 Marketing based on subject and sender.
- **SPF/DKIM/DMARC viewer** — inspect `Received-SPF` and `Authentication-Results` headers for every message. Gold for QA and email deliverability testing.

### 🎛️ UX
- **Custom addresses** — choose your own local part (`myalias@domain.com`) or let TempeMail generate a random one.
- **Auto-expire** — inboxes expire after a configurable TTL (default 24h, range 1h–168h).
- **Attachment metadata** — file name, type, and size shown as chips.
- **Starred messages** — pin important emails, persisted in localStorage.
- **Filter chips** — quickly filter All / Verification / Starred.
- **Realtime updates** — new messages appear instantly via SSE (Durable Objects).
- **Dark mode** — beautiful dark-first UI with light toggle.
- **i18n** — English and Bahasa Indonesia, toggle in one click.
- **Fully responsive** — mobile-first, breakpoints at 900px and 680px.

### 🤖 Developer / AI-agent friendly
- **REST API** — full JSON API for scripts and automation.
- **API key auth** — `Authorization: Bearer tmk_...` for scripts/agents (no browser session needed). Keys hashed with SHA-256, revocable.
- **Webhooks** — POST to any URL when new mail arrives, signed with HMAC-SHA256 (`X-TempeMail-Signature`).
- **MCP server** — Model Context Protocol bridge so Claude Code / Cursor / any MCP client can read inboxes as tools (`list_inboxes`, `list_messages`, `get_message`).
- **RSS feed per inbox** — `GET /inboxes/:address/feed.xml` requires no auth (the address itself is the secret). Poll it from any script.
- **SSE stream per inbox** — realtime push to any client.
- **Inbox search** — `GET /inboxes/:address/search?q=` searches subject, body, and sender.
- **Attachment download** — *(optional)* full attachment bodies stored in R2 and downloadable per message. Without R2 you still get attachment metadata + the message body; only the file download is skipped.
- **AGENTS.md** — onboarding guide so AI coding agents can work on this repo immediately.

---

## How it works

```
Sender
  │
  ▼
Cloudflare MX
  │  (Email Routing → Worker)
  ▼
Worker email() handler
  │  PostalMime parses MIME
  │  (text + html + headers + attachments)
  ▼
D1 Database (SQLite)
  ├─ inboxes      (address, expires_at)
  ├─ messages     (body, body_html, spf, dkim, dmarc, ...)
  ├─ attachments  (filename, content_type, size)
  └─ sessions     (browser session ↔ inbox ownership)
  │
  ┌────┴────┐
  ▼         ▼
REST API   Web UI (static assets)
  │         ├─ index.html
  ├─ /api/session          └─ app.js (vanilla JS, no framework)
  ├─ /api/inboxes
  ├─ /api/inboxes/:addr/messages
  ├─ /api/inboxes/:addr/feed.xml   (RSS)
  └─ /api/inboxes/:addr/events     (SSE)
```

**The flow:**
1. Sender emails `anything@yourdomain.com`
2. Cloudflare Email Routing delivers to the Worker's `email()` handler
3. PostalMime parses the MIME — extracts text, HTML, headers, attachments, deliverability status
4. Data is stored in D1; the inbox is auto-created if it doesn't exist
5. Subscribers listening via SSE get a realtime push
6. Web UI polls or streams and renders everything with OTP highlight + semantic tags

### Tech stack

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (edge) |
| Language | TypeScript 5.5 (strict) |
| HTTP router | Hono v4 |
| Email parsing | PostalMime v2 |
| Validation | Zod v3 |
| Database | Cloudflare D1 (SQLite) |
| Realtime | Durable Objects (SSE) |
| Frontend | Vanilla JS (zero framework) |
| Testing | Vitest |

---

## Quick Start

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is enough)
- At least one domain managed by Cloudflare DNS
- Node.js 18+ and npm

### 1. Clone & install

```bash
git clone https://github.com/ghufronainun/tempe-mail.git
cd tempe-mail
npm install
```

### 2. Get your Cloudflare credentials

You need two things from Cloudflare: **an API token** and **your account ID**.

#### Create an API token

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/) and log in
2. Click your profile icon (top-right) → **My Profile** → **API Tokens**
3. Click **Create Token**
4. Choose **Create Custom Token** (or use the "Edit zone DNS" template as a starting point)
5. Give the token a name like `tempe-mail`
6. Add these permissions (all needed for one-command provisioning):
   - **Account → Workers Scripts → Edit**
   - **Account → Workers D1 → Edit**
   - **Account → Workers R2 Storage → Edit**
   - **Account → Email Routing Addresses → Edit**
   - **Account → Email Routing Rules → Edit**
   - **Zone → Zone → Read** (for all zones that host your mail domains)
   - **Zone → DNS → Edit** (optional, for automatic DNS records)
   - **Zone → Email Routing → Edit**
7. Under **Zone Resources**, choose **All zones** (or select the specific zones you'll use)
8. Click **Continue to summary** → **Create Token**
9. **Copy the token immediately** — it's shown only once. It looks like `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

> ⚠️ Treat this token like a password. Anyone with it can modify your Cloudflare resources. It is stored in `.env` (gitignored) — never commit it.

#### Find your Account ID

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/)
2. Look at the sidebar on the left — your **Account ID** is listed right below "Workers & Pages"
3. Alternatively: click any domain → scroll down in the right sidebar → "Account ID"
4. It's a 32-character hex string like `a1b2c3d4e5f60718293a4b5c6d7e8f90`

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` — only 3 values are required:

```env
CLOUDFLARE_API_TOKEN=your_cf_api_token     # Workers + D1 + Email Routing + Zone permissions
CLOUDFLARE_ACCOUNT_ID=your_account_id      # dashboard → Workers & Pages → account ID
DOMAINS=mail.example.com                   # one or more, comma-separated
WEB_HOST=temp.example.com                  # subdomain for the web UI
```

> **Multi-domain?** Just add more: `DOMAINS=mail.example.com,mail2.example.net,mail3.example.org`

### 4. Setup & deploy

```bash
npm run setup        # creates D1, applies schema, enables Email Routing,
                     # sets catch-all → worker for every domain, renders wrangler.toml
npx wrangler deploy  # pushes the worker + static assets to the edge
```

Open `https://temp.example.com` and start receiving email. 🎉

**Expected setup output:**
```
📦 Setting up D1 database...
   Created D1 database: 12345678-...
📋 Applying schema...
   Schema applied.
🌐 Discovering zone IDs...
   mail.example.com → zone abcdef...
📧 Provisioning Email Routing...
   mail.example.com: catch-all → worker:tempe-mail (enabled)
📝 Rendering wrangler.toml...
   wrangler.toml rendered.

✅ Setup complete!
   1. Review wrangler.toml
   2. Run: npx wrangler deploy
   3. Open: https://temp.example.com
```

### Optional: enable R2 attachment downloads

R2 is **optional** — without it TempeMail works fully (metadata + body), only file downloads are skipped. To enable:

1. **Enable R2 in your account:** Cloudflare dashboard → **R2** → **Get started** (free tier available)
2. Create the bucket:
   ```bash
   npx wrangler r2 bucket create tempe-mail-attachments
   ```
3. Uncomment the `[[r2_buckets]]` block in `wrangler.toml`, fill in your bucket name, then re-deploy:
   ```bash
   npx wrangler deploy
   ```

### Optional: manual setup (if the script hits permission limits)

If your API token lacks D1 or Email Routing permissions, `npm run setup` may skip those steps. You can do them manually:

1. **Create the D1 database:**
   ```bash
   npx wrangler d1 create tempe-mail-db
   ```
   Copy the `database_id` from the output.

2. **Apply the schema:**
   ```bash
   npx wrangler d1 execute tempe-mail-db --remote --file=src/db/schema.sql
   ```

3. **Create the R2 bucket** (optional — for attachment downloads):
   ```bash
   npx wrangler r2 bucket create tempe-mail-attachments
   ```

4. **Fill in `wrangler.toml`:** replace the `REPLACED_BY_SETUP` placeholders with your real database ID and routes, and uncomment the `[[r2_buckets]]` block.

5. **Enable Email Routing in the dashboard:** Cloudflare dashboard → your domain → **Email** → **Email Routing** → enable it, add a catch-all rule pointing to the `tempe-mail` worker.

6. **Deploy:**
   ```bash
   npx wrangler deploy
   ```

> Note: Email Worker bindings (`[email]`) are always configured via the dashboard/API — not wrangler.toml. That's why `wrangler` may warn about the `email` field; it's harmless.

---

## Development

```bash
npm run dev           # applies schema to local D1, then starts wrangler dev (port 8787)
npm test              # run all 77 tests (Vitest)
npm run typecheck     # strict TypeScript check
```

Local dev guide:
1. `npm run dev` — starts the worker locally at `http://localhost:8787`
2. The D1 schema is **applied automatically** to the local database on startup (no more `no such table` errors)
3. Inbound email is simulated via unit/E2E tests (`tests/email-handler-e2e.test.ts`)
4. The scheduled purge trigger can be fired manually: `curl "http://localhost:8787/cdn-cgi/local/scheduled"`

> `wrangler dev` is for development only. Production runs on Cloudflare's edge via `wrangler deploy` — your machine/VPS is completely uninvolved.

---

## Project Structure

```
tempe-mail/
├── src/
│   ├── index.ts                 # Worker entry: fetch() + email() + scheduled purge
│   ├── env.ts                   # Environment bindings interface
│   ├── email/
│   │   ├── ingest.ts            # MIME parsing (PostalMime) → text/html/headers/attachments
│   │   └── headers.ts           # SPF/DKIM/DMARC extraction from raw headers
│   ├── api/
│   │   ├── routes.ts            # Hono REST API (session, inboxes, messages)
│   │   ├── rss.ts               # Per-inbox RSS 2.0 feeds
│   │   ├── tagging.ts           # Semantic classifier (content rules)
│   │   └── realtime.ts          # SSE endpoint → Durable Object
│   ├── cf/
│   │   ├── zones-loader.ts      # CF_ZONE_MAP env → domain→zone map
│   │   └── routing.ts           # Email Routing provisioning (setup-time)
│   ├── db/
│   │   ├── schema.sql           # D1 schema (inboxes, messages, attachments, sessions)
│   │   └── realtime-room.ts     # Durable Object: SSE room per inbox
│   └── web/                     # Frontend (vanilla, dark theme)
│       ├── index.html
│       ├── app.js               # Rendering, polling/SSE, OTP, tags, i18n
│       ├── styles.css           # Responsive, dark/light, 3 breakpoints
│       └── i18n/{en,id}.js      # String dictionaries
├── scripts/
│   ├── setup.mjs                # Zero-config provisioning script
│   └── dev.mjs                  # Dev helper (auto-schema + wrangler dev)
├── tests/                       # Vitest: 5 files, 77 tests
├── .github/workflows/ci.yml     # CI: typecheck + tests on push/PR
├── .env.example                 # Environment template
├── wrangler.toml                # Generated by setup (placeholders committed)
├── README.md
├── AGENTS.md                    # AI-agent onboarding guide
├── API.md                       # Full API reference
└── LICENSE                      # MIT
```

---

## API Reference

### Authentication

Browser sessions via `x-session-id` header. Create one:

```http
POST /api/session
→ { "sessionId": "uuid-v4" }
```

All inbox/message endpoints require the header. Inbox ownership is enforced — you can only read messages from inboxes your session owns.

### Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/config` | — | App config (name, domains) |
| `POST` | `/api/session` | — | Create browser session |
| `GET` | `/api/inboxes` | session | List active inboxes |
| `POST` | `/api/inboxes` | session | Create inbox (`localPart`, `domain`, `ttlHours`) |
| `GET` | `/api/inboxes/:address/messages` | session | List messages + tags + deliverability + attachments |
| `DELETE` | `/api/inboxes/:address` | session | Unlink inbox from session |
| `GET` | `/api/inboxes/:address/feed.xml` | public | RSS 2.0 feed (address = secret) |
| `GET` | `/api/inboxes/:address/events` | public | SSE realtime stream |

### Example: create inbox

```bash
curl -X POST https://temp.example.com/api/inboxes \
  -H "x-session-id: <sessionId>" \
  -H "Content-Type: application/json" \
  -d '{"localPart": "myalias", "ttlHours": 48}'
```

```json
{
  "address": "myalias@mail.example.com",
  "domain": "mail.example.com",
  "ttlHours": 48
}
```

Full reference: [API.md](./API.md) · Live docs: [`/docs`](https://temp.atminku.my.id/docs)

---

## Configuration

| `.env` variable | Required | Default | Description |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | — | CF API token (Workers Scripts, D1, Email Routing, Zone:Edit) |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | — | Cloudflare account ID |
| `DOMAINS` | ✅ | — | Comma-separated mail domains (first = default) |
| `WEB_HOST` | ✅ | — | Subdomain for the web UI (must be in a zone you own) |
| `APP_NAME` | ❌ | `TempeMail` | App name shown in the UI |
| `ADMIN_KEY` | ❌ | `change-me` | Key guarding maintenance endpoints |
| `CF_ZONE_MAP` | ❌ | auto | Manual `domain=zone_id` map (auto-discovered by setup) |
| `RSS_PUBLIC` | ❌ | `true` | Set `false` to require `?token=` (SHA-1 of address) for RSS feeds |
| `MAX_INBOXES_PER_SESSION` | ❌ | unlimited | Cap inboxes per session/API key (simple rate limit; e.g. `50`) |

All values are read at setup time. Secrets stay in `.env` (gitignored) — never commit them.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `no such table` in local dev | Run `npm run dev` (auto-applies schema). Or: `npx wrangler d1 execute tempe-mail-db --local --file=src/db/schema.sql` |
| Email not arriving | Verify Email Routing is enabled on the zone: dashboard → Email → Email Routing. Check catch-all rule points to `tempe-mail` worker |
| Setup says "zone not found" | The domain must be added to Cloudflare with DNS managed there (`ns.cloudflare.net` nameservers) |
| Catch-all rejected by CF API | Some zones need the catch-all set manually in the dashboard. The setup script falls back to exact-rule provisioning |
| Deploy fails on custom domain | Ensure the subdomain (`WEB_HOST`) is created as a zone/custom hostname first, or use `workers.dev` route temporarily |
| `[email]` field warning in wrangler | Harmless — Email Worker bindings are configured via the dashboard/API, not wrangler.toml |

---

## Roadmap

See [AGENTS.md](./AGENTS.md) and the plan document for details.

### ✅ Phase 2 — done
- [x] REST API key authentication (no browser session needed)
- [x] Webhooks (POST to a URL on new mail, HMAC-signed)
- [x] MCP server (Model Context Protocol) for AI agents
- [x] Full attachment download (R2 storage)
- [x] Inbox search

### 🔜 Planned
- [ ] Frontend UI for API keys, webhooks, and search (backends are API-ready)
- [ ] Rate limiting per key
- [ ] Multiple webhook events (message deleted, inbox expired)

---

## Contributing

Contributions are welcome! Open an issue or PR.

- Start with [CONTRIBUTING.md](./CONTRIBUTING.md) — setup, conventions, quality gate
- All code must pass: `npm run typecheck` and `npm test`
- Follow the [Code of Conduct](./CODE_OF_CONDUCT.md)
- Found a vulnerability? See [SECURITY.md](./SECURITY.md) — please report privately
- Use the issue/PR templates in `.github/`

---

## License

[MIT](./LICENSE) © 2026 masantoid, TempeMail contributors.

Derived from [hirotomasato/tempik](https://github.com/hirotomasato/tempik). TempeMail has been rewritten from scratch with multi-domain support, deliverability diagnostics, zero-config provisioning, and an original UI. This project is distributed under the MIT License — see the LICENSE file for the full text.
