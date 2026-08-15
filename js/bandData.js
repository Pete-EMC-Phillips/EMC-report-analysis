/**
 * bandData.js
 *
 * Reference table of common radio service frequency bands, used to annotate
 * EMC emissions test failures/marginal results with the radio service that
 * could plausibly be affected (e.g. "this radiated emissions failure at
 * 2440 MHz falls inside the Wi-Fi / Bluetooth 2.4 GHz ISM band").
 *
 * IMPORTANT / DISCLAIMER
 * -----------------------
 * These ranges are indicative, commonly-used allocations only (a mix of
 * ITU / FCC / ETSI style assignments). Exact band edges, guard bands and
 * licensing vary by country and regulator, and change over time. This table
 * is NOT a substitute for checking the applicable national frequency
 * allocation table (e.g. Ofcom UK FAT, FCC Table of Frequency Allocations,
 * ECA Table) for your product's target markets. Edit this file freely to
 * add/remove/correct bands relevant to your product and region.
 *
 * All frequencies are stored in MHz.
 */

const RADIO_BANDS = [
  { name: "LW/MW AM Broadcast",              low: 0.1485,   high: 1.705 },
  { name: "Shortwave Broadcast",              low: 2.3,      high: 26.1 },
  { name: "CB Radio (27 MHz)",                low: 26.965,   high: 27.405 },
  { name: "VHF Low Band Land Mobile",         low: 30,       high: 50 },
  { name: "VHF Amateur (6 m)",                low: 50,       high: 54 },
  { name: "VHF Band I / Low-band Land Mobile (region-dependent: old analog TV, OIRT FM, PMR)", low: 47, high: 87.5 },
  { name: "OIRT FM Broadcast (E. Europe/Russia)", low: 65.9, high: 74 },
  { name: "315 MHz ISM (Automotive RKE, N. America)", low: 314, high: 316 },
  { name: "VHF Amateur (2 m)",                low: 144,      high: 148 },
  { name: "FM Broadcast",                     low: 87.5,     high: 108 },
  { name: "VHF Air Band (COM/NAV)",           low: 108,      high: 137 },
  { name: "VHF Land Mobile / PMR",            low: 137,      high: 174 },
  { name: "VHF TV Broadcast (Band I/III)",    low: 174,      high: 230 },
  { name: "DAB Digital Radio (Band III)",     low: 174.9,    high: 239.2 },
  { name: "UHF Amateur (70 cm)",              low: 430,      high: 440 },
  { name: "UHF Land Mobile / PMR446",         low: 406,      high: 470 },
  { name: "UHF TV Broadcast",                 low: 470,      high: 694 },
  { name: "GSM 900 Uplink",                   low: 880,      high: 915 },
  { name: "GSM 900 Downlink",                 low: 925,      high: 960 },
  { name: "ISM 915 MHz (Region 2)",           low: 902,      high: 928 },
  { name: "GSM 1800 / DCS Uplink",            low: 1710,     high: 1785 },
  { name: "GSM 1800 / DCS Downlink",          low: 1805,     high: 1880 },
  { name: "DECT Cordless Phones",             low: 1880,     high: 1900 },
  { name: "GPS L2",                           low: 1226.6,   high: 1227.6 },
  { name: "GPS L1",                           low: 1574.42,  high: 1576.42 },
  { name: "3G / UMTS (2100 Band)",            low: 1920,     high: 2170 },
  { name: "Bluetooth / Wi-Fi 2.4 GHz ISM",    low: 2400,     high: 2483.5 },
  { name: "LTE Band 7 (2600)",                low: 2500,     high: 2690 },
  { name: "5 GHz ISM (microwave ovens etc.)", low: 5725,     high: 5875 },
  { name: "Wi-Fi 5 GHz (U-NII)",              low: 5150,     high: 5875 },
  { name: "5G NR n78 (3.5 GHz)",              low: 3400,     high: 3800 },
  { name: "Radar / Satellite (C-band)",       low: 3700,     high: 4200 },
  { name: "Wi-Fi 6E (6 GHz)",                 low: 5925,     high: 7125 },
];

/**
 * Return the radio band(s) that a given frequency (MHz) falls within.
 * A frequency may match zero, one, or (rarely, for overlapping allocations
 * like Wi-Fi 5GHz sitting inside a wider ISM range) more than one band.
 */
function classifyFrequencyMHz(freqMHz) {
  if (typeof freqMHz !== "number" || isNaN(freqMHz)) return [];
  return RADIO_BANDS.filter((b) => freqMHz >= b.low && freqMHz <= b.high).map(
    (b) => b.name
  );
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { RADIO_BANDS, classifyFrequencyMHz };
}
