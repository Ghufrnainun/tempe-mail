# TempeMail API Reference

Base URL: `https://<your-web-host>/api`

---

## Authentication

Two auth methods are supported:

1. **Browser session** — `x-session-id: <uuid>` header (created via `POST /api/session`)
2. **API key** — `Authorization: Bearer tmk_...` header (created via `POST /api/keys` — for scripts, agents, MCP)

### Create Session

```http
POST /api/session
```

Response:
```json
{ "sessionId": "uuid-v4" }
```

### Create API Key (requires a browser session)

```http
POST /api/keys
x-session-id: <sessionId>
x-key-name: my-script        # optional label
```

Response (key shown **once** — store it safely):
```json
{ "id": 1, "key": "tmk_9dV5k2..." }
```

### List API Keys

```http
GET /api/keys
x-session-id: <sessionId>
```

### Revoke API Key

```http
DELETE /api/keys/:id
x-session-id: <sessionId>
```

Keys are stored as SHA-256 hashes — the raw key can never be recovered.

---

## Inboxes

### List Inboxes

```http
GET /api/inboxes
x-session-id: <sessionId>
# or
Authorization: Bearer tmk_...
```

Response:
```json
[
  {
    "address": "coolfox123@example.com",
    "created_at": "2026-08-06T12:00:00.000Z",
    "expires_at": "2026-08-07T12:00:00.000Z"
  }
]
```

### Create Inbox

```http
POST /api/inboxes
Authorization: Bearer tmk_...
Content-Type: application/json

{
  "localPart": "myname",    // optional — random if omitted
  "domain": "example.com",  // optional — first domain if omitted
  "ttlHours": 48            // optional — defaults to 24, clamp 1..168
}
```

Response:
```json
{
  "address": "myname@example.com",
  "domain": "example.com",
  "ttlHours": 48
}
```

### Delete Inbox

```http
DELETE /api/inboxes/:address
x-session-id: <sessionId>
```

Unlinks the inbox from your session/API key.

---

## Messages

### List Messages

```http
GET /api/inboxes/:address/messages
x-session-id: <sessionId>
```

Response:
```json
[
  {
    "id": "uuid-v4",
    "from_address": "sender@example.com",
    "from_name": "John Doe",
    "subject": "Your OTP Code",
    "body": "Your verification code is 123456",
    "body_html": "<html>...</html>",
    "spf": "pass",
    "dkim": "pass",
    "dmarc": "pass",
    "tag": "verification",
    "tag_label": "Verification",
    "attachments": [
      { "filename": "receipt.pdf", "contentType": "application/pdf", "size": 24576 }
    ],
    "received_at": "2026-08-06T12:05:00.000Z"
  }
]
```

### Search Inbox

```http
GET /api/inboxes/:address/search?q=<query>
```

Requires auth. `q` must be at least 2 characters. Searches subject, body, and from address. Returns up to 50 results.

```json
[
  {
    "id": "uuid-v4",
    "subject": "Your OTP Code",
    "from_address": "sender@example.com",
    "from_name": "John Doe",
    "received_at": "2026-08-06T12:05:00.000Z"
  }
]
```

---

## Webhooks

Subscribe a URL to receive POSTs when new mail arrives. Payload is signed with `X-TempeMail-Signature: v1=<hmac-sha256-hex>` using your secret.

### Subscribe

```http
POST /api/inboxes/:address/webhooks
Authorization: Bearer tmk_...
Content-Type: application/json

{
  "url": "https://example.com/hook",
  "secret": "your-webhook-secret",   // min 8 chars
  "events": "new_message"            // default
}
```

### List Subscriptions

```http
GET /api/inboxes/:address/webhooks
```

### Unsubscribe

```http
DELETE /api/inboxes/:address/webhooks/:id
```

### Delivery Payload

```json
{
  "event": "new_message",
  "inbox_address": "myname@example.com",
  "message": {
    "id": "uuid-v4",
    "from_address": "sender@example.com",
    "from_name": "John Doe",
    "subject": "Your OTP Code",
    "body_preview": "Your verification code is 123456",
    "received_at": "2026-08-06T12:05:00.000Z"
  }
}
```

Headers: `Content-Type: application/json`, `X-TempeMail-Event: new_message`, `X-TempeMail-Signature: v1=<hmac>`.

---

## Attachments

### Download Attachment

```http
GET /api/messages/:messageId/attachments/:filename
```

Requires auth (session or API key) and inbox ownership. Streams the file from R2 with `Content-Disposition: attachment`.

If the attachment body was not stored (no R2 binding), returns `410` with size metadata.

---

## RSS Feed

```http
GET /api/inboxes/:address/feed.xml
```

Public — no authentication required. The address acts as the secret.

Returns RSS 2.0 XML with message items.

---

## SSE (Realtime)

```http
GET /api/inboxes/:address/events
```

Server-Sent Events stream. Public — connects to a Durable Object room per inbox.

Event: `new-message`
Data: message JSON object.

---

## MCP Server (AI Agents)

The repo ships an MCP server implementing the Model Context Protocol (stdio transport). It lets AI agents (Claude Code, Cursor, etc.) read inboxes through natural tool calls.

### Tools

| Tool | Description |
|---|---|
| `list_inboxes` | List all inboxes owned by the API key |
| `list_messages` | List messages (optional `tag` filter: verification/security/testing/marketing/general, `limit`) |
| `get_message` | Fetch full message content by ID |

### Run

```bash
TEMPEMAIL_BASE_URL=https://temp.example.com \
TEMPEMAIL_API_KEY=tmk_... \
npx tsx src/api/mcp.ts
```

### Register with Claude Code

```bash
claude mcp add tempe-mail -- node /path/to/tempe-mail/src/api/mcp.ts
```

---

## Config

```http
GET /api/config
```

Response:
```json
{
  "appName": "TempeMail",
  "mailDomain": "example.com",
  "domains": ["example.com", "example.net"],
  "workerName": "tempe-mail"
}
```

---

## Errors

All endpoints return JSON errors:

```json
{ "error": "x-session-id or Bearer API key required" }
{ "error": "invalid body", "details": ["invalid local part"] }
{ "error": "inbox not found" }
```

| Status | Meaning |
|---|---|
| `400` | Invalid input (malformed JSON, bad schema) |
| `401` | Missing/invalid auth |
| `404` | Inbox/webhook/attachment not found (or not owned) |
| `410` | Attachment metadata exists but body not stored |
| `500` | Internal error |
