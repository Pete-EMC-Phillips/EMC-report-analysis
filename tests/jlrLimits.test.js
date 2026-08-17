/**
 * jlrLimits.test.js — locks in the hand-verified numbers transcribed from
 * JLR-EMC-CS v1.0 Amendment 4 (Tables 7-1, 7-2, 8-2) so a future edit typo
 * doesn't silently corrupt the standard's limit values. Each expected value
 * below was independently computed from the formulas/flat values in the
 * standard (see js/jlrLimits.js header comment for the source tables).
 */
const assert = require("assert");
const JlrLimits = require("../js/jlrLimits.js");

function approxEqual(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) <= tol, `${msg}: expected ~${b}, got ${a}`);
}

function entryFor(matches, bandId, detector) {
  const band = matches.find((m) => m.id === bandId);
  assert.ok(band, `expected band ${bandId} to match`);
  const entry = band.entries.find((e) => e.detector === detector);
  assert.ok(entry, `expected ${bandId} to have a ${detector} entry`);
  return entry;
}

// --- Table 7-1 Level 1 formula bands ---
approxEqual(entryFor(JlrLimits.lookup("RE310", 0.05), "R-01", "PK").limit, 78.92, 0.02, "R-01 @ 0.05 MHz");
approxEqual(entryFor(JlrLimits.lookup("RE310", 0.5), "R-02", "PK").limit, 72, 0.001, "R-02 flat");
approxEqual(entryFor(JlrLimits.lookup("RE310", 5), "R-03", "PK").limit, 56.62, 0.02, "R-03 @ 5 MHz");
approxEqual(entryFor(JlrLimits.lookup("RE310", 20), "R-04", "PK").limit, 50, 0.001, "R-04 flat");
approxEqual(entryFor(JlrLimits.lookup("RE310", 50), "M-01", "AV").limit, 46.42, 0.02, "M-01 AV @ 50 MHz");
approxEqual(entryFor(JlrLimits.lookup("RE310", 50), "M-01", "QP").limit, 56.42, 0.02, "M-01 QP @ 50 MHz");
approxEqual(entryFor(JlrLimits.lookup("RE310", 200), "M-02", "AV").limit, 48.44, 0.02, "M-02 AV @ 200 MHz");
approxEqual(entryFor(JlrLimits.lookup("RE310", 200), "M-02", "QP").limit, 58.44, 0.02, "M-02 QP @ 200 MHz");
approxEqual(entryFor(JlrLimits.lookup("RE310", 700), "M-03", "AV").limit, 53, 0.001, "M-03 AV flat");
approxEqual(entryFor(JlrLimits.lookup("RE310", 700), "M-03", "QP").limit, 63, 0.001, "M-03 QP flat");

// --- Table 7-2 Level 2 flat bands (spot checks incl. the real page-193 bug case) ---
approxEqual(entryFor(JlrLimits.lookup("RE310", 915), "MS-11", "PK").limit, 32, 0.001, "MS-11 GSM900 PK");
approxEqual(entryFor(JlrLimits.lookup("RE310", 915), "MS-11", "AV").limit, 12, 0.001, "MS-11 GSM900 AV");
approxEqual(entryFor(JlrLimits.lookup("RE310", 571.8), "DB-02", "PK").limit, 38, 0.001, "DB-02 TV Band IV/V PK (571.8 MHz page-193 case)");
approxEqual(entryFor(JlrLimits.lookup("RE310", 316), "MS-03", "PK").limit, 20, 0.001, "MS-03 RKE/TPMS1 PK");
approxEqual(entryFor(JlrLimits.lookup("RE310", 0.2), "BS-01", "AV").limit, 36, 0.001, "BS-01 LW AV");
approxEqual(entryFor(JlrLimits.lookup("RE310", 0.2), "BS-01", "QP").limit, 43, 0.001, "BS-01 LW QP");

// BS-01 must NOT have a PK entry (this is the exact column-misread bug this
// dataset was built to avoid — plain-text extraction had mis-assigned 36/43
// to PK/AV instead of the correct AV/QP).
assert.strictEqual(
  JlrLimits.lookup("RE310", 0.2).find((m) => m.id === "BS-01").entries.some((e) => e.detector === "PK"),
  false,
  "BS-01 should have no PK limit"
);

// --- Table 8-2 CE 420 ---
approxEqual(entryFor(JlrLimits.lookup("CE420", 100), "CE420-FM2", "AV").limit, -22, 0.001, "CE420 FM2 AV");
approxEqual(entryFor(JlrLimits.lookup("CE420", 100), "CE420-FM2", "QP").limit, -15, 0.001, "CE420 FM2 QP");
approxEqual(entryFor(JlrLimits.lookup("CE420", 0.2), "CE420-LW", "QP").limit, 37, 0.001, "CE420 LW QP");

// --- Section-to-test-type mapping ---
assert.strictEqual(JlrLimits.testTypeForSection("Radiated Emissions"), "RE310");
assert.strictEqual(JlrLimits.testTypeForSection("Conducted Emissions"), "CE420");
assert.strictEqual(JlrLimits.testTypeForSection("Radiated RF Immunity"), null);

// --- Detector normalization ---
assert.strictEqual(JlrLimits.normalizeDetector("Peak"), "PK");
assert.strictEqual(JlrLimits.normalizeDetector("AVG"), "AV");
assert.strictEqual(JlrLimits.normalizeDetector("CISPR-QP"), "QP");
assert.strictEqual(JlrLimits.normalizeDetector("RMS"), null);

console.log("All jlrLimits assertions passed.");
