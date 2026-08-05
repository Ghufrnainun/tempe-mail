# TempeMail API Reference

Base URL: `https://<your-web-host>/api`

---

## Authentication

Browser sessions use the `x-session-id` header.

### Create Session

```http
POST /api/session
```

Response:
```json
{ "sessionId": "uuid-v4" }
```

---

## Inboxes

### List Inboxes

```http
GET /api/inboxes
x-session-id: <sessionId>
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
x-session-id: <sessionId>
Content-Type: application/json

{
  "localPart": "myname",    // optional — random if omitted
  "domain": "example.com",  // optional — first domain if omitted
  "ttlHours": 48            // optional — defaults to 24
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

---

## Messages

### List Messages

```http
GET /api/inboxes/:address/messages
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
    "attachments": [
      { "filename": "receipt.pdf", "contentType": "application/pdf", "size": 24576 }
    ],
    "received_at": "2026-08-06T12:05:00.000Z"
  }
]
```

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
