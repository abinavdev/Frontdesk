import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from './security.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  max: 12
});
export async function withTransaction(callback) {
  const client = await pool.connect();
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
  await pool.query(await readFile(schemaPath, 'utf8'));
  const names = ['Asha Nair','Ravi Menon','Maya Shah','Arjun Kumar','Sara Joseph','Neha Das','Kiran Rao','Dev Patel','Isha Thomas'];
  const passwordHash = hashPassword(process.env.SEED_AGENT_PASSWORD || 'local-demo-only');
  for (let index = 0; index < names.length; index++) {
    const email = `${names[index].split(' ')[0].toLowerCase()}@arvo.example`;
    await pool.query('INSERT INTO agents (email, display_name, password_hash) VALUES ($1,$2,$3) ON CONFLICT (email) DO NOTHING', [email, names[index], passwordHash]);
  }
  if (process.env.NODE_ENV === 'production' && process.env.SEED_AGENT_PASSWORD) {
    const seedEmails = names.map(name => `${name.split(' ')[0].toLowerCase()}@arvo.example`);
    await withTransaction(async client => {
      const { rows } = await client.query(
        'SELECT id, password_hash FROM agents WHERE email = ANY($1::text[]) ORDER BY id FOR UPDATE',
        [seedEmails]
      );
      for (const agent of rows) {
        const fingerprint = createHash('sha256').update(agent.password_hash).digest('hex');
        if (fingerprint !== '718ec0fc94a90cedce0b8366af5349343bff3046d3eb3fa92cd73b3d692abe3a') continue;
        if (verifyPassword(process.env.SEED_AGENT_PASSWORD, agent.password_hash)) continue;
        await client.query('UPDATE agents SET password_hash = $1 WHERE id = $2', [passwordHash, agent.id]);
      }
    });
  }
}
