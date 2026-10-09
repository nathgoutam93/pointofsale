import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Tests start the real Nest app against a separate database (checkout_test, reset before each
// run). Nest's dependency injection needs decorator metadata, which esbuild doesn't emit, so
// tests are compiled with SWC.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    // Node finds the generated client by this name; Vite's resolver doesn't.
    alias: { '.prisma/checkout-client': new URL('./node_modules/.prisma/checkout-client/index.js', import.meta.url).pathname }
  },
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    env: {
      DATABASE_URL: process.env.CHECKOUT_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/checkout_test?schema=public',
      CHECKOUT_PUBLIC_URL: 'https://api.example.com/v1/checkout',
      CHECKOUT_PROVIDER: 'dummy',
      CHECKOUT_PRODUCTS: 'pos',
      CHECKOUT_POS_API_KEY: 'pos-api-key-for-tests-0123456789abcdef',
      CHECKOUT_POS_NOTIFY_SECRET: 'pos-notify-secret-for-tests-0123456789',
      // Each test file points this at its own little server that records notices.
      CHECKOUT_POS_NOTIFY_URL: 'http://127.0.0.1:9/unused',
      // Tests deliver notices themselves (NotificationsService.deliverDue), not on a timer.
      CHECKOUT_NOTIFY_INTERVAL_SECONDS: '0'
    },
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000
  }
});
