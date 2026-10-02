import { execSync } from 'child_process';

/** Recreates the test database from the migrations before the run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public';
  if (!/pos_test|_test\b|test_/.test(url)) {
    throw new Error(`Refusing to reset ${url}: the test database name must contain "test".`);
  }
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe'
  });
}
