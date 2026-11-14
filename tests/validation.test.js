// Validation & data integrity test suite
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPhone, isValidEmail } = require('../api/_lib.js');

test('cleanPhone: accepts valid Indian mobile numbers', () => {
  assert.equal(cleanPhone('9876543210'), '9876543210');
  assert.equal(cleanPhone('+91 98765 43210'), '9876543210');
  assert.equal(cleanPhone('+919876543210'), '9876543210');
  assert.equal(cleanPhone('09876543210'), '9876543210');
  assert.equal(cleanPhone('5123456789'), '5123456789'); // Demo series
  assert.equal(cleanPhone('  9876543210  '), '9876543210');
});

test('cleanPhone: rejects invalid mobile numbers', () => {
  assert.equal(cleanPhone(''), null);
  assert.equal(cleanPhone(null), null);
  assert.equal(cleanPhone('12345'), null); // too short
  assert.equal(cleanPhone('98765432109999'), null); // too long (14 digits)
  assert.equal(cleanPhone('123456789012345'), null); // 15 digits
  assert.equal(cleanPhone('abc9876543210'), null); // contains letters
  assert.equal(cleanPhone('98765abcd0'), null);
});

test('isValidEmail: verifies standard email addresses', () => {
  assert.equal(isValidEmail('user@example.com'), true);
  assert.equal(isValidEmail('ravi.kumar@hostelos.app'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('user@'), false);
  assert.equal(isValidEmail('@example.com'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
});
