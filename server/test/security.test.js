import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, hashToken, customerToken, signAgentSession, verifyAgentSession } from '../src/security.js';

test('password hashes are salted and can be verified', () => {
  const a = hashPassword('super-strong-example');
  const b = hashPassword('super-strong-example');
  assert.notEqual(a, b);
  assert.equal(verifyPassword('super-strong-example', a), true);
  assert.equal(verifyPassword('wrong', a), false);
});
test('customer bearer token is unguessable and can be matched by a hash', () => {
  const a = customerToken(); const b = customerToken();
  assert.notEqual(a,b);
  assert.ok(a.length > 32);
  assert.equal(hashToken(a), hashToken(a));
  assert.notEqual(hashToken(a), hashToken(b));
});
test('agent session signatures cannot be altered', () => {
  const secret = 'test-secret-used-only-for-unit-tests';
  const signed = signAgentSession({id:1,email:'asha@arvo.example'}, secret);
  assert.equal(verifyAgentSession(signed, secret).email, 'asha@arvo.example');
  assert.equal(verifyAgentSession(`${signed}x`, secret), null);
  assert.equal(verifyAgentSession(signed, 'wrong-secret'), null);
});
