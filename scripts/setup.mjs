#!/usr/bin/env node
/**
 * TempeMail zero-config setup script.
 *
 * Reads .env, provisions Cloudflare resources (D1, Email Routing),
 * and renders a ready-to-deploy wrangler.toml.
 *
 * Usage: npm run setup
 *
 * Required .env keys:
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 *   DOMAINS (comma-separated)
 *   WEB_HOST
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- env loader ----

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  let content;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    console.error('❌ .env file not found. Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }

  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }

  // Validate required
  const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'DOMAINS', 'WEB_HOST'];
  for (const key of required) {
    if (!env[key] || env[key].startsWith('YOUR_')) {
      console.error(`❌ ${key} is required in .env`);
      process.exit(1);
    }
  }

  return {
    token: env.CLOUDFLARE_API_TOKEN,
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    domains: env.DOMAINS.split(',').map((d) => d.trim()).filter(Boolean),
    webHost: env.WEB_HOST,
    appName: env.APP_NAME || 'TempeMail',
    adminKey: env.ADMIN_KEY || 'change-me',
  };
}

// ---- CF API helpers ----

function apiHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function fetchJson(url, opts = {}) {
  const resp = await fetch(url, opts);
  const body = await resp.json();
  if (!body.success && opts.method !== 'GET') {
    const msgs = (body.errors || []).map((e) => e.message).join('; ');
    throw new Error(`CF API error: ${msgs || JSON.stringify(body)}`);
  }
  return body;
}

// ---- D1 ----

async function ensureD1(accountId, token) {
  console.log('📦 Setting up D1 database...');

  // Check if database already exists
  const list = await fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database?name=tempe-mail-db`,
    { headers: apiHeaders(token) }
  );

  if (list.result && list.result.length > 0) {
    console.log(`   Using existing D1 database: ${list.result[0].uuid}`);
    return { databaseId: list.result[0].uuid, created: false };
  }

  // Create new database
  const created = await fetchJson(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database`,
    {
      method: 'POST',
      headers: apiHeaders(token),
      body: JSON.stringify({ name: 'tempe-mail-db' }),
    }
  );

  console.log(`   Created D1 database: ${created.result.uuid}`);
  return { databaseId: created.result.uuid, created: true };
}

async function applySchema(databaseId, accountId, token) {
  console.log('📋 Applying schema...');

  const schemaPath = resolve(ROOT, 'src/db/schema.sql');
  const schema = readFileSync(schemaPath, 'utf-8');

  // Strip comment lines first (a split chunk starting with '--' would
  // otherwise be filtered out along with its CREATE TABLE statement),
  // then split into individual statements for the D1 query API.
  const statements = schema
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      await fetchJson(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
        {
          method: 'POST',
          headers: apiHeaders(token),
          body: JSON.stringify({ sql: stmt + ';' }),
        }
      );
    } catch (err) {
      // Ignore "already exists" errors
      if (!err.message.includes('already exists')) throw err;
    }
  }
  console.log('   Schema applied.');
}

// ---- Email Routing ----

async function resolveZoneIds(accountId, token, domains) {
  console.log('🌐 Discovering zone IDs...');

  // Get all zones in account
  const zonesResp = await fetchJson(
    `https://api.cloudflare.com/client/v4/zones?per_page=500`,
    { headers: apiHeaders(token) }
  );

  const zoneMap = {};
  for (const domain of domains) {
    let found = false;
    // Try exact match first
    for (const z of zonesResp.result || []) {
      if (z.name === domain) {
        zoneMap[domain] = z.id;
        found = true;
        break;
      }
    }
    if (!found) {
      // Try apex match (for subdomains like mail.example.com → zone example.com)
      const parts = domain.split('.');
      for (let i = 1; i < parts.length - 1; i++) {
        const candidate = parts.slice(i).join('.');
        for (const z of zonesResp.result || []) {
          if (z.name === candidate) {
            zoneMap[domain] = z.id;
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
    if (found) {
      console.log(`   ${domain} → zone ${zoneMap[domain]}`);
    } else {
      console.warn(`   ⚠️  ${domain}: zone not found — skipping Email Routing for this domain`);
    }
  }

  return zoneMap;
}

async function enableRouting(zoneId, token) {
  try {
    await fetchJson(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/enable`,
      { method: 'POST', headers: apiHeaders(token) }
    );
  } catch {
    // Already enabled is OK
  }
}

/**
 * Ensure the domain has a DMARC record (p=none).
 *
 * Why: many verification-sender systems (AWS SES, SendGrid, banking/OTP
 * senders) silently DROP mail to domains without a DMARC record. Without it,
 * email works "sometimes" — personal Gmail gets through, automated
 * verification emails never arrive. p=none is the safe default (report-only,
 * does not reject anything).
 */
