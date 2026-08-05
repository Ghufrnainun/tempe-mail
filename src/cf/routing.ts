/**
 * Cloudflare Email Routing provisioning.
 *
 * Provides functions to set up catch-all routing rules so that
 * every *@domain address is delivered to this worker.
 */

export interface RoutingEnv {
  CF_API_TOKEN?: string;
  WORKER_NAME?: string;
}

/**
 * Enable Email Routing on a zone and set the catch-all rule to this worker.
 * Uses the Cloudflare API v4 Email Routing endpoints.
 */
export async function ensureEmailRouting(
  zoneId: string,
  zoneName: string,
  env: RoutingEnv
): Promise<{ enabled: boolean; catchAllWorker: string; error?: string }> {
  const token = env.CF_API_TOKEN;
  const workerName = env.WORKER_NAME || 'tempe-mail';

  if (!token) return { enabled: false, catchAllWorker: '', error: 'CF_API_TOKEN not set' };

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  // 1. Enable Email Routing on zone (no-op if already enabled)
  try {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/enable`, {
      method: 'POST',
      headers,
    });
  } catch {
    // Ignore — may already be enabled
  }

  // 2. Set catch-all rule → worker
  const body = JSON.stringify({
    enabled: true,
    matchers: [{ type: 'all' }],
    actions: [{ type: 'worker', value: [workerName] }],
  });

  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/routing/rules/catch_all`,
    { method: 'PUT', headers, body }
  );

  const result: any = await resp.json();

  if (!result.success) {
    const errors = (result.errors || []).map((e: any) => e.message).join('; ');
    return { enabled: false, catchAllWorker: workerName, error: errors || 'API error' };
  }

  return {
    enabled: result.result?.enabled ?? true,
    catchAllWorker: workerName,
  };
}
