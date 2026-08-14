import type {
  FormatResult,
  RdCurveJson,
  RdJson,
  RdPointJson,
} from "../types.ts";
import { RD_ANCHOR_GRACE, RD_ANCHORS, type RdVariant } from "./lineup.ts";

/** The slice of a processed image entry the R-D aggregation needs. */
interface RdEntryLike {
  formatResults: FormatResult[];
}

/**
 * Aggregate per-image results into per-family rate–distortion curves: one
 * point per variant, each the MEAN over the images that produced a result
 * (unrepresentable byte budgets fail per-image and simply don't contribute).
 */
export function computeRdCurves(
  entries: RdEntryLike[],
  variants: RdVariant[],
): RdJson {
  const curves: RdCurveJson[] = [];
  const byFamily = new Map<string, RdPointJson[]>();

  for (const variant of variants) {
    const name = variant.adapter.name;
    const results = entries.flatMap((e) =>
      e.formatResults.filter((r) => r.formatName === name),
    );
    if (results.length === 0) continue;

    const point: RdPointJson = {
      variant: name,
      bytes:
        results.reduce((s, r) => s + r.encodedSizeBytes, 0) / results.length,
      ciede2000: meanMetric(results, (r) => r.metrics.ciede2000),
      ssimulacra2: meanMetric(results, (r) => r.metrics.ssimulacra2),
      butteraugli: meanMetric(results, (r) => r.metrics.butteraugli),
      imageCount: results.length,
    };

    let points = byFamily.get(variant.family);
    if (!points) {
      points = [];
      byFamily.set(variant.family, points);
      curves.push({ format: variant.family, points });
    }
    points.push(point);
  }

  for (const curve of curves) {
    curve.points.sort((a, b) => a.bytes - b.bytes);
  }
  return { anchors: [...RD_ANCHORS], curves };
}

