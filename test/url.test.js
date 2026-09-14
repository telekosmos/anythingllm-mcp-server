import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseUrl } from '../src/index.js';

test('accepts http and https URLs', () => {
  assert.equal(validateBaseUrl('http://localhost:3001'), 'http://localhost:3001');
  assert.equal(
    validateBaseUrl('https://anythingllm.example.com'),
    'https://anythingllm.example.com'
  );
});

test('strips trailing slashes', () => {
  assert.equal(validateBaseUrl('http://localhost:3001/'), 'http://localhost:3001');
  assert.equal(validateBaseUrl('https://host.example.com/api/'), 'https://host.example.com/api');
});

test('rejects non-http(s) protocols', () => {
  assert.throws(() => validateBaseUrl('ftp://example.com'), /http or https/);
  assert.throws(() => validateBaseUrl('file:///etc/passwd'), /http or https/);
});

test('rejects URLs with embedded credentials', () => {
  assert.throws(() => validateBaseUrl('http://user:pass@host'), /must not contain credentials/);
});

test('rejects invalid URLs', () => {
  assert.throws(() => validateBaseUrl('not a url'), /Invalid ANYTHINGLLM_BASE_URL/);
});
