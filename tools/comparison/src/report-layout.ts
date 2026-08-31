/**
 * The Layout tab: how much the page moves when the real image replaces the
 * placeholder.
 *
 * Every other metric in this report is blind to this, and says so —
 * `upscaleRgba` stretches each decode back into the reference frame before
 * scoring, so a format that decodes to the wrong shape is scored as though it
 * had not. See `aspect.ts`.
 */

import {
  aspectFidelity,
  CHROMAHASH_RASTER_CAVEAT,
  encoderInputFloor,
  REFLOW_CONTAINER_PX,
} from "./aspect.ts";
import { METRIC_DOCS } from "./report-metrics.ts";
import type { FormatResult, FormatStat } from "./types.ts";

/** The slice of a report entry this tab needs. */
export interface LayoutEntry {
  name: string;
  originalWidth: number;
  originalHeight: number;
  smallWidth: number;
  smallHeight: number;
  formatResults: FormatResult[];
}

/** Width, in CSS px, of the reservation diagrams. */
const DIAGRAM_W = 132;

function fmt(v: number | null, digits: number): string {
  return v !== null ? v.toFixed(digits) : "N/A";
}

/**
 * Ranked table, best first. Formats that declare no size are not ranked at all
 * — they are listed underneath with the reason, because a zero here would read
 * as perfect layout fidelity rather than as "no answer".
 */
function layoutTable(stats: FormatStat[], floorPct: number | null): string {
  const scored = stats
    .filter((s) => s.aspectImages > 0)
    .sort(
      (a, b) =>
        (a.maxAbsReflowPx ?? Number.POSITIVE_INFINITY) -
        (b.maxAbsReflowPx ?? Number.POSITIVE_INFINITY),
    );
  const unscored = stats.filter((s) => s.aspectImages === 0);

  const best = scored[0]?.maxAbsReflowPx ?? null;
  const rows = scored
    .map((s) => {
      const winner = best !== null && s.maxAbsReflowPx === best;
      return `<tr${winner ? ' class="row-best"' : ""}>
  <td class="name">${winner ? "★ " : ""}<strong>${s.name}</strong></td>
  <td>${fmt(s.avgAspectErrorPct, 2)}%</td>
  <td>${fmt(s.p90AspectErrorPct, 2)}%</td>
  <td><strong>${fmt(s.maxAbsReflowPx, 0)}&nbsp;px</strong></td>
  <td>${s.aspectImages}</td>
</tr>`;
    })
    .join("\n");

  const floorRow =
    floorPct !== null
      ? `<tr class="row-floor">
  <td class="name"><em>This harness's own encoder input</em></td>
  <td>${floorPct.toFixed(2)}%</td>
  <td>—</td>
  <td>—</td>
  <td>—</td>
</tr>`
      : "";

  const absentRows = unscored
    .map(
      (s) =>
        `<tr class="row-absent">
  <td class="name"><strong>${s.name}</strong></td>
  <td colspan="4" title="${(s.aspectAbsentReason ?? "").replace(/"/g, "&quot;")}">— carries no shape of its own; the dimensions must come from somewhere else</td>
</tr>`,
    )
    .join("\n");

  return `<table class="layout-table">
<tr>
  <th>Format</th>
  <th><a class="metric-link" href="#metric-aspect">Aspect error</a> ↓</th>
  <th>p90 ↓</th>
  <th><a class="metric-link" href="#metric-reflow">Worst reflow</a> ↓</th>
  <th>Images</th>
</tr>
${rows}
${floorRow}
${absentRows}
</table>`;
}

/**
 * One reservation diagram: the box a page would reserve from the placeholder's
 * shape, with the height the real image actually needs drawn across it. The gap
 * between the two is the reflow, at the scale it would happen.
 */
function diagram(
  declaredW: number,
  declaredH: number,
  originalW: number,
  originalH: number,
  label: string,
  reflowPx: number,
): string {
  const arDeclared = declaredW / declaredH;
  const arOriginal = originalW / originalH;
  const reservedH = DIAGRAM_W / arDeclared;
  const trueH = DIAGRAM_W / arOriginal;
  const boxH = Math.max(reservedH, trueH);
  const sign = reflowPx > 0 ? "+" : "";
  return `<div class="res-cell">
  <div class="res-stage" style="width:${DIAGRAM_W}px;height:${boxH.toFixed(1)}px">
    <div class="res-reserved" style="height:${reservedH.toFixed(1)}px"></div>
    <div class="res-true" style="top:${trueH.toFixed(1)}px"></div>
  </div>
  <div class="res-label">${label}<br><span class="${Math.abs(reflowPx) < 1 ? "metric-good" : Math.abs(reflowPx) < 20 ? "metric-warn" : "metric-bad"}">${sign}${reflowPx.toFixed(0)} px</span></div>
</div>`;
}

