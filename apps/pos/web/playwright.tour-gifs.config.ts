import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Records the screen tours' GIFs (e2e/tour-gifs) on the same servers as the end-to-end tests.
export default defineConfig({
  ...base,
  testDir: 'e2e/tour-gifs',
  testIgnore: undefined,
  reporter: 'list',
  use: { ...base.use, trace: 'off', actionTimeout: 10_000 }
});
