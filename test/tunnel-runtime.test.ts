import test from 'node:test';
import assert from 'node:assert/strict';
import { protectSecret, unprotectSecret } from '../src/tunnel-runtime.js';

await test('Windows DPAPI protects and restores the Runtime API key without plaintext persistence', {
  skip: process.platform !== 'win32'
}, () => {
  const secret = 'sk-runtime-test-0123456789';
  const protectedValue = protectSecret(secret);
  assert.ok(protectedValue.length > 20);
  assert.equal(protectedValue.includes(secret), false);
  assert.equal(unprotectSecret(protectedValue), secret);
});
