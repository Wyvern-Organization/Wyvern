import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/realtime-do.test.ts'],
    exclude: ['node_modules/**'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.realtime-test.jsonc' }
      }
    }
  }
});
