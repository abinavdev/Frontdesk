import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './security.js';

const connection = {
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
};
export const pool = new Pool({ ...connection, max: 12 });
export const demoEmail = 'demo@arvo.example';
export const demoPassword = process.env.PUBLIC_DEMO_PASSWORD;
export const demoPool = demoPassword
  ? new Pool({ ...connection, max: 4, options: '-c search_path=frontdesk_demo' })
  : null;

export async function withTransaction(callback, database = pool) {
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
export async function audit(client, ticketId, agentId, customer, action, details = {}) {
  await client.query(
    'INSERT INTO audit_events (ticket_id, actor_agent_id, actor_customer, action, details) VALUES ($1,$2,$3,$4,$5)',
    [ticketId, agentId, customer, action, JSON.stringify(details)]
  );
}
export async function initializeDatabase() {
  const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
  const schema = await readFile(schemaPath, 'utf8');
  await pool.query(schema);
  const names = ['Asha Nair','Ravi Menon','Maya Shah','Arjun Kumar','Sara Joseph','Neha Das','Kiran Rao','Dev Patel','Isha Thomas'];
  const passwordHash = hashPassword(process.env.SEED_AGENT_PASSWORD || 'local-demo-only');
  for (let index = 0; index < names.length; index++) {
    const email = `${names[index].split(' ')[0].toLowerCase()}@arvo.example`;
    await pool.query('INSERT INTO agents (email, display_name, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING', [email, names[index], passwordHash]);
  }

  if (demoPool) {
    await pool.query('CREATE SCHEMA IF NOT EXISTS frontdesk_demo');
    await withTransaction(async client => {
      await client.query(schema);
      await client.query(
        `INSERT INTO agents (email, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
        [demoEmail, 'Demo Agent', hashPassword(demoPassword)]
      );
    }, demoPool);
  }
}
