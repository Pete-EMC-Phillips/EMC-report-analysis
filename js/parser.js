/**
 * parser.js
 *
 * Heuristic parser for EMC test report tables that have already been
 * reduced to plain text lines (see pdfExtract.js for how PDF.js text
 * items are reconstructed into rows). This module has no dependency on
 * pdf.js or the DOM, so it can be unit tested directly in Node.
 *
 * IMPORTANT: EMC test reports are produced by many different labs and
 * software packages (EMC32, TILE!, Chase, in-house Word/Excel templates,
 * etc.) and there is no single universal table layout. This parser uses
 * best-effort heuristics (regex + token classification) to find rows
 * that look like frequency / level / limit / margin / result entries.
 * It WILL miss unusual formats and can occasionally misclassify columns.
 * Always spot-check flagged failures against the source PDF page before
 * making compliance decisions.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.EmcParser = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  // ---- Section detection -------------------------------------------------

  const SECTION_PATTERNS = [
    { key: "radiated_emissions", label: "Radiated Emissions", re: /radiated\s+(?:rf\s+)?emissions?/i },
    { key: "conducted_emissions", label: "Conducted Emissions", re: /conducted\s+(?:rf\s+)?emissions?/i },
    { key: "harmonics", label: "Harmonic Current Emissions", re: /harmonic\s+current/i },
    { key: "flicker", label: "Voltage Fluctuations / Flicker", re: /voltage\s+fluctuations?|flicker/i },
    { key: "radiated_immunity", label: "Radiated RF Immunity", re: /\bRF\s+Immunity\b|radiated\s+(rf\s+)?immunity/i },
    {
      key: "conducted_immunity",
      label: "Conducted / Coupled Immunity",
      re: /conducted\s+(rf\s+)?immunity|\bcoupled\s+immunity\b|\bcontinuous\s+disturbance\b|\bBCI\b|\btransients?\s+CI\s?\d{3}\b|\bvoltage\s+(offset|dropout|overstress)\b/i,
    },
    { key: "esd", label: "Electrostatic Discharge (ESD)", re: /electrostatic\s+discharge|\bESD\s+immunity\b/i },
    { key: "eft_burst", label: "Electrical Fast Transient / Burst", re: /electrical\s+fast\s+transient|EFT\s*\/?\s*Burst/i },
    { key: "surge", label: "Surge Immunity", re: /\bsurge\s+immunity\b/i },
    { key: "dips_interruptions", label: "Voltage Dips / Interruptions", re: /voltage\s+dips|short\s+interruptions/i },
    { key: "magnetic_field", label: "Magnetic Field Immunity", re: /magnetic\s+field\s+immunity/i },
  ];

  function detectSection(line) {
    for (const p of SECTION_PATTERNS) {
      if (p.re.test(line)) return { key: p.key, label: p.label };
    }
    return null;
  }

  const STANDARD_RE = /\b(CISPR\s?\d{2}(?:-\d)?|EN\s?\d{5}(?:-\d(?:-\d)?)?|FCC\s?Part\s?1?\d|IEC\s?6\d{4}(?:-\d(?:-\d)?)?|Class\s?[AB]\b)/gi;

  function detectStandardRefs(line) {
    const out = new Set();
    let m;
    STANDARD_RE.lastIndex = 0;
    while ((m = STANDARD_RE.exec(line)) !== null) {
      out.add(m[0].replace(/\s+/g, " ").trim());
    }
    return Array.from(out);
  }

  // ---- Boilerplate stripping ----------------------------------------------
  //
  // Some labs stamp every page with a repeating footer/letterhead and even
  // an "invisible" watermark text layer. Because our row-reconstruction
  // groups text purely by on-page position, this boilerplate can land at
  // the same Y-coordinate as real content and get spliced into the middle
  // of a sentence (e.g. "Test result: unsichtbarer Text! The tested sample
  // did not fulfill..."). Stripping known boilerplate fragments before
  // running any other regex avoids that.
  const BOILERPLATE_RE =
    /(the\s+test\s+report\s+shall\s+not\s+be\s+reproduc\s*ed\s+except\s+in\s+full\s+without|the\s+writ\s*ten\s+approval\s+of\s+the\s+testing\s+laboratory|unsichtbarer\s+Text!)/gi;

  function stripBoilerplate(text) {
    return text.replace(BOILERPLATE_RE, " ").replace(/\s+/g, " ").trim();
  }

  // ---- Narrative exceedance sentences -------------------------------------
  //
  // Some labs (notably automotive CISPR 25 / RE 310-style reports produced by
  // EMC32-family software) don't tabulate radiated emissions results at all —
  // each frequency sweep is a graph, and the only machine-readable numbers
  // are in a narrative sentence underneath it, e.g.:
  //   "AV level exceeded the range 0.86 - 30 MHz with max. exceedance 21.5 dB at 2.47 MHz"
  //   "PK level exceeded at 316 MHz with exceedance 2.4 dB."
  //   "PK level exceeded the ranges 65 - 66 MHz and 106-108 MHz with max. exceedance 2.9 dB at 107.25 MHz"
  // These sentences directly state the one number that matters (how far
  // over the limit, and at what frequency) and must NOT be run through the
  // generic table-row heuristics below, which have no way to know that
  // "650" (the end of the swept range) isn't the measurement frequency and
  // that "8.13 dB" is a margin, not an absolute level.
  const NARRATIVE_EXCEEDANCE_RE =
    /(?<det>PK|AV|QP)\s+level\s+exceeded\s+(?:(?:the\s+ranges?|in\s+range)\s+[\d.]+\s*[–-]\s*[\d.]+\s*MHz(?:\s+and\s+[\d.]+\s*[–-]\s*[\d.]+\s*MHz)?\s+)?(?:with\s+(?:max\.?\s*)?exceedance\s+(?<db1>[\d.]+)\s*dB\s+at\s+(?<f1>[\d.]+)\s*MHz|at\s+(?<f2>[\d.]+)\s*MHz\s+with\s+exceedance\s+(?<db2>[\d.]+)\s*dB)/gi;

  const TEST_ID_RE = /\bTest\s+(\d+(?:\.\d+)+)\b/i;
  const FILE_REF_RE = /\bFile:\s*([A-Za-z0-9_]+)/i;
  const ANTENNA_RE = /\bAntenna:\s*(\w+)/i;
  // Note: some labs report immunity results as "Deviation"/"Deviated" or
  // "Not performed" instead of Pass/Fail - see normalizeVerdict() below.
  const RESULT_VERDICT_RE =
    /\bResult:\s*(Not\s+compliant|Compliant|Deviat(?:ed|ion)|Not\s*performed|PASS(?:ED)?|FAIL(?:ED)?)\b/i;

  // Lines that are report metadata/narrative, not measurement table rows.
  // These would otherwise confuse the generic table parser below (e.g.
  // "BW: 1000 kHz" or "T: 500 ms" contain unit-tagged numbers that aren't
  // frequencies or levels at all).
  const PROSE_LABEL_RE = /^(Settings|Antenna|File|Modification|Result|Limits?\s+according|Investigation|EOP|DUT)\b\s*[:.]?/i;

  /**
   * Normalize a lab's result vocabulary to a common status. Handles the
   * standard Pass/Fail and Compliant/Not compliant pairs as well as
   * "Deviation"/"Deviated" (used by some immunity test labs instead of
   * "Fail") and "Not performed" (test skipped, not a pass or fail).
   */
  function normalizeVerdict(word) {
    const w = (word || "").toLowerCase().trim();
    if (!w) return null;
    if (/^not\s*compliant/.test(w)) return "fail";
    if (/^not\s*perform/.test(w) || /^not\s*test/.test(w)) return "skip";
    if (/^informative/.test(w)) return "info";
    if (/^(fail|deviat)/.test(w)) return "fail";
    if (/^(compliant|pass)/.test(w)) return "pass";
    return null;
  }

  function extractPageContext(pageText) {
    const cleaned = stripBoilerplate(pageText);
    const testMatch = cleaned.match(TEST_ID_RE);
    const fileMatch = cleaned.match(FILE_REF_RE);
    const antennaMatch = cleaned.match(ANTENNA_RE);
    const verdictMatch = cleaned.match(RESULT_VERDICT_RE);
    return {
      testId: testMatch ? testMatch[1] : null,
      fileRef: fileMatch ? fileMatch[1] : null,
      antenna: antennaMatch ? antennaMatch[1] : null,
      verdict: verdictMatch ? normalizeVerdict(verdictMatch[1]) : null, // 'pass' | 'fail' | 'skip' | 'info' | null
    };
  }

  // ---- Immunity test results ("Compliant" / "Deviation" vocabulary) ------
  //
  // Some labs (e.g. automotive ISO 11452 / ISO 7637 immunity testing) don't
  // use Pass/Fail or a dB-margin model at all. Instead a test is reported as
  // "Compliant" or "Deviation" (optionally with a functional performance
  // class like "Deviation / III"), and the report includes:
  //  (a) a front-matter dashboard listing each test category and its
  //      overall result, e.g. "RF Immunity (RI 112) Deviation", and
  //  (b) a "Result: Deviation" / "Test result: The tested sample did not
  //      fulfill the specifications." note per test/section, usually
  //      followed by a short free-text description of what happened.
  // There is no frequency/level/limit model to extract here, so these are
  // kept as a distinct record shape from the emissions results above.

  const TEST_CODE_RE = /\b((?:RI|CI|CE|RE|ESD|EFT)\s?\d{2,3})\b/i;

  // Source text spaces the test code inconsistently ("RI 112" vs "RI114"
  // depending on which page it came from), which breaks any attempt to
  // group records by code. Normalize to a single canonical "LETTERS NNN"
  // form so the same category always groups together.
  function formatTestCode(raw) {
    const compact = (raw || "").replace(/\s+/g, "").toUpperCase();
    const m = compact.match(/^([A-Z]+)(\d+)$/);
    return m ? `${m[1]} ${m[2]}` : compact;
  }

  const TEST_SUMMARY_ROW_RE =
    /([A-Za-z][A-Za-z0-9 :\/\-]*?)\(?\b((?:RI|CI|CE|RE)\s?\d{3})\)?\s+(Compliant|Deviation|Informative|Not\s*performed)\b/i;

  /**
   * Match a front-matter dashboard row like "RF Immunity (RI 112) Deviation"
   * or "Coupled Immunity: RI 130 Deviation" (no parens). Operates on a
   * single reconstructed row of text.
   */
  function extractTestSummaryRow(rowText) {
    const cleaned = stripBoilerplate(rowText);
    const m = cleaned.match(TEST_SUMMARY_ROW_RE);
    if (!m) return null;
    const status = normalizeVerdict(m[3]);
    if (!status) return null;
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    return {
      label: words.slice(-6).join(" "), // trim leading boilerplate/category noise
      code: formatTestCode(m[2]),
      status, // 'pass' | 'fail' | 'skip' | 'info'
      raw: cleaned,
    };
  }

  // Accepts both "did not fulfill" and the contracted "didn't fulfil(l)"
  // (curly or straight apostrophe; British/American spelling), since real
  // reports use either interchangeably.
  const IMMUNITY_VERDICT_RE =
    /(?:Test\s+)?[Rr]esult:\s*(?:The\s+tested\s+sample\s+(did\s*(?:not|n[’']t)\s+fulfil+(?:led)?|fulfil+(?:led)?)\s+the\s+specifications\.?|(Deviation|Compliant|Not\s*performed|PASS(?:ED)?|FAIL(?:ED)?|Not\s+compliant)\)?\d*\)?)/gi;

  const DESCRIPTION_STOP_RE =
    /(Picture documentation|Testing equipment|Test overview|Measurement plots|Measuring plots|Requirements:|Settings:|Customer Equipment)/i;

  const TEST_ID_G_RE = /\bTest\s+(\d+(?:\.\d+)+)\b/gi;
  const FILE_REF_G_RE = /\bFile:\s*([A-Za-z0-9_]+)/gi;
  const ANTENNA_G_RE = /\bAntenna:\s*(\w+)/gi;

  function allMatches(re, text) {
    re.lastIndex = 0;
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ index: m.index, value: m[1] });
      if (re.lastIndex === m.index) re.lastIndex++; // guard against zero-length matches
    }
    return out;
  }

  // Pick whichever match is closest to `index` - preferring one that comes
  // before it (same test block) but falling back to the nearest one after
  // (covers the case where "Result:" precedes "Test X.X.X" in reading
  // order, e.g. a page that opens mid-sentence due to jumbled reconstruction).
  function nearestValue(matches, index) {
    let best = null;
    let bestDist = Infinity;
    for (const m of matches) {
      const dist = m.index <= index ? index - m.index : (m.index - index) * 4; // prefer "before"
      if (dist < bestDist) {
        bestDist = dist;
        best = m;
      }
    }
    return best ? best.value : null;
  }

  /**
   * Scan a whole page's text for "Result: ..." / "Test result: ..." immunity
   * verdicts, each paired with a short trailing description if one follows
   * (e.g. "Deviations of monitored signals occurred.") and the nearest
   * Test/File/Antenna identifiers, so a page with more than one exemplary
   * test plot on it doesn't have every verdict misattributed to the first
   * test on the page.
   */
  function extractImmunityResults(pageText) {
    const cleaned = stripBoilerplate(pageText);
    const testIdMatches = allMatches(TEST_ID_G_RE, cleaned);
    const fileRefMatches = allMatches(FILE_REF_G_RE, cleaned);
    const antennaMatches = allMatches(ANTENNA_G_RE, cleaned);

    const out = [];
    IMMUNITY_VERDICT_RE.lastIndex = 0;
    let m;
    while ((m = IMMUNITY_VERDICT_RE.exec(cleaned)) !== null) {
      const word = m[1] ? (m[1].toLowerCase().startsWith("did") ? "deviation" : "compliant") : m[2];
      const status = normalizeVerdict(word);
      if (!status) continue;

      const afterStart = m.index + m[0].length;
      const after = cleaned.slice(afterStart, afterStart + 300);
      const stop = after.search(DESCRIPTION_STOP_RE);
      const window = stop >= 0 ? after.slice(0, stop) : after;
      const description = window
        .split(/(?<=[.!?])\s+/)
        .slice(0, 2)
        .join(" ")
        .slice(0, 220)
        .trim();

      out.push({
        status,
        description,
        raw: m[0].trim(),
        testId: nearestValue(testIdMatches, m.index),
        fileRef: nearestValue(fileRefMatches, m.index),
        antenna: nearestValue(antennaMatches, m.index),
      });
    }
    return out;
  }

  function extractNarrativeExceedances(pageText, context, marginalThresholdDb) {
    const out = [];
    NARRATIVE_EXCEEDANCE_RE.lastIndex = 0;
    let m;
    while ((m = NARRATIVE_EXCEEDANCE_RE.exec(pageText)) !== null) {
      const db = parseFloat(m.groups.db1 ?? m.groups.db2);
      const freq = parseFloat(m.groups.f1 ?? m.groups.f2);
      if (isNaN(db) || isNaN(freq)) continue;
      const exceed = context.verdict === "fail" ? true : context.verdict === "pass" ? false : null;
      out.push({
        raw: m[0].trim(),
        frequencyMHz: freq,
        freqRaw: `${freq} MHz`,
        level: null,
        limit: null,
        reportedMargin: -db,
        computedMargin: -db,
        detector: m.groups.det.toUpperCase(),
        result: exceed === true ? "FAIL" : exceed === false ? "PASS" : null,
        exceed,
        marginal: exceed === false && db <= marginalThresholdDb,
        testId: context.testId,
        fileRef: context.fileRef,
        antenna: context.antenna,
      });
    }
    return out;
  }

  // ---- Row token classification ------------------------------------------

  const FREQ_UNIT_RE = /^(GHz|MHz|kHz|Hz)$/i;
  const DB_UNIT_RE = /^dB[\wµμ()/.]*$/i; // dB, dBuV/m, dBµV/m, dBm, dB(uV/m), dBµA ...
  const DETECTOR_RE = /^(QP|CISPR-?QP|AVG?|AV|PK|PEAK|RMS)$/i;
  const RESULT_RE = /^(PASS(ED)?|FAIL(ED)?|MARGINAL|MARGIN)$/i;
  const NUMBER_RE = /^-?\d+(?:\.\d+)?$/;
  // A number immediately glued to a unit, e.g. "433.92MHz" or "-12.3dBuV/m"
  const NUMBER_WITH_UNIT_RE = /^(-?\d+(?:\.\d+)?)(GHz|MHz|kHz|Hz|dB[\wµμ()/.]*)$/i;

  const MIN_FREQ_MHZ = 0.009; // 9 kHz, typical EMC low end
  const MAX_FREQ_MHZ = 40000; // 40 GHz, typical EMC high end

  function unitToMHz(value, unit) {
    switch ((unit || "MHz").toLowerCase()) {
      case "ghz":
        return value * 1000;
      case "khz":
        return value / 1000;
      case "hz":
        return value / 1e6;
      default:
        return value; // MHz
    }
  }

  function tokenize(line) {
    return line
      .replace(/−/g, "-") // unicode minus -> hyphen
      .split(/\s+/)
      .filter(Boolean);
  }

  /**
   * Parse a single reconstructed text row into a structured measurement,
   * or return null if the row doesn't look like an EMC data row.
   */
  function parseRow(line, context) {
    context = context || {};
    const rawTokens = tokenize(line);
    if (rawTokens.length < 2) return null;

    // Expand glued number+unit tokens ("433.92MHz") into two tokens.
    const tokens = [];
    for (const t of rawTokens) {
      const m = t.match(NUMBER_WITH_UNIT_RE);
      if (m) {
        tokens.push(m[1], m[2]);
      } else {
        tokens.push(t);
      }
    }

    let freqMHz = null;
    let freqRaw = null;
    const dbValues = []; // {value, unit}
    let detector = null;
    let result = null;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const next = tokens[i + 1];

      if (RESULT_RE.test(tok)) {
        const norm = tok.toUpperCase();
        result = norm.startsWith("PASS")
          ? "PASS"
          : norm.startsWith("FAIL")
          ? "FAIL"
          : "MARGINAL";
        continue;
      }
      if (DETECTOR_RE.test(tok) && freqMHz !== null) {
        detector = tok.toUpperCase();
        continue;
      }
      if (NUMBER_RE.test(tok)) {
        const val = parseFloat(tok);
        // Frequency candidate: not yet found one, next token is a freq unit
        if (freqMHz === null && next && FREQ_UNIT_RE.test(next)) {
          const mhz = unitToMHz(val, next);
          if (mhz >= MIN_FREQ_MHZ && mhz <= MAX_FREQ_MHZ) {
            freqMHz = mhz;
            freqRaw = `${tok} ${next}`;
            i++; // consume unit token
            continue;
          }
        }
        // dB value candidate: next token looks like a dB unit
        if (next && DB_UNIT_RE.test(next)) {
          dbValues.push({ value: val, unit: next });
          i++; // consume unit token
          continue;
        }
        // Bare number with no unit: could be a unitless dB reading (some
        // reports omit the unit after the first column) or the frequency
        // itself if no unit column is used at all.
        if (freqMHz === null && val >= MIN_FREQ_MHZ && val <= MAX_FREQ_MHZ && dbValues.length === 0) {
          // Ambiguous - stash as a tentative frequency only if the row
          // also contains an explicit MHz/GHz unit token elsewhere, OR
          // we're inside a known emissions section (reduces false positives
          // from picking up clause numbers / dates elsewhere in the report).
          if (context.section === "radiated_emissions" || context.section === "conducted_emissions") {
            freqMHz = val;
            freqRaw = tok;
            continue;
          }
        }
        if (freqMHz !== null) {
          dbValues.push({ value: val, unit: null });
        }
      }
    }

    if (freqMHz === null) return null;
    if (dbValues.length === 0 && !result) return null; // not enough signal

    const level = dbValues[0] ? dbValues[0].value : null;
    const limit = dbValues[1] ? dbValues[1].value : null;
    const reportedMargin = dbValues[2] ? dbValues[2].value : null;

    let computedMargin = null;
    if (level !== null && limit !== null) {
      computedMargin = Math.round((limit - level) * 100) / 100; // +ve = headroom/pass
    }

    let exceed = null;
    if (result) {
      exceed = result === "FAIL";
    } else if (computedMargin !== null) {
      exceed = computedMargin < 0;
    } else if (reportedMargin !== null) {
      // Fall back to reported margin sign if we couldn't compute one.
      exceed = reportedMargin < 0;
    }

    return {
      raw: line.trim(),
      frequencyMHz: Math.round(freqMHz * 1e6) / 1e6,
      freqRaw,
      level,
      limit,
      reportedMargin,
      computedMargin,
      detector,
      result,
      exceed, // true / false / null (unknown)
    };
  }

  /**
   * Walk an array of { page, text } rows (already reconstructed from the
   * PDF), tracking section context as it goes, and return structured
   * measurement records plus some bookkeeping (unmatched rows, standards
   * referenced, sections seen).
   *
   * Rows are processed per-page in two passes: first the whole page's text
   * is scanned for narrative exceedance sentences and page-level context
   * (Test/File/Antenna/Result), then individual rows are run through the
   * classic table-row heuristics (skipping anything already identified as
   * prose/metadata, so the two passes don't double-count or corrupt each
   * other's output).
   */
  function analyzeRows(rows, opts) {
    opts = opts || {};
    const marginalThresholdDb = opts.marginalThresholdDb ?? 3;

    // Group rows by page, preserving page order of first appearance.
    const pageOrder = [];
    const pageMap = new Map();
    for (const row of rows) {
      if (!pageMap.has(row.page)) {
        pageMap.set(row.page, []);
        pageOrder.push(row.page);
      }
      pageMap.get(row.page).push(row);
    }

    let currentSection = null;
    let currentTestCode = null; // e.g. "RI 112" - persists across pages within a subsection
    const standardsSeen = new Set();
    const results = [];
    let unmatchedCount = 0;
    const sampleUnmatched = [];

    const testSummary = []; // front-matter "Tests to be done and results" dashboard rows

    for (const pageNum of pageOrder) {
      const pageRows = pageMap.get(pageNum);
      const pageText = pageRows.map((r) => r.text).join(" ");
      const context = extractPageContext(pageText);

      for (const narrative of extractNarrativeExceedances(pageText, context, marginalThresholdDb)) {
        narrative.page = pageNum;
        narrative.section = currentSection ? currentSection.label : "Radiated Emissions";
        narrative.sectionKey = currentSection ? currentSection.key : "radiated_emissions";
        narrative.kind = "emission";
        results.push(narrative);
      }

      // Immunity tests ("Compliant"/"Deviation") have no frequency/level
      // model, so they're kept as a distinct record kind. Gate on the test
      // code (RI/CI/ESD/EFT = immunity, RE/CE = emissions) so this doesn't
      // fire on emissions pages that also say "Result: Compliant" / "Result:
      // Not compliant". The code is only stated on the first page or two of
      // each subsection, so it's tracked as state that persists across
      // pages (like currentSection) rather than re-detected per page.
      const codeMatch = stripBoilerplate(pageText).match(TEST_CODE_RE);
      if (codeMatch) currentTestCode = formatTestCode(codeMatch[1]);
      if (currentTestCode && /^(RI|CI|ESD|EFT)/i.test(currentTestCode)) {
        for (const imm of extractImmunityResults(pageText)) {
          results.push({
            kind: "immunity",
            page: pageNum,
            section: currentTestCode,
            sectionKey: "immunity",
            testId: imm.testId ?? context.testId,
            fileRef: imm.fileRef ?? context.fileRef,
            antenna: imm.antenna ?? context.antenna,
            status: imm.status, // 'pass' | 'fail' | 'skip' | 'info'
            exceed: imm.status === "fail" ? true : imm.status === "pass" ? false : null,
            description: imm.description,
            raw: imm.raw,
            frequencyMHz: null,
          });
        }
      }

      for (const row of pageRows) {
        const sec = detectSection(row.text);
        if (sec) currentSection = sec;

        for (const s of detectStandardRefs(row.text)) standardsSeen.add(s);

        // Front-matter "Tests to be done and results" dashboard rows, e.g.
        // "RF Immunity (RI 112) Deviation" or "Radiated RF Emissions (RE
        // 310) Informative" - one line summarizing a whole test category.
        const summaryRow = extractTestSummaryRow(row.text);
        if (summaryRow) {
          testSummary.push({
            kind: "testSummary",
            page: row.page,
            code: summaryRow.code,
            label: summaryRow.label,
            status: summaryRow.status,
            exceed: summaryRow.status === "fail" ? true : summaryRow.status === "pass" ? false : null,
            raw: summaryRow.raw,
          });
        }

        // Section heading lines themselves (e.g. "5.2 Radiated Emissions...")
        // are never measurement data rows, and their leading clause numbers
        // (e.g. "5.2") can otherwise be misread as a frequency. Skip them.
        if (sec) continue;

        // Narrative exceedance sentences were already handled above at the
        // page level (they can wrap across multiple reconstructed rows, so
        // they can't be reliably parsed one row at a time). Running them
        // through the generic table parser too would produce nonsense
        // (e.g. mistaking the end of a swept range for the measurement
        // frequency). Metadata label lines (Settings/Antenna/File/...) are
        // never measurement rows either.
        if (/\bexceeded\b/i.test(row.text) || PROSE_LABEL_RE.test(row.text.trim())) continue;

        const parsed = parseRow(row.text, { section: currentSection && currentSection.key });
        if (!parsed) {
          // Only count as "unmatched" if the line at least contains a digit,
          // to avoid flooding the debug view with prose/header lines.
          if (/\d/.test(row.text)) {
            unmatchedCount++;
            if (sampleUnmatched.length < 200) sampleUnmatched.push({ page: row.page, text: row.text });
          }
          continue;
        }

        parsed.page = row.page;
        parsed.section = currentSection ? currentSection.label : "Unclassified";
        parsed.sectionKey = currentSection ? currentSection.key : null;
        parsed.kind = "emission";
        parsed.marginal =
          parsed.exceed === false &&
          parsed.computedMargin !== null &&
          parsed.computedMargin <= marginalThresholdDb;
        parsed.testId = context.testId;
        parsed.fileRef = context.fileRef;
        parsed.antenna = context.antenna;

        results.push(parsed);
      }
    }

    return {
      results,
      testSummary,
      standardsSeen: Array.from(standardsSeen),
      unmatchedCount,
      sampleUnmatched,
    };
  }

  return {
    SECTION_PATTERNS,
    detectSection,
    detectStandardRefs,
    extractPageContext,
    extractNarrativeExceedances,
    extractImmunityResults,
    extractTestSummaryRow,
    normalizeVerdict,
    formatTestCode,
    parseRow,
    analyzeRows,
  };
});
