/**
 * ThumbHash CLI harness — stdin/stdout, mirroring the chromahash `encode-stdin`
 * harnesses so the benchmark tool can time ThumbHash as a baseline.
 *
 * ThumbHash takes no gamut and produces a variable-length hash (so `decode`
 * reads all of stdin, not a fixed 32 bytes). It has no parallel batch API, so
 * the `batch-*` subcommands loop serially — the honest baseline for a
 * single-threaded reference implementation.
 */

import { rgbaToThumbHash, thumbHashToRGBA } from "thumbhash";

function usage(): never {
  process.stderr.write(
    "Usage:\n" +
      "  thumbhash-stdin encode <width> <height>\n" +
      "  thumbhash-stdin decode\n" +
      "  thumbhash-stdin batch-encode <width> <height> <count>\n" +
      "  thumbhash-stdin batch-decode <count>\n",
  );
  process.exit(1);
}

function readStdin(): Promise<Buffer> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const args = process.argv.slice(2);
const subcommand = args[0];
if (!subcommand) {
  usage();
}

switch (subcommand) {
  case "encode": {
    const wArg = args[1];
    const hArg = args[2];
    if (!wArg || !hArg) {
      process.stderr.write("Usage: thumbhash-stdin encode <width> <height>\n");
      process.exit(1);
    }
    const w = Number.parseInt(wArg, 10);
    const h = Number.parseInt(hArg, 10);
    const rgba = new Uint8Array(await readStdin());
    process.stdout.write(Buffer.from(rgbaToThumbHash(w, h, rgba)));
    break;
  }
  case "decode": {
    // The hash is variable-length — read all of stdin.
    const hash = new Uint8Array(await readStdin());
    process.stdout.write(Buffer.from(thumbHashToRGBA(hash).rgba));
    break;
  }
  case "batch-encode": {
    // ThumbHash has no batch API; loop `count` times.
    const wArg = args[1];
    const hArg = args[2];
    const countArg = args[3];
    if (!wArg || !hArg || !countArg) {
      process.stderr.write(
        "Usage: thumbhash-stdin batch-encode <width> <height> <count>\n",
      );
      process.exit(1);
    }
    const w = Number.parseInt(wArg, 10);
    const h = Number.parseInt(hArg, 10);
    const count = Number.parseInt(countArg, 10);
    const rgba = new Uint8Array(await readStdin());
    let acc = 0;
    for (let i = 0; i < count; i++) {
      acc ^= rgbaToThumbHash(w, h, rgba)[0] ?? 0;
    }
    // Write one result-derived byte so the work cannot be optimized away.
    process.stdout.write(Buffer.from([acc & 0xff]));
    break;
  }
  case "batch-decode": {
    const countArg = args[1];
    if (!countArg) {
      process.stderr.write("Usage: thumbhash-stdin batch-decode <count>\n");
      process.exit(1);
    }
    const count = Number.parseInt(countArg, 10);
    const hash = new Uint8Array(await readStdin());
    let acc = 0;
    for (let i = 0; i < count; i++) {
      acc ^= thumbHashToRGBA(hash).rgba[0] ?? 0;
    }
    process.stdout.write(Buffer.from([acc & 0xff]));
    break;
  }
  default:
    usage();
}
