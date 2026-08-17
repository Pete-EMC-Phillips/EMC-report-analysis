/**
 * falsePositives.test.js - regression test for a class of bugs found
 * against a real report (EMCC Dr. Rasek / Brose window regulator motor,
 * 931512.2Z_2024-02-09): the generic emissions row parser was fabricating
 * "failures" out of non-measurement text - page footers, table-of-contents
 * entries, settings/methodology tables, and immunity limit-formula tables.
 * These tests operate directly on parser.js with synthetic row arrays (no
 * PDF needed - parser.js has no pdf.js dependency by design), reproducing
 * the exact offending lines pulled from that report.
 */
const assert = require("assert");
const EmcParser = require("../js/parser.js");

function rows(lines, page) {
  return lines.map((text) => ({ page: page || 1, text }));
}

// --- 1) Page header/footer boilerplate must not become fake measurements ---
{
  const r = EmcParser.parseRow("Issue Da te: 2 024- 02- 09", { section: "conducted_emissions" });
  assert.strictEqual(r, null, "garbled 'Issue Date' footer should not parse as a measurement");
}
{
  const r = EmcParser.parseRow("Pa ge 16 of 85", { section: "conducted_emissions" });
  assert.strictEqual(r, null, "'Page N of M' footer should not parse as a measurement");
}

// --- 2) Table-of-contents entries must not become fake measurements ---
{
  const r = EmcParser.parseRow("6.2 Conducted transient emissions - CE 410 19", { section: "conducted_emissions" });
  assert.strictEqual(r, null, "TOC entry (clause + title + page number) should not parse as a measurement");
}

// --- 3) Settings/methodology table rows (bare numbers + non-EMC-unit words
// like "mm", "s") must not become fake measurements ---
{
  const r = EmcParser.parseRow("50 mm 50 mm", { section: "conducted_emissions" });
  assert.strictEqual(r, null, "current-probe-position spec row ('50 mm') should not parse as a measurement");
}
{
  const r = EmcParser.parseRow("MEASUREMENT TIME 0.05 s 0.05 s 9 kHz (Pk / AV)", { section: "conducted_emissions" });
  assert.strictEqual(r, null, "measurement-time spec row should not parse as a measurement");
}

// --- 4) "X MHz to Y MHz" frequency-range spec sentences must not become
// fake measurements (this one fabricated a -241 dB "failure" from a
// methodology description in the real report). The guard for this lives in
// analyzeRows() (applied before parseRow() is even called), so it's tested
// through the full pipeline rather than parseRow() directly.
{
  const testRows = rows(
    ["Conducted Emissions", "FREQUENCY RANGE f TEST 0.15 MHz to 242 MHz 0.53 MHz to 30 MHz"],
    18
  );
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(
    analysis.results.filter((r) => r.kind === "emission").length,
    0,
    "frequency-range spec sentence should not produce a fake measurement"
  );
}

// --- 5) Immunity-section limit-formula tables must not be run through the
// emissions parser at all (fabricated a -786 dB "failure" from an RI 140
// magnetic field immunity limit formula in the real report) ---
{
  const testRows = [
    { page: 1, text: "Magnetic Field Immunity RI 140" },
    { page: 1, text: "1000 - 10000 Hz 180-20xlog(f/100) 794.33 - 7.94 0.5" },
  ];
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(
    analysis.results.filter((r) => r.kind === "emission").length,
    0,
    "a limit-formula row inside an immunity section must not produce a fake emissions result"
  );
}

// --- 6) "STATEMENT OF CONFORMITY: not compliant / compliant" should be
// captured as a category-level result (this is the one genuinely useful
// signal on report pages where the detailed table is an embedded image) ---
{
  const testRows = rows(
    ["Test conditions and result", "CE 420", "STATEMENT OF CONFORMITY not compliant"],
    18
  );
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(analysis.testSummary.length, 1);
  assert.strictEqual(analysis.testSummary[0].status, "fail");
  assert.strictEqual(analysis.testSummary[0].code, "CE 420");
}
{
  const testRows = rows(["STATEMENT OF CONFORMITY compliant"], 21);
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(analysis.testSummary[0].status, "pass");
}
// A table-of-contents-style mention (no "compliant"/"not compliant" right
// after it) must not be picked up.
{
  const testRows = rows(["STATEMENT OF CONFORMITY ................ 12"], 2);
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(analysis.testSummary.length, 0);
}

// --- 7) A "Tabular summary of X" heading with zero extractable data on
// that page should be flagged as a likely image-embedded table, not
// silently ignored ---
{
  const testRows = rows(
    ["Tabular summary of CE 420", "DV/PV TEST RESULTS - FOR SIGN OFF"],
    16
  );
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(analysis.imageOnlyTables.length, 1);
  assert.strictEqual(analysis.imageOnlyTables[0].page, 16);
  assert.strictEqual(analysis.imageOnlyTables[0].testCode, "CE 420");
}
// ...but if real data IS found on that page, it should NOT be flagged.
{
  const testRows = rows(
    ["Tabular summary of CE 420", "80 MHz 45.2 dB 50 dB -4.8 dB FAIL"],
    16
  );
  const analysis = EmcParser.analyzeRows(testRows, {});
  assert.strictEqual(analysis.imageOnlyTables.length, 0, "should not flag a page that actually has extractable data");
}

// --- 8) Real radiated-emissions data rows ending in a polarization column
// (H/V) must still parse correctly - this is standard RE 310 table format,
// not stray prose (regression: a real report, Sensata 2530827R.801.A01,
// had its entire RE 310 page 19-22 dataset silently dropped by an
// over-eager "reject rows with unrecognized trailing words" guard) ---
{
  const r = EmcParser.parseRow("0.150000 53.81 --- 43.00 -10.81 1000.0 9.000 V", { section: "radiated_emissions" });
  assert.ok(r, "a real RE310 row with a trailing polarization letter should parse");
  assert.strictEqual(r.frequencyMHz, 0.15);
  assert.strictEqual(r.level, 53.81);
  assert.strictEqual(r.limit, 43);
  assert.strictEqual(r.computedMargin, -10.81);
  assert.strictEqual(r.exceed, true);
}
{
  const r = EmcParser.parseRow("0.181500 --- 40.24 36.00 -4.24 1000.0 9.000 V", { section: "radiated_emissions" });
  assert.ok(r, "a real RE310 row with a leading blank (---) column and trailing H/V should parse");
  assert.strictEqual(r.level, 40.24);
  assert.strictEqual(r.limit, 36);
}

// --- 9) A page-title fragment that wraps onto its own line ("...Level 2
// Fail" -> a lone "2 Fail" row) must not be read as a 2 MHz failure with no
// data. This combination (ambiguous bare-number frequency + zero dB
// readings) is exactly what a wrapped heading looks like, never a real
// measurement. ---
{
  const r = EmcParser.parseRow("2 Fail", { section: "radiated_emissions" });
  assert.strictEqual(r, null, "a bare 'N Fail' heading fragment should not parse as a measurement");
}
// But an explicit-unit frequency + result word (a real, if sparse, table
// row some labs do use) should still be accepted.
{
  const r = EmcParser.parseRow("323.4 MHz FAIL", { section: "radiated_emissions" });
  assert.ok(r, "an explicit-unit frequency with only a result word should still parse");
  assert.strictEqual(r.frequencyMHz, 323.4);
  assert.strictEqual(r.exceed, true);
}

console.log("All false-positive regression assertions passed.");
