/**
 * app.js — UI glue code for the EMC Test Report Analyzer.
 * Wires together pdfExtract.js (text extraction), parser.js (row parsing),
 * bandData.js (radio band classification) and renders results into the DOM.
 */
(function () {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const state = {
    fileName: null,
    totalPages: 0,
    rawRows: [],
    analysis: null,
    allResultsPage: 0,
    allResultsPageSize: 100,
    chart: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---- File input / drag & drop -----------------------------------------

  const dropZone = $("#drop-zone");
  const fileInput = $("#file-input");

  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove("dragover");
    })
  );
  dropZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  $("#new-file-btn").addEventListener("click", () => {
    $("#results-section").hidden = true;
    $("#file-summary").hidden = true;
    fileInput.value = "";
  });

  $("#reanalyze-btn").addEventListener("click", () => {
    if (state.rawRows.length) runAnalysis();
  });

  // ---- Main pipeline ------------------------------------------------------

  async function handleFile(file) {
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      alert("Please choose a PDF file.");
      return;
    }
    state.fileName = file.name;
    $("#progress-area").hidden = false;
    $("#file-summary").hidden = true;
    $("#results-section").hidden = true;
    setProgress(0, "Reading file…");

    try {
      const arrayBuffer = await file.arrayBuffer();
      const { totalPages, rows } = await PdfExtract.extractRows(arrayBuffer, {
        onProgress: ({ page, totalPages }) => {
          const pct = Math.round((page / totalPages) * 100);
          setProgress(pct, `Extracting text — page ${page} of ${totalPages}`);
        },
      });
      state.totalPages = totalPages;
      state.rawRows = rows;

      setProgress(100, `Extracted ${rows.length.toLocaleString()} text rows from ${totalPages.toLocaleString()} pages.`);
      $("#progress-area").hidden = true;
      $("#file-summary").hidden = false;
      $("#file-summary").textContent = `${file.name} — ${totalPages.toLocaleString()} pages, ${rows.length.toLocaleString()} text rows extracted.`;

      runAnalysis();
    } catch (err) {
      console.error(err);
      setProgress(0, "Error: " + err.message);
    }
  }

  function setProgress(pct, text) {
    $("#progress-bar-fill").style.width = pct + "%";
    $("#progress-text").textContent = text;
  }

  function runAnalysis() {
    const marginalThresholdDb = parseFloat($("#marginal-threshold").value) || 0;
    state.analysis = EmcParser.analyzeRows(state.rawRows, { marginalThresholdDb });
    state.allResultsPage = 0;
    $("#results-section").hidden = false;

    // Each render step runs independently: if one throws (e.g. a charting
    // library failed to load), the others must still run so results from a
    // previous file never get left stuck on screen.
    const steps = [
      ["overview", renderOverview],
      ["failures", renderFailures],
      ["band summary", renderBandSummary],
      ["immunity", renderImmunity],
      ["all results", renderAllResults],
      ["debug", renderDebug],
    ];
    for (const [name, fn] of steps) {
      try {
        fn();
      } catch (err) {
        console.error(`Failed to render "${name}" tab:`, err);
      }
    }
  }

  // ---- Tabs -----------------------------------------------------------

  $$(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".tab-btn").forEach((b) => b.classList.remove("active"));
      $$(".tab-panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      $("#tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // ---- Rendering: Overview ----------------------------------------------

  function renderOverview() {
    const results = state.analysis.results.filter((r) => r.kind === "emission");
    const fails = results.filter((r) => r.exceed === true);
    const marginal = results.filter((r) => r.marginal);
    const passes = results.filter((r) => r.exceed === false && !r.marginal);
    const unknown = results.filter((r) => r.exceed === null);
    const re310Fails = fails.filter((r) => JlrLimits.testTypeForSection(r.section) === "RE310");
    const ce420Fails = fails.filter((r) => JlrLimits.testTypeForSection(r.section) === "CE420");

    const statBox = (label, value, cls) =>
      `<div class="stat-box ${cls || ""}"><div class="value">${value}</div><div class="label">${label}</div></div>`;

    $("#overview-stats").innerHTML =
      statBox("Pages analyzed", state.totalPages) +
      statBox("Emissions data rows found", results.length) +
      statBox("RE 310 failures", re310Fails.length, re310Fails.length ? "fail" : "pass") +
      statBox("CE 420 failures", ce420Fails.length, ce420Fails.length ? "fail" : "pass") +
      statBox("Marginal (near limit)", marginal.length, "marginal") +
      statBox("Emissions pass", passes.length, "pass") +
      statBox("Unclear result", unknown.length);

    const standardsEl = $("#standards-seen");
    let html = state.analysis.standardsSeen.length
      ? `<p><strong>Standards / classes referenced in report:</strong> ${state.analysis.standardsSeen.join(", ")}</p>`
      : `<p class="hint">No explicit standard references (e.g. CISPR 32, EN 55032, FCC Part 15) were detected in the text.</p>`;

    const summary = state.analysis.testSummary;
    if (summary.length) {
      const failedCats = summary.filter((s) => s.status === "fail");
      html += `<p><strong>Immunity/overall test category dashboard found:</strong> ${summary.length} categories, ${failedCats.length} showing Deviation/Fail. See the Immunity tab for details.${
        failedCats.length ? " Failing: " + failedCats.map((s) => s.code).join(", ") : ""
      }</p>`;
    }

    const imageOnly = state.analysis.imageOnlyTables || [];
    if (imageOnly.length) {
      html += `<p class="jlr-mismatch">&#9888; ${imageOnly.length} page${imageOnly.length === 1 ? "" : "s"} contain a results table this tool couldn't read (likely embedded as an image rather than text): ${imageOnly
        .map((t) => `p.${t.page} (${escapeHtml(t.testCode)})`)
        .join(", ")}. Check these pages directly in the source PDF - see the Debug tab for details.</p>`;
    }

    standardsEl.innerHTML = html;

    renderBandChart(fails);
  }

  function renderBandChart(fails) {
    const bandCounts = {};
    for (const f of fails) {
      const bands = classifyFrequencyMHz(f.frequencyMHz);
      const names = bands.length ? bands : ["Unclassified frequency"];
      for (const n of names) bandCounts[n] = (bandCounts[n] || 0) + 1;
    }
    const entries = Object.entries(bandCounts).sort((a, b) => b[1] - a[1]).slice(0, 15);

    if (typeof Chart === "undefined") {
      // Chart.js didn't load (e.g. CDN blocked on this network). Fall back
      // to a plain text list so the rest of the app still works fully.
      const canvas = $("#band-chart");
      const fallback = document.createElement("div");
      fallback.className = "hint";
      fallback.textContent = entries.length
        ? "Chart library unavailable — failures by band: " +
          entries.map(([name, count]) => `${name} (${count})`).join(", ")
        : "Chart library unavailable.";
      canvas.replaceWith(fallback);
      fallback.id = "band-chart-fallback";
      return;
    }

    const chartTarget = $("#band-chart") || $("#band-chart-fallback");
    if (!chartTarget || chartTarget.tagName !== "CANVAS") return;
    const ctx = chartTarget.getContext("2d");
    if (state.chart) state.chart.destroy();
    if (entries.length === 0) {
      state.chart = null;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      return;
    }
    state.chart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: entries.map((e) => e[0]),
        datasets: [{ label: "Failures over limit", data: entries.map((e) => e[1]), backgroundColor: "#c0392b" }],
      },
      options: {
        indexAxis: "y",
        plugins: { legend: { display: false }, title: { display: true, text: "Failures by radio band" } },
        scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    });
  }

  // ---- Rendering: Failures ------------------------------------------------

  function bandLabel(freqMHz) {
    const bands = classifyFrequencyMHz(freqMHz);
    return bands.length ? bands.join(", ") : "—";
  }

  function fmtFreq(mhz) {
    if (mhz >= 1000) return (mhz / 1000).toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " GHz";
    return mhz.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") + " MHz";
  }

  function resultBadge(r) {
    if (r.exceed === true) return '<span class="badge fail">FAIL</span>';
    if (r.marginal) return '<span class="badge marginal">MARGINAL</span>';
    if (r.exceed === false) return '<span class="badge pass">PASS</span>';
    return '<span class="badge">?</span>';
  }

  function testFileLabel(r) {
    const parts = [];
    if (r.testId) parts.push("Test " + r.testId);
    if (r.fileRef) parts.push(r.fileRef);
    if (r.antenna) parts.push(r.antenna);
    return parts.join(" · ") || "—";
  }

  // ---- JLR-EMC-CS RE310/CE420 cross-check ---------------------------------

  // Returns { html, csvBand, csvLimit, csvDiff } for the JLR-EMC-CS column:
  // which standard band(s) this frequency falls in, their limit(s), and
  // whether the report's own stated limit (r.limit) disagrees with the
  // standard by more than a small rounding tolerance.
  function jlrCrossCheck(r) {
    const testType = JlrLimits.testTypeForSection(r.section);
    if (!testType) return { html: '<span class="hint">—</span>', csvBand: "", csvLimit: "", csvDiff: "" };

    const matches = JlrLimits.lookup(testType, r.frequencyMHz, r.detector);
    if (!matches.length) {
      return { html: '<span class="hint">no JLR-EMC-CS band</span>', csvBand: "", csvLimit: "", csvDiff: "" };
    }

    const TOL_DB = 0.5;
    let anyMismatch = false;
    const csvParts = [];
    const csvLimits = [];
    const diffs = [];

    const partsHtml = matches.map((band) => {
      csvParts.push(band.id);
      const entriesHtml = band.entries
        .map((e) => {
          csvLimits.push(`${e.detector} ${e.limit}`);
          let cls = e.matchesReportDetector ? "jlr-matched-detector" : "";
          let extra = "";
          if (e.matchesReportDetector && typeof r.limit === "number") {
            const diff = round1(r.limit - e.limit);
            diffs.push(diff);
            if (Math.abs(diff) > TOL_DB) {
              anyMismatch = true;
              extra = ` <span class="jlr-mismatch" title="Report states ${r.limit} ${band.unit}, standard says ${e.limit} ${band.unit} at this frequency">⚠ report ${r.limit} vs std ${e.limit}</span>`;
            }
          }
          return `<span class="${cls}">${e.detector} ${e.limit}</span>${extra}`;
        })
        .join(" · ");
      return `<strong>${escapeHtml(band.id)}</strong> <span class="hint">${escapeHtml(band.desc)}</span><br>${entriesHtml}`;
    });

    return {
      html: partsHtml.join('<hr class="jlr-band-sep">'),
      csvBand: csvParts.join("; "),
      csvLimit: csvLimits.join("; "),
      csvDiff: diffs.length ? diffs.join("; ") : "",
      mismatch: anyMismatch,
    };
  }

  function round1(n) {
    return Math.round(n * 10) / 10;
  }

  // Classifies an imageOnlyTables entry's testCode ("RE 310", "CE 420",
  // "RE 320", ...) into the same RE310/CE420/OTHER buckets used elsewhere,
  // so "this test's table was an unreadable image" warnings can be shown
  // right alongside that test's results.
  function classifyTestCode(testCode) {
    const t = (testCode || "").replace(/\s+/g, "").toUpperCase();
    if (t.startsWith("RE310")) return "RE310";
    if (t.startsWith("CE420")) return "CE420";
    return "OTHER";
  }

  function imageOnlyForTestType(testType) {
    const all = (state.analysis && state.analysis.imageOnlyTables) || [];
    return all.filter((t) => classifyTestCode(t.testCode) === testType);
  }

  // Explicit "this data isn't readable" warning for a given test type, shown
  // inline wherever that test's results are presented - so a low/zero
  // failure count is never mistaken for a clean pass when the source table
  // was actually an unreadable embedded image.
  function imageOnlyWarningHtml(testType) {
    const entries = imageOnlyForTestType(testType);
    if (!entries.length) return "";
    const pages = entries.map((t) => `p.${t.page}`).join(", ");
    return `<p class="jlr-mismatch">&#9888; ${entries.length} page${entries.length === 1 ? "" : "s"} for this test could not be read (the results table appears to be embedded as an image, not text): ${pages}. Results shown here may be incomplete for those pages - check them directly in the source PDF.</p>`;
  }


  // Groups failures by JLR-EMC-CS test (RE310 / CE420), with anything else
  // (RE320, harmonics, flicker, or a report with no JLR section wording at
  // all) bucketed by its own section label so nothing is silently dropped.
  // Each group is sorted worst-margin-first, matching how an engineer scans
  // a report: "is this specific test OK, and if not, what's the worst
  // point?"
  function groupFailuresByTest(fails) {
    const groups = new Map(); // key -> { title, rows: [] }
    const ensure = (key, title) => {
      if (!groups.has(key)) groups.set(key, { key, title, rows: [] });
      return groups.get(key);
    };
    // Always show RE310 / CE420 groups even if empty, so it's obvious at a
    // glance which of the two main tests has a problem and which doesn't.
    ensure("RE310", "RE 310 — Radiated Emissions");
    ensure("CE420", "CE 420 — Conducted Emissions");

    for (const r of fails) {
      const testType = JlrLimits.testTypeForSection(r.section);
      const group = testType ? ensure(testType, testType === "RE310" ? "RE 310 — Radiated Emissions" : "CE 420 — Conducted Emissions") : ensure(r.section || "other", r.section || "Other");
      group.rows.push(r);
    }

    const marginOf = (r) => r.computedMargin ?? r.reportedMargin ?? 0;
    for (const g of groups.values()) g.rows.sort((a, b) => marginOf(a) - marginOf(b));

    // Order: RE310, CE420, then everything else alphabetically by title -
    // but drop any "other" group that ended up empty (only RE310/CE420 are
    // always shown regardless of count).
    const ordered = [groups.get("RE310"), groups.get("CE420")];
    const rest = Array.from(groups.values())
      .filter((g) => g.key !== "RE310" && g.key !== "CE420" && g.rows.length)
      .sort((a, b) => a.title.localeCompare(b.title));
    return ordered.concat(rest);
  }

  function failuresRowHtml(r) {
    const jlr = jlrCrossCheck(r);
    return `<tr class="row-fail">
      <td>${r.page}</td>
      <td class="wrap">${testFileLabel(r)}</td>
      <td class="wrap">${r.section}</td>
      <td>${fmtFreq(r.frequencyMHz)}</td>
      <td class="wrap">${bandLabel(r.frequencyMHz)}</td>
      <td>${r.level ?? "—"}</td>
      <td>${r.limit ?? "—"}</td>
      <td>${r.computedMargin ?? r.reportedMargin ?? "—"}</td>
      <td>${r.detector ?? "—"}</td>
      <td>${resultBadge(r)}</td>
      <td class="wrap">${jlr.html}</td>
    </tr>`;
  }

  function failuresCsvRow(r) {
    const jlr = jlrCrossCheck(r);
    return {
      page: r.page,
      test: r.testId,
      file: r.fileRef,
      antenna: r.antenna,
      section: r.section,
      frequencyMHz: r.frequencyMHz,
      band: bandLabel(r.frequencyMHz),
      level: r.level,
      limit: r.limit,
      margin: r.computedMargin ?? r.reportedMargin,
      detector: r.detector,
      result: r.result || (r.exceed ? "FAIL" : ""),
      jlrBand: jlr.csvBand,
      jlrLimit: jlr.csvLimit,
      jlrLimitDiff: jlr.csvDiff,
      raw: r.raw,
    };
  }

  const FAILURES_CSV_HEADERS = ["page", "test", "file", "antenna", "section", "frequencyMHz", "band", "level", "limit", "margin", "detector", "result", "jlrBand", "jlrLimit", "jlrLimitDiff", "raw"];

  function renderFailures() {
    const fails = state.analysis.results.filter((r) => r.kind === "emission" && r.exceed === true);
    const groups = groupFailuresByTest(fails);

    const container = $("#failures-groups");
    container.innerHTML = groups
      .map((g, i) => {
        const btnId = `export-failures-csv-${g.key}`;
        const bodyHtml = g.rows.length
          ? g.rows.map(failuresRowHtml).join("")
          : `<tr><td colspan="11" class="hint">No failures found for this test.</td></tr>`;
        const imgWarning = (g.key === "RE310" || g.key === "CE420") ? imageOnlyWarningHtml(g.key) : "";
        return `<h3${i === 0 ? ' style="margin-top:0"' : ""}>${escapeHtml(g.title)}</h3>
          ${imgWarning}
          <div class="table-toolbar">
            <span>${g.rows.length} failure${g.rows.length === 1 ? "" : "s"}${g.rows.length ? " (worst margin first)" : ""}</span>
            ${g.rows.length ? `<button id="${btnId}" class="secondary-btn">Export CSV</button>` : ""}
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr><th>Page</th><th>Test / File</th><th>Section</th><th>Frequency</th><th>Radio Band(s)</th><th>Level</th><th>Limit</th><th>Margin (dB)</th><th>Detector</th><th>Result</th><th>JLR-EMC-CS</th></tr>
              </thead>
              <tbody>${bodyHtml}</tbody>
            </table>
          </div>`;
      })
      .join("");

    // RE310/CE420 groups always render (with their own image-only warning
    // above), and other test sections only render when they have at least
    // one failure row - but a test whose table was entirely an unreadable
    // image has zero rows by definition, so it would otherwise vanish
    // silently. Add a standalone notice for any such test so it's not
    // mistaken for "no failures found" when really "couldn't be read".
    const otherImageOnlyForFailures = imageOnlyForTestType("OTHER");
    if (otherImageOnlyForFailures.length) {
      const pages = otherImageOnlyForFailures.map((t) => `p.${t.page} (${escapeHtml(t.testCode)})`).join(", ");
      container.innerHTML += `<h3>Other tests with unreadable data</h3>
        <p class="jlr-mismatch">&#9888; ${otherImageOnlyForFailures.length} page${otherImageOnlyForFailures.length === 1 ? "" : "s"} contain a results table that could not be read (embedded as an image, not text), so no failures could be extracted from them either way: ${pages}. Check these pages directly in the source PDF - a lack of failures listed here does not mean these tests passed.</p>`;
    }

    for (const g of groups) {
      if (!g.rows.length) continue;
      const btn = $(`#export-failures-csv-${g.key}`);
      if (!btn) continue;
      btn.onclick = () => {
        const safeKey = g.key.replace(/[^\w\-]+/g, "_").toLowerCase();
        CsvExport.downloadCsv(`emc_failures_${safeKey}.csv`, FAILURES_CSV_HEADERS, g.rows.map(failuresCsvRow));
      };
    }
  }

  // ---- Rendering: Band Summary --------------------------------------------

  // Find the single worst (most negative margin) record in a group, so we
  // can point straight at the page/graph it came from.
  function worstOf(entries) {
    return entries.reduce((best, r) => {
      const m = r.computedMargin ?? r.reportedMargin;
      if (m === null) return best;
      return !best || m < best.margin ? { record: r, margin: m } : best;
    }, null);
  }

  // Pure data computation (no DOM), shared by the Band Summary tab and the
  // "Export Summary" button. testType, if given ('RE310' | 'CE420'),
  // restricts to results belonging to that JLR-EMC-CS test - RE310 (field
  // strength, dBµV/m) and CE420 (current, dBµA) aren't comparable
  // measurements even when they nominally cover the same radio-service
  // band, so mixing their margins into one "worst" figure would be
  // misleading.
  function computeBandSummaryRows(includeMarginal, testType) {
    const matchesTestType = (r) => {
      if (!testType) return true;
      const t = JlrLimits.testTypeForSection(r.section);
      return testType === "OTHER" ? t === null : t === testType;
    };
    const relevant = state.analysis.results.filter(
      (r) => r.kind === "emission" && (r.exceed === true || (includeMarginal && r.marginal)) && matchesTestType(r)
    );

    const byBand = new Map(); // bandName -> entries[]
    const unclassified = [];

    for (const r of relevant) {
      const bands = classifyFrequencyMHz(r.frequencyMHz);
      if (bands.length === 0) {
        unclassified.push(r);
        continue;
      }
      for (const bandName of bands) {
        if (!byBand.has(bandName)) byBand.set(bandName, []);
        byBand.get(bandName).push(r);
      }
    }

    const sortedBands = Array.from(byBand.entries()).sort((a, b) => b[1].length - a[1].length);

    const toRow = (bandName, entries) => {
      const bandDef = RADIO_BANDS.find((b) => b.name === bandName);
      const worst = worstOf(entries);
      return {
        bandName,
        rangeLabel: bandDef ? `${bandDef.low}–${bandDef.high}` : "—",
        count: entries.length,
        worstMargin: worst ? worst.margin : null,
        worstPage: worst ? worst.record.page : null,
        worstLabel: worst ? testFileLabel(worst.record) : "",
        hasFail: entries.some((r) => r.exceed === true),
        freqs: Array.from(new Set(entries.map((r) => fmtFreq(r.frequencyMHz)))).slice(0, 8),
        pages: Array.from(new Set(entries.map((r) => r.page))).slice(0, 12),
      };
    };

    const rows = sortedBands.map(([bandName, entries]) => toRow(bandName, entries));
    if (unclassified.length) rows.push(toRow("Unclassified frequency", unclassified));
    return rows;
  }

  const BAND_SUMMARY_CSV_HEADERS = ["band", "rangeMHz", "exceedances", "worstMarginDb", "worstPage", "worstPageLabel", "frequencies", "pages"];

  function bandSummaryRowHtml(row) {
    const worstPageCell =
      row.worstPage !== null
        ? `<strong>p. ${row.worstPage}</strong>${row.worstLabel ? `<br><span class="hint">${row.worstLabel}</span>` : ""}`
        : "—";
    return `<tr class="${row.hasFail ? "row-fail" : "row-marginal"}">
      <td class="wrap">${row.bandName}</td>
      <td>${row.rangeLabel}</td>
      <td>${row.count}</td>
      <td>${row.worstMargin ?? "—"}</td>
      <td class="wrap">${worstPageCell}</td>
      <td class="wrap">${row.freqs.join(", ")}</td>
      <td class="wrap">${row.pages.join(", ")}</td>
    </tr>`;
  }

  function bandSummaryCsvRow(row) {
    return {
      band: row.bandName,
      rangeMHz: row.rangeLabel,
      exceedances: row.count,
      worstMarginDb: row.worstMargin ?? "",
      worstPage: row.worstPage ?? "",
      worstPageLabel: row.worstLabel,
      frequencies: row.freqs.join("; "),
      pages: row.pages.join("; "),
    };
  }

  function renderBandSummaryGroup(title, key, rows, testType) {
    const bodyHtml = rows.length
      ? rows.map(bandSummaryRowHtml).join("")
      : `<tr><td colspan="7" class="hint">No over-limit results found for this test.</td></tr>`;
    const imgWarning = testType ? imageOnlyWarningHtml(testType) : "";
    return `<h3>${escapeHtml(title)}</h3>
      ${imgWarning}
      <div class="table-toolbar">
        <span>${rows.length} band${rows.length === 1 ? "" : "s"} with an exceedance</span>
        ${rows.length ? `<button id="export-bands-csv-${key}" class="secondary-btn">Export CSV</button>` : ""}
      </div>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>Radio Band</th><th>Range (MHz)</th><th>Exceedances</th><th>Worst Margin (dB)</th><th>Worst Page</th><th>Frequencies</th><th>Pages</th></tr>
          </thead>
          <tbody>${bodyHtml}</tbody>
        </table>
      </div>`;
  }

  function renderBandSummary() {
    const includeMarginal = $("#include-marginal-bands").checked;
    const groups = [
      { key: "re310", title: "RE 310 — Radiated Emissions", rows: computeBandSummaryRows(includeMarginal, "RE310"), testType: "RE310" },
      { key: "ce420", title: "CE 420 — Conducted Emissions", rows: computeBandSummaryRows(includeMarginal, "CE420"), testType: "CE420" },
    ];
    // Anything outside RE310/CE420 (RE320 magnetic field emissions,
    // harmonics, flicker, or a report that doesn't use JLR-EMC-CS section
    // wording at all) still needs somewhere to show up - only add this
    // group when it actually has something, unlike RE310/CE420 which are
    // always shown so it's obvious at a glance which of the two main tests
    // is clean.
    const otherRows = computeBandSummaryRows(includeMarginal, "OTHER");
    if (otherRows.length || imageOnlyForTestType("OTHER").length)
      groups.push({ key: "other", title: "Other emissions tests", rows: otherRows, testType: "OTHER" });

    $("#bands-groups").innerHTML = groups.map((g) => renderBandSummaryGroup(g.title, g.key, g.rows, g.testType)).join("");

    for (const g of groups) {
      if (!g.rows.length) continue;
      const btn = $(`#export-bands-csv-${g.key}`);
      if (!btn) continue;
      btn.onclick = () => {
        CsvExport.downloadCsv(`emc_band_summary_${g.key}.csv`, BAND_SUMMARY_CSV_HEADERS, g.rows.map(bandSummaryCsvRow));
      };
    }
  }

  $("#include-marginal-bands").addEventListener("change", renderBandSummary);

  // ---- Rendering: All Results (paginated) --------------------------------

  function renderAllResults() {
    const results = state.analysis.results.filter((r) => r.kind === "emission");
    $("#all-count").textContent = `${results.length.toLocaleString()} rows total`;

    const start = state.allResultsPage * state.allResultsPageSize;
    const pageRows = results.slice(start, start + state.allResultsPageSize);

    $("#all-table tbody").innerHTML = pageRows
      .map((r) => {
        const jlr = jlrCrossCheck(r);
        return `<tr class="${r.exceed === true ? "row-fail" : r.marginal ? "row-marginal" : ""}">
          <td>${r.page}</td>
          <td class="wrap">${testFileLabel(r)}</td>
          <td class="wrap">${r.section}</td>
          <td>${fmtFreq(r.frequencyMHz)}</td>
          <td>${r.level ?? "—"}</td>
          <td>${r.limit ?? "—"}</td>
          <td>${r.computedMargin ?? r.reportedMargin ?? "—"}</td>
          <td>${r.detector ?? "—"}</td>
          <td>${resultBadge(r)}</td>
          <td class="wrap">${jlr.html}</td>
        </tr>`;
      })
      .join("");

    const totalPages = Math.max(1, Math.ceil(results.length / state.allResultsPageSize));
    $("#all-page-label").textContent = `Page ${state.allResultsPage + 1} of ${totalPages}`;

    $("#export-all-csv").onclick = () => {
      CsvExport.downloadCsv(
        "emc_all_results.csv",
        ["page", "test", "file", "antenna", "section", "frequencyMHz", "level", "limit", "margin", "detector", "result", "jlrBand", "jlrLimit", "jlrLimitDiff", "raw"],
        results.map((r) => {
          const jlr = jlrCrossCheck(r);
          return {
            page: r.page,
            test: r.testId,
            file: r.fileRef,
            antenna: r.antenna,
            section: r.section,
            frequencyMHz: r.frequencyMHz,
            level: r.level,
            limit: r.limit,
            margin: r.computedMargin ?? r.reportedMargin,
            detector: r.detector,
            result: r.result || (r.exceed === true ? "FAIL" : r.exceed === false ? "PASS" : ""),
            jlrBand: jlr.csvBand,
            jlrLimit: jlr.csvLimit,
            jlrLimitDiff: jlr.csvDiff,
            raw: r.raw,
          };
        })
      );
    };
  }

  $("#all-prev").addEventListener("click", () => {
    if (state.allResultsPage > 0) {
      state.allResultsPage--;
      renderAllResults();
    }
  });
  $("#all-next").addEventListener("click", () => {
    const emissionCount = state.analysis.results.filter((r) => r.kind === "emission").length;
    const totalPages = Math.max(1, Math.ceil(emissionCount / state.allResultsPageSize));
    if (state.allResultsPage < totalPages - 1) {
      state.allResultsPage++;
      renderAllResults();
    }
  });

  // ---- Rendering: Immunity -------------------------------------------------

  function immunityStatusBadge(status) {
    if (status === "fail") return '<span class="badge fail">DEVIATION / FAIL</span>';
    if (status === "pass") return '<span class="badge pass">COMPLIANT / PASS</span>';
    if (status === "skip") return '<span class="badge">NOT PERFORMED</span>';
    if (status === "info") return '<span class="badge">INFORMATIVE</span>';
    return '<span class="badge">?</span>';
  }

  // Build one row per failing test category, combining the dashboard verdict
  // (if the report has a front-matter summary table) with whatever
  // individual "Result:"/"Test result:" descriptions were found for that
  // same code, so the app shows the same "what failed and why" view as a
  // written findings report.
  function buildImmunityFailuresSummary(summary, immunity) {
    const normalize = (s) => EmcParser.formatTestCode(s || "");

    const byCode = new Map(); // normalized code -> { code, label, pages:Set, descriptions:Set }
    const ensure = (code, label) => {
      if (!byCode.has(code)) byCode.set(code, { code, label: label || code, pages: new Set(), descriptions: new Set() });
      const entry = byCode.get(code);
      if (label && (!entry.label || entry.label === entry.code)) entry.label = label;
      return entry;
    };

    for (const s of summary) {
      if (s.status !== "fail") continue;
      const code = normalize(s.code);
      ensure(code, s.label);
    }
    for (const r of immunity) {
      if (r.status !== "fail" || !r.section) continue;
      const code = normalize(r.section);
      // Only include codes not already known to be a dashboard failure if
      // there's no dashboard at all (otherwise a stray individual note
      // under a category the dashboard says passed would be misleading).
      if (summary.length && !byCode.has(code)) continue;
      const entry = ensure(code);
      entry.pages.add(r.page);
      if (r.description) entry.descriptions.add(r.description);
    }

    return Array.from(byCode.values())
      .map((e) => ({
        code: e.code,
        label: e.label.replace(/[:\-\s]+$/, "").trim(),
        pages: Array.from(e.pages).sort((a, b) => a - b),
        description: Array.from(e.descriptions).slice(0, 3).join(" | ") || "See source pages for details.",
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  function renderImmunity() {
    const summary = state.analysis.testSummary || [];
    const immunityAll = state.analysis.results.filter((r) => r.kind === "immunity");
    const failuresSummary = buildImmunityFailuresSummary(summary, immunityAll);

    $("#immunity-summary-count").textContent = `${failuresSummary.length} failing test categor${failuresSummary.length === 1 ? "y" : "ies"}`;
    $("#immunity-summary-table tbody").innerHTML =
      failuresSummary
        .map(
          (f) => `<tr class="row-fail">
            <td>${escapeHtml(f.code)}</td>
            <td class="wrap">${escapeHtml(f.label)}</td>
            <td>${immunityStatusBadge("fail")}</td>
            <td class="wrap">${escapeHtml(f.description)}</td>
            <td class="wrap">${f.pages.join(", ") || "—"}</td>
          </tr>`
        )
        .join("") || `<tr><td colspan="5">No immunity failures (Deviation/Fail) detected.</td></tr>`;

    $("#export-immunity-summary-csv").onclick = () => {
      CsvExport.downloadCsv(
        "emc_immunity_failures_summary.csv",
        ["code", "category", "result", "keyFinding", "pages"],
        failuresSummary.map((f) => ({
          code: f.code,
          category: f.label,
          result: "Deviation / Fail",
          keyFinding: f.description,
          pages: f.pages.join(", "),
        }))
      );
    };

    $("#test-summary-table tbody").innerHTML =
      summary
        .map(
          (s) => `<tr class="${s.status === "fail" ? "row-fail" : ""}">
            <td>${escapeHtml(s.code)}</td>
            <td class="wrap">${escapeHtml(s.label)}</td>
            <td>${immunityStatusBadge(s.status)}</td>
            <td>${s.page}</td>
          </tr>`
        )
        .join("") || `<tr><td colspan="4">No front-matter test summary table detected in this report.</td></tr>`;

    const immunity = immunityAll;
    $("#immunity-count").textContent = `${immunity.length} immunity result note${immunity.length === 1 ? "" : "s"} found (${
      immunity.filter((r) => r.status === "fail").length
    } deviation/fail)`;

    $("#immunity-table tbody").innerHTML =
      immunity
        .map(
          (r) => `<tr class="${r.status === "fail" ? "row-fail" : ""}">
            <td>${r.page}</td>
            <td class="wrap">${testFileLabel(r)}</td>
            <td class="wrap">${escapeHtml(r.section || "—")}</td>
            <td>${immunityStatusBadge(r.status)}</td>
            <td class="wrap">${escapeHtml(r.description || "—")}</td>
          </tr>`
        )
        .join("") || `<tr><td colspan="5">No individual immunity result notes found.</td></tr>`;

    $("#export-immunity-csv").onclick = () => {
      CsvExport.downloadCsv(
        "emc_immunity_results.csv",
        ["page", "test", "file", "antenna", "section", "status", "description", "raw"],
        immunity.map((r) => ({
          page: r.page,
          test: r.testId,
          file: r.fileRef,
          antenna: r.antenna,
          section: r.section,
          status: r.status,
          description: r.description,
          raw: r.raw,
        }))
      );
    };
  }

  // ---- Rendering: Debug ---------------------------------------------------

  function renderDebug() {
    const { unmatchedCount, sampleUnmatched, imageOnlyTables } = state.analysis;
    let statsHtml = `<p>${unmatchedCount.toLocaleString()} line(s) containing digits did not match a known row pattern (showing up to ${sampleUnmatched.length}).</p>`;
    if (imageOnlyTables && imageOnlyTables.length) {
      statsHtml += `<p><strong>${imageOnlyTables.length} likely image-embedded table${imageOnlyTables.length === 1 ? "" : "s"}:</strong> a results-table heading was found on these pages but no extractable data followed it - the table is probably a raster image (a screenshot of a spreadsheet, for example) rather than real text, which this tool can't read. Open the page directly in the PDF to check it by eye.</p>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr><th>Page</th><th>Test</th><th>Heading found</th></tr></thead>
            <tbody>${imageOnlyTables
              .map((t) => `<tr class="row-marginal"><td>${t.page}</td><td>${escapeHtml(t.testCode)}</td><td class="wrap">${escapeHtml(t.heading)}</td></tr>`)
              .join("")}</tbody>
          </table>
        </div>`;
    }
    $("#debug-stats").innerHTML = statsHtml;
    $("#debug-table tbody").innerHTML = sampleUnmatched
      .map((r) => `<tr><td>${r.page}</td><td class="wrap">${escapeHtml(r.text)}</td></tr>`)
      .join("");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- Export Summary image (Overview + Band Summary + Immunity) ----------

  function esTable(headers, rows, rowClassFn, emptyText) {
    if (!rows.length) return `<div class="es-empty">${escapeHtml(emptyText || "None found.")}</div>`;
    const head = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>`;
    const body = rows
      .map((cells, i) => {
        const cls = rowClassFn ? rowClassFn(i) : "";
        return `<tr class="${cls}">${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
      })
      .join("");
    return `<table class="es-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }

  // Builds the full off-screen HTML "sheet" that gets rasterized to PNG.
  // Reuses the exact same computed data as the live Overview / Band Summary /
  // Immunity tabs so the picture always matches what's on screen.
  function buildSummarySheetHtml() {
    const now = new Date().toLocaleString();
    const results = state.analysis.results.filter((r) => r.kind === "emission");
    const fails = results.filter((r) => r.exceed === true);
    const marginal = results.filter((r) => r.marginal);
    const passes = results.filter((r) => r.exceed === false && !r.marginal);
    const unknown = results.filter((r) => r.exceed === null);
    const re310Fails = fails.filter((r) => JlrLimits.testTypeForSection(r.section) === "RE310");
    const ce420Fails = fails.filter((r) => JlrLimits.testTypeForSection(r.section) === "CE420");

    const imageOnlyAll = state.analysis.imageOnlyTables || [];
    const imageOnlyBannerHtml = imageOnlyAll.length
      ? `<div class="es-warning-banner">&#9888; ${imageOnlyAll.length} page${imageOnlyAll.length === 1 ? "" : "s"} in this report contain a results table that could not be read as data - it is likely embedded as an image (e.g. a screenshot of a spreadsheet), not text: ${imageOnlyAll
          .map((t) => `p.${t.page} (${escapeHtml(t.testCode)})`)
          .join(", ")}. Do not read a low/zero failure count below as "clean" for these pages - check them directly in the source PDF.</div>`
      : "";

    const statHtml = (label, value, cls) =>
      `<div class="es-stat ${cls || ""}"><div class="es-stat-value">${value}</div><div class="es-stat-label">${escapeHtml(label)}</div></div>`;

    const summary = state.analysis.testSummary || [];
    const failedCats = summary.filter((s) => s.status === "fail");
    const standardsLine = state.analysis.standardsSeen.length
      ? `<p class="es-note"><strong>Standards / classes referenced:</strong> ${escapeHtml(state.analysis.standardsSeen.join(", "))}</p>`
      : "";
    const dashboardLine = summary.length
      ? `<p class="es-note"><strong>Test category dashboard:</strong> ${summary.length} categories, ${failedCats.length} showing Deviation/Fail${
          failedCats.length ? " (" + escapeHtml(failedCats.map((s) => s.code).join(", ")) + ")" : ""
        }.</p>`
      : "";

    // Band Summary - split by test (RE310 field strength vs CE420 current
    // aren't comparable, so they never share a "worst" figure).
    const includeMarginal = $("#include-marginal-bands").checked;
    const bandTableFor = (testType) => {
      const bandRows = computeBandSummaryRows(includeMarginal, testType);
      return esTable(
        ["Radio Band", "Range (MHz)", "Exceedances", "Worst Margin (dB)", "Worst Page", "Frequencies"],
        bandRows.map((row) => [
          escapeHtml(row.bandName),
          escapeHtml(row.rangeLabel),
          String(row.count),
          row.worstMargin ?? "—",
          row.worstPage !== null
            ? `<strong>p. ${row.worstPage}</strong>${row.worstLabel && row.worstLabel !== "—" ? `<br><span style="color:#6b7280;font-size:0.72rem">${escapeHtml(row.worstLabel)}</span>` : ""}`
            : "—",
          escapeHtml(row.freqs.slice(0, 5).join(", ")),
        ]),
        (i) => (bandRows[i].hasFail ? "row-fail" : "row-marginal"),
        "No over-limit results found for this test."
      );
    };
    const re310BandTable = bandTableFor("RE310");
    const ce420BandTable = bandTableFor("CE420");
    const otherBandRows = computeBandSummaryRows(includeMarginal, "OTHER");
    const otherImageOnly = imageOnlyForTestType("OTHER");
    const showOtherSection = otherBandRows.length > 0 || otherImageOnly.length > 0;
    const otherBandTable = showOtherSection ? bandTableFor("OTHER") : "";

    // Immunity
    const immunityAll = state.analysis.results.filter((r) => r.kind === "immunity");
    const failuresSummary = buildImmunityFailuresSummary(summary, immunityAll);
    const immunityTable = esTable(
      ["Code", "Test Category", "Result", "Key Finding", "Pages"],
      failuresSummary.map((f) => [
        `<strong>${escapeHtml(f.code)}</strong>`,
        escapeHtml(f.label),
        '<span class="es-pill fail">DEVIATION / FAIL</span>',
        escapeHtml(f.description),
        escapeHtml(f.pages.join(", ")),
      ]),
      () => "row-fail",
      "No immunity failures (Deviation/Fail) detected."
    );

    return `
      <div class="export-sheet">
        <div class="es-header">
          <h1>EMC Test Report — Summary</h1>
          <div class="es-meta">
            Source file: ${escapeHtml(state.fileName || "—")}<br>
            Pages analyzed: ${state.totalPages.toLocaleString()} &nbsp;·&nbsp; Generated: ${escapeHtml(now)}
          </div>
        </div>
        <div class="es-body">
          <p class="es-disclaimer">Generated by EMC Test Report Analyzer using heuristic text parsing. Always verify flagged results against the source PDF page before making a compliance decision.</p>
          ${imageOnlyBannerHtml}

          <div class="es-section">
            <h2>Overview</h2>
            <div class="es-stats-grid">
              ${statHtml("Emissions rows found", results.length)}
              ${statHtml("RE 310 failures", re310Fails.length, re310Fails.length ? "fail" : "pass")}
              ${statHtml("CE 420 failures", ce420Fails.length, ce420Fails.length ? "fail" : "pass")}
              ${statHtml("Marginal (near limit)", marginal.length, "marginal")}
              ${statHtml("Emissions pass", passes.length, "pass")}
              ${statHtml("Unclear result", unknown.length)}
            </div>
            ${standardsLine}
            ${dashboardLine}
          </div>

          <div class="es-section">
            <h2>Band Summary — RE 310 (Radiated Emissions)</h2>
            <p class="es-note">Radio-service bands with at least one over-limit RE 310 measurement${includeMarginal ? " (including marginal results)" : ""}.</p>
            ${imageOnlyWarningHtml("RE310")}
            ${re310BandTable}
          </div>

          <div class="es-section">
            <h2>Band Summary — CE 420 (Conducted Emissions)</h2>
            <p class="es-note">Radio-service bands with at least one over-limit CE 420 measurement${includeMarginal ? " (including marginal results)" : ""}.</p>
            ${imageOnlyWarningHtml("CE420")}
            ${ce420BandTable}
          </div>
          ${
            showOtherSection
              ? `<div class="es-section">
            <h2>Band Summary — Other Emissions Tests</h2>
            ${imageOnlyWarningHtml("OTHER")}
            ${otherBandTable}
          </div>`
              : ""
          }

          <div class="es-section">
            <h2>Immunity Failures</h2>
            <p class="es-note">One row per failing test category (this lab's "Deviation" is treated as a failure).</p>
            ${immunityTable}
          </div>

          <div class="es-footer">EMC Test Report Analyzer — client-side heuristic analysis, not a certified compliance result.</div>
        </div>
      </div>`;
  }

  async function exportSummaryImage() {
    if (!state.analysis) return;
    const btn = $("#export-summary-btn");
    const originalLabel = btn.textContent;
    if (typeof html2canvas === "undefined") {
      alert("Image export library failed to load (check your network connection) — please try again.");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Rendering image…";

    const wrapper = document.createElement("div");
    wrapper.style.position = "fixed";
    wrapper.style.left = "-99999px";
    wrapper.style.top = "0";
    wrapper.innerHTML = buildSummarySheetHtml();
    document.body.appendChild(wrapper);

    try {
      const canvas = await html2canvas(wrapper.firstElementChild, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      await new Promise((resolve) => {
        canvas.toBlob((blob) => {
          const safeName = (state.fileName || "emc_report").replace(/\.pdf$/i, "").replace(/[^\w\-]+/g, "_");
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${safeName}_summary.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          resolve();
        }, "image/png");
      });
    } catch (err) {
      console.error("Failed to render summary image:", err);
      alert("Sorry, the summary image couldn't be generated. See the browser console for details.");
    } finally {
      document.body.removeChild(wrapper);
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  $("#export-summary-btn").addEventListener("click", exportSummaryImage);

  // ---- Rendering: Standard reference tab (static, not tied to a report) --

  function renderJlrTable(title, bands, sampleFreq) {
    const rows = bands
      .map((b) => {
        const sample = JlrLimits.lookup(
          b.table === "8-2" ? "CE420" : "RE310",
          Math.min(Math.max(sampleFreq(b), b.freqLow), b.freqHigh)
        ).find((m) => m.id === b.id);
        const limitsHtml = sample
          ? sample.entries.map((e) => `${e.detector} ${e.limit} <span class="hint">(${e.bwKHz} kHz)</span>`).join(" · ")
          : "—";
        return `<tr>
          <td><strong>${escapeHtml(b.id)}</strong></td>
          <td class="wrap">${escapeHtml(b.desc)}</td>
          <td>${b.freqLow}–${b.freqHigh}</td>
          <td class="wrap">${limitsHtml}</td>
        </tr>`;
      })
      .join("");
    return `<h4>${escapeHtml(title)}</h4>
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>ID</th><th>Description</th><th>Freq (MHz)</th><th>Limit at band midpoint (formula-based bands vary across the range \u2014 use the app\u2019s cross-check column for the exact value at a specific frequency)</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function renderStandardTab() {
    const el = $("#standard-tables");
    if (!el) return;
    const midOf = (b) => (b.freqLow + b.freqHigh) / 2 || b.freqLow;
    el.innerHTML =
      renderJlrTable("Table 7-1 — RE 310 Level 1 (formula bands evaluated at range midpoint)", JlrLimits.RE310_LEVEL1, midOf) +
      renderJlrTable("Table 7-2 — RE 310 Level 2", JlrLimits.RE310_LEVEL2, midOf) +
      renderJlrTable("Table 8-2 — CE 420", JlrLimits.CE420_LEVEL, midOf);
  }

  if (typeof JlrLimits !== "undefined") renderStandardTab();
})();
