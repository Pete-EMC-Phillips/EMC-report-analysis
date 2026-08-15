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

    const statBox = (label, value, cls) =>
      `<div class="stat-box ${cls || ""}"><div class="value">${value}</div><div class="label">${label}</div></div>`;

    $("#overview-stats").innerHTML =
      statBox("Pages analyzed", state.totalPages) +
      statBox("Emissions data rows found", results.length) +
      statBox("Emissions failures / over limit", fails.length, "fail") +
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

  function renderFailures() {
    const fails = state.analysis.results.filter((r) => r.kind === "emission" && r.exceed === true);
    $("#failures-count").textContent = `${fails.length} failure${fails.length === 1 ? "" : "s"} found`;

    const tbody = $("#failures-table tbody");
    tbody.innerHTML = fails
      .map(
        (r) => `<tr class="row-fail">
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
        </tr>`
      )
      .join("");

    $("#export-failures-csv").onclick = () => {
      CsvExport.downloadCsv(
        "emc_failures.csv",
        ["page", "test", "file", "antenna", "section", "frequencyMHz", "band", "level", "limit", "margin", "detector", "result", "raw"],
        fails.map((r) => ({
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
          raw: r.raw,
        }))
      );
    };
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
  // "Export Summary" button.
  function computeBandSummaryRows(includeMarginal) {
    const relevant = state.analysis.results.filter(
      (r) => r.kind === "emission" && (r.exceed === true || (includeMarginal && r.marginal))
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

  function renderBandSummary() {
    const includeMarginal = $("#include-marginal-bands").checked;
    const rows = computeBandSummaryRows(includeMarginal);

    const rowsHtml = rows.map((row) => {
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
    });

    $("#bands-table tbody").innerHTML = rowsHtml.join("") || `<tr><td colspan="7">No over-limit results found.</td></tr>`;
  }

  $("#include-marginal-bands").addEventListener("change", renderBandSummary);

  // ---- Rendering: All Results (paginated) --------------------------------

  function renderAllResults() {
    const results = state.analysis.results.filter((r) => r.kind === "emission");
    $("#all-count").textContent = `${results.length.toLocaleString()} rows total`;

    const start = state.allResultsPage * state.allResultsPageSize;
    const pageRows = results.slice(start, start + state.allResultsPageSize);

    $("#all-table tbody").innerHTML = pageRows
      .map(
        (r) => `<tr class="${r.exceed === true ? "row-fail" : r.marginal ? "row-marginal" : ""}">
          <td>${r.page}</td>
          <td class="wrap">${testFileLabel(r)}</td>
          <td class="wrap">${r.section}</td>
          <td>${fmtFreq(r.frequencyMHz)}</td>
          <td>${r.level ?? "—"}</td>
          <td>${r.limit ?? "—"}</td>
          <td>${r.computedMargin ?? r.reportedMargin ?? "—"}</td>
          <td>${r.detector ?? "—"}</td>
          <td>${resultBadge(r)}</td>
        </tr>`
      )
      .join("");

    const totalPages = Math.max(1, Math.ceil(results.length / state.allResultsPageSize));
    $("#all-page-label").textContent = `Page ${state.allResultsPage + 1} of ${totalPages}`;

    $("#export-all-csv").onclick = () => {
      CsvExport.downloadCsv(
        "emc_all_results.csv",
        ["page", "test", "file", "antenna", "section", "frequencyMHz", "level", "limit", "margin", "detector", "result", "raw"],
        results.map((r) => ({
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
          raw: r.raw,
        }))
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
    const { unmatchedCount, sampleUnmatched } = state.analysis;
    $("#debug-stats").innerHTML = `<p>${unmatchedCount.toLocaleString()} line(s) containing digits did not match a known row pattern (showing up to ${sampleUnmatched.length}).</p>`;
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

    // Band Summary
    const includeMarginal = $("#include-marginal-bands").checked;
    const bandRows = computeBandSummaryRows(includeMarginal);
    const bandTable = esTable(
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
      "No over-limit results found."
    );

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

          <div class="es-section">
            <h2>Overview</h2>
            <div class="es-stats-grid">
              ${statHtml("Emissions rows found", results.length)}
              ${statHtml("Failures / over limit", fails.length, "fail")}
              ${statHtml("Marginal (near limit)", marginal.length, "marginal")}
              ${statHtml("Emissions pass", passes.length, "pass")}
              ${statHtml("Unclear result", unknown.length)}
            </div>
            ${standardsLine}
            ${dashboardLine}
          </div>

          <div class="es-section">
            <h2>Band Summary</h2>
            <p class="es-note">Radio-service bands with at least one over-limit measurement${includeMarginal ? " (including marginal results)" : ""}.</p>
            ${bandTable}
          </div>

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
})();
