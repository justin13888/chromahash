import type {
  FormatResult,
  FormatStat,
  HarnessResult,
  ImageCategory,
  MetricResult,
} from "./types.ts";

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

/**
 * Provenance metadata stamped into the report footer for record-keeping.
 */
export interface ReportMeta {
  /** Full commit SHA the report was built from, or null when unknown. */
  commit: string | null;
  /** Base repository URL (e.g. https://github.com/visualcommons/chromahash), or null. */
  repoUrl: string | null;
  /** Pre-formatted generation timestamp, e.g. "2026-05-29 14:32 UTC". */
  generatedAt: string;
}

/**
 * Render the report footer: always shows the generation time, and the source
 * commit (linked to the repo when a repoUrl is available) when known.
 */
function reportFooter(meta: ReportMeta): string {
  let commitHtml = "";
  if (meta.commit) {
    const short = meta.commit.slice(0, 12);
    const inner = meta.repoUrl
      ? `<a href="${meta.repoUrl}/commit/${meta.commit}"><code>${short}</code></a>`
      : `<code>${short}</code>`;
    commitHtml = ` &middot; commit ${inner}`;
  }
  return `<footer class="report-footer">ChromaHash Comparison Report &middot; generated ${meta.generatedAt}${commitHtml}</footer>`;
}

/** Average a nullable metric field across results, ignoring null/non-finite values. */
function avgMetric(
  results: FormatResult[],
  pick: (m: MetricResult) => number | null,
): number | null {
  const vals = results
    .map((r) => pick(r.metrics))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
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

    return {
      name,
      avgSize,
      avgEncode,
      avgDecode,
      avgCiede: avgMetric(results, (m) => m.ciede2000),
      avgDssim: avgMetric(results, (m) => m.dssim),
      avgMsSsim: avgMetric(results, (m) => m.msSsim),
      avgPsnrHvsM: avgMetric(results, (m) => m.psnrHvsM),
      avgSsimulacra2: avgMetric(results, (m) => m.ssimulacra2),
      avgButteraugli: avgMetric(results, (m) => m.butteraugli),
      avgPsnr: avgMetric(results, (m) => m.psnrDb),
    };
  });
}

/** Format a nullable metric to fixed precision, or "N/A". */
function fmt(v: number | null, digits: number): string {
  return v !== null ? v.toFixed(digits) : "N/A";
}

/** Wrap a value in a good/warn/bad colour span using ascending thresholds (lower is better). */
function gradeCell(
  v: number | null,
  digits: number,
  good: number,
  warn: number,
): string {
  if (v === null) return "N/A";
  const cls =
    v < good ? "metric-good" : v < warn ? "metric-warn" : "metric-bad";
  return `<span class="${cls}">${v.toFixed(digits)}</span>`;
}

function formatStatsTable(stats: FormatStat[]): string {
  return `<table>
<tr><th>Format</th><th>Avg Size (B)</th><th>Encode (ms)</th><th>Decode (ms)</th><th>Avg ΔE00 ↓</th><th>Avg DSSIM ↓</th><th>Avg MS-SSIM ↑</th><th>Avg PSNR-HVS-M ↑</th><th>Avg SSIMULACRA2 ↑</th><th>Avg Butteraugli ↓</th><th>Avg PSNR (dB) ↑</th></tr>
${stats
  .map(
    (s) => `<tr>
  <td><strong>${s.name}</strong></td>
  <td>${s.avgSize.toFixed(1)}</td>
  <td>${s.avgEncode.toFixed(3)}</td>
  <td>${s.avgDecode.toFixed(3)}</td>
  <td>${gradeCell(s.avgCiede, 2, 2, 5)}</td>
  <td>${gradeCell(s.avgDssim, 4, 0.1, 0.25)}</td>
  <td>${fmt(s.avgMsSsim, 4)}</td>
  <td>${fmt(s.avgPsnrHvsM, 1)}</td>
  <td>${fmt(s.avgSsimulacra2, 1)}</td>
  <td>${fmt(s.avgButteraugli, 2)}</td>
  <td>${fmt(s.avgPsnr, 1)}</td>
</tr>`,
  )
  .join("\n")}
</table>`;
}

/** Canonical LQIP format order, shared by the HTML report and the JSON output. */
export const FORMAT_NAMES = [
  "ChromaHash",
  "ThumbHash",
  "BlurHash",
  "lqip-modern",
  "unpic",
];

/** Canonical language order, shared by the HTML report and the JSON output. */
export const LANGUAGES = [
  "Rust",
  "C",
  "TypeScript",
  "Kotlin",
  "Swift",
  "Go",
  "Python",
  "C#",
];

/**
 * Generate a self-contained HTML report. Images are referenced by whatever the
 * entries' image fields contain — a relative path once materialized to disk, or
 * a data URI otherwise.
 */