/** Mean of a nullable per-result metric, or null when never computed. */
function meanMetric(
  results: FormatResult[],
  pick: (r: FormatResult) => number | null,
): number | null {
  const vals = results
    .map(pick)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

// ─── HTML/SVG rendering ─────────────────────────────────────────────────────

/**
 * Per-family series style. Hues come from a CVD-validated categorical palette
 * (validated against the report's dark #1a1a2e and light #f5f5f5 surfaces);
 * hue order is fixed to the family, never its rank. Codec baselines are dashed
 * — the dash is the secondary (non-color) encoding that separates the baseline
 * group from the LQIP formats, including the one reused hue (JXL vs ThumbHash).
 */
const FAMILY_STYLES: Record<
  string,
  { dark: string; light: string; dashed: boolean }
> = {
  ChromaHash: { dark: "#3987e5", light: "#2a78d6", dashed: false },
  // The predecessor shares the family hue (same format lineage) and takes the
  // dash as its secondary, non-color separator — the same device the codec
  // baselines use.
  "ChromaHash v0.6": { dark: "#3987e5", light: "#2a78d6", dashed: true },
  ThumbHash: { dark: "#199e70", light: "#1baf7a", dashed: false },
  BlurHash: { dark: "#c98500", light: "#eda100", dashed: false },
  "lqip-modern": { dark: "#9085e9", light: "#4a3aa7", dashed: false },
  unpic: { dark: "#d55181", light: "#e87ba4", dashed: false },
  WebP: { dark: "#008300", light: "#008300", dashed: true },
  JPEG: { dark: "#e66767", light: "#e34948", dashed: true },
  AVIF: { dark: "#d95926", light: "#eb6834", dashed: true },
  JXL: { dark: "#199e70", light: "#1baf7a", dashed: true },
  RawRGB565: { dark: "#898781", light: "#898781", dashed: true },
};

const FALLBACK_STYLE = { dark: "#898781", light: "#898781", dashed: false };

/** CSS custom-property name for a family's series color. */
function familyVar(family: string): string {
  return `--rd-s-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** Chart geometry (viewBox units; the SVG scales responsively). */
const CHART_W = 720;
const CHART_H = 340;
const MARGIN = { top: 30, right: 18, bottom: 42, left: 56 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

interface ChartPoint {
  bytes: number;
  value: number;
  tooltip: string;
}

interface ChartSeries {
  family: string;
  dashed: boolean;
  points: ChartPoint[];
}

/** Format a byte tick compactly (1000 → "1k"). */
function fmtBytesTick(v: number): string {
  return v >= 1000 ? `${v / 1000}k` : String(v);
}

/** Round to a sensible display precision. */
function fmtNum(v: number, digits: number): string {
  return v.toFixed(digits);
}

/** "Nice" linear ticks covering [lo, hi]. */
function linearTicks(lo: number, hi: number, count: number): number[] {
  const range = hi - lo || 1;
  const rawStep = range / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step / 2; t += step) {
    // Snap floating-point drift so labels render clean.
    ticks.push(Number(t.toFixed(10)));
  }
  return ticks;
}

/**
 * Render one R-D chart: x = mean encoded bytes (log scale), y = a mean metric.
 * Pure SVG, no libraries: polyline + circle markers per family, decade x-ticks,
 * nice y-ticks, and labeled anchor gridlines at the canonical byte anchors.
 */
function renderRdChart(opts: {
  series: ChartSeries[];
  anchors: readonly number[];
  yLabel: string;
  /** Pin the y-axis to zero (for lower-is-better distance metrics). */
  yFromZero: boolean;
  yTickDigits: number;
  /** Direct-label this family's curve (≤1 to keep the plot readable). */
  directLabel: string;
}): string {
  const allPoints = opts.series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return '<p class="section-note">No data points to plot.</p>';
  }

  const xVals = [...allPoints.map((p) => p.bytes), ...opts.anchors];
  const xMin = Math.min(...xVals) / 1.25;
  const xMax = Math.max(...xVals) * 1.25;
  const lx0 = Math.log10(xMin);
  const lx1 = Math.log10(xMax);
  const xPos = (bytes: number): number =>
    MARGIN.left + ((Math.log10(bytes) - lx0) / (lx1 - lx0)) * PLOT_W;

  const yVals = allPoints.map((p) => p.value);
  const yLo = opts.yFromZero
    ? Math.min(0, ...yVals)
    : Math.min(0, ...yVals) - 0.05 * (Math.max(...yVals) - Math.min(...yVals));
  const yHi = Math.max(...yVals) + 0.08 * (Math.max(...yVals) - yLo || 1);
  const yPos = (v: number): number =>
    MARGIN.top + ((yHi - v) / (yHi - yLo || 1)) * PLOT_H;

  const parts: string[] = [];

  // Y gridlines + labels (recessive hairlines, muted ink).
  for (const tick of linearTicks(yLo, yHi, 6)) {
    const y = yPos(tick);
    parts.push(
      `<line x1="${MARGIN.left}" y1="${fmtNum(y, 1)}" x2="${MARGIN.left + PLOT_W}" y2="${fmtNum(y, 1)}" class="rd-grid"/>`,
      `<text x="${MARGIN.left - 8}" y="${fmtNum(y + 3.5, 1)}" text-anchor="end" class="rd-tick">${fmtNum(tick, opts.yTickDigits)}</text>`,
    );
  }

  // X decade ticks.
  for (let e = Math.ceil(lx0); e <= Math.floor(lx1); e++) {
    const v = 10 ** e;
    const x = xPos(v);
    parts.push(
      `<line x1="${fmtNum(x, 1)}" y1="${MARGIN.top}" x2="${fmtNum(x, 1)}" y2="${MARGIN.top + PLOT_H}" class="rd-grid"/>`,
      `<text x="${fmtNum(x, 1)}" y="${MARGIN.top + PLOT_H + 16}" text-anchor="middle" class="rd-tick">${fmtBytesTick(v)}</text>`,
    );
  }

  // Anchor gridlines (the canonical byte budgets), labeled above the plot.
  for (const anchor of opts.anchors) {
    const x = xPos(anchor);
    parts.push(
      `<line x1="${fmtNum(x, 1)}" y1="${MARGIN.top}" x2="${fmtNum(x, 1)}" y2="${MARGIN.top + PLOT_H}" class="rd-anchor-line"/>`,
      `<text x="${fmtNum(x, 1)}" y="${MARGIN.top - 8}" text-anchor="middle" class="rd-anchor-label">${anchor}B</text>`,
    );
  }

  // Axes baseline.
  parts.push(
    `<line x1="${MARGIN.left}" y1="${MARGIN.top + PLOT_H}" x2="${MARGIN.left + PLOT_W}" y2="${MARGIN.top + PLOT_H}" class="rd-axis"/>`,
    `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + PLOT_H}" class="rd-axis"/>`,
  );

  // Series: polyline + markers (with a surface ring so overlaps stay legible).
  for (const s of opts.series) {
    if (s.points.length === 0) continue;
    const color = `var(${familyVar(s.family)})`;
    const coords = s.points.map((p) => ({
      x: xPos(p.bytes),
      y: yPos(p.value),
    }));
    if (coords.length > 1) {
      const d = coords
        .map(
          (c, i) => `${i === 0 ? "M" : "L"}${fmtNum(c.x, 1)} ${fmtNum(c.y, 1)}`,
        )
        .join(" ");
      parts.push(
        `<path d="${d}" fill="none" stroke-width="2"${s.dashed ? ' stroke-dasharray="6 4"' : ""} style="stroke:${color}"/>`,
      );
    }
    s.points.forEach((p, i) => {
      const c = coords[i];
      if (!c) return;
      parts.push(
        `<circle cx="${fmtNum(c.x, 1)}" cy="${fmtNum(c.y, 1)}" r="4" stroke-width="2" class="rd-marker" style="fill:${color}"><title>${p.tooltip}</title></circle>`,
      );
    });
    if (s.family === opts.directLabel) {
      const last = coords[coords.length - 1];
      if (last) {
        parts.push(
          `<text x="${fmtNum(last.x, 1)}" y="${fmtNum(last.y - 10, 1)}" text-anchor="end" class="rd-series-label">${s.family}</text>`,
        );
      }
    }
  }

  // Axis captions.
  parts.push(
    `<text x="${MARGIN.left + PLOT_W / 2}" y="${CHART_H - 8}" text-anchor="middle" class="rd-tick">mean encoded bytes (log scale)</text>`,
    `<text x="8" y="${MARGIN.top - 8}" text-anchor="start" class="rd-tick">${opts.yLabel}</text>`,
  );

  return `<svg viewBox="0 0 ${CHART_W} ${CHART_H}" role="img" aria-label="${opts.yLabel} versus encoded bytes" class="rd-chart">${parts.join("")}</svg>`;
}

