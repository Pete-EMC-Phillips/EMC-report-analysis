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

  console.log("\nAll pipeline assertions passed.");
}

main().catch((err) => {
  console.error("PIPELINE TEST FAILED:", err);
  process.exit(1);
});
