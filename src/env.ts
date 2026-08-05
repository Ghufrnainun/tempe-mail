/**
 * Environment bindings for the tempe-mail Cloudflare Worker.
 */
export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  REALTIME: DurableObjectNamespace;
  CF_API_TOKEN?: string;
  WORKER_NAME?: string;
  ADMIN_KEY?: string;
  APP_NAME?: string;
  MAIL_DOMAIN?: string;
  WEB_HOST?: string;
  CF_ZONE_MAP?: string;
}
