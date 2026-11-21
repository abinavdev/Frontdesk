import 'dotenv/config';
const base = process.env.BASE_URL || 'http://localhost:3001';
const password = process.env.SEED_AGENT_PASSWORD || 'local-demo-only';
async function request(path, token, method='GET', body) {
  const r = await fetch(`${base}/api${path}`, { method, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {})
  }, body: body ? JSON.stringify(body) : undefined });
  const result = await r.json();
  if (!r.ok) throw Error(`${method} ${path}: ${result.error || r.status}`);
  return result;
}
const login = await request('/auth/login', null, 'POST', { email: 'asha@arvo.example', password });
const token = login.token;
const scenarios = [
  { subject: 'Unable to sign in to customer portal', description: 'Customer sees an authentication error and cannot access their workspace.', customer_name: 'Priya Mathew', customer_email: 'priya@example.com', priority: 'high' },
  { subject: 'Exported reports are missing columns', description: 'The downloaded CSV is missing the settlement reference column.', customer_name: 'Rajesh Pillai', customer_email: 'rajesh@example.com', priority: 'medium' },
  { subject: 'How to invite new team members?', description: 'Customer wants to know how to manage workspace invitations.', customer_name: 'Nisha Shah', customer_email: 'nisha@example.com', priority: 'low' },
  { subject: 'Billing page shows incorrect subscription', description: 'Subscription tier is incorrect despite confirmation of renewal.', customer_name: 'Akash Varma', customer_email: 'akash@example.com', priority: 'medium' },
  { subject: 'Dashboard loads slowly during business hours', description: 'Several team members experience long dashboard loading times.', customer_name: 'Meera Iyer', customer_email: 'meera@example.com', priority: 'medium' }
];
const existing = (await request('/tickets', token)).tickets;
for (let i=0; i<scenarios.length; i++) {
  const sample = scenarios[i];
  if (existing.some(t => t.subject === sample.subject)) { console.info('Already present:', sample.subject); continue; }
  const created = await request('/tickets', token, 'POST', sample);
  const id = created.ticket.id;
  if (i !== 2) await request(`/tickets/${id}/claim`, token, 'POST');
  if (i === 0) {
    await request(`/tickets/${id}/messages`, token, 'POST', { visibility: 'public', body: 'We are investigating the authentication issue. We will keep you updated.' });
    await request(`/tickets/${id}/messages`, token, 'POST', { visibility: 'internal', body: 'Check the new identity-provider rollout before escalating.' });
  }
  if (i === 1) {
    await request(`/tickets/${id}/messages`, token, 'POST', { visibility: 'public', body: 'Could you share an example export so we can reproduce the issue?' });
    await request(`/tickets/${id}/status`, token, 'POST', { status: 'waiting_customer' });
  }
  if (i === 3) {
    await request(`/tickets/${id}/messages`, token, 'POST', { visibility: 'public', body: 'The subscription display has been corrected.' });
    await request(`/tickets/${id}/status`, token, 'POST', { status: 'resolved' });
  }
  console.info('Created:', created.ticket.code, sample.subject);
}
console.info('Sample tickets ready. One sample includes a private note, one is waiting, and one is resolved.');
