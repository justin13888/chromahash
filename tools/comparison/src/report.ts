import type { FormatResult, HarnessResult, ImageCategory } from "./types.ts";

interface ImageEntry {
  name: string;
  category: ImageCategory;
  originalWidth: number;
  originalHeight: number;
  originalDataUri: string;
  loResDataUri: string;
  formatResults: FormatResult[];
  harnessResults: HarnessResult[];
}

export interface FormatStat {
  name: string;
  avgSize: number;
  avgEncode: number;
  avgDecode: number;
  avgDssim: number | null;
  avgDe: number | null;
  avgComp: number | null;
  avgPsnr: number | null;
}

/**
 * Compute summary statistics for each format, optionally filtered to a subset of entries.
 */
export function computeFormatStats(
  entries: ImageEntry[],
  formatNames: string[],
  filter: (e: ImageEntry) => boolean = () => true,
): FormatStat[] {
  const filtered = entries.filter(filter);
  return formatNames.map((name) => {
    const results = filtered.flatMap((e) =>
      e.formatResults.filter((r) => r.formatName === name),
    );
    const avgSize =
      results.reduce((s, r) => s + r.encodedSizeBytes, 0) /
      (results.length || 1);
    const avgEncode =
      results.reduce((s, r) => s + r.encodeTimeMs, 0) / (results.length || 1);
    const avgDecode =
      results.reduce((s, r) => s + r.decodeTimeMs, 0) / (results.length || 1);

    const dssimResults = results.filter((r) => r.metrics.dssim !== null);
    const avgDssim =
      dssimResults.length > 0
        ? dssimResults.reduce((s, r) => s + (r.metrics.dssim ?? 0), 0) /
          dssimResults.length
        : null;

    const deResults = results.filter((r) => r.metrics.deltaEWeighted !== null);
    const avgDe =
      deResults.length > 0
        ? deResults.reduce((s, r) => s + (r.metrics.deltaEWeighted ?? 0), 0) /
          deResults.length
        : null;

    const compResults = results.filter(
      (r) => r.metrics.compositeScore !== null,
    );
    const avgComp =
      compResults.length > 0
        ? compResults.reduce((s, r) => s + (r.metrics.compositeScore ?? 0), 0) /
          compResults.length
        : null;

    const psnrResults = results.filter(
      (r) => r.metrics.psnrDb !== null && Number.isFinite(r.metrics.psnrDb),
    );
    const avgPsnr =
      psnrResults.length > 0
        ? psnrResults.reduce((s, r) => s + (r.metrics.psnrDb ?? 0), 0) /
          psnrResults.length
        : null;

    return {
      name,
      avgSize,
      avgEncode,
      avgDecode,
      avgDssim,
      avgDe,
      avgComp,
      avgPsnr,
    };
  });
}

function formatStatsTable(stats: FormatStat[]): string {
  return `<table>
<tr><th>Format</th><th>Avg Size (B)</th><th>Encode (ms)</th><th>Decode (ms)</th><th>Avg DSSIM ↓</th><th>Avg dE wtd ↓</th><th>Avg Composite ↓</th><th>Avg PSNR (dB) ↑</th></tr>
${stats
  .map((s) => {
    const dssimCell =
      s.avgDssim !== null
        ? `<span class="${s.avgDssim < 0.1 ? "metric-good" : s.avgDssim < 0.25 ? "metric-warn" : "metric-bad"}">${s.avgDssim.toFixed(4)}</span>`
        : "N/A";
    const deCell =
      s.avgDe !== null
        ? `<span class="${s.avgDe < 0.04 ? "metric-good" : s.avgDe < 0.12 ? "metric-warn" : "metric-bad"}">${s.avgDe.toFixed(4)}</span>`
        : "N/A";
    const compCell =
      s.avgComp !== null
        ? `<span class="${s.avgComp < 0.3 ? "metric-good" : s.avgComp < 0.6 ? "metric-warn" : "metric-bad"}">${s.avgComp.toFixed(3)}</span>`
        : "N/A";
    return `<tr>
  <td><strong>${s.name}</strong></td>
  <td>${s.avgSize.toFixed(1)}</td>
  <td>${s.avgEncode.toFixed(3)}</td>
  <td>${s.avgDecode.toFixed(3)}</td>
  <td>${dssimCell}</td>
  <td>${deCell}</td>
  <td>${compCell}</td>
  <td>${s.avgPsnr !== null ? s.avgPsnr.toFixed(1) : "N/A"}</td>
</tr>`;
  })
  .join("\n")}
</table>`;
}