async function ensureDMARC(zoneId, zoneName, token) {
  try {
    // Check existing
    const existing = await fetchJson(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?type=TXT&name=_dmarc.${zoneName}`,
      { headers: apiHeaders(token) }
    );
    if (existing?.result?.length > 0) {
      console.log(`   ${zoneName}: DMARC already present`);
      return;
    }

    // Create DMARC p=none record
    await fetchJson(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`,
      {
        method: 'POST',
        headers: apiHeaders(token),
        body: JSON.stringify({
          type: 'TXT',
          name: '_dmarc',
          content: `v=DMARC1; p=none; rua=mailto:dmarc@${zoneName}`,
          ttl: 300,
        }),
      }
    );
    console.log(`   ${zoneName}: DMARC p=none created (safe default, no rejection)`);
  } catch (err) {
    console.warn(
      `   ⚠️  ${zoneName}: could not create DMARC (${err.message}) — add it manually if automated senders drop your emails`
    );
  }
}

async function setCatchAll(zoneId, zoneName, token) {
  try {
    await fetchJson(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/rules/catch_all`,
      {
        method: 'PUT',
        headers: apiHeaders(token),
        body: JSON.stringify({
          enabled: true,
          matchers: [{ type: 'all' }],
          actions: [{ type: 'worker', value: ['tempe-mail'] }],
        }),
      }
    );
    console.log(`   ${zoneName}: catch-all → worker:tempe-mail (enabled)`);
  } catch (err) {
    console.warn(
      `   ⚠️  ${zoneName}: catch-all not set (${err.message}).`
    );
    console.warn(
      `      Deploy the worker first, then re-run setup, or set it manually in the dashboard:`
    );
    console.warn(
      `      Email → Email Routing → Catch-all → Send to Worker → tempe-mail`
    );
  }
}

async function provisionRouting(zoneMap, token) {
  console.log('📧 Provisioning Email Routing...');
  for (const [domain, zoneId] of Object.entries(zoneMap)) {
    await enableRouting(zoneId, token);
    await ensureDMARC(zoneId, domain, token);
    await setCatchAll(zoneId, domain, token);
  }
}

// ---- wrangler.toml render ----

function renderWrangler(env, zoneMap, databaseId) {
  console.log('📝 Rendering wrangler.toml...');

  const template = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf-8');

  const zoneMapStr = Object.entries(zoneMap)
    .map(([d, z]) => `${d}=${z}`)
    .join(',');

  const rendered = template
    .replace(/__D1_DATABASE_ID__/g, databaseId)
    .replace(/__MAIL_DOMAIN__/g, env.domains.join(','))
    .replace(/__WEB_HOST__/g, env.webHost)
    .replace(/__CF_ZONE_MAP__/g, zoneMapStr);

  writeFileSync(resolve(ROOT, 'wrangler.toml'), rendered);
  console.log('   wrangler.toml rendered.');
}

// ---- main ----

async function main() {
  console.log('\n🔧 TempeMail Setup');
  console.log('═══════════════════\n');

  const env = loadEnv();
  console.log(`   Account: ${env.accountId}`);
  console.log(`   Domains: ${env.domains.join(', ')}`);
  console.log(`   Web UI:  ${env.webHost}\n`);

  const { databaseId, created } = await ensureD1(env.accountId, env.token);
  await applySchema(databaseId, env.accountId, env.token);

  const zoneMap = await resolveZoneIds(env.accountId, env.token, env.domains);

  // Render wrangler.toml BEFORE provisioning routing: Email Routing needs the
  // worker to already exist in production ("Workers Script Info not found"
  // otherwise). Rendering first lets the user deploy, then re-run setup to
  // provision routing against the live worker.
  renderWrangler(env, zoneMap, databaseId);

  if (Object.keys(zoneMap).length > 0) {
    await provisionRouting(zoneMap, env.token);
  } else {
    console.warn('   ⚠️  No zone IDs found — Email Routing must be configured manually.');
  }

  console.log('\n✅ Setup complete!');
  console.log('\nNext steps:');
  console.log('   1. Review wrangler.toml');
  console.log('   2. Run: npx wrangler deploy');
  console.log('   3. Open: https://' + env.webHost);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌ Setup failed:', err.message);
  process.exit(1);
});
