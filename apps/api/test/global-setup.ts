import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';

/**
 * A clean test database before the run: dropped, recreated, with the hosted server's control
 * schema. Test files create their business on first use (see helpers.ts).
 */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public');
  const database = url.pathname.slice(1);
  if (!/pos_test|_test\b|test_/.test(database)) {
    throw new Error(`Refusing to reset ${database}: the test database name must contain "test".`);
  }
  const server = new URL(url);
  server.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: server.toString() });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.$disconnect();
  }

  const control = new URL(url);
  control.searchParams.set('schema', 'control');
  const cwd = new URL('..', import.meta.url).pathname;
  execSync('npx prisma generate --schema prisma/control/schema.prisma', { cwd, stdio: 'pipe' });
  execSync('npx prisma migrate deploy --schema prisma/control/schema.prisma', {
    cwd,
    env: { ...process.env, CONTROL_DATABASE_URL: control.toString() },
    stdio: 'pipe'
  });
}
