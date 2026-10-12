import { join } from 'path';

/**
 * The connection URL of a database server: "default" is DATABASE_URL, any other name is
 * DATABASE_URL_<NAME>. A business records its server, so businesses can move to another
 * server later.
 */
export function serverUrl(server = 'default') {
  const key = server === 'default' ? 'DATABASE_URL' : `DATABASE_URL_${server.toUpperCase()}`;
  const url = process.env[key];
  if (!url) throw new Error(`${key} is not set`);
  return url;
}

/** A server's URL pointed at one schema, with a small connection pool per business. */
export function schemaUrl(schema: string, server = 'default', connectionLimit?: number) {
  const url = new URL(serverUrl(server));
  url.searchParams.set('schema', schema);
  if (connectionLimit) url.searchParams.set('connection_limit', String(connectionLimit));
  return url.toString();
}

/** The control schema: businesses, owner accounts and memberships. */
export function controlDatabaseUrl() {
  return process.env.CONTROL_DATABASE_URL || schemaUrl('control');
}

/** apps/pos/api, where prisma/ holds the schemas and migrations. */
export function apiRoot() {
  return process.env.API_ROOT || join(__dirname, '..', '..');
}
