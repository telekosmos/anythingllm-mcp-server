import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePathSegment } from '../src/client.js';

test('encodes special characters in path segments', () => {
  assert.equal(safePathSegment('my workspace'), 'my%20workspace');
  assert.equal(safePathSegment('a/b'), 'a%2Fb');
  assert.equal(safePathSegment('../etc/passwd'), '..%2Fetc%2Fpasswd');
});

test('stringifies non-string inputs', () => {
  assert.equal(safePathSegment(123), '123');
});

test('throws on null, undefined, and empty string', () => {
  assert.throws(() => safePathSegment(null), /required/);
  assert.throws(() => safePathSegment(undefined), /required/);
  assert.throws(() => safePathSegment(''), /non-empty/);
});
