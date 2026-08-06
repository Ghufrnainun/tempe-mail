# AGENTS.md — TempeMail AI Agent Guide

This document teaches AI coding agents how to work on the TempeMail codebase.

## Project Overview

TempeMail is a self-hosted disposable email service running on Cloudflare Workers. A single worker handles HTTP (web UI + REST API) and inbound email (`email()` handler). Storage is Cloudflare D1 (SQLite). Email Routing is auto-provisioned via the Cloudflare API.

## Tech Stack

- **Runtime:** Cloudflare Workers
- **Language:** TypeScript (strict, ES2022)
- **Router:** Hono v4
- **Email parsing:** PostalMime v2
- **Validation:** Zod
- **Testing:** Vitest
- **Deployment:** Wrangler v4

## Directory Structure

```
src/
├── index.ts          # Worker entry: fetch() + email() + scheduled()
├── env.ts            # Env interface (all bindings)
├── email/
│   ├── ingest.ts     # MIME parser (PostalMime → ParsedEmail)
│   └── headers.ts    # SPF/DKIM/DMARC extractor
├── api/
│   ├── routes.ts     # Hono API routes (inboxes, messages, config)
│   ├── rss.ts        # Per-inbox RSS feeds
│   ├── tagging.ts    # Semantic email classifier
│   └── realtime.ts   # SSE endpoint
├── cf/
│   ├── zones-loader.ts # CF_ZONE_MAP env → domain→zone map
│   └── routing.ts    # Email Routing provisioning
├── db/
│   ├── schema.sql    # D1 schema (inboxes, messages, attachments, sessions)
│   └── realtime-room.ts # Durable Object for SSE
└── web/              # Vanilla JS frontend (no framework)
    ├── index.html
    ├── app.js
    ├── styles.css
    └── i18n/
        ├── en.js
        └── id.js
```

## Setup & Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Typecheck
npm run typecheck

# Provision + deploy (needs .env)
npm run setup
npx wrangler deploy
```

## Conventions

- **No external UI frameworks** — frontend is vanilla HTML/CSS/JS
- **All class names MUST be tempe-mail original** — no tempik class names
- **Dark theme by default** — orange accent (#f97316), Inter Tight + DM Mono fonts
- **No external CSS dependencies** — pure CSS custom properties
- **Responsive** — breakpoints at 900px and 680px
- **Touch targets** — min 42px for interactive elements
- **Reduced motion** — respect `prefers-reduced-motion`
- **Vanilla JS** — no React, no Vue, no jQuery
- **Zod for validation** — all API input validated with Zod schemas

## Secrets

Secrets are defined in `.env` (gitignored). Template: `.env.example`. The `npm run setup` script reads `.env` and provisions Cloudflare resources.

Never hardcode:
- API tokens
- Account IDs
- Domain names (use placeholders in public files)
- Zone IDs

## Roadmap (Phase 2 — done)

- ✅ REST API key authentication
- ✅ Webhook support (POST on new email, HMAC-signed)
- ✅ MCP server (Model Context Protocol) for AI agent integration
- ✅ Attachment download via R2
- ✅ Inbox search

## Community files

- [CONTRIBUTING.md](CONTRIBUTING.md) — how to contribute (quality gate, conventions)
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — behavior expectations
- [SECURITY.md](SECURITY.md) — how to report vulnerabilities