export function generateReport(
  entries: ImageEntry[],
  meta: ReportMeta,
  opts?: { formatNames?: string[]; showImplementations?: boolean },
): string {
  const formatNames = opts?.formatNames ?? FORMAT_NAMES;
  const languages = LANGUAGES;
  // The cross-language verification tab is only meaningful for the cross-format
  // report; the version-comparison report (one chromahash build per column) hides it.
  const showImplementations = opts?.showImplementations ?? true;

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

  const implementationsTab = showImplementations
    ? `<!-- Tab 2: ChromaHash Implementations -->
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
</div>`
    : "";

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
  .section-note { margin: -2px 0 8px; font-size: 0.8rem; line-height: 1.5; color: #aaa; max-width: 80ch; }
  body.light .section-note { color: #666; }
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
  footer.report-footer { margin-top: 40px; padding-top: 16px; text-align: center; font-size: 0.78rem; color: #888; border-top: 1px solid #444; }
  body.light footer.report-footer { color: #777; border-color: #ddd; }
  footer.report-footer a { color: inherit; }
</style>
</head>
<body>
<h1>ChromaHash Visual Comparison Report</h1>
<div class="controls">
${
  showImplementations
    ? `  <button class="active" onclick="switchTab('formats', event)">LQIP Formats</button>
  <button onclick="switchTab('implementations', event)">ChromaHash Implementations</button>
`
    : ""
}  <button onclick="toggleTheme()">Toggle Light/Dark</button>
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
<p><strong>Identical-dimension comparison</strong>: every format's decoded preview is Lanczos-3 resampled to the encoder-input (source) resolution and compared against that input, so all formats are scored at the same W×H per image. <strong>CIEDE2000 (ΔE00) is the primary metric</strong> — color accuracy dominates perceived quality for low-fidelity placeholders, where PSNR correlates poorly. All metrics are computed by <a href="https://crates.io/crates/iqa-cli"><code>iqa-cli</code></a> (the iqa-rs crate); window-based metrics are omitted (N/A) for images below their minimum size.</p>
<table style="margin:10px 0">
<tr><th>Metric</th><th>What it measures</th><th>Direction</th></tr>
<tr><td><strong>ΔE00 (CIEDE2000)</strong></td><td><strong>Primary.</strong> Mean perceptual color difference over sRGB→CIELAB (D65)</td><td>lower; JND ≈ 1</td></tr>
<tr><td><strong>DSSIM</strong></td><td>(1−SSIM)/2; structural fidelity</td><td>lower; 0 = identical</td></tr>
<tr><td><strong>MS-SSIM</strong></td><td>Multi-scale SSIM</td><td>higher; 1 = identical</td></tr>
<tr><td><strong>PSNR-HVS-M</strong></td><td>DCT-domain PSNR with CSF + contrast masking (dB)</td><td>higher</td></tr>
<tr><td><strong>SSIMULACRA2</strong></td><td>Perceptual full-reference score</td><td>higher; 100 = identical</td></tr>
<tr><td><strong>Butteraugli</strong></td><td>Perceptual distance (libjxl)</td><td>lower; 0 = identical</td></tr>
<tr><td><strong>PSNR</strong></td><td>Classic pixel MSE metric; penalises intentional LQIP blur</td><td>higher; reference only</td></tr>
</table>
<p style="margin-top:8px"><em>ΔE00 colour coding: good &lt; 2, warn &lt; 5, bad ≥ 5. DSSIM: good &lt; 0.10, warn &lt; 0.25.</em></p>
</div>
</details>

${categories
  .map((category) => {
    const catEntries = entries.filter((e) => e.category === category);
    if (catEntries.length === 0) return "";
    return `
<div class="section-title">${category}</div>${
      category === "Gamut"
        ? `\n<p class="section-note">ΔE00 is scored in sRGB against the source's color-managed sRGB appearance, so the cross-format comparison stays apples-to-apples; the gamut-aware ChromaHash matches it while formats that ignore the source gamut look off (higher ΔE00). The <strong>Display P3</strong> row's Original and ChromaHash previews are decoded to P3 and tagged with the P3 ICC profile: on a wide-gamut (P3) display they show the true saturated color and match each other, while the sRGB-only formats appear less saturated — ChromaHash renders correctly to the display's gamut.</p>`
        : ""
    }
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
      const ciedeStr =
        r.metrics.ciede2000 !== null
          ? ` | ΔE:${r.metrics.ciede2000.toFixed(2)}`
          : "";
      const dssimStr =
        r.metrics.dssim !== null ? ` DSSIM:${r.metrics.dssim.toFixed(3)}` : "";
      return `<div class="image-cell">
      <img src="${r.dataUri}" alt="${r.formatName}">
      <div class="label">${r.formatName}<br>${r.decodedWidth}x${r.decodedHeight}px | ${r.encodedSizeBytes}B${ciedeStr}${dssimStr}</div>
    </div>`;
    })
    .join("\n  ")}
</div>`,
  )
  .join("\n")}`;
  })
  .join("\n")}
</div>

${implementationsTab}

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
${reportFooter(meta)}
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
