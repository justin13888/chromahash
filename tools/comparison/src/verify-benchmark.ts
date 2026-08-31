/**
 * Checks the numbers in `spec/PERFORMANCE.md` against the perf runs that
 * produced them.
 *
 * The document is transcribed by hand from `mise run benchmark`, and until this
 * script existed nothing noticed when the transcription and the committed run
 * disagreed. They did, extensively: the 2026-08-29 baseline was a `bounded` run
 * taken from a dirty tree, while §2's per-tier table, §3's scaling table, §4's
 * first lever table, §5's tier-0 row and the whole of §6 quoted a `--full` run
 * that was never committed. Nine of §2's ten values disagreed with or had no
 * cell; §3's 512x512 was off by 9.6%; §6's separable-DCT table could not have
 * come from the harness at all, because no `dct_separable` arm existed in it.
 *
 * That is precisely the failure §11 indicts `spec/README` §14 for, so the
 * document had reproduced the thing it was written to correct.
 *
 * This closes the loop. Tables are parsed out of the document, so no number is
 * transcribed twice; only the *binding* — which cell a column means — is
 * written by hand below. A documented value passes when it equals the cell
 * value rounded to the precision the document itself uses, so the check is
 * exact rather than tolerance-based, and tightening a figure in the document
 * tightens the assertion with it.
 *
 * Usage:
 *   node dist/verify-benchmark.js                # every bound table
 *   node dist/verify-benchmark.js --list-unbound # tables with no binding, and why
 *   node dist/verify-benchmark.js --section 7
 *
 * Exit status is non-zero on any disagreement, so `mise run verify:benchmark`
 * gates a documentation change the way `mise run rd:gate` gates a quality one.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const DOC = path.join(REPO_ROOT, "spec/PERFORMANCE.md");
const BASELINE_DIR = path.join(REPO_ROOT, "tools/comparison/baselines");

/** The committed runs, in the order a lookup prefers them. */
const BASELINES = ["perf-report-full.json", "perf-report.json"] as const;

/**
 * Two runs of the same cell agree to about this much on a quiet machine. Used
 * only to flag disagreement *between* the committed runs, never to accept a
 * documented number — those are checked exactly.
 */
const CROSS_RUN_TOLERANCE = 0.1;

// ─── The document, as tables ────────────────────────────────────────────────

interface DocTable {
  section: string;
  index: number;
  line: number;
  header: string[];
  rows: string[][];
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const isSeparator = (line: string): boolean =>
  /^\s*\|[\s:|-]+\|\s*$/.test(line) && line.includes("-");

function parseTables(markdown: string): DocTable[] {
  const lines = markdown.split("\n");
  const tables: DocTable[] = [];
  let section = "0";
  let indexInSection = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = /^#{2,3}\s+([0-9]+(?:\.[0-9]+)?)[.\s]/.exec(line);
    if (heading?.[1]) {
      section = heading[1];
      indexInSection = 0;
      continue;
    }
    if (!line.trimStart().startsWith("|")) continue;
    if (!isSeparator(lines[i + 1] ?? "")) continue;

    const header = cells(line);
    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const body = lines[j] ?? "";
      if (!body.trimStart().startsWith("|")) break;
      rows.push(cells(body));
    }
    tables.push({
      section,
      index: indexInSection++,
      line: i + 1,
      header,
      rows,
    });
    i = j - 1;
  }
  return tables;
}

// ─── A documented number ────────────────────────────────────────────────────

type Unit = "us" | "ms" | "s" | "ratio" | "percent";

interface DocNumber {
  value: number;
  unit: Unit;
  /** Decimal places the document used, which is the precision it is held to. */
  decimals: number;
}

/**
 * Read one table cell as a number. Markdown emphasis, thousands separators and
 * the unicode minus all appear in the document and none of them are data.
 * Returns null for a cell that is deliberately not a measurement — an em dash,
 * a "not measured", a prose note.
 */
