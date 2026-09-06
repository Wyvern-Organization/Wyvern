import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['test/realtime-do.test.ts'],
    exclude: ['node_modules/**'],
    poolOptions: {
      workers: {
        isolatedStorage: false,
        singleWorker: true,
        wrangler: { configPath: './wrangler.realtime-test.jsonc' }
      }
    }
  }
});
