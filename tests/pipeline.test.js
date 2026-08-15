/**
 * End-to-end pipeline test: runs the real pdf text-extraction row
 * reconstruction logic (reconstructRows from pdfExtract.js) plus the
 * real parser.js against the synthetic sample-emc-report.pdf, using
 * pdfjs-dist's Node ("legacy") build to stand in for the browser's
 * pdfjsLib global.
 *
 * Run with: node tests/pipeline.test.js
 * (requires `npm install` in this directory first — see package.json)
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const pdfjsLib = require("pdfjs-dist/legacy/build/pdf.js");
const { reconstructRows } = require("../js/pdfExtract.js");
const EmcParser = require("../js/parser.js");
const { classifyFrequencyMHz } = require("../js/bandData.js");

const SAMPLE_PATH = path.join(__dirname, "..", "sample", "sample-emc-report.pdf");
const NARRATIVE_SAMPLE_PATH = path.join(__dirname, "..", "sample", "sample-narrative-report.pdf");
const IMMUNITY_SAMPLE_PATH = path.join(__dirname, "..", "sample", "sample-immunity-report.pdf");

async function extractRowsNode(filePath) {
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const rows = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    for (const text of reconstructRows(textContent)) {
      if (text) rows.push({ page: pageNum, text });
    }
  }
  return { totalPages: doc.numPages, rows };
}

async function main() {
  console.log("Loading sample PDF:", SAMPLE_PATH);
  const { totalPages, rows } = await extractRowsNode(SAMPLE_PATH);
  console.log(`Extracted ${rows.length} rows from ${totalPages} pages.`);

  assert.ok(totalPages >= 5, `expected at least 5 pages, got ${totalPages}`);
  assert.ok(rows.length > 20, `expected a reasonable number of extracted rows, got ${rows.length}`);

  const analysis = EmcParser.analyzeRows(rows, { marginalThresholdDb: 3 });
  const { results, standardsSeen, unmatchedCount } = analysis;

  console.log(`Parsed ${results.length} measurement rows.`);
  console.log(`Standards referenced detected: ${standardsSeen.join(", ") || "(none)"}`);
  console.log(`Unmatched digit-containing lines: ${unmatchedCount}`);

  // We authored the sample report with exactly 12 measurement rows
  // (8 radiated + 4 conducted).
  assert.strictEqual(results.length, 12, `expected 12 parsed rows, got ${results.length}`);

  const fails = results.filter((r) => r.exceed === true);
  console.log(`Failures detected: ${fails.length}`);
  fails.forEach((f) =>
    console.log(
      `  - page ${f.page} [${f.section}] ${f.frequencyMHz} MHz, margin ${f.computedMargin} dB -> bands: ${classifyFrequencyMHz(f.frequencyMHz).join(", ") || "none"}`
    )
  );

  // Known-fail frequencies from the sample data: 98.5, 960, 2440 (radiated), 0.5 (conducted)
  assert.strictEqual(fails.length, 4, `expected 4 failures, got ${fails.length}`);
  const failFreqs = fails.map((f) => f.frequencyMHz).sort((a, b) => a - b);
  assert.deepStrictEqual(failFreqs, [0.5, 98.5, 960, 2440]);

  // Band classification checks
  const bandsFor = (f) => classifyFrequencyMHz(f);
  assert.ok(bandsFor(98.5).includes("FM Broadcast"), "98.5 MHz should classify as FM Broadcast");
  assert.ok(bandsFor(2440).includes("Bluetooth / Wi-Fi 2.4 GHz ISM"), "2440 MHz should classify as 2.4GHz ISM");
  assert.ok(bandsFor(960).includes("GSM 900 Downlink"), "960 MHz should classify as GSM 900 Downlink");
  assert.ok(bandsFor(0.5).includes("LW/MW AM Broadcast"), "0.5 MHz should classify as AM Broadcast");

  const marginal = results.filter((r) => r.marginal);
  console.log(`Marginal (pass but within 3dB) detected: ${marginal.length}`);
  assert.strictEqual(marginal.length, 1, `expected 1 marginal row (433.92 MHz), got ${marginal.length}`);
  assert.strictEqual(marginal[0].frequencyMHz, 433.92);

  assert.ok(standardsSeen.some((s) => /CISPR/i.test(s)), "should detect CISPR standard reference");

  console.log("\n--- Narrative-style report (sample-narrative-report.pdf) ---");
  const { rows: narrativeRows } = await extractRowsNode(NARRATIVE_SAMPLE_PATH);
  const narrativeAnalysis = EmcParser.analyzeRows(narrativeRows, { marginalThresholdDb: 3 });
  narrativeAnalysis.results.forEach((r) =>
    console.log(
      `  - page ${r.page} Test ${r.testId} ${r.fileRef} (${r.antenna}) ${r.detector} freq=${r.frequencyMHz} margin=${r.computedMargin} exceed=${r.exceed}`
    )
  );

  // This is the exact bug reported by the user on page 193 of a real report:
  // "PK level exceeded the range 243 - 650 MHz with max. exceedance 8.13 dB
  // at 571.8 MHz" must parse as frequency 571.8 MHz / margin -8.13 dB, NOT
  // frequency 650 MHz with some bogus level/limit split.
  const test181 = narrativeAnalysis.results.find((r) => r.testId === "1.1.181");
  assert.ok(test181, "expected to find a parsed result for Test 1.1.181");
  assert.strictEqual(test181.frequencyMHz, 571.8, `expected frequency 571.8 MHz, got ${test181.frequencyMHz}`);
  assert.strictEqual(test181.computedMargin, -8.13, `expected margin -8.13 dB, got ${test181.computedMargin}`);
  assert.strictEqual(test181.exceed, true);
  assert.strictEqual(test181.fileRef, "RE_72b");
  assert.strictEqual(test181.antenna, "Horizontal");

  // No-range variant: "PK level exceeded at 316 MHz with exceedance 2.4 dB."
  const test68 = narrativeAnalysis.results.find((r) => r.testId === "1.1.68");
  assert.ok(test68, "expected to find a parsed result for Test 1.1.68");
  assert.strictEqual(test68.frequencyMHz, 316);
  assert.strictEqual(test68.computedMargin, -2.4);

  // Two-disjoint-ranges variant.
  const test100 = narrativeAnalysis.results.find((r) => r.testId === "1.1.100");
  assert.ok(test100, "expected to find a parsed result for Test 1.1.100");
  assert.strictEqual(test100.frequencyMHz, 107.25);
  assert.strictEqual(test100.computedMargin, -2.9);

  // Compliant page: PK narrative mentions "exceeded" but the lab's own
  // Result is Compliant -> must NOT be counted as a failure.
  const test195 = narrativeAnalysis.results.filter((r) => r.testId === "1.1.195");
  assert.ok(test195.length >= 1, "expected results for Test 1.1.195");
  assert.ok(
    test195.every((r) => r.exceed === false),
    "Test 1.1.195 is labeled Compliant and must not be flagged as a failure despite the word 'exceeded' appearing"
  );

  const narrativeFails = narrativeAnalysis.results.filter((r) => r.exceed === true);
  console.log(`Narrative-report failures detected: ${narrativeFails.length}`);
  assert.strictEqual(narrativeFails.length, 3, `expected 3 failures (tests 181, 68, 100), got ${narrativeFails.length}`);

  console.log("\n--- Immunity-style report (sample-immunity-report.pdf) ---");
  const { rows: immunityRows } = await extractRowsNode(IMMUNITY_SAMPLE_PATH);
  const immunityAnalysis = EmcParser.analyzeRows(immunityRows, { marginalThresholdDb: 3 });

  console.log("Test summary dashboard:");
  immunityAnalysis.testSummary.forEach((s) => console.log(`  - [${s.code}] ${s.label} -> ${s.status}`));
  console.log("Immunity result notes:");
  immunityAnalysis.results
    .filter((r) => r.kind === "immunity")
    .forEach((r) => console.log(`  - page ${r.page} [${r.section}] Test ${r.testId} status=${r.status} desc="${r.description}"`));

  // Front-matter dashboard: this is the primary "which categories failed"
  // signal and must correctly flag Deviation as a failure (not miss it, and
  // not confuse it with the unrelated "Informative" emissions rows).
  const dashboard = immunityAnalysis.testSummary;
  const byCode = (code) => dashboard.find((s) => s.code === code);
  assert.strictEqual(byCode("RI 114").status, "pass");
  assert.strictEqual(byCode("RI 112").status, "fail", "RI 112 dashboard row says 'Deviation*)' and must be flagged as a failure");
  assert.strictEqual(byCode("CI 210").status, "pass");
  assert.strictEqual(byCode("CI 220").status, "fail", "CI 220 dashboard row says 'Deviation*)' and must be flagged as a failure");
  assert.strictEqual(byCode("RE 310").status, "info", "Informative emissions rows must not be counted as pass or fail");

  // Individual test / section-summary notes, including the exact wording
  // variants this feature was built to handle: "Result: Deviation" (short
  // form), "Test result: ... fulfilled ..." (pass paragraph), and "Test
  // result: ... didn't fulfill ..." (fail paragraph, contraction form).
  const immunityResults = immunityAnalysis.results.filter((r) => r.kind === "immunity");
  const bci = immunityResults.find((r) => r.fileRef === "BCI_45");
  assert.ok(bci, "expected an immunity result for File: BCI_45");
  assert.strictEqual(bci.status, "fail", "'Result: Deviation' must be treated as a failure, not a pass");
  assert.strictEqual(bci.testId, "2.3.1");
  assert.ok(/Pressure_OTP_01_kPa/.test(bci.description), "expected the deviation description to be captured");

  const ci220 = immunityResults.find((r) => r.section === "CI 220");
  assert.ok(ci220, "expected an immunity result under CI 220");
  assert.strictEqual(ci220.status, "fail", "\"didn't fulfill\" (contraction) must be recognized as a failure");
  assert.ok(/pulse C-2/.test(ci220.description), "expected the CI 220 description to mention the failing pulse");

  const immunityFails = immunityResults.filter((r) => r.status === "fail");
  console.log(`Immunity failures detected: ${immunityFails.length}`);
  assert.strictEqual(immunityFails.length, 2, `expected 2 individual immunity failure notes, got ${immunityFails.length}`);

  console.log("\nAll pipeline assertions passed.");
}

main().catch((err) => {
  console.error("PIPELINE TEST FAILED:", err);
  process.exit(1);
});
