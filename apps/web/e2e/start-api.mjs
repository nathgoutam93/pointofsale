// Starts the API for the smoke test on a database of its own, emptied first:
// E2E_DATABASE_URL (default pos_e2e on the local PostgreSQL). Needs `pnpm --filter @pos/api build`.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = join(dirname(fileURLToPath(import.meta.url)), '../../api');
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_e2e?schema=public';
if (!new URL(databaseUrl).pathname.includes('e2e')) {
  throw new Error('E2E_DATABASE_URL must name a database for these tests (with "e2e" in its name): it is emptied');
}
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  POS_MODE: 'offline',
  PORT: process.env.E2E_API_PORT ?? '3101',
  CORS_ORIGINS: `http://localhost:${process.env.E2E_WEB_PORT ?? '3100'}`,
  AUTH_SECRET: process.env.AUTH_SECRET ?? 'e2e-only-secret-not-for-real-use-0123456789',
  UPLOADS_DIR: mkdtempSync(join(tmpdir(), 'pos-e2e-uploads-'))
};

const reset = spawnSync('npx', ['prisma', 'migrate', 'reset', '--force', '--skip-seed', '--skip-generate'], { cwd: api, env, stdio: 'inherit' });
if (reset.status !== 0) process.exit(reset.status ?? 1);

const server = spawn(process.execPath, ['dist/main.js'], { cwd: api, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', (code) => process.exit(code ?? 0));
