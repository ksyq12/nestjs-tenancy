import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'test/e2e/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
