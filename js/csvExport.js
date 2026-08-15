/**
 * csvExport.js — tiny CSV helper, no dependencies.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.CsvExport = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  function escapeCell(v) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function toCsv(headers, rows) {
    const lines = [headers.map(escapeCell).join(",")];
    for (const row of rows) {
      lines.push(headers.map((h) => escapeCell(row[h])).join(","));
    }
    return lines.join("\r\n");
  }

  function downloadCsv(filename, headers, rows) {
    const csv = toCsv(headers, rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { toCsv, downloadCsv };
});
