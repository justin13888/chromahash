import { splitFor } from "./corpus.ts";
import {
  computePairedComparisons,
  type PairedComparison,
  pickVersionBaseline,
} from "./paired.ts";
import { bootstrapCI, quantile } from "./stats.ts";
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
  /** Base repository URL (e.g. https://github.com/justin13888/chromahash), or null. */
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

/** Average a nullable field of the blurred metric set (null when not computed). */
function avgBlurredMetric(
  results: FormatResult[],
  pick: (m: MetricResult) => number | null,
): number | null {
  const vals = results
    .map((r) => (r.metricsBlurred ? pick(r.metricsBlurred) : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/**
 * Compute summary statistics for each format, optionally filtered to a subset of entries.
 * The primary metric (ΔE00) additionally gets a median, p90, and a 95%
 * bootstrap CI of the mean — a mean alone hides tail behaviour.
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

    const ciedeValues = results
      .map((r) => r.metrics.ciede2000)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    const ciedeSorted = [...ciedeValues].sort((a, b) => a - b);

    return {
      name,
      images: results.length,
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
      avgCiedeBlurred: avgBlurredMetric(results, (m) => m.ciede2000),
      medianCiede: ciedeSorted.length > 0 ? quantile(ciedeSorted, 0.5) : null,
      p90Ciede: ciedeSorted.length > 0 ? quantile(ciedeSorted, 0.9) : null,
      ciCiede: ciedeValues.length > 0 ? bootstrapCI(ciedeValues) : null,
    };
  });
}

/**
 * Long edge, in CSS px, of the normalization box every preview is scaled into.
 * Matches the report's historical max-height cap, so page length is unchanged.
 */
const PREVIEW_BOX_LONG_EDGE = 150;
/**
 * Floor on a rendered edge. The `dim-*` fixtures reach 1x100 and 100x1, which
 * contain-fit to a ~1.5px sliver -- present, but impossible to actually look
 * at. Clamping the short edge up stretches that one axis; the true decode
 * dimensions stay printed in every cell's label, so the distortion is
 * disclosed rather than hidden.
 */
const PREVIEW_MIN_EDGE = 8;

/** A rendered size in CSS pixels. */
interface Box {
  w: number;
  h: number;
}

/**
 * The per-row normalization box: the original's aspect ratio with its long edge
 * at {@link PREVIEW_BOX_LONG_EDGE}, short edge floored at {@link PREVIEW_MIN_EDGE}.
 * Every cell in the row -- original, each format, each language harness -- is
 * laid out in a box of exactly this size, so formats are compared at one scale
 * instead of at whatever resolution each happens to decode to.
 */
function rowBox(width: number, height: number): Box {
  if (!(width > 0) || !(height > 0)) {
    return { w: PREVIEW_BOX_LONG_EDGE, h: PREVIEW_BOX_LONG_EDGE };
  }
  const scale = PREVIEW_BOX_LONG_EDGE / Math.max(width, height);
  return {
    w: Math.max(PREVIEW_MIN_EDGE, Math.round(width * scale)),
    h: Math.max(PREVIEW_MIN_EDGE, Math.round(height * scale)),
  };
}

/**
 * Contain-fit a decode of `width`x`height` inside the row box, flooring each
 * rendered edge at {@link PREVIEW_MIN_EDGE}. Contain (never cover, never
 * stretch) is what keeps a format that decodes to a different aspect than the
 * source visibly letterboxed instead of silently distorted -- e.g. a square 4x4
 * WebP against a 827x852 original. Upscaling is the point: a 4x4 decode is
 * magnified ~37x so it is actually visible, and `image-rendering: pixelated`
 * keeps that honest by showing its 16 flat samples as 16 flat blocks.
 */
function fitInBox(width: number, height: number, box: Box): Box {
  if (!(width > 0) || !(height > 0)) return box;
  const scale = Math.min(box.w / width, box.h / height);
  return {
    w: Math.max(PREVIEW_MIN_EDGE, Math.round(width * scale)),
    h: Math.max(PREVIEW_MIN_EDGE, Math.round(height * scale)),
  };
}

/** Inline `style` sizing a media element to a fitted box. */
function sizeStyle(box: Box): string {
  return `width:${box.w}px;height:${box.h}px`;
}

/** Custom properties that fix a cell's media area to the row box. */
function boxVars(box: Box): string {
  return `--box-w:${box.w}px;--box-h:${box.h}px`;
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

/** Format a [lo, hi] confidence interval, or "N/A". */
function fmtCi(ci: [number, number] | null, digits: number): string {
  return ci !== null
    ? `${ci[0].toFixed(digits)}&ndash;${ci[1].toFixed(digits)}`
    : "N/A";
}

function formatStatsTable(stats: FormatStat[]): string {
  // A format with fewer images than the widest one could not represent the
  // budget everywhere; its means cover a subset and the table has to say so.
  const maxImages = stats.reduce((m, x) => Math.max(m, x.images), 0);
  // The blurred "as-rendered" column only appears when the run computed it.
  const hasBlurred = stats.some((s) => s.avgCiedeBlurred !== null);
  return `<table>
<tr><th>Format</th><th>Images</th><th>Avg Size (B)</th><th>Encode (ms)</th><th>Decode (ms)</th><th>Avg ΔE00 ↓</th><th>Median ΔE00 ↓</th><th>p90 ΔE00 ↓</th><th>95% CI ΔE00</th>${hasBlurred ? "<th>Avg ΔE00 (blur) ↓</th>" : ""}<th>Avg DSSIM ↓</th><th>Avg MS-SSIM ↑</th><th>Avg PSNR-HVS-M ↑</th><th>Avg SSIMULACRA2 ↑</th><th>Avg Butteraugli ↓</th><th>Avg PSNR (dB) ↑</th></tr>
${stats
  .map(
    (s) => `<tr>
  <td><strong>${s.name}</strong></td>
  <td${s.images < maxImages ? ' class="short" title="fewer images than the set: this format could not represent the byte budget on every image, so its means cover only the images listed"' : ""}>${s.images}${s.images < maxImages ? "*" : ""}</td>
  <td>${s.avgSize.toFixed(1)}</td>
  <td>${s.avgEncode.toFixed(3)}</td>
  <td>${s.avgDecode.toFixed(3)}</td>
  <td>${gradeCell(s.avgCiede, 2, 2, 5)}</td>
  <td>${gradeCell(s.medianCiede, 2, 2, 5)}</td>
  <td>${gradeCell(s.p90Ciede, 2, 2, 5)}</td>
  <td>${fmtCi(s.ciCiede, 2)}</td>
  ${hasBlurred ? `<td>${gradeCell(s.avgCiedeBlurred, 2, 2, 5)}</td>\n  ` : ""}<td>${gradeCell(s.avgDssim, 4, 0.1, 0.25)}</td>
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

/**
 * Render the paired version-A/B tables: one block per candidate column, each
 * differenced per-image against the released-tag baseline. A CI that excludes
 * zero is the signal — the unpaired tables above cannot resolve differences
 * this small (see paired.ts).
 */
function pairedTable(comparisons: PairedComparison[]): string {
  if (comparisons.length === 0) return "";
  return comparisons
    .map(
      (
        cmp,
      ) => `<h4 style="margin:12px 0 4px;font-size:0.9rem">${cmp.candidate} vs ${cmp.baseline}</h4>
<table>
<tr><th>Metric</th><th>${cmp.baseline}</th><th>${cmp.candidate}</th><th>Mean Δ</th><th>Δ%</th><th>95% CI of paired Δ</th><th>win/tie/loss</th><th>sign p</th><th>n</th></tr>
${cmp.metrics
  .map((m) => {
    // A CI strictly on one side of zero is a consistent shift, not noise.
    const real = m.ci[0] > 0 || m.ci[1] < 0;
    const cls = !real ? "" : m.meanDelta < 0 ? "metric-good" : "metric-bad";
    return `<tr>
  <td><strong>${m.metric}</strong></td>
  <td>${m.baselineMean.toFixed(4)}</td>
  <td>${m.candidateMean.toFixed(4)}</td>
  <td><span class="${cls}">${m.meanDelta.toFixed(4)}</span></td>
  <td><span class="${cls}">${m.deltaPct !== null ? `${m.deltaPct.toFixed(2)}%` : "N/A"}</span></td>
  <td>${m.ci[0].toFixed(4)}&nbsp;&ndash;&nbsp;${m.ci[1].toFixed(4)}</td>
  <td>${m.wins}/${m.ties}/${m.losses}</td>
  <td>${m.signP.toFixed(4)}</td>
  <td>${m.pairs}</td>
</tr>`;
  })
  .join("\n")}
</table>`,
    )
    .join("\n");
}

/**
 * Photographic categories: the primary "natural & realistic" summary. Portrait
 * and Night are natural photographs too — they only carry their own category
 * so the report can break them out.
 */
export const PHOTO_CATEGORIES: ImageCategory[] = [
  "Natural",
  "Portrait",
  "Night",
  "Realistic",
];

/**
 * Canonical LQIP format order, shared by the HTML report and the JSON output.
 *
 * Every ChromaHash tier is listed: `main.ts` orders columns by this array and
 * appends anything absent from it, so a missing tier would silently sort after
 * the competing formats in every table.
 */
export const FORMAT_NAMES = [
  "ChromaHash t0",
  "ChromaHash t1",
  "ChromaHash t2",
  "ChromaHash t3",
  "ChromaHash t4",
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
  opts?: {
    formatNames?: string[];
    showImplementations?: boolean;
    /** Extra HTML injected at the top of the formats tab (the R-D section). */
    preludeHtml?: string;
    /** Render paired A/B tables against the newest released tag (version runs). */
    paired?: boolean;
  },
): string {
  const formatNames = opts?.formatNames ?? FORMAT_NAMES;
  const languages = LANGUAGES;
  // The cross-language verification tab is only meaningful for the cross-format
  // report; the version-comparison report (one chromahash build per column) hides it.
  const showImplementations = opts?.showImplementations ?? true;

  // Compute summary stats: photographic images (primary), and all images
  const naturalFilter = (e: ImageEntry) =>
    PHOTO_CATEGORIES.includes(e.category);
  const naturalStats = computeFormatStats(entries, formatNames, naturalFilter);
  const allStats = computeFormatStats(entries, formatNames);

  // Tune/holdout split summaries (see corpus.ts); the holdout tables only
  // render when holdout entries were actually part of the run.
  const hasHoldout = entries.some((e) => splitFor(e.name) === "holdout");
  const tuneStats = computeFormatStats(
    entries,
    formatNames,
    (e) => splitFor(e.name) === "tune",
  );
  const holdoutStats = computeFormatStats(
    entries,
    formatNames,
    (e) => splitFor(e.name) === "holdout",
  );

  // Paired A/B against the newest released tag. Only version runs put two
  // builds of the same format on the same images, so only they get this.
  const pairedBaseline = opts?.paired ? pickVersionBaseline(formatNames) : null;
  const pairedAll = pairedBaseline
    ? computePairedComparisons(entries, pairedBaseline, formatNames)
    : [];
  const pairedHoldout =
    pairedBaseline && hasHoldout
      ? computePairedComparisons(
          entries.filter((e) => splitFor(e.name) === "holdout"),
          pairedBaseline,
          formatNames,
        )
      : [];

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
    "Alpha (real)",
    "Graphics",
    "Color Distribution",
    "Quantization",
    "Gamut",
    "Text/UI",
    "Illustration",
    "Natural",
    "Portrait",
    "Night",
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
  .map((entry) => {
    // Same per-row normalization box as the cross-format grid, so the two tabs
    // present previews at one consistent scale.
    const box = rowBox(entry.originalWidth, entry.originalHeight);
    return `
<div class="image-row">
  <div class="image-name">${entry.name}</div>
  <div class="image-cell">
    <div class="image-box original-wrap" style="${boxVars(box)}">
      <img class="img-hires" src="${entry.originalDataUri}" alt="Original">
      <img class="img-lores" src="${entry.loResDataUri}" alt="Encoder input">
    </div>
    <div class="label">Original<br>${entry.originalWidth}x${entry.originalHeight}px</div>
  </div>
  ${entry.harnessResults
    .map((r) => {
      const fit = fitInBox(r.decodedWidth, r.decodedHeight, box);
      return `<div class="image-cell">
    <div class="image-box ${r.matches ? "" : "mismatch"}" style="${boxVars(box)}">${r.dataUri ? `<img src="${r.dataUri}" alt="${r.language}" style="${sizeStyle(fit)}">` : '<div class="decode-error">Error</div>'}</div>
    <div class="label ${r.matches ? "pass" : "fail"}">${r.language}</div>
  </div>`;
    })
    .join("\n  ")}
</div>`;
  })
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
  .image-cell { text-align: center; min-width: 128px; max-width: 300px; }
  /* Every cell in a row shares one normalization box, sized by the generator
     from the original's aspect ratio (long edge 150px, short edge floored at
     8px) and passed down as --box-w/--box-h. Formats decode at wildly
     different resolutions -- 4x4 for a minimum-size WebP, 97x100 for
     ChromaHash t3 -- and the old max-width/max-height pair only capped, never
     scaled up, so each preview rendered at its own native size and the small
     ones were invisible. content-box overrides the global border-box so the
     frame sits outside the media area and --box-* is the true rendered size. */
  .image-box {
    box-sizing: content-box;
    width: var(--box-w); height: var(--box-h);
    display: flex; align-items: center; justify-content: center;
    margin: 0 auto;
    border: 1px solid #555;
  }
  body.light .image-box { border-color: #ccc; }
  /* The generator emits each preview's exact contain-fit size, so the element
     is never stretched by the layout; pixelated keeps a 37x-magnified 4x4
     decode reading as the 16 samples it actually stored. */
  .image-box img { display: block; image-rendering: pixelated; }
  body.blur .image-box img { image-rendering: auto; }
  .image-box .decode-error { width: 100%; height: 100%; background: #333; display: flex; align-items: center; justify-content: center; color: #f44; font-size: 0.7rem; }
  .original-wrap { position: relative; }
  /* Both layers fill the box exactly -- the box is built from this original's
     own aspect ratio -- so the hover overlay registers pixel-for-pixel. */
  .original-wrap img { width: 100%; height: 100%; }
  .original-wrap .img-lores { position: absolute; top: 0; left: 0; opacity: 0; transition: opacity 0.15s; }
  .original-wrap:hover .img-lores { opacity: 1; }
  .original-wrap .img-hires { image-rendering: auto; }
  .image-cell .label { font-size: 0.75rem; margin-top: 2px; color: #aaa; }
  body.light .image-cell .label { color: #666; }
  .image-cell .css-preview { width: 100%; height: 100%; }
  .image-name { font-weight: bold; font-size: 0.85rem; min-width: 120px; display: flex; align-items: center; }
  .pass { color: #4caf50; }
  .fail { color: #f44336; font-weight: bold; }
  .image-box.mismatch { outline: 3px solid #f44336; }
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
${opts?.preludeHtml ?? ""}<h2 style="margin-bottom:12px">Cross-Format Comparison</h2>

<h3 style="margin:16px 0 4px;font-size:0.95rem">Photographic Images Only (Natural, Portrait, Night &amp; Realistic)</h3>
${formatStatsTable(naturalStats)}

<details class="methodology">
<summary>All Images (including synthetic test cases)</summary>
<div class="inner">
${formatStatsTable(allStats)}
</div>
</details>
${
  pairedAll.length > 0
    ? `
<h3 style="margin:16px 0 4px;font-size:0.95rem">Paired A/B vs ${pairedBaseline}</h3>
<p class="section-note">Every column differenced against <strong>${pairedBaseline}</strong> <em>per image</em>, then aggregated. The unpaired tables above carry the corpus's image-to-image spread, which dwarfs the difference between two builds of one format; pairing cancels it. <strong>Negative Δ = the candidate is better</strong> (signs are normalized per metric). A 95% CI that excludes zero is a consistent shift rather than noise; the sign test reports direction independently of effect size.</p>
${pairedTable(pairedAll)}
${
  pairedHoldout.length > 0
    ? `<h4 style="margin:16px 0 4px;font-size:0.9rem">Holdout split only</h4>
<p class="section-note">The never-tuned split — the honest number for a wire or constants change.</p>
${pairedTable(pairedHoldout)}`
    : ""
}
`
    : ""
}${
  hasHoldout
    ? `
<h3 style="margin:16px 0 4px;font-size:0.95rem">Tune vs holdout</h3>
<p class="section-note">Constants sweeps tune on the <strong>tune</strong> split only; the untouched <strong>holdout</strong> split (Kodak True Color suite + held-out curated photos) checks that tuned constants generalize instead of overfitting the corpus.</p>
<h4 style="margin:12px 0 4px;font-size:0.9rem">Tune split</h4>
${formatStatsTable(tuneStats)}
<h4 style="margin:12px 0 4px;font-size:0.9rem">Holdout split</h4>
${formatStatsTable(holdoutStats)}
`
    : ""
}
<details class="methodology">
<summary>Per-category statistics</summary>
<div class="inner">
${categories
  .map((category) => {
    const catFilter = (e: ImageEntry) => e.category === category;
    if (!entries.some(catFilter)) return "";
    return `<h4 style="margin:12px 0 4px;font-size:0.9rem">${category}</h4>
${formatStatsTable(computeFormatStats(entries, formatNames, catFilter))}`;
  })
  .join("\n")}
</div>
</details>

<details class="methodology">
<summary>Methodology</summary>
<div class="inner">
<p><strong>Display-resolution comparison</strong>: placeholders are judged at the size they are shown, so every format's decode is upscaled to a display-resolution reference — the original image capped to 512&nbsp;px on the long edge — and scored there. The upscale policy is stamped into the report: <em>browser</em> (gamma-space Mitchell, modeling how a browser stretches an <code>&lt;img&gt;</code>; the default) or <em>linear</em> (linear-light Lanczos-3, the signal-processing-correct resample). Both sides are composited over a white backdrop before scoring, so alpha semantics are defined. An optional <em>blurred</em> metric set scores both sides after a Gaussian blur (σ = longEdge/32), modeling the blur-up presentation. <strong>CIEDE2000 (ΔE00) is the primary metric</strong> — color accuracy dominates perceived quality for low-fidelity placeholders, where PSNR correlates poorly; SSIMULACRA2 and Butteraugli are co-reported as perceptual guards. All metrics are computed by <a href="https://crates.io/crates/iqa-cli"><code>iqa-cli</code></a> (the iqa-rs crate); window-based metrics are omitted (N/A) for images below their minimum size.</p>
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
<p style="margin-top:8px"><strong>Timing</strong>: per-operation averages over the run's iteration count. ChromaHash is measured <em>in-process</em> inside its release-built native binary (<code>bench-encode</code>/<code>bench-decode</code> subcommands; process-spawn cost excluded); the npm formats run in-process in Node. Native vs JS runtimes differ, so compare timings as "native Rust" vs "Node/JS" columns rather than as a single ranking. The version report times all builds by spawn loop instead (old tags predate the bench subcommands) — comparable within that report, not with this one.</p>
</div>
</details>

${categories
  .map((category) => {
    const catEntries = entries.filter((e) => e.category === category);
    if (catEntries.length === 0) return "";
    return `
<div class="section-title">${category}</div>${
      category === "Gamut"
        ? `\n<p class="section-note">ΔE00 is scored in sRGB against the source's color-managed sRGB appearance, so the cross-format comparison stays apples-to-apples; the gamut-aware ChromaHash tiers match it while formats that ignore the source gamut look off (higher ΔE00). The <strong>Display P3</strong> row's Original and every ChromaHash preview are decoded to P3 and tagged with the P3 ICC profile: on a wide-gamut (P3) display they show the true saturated color and match each other, while the sRGB-only formats appear less saturated — ChromaHash renders correctly to the display's gamut.</p>`
        : ""
    }
${catEntries
  .map((entry) => {
    // One box per row, from the original's aspect ratio: every format in the
    // row is then drawn at the same scale, so a 4x4 WebP and a 97x100
    // ChromaHash t3 are compared as displayed rather than as decoded.
    const box = rowBox(entry.originalWidth, entry.originalHeight);
    return `
<div class="image-row">
  <div class="image-name">${entry.name}</div>
  <div class="image-cell">
    <div class="image-box original-wrap" style="${boxVars(box)}">
      <img class="img-hires" src="${entry.originalDataUri}" alt="Original">
      <img class="img-lores" src="${entry.loResDataUri}" alt="Encoder input">
    </div>
    <div class="label">Original<br>${entry.originalWidth}x${entry.originalHeight}px</div>
  </div>
  ${entry.formatResults
    .map((r) => {
      if (r.dataUri.startsWith("css:")) {
        // unpic's blurhashToCssGradientString() returns a bare comma-separated
        // gradient list -- the value of background-image, not a declaration --
        // so the property name is supplied here. The adapter's byte count
        // measures that list, which is what a consumer would actually ship.
        const css = r.dataUri.slice(4);
        return `<div class="image-cell">
      <div class="image-box" style="${boxVars(box)}"><div class="css-preview" style="background-image:${css}"></div></div>
      <div class="label">${r.formatName}<br>${r.decodedWidth}x${r.decodedHeight}px | ${r.encodedSizeBytes}B</div>
    </div>`;
      }
      // All four metrics the format's constants were balanced on, not just the
      // primary: the cross-format story is different on ΔE00 than on the
      // structural guards, and a card showing only ΔE00 hides that.
      const m = (v: number | null, d: number) =>
        v !== null ? v.toFixed(d) : "N/A";
      const ciedeStr =
        r.metrics.ciede2000 !== null
          ? ` | ΔE:${r.metrics.ciede2000.toFixed(2)}`
          : "";
      const dssimStr = `<br>S2:${m(r.metrics.ssimulacra2, 0)} Bu:${m(r.metrics.butteraugli, 1)} DS:${m(r.metrics.dssim, 3)}`;
      const fit = fitInBox(r.decodedWidth, r.decodedHeight, box);
      return `<div class="image-cell">
      <div class="image-box" style="${boxVars(box)}"><img src="${r.dataUri}" alt="${r.formatName}" style="${sizeStyle(fit)}"></div>
      <div class="label">${r.formatName}<br>${r.decodedWidth}x${r.decodedHeight}px | ${r.encodedSizeBytes}B${ciedeStr}${dssimStr}</div>
    </div>`;
    })
    .join("\n  ")}
</div>`;
  })
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
  // `cutout-`/`graphic-` are the curated evaluation corpora (§11.0); `alpha-`,
  // `textui-` and `illust-` are the small generated fixtures that predate them.
  if (base.startsWith("cutout-")) return "Alpha (real)";
  if (base.startsWith("graphic-")) return "Graphics";
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
  if (base.startsWith("textui-")) return "Text/UI";
  if (base.startsWith("illust-")) return "Illustration";
  if (base.startsWith("portrait-")) return "Portrait";
  if (base.startsWith("night-")) return "Night";
  // High-chroma curated photos and the Kodak holdout suite are ordinary
  // photographs — they belong to Natural, not a category of their own.
  if (
    base.startsWith("natural-") ||
    base.startsWith("chroma-") ||
    base.startsWith("kodak")
  )
    return "Natural";
  return "Realistic";
}
