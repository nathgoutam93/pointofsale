import { tmpdir } from 'os';
import { join } from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// API tests start the real Nest app against a separate database (pos_test, reset before
// each run). Nest's dependency injection needs decorator metadata, which esbuild doesn't
// emit, so tests are compiled with SWC.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    // Node finds the control schema's generated client by this name; Vite's resolver doesn't.
    alias: { '.prisma/control-client': new URL('./node_modules/.prisma/control-client/index.js', import.meta.url).pathname }
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/pos_test?schema=public',
      AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
      // Their own uploads folder, emptied before each run (see global-setup.ts): moving a business
      // online copies uploads, which would otherwise pile up in the development folder.
      UPLOADS_DIR: join(tmpdir(), 'pos-test-uploads')
    },
    // Files share one database and some change business-wide settings, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000
  }
});
