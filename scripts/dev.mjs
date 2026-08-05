#!/usr/bin/env node
/**
 * Dev helper — applies the D1 schema to the local dev database,
 * then starts `wrangler dev`.
 *
 * Usage: npm run dev
 */
import { spawnSync, spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

console.log('📦 Applying schema to local D1...');
const result = spawnSync(
  'npx',
  ['wrangler', 'd1', 'execute', 'tempe-mail-db', '--local', '--file=src/db/schema.sql'],
  { cwd: ROOT, stdio: 'inherit' }
);

if (result.status !== 0) {
  console.error('❌ Schema apply failed. Starting dev anyway (tables may be missing).');
}

console.log('🚀 Starting wrangler dev...');
const dev = spawn('npx', ['wrangler', 'dev', '--local', '--port', '8787'], {
  cwd: ROOT,
  stdio: 'inherit',
});

dev.on('exit', (code) => process.exit(code ?? 0));
