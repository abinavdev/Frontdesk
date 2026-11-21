import { createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

export function hashPassword(value) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(value, salt, 64).toString('hex')}`;
}
export function verifyPassword(value, encoded) {
  const [salt, expected] = (encoded || '').split(':');
  if (!salt || !expected) return false;
  const current = scryptSync(value, salt, 64);
  const existing = Buffer.from(expected, 'hex');
  return current.length === existing.length && timingSafeEqual(current, existing);
}
export function hashToken(value) { return createHash('sha256').update(value).digest('hex'); }
export function customerToken() { return randomBytes(32).toString('base64url'); }
export function signAgentSession(agent, secret) {
  const payload = Buffer.from(JSON.stringify({ id: agent.id, email: agent.email, exp: Date.now() + 12 * 3600000 })).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}
export function verifyAgentSession(token, secret) {
  const [payload, signature] = (token || '').split('.');
  if (!payload || !signature) return null;
  const actual = createHmac('sha256', secret).update(payload).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== actual.length || !timingSafeEqual(provided, actual)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (decoded.exp <= Date.now() || !Number.isInteger(Number(decoded.id))) return null;
    return decoded;
  } catch { return null; }
}
