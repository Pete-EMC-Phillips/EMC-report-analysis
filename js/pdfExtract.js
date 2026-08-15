/**
 * pdfExtract.js
 *
 * Extracts text from a PDF using pdf.js and reconstructs table-like rows
 * from the raw positioned text items (PDF text extraction normally loses
 * row/column structure, so we bucket items by Y position and order by X).
 *
 * Designed to cope with very large reports (hundreds to 1000+ pages)
 * without freezing the browser tab: processing yields back to the event
 * loop periodically and reports progress via a callback.
 */

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PdfExtract = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const Y_BUCKET_TOLERANCE = 2.5; // px, items within this Y delta are treated as same row
  const X_GAP_FOR_SPACE = 8; // px gap between items before we insert an extra space

  /**
   * Group a page's text items into reconstructed left-to-right, top-to-bottom
   * row strings.
   */
  function reconstructRows(textContent) {
    const items = textContent.items
      .filter((it) => it.str !== undefined && it.str !== null)
      .map((it) => ({
        str: it.str,
        x: it.transform[4],
        y: it.transform[5],
      }));

    if (items.length === 0) return [];

    // Sort top-to-bottom (PDF y grows upward, so descending y = top to bottom),
    // then left-to-right within a row.
    items.sort((a, b) => b.y - a.y || a.x - b.x);

    const rows = [];
    let currentRow = [];
    let currentY = null;

    for (const it of items) {
      if (currentY === null || Math.abs(it.y - currentY) <= Y_BUCKET_TOLERANCE) {
        currentRow.push(it);
        currentY = currentY === null ? it.y : currentY;
      } else {
        rows.push(currentRow);
        currentRow = [it];
        currentY = it.y;
      }
    }
    if (currentRow.length) rows.push(currentRow);

    return rows.map((rowItems) => {
      rowItems.sort((a, b) => a.x - b.x);
      let text = "";
      let lastEndX = null;
      for (const it of rowItems) {
        if (lastEndX !== null) {
          const gap = it.x - lastEndX;
          text += gap > X_GAP_FOR_SPACE ? "  " : it.str.match(/^\s/) ? "" : " ";
        }
        text += it.str;
        // crude estimate of glyph width for next-gap calc
        lastEndX = it.x + Math.max(it.str.length * 4, 4);
      }
      return text.replace(/\s+/g, " ").trim();
    });
  }

  /**
   * Load a PDF (ArrayBuffer) and extract reconstructed rows for every page.
   *
   * @param {ArrayBuffer} arrayBuffer
   * @param {Object} opts
   * @param {(info:{page:number,totalPages:number})=>void} opts.onProgress
   * @param {number} opts.yieldEveryNPages - how often to yield to the event loop
   * @returns {Promise<{totalPages:number, rows: Array<{page:number, text:string}>}>}
   */
  async function extractRows(arrayBuffer, opts) {
    opts = opts || {};
    const onProgress = opts.onProgress || function () {};
    const yieldEveryNPages = opts.yieldEveryNPages || 5;

    if (typeof pdfjsLib === "undefined") {
      throw new Error("pdf.js (pdfjsLib) is not loaded on the page.");
    }

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;
    const rows = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageRows = reconstructRows(textContent);
      for (const text of pageRows) {
        if (text) rows.push({ page: pageNum, text });
      }
      // Free page resources for large documents.
      if (page.cleanup) page.cleanup();

      onProgress({ page: pageNum, totalPages });

      if (pageNum % yieldEveryNPages === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    return { totalPages, rows };
  }

  return { extractRows, reconstructRows };
});
