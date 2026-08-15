# EMC Test Report Analyzer

A free, client-side web app that reads a large EMC test report PDF (hundreds
to 1000+ pages) directly in your browser and summarizes:

- every failure / out-of-limit measurement found in the report,
- which radio service bands (FM broadcast, GSM, Wi-Fi/Bluetooth 2.4 GHz,
  GPS, etc.) those exceedances fall into, and
- "marginal" results that passed but are close to the limit.

No server, no upload, no build step. It's a static site: open `index.html`
(or host it on GitHub Pages) and it runs entirely in your browser using
[pdf.js](https://mozilla.github.io/pdf.js/) for PDF text extraction. Your
report never leaves your machine.

**⚠️ Compliance disclaimer:** this tool uses heuristic text/regex parsing,
not a certified EMC compliance engine. Test report layouts vary a lot
between labs and software (EMC32, TILE!, Chase, in-house templates, etc.).
Always verify flagged failures against the original PDF page before making
any compliance or engineering decision. See "Accuracy & limitations" below.

## Quick start

### Option A — GitHub Pages (recommended for sharing)

1. Push this folder to a new GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under "Build and deployment", set **Source: Deploy from a branch**,
   branch **main**, folder **/ (root)**. Save.
4. GitHub will publish the site at `https://<your-username>.github.io/<repo-name>/`
   within a minute or two.

No GitHub Actions workflow is needed — this is a static site, so "deploy from
a branch" is enough.

### Option B — run locally

Just open `index.html` in a modern browser (Chrome, Edge, Firefox, Safari).
Some browsers restrict `file://` pages from loading local scripts, so if
anything looks broken, serve the folder instead:

```bash
cd emc-report-analyzer
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Try it with the included sample

`sample/sample-emc-report.pdf` is a small synthetic (made-up) report used to
test the parser. Upload it to see the app working end-to-end — it contains
4 seeded failures (FM broadcast band, GSM 900 downlink, the 2.4 GHz
Bluetooth/Wi-Fi ISM band, and AM broadcast band) and 1 marginal pass.

## How it works

1. **Upload** — you choose or drag a PDF into the browser. It's read with
   the File API; nothing is sent over the network.
2. **Text extraction** (`js/pdfExtract.js`) — pdf.js extracts positioned
   text for every page. Because PDF text extraction normally loses table
   structure, this module re-groups text items into rows by Y-position and
   orders them left-to-right by X-position, reconstructing something close
   to the original table rows. Large documents are processed page-by-page
   with periodic yields back to the browser's event loop so the tab stays
   responsive.
3. **Parsing** (`js/parser.js`) — each reconstructed row is tokenized and
   scanned for a frequency (with MHz/GHz/kHz unit), one or more dB-style
   readings (level / limit / margin), a detector code (QP/AVG/PK...), and
   an explicit PASS/FAIL/MARGINAL result if present. Section headings
   ("Radiated Emissions", "Conducted Emissions", "Radiated Immunity", ESD,
   EFT/Burst, Surge, etc.) are tracked so every parsed row is tagged with
   the test type it came from. References to standards (CISPR 32, EN 55032,
   FCC Part 15, IEC 61000-x-x, Class A/B) are also collected for the
   overview.
4. **Pass/fail determination** — if the report states PASS/FAIL explicitly,
   that's used. Otherwise the app computes `margin = limit − level` from
   whatever level/limit values it found and flags negative margin as a
   failure. A configurable "marginal" threshold (default 3 dB) flags
   passing results that are close to the limit.
5. **Narrative exceedance sentences** — some labs (notably automotive
   CISPR 25 / "RE 310"-style reports produced by EMC32-family software)
   don't tabulate radiated emissions at all: each frequency sweep is a
   graph, and the only machine-readable result is a sentence underneath it
   like *"PK level exceeded the range 243 – 650 MHz with max. exceedance
   8.13 dB at 571.8 MHz."* The app detects these sentences directly (per
   page, since they can wrap across multiple lines) and pulls out the
   detector, the exceedance in dB, and the exact frequency it occurred at —
   along with the Test / File / Antenna identifiers from the same page, so
   you can cross-reference the original graph precisely. These pages are
   excluded from the generic table-row parser, which has no way to
   distinguish "243" (the start of a swept range) from an actual reading.
6. **Band classification** (`js/bandData.js`) — every failing/marginal
   frequency is checked against a reference table of common radio service
   bands (FM/AM broadcast, TV, cellular, ISM/Wi-Fi/Bluetooth, GPS, etc.) so
   you can immediately see, for example, that a radiated emissions failure
   at 2440 MHz sits inside the 2.4 GHz Bluetooth/Wi-Fi ISM band.
7. **Immunity test results** — immunity tests (RF/BCI/ESD/EFT/Surge/transients,
   voltage dips, etc.) don't have a frequency/limit-line model at all. Labs
   report a verdict per test instead — and the vocabulary varies: some say
   Pass/Fail, some say Compliant/Not compliant, and some (notably certain
   automotive labs) say **Compliant/Deviation** or "Deviated" instead of
   Fail. The app recognizes all of these. It looks for two things: a
   front-matter "Tests to be done and results" dashboard table if the report
   has one (one line per test category, e.g. "RF Immunity (RI 112)
   Deviation"), and per-test/per-section "Result: ..." or "Test result: The
   tested sample did/didn't fulfill the specifications" notes, each paired
   with whatever descriptive text follows (e.g. "Signal deviation of
   Pressure_OTP_01_kPa..."). These show up in the **Immunity** tab, separate
   from the frequency-based emissions tabs. Coverage note: category-level
   and per-test-plot results are captured reliably; individual rows inside
   a large multi-row sweep table (e.g. every single BCI frequency point) are
   not all itemized individually — the category/section-level result and
   description usually tell you what you need, but check the source page
   for full point-by-point detail within a failing category.
8. **Results UI** (`js/app.js`, `index.html`) — Overview stats + chart,
   a Failures table, a Band Summary (the main "which bands are over the
   limit" view), a paginated full results table, CSV export, and a Debug
   tab that lists lines the parser couldn't confidently classify (useful
   for tuning the parser to your specific report format). An **"Export
   Summary Image (PNG)"** button (top controls row) renders a single styled
   picture combining the Overview stats, the Band Summary table, and the
   Immunity Failures table — a quick shareable snapshot (e.g. for email or
   Slack) without opening the full app. Rendered client-side with
   [html2canvas](https://html2canvas.hertzen.com/); nothing is uploaded.

## Accuracy & limitations

- **No universal EMC report format exists.** This parser was built and
  tested against a synthetic sample with a fairly conventional
  Frequency / Level / Limit / Margin / Detector / Result table layout.
  Real reports from different labs will differ — check the **Debug** tab
  after your first upload; if it shows a large number of unmatched lines
  that clearly *are* measurement rows, the layout doesn't match the
  heuristics and `js/parser.js` will need tuning (see below).
- **Scanned / image-only PDFs are not supported.** pdf.js extracts text
  that exists in the PDF; if your report is a scanned image with no text
  layer, extraction will find nothing. You'd need to OCR it first (e.g.
  with `ocrmypdf`) before uploading.
- **Column-order assumption.** When 3 numeric dB-style values appear in a
  row, the parser assumes they are `[level, limit, margin]` in that order,
  which matches the most common layout but isn't guaranteed.
- **Radio band table is indicative reference data**, not an authoritative
  frequency allocation table — see the disclaimer at the top of
  `js/bandData.js`. Edit it to match your product's target regulatory
  regions.
- Always treat this as a **triage/summary aid**, not a replacement for
  reading the actual report or for sign-off by a qualified EMC engineer.

## Customizing for your report format

- **Radio bands**: edit the `RADIO_BANDS` array in `js/bandData.js`.
- **Parsing rules**: `js/parser.js` exports `parseRow()` (single row →
  structured measurement or `null`) and `analyzeRows()` (full pipeline).
  If your reports use a different detector/result vocabulary or column
  order, adjust the regexes/token logic there.
- **Marginal threshold**: adjustable in the UI (default 3 dB), or pass
  `{ marginalThresholdDb }` into `EmcParser.analyzeRows()` directly.

## Running the tests

There's a small Node-based end-to-end test that runs the real parsing
pipeline (via `pdfjs-dist`'s Node build) against the bundled sample PDF and
checks that the expected failures/bands/marginal results are detected.

```bash
npm install
npm test
```

`tools/generate_sample_report.py` (requires Python + `reportlab`) regenerates
`sample/sample-emc-report.pdf` if you want to tweak the sample data.

## Project structure

```
emc-report-analyzer/
├── index.html            # App shell / markup
├── css/styles.css
├── js/
│   ├── pdfExtract.js      # pdf.js text extraction + row reconstruction
│   ├── parser.js          # section detection, row parsing, pass/fail logic
│   ├── bandData.js         # radio service band reference table
│   ├── csvExport.js        # CSV export helper
│   └── app.js               # UI wiring
├── sample/
│   ├── sample-emc-report.pdf         # synthetic tabular emissions report
│   ├── sample-narrative-report.pdf   # synthetic narrative-sentence emissions report
│   └── sample-immunity-report.pdf    # synthetic Compliant/Deviation immunity report
├── tools/
│   ├── generate_sample_report.py
│   ├── generate_sample_narrative_report.py
│   └── generate_sample_immunity_report.py
├── tests/pipeline.test.js  # Node end-to-end test
└── README.md
```

## Privacy

Everything happens client-side in your browser tab. The PDF you upload is
never transmitted anywhere — there is no backend. This makes it safe to use
with confidential/unreleased-product EMC reports, subject to your own
browser's security.

## License

MIT — see `LICENSE`.