/**
 * Generate a self-contained HTML report with all images embedded as data URIs.
 */
export function generateReport(entries: ImageEntry[]): string {
  const formatNames = [
    "ChromaHash",
    "ThumbHash",
    "BlurHash",
    "lqip-modern",
    "unpic",
  ];
  const languages = [
    "Rust",
    "TypeScript",
    "Kotlin",
    "Swift",
    "Go",
    "Python",
    "C#",
  ];

  // Compute summary stats: natural/realistic only (primary), and all images
  const naturalFilter = (e: ImageEntry) =>
    (["Natural", "Realistic"] as ImageCategory[]).includes(e.category);
  const naturalStats = computeFormatStats(entries, formatNames, naturalFilter);
  const allStats = computeFormatStats(entries, formatNames);

  // Check cross-language consistency
  const harnessesSkipped = entries.every((e) => e.harnessResults.length === 0);
  const langPassFail = languages.map((lang) => {
    if (harnessesSkipped) {
      return { language: lang, pass: null as boolean | null };
    }
    const allMatch = entries.every((e) => {
      const result = e.harnessResults.find((r) => r.language === lang);
      return result?.matches ?? false;
    });
    return { language: lang, pass: allMatch };
  });

  // Group entries by category
  const categories: ImageCategory[] = [
    "Dimensions",
    "Alpha",
    "Color Distribution",
    "Quantization",
    "Gamut",
    "Natural",
    "Realistic",
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ChromaHash Comparison Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  body.light { background: #f5f5f5; color: #333; }
  h1 { text-align: center; margin-bottom: 20px; font-size: 1.5rem; }
  .controls { text-align: center; margin-bottom: 20px; }
  .controls button { padding: 8px 16px; margin: 0 4px; border: 1px solid #555; border-radius: 4px; cursor: pointer; background: #2a2a4a; color: #e0e0e0; font-size: 0.9rem; }
  .controls button.active { background: #4a4aff; border-color: #4a4aff; }
  body.light .controls button { background: #fff; color: #333; border-color: #ccc; }
  body.light .controls button.active { background: #4a4aff; color: #fff; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }
  table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { padding: 8px 12px; border: 1px solid #444; text-align: center; font-size: 0.85rem; }
  body.light th, body.light td { border-color: #ddd; }
  th { background: #2a2a4a; }
  body.light th { background: #e8e8e8; color: #333; }
  .section-title { margin: 24px 0 8px; font-size: 1.1rem; border-bottom: 1px solid #555; padding-bottom: 4px; }
  .image-row { display: flex; gap: 8px; align-items: flex-start; flex-wrap: wrap; margin: 8px 0; padding: 8px; background: #222244; border-radius: 4px; }
  body.light .image-row { background: #fff; border: 1px solid #ddd; }
  .image-cell { text-align: center; min-width: 80px; }
  .image-cell img { height: 150px; width: auto; image-rendering: pixelated; border: 1px solid #555; }
  body.blur .image-cell img { image-rendering: auto; }
  .original-wrap { position: relative; display: inline-block; }
  .original-wrap .img-lores { position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.15s; }
  .original-wrap:hover .img-lores { opacity: 1; }
  .original-wrap .img-hires { image-rendering: auto; }
  body.light .image-cell img { border-color: #ccc; }
  .image-cell .label { font-size: 0.75rem; margin-top: 2px; color: #aaa; }
  body.light .image-cell .label { color: #666; }
  .image-cell .css-preview { width: 150px; height: 150px; border: 1px solid #555; }
  .image-name { font-weight: bold; font-size: 0.85rem; min-width: 120px; display: flex; align-items: center; }
  .pass { color: #4caf50; }
  .fail { color: #f44336; font-weight: bold; }
  .mismatch { outline: 3px solid #f44336; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 16px 0; }
  .summary-card { padding: 12px; background: #2a2a4a; border-radius: 4px; text-align: center; }
  body.light .summary-card { background: #fff; border: 1px solid #ddd; }
  .summary-card .value { font-size: 1.2rem; font-weight: bold; }
  .summary-card .label { font-size: 0.75rem; color: #aaa; }
  .metric-good { color: #4caf50; font-weight: 600; }
  .metric-warn { color: #ff9800; }
  .metric-bad  { color: #f44336; font-weight: 600; }
  details.methodology { margin: 16px 0; border: 1px solid #555; border-radius: 4px; }
  body.light details.methodology { border-color: #ccc; }
  details.methodology summary { padding: 10px 14px; cursor: pointer; font-size: 0.9rem; user-select: none; }
  details.methodology .inner { padding: 12px 16px; font-size: 0.82rem; line-height: 1.6; }
  details.methodology table { font-size: 0.82rem; }
</style>
</head>
<body>
<h1>ChromaHash Visual Comparison Report</h1>
<div class="controls">
  <button class="active" onclick="switchTab('formats', event)">LQIP Formats</button>
  <button onclick="switchTab('implementations', event)">ChromaHash Implementations</button>
  <button onclick="toggleTheme()">Toggle Light/Dark</button>
  <button onclick="toggleBlur()">Toggle Blur</button>
</div>

<!-- Tab 1: LQIP Formats -->
<div id="tab-formats" class="tab-content active">
<h2 style="margin-bottom:12px">Cross-Format Comparison</h2>

<h3 style="margin:16px 0 4px;font-size:0.95rem">Natural &amp; Realistic Images Only</h3>
${formatStatsTable(naturalStats)}

<details class="methodology">
<summary>All Images (including synthetic test cases)</summary>
<div class="inner">
${formatStatsTable(allStats)}
</div>
</details>

<details class="methodology">
<summary>Methodology</summary>
<div class="inner">
<p><strong>Blur-then-compare</strong>: The encoder input is Lanczos-3 downscaled to each format's native decoded resolution before comparison, avoiding nearest-neighbor upsampling artifacts that inflate PSNR penalty. For ChromaHash, decoded output larger than the source is downscaled to source dims before metric computation.</p>
<table style="margin:10px 0">
<tr><th>Metric</th><th>What it measures</th><th>Good threshold</th></tr>
<tr><td><strong>DSSIM</strong></td><td>(1−SSIM)/2 over luminance; structural fidelity ignoring uniform brightness shifts</td><td>&lt; 0.10</td></tr>
<tr><td><strong>dE wtd</strong></td><td>OKLAB ΔE weighted by local luminance variance (saliency proxy); JND ≈ 0.02</td><td>&lt; 0.04</td></tr>
<tr><td><strong>Composite</strong></td><td>0.55·norm(DSSIM) + 0.45·norm(dE wtd); min-max normalised per image across raster formats</td><td>0 = best</td></tr>
<tr><td><strong>PSNR</strong></td><td>Classic pixel MSE metric; shown for familiarity but penalises intentional LQIP blur</td><td>reference only</td></tr>
</table>
<p style="margin-top:8px"><em>Thresholds calibrated for 32-byte hash-based formats. DSSIM good &lt; 0.10, warn &lt; 0.25. dE wtd good &lt; 0.04, warn &lt; 0.12.</em></p>
</div>
</details>

${categories
  .map((category) => {
    const catEntries = entries.filter((e) => e.category === category);
    if (catEntries.length === 0) return "";
    return `
<div class="section-title">${category}</div>
${catEntries
  .map(
    (entry) => `
<div class="image-row">
  <div class="image-name">${entry.name}</div>
  <div class="image-cell">
    <div class="original-wrap">
      <img class="img-hires" src="${entry.originalDataUri}" alt="Original">
      <img class="img-lores" src="${entry.loResDataUri}" alt="Encoder input">
    </div>
    <div class="label">Original<br>${entry.originalWidth}x${entry.originalHeight}px</div>
  </div>
  ${entry.formatResults
    .map((r) => {
      if (r.dataUri.startsWith("css:")) {
        const css = r.dataUri.slice(4);
        return `<div class="image-cell">
      <div class="css-preview" style="${css}"></div>
      <div class="label">${r.formatName}<br>${r.decodedWidth}x${r.decodedHeight}px | ${r.encodedSizeBytes}B</div>
    </div>`;
      }
      const compStr =
        r.metrics.compositeScore !== null
          ? ` | C:${r.metrics.compositeScore.toFixed(2)}`
          : "";
      const dssimStr =
        r.metrics.dssim !== null ? ` DSSIM:${r.metrics.dssim.toFixed(3)}` : "";
      return `<div class="image-cell">
      <img src="${r.dataUri}" alt="${r.formatName}">
      <div class="label">${r.formatName}<br>${r.decodedWidth}x${r.decodedHeight}px | ${r.encodedSizeBytes}B${compStr}${dssimStr}</div>
    </div>`;
    })
    .join("\n  ")}
</div>`,
  )
  .join("\n")}`;
  })
  .join("\n")}
</div>

<!-- Tab 2: ChromaHash Implementations -->
<div id="tab-implementations" class="tab-content">
<h2 style="margin-bottom:12px">Cross-Language Verification</h2>

<table>
<tr><th>Language</th><th>Status</th></tr>
${langPassFail
  .map(
    (l) =>
      `<tr><td>${l.language}</td><td class="${l.pass === null ? "" : l.pass ? "pass" : "fail"}">${l.pass === null ? "N/A" : l.pass ? "PASS" : "FAIL"}</td></tr>`,
  )
  .join("\n")}
</table>

${categories
  .map((category) => {
    const catEntries = entries.filter((e) => e.category === category);
    if (catEntries.length === 0) return "";
    return `
<div class="section-title">${category}</div>
${catEntries
  .map(
    (entry) => `
<div class="image-row">
  <div class="image-name">${entry.name}</div>
  <div class="image-cell">
    <div class="original-wrap">
      <img class="img-hires" src="${entry.originalDataUri}" alt="Original">
      <img class="img-lores" src="${entry.loResDataUri}" alt="Encoder input">
    </div>
    <div class="label">Original<br>${entry.originalWidth}x${entry.originalHeight}px</div>
  </div>
  ${entry.harnessResults
    .map(
      (r) => `<div class="image-cell">
    ${r.dataUri ? `<img src="${r.dataUri}" alt="${r.language}" class="${r.matches ? "" : "mismatch"}">` : '<div style="width:80px;height:150px;background:#333;display:flex;align-items:center;justify-content:center;color:#f44">Error</div>'}
    <div class="label ${r.matches ? "pass" : "fail"}">${r.language}</div>
  </div>`,
    )
    .join("\n  ")}
</div>`,
  )
  .join("\n")}`;
  })
  .join("\n")}
</div>

<script>
function switchTab(tab, evt) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.controls button').forEach(el => el.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  evt.target.classList.add('active');
}
function toggleTheme() {
  document.body.classList.toggle('light');
}
function toggleBlur() {
  document.body.classList.toggle('blur');
}
</script>
</body>
</html>`;
}

/**
 * Determine the image category from the filename.
 */
export function categorizeImage(fileName: string): ImageCategory {
  const base = fileName.replace(/\.[^.]+$/, "");
  if (base.startsWith("dim-")) return "Dimensions";
  if (base.startsWith("alpha-")) return "Alpha";
  if (
    base.startsWith("solid-") ||
    base.startsWith("gradient-") ||
    base === "checkerboard" ||
    base === "noise"
  )
    return "Color Distribution";
  if (
    base.startsWith("saturated-") ||
    base.startsWith("near-") ||
    base === "monochrome"
  )
    return "Quantization";
  if (base.startsWith("gamut-")) return "Gamut";
  if (base.startsWith("natural-")) return "Natural";
  return "Realistic";
}
