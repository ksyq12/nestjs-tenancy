import { Client } from 'pg';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';

export default async function globalTeardown() {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();

  try {
    await client.query('DROP TABLE IF EXISTS force_owner_users CASCADE');
    await client.query('DROP TABLE IF EXISTS users CASCADE');
    await client.query('DROP TABLE IF EXISTS countries CASCADE');
  } finally {
    await client.end();
  }
}
