/**
 * jlrLimits.js — reference limit-line data extracted directly from
 * JLR-EMC-CS v1.0 Amendment 4 (30th November 2013), Tables 7-1, 7-2 and 8-2:
 *   - Table 7-1: RE 310 Level 1 Requirements (section 7, page 23)
 *   - Table 7-2: RE 310 Level 2 Requirements (section 7, page 24)
 *   - Table 8-2: CE 420 Conducted Emissions Requirements (section 8, page 26)
 *
 * Numbers were extracted from the PDF using word-position (x/y coordinate)
 * table reconstruction rather than plain text extraction, specifically to
 * avoid the column-misalignment failure mode (values shifting into the
 * wrong PK/AV/QP column) that plain text extraction is prone to on this
 * kind of multi-column table.
 *
 * This is used purely as a CROSS-CHECK reference: for a measurement at a
 * given frequency, it shows what JLR-EMC-CS v1.0 Amendment 4 actually
 * requires at that point (band ID, detector, limit) next to whatever the
 * report itself stated, so a mismatch (misread report value, wrong
 * customer limit line, transcription error, superseded standard revision,
 * etc.) is visible at a glance. It does NOT replace the report's own
 * pass/fail determination, and it only applies to RE 310 / CE 420 —
 * reports assessed against a different OEM standard or a different
 * revision of JLR-EMC-CS may legitimately show different numbers.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.JlrLimits = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---- Table 7-1: RE 310 Level 1 Requirements ("latest international
  // standards" — broad frequency-sweep floor, applies everywhere) --------
  const RE310_LEVEL1 = [
    {
      id: "R-01", table: "7-1", desc: "RoW requirements", freqLow: 0.01, freqHigh: 0.1,
      detectors: { PK: { bwKHz: 1, fn: (f) => 95 - 23 * Math.log10(f / 0.01) } },
    },
    {
      id: "R-02", table: "7-1", desc: "RoW requirements", freqLow: 0.1, freqHigh: 1,
      detectors: { PK: { bwKHz: 9, fn: () => 72 } },
    },
    {
      id: "R-03", table: "7-1", desc: "RoW requirements", freqLow: 1, freqHigh: 10,
      detectors: { PK: { bwKHz: 9, fn: (f) => 72 - 22 * Math.log10(f) } },
    },
    {
      id: "R-04", table: "7-1", desc: "RoW requirements", freqLow: 10, freqHigh: 30,
      detectors: { PK: { bwKHz: 9, fn: () => 50 } },
    },
    {
      id: "M-01", table: "7-1", desc: "ECE REG 10 requirements", freqLow: 30, freqHigh: 75,
      detectors: {
        AV: { bwKHz: 120, fn: (f) => 52 - 25.13 * Math.log10(f / 30) },
        QP: { bwKHz: 120, fn: (f) => 62 - 25.13 * Math.log10(f / 30) },
      },
    },
    {
      id: "M-02", table: "7-1", desc: "ECE REG 10 requirements", freqLow: 75, freqHigh: 400,
      detectors: {
        AV: { bwKHz: 120, fn: (f) => 42 + 15.13 * Math.log10(f / 75) },
        QP: { bwKHz: 120, fn: (f) => 52 + 15.13 * Math.log10(f / 75) },
      },
    },
    {
      id: "M-03", table: "7-1", desc: "ECE REG 10 requirements", freqLow: 400, freqHigh: 1000,
      detectors: { AV: { bwKHz: 120, fn: () => 53 }, QP: { bwKHz: 120, fn: () => 63 } },
    },
  ];

  // ---- Table 7-2: RE 310 Level 2 Requirements ("specific customer
  // requirements" — named service bands) ---------------------------------
  const RE310_LEVEL2 = [
    { id: "BS-01", table: "7-2", desc: "LW Broadcast", freqLow: 0.15, freqHigh: 0.28, detectors: { AV: { bwKHz: 9, fn: () => 36 }, QP: { bwKHz: 9, fn: () => 43 } } },
    { id: "BS-02", table: "7-2", desc: "MW Broadcast", freqLow: 0.53, freqHigh: 1.7, detectors: { AV: { bwKHz: 9, fn: () => 12 }, QP: { bwKHz: 9, fn: () => 30 } } },
    { id: "BS-03", table: "7-2", desc: "SW Broadcast", freqLow: 1.7, freqHigh: 30, detectors: { AV: { bwKHz: 9, fn: () => 12 }, QP: { bwKHz: 9, fn: () => 24 } } },
    { id: "BS-04", table: "7-2", desc: "FM 1 Broadcast", freqLow: 75, freqHigh: 91, detectors: { PK: { bwKHz: 9, fn: () => 18 }, AV: { bwKHz: 9, fn: () => 12 }, QP: { bwKHz: 120, fn: () => 24 } } },
    { id: "BS-05", table: "7-2", desc: "FM 2 Broadcast", freqLow: 86, freqHigh: 109, detectors: { PK: { bwKHz: 9, fn: () => 18 }, AV: { bwKHz: 9, fn: () => 12 }, QP: { bwKHz: 120, fn: () => 24 } } },
    { id: "DB-01", table: "7-2", desc: "DAB III / TV Band III", freqLow: 167, freqHigh: 245, detectors: { PK: { bwKHz: 1000, fn: () => 32 }, AV: { bwKHz: 1000, fn: () => 22 } } },
    { id: "DB-02", table: "7-2", desc: "TV Band IV/V", freqLow: 470, freqHigh: 890, detectors: { PK: { bwKHz: 1000, fn: () => 38 }, AV: { bwKHz: 1000, fn: () => 28 } } },
    { id: "DB-03", table: "7-2", desc: "DAB L Band", freqLow: 1447, freqHigh: 1494, detectors: { PK: { bwKHz: 1000, fn: () => 46 }, AV: { bwKHz: 1000, fn: () => 36 } } },
    { id: "DB-04", table: "7-2", desc: "SDARS", freqLow: 2320, freqHigh: 2345, detectors: { PK: { bwKHz: 1000, fn: () => 46 }, AV: { bwKHz: 1000, fn: () => 36 } } },
    { id: "MS-01", table: "7-2", desc: "4m Mobile", freqLow: 65, freqHigh: 88, detectors: { PK: { bwKHz: 9, fn: () => 18 }, AV: { bwKHz: 9, fn: () => 12 }, QP: { bwKHz: 120, fn: () => 24 } } },
    { id: "MS-02", table: "7-2", desc: "2m Mobile", freqLow: 140, freqHigh: 176, detectors: { PK: { bwKHz: 9, fn: () => 18 }, AV: { bwKHz: 9, fn: () => 12 }, QP: { bwKHz: 120, fn: () => 24 } } },
    { id: "MS-03", table: "7-2", desc: "RKE & TPMS 1", freqLow: 310, freqHigh: 320, detectors: { PK: { bwKHz: 9, fn: () => 20 }, AV: { bwKHz: 9, fn: () => 14 } } },
    { id: "MS-04", table: "7-2", desc: "TETRA", freqLow: 380, freqHigh: 424, detectors: { PK: { bwKHz: 9, fn: () => 25 }, AV: { bwKHz: 9, fn: () => 19 } } },
    { id: "MS-05", table: "7-2", desc: "RKE & TPMS 2", freqLow: 425, freqHigh: 439, detectors: { PK: { bwKHz: 9, fn: () => 25 }, AV: { bwKHz: 9, fn: () => 19 } } },
    { id: "MS-06", table: "7-2", desc: "Police (Europe)", freqLow: 440, freqHigh: 470, detectors: { PK: { bwKHz: 9, fn: () => 25 }, AV: { bwKHz: 9, fn: () => 19 } } },
    { id: "MS-07", table: "7-2", desc: "RKE", freqLow: 868, freqHigh: 870, detectors: { PK: { bwKHz: 9, fn: () => 30 }, AV: { bwKHz: 9, fn: () => 24 } } },
    { id: "MS-08", table: "7-2", desc: "RKE", freqLow: 902, freqHigh: 904, detectors: { PK: { bwKHz: 9, fn: () => 30 }, AV: { bwKHz: 9, fn: () => 24 } } },
    { id: "MS-09", table: "7-2", desc: "4G", freqLow: 703, freqHigh: 821, detectors: { PK: { bwKHz: 1000, fn: () => 46 }, AV: { bwKHz: 1000, fn: () => 36 } } },
    { id: "MS-10", table: "7-2", desc: "GSM 850", freqLow: 859, freqHigh: 895, detectors: { PK: { bwKHz: 120, fn: () => 32 }, AV: { bwKHz: 120, fn: () => 12 } } },
    { id: "MS-11", table: "7-2", desc: "GSM 900", freqLow: 915, freqHigh: 960, detectors: { PK: { bwKHz: 120, fn: () => 32 }, AV: { bwKHz: 120, fn: () => 12 } } },
    { id: "MS-12", table: "7-2", desc: "GPS", freqLow: 1567, freqHigh: 1583, detectors: { AV: { bwKHz: 9, fn: () => 10 } } },
    { id: "MS-13", table: "7-2", desc: "GLONASS GPS", freqLow: 1585, freqHigh: 1616, detectors: { AV: { bwKHz: 9, fn: () => 10 } } },
    { id: "MS-14", table: "7-2", desc: "GSM 1800", freqLow: 1805, freqHigh: 1880, detectors: { PK: { bwKHz: 120, fn: () => 34 }, AV: { bwKHz: 120, fn: () => 14 } } },
    { id: "MS-15", table: "7-2", desc: "GSM 1900", freqLow: 1930, freqHigh: 1995, detectors: { PK: { bwKHz: 120, fn: () => 34 }, AV: { bwKHz: 120, fn: () => 14 } } },
    { id: "MS-16", table: "7-2", desc: "3G", freqLow: 1900, freqHigh: 2170, detectors: { PK: { bwKHz: 1000, fn: () => 46 }, AV: { bwKHz: 1000, fn: () => 36 } } },
    { id: "MS-17", table: "7-2", desc: "WiFi and Bluetooth", freqLow: 2400, freqHigh: 2500, detectors: { PK: { bwKHz: 1000, fn: () => 46 }, AV: { bwKHz: 1000, fn: () => 36 } } },
    { id: "MS-18", table: "7-2", desc: "4G", freqLow: 2496, freqHigh: 2690, detectors: { PK: { bwKHz: 1000, fn: () => 46 }, AV: { bwKHz: 1000, fn: () => 36 } } },
    { id: "MS-19", table: "7-2", desc: "WiFi", freqLow: 4915, freqHigh: 5825, detectors: { PK: { bwKHz: 1000, fn: () => 56 }, AV: { bwKHz: 1000, fn: () => 46 } } },
    { id: "MS-20", table: "7-2", desc: "ITS", freqLow: 5875, freqHigh: 5905, detectors: { PK: { bwKHz: 1000, fn: () => 56 }, AV: { bwKHz: 1000, fn: () => 46 } } },
  ];

  // ---- Table 8-2: CE 420 Conducted Emissions Requirements (Current
  // Probe Method, dBµA) ---------------------------------------------------
  const CE420_LEVEL = [
    { id: "CE420-LW", table: "8-2", desc: "Long Wave (LW)", freqLow: 0.15, freqHigh: 0.28, detectors: { AV: { bwKHz: 9, fn: () => 30 }, QP: { bwKHz: 9, fn: () => 37 } } },
    { id: "CE420-AM", table: "8-2", desc: "Medium Wave (AM)", freqLow: 0.53, freqHigh: 1.7, detectors: { AV: { bwKHz: 9, fn: () => 6 }, QP: { bwKHz: 9, fn: () => 13 } } },
    { id: "CE420-SW", table: "8-2", desc: "Short Wave (SW)", freqLow: 1.7, freqHigh: 30, detectors: { AV: { bwKHz: 9, fn: () => -1 }, QP: { bwKHz: 9, fn: () => 6 } } },
    { id: "CE420-FM1", table: "8-2", desc: "FM 1", freqLow: 75, freqHigh: 91, detectors: { AV: { bwKHz: 120, fn: () => -22 }, QP: { bwKHz: 120, fn: () => -15 } } },
    { id: "CE420-FM2", table: "8-2", desc: "FM 2", freqLow: 86, freqHigh: 109, detectors: { AV: { bwKHz: 120, fn: () => -22 }, QP: { bwKHz: 120, fn: () => -15 } } },
    { id: "CE420-DAB", table: "8-2", desc: "DAB", freqLow: 167, freqHigh: 242, detectors: { AV: { bwKHz: 120, fn: () => -22 }, QP: { bwKHz: 120, fn: () => -15 } } },
  ];

  const UNIT = { RE310: "dBµV/m", CE420: "dBµA" };

  function normalizeDetector(raw) {
    const d = (raw || "").toUpperCase().trim();
    if (/^(PK|PEAK)$/.test(d)) return "PK";
    if (/^(AV|AVG|AVERAGE)$/.test(d)) return "AV";
    if (/^(QP|CISPR-?QP|QUASI-?PEAK)$/.test(d)) return "QP";
    return null;
  }

  // Maps a report section label (see parser.js SECTION_PATTERNS) to the
  // JLR-EMC-CS test this cross-check applies to. Returns null for sections
  // this dataset doesn't cover.
  function testTypeForSection(sectionLabel) {
    if (!sectionLabel) return null;
    if (/radiated\s+emissions/i.test(sectionLabel)) return "RE310";
    if (/conducted\s+emissions/i.test(sectionLabel)) return "CE420";
    return null;
  }

  // Returns every JLR-EMC-CS band whose frequency range contains freqMHz,
  // each with all of its detector limit(s) evaluated at that exact
  // frequency, plus which detector (if any) matches the report's own
  // reported detector.
  function lookup(testType, freqMHz, detectorRaw) {
    if (freqMHz === null || freqMHz === undefined || Number.isNaN(freqMHz)) return [];
    let table;
    if (testType === "RE310") table = RE310_LEVEL1.concat(RE310_LEVEL2);
    else if (testType === "CE420") table = CE420_LEVEL;
    else return [];

    const det = normalizeDetector(detectorRaw);
    const matches = table.filter((b) => freqMHz >= b.freqLow && freqMHz <= b.freqHigh);

    return matches.map((b) => {
      const entries = Object.keys(b.detectors).map((dk) => ({
        detector: dk,
        limit: round2(b.detectors[dk].fn(freqMHz)),
        bwKHz: b.detectors[dk].bwKHz,
        matchesReportDetector: dk === det,
      }));
      return {
        id: b.id,
        table: b.table,
        desc: b.desc,
        freqLow: b.freqLow,
        freqHigh: b.freqHigh,
        unit: UNIT[testType],
        entries,
      };
    });
  }

  return { RE310_LEVEL1, RE310_LEVEL2, CE420_LEVEL, lookup, normalizeDetector, testTypeForSection };
});