/** Build chart series for one metric from the aggregated curves. */
function chartSeries(
  curves: RdCurveJson[],
  pick: (p: RdPointJson) => number | null,
  metricLabel: string,
  digits: number,
): ChartSeries[] {
  return curves.map((curve) => {
    const style = FAMILY_STYLES[curve.format] ?? FALLBACK_STYLE;
    return {
      family: curve.format,
      dashed: style.dashed,
      points: curve.points.flatMap((p) => {
        const value = pick(p);
        if (value === null) return [];
        return [
          {
            bytes: p.bytes,
            value,
            tooltip: `${p.variant}\n${p.bytes.toFixed(0)}B · ${metricLabel} ${value.toFixed(digits)} (mean of ${p.imageCount})`,
          },
        ];
      }),
    };
  });
}

/** Legend: one entry per family, swatch carrying both hue and dash. */
function renderLegend(curves: RdCurveJson[]): string {
  const items = curves
    .map((curve) => {
      const style = FAMILY_STYLES[curve.format] ?? FALLBACK_STYLE;
      const color = `var(${familyVar(curve.format)})`;
      return `<span class="rd-legend-item"><svg viewBox="0 0 34 12" class="rd-legend-swatch" aria-hidden="true"><line x1="1" y1="6" x2="33" y2="6" stroke-width="2"${style.dashed ? ' stroke-dasharray="5 3"' : ""} style="stroke:${color}"/><circle cx="17" cy="6" r="4" stroke-width="2" class="rd-marker" style="fill:${color}"/></svg>${curve.format}</span>`;
    })
    .join("");
  return `<div class="rd-legend">${items}<span class="rd-legend-note">dashed = codec baseline / control</span></div>`;
}