function parseDocNumber(raw: string): DocNumber | null {
  const text = raw
    .replace(/\*\*/g, "")
    .replace(/[*_`]/g, "")
    .replace(/−/g, "-")
    .replace(/,/g, "")
    .trim();
  const m = /^(-?[0-9]+(?:\.[0-9]+)?)\s*(µs|us|ms|s|×|x|%)?$/.exec(text);
  if (!m?.[1]) return null;
  const value = Number.parseFloat(m[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = m[2];
  const unit: Unit =
    suffix === "µs" || suffix === "us"
      ? "us"
      : suffix === "ms"
        ? "ms"
        : suffix === "s"
          ? "s"
          : suffix === "%"
            ? "percent"
            : suffix === "×" || suffix === "x"
              ? "ratio"
              : "ratio";
  const dot = m[1].indexOf(".");
  return { value, unit, decimals: dot < 0 ? 0 : m[1].length - dot - 1 };
}

const TIME_UNITS = new Set<Unit>(["us", "ms", "s"]);
const PER_US: Record<string, number> = { us: 1, ms: 1e3, s: 1e6 };

// ─── The committed runs ─────────────────────────────────────────────────────

interface Cell {
  id: string;
  /** chromahash-perf/2. Older runs reported the median as the headline. */
  nsPerOp?: number;
  medianNsPerOp: number;
  iqrPct: number;
  noisy: boolean;
  iters: number;
}

interface RunDoc {
  file: string;
  git: { commit: string; dirty: boolean };
  environment: { cpuModel: string; arch: string; cores: number };
  config: { mode: string; reps: number };
  cells: Cell[];
}

class Runs {
  private readonly byId = new Map<
    string,
    { us: number; cell: Cell; from: string }
  >();
  readonly loaded: RunDoc[] = [];
  readonly conflicts: string[] = [];
  readonly dirty: string[] = [];

  constructor(files: string[]) {
    for (const file of files) {
      const full = path.join(BASELINE_DIR, file);
      if (!existsSync(full)) continue;
      const doc = JSON.parse(readFileSync(full, "utf8")) as RunDoc;
      doc.file = file;
      this.loaded.push(doc);
      if (doc.git?.dirty) this.dirty.push(file);

      const seen = new Set<string>();
      for (const c of doc.cells) {
        if (seen.has(c.id)) {
          this.conflicts.push(`${file}: duplicate cell id ${c.id}`);
          continue;
        }
        seen.add(c.id);
        const us = (c.nsPerOp ?? c.medianNsPerOp) / 1000;
        const prior = this.byId.get(c.id);
        if (!prior) {
          this.byId.set(c.id, { us, cell: c, from: file });
          continue;
        }
        const delta = Math.abs(prior.us - us) / Math.min(prior.us, us);
        if (delta > CROSS_RUN_TOLERANCE) {
          this.conflicts.push(
            `${c.id}: ${prior.from} says ${prior.us.toFixed(1)} us, ` +
              `${file} says ${us.toFixed(1)} us (${(delta * 100).toFixed(1)}% apart)`,
          );
        }
      }
    }
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** Median microseconds per op. Throws if the id is not in any committed run. */
  us(id: string): number {
    const hit = this.byId.get(id);
    if (!hit) throw new MissingCell(id);
    return hit.us;
  }

  cell(id: string): Cell | null {
    return this.byId.get(id)?.cell ?? null;
  }

  get ids(): string[] {
    return [...this.byId.keys()].sort();
  }
}

class MissingCell extends Error {
  constructor(readonly id: string) {
    super(`no cell "${id}" in any committed run`);
  }
}

// ─── Bindings ───────────────────────────────────────────────────────────────
//
// The one hand-written part: which cell each column of each table means. A
// resolver receives the whole row (so it can read a tier from one column and a
// size from another) and returns microseconds for a time column, or a bare
// number for a ratio or percentage. Returning null marks a cell as deliberately
// unbound — a quality figure carried from EXPERIMENTS.md, a cold-start wall
// clock the perf driver does not measure, an em dash.

/** Images per batch, matching the `bench-batch` argv the driver emits. */
const BATCH_COUNT = 200;

/** Encoded length per tier code, no alpha (spec 3.5). */
const TIER_BYTES: Record<number, number> = {
  0: 21,
  1: 32,
  2: 108,
  3: 411,
  4: 1623,
};

/** Reads a named column out of the row being checked. */
type Row = (column: string) => string;
type Resolve = (row: Row, R: Runs) => number | null;

interface Binding {
  section: string;
  index: number;
  title: string;
  /** Column header (exact) -> resolver. Unlisted columns are not checked. */
  columns: Record<string, Resolve>;
}

const clean = (s: string): string => s.replace(/[*`]/g, "").trim();

/**
 * A header or row label without its parenthetical aside: the document writes
 * "auto (12)" for the thread count and "shipped (scale_fit=2 ...)" for the
 * lever, and in both the parenthesis is commentary, not the name.
 */
const bare = (s: string): string =>
  clean(s)
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();

/** "tier 3", "3 (archival)", "t3" -> 3 */
function tierOf(raw: string): number | null {
  const m = /^(?:tier\s*)?t?([0-4])\b/.exec(clean(raw));
  return m?.[1] ? Number.parseInt(m[1], 10) : null;
}

/** "512×512", "512x512" -> 512; non-square or unparseable -> null */
function sizeOf(raw: string): number | null {
  const m = /^([0-9]+)\s*[×x]\s*([0-9]+)$/.exec(clean(raw));
  return m?.[1] && m[1] === m[2] ? Number.parseInt(m[1], 10) : null;
}

const ratio = (slow: number, fast: number): number => slow / fast;

/** A lever's cell id, keyed by the arm label the driver records. */
const armId = (n: number, arm: string): string =>
  `encode/Rust/t1/${n}x${n}/gradient/${bare(arm)}`;

function timeOr<T>(R: Runs, id: string): number | null {
  return R.has(id) ? R.us(id) : null;
}

const BINDINGS: Binding[] = [
  {
    section: "2",
    index: 0,
    title: "Cost per tier (Rust, 100x100 gradient)",
    columns: {
      bytes: (row) => {
        const t = tierOf(row("tier"));
        return t === null ? null : (TIER_BYTES[t] ?? null);
      },
      encode: (row, R) => {
        const t = tierOf(row("tier"));
        return t === null ? null : R.us(`encode/Rust/t${t}/100x100/gradient`);
      },
      decode: (row, R) => {
        const t = tierOf(row("tier"));
        return t === null ? null : R.us(`decode/Rust/t${t}/natural`);
      },
    },
  },
  {
    section: "2",
    index: 1,
    title: "Capped decode against natural",
    columns: {
      natural: (row, R) => {
        const t = tierOf(row("tier"));
        return t === null ? null : R.us(`decode/Rust/t${t}/natural`);
      },
      "capped 32×32": (row, R) => {
        const t = tierOf(row("tier"));
        return t === null ? null : R.us(`decode/Rust/t${t}/capped32`);
      },
      saving: (row, R) => {
        const t = tierOf(row("tier"));
        if (t === null) return null;
        return ratio(
          R.us(`decode/Rust/t${t}/natural`),
          R.us(`decode/Rust/t${t}/capped32`),
        );
      },
    },
  },
  {
    section: "3",
    index: 0,
    title: "Encode scaling in source pixels (Rust, tier 1)",
    columns: {
      encode: (row, R) => {
        const n = sizeOf(row("source"));
        return n === null ? null : R.us(`encode/Rust/t1/${n}x${n}/gradient`);
      },
      "per megapixel": (row, R) => {
        const n = sizeOf(row("source"));
        if (n === null) return null;
        // Reported in ms per megapixel.
        return (
          R.us(`encode/Rust/t1/${n}x${n}/gradient`) / 1000 / ((n * n) / 1e6)
        );
      },
    },
  },
  {
    section: "4",
    index: 0,
    title: "Encoder-only levers at 100x100, tier 1",
    columns: {
      encode: (row, R) => timeOr(R, armId(100, row("lever"))),
      "vs shipped": (row, R) => {
        const arm = armId(100, row("lever"));
        const base = armId(100, "shipped");
        if (!R.has(arm) || !R.has(base)) return null;
        return ((R.us(arm) - R.us(base)) / R.us(base)) * 100;
      },
    },
  },
  {
    section: "4",
    index: 1,
    title: "The same levers at 100x100 and 512x512",
    columns: {
      "100×100": (row, R) => timeOr(R, armId(100, row("lever"))),
      "512×512": (row, R) => timeOr(R, armId(512, row("lever"))),
    },
  },
  {
    section: "5",
    index: 0,
    title: "The simd feature, default build against --no-default-features",
    columns: {
      SIMD: (row, R) => {
        const n = sizeOf(row("source"));
        const t = tierOf(row("tier"));
        return n === null || t === null
          ? null
          : R.us(`encode/Rust/t${t}/${n}x${n}/gradient`);
      },
      scalar: (row, R) => {
        const n = sizeOf(row("source"));
        const t = tierOf(row("tier"));
        return n === null || t === null
          ? null
          : R.us(`encode/Rust (scalar)/t${t}/${n}x${n}/gradient`);
      },
      gain: (row, R) => {
        const n = sizeOf(row("source"));
        const t = tierOf(row("tier"));
        if (n === null || t === null) return null;
        return ratio(
          R.us(`encode/Rust (scalar)/t${t}/${n}x${n}/gradient`),
          R.us(`encode/Rust/t${t}/${n}x${n}/gradient`),
        );
      },
    },
  },
  {
    section: "6",
    index: 0,
    title: "Separable forward DCT against the direct summation",
    columns: {
      "tier 1 direct": (row, R) => {
        const n = sizeOf(row("source"));
        return n === null ? null : timeOr(R, armId(n, "shipped"));
      },
      separable: (row, R) => {
        const n = sizeOf(row("source"));
        return n === null ? null : timeOr(R, armId(n, "dct_separable"));
      },
      speedup: (row, R) => {
        const n = sizeOf(row("source"));
        if (n === null) return null;
        const direct = armId(n, "shipped");
        const sep = armId(n, "dct_separable");
        if (!R.has(direct) || !R.has(sep)) return null;
        return ratio(R.us(direct), R.us(sep));
      },
    },
  },
  {
    section: "7",
    index: 0,
    title: "Cross-language, startup excluded",
    columns: {
      "encode t0": (row, R) => impl(row("implementation"), R, "encode", 0),
      "encode t1": (row, R) => impl(row("implementation"), R, "encode", 1),
      "encode t2": (row, R) => impl(row("implementation"), R, "encode", 2),
      "decode t1": (row, R) => impl(row("implementation"), R, "decode", 1),
      "decode t2": (row, R) => impl(row("implementation"), R, "decode", 2),
    },
  },
  {
    section: "8",
    index: 0,
    title: "Batch throughput and thread scaling",
    columns: {
      "1 thread": (row, R) => batch(row("implementation"), R, "1"),
      auto: (row, R) => batch(row("implementation"), R, "auto"),
      scaling: (row, R) => {
        const one = batch(row("implementation"), R, "1");
        const auto = batch(row("implementation"), R, "auto");
        return one === null || auto === null ? null : ratio(one, auto);
      },
    },
  },
];

/** Row labels in §7 and §8 are the driver's target names verbatim. */
function impl(
  raw: string,
  R: Runs,
  op: "encode" | "decode",
  tier: number,
): number | null {
  const t = clean(raw);
  const id =
    op === "encode"
      ? `encode/${t}/t${tier}/100x100/gradient`
      : `decode/${t}/t${tier}/natural`;
  return timeOr(R, id);
}

function batch(raw: string, R: Runs, threads: string): number | null {
  const id = `batch/${clean(raw)}/t1/100x100/threads=${threads}`;
  const us = timeOr(R, id);
  return us === null ? null : us / BATCH_COUNT;
}

// ─── Checking ───────────────────────────────────────────────────────────────

interface Failure {
  where: string;
  column: string;
  row: string;
  documented: string;
  measured: string;
  detail?: string;
}

/**
 * A documented value passes when it equals the measured value rounded to the
 * precision the document used. Rounding rather than a tolerance means the
 * assertion tightens automatically as the document quotes more digits, and a
 * figure written to three significant digits is not held to five.
 */
function agrees(
  doc: DocNumber,
  measuredUs: number,
): { ok: boolean; shown: string } {
  const measured = TIME_UNITS.has(doc.unit)
    ? measuredUs / (PER_US[doc.unit] ?? 1)
    : measuredUs;
  const rounded = Number(measured.toFixed(doc.decimals));
  const suffix =
    doc.unit === "ratio"
      ? "×"
      : doc.unit === "percent"
        ? "%"
        : ` ${doc.unit === "us" ? "µs" : doc.unit}`;
  return {
    ok: Math.abs(rounded - doc.value) < 1e-9,
    shown: `${rounded.toFixed(doc.decimals)}${suffix}`,
  };
}

function checkTable(
  binding: Binding,
  table: DocTable,
  R: Runs,
  failures: Failure[],
  counters: { checked: number; unbound: number },
): void {
  const headerIndex = new Map<string, number>();
  table.header.forEach((h, i) => {
    headerIndex.set(clean(h).toLowerCase(), i);
    headerIndex.set(bare(h).toLowerCase(), i);
  });

  const columnOf = (name: string): number | undefined =>
    headerIndex.get(name.toLowerCase()) ??
    headerIndex.get(bare(name).toLowerCase());

  for (const cellsOfRow of table.rows) {
    const row: Row = (column) => {
      const i = columnOf(column);
      return i === undefined ? "" : (cellsOfRow[i] ?? "");
    };
    const rowLabel = clean(cellsOfRow[0] ?? "");

    for (const [column, resolve] of Object.entries(binding.columns)) {
      const i = columnOf(column);
      if (i === undefined) continue;
      const raw = cellsOfRow[i] ?? "";
      const doc = parseDocNumber(raw);
      if (!doc) continue;

      let expected: number | null;
      try {
        expected = resolve(row, R);
      } catch (e) {
        if (e instanceof MissingCell) {
          failures.push({
            where: `§${binding.section} ${binding.title} (line ${table.line})`,
            column,
            row: rowLabel,
            documented: raw,
            measured: "—",
            detail: e.message,
          });
          continue;
        }
        throw e;
      }
      if (expected === null) {
        counters.unbound++;
        continue;
      }

      counters.checked++;
      const verdict = agrees(doc, expected);
      if (!verdict.ok) {
        failures.push({
          where: `§${binding.section} ${binding.title} (line ${table.line})`,
          column,
          row: rowLabel,
          documented: raw,
          measured: verdict.shown,
        });
      }
    }
  }
}

// ─── Entry point ────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    section: { type: "string" },
    "list-unbound": { type: "boolean", default: false },
    "list-cells": { type: "boolean", default: false },
  },
});

