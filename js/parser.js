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
    { key: "radiated_emissions", label: "Radiated Emissions", re: /radiated\s+emissions?/i },
    { key: "conducted_emissions", label: "Conducted Emissions", re: /conducted\s+emissions?/i },
    { key: "harmonics", label: "Harmonic Current Emissions", re: /harmonic\s+current/i },
    { key: "flicker", label: "Voltage Fluctuations / Flicker", re: /voltage\s+fluctuations?|flicker/i },
    { key: "radiated_immunity", label: "Radiated RF Immunity", re: /radiated\s+(rf\s+)?immunity/i },
    { key: "conducted_immunity", label: "Conducted RF Immunity", re: /conducted\s+(rf\s+)?immunity/i },
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
   */
  function analyzeRows(rows, opts) {
    opts = opts || {};
    const marginalThresholdDb = opts.marginalThresholdDb ?? 3;

    let currentSection = null;
    const standardsSeen = new Set();
    const results = [];
    let unmatchedCount = 0;
    const sampleUnmatched = [];

    for (const row of rows) {
      const sec = detectSection(row.text);
      if (sec) currentSection = sec;

      for (const s of detectStandardRefs(row.text)) standardsSeen.add(s);

      // Section heading lines themselves (e.g. "5.2 Radiated Emissions...")
      // are never measurement data rows, and their leading clause numbers
      // (e.g. "5.2") can otherwise be misread as a frequency. Skip them.
      if (sec) continue;

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
      parsed.marginal =
        parsed.exceed === false &&
        parsed.computedMargin !== null &&
        parsed.computedMargin <= marginalThresholdDb;

      results.push(parsed);
    }

    return {
      results,
      standardsSeen: Array.from(standardsSeen),
      unmatchedCount,
      sampleUnmatched,
    };
  }

  return {
    SECTION_PATTERNS,
    detectSection,
    detectStandardRefs,
    parseRow,
    analyzeRows,
  };
});
