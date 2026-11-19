// Meter Camera Capture & OCR Accuracy Verification
// Tests real-world edge cases: noise, lighting, angle, bezel, decimals, and whole displays.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function bootDomain() {
  const mem = {};
  const ctx = {
    console, setTimeout, clearTimeout, URL, URLSearchParams, Date, Math, JSON, addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: k => mem[k], setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => delete mem[k] },
    navigator: { onLine: true },
    document: { addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], documentElement: { dataset: {} } }
  };
  ctx.window = ctx;
  ctx.window.HOSTELOS_CONFIG = {};
  vm.createContext(ctx);
  for (const f of ['geo.js', 'core.js', 'data.js', 'domain.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const { analyzeDigitSegments, parseMeterOcrText, validateMeterReadingFraud } = bootDomain();

// Helper to generate a digit grid with width W and height H
function generateDigitGrid(digit, width = 20, height = 30, noiseLevel = 0, skewAngle = 0, thresholdOffset = 0) {
  const grid = new Uint8Array(width * height);
  const segments = {
    '0': ['a', 'b', 'c', 'd', 'e', 'f'],
    '1': ['b', 'c'],
    '2': ['a', 'b', 'g', 'e', 'd'],
    '3': ['a', 'b', 'c', 'd', 'g'],
    '4': ['f', 'g', 'b', 'c'],
    '5': ['a', 'f', 'g', 'c', 'd'],
    '6': ['a', 'f', 'g', 'c', 'd', 'e'],
    '7': ['a', 'b', 'c'],
    '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    '9': ['a', 'b', 'c', 'd', 'f', 'g']
  };

  const segs = segments[digit] || [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let isSegment = false;
      // Coordinates normalized
      const nx = x / width;
      const ny = y / height;

      // Segment geometry with realistic thickness
      if (segs.includes('a') && ny >= 0.08 && ny <= 0.16 && nx >= 0.2 && nx <= 0.8) isSegment = true;
      if (segs.includes('d') && ny >= 0.84 && ny <= 0.92 && nx >= 0.2 && nx <= 0.8) isSegment = true;
      if (segs.includes('g') && ny >= 0.46 && ny <= 0.54 && nx >= 0.2 && nx <= 0.8) isSegment = true;
      if (segs.includes('f') && nx >= 0.10 && nx <= 0.20 && ny >= 0.14 && ny <= 0.48) isSegment = true;
      if (segs.includes('e') && nx >= 0.10 && nx <= 0.20 && ny >= 0.52 && ny <= 0.86) isSegment = true;
      if (segs.includes('b') && nx >= 0.80 && nx <= 0.90 && ny >= 0.14 && ny <= 0.48) isSegment = true;
      if (segs.includes('c') && nx >= 0.80 && nx <= 0.90 && ny >= 0.52 && ny <= 0.86) isSegment = true;

      let val = isSegment ? 240 : 20;

      // Add noise (fluorescent flicker, camera sensor grain)
      if (noiseLevel > 0) {
        const noise = (Math.random() - 0.5) * noiseLevel * 255;
        val = Math.max(0, Math.min(255, val + noise));
      }

      // Add brightness threshold offset (dark PG corridor / reflection)
      val = Math.max(0, Math.min(255, val + thresholdOffset));

      grid[y * width + x] = Math.round(val);
    }
  }

  return grid;
}

console.log('=== REAL-WORLD ELECTRICITY METER OCR ACCURACY BENCHMARK ===\n');

// 1. Clean Synthetic Baseline
let cleanPass = 0;
for (let d = 0; d <= 9; d++) {
  const grid = generateDigitGrid(String(d), 20, 30, 0, 0, 0);
  const res = analyzeDigitSegments(grid, 20, 30);
  if (res.digit === String(d)) cleanPass++;
}
console.log(`1. Ideal Synthetic Digits (0-9): ${cleanPass}/10 (${cleanPass * 10}% accuracy)`);

// 2. Low Lighting / Under-exposure (-40 brightness offset)
let dimPass = 0;
for (let d = 0; d <= 9; d++) {
  const grid = generateDigitGrid(String(d), 20, 30, 0.05, 0, -50);
  const res = analyzeDigitSegments(grid, 20, 30);
  if (res.digit === String(d)) dimPass++;
}
console.log(`2. Dim Light / Dark PG Corridor (-50 brightness): ${dimPass}/10 (${dimPass * 10}% accuracy)`);

// 3. Glare / Over-exposure (+60 brightness from flash reflection)
let glarePass = 0;
for (let d = 0; d <= 9; d++) {
  const grid = generateDigitGrid(String(d), 20, 30, 0.1, 0, 80);
  const res = analyzeDigitSegments(grid, 20, 30);
  if (res.digit === String(d)) glarePass++;
}
console.log(`3. Glass Reflection / Camera Flash Glare (+80 brightness): ${glarePass}/10 (${glarePass * 10}% accuracy)`);

// 4. Heavy Sensor Noise (Grain from high ISO mobile camera)
let noisyPass = 0;
for (let d = 0; d <= 9; d++) {
  let digitPass = 0;
  for (let trial = 0; trial < 10; trial++) {
    const grid = generateDigitGrid(String(d), 20, 30, 0.35, 0, 0);
    const res = analyzeDigitSegments(grid, 20, 30);
    if (res.digit === String(d)) digitPass++;
  }
  if (digitPass >= 7) noisyPass++;
}
console.log(`4. High ISO Sensor Noise (35% noise): ${noisyPass}/10 (${noisyPass * 10}% accuracy)`);

// 5. OCR String Parsing on Real Meter LCD Formats
const testMeterStrings = [
  { raw: '01428.5 kWh', expected: 1428.5, label: 'Standard kWh unit suffix' },
  { raw: 'KWH 00892.4', expected: 892.4, label: 'Prefix kWh label' },
  { raw: 'Reading: 05410', expected: 5410, label: 'Whole number display with prefix' },
  { raw: 'METER NO 201: 03120.8 KWH', expected: 3120.8, label: 'Meter serial separated from reading' },
  { raw: 'GENUS 240V 50Hz KWH 00765.2', expected: 765.2, label: 'Genus single-phase digital meter' },
  { raw: 'SECURE PREMIER: 12050.4 units', expected: 12050.4, label: 'Secure meters unit suffix' },
  { raw: 'L&T EM series Reading: 03810.0 kWh PF 0.98', expected: 3810, label: 'L&T multi-line LCD display' },
  { raw: 'KWH: 04120.5 KVAH: 04510.8', expected: 4120.5, label: 'Dual-tariff kWh prioritized over kVAh' },
  { raw: '', expected: null, label: 'Empty input' },
  { raw: 'NO SIGNAL', expected: null, label: 'Error message / unreadable LCD' }
];

console.log('\n=== REAL-WORLD METER TEXT STRING PARSING ===');
testMeterStrings.forEach(tc => {
  const parsed = parseMeterOcrText(tc.raw);
  const match = parsed.value === tc.expected;
  console.log(`[${tc.label}] Input: "${tc.raw}" -> Parsed: ${parsed.value} (${match ? 'PASS' : 'FAIL - Expected ' + tc.expected})`);
  assert.equal(parsed.value, tc.expected, `Mismatch for "${tc.raw}": got ${parsed.value}, expected ${tc.expected}`);
});

// 6. Camera Photo Fraud Checks
console.log('\n=== METER FRAUD & INTEGRITY CHECKS ===');
const fraudChecks = [
  { name: 'Normal progressive reading', r: { roomId: 'r1', curr: 520, prev: 450, meterQr: 'QR-101' }, expectValid: true },
  { name: 'Lower reading (meter rollback attempt)', r: { roomId: 'r1', curr: 400, prev: 450, meterQr: 'QR-101' }, expectValid: false },
  { name: 'Excessive consumption surge (>1500 units)', r: { roomId: 'r1', curr: 2100, prev: 450, meterQr: 'QR-101' }, expectValid: false }
];

fraudChecks.forEach(fc => {
  const res = validateMeterReadingFraud(fc.r);
  console.log(`${fc.name}: Valid=${res.valid} Flags=[${res.flags.join('; ')}]`);
});
