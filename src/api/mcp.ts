/**
 * TempeMail MCP Server — Model Context Protocol bridge.
 *
 * Lets AI agents (Claude Code, Cursor, etc.) read disposable inboxes
 * through natural MCP tool calls.
 *
 * ## Setup
 * ```bash
 * # 1. Create an API key (from the web UI or curl)
 * curl -X POST https://temp.example.com/api/keys -H "x-session-id: <sid>"
 * # → { "id": 1, "key": "tmk_..." }
 *
 * # 2. Run this server
 * TEMPEMAIL_BASE_URL=https://temp.example.com \
 * TEMPEMAIL_API_KEY=tmk_... \
 * npx tsx src/api/mcp.ts
 *
 * # 3. Register with your MCP client (stdio):
 * #    claude mcp add tempe-mail -- node /path/to/src/api/mcp.ts
 * ```
 *
 * Uses stdio JSON-RPC 2.0 — the standard MCP transport.
 */
import * as process from 'node:process';

const BASE_URL = process.env.TEMPEMAIL_BASE_URL || 'http://127.0.0.1:8787';
const API_KEY = process.env.TEMPEMAIL_API_KEY || '';

if (!API_KEY) {
  // Still allow read-only in dev without a key against local worker? No —
  // MCP must authenticate by design. Exit with clear message instead.
  process.stderr.write(
    'TempeMail MCP: TEMPEMAIL_API_KEY is required (create one via POST /api/keys).\n'
  );
  process.exit(1);
}

// ---------- JSON-RPC plumbing ----------
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buf += chunk;
  let idx: number;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) handleMessage(line).catch((e) => console.error(String(e)));
  }
});

async function handleMessage(line: string) {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return; // ignore garbage
  }

  if (msg.method === 'initialize') {
    return respond(msg.id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'tempe-mail', version: '1.0.0' },
    });
  }

  if (msg.method === 'tools/list') {
    return respond(msg.id, {
      tools: [
        {
          name: 'list_inboxes',
          description: 'List all disposable inboxes owned by this API key.',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'list_messages',
          description: 'List messages in an inbox. Optionally filter by semantic tag.',
          inputSchema: {
            type: 'object',
            properties: {
              address: { type: 'string', description: 'Full email address, e.g. foo@mail.example.com' },
              tag: {
                type: 'string',
                enum: ['verification', 'security', 'testing', 'marketing', 'general'],
                description: 'Optional semantic tag filter',
              },
              limit: { type: 'number', description: 'Max messages (default 20)' },
            },
            required: ['address'],
          },
        },
        {
          name: 'get_message',
          description: 'Fetch full message content by message ID.',
          inputSchema: {
            type: 'object',
            properties: {
              address: { type: 'string', description: 'Inbox address containing the message' },
              messageId: { type: 'string', description: 'Message UUID' },
            },
            required: ['address', 'messageId'],
          },
        },
      ],
    });
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args } = msg.params || {};
    try {
      switch (name) {
        case 'list_inboxes':
          return respond(msg.id, await toolListInboxes());
        case 'list_messages':
          return respond(msg.id, await toolListMessages(args));
        case 'get_message':
          return respond(msg.id, await toolGetMessage(args));
        default:
          return respond(msg.id, { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true });
      }
    } catch (e: any) {
      return respond(msg.id, {
        content: [{ type: 'text', text: `Error: ${e?.message || String(e)}` }],
        isError: true,
      });
    }
  }

  // notifications / unknown — ack silently
  if (msg.id !== undefined && msg.id !== null) {
    return respond(msg.id, {});
  }
}

function respond(id: any, result: any) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}

// ---------- Tools ----------
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function toolListInboxes(): Promise<{ content: { type: string; text: string }[] }> {
  const inboxes: any[] = await api('/inboxes');
  const text = inboxes.length
    ? inboxes.map((i: any) => `${i.address} (expires ${i.expires_at})`).join('\n')
    : 'No inboxes. Create one with: curl -X POST /api/inboxes -H "Authorization: Bearer <key>" -d \'{}\'';
  return { content: [{ type: 'text', text }] };
}

async function toolListMessages(args: any): Promise<{ content: { type: string; text: string }[] }> {
  const address = args?.address;
  if (!address) throw new Error('address is required');
  const limit = Math.min(50, Math.max(1, parseInt(args?.limit, 10) || 20));
  const tag = args?.tag;

  const all: any[] = await api(`/inboxes/${encodeURIComponent(address)}/messages`);
  const filtered = tag ? all.filter((m: any) => m.tag === tag) : all;
  const slice = filtered.slice(0, limit);

  const text = slice.length
    ? slice
        .map(
          (m: any) =>
            `${m.received_at} | [${m.tag}] ${m.subject} — from ${m.from_address}`
        )
        .join('\n')
    : `No messages in ${address}${tag ? ` tagged ${tag}` : ''}.`;
  return { content: [{ type: 'text', text }] };
}

async function toolGetMessage(args: any): Promise<{ content: { type: string; text: string }[] }> {
  const { address, messageId } = args || {};
  if (!address || !messageId) throw new Error('address and messageId are required');

  const all: any[] = await api(`/inboxes/${encodeURIComponent(address)}/messages`);
  const msg = all.find((m: any) => m.id === messageId);
  if (!msg) throw new Error(`Message ${messageId} not found`);

  const text = [
    `Subject: ${msg.subject}`,
    `From: ${msg.from_name || ''} <${msg.from_address}>`,
    `Received: ${msg.received_at}`,
    `SPF: ${msg.spf} | DKIM: ${msg.dkim} | DMARC: ${msg.dmarc}`,
    `Attachments: ${msg.attachments?.length || 0}`,
    '',
    msg.body || '(no text body)',
  ].join('\n');

  return { content: [{ type: 'text', text }] };
}

// Keep process alive for stdio
process.stdin.resume();