/** Pick images spanning the widest range of aspect ratios, for the diagrams. */
function pickDiverse(entries: LayoutEntry[], n: number): LayoutEntry[] {
  const withAr = entries
    .filter((e) => e.originalWidth > 0 && e.originalHeight > 0)
    .map((e) => ({ e, ar: Math.log2(e.originalWidth / e.originalHeight) }))
    .sort((a, b) => a.ar - b.ar);
  if (withAr.length <= n) return withAr.map((x) => x.e);
  // Even strides through the sorted range, so portrait and landscape extremes
  // both appear rather than n near-identical 3:2 photographs.
  const out: LayoutEntry[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (withAr.length - 1)) / (n - 1));
    const pick = withAr[idx];
    if (pick && !out.includes(pick.e)) out.push(pick.e);
  }
  return out;
}

export function renderLayoutTab(
  entries: LayoutEntry[],
  stats: FormatStat[],
): string {
  if (entries.length === 0) return "";

  // The harness's own contribution, averaged: how far the <=100px encoder input
  // already is from the original before any format sees it.
  const floors = entries
    .map((e) =>
      encoderInputFloor(
        e.smallWidth,
        e.smallHeight,
        e.originalWidth,
        e.originalHeight,
      ),
    )
    .filter((f): f is NonNullable<typeof f> => f !== null);
  const floorPct =
    floors.length > 0
      ? (2 ** (floors.reduce((a, f) => a + f.log2Error, 0) / floors.length) -
          1) *
        100
      : null;

  const sample = pickDiverse(entries, 4);
  const diagrams = sample
    .map((e) => {
      const cells = e.formatResults
        .map((r) => {
          if (r.intrinsicSize.kind !== "declared") return "";
          const a = aspectFidelity(
            r.intrinsicSize,
            e.originalWidth,
            e.originalHeight,
          );
          if (!a) return "";
          return diagram(
            r.intrinsicSize.width,
            r.intrinsicSize.height,
            e.originalWidth,
            e.originalHeight,
            r.formatName,
            a.reflowPx,
          );
        })
        .filter(Boolean)
        .join("\n");
      if (!cells) return "";
      return `<div class="res-row">
  <div class="res-title">${e.name}<br><span class="res-dim">${e.originalWidth}&times;${e.originalHeight}</span></div>
  ${cells}
</div>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<h2>Layout: how far the page moves</h2>
<p class="lede">A placeholder also reserves space. If its shape is wrong, the page reflows the moment the real image arrives — text jumps, and whatever the reader was looking at moves. <strong>Every other metric on this page is blind to this</strong>, because they stretch the placeholder back into the correct frame before scoring it.</p>
<p class="section-note">${METRIC_DOCS.reflow.why} Sorted best first; ★ marks the winner. <em>Worst reflow</em> is the largest shift across the set rather than the average, because a page is judged by its worst jump, not its typical one.</p>

${layoutTable(stats, floorPct)}

<p class="section-note">${CHROMAHASH_RASTER_CAVEAT}</p>
<p class="section-note">The <em>encoder input</em> row is this harness measuring itself: every format here is handed the image downscaled to at most 100&nbsp;px on its long edge, and that downscale already rounds the shape. That much of every figure above is the harness, not the format. A production pipeline hands its encoder the original dimensions and would not pay it.</p>

<h3>Side by side, at ${REFLOW_CONTAINER_PX}&nbsp;px</h3>
<p class="section-note">Each box is the space a page would reserve from that format's placeholder in a ${DIAGRAM_W}&nbsp;px column; the dashed line is where the real image actually ends. The gap between them is the jump, and the caption gives it at ${REFLOW_CONTAINER_PX}&nbsp;px. Formats carrying no shape of their own are omitted — there is nothing to draw.</p>
${diagrams}`;
}

/** Scoped styles for this tab; concatenated like `rd/report.ts` does. */
export const layoutStyles = `<style>
  .layout-table td.name { text-align: left; }
  .layout-table tr.row-best { background: rgba(76, 175, 80, 0.12); }
  .layout-table tr.row-floor { opacity: 0.72; font-style: italic; }
  .layout-table tr.row-absent td { color: #999; font-style: italic; }
  body.light .layout-table tr.row-absent td { color: #777; }
  .res-row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap;
             margin: 10px 0; padding: 10px; background: #222244; border-radius: 4px; }
  body.light .res-row { background: #fff; border: 1px solid #ddd; }
  .res-title { min-width: 130px; font-size: 0.8rem; font-weight: 600; align-self: center; }
  .res-dim { font-weight: 400; color: #aaa; font-size: 0.72rem; }
  body.light .res-dim { color: #666; }
  .res-cell { text-align: center; }
  .res-stage { position: relative; }
  .res-reserved { position: absolute; top: 0; left: 0; right: 0;
                  background: rgba(74, 74, 255, 0.28); border: 1px solid #4a4aff; }
  .res-true { position: absolute; left: 0; right: 0; height: 0;
              border-top: 2px dashed #ff9800; }
  .res-label { font-size: 0.7rem; margin-top: 3px; color: #aaa; line-height: 1.35; }
  body.light .res-label { color: #666; }
</style>`;