/** Format a nullable mean metric cell. */
function cell(v: number | null, digits: number): string {
  return v !== null ? v.toFixed(digits) : "N/A";
}

/**
 * Equal-budget anchor table: per anchor, each family's best (lowest mean ΔE00)
 * variant whose mean bytes fit within the anchor's grace window.
 */
function renderAnchorTable(rd: RdJson): string {
  const rows: string[] = [];
  for (const anchor of rd.anchors) {
    const budget = anchor * RD_ANCHOR_GRACE;
    // Each family's best fitting variant (lowest mean ΔE00 within budget).
    const fits = rd.curves.map((curve) => {
      let best: RdPointJson | null = null;
      for (const p of curve.points) {
        if (p.bytes > budget || p.ciede2000 === null) continue;
        if (
          best === null ||
          best.ciede2000 === null ||
          p.ciede2000 < best.ciede2000
        ) {
          best = p;
        }
      }
      return { family: curve.format, best };
    });
    // The anchor's overall ΔE00 winner, starred in its row.
    let winner: string | null = null;
    let winnerCiede = Number.POSITIVE_INFINITY;
    for (const f of fits) {
      const ciede = f.best !== null ? f.best.ciede2000 : null;
      if (ciede !== null && ciede < winnerCiede) {
        winner = f.family;
        winnerCiede = ciede;
      }
    }

    fits.forEach((f, i) => {
      const anchorCell =
        i === 0
          ? `<td rowspan="${fits.length}" class="rd-anchor-cell"><strong>${anchor}B</strong></td>`
          : "";
      if (f.best === null) {
        rows.push(
          `<tr>${anchorCell}<td>${f.family}</td><td colspan="5" class="rd-na">N/A — no variant fits ≤ ${Math.round(budget)}B</td></tr>`,
        );
        return;
      }
      const star = f.family === winner ? " ★" : "";
      const cls = f.family === winner ? ' class="rd-best"' : "";
      rows.push(
        `<tr${cls}>${anchorCell}<td>${f.family}${star}</td><td>${f.best.variant}</td><td>${f.best.bytes.toFixed(0)}</td><td>${cell(f.best.ciede2000, 2)}</td><td>${cell(f.best.ssimulacra2, 1)}</td><td>${cell(f.best.butteraugli, 2)}</td></tr>`,
      );
    });
  }
  return `<table class="rd-anchor-table">
<tr><th>Anchor</th><th>Family</th><th>Best variant</th><th>Mean bytes</th><th>ΔE00 ↓</th><th>SSIMULACRA2 ↑</th><th>Butteraugli ↓</th></tr>
${rows.join("\n")}
</table>`;
}