const runs = new Runs([...BASELINES]);
if (runs.loaded.length === 0) {
  console.error(
    [
      "No committed perf run found. Expected one of:",
      ...BASELINES.map((b) => `  tools/comparison/baselines/${b}`),
      "",
      "Generate with `mise run benchmark` / `mise run benchmark:full`.",
    ].join("\n"),
  );
  process.exit(1);
}

if (values["list-cells"]) {
  for (const id of runs.ids) console.log(id);
  process.exit(0);
}

const doc = readFileSync(DOC, "utf8");
const tables = parseTables(doc);

if (values["list-unbound"]) {
  console.log("Tables in PERFORMANCE.md with no binding:\n");
  for (const t of tables) {
    if (BINDINGS.some((b) => b.section === t.section && b.index === t.index)) {
      continue;
    }
    console.log(
      `  §${t.section} table ${t.index} (line ${t.line}): ${t.header.join(" | ")}`,
    );
  }
  process.exit(0);
}

console.log("Committed runs:");
for (const r of runs.loaded) {
  console.log(
    `  ${r.file}: ${r.cells.length} cells, mode=${r.config?.mode}, ` +
      `${r.environment?.cpuModel} (${r.environment?.arch}, ${r.environment?.cores} cores), ` +
      `commit ${r.git?.commit}${r.git?.dirty ? " DIRTY" : ""}`,
  );
}
console.log();

