import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Unit tests for the web app's logic (the POS cart and payment); hooks run in jsdom.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}']
  }
});
