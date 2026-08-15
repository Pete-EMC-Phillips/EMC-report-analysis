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
    renderOverview();
    renderFailures();
    renderBandSummary();
    renderAllResults();
    renderDebug();
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
    const { results } = state.analysis;
    const fails = results.filter((r) => r.exceed === true);
    const marginal = results.filter((r) => r.marginal);
    const passes = results.filter((r) => r.exceed === false && !r.marginal);
    const unknown = results.filter((r) => r.exceed === null);

    const statBox = (label, value, cls) =>
      `<div class="stat-box ${cls || ""}"><div class="value">${value}</div><div class="label">${label}</div></div>`;

    $("#overview-stats").innerHTML =
      statBox("Pages analyzed", state.totalPages) +
      statBox("Data rows found", results.length) +
      statBox("Failures / over limit", fails.length, "fail") +
      statBox("Marginal (near limit)", marginal.length, "marginal") +
      statBox("Pass", passes.length, "pass") +
      statBox("Unclear result", unknown.length);

    const standardsEl = $("#standards-seen");
    standardsEl.innerHTML = state.analysis.standardsSeen.length
      ? `<p><strong>Standards / classes referenced in report:</strong> ${state.analysis.standardsSeen.join(", ")}</p>`
      : `<p class="hint">No explicit standard references (e.g. CISPR 32, EN 55032, FCC Part 15) were detected in the text.</p>`;

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

    const ctx = $("#band-chart").getContext("2d");
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

  function renderFailures() {
    const fails = state.analysis.results.filter((r) => r.exceed === true);
    $("#failures-count").textContent = `${fails.length} failure${fails.length === 1 ? "" : "s"} found`;

    const tbody = $("#failures-table tbody");
    tbody.innerHTML = fails
      .map(
        (r) => `<tr class="row-fail">
          <td>${r.page}</td>
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
        ["page", "section", "frequencyMHz", "band", "level", "limit", "margin", "detector", "result", "raw"],
        fails.map((r) => ({
          page: r.page,
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

  function renderBandSummary() {
    const includeMarginal = $("#include-marginal-bands").checked;
    const relevant = state.analysis.results.filter((r) => r.exceed === true || (includeMarginal && r.marginal));

    const byBand = new Map(); // bandName -> {entries, worstMargin}
    const unclassified = [];

    for (const r of relevant) {
      const bands = classifyFrequencyMHz(r.frequencyMHz);
      const margin = r.computedMargin ?? r.reportedMargin ?? null;
      if (bands.length === 0) {
        unclassified.push(r);
        continue;
      }
      for (const bandName of bands) {
        if (!byBand.has(bandName)) byBand.set(bandName, []);
        byBand.get(bandName).push(r);
      }
    }

    const rowsHtml = [];
    const sortedBands = Array.from(byBand.entries()).sort((a, b) => b[1].length - a[1].length);

    for (const [bandName, entries] of sortedBands) {
      const bandDef = RADIO_BANDS.find((b) => b.name === bandName);
      const worst = entries.reduce((min, r) => {
        const m = r.computedMargin ?? r.reportedMargin;
        return m !== null && (min === null || m < min) ? m : min;
      }, null);
      const freqs = Array.from(new Set(entries.map((r) => fmtFreq(r.frequencyMHz)))).slice(0, 8).join(", ");
      const pages = Array.from(new Set(entries.map((r) => r.page))).slice(0, 12).join(", ");
      rowsHtml.push(`<tr class="${entries.some((r) => r.exceed === true) ? "row-fail" : "row-marginal"}">
        <td class="wrap">${bandName}</td>
        <td>${bandDef ? bandDef.low + "–" + bandDef.high : "—"}</td>
        <td>${entries.length}</td>
        <td>${worst !== null ? worst : "—"}</td>
        <td class="wrap">${freqs}</td>
        <td class="wrap">${pages}</td>
      </tr>`);
    }

    if (unclassified.length) {
      const freqs = Array.from(new Set(unclassified.map((r) => fmtFreq(r.frequencyMHz)))).slice(0, 8).join(", ");
      const pages = Array.from(new Set(unclassified.map((r) => r.page))).slice(0, 12).join(", ");
      rowsHtml.push(`<tr>
        <td>Unclassified frequency</td><td>—</td><td>${unclassified.length}</td><td>—</td>
        <td class="wrap">${freqs}</td><td class="wrap">${pages}</td>
      </tr>`);
    }

    $("#bands-table tbody").innerHTML = rowsHtml.join("") || `<tr><td colspan="6">No over-limit results found.</td></tr>`;
  }

  $("#include-marginal-bands").addEventListener("change", renderBandSummary);

  // ---- Rendering: All Results (paginated) --------------------------------

  function renderAllResults() {
    const results = state.analysis.results;
    $("#all-count").textContent = `${results.length.toLocaleString()} rows total`;

    const start = state.allResultsPage * state.allResultsPageSize;
    const pageRows = results.slice(start, start + state.allResultsPageSize);

    $("#all-table tbody").innerHTML = pageRows
      .map(
        (r) => `<tr class="${r.exceed === true ? "row-fail" : r.marginal ? "row-marginal" : ""}">
          <td>${r.page}</td>
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
        ["page", "section", "frequencyMHz", "level", "limit", "margin", "detector", "result", "raw"],
        results.map((r) => ({
          page: r.page,
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
    const totalPages = Math.max(1, Math.ceil(state.analysis.results.length / state.allResultsPageSize));
    if (state.allResultsPage < totalPages - 1) {
      state.allResultsPage++;
      renderAllResults();
    }
  });

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
})();