/** Scoped styles for the R-D section, themed for both report modes. */
function rdStyles(curves: RdCurveJson[]): string {
  const darkVars = curves
    .map((c) => {
      const s = FAMILY_STYLES[c.format] ?? FALLBACK_STYLE;
      return `${familyVar(c.format)}: ${s.dark};`;
    })
    .join(" ");
  const lightVars = curves
    .map((c) => {
      const s = FAMILY_STYLES[c.format] ?? FALLBACK_STYLE;
      return `${familyVar(c.format)}: ${s.light};`;
    })
    .join(" ");
  return `<style>
  .rd-section { --rd-surface: #222244; --rd-grid: #32325a; --rd-axis: #4a4a72; --rd-ink: #e0e0e0; --rd-muted: #9a9ab8; --rd-anchor: #7a7aa8; ${darkVars} }
  body.light .rd-section { --rd-surface: #fff; --rd-grid: #e1e0d9; --rd-axis: #c3c2b7; --rd-ink: #0b0b0b; --rd-muted: #898781; --rd-anchor: #a3a29b; ${lightVars} }
  .rd-charts { display: flex; flex-wrap: wrap; gap: 16px; margin: 12px 0; }
  .rd-chart-box { flex: 1 1 480px; min-width: 320px; background: var(--rd-surface); border-radius: 4px; padding: 10px 12px 6px; }
  body.light .rd-chart-box { border: 1px solid #ddd; }
  .rd-chart-box h4 { margin: 0 0 4px; font-size: 0.9rem; color: var(--rd-ink); }
  .rd-chart { width: 100%; height: auto; display: block; }
  .rd-grid { stroke: var(--rd-grid); stroke-width: 1; }
  .rd-axis { stroke: var(--rd-axis); stroke-width: 1; }
  .rd-anchor-line { stroke: var(--rd-anchor); stroke-width: 1; stroke-dasharray: 2 3; }
  .rd-anchor-label { fill: var(--rd-anchor); font-size: 11px; font-family: inherit; }
  .rd-tick { fill: var(--rd-muted); font-size: 11px; font-family: inherit; font-variant-numeric: tabular-nums; }
  .rd-series-label { fill: var(--rd-ink); font-size: 11px; font-weight: 600; font-family: inherit; }
  .rd-marker { stroke: var(--rd-surface); }
  .rd-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; margin: 8px 0; font-size: 0.82rem; color: var(--rd-ink); }
  .rd-legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .rd-legend-swatch { width: 34px; height: 12px; }
  .rd-legend-note { color: var(--rd-muted); font-size: 0.75rem; }
  .rd-anchor-table .rd-anchor-cell { vertical-align: top; }
  .rd-anchor-table .rd-na { color: var(--rd-muted); font-style: italic; text-align: left; }
  .rd-anchor-table tr.rd-best td { background: rgba(74, 74, 255, 0.14); font-weight: 600; }
</style>`;
}

/**
 * The R-D section injected at the top of the report: two rate–distortion
 * charts (ΔE00 and SSIMULACRA2 vs bytes, log-x) and the equal-budget anchor
 * table. Everything is inline SVG/CSS — self-contained like the rest of the
 * report.
 */
export function generateRdSection(rd: RdJson, imageCount: number): string {
  const ciedeChart = renderRdChart({
    series: chartSeries(rd.curves, (p) => p.ciede2000, "ΔE00", 2),
    anchors: rd.anchors,
    yLabel: "mean ΔE00 ↓",
    yFromZero: true,
    yTickDigits: 0,
    directLabel: "ChromaHash",
  });
  const ssim2Chart = renderRdChart({
    series: chartSeries(rd.curves, (p) => p.ssimulacra2, "SSIMULACRA2", 1),
    anchors: rd.anchors,
    yLabel: "mean SSIMULACRA2 ↑",
    yFromZero: false,
    yTickDigits: 0,
    directLabel: "ChromaHash",
  });

  return `${rdStyles(rd.curves)}
<div class="rd-section">
<h2 style="margin-bottom:4px">Rate–Distortion: which format wins at equal byte cost</h2>
<p class="section-note">Each family's quality knob is swept and every point is the <strong>mean over ${imageCount} photographic image${imageCount === 1 ? "" : "s"}</strong> (bytes and metrics alike). Anchor gridlines mark the four ChromaHash tier sizes — the canonical byte budgets the codec baselines (dashed) target. WebP/JPEG/AVIF/JXL are real encoder files at the budget; RawRGB565 is the codec-free control (raw pixels, no header counted).</p>
${renderLegend(rd.curves)}
<div class="rd-charts">
<div class="rd-chart-box"><h4>Color error — mean ΔE00 (lower is better)</h4>${ciedeChart}</div>
<div class="rd-chart-box"><h4>Perceptual quality — mean SSIMULACRA2 (higher is better)</h4>${ssim2Chart}</div>
</div>
<h3 style="margin:16px 0 4px;font-size:0.95rem">Equal-budget anchors</h3>
<p class="section-note">Per anchor: each family's best variant whose mean size fits the budget with ${Math.round((RD_ANCHOR_GRACE - 1) * 100)}% grace (≤ anchor × ${RD_ANCHOR_GRACE}). ★ marks the anchor's ΔE00 winner. N/A = the family cannot hit the budget at all (e.g. AVIF's container floor at 32B).</p>
${renderAnchorTable(rd)}
</div>`;
}