const failures: Failure[] = [];
const counters = { checked: 0, unbound: 0 };
const missingTables: string[] = [];

for (const binding of BINDINGS) {
  if (values.section && binding.section !== values.section) continue;
  const table = tables.find(
    (t) => t.section === binding.section && t.index === binding.index,
  );
  if (!table) {
    missingTables.push(
      `§${binding.section} table ${binding.index} — ${binding.title}`,
    );
    continue;
  }
  checkTable(binding, table, runs, failures, counters);
}

// A dirty tree means the numbers cannot be traced back to a source state, which
// is how the 2026-08-29 baseline came to disagree with the document it backed.
for (const file of runs.dirty) {
  failures.push({
    where: `baselines/${file}`,
    column: "git.dirty",
    row: "—",
    documented: "clean tree",
    measured: "dirty",
    detail: "regenerate from a committed tree so the run traces to a revision",
  });
}
for (const c of runs.conflicts) {
  failures.push({
    where: "committed runs",
    column: "consistency",
    row: "—",
    documented: "one value per cell",
    measured: "conflict",
    detail: c,
  });
}

console.log(
  `Checked ${counters.checked} documented value(s) against the committed runs` +
    `; ${counters.unbound} deliberately unbound.`,
);
for (const m of missingTables)
  console.log(`  SKIP  ${m} — not found in the document`);

if (failures.length > 0) {
  console.log(`\n${failures.length} disagreement(s):\n`);
  for (const f of failures) {
    console.log(`  ${f.where}`);
    console.log(`    row "${f.row}", column "${f.column}"`);
    console.log(`      document: ${f.documented}`);
    console.log(`      measured: ${f.measured}`);
    if (f.detail) console.log(`      ${f.detail}`);
    console.log();
  }
  process.exit(1);
}

console.log(
  "\nEvery bound value in PERFORMANCE.md agrees with a committed run.",
);
