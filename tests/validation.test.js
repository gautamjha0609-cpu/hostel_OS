// Validation & data integrity test suite
const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPhone, cleanAadhaar, isValidPersonName, isValidEmail } = require('../api/_lib.js');

test('cleanPhone: accepts valid Indian mobile numbers', () => {
  assert.equal(cleanPhone('9876543210'), '9876543210');
  assert.equal(cleanPhone('+91 98765 43210'), '9876543210');
  assert.equal(cleanPhone('+919876543210'), '9876543210');
  assert.equal(cleanPhone('09876543210'), '9876543210');
  assert.equal(cleanPhone('5123456789'), '5123456789'); // Demo series
  assert.equal(cleanPhone('6123456789'), '6123456789'); // Jio series
  assert.equal(cleanPhone('7123456789'), '7123456789'); // Airtel series
  assert.equal(cleanPhone('8123456789'), '8123456789'); // Vi series
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
  assert.equal(cleanPhone('0000000000'), null); // starts with 0
  assert.equal(cleanPhone('1234567890'), null); // starts with 1 (not valid mobile)
  assert.equal(cleanPhone('2345678901'), null); // starts with 2 (not valid mobile)
  assert.equal(cleanPhone('3456789012'), null); // starts with 3 (not valid mobile)
  assert.equal(cleanPhone('4567890123'), null); // starts with 4 (not valid mobile)
});

test('cleanAadhaar: accepts exactly 12 numeric digits', () => {
  assert.equal(cleanAadhaar('123456789012'), '123456789012');
  assert.equal(cleanAadhaar(' 1234 5678 9012 '), '123456789012');
  assert.equal(cleanAadhaar('999988887777'), '999988887777');
});

test('cleanAadhaar: rejects invalid Aadhaar inputs', () => {
  assert.equal(cleanAadhaar(''), null);
  assert.equal(cleanAadhaar(null), null);
  assert.equal(cleanAadhaar('12345678901'), null); // 11 digits
  assert.equal(cleanAadhaar('1234567890123'), null); // 13 digits
  assert.equal(cleanAadhaar('123456789012345'), null); // 15 digits
  assert.equal(cleanAadhaar('12345678abcd'), null); // letters
  assert.equal(cleanAadhaar('abcd56789012'), null); // letters
  assert.equal(cleanAadhaar('1234-5678-9012-99'), null); // too long
});

test('isValidPersonName: accepts valid person names', () => {
  assert.equal(isValidPersonName('Rahul Sharma'), true);
  assert.equal(isValidPersonName('Dr. B. R. Ambedkar'), true);
  assert.equal(isValidPersonName('Mary-Jane Watson'), true);
  assert.equal(isValidPersonName("O'Connor"), true);
  assert.equal(isValidPersonName('अमित कुमार'), true); // Hindi unicode
});

test('isValidPersonName: rejects invalid names with numbers or symbols', () => {
  assert.equal(isValidPersonName(''), false);
  assert.equal(isValidPersonName('A'), false); // too short
  assert.equal(isValidPersonName('Rahul123'), false); // contains numbers
  assert.equal(isValidPersonName('123456'), false);
  assert.equal(isValidPersonName('John@Doe'), false); // contains symbols
  assert.equal(isValidPersonName('Test!#$'), false);
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
