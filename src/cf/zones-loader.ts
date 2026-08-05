/**
 * Load domain → zone ID mapping from environment variable.
 * Format: "domain=zoneid,domain2=zoneid2"
 */
export function loadZones(env: { CF_ZONE_MAP?: string }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (env.CF_ZONE_MAP || '').split(',').filter(Boolean)) {
    const [domain, zoneId] = pair.split('=').map((s) => s.trim());
    if (domain && zoneId) out[domain.toLowerCase()] = zoneId;
  }
  return out;
}

/**
 * Get the list of configured mail domains.
 */
export function getDomains(env: { MAIL_DOMAIN?: string }): string[] {
  return (env.MAIL_DOMAIN || '')
    .split(',')
    .map((d) => d.trim())
    .filter(Boolean);
}
