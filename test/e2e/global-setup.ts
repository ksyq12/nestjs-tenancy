import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';

export default async function globalSetup() {
  const client = new Client({ connectionString: ADMIN_URL });
  await client.connect();

  try {
    const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf-8');
    await client.query(setupSql);
  } finally {
    await client.end();
  }
}
