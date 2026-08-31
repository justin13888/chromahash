import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { benchEnvInt, rejectRustOnlyEnv, runBench } from "./bench.ts";
import {
  BatchEncoder,
  ChromaHash,
  DEFAULT_TIER,
  MAX_TIER,
  init,
} from "./index.ts";
import type { Gamut, ImageInput } from "./index.ts";

const gamutMap: Record<string, Gamut> = {
  srgb: "sRGB",
  displayp3: "Display P3",
  adobergb: "Adobe RGB",
  bt2020: "BT.2020",
  prophoto: "ProPhoto RGB",
};

function usage(): never {
  process.stderr.write(
    "Usage:\n  encode-stdin encode <width> <height> <gamut>\n  encode-stdin decode\n  encode-stdin average-color\n  encode-stdin batch-encode <width> <height> <gamut> <count>\n  encode-stdin batch-decode <count>\n  encode-stdin bench-encode <width> <height> <gamut> <iters>\n  encode-stdin bench-decode <iters> [max_width max_height]\n  encode-stdin bench-batch <width> <height> <gamut> <count>\n  encode-stdin bench-info\n",
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

// Node has no `fetch` of `file://`, so feed the WASM module its bytes directly.
const currentDir = dirname(fileURLToPath(import.meta.url));
const wasmPath = resolve(currentDir, "../wasm/chromahash_wasm_bg.wasm");
await init(readFileSync(wasmPath));

const args = process.argv.slice(2);
const subcommand = args[0];
if (!subcommand) {
  usage();
}

/**
 * Quality tier from CHROMAHASH_TIER, matching the Rust harness so the
 * cross-language benchmark measures the same workload in every language.
 * Defaults to the 32-byte tier.
 */
function tierFromEnv(): number {
  const raw = process.env.CHROMAHASH_TIER;
  if (raw === undefined || raw === "") return DEFAULT_TIER;
  const tier = Number.parseInt(raw, 10);
  if (!Number.isInteger(tier) || tier < 0 || tier > MAX_TIER) {
    process.stderr.write(
      `CHROMAHASH_TIER: "${raw}" is not a valid tier code (0..=${MAX_TIER})\n`,
    );
    process.exit(1);
  }
  return tier;
}

switch (subcommand) {
  case "encode": {
    const wArg = args[1];
    const hArg = args[2];
    const gamutArg = args[3];

    if (!wArg || !hArg || !gamutArg) {
      process.stderr.write(
        "Usage: encode-stdin encode <width> <height> <gamut>\n",
      );
      process.exit(1);
    }

    const w = Number.parseInt(wArg, 10);
    const h = Number.parseInt(hArg, 10);

    const gamut = gamutMap[gamutArg];
    if (!gamut) {
      process.stderr.write(`unknown gamut: ${gamutArg}\n`);
      process.exit(1);
    }

    const expectedLen = w * h * 4;
    const stdinBuf = await readStdin();
    const rgba = new Uint8Array(stdinBuf);
    if (rgba.length !== expectedLen) {
      process.stderr.write(
        `expected ${expectedLen} bytes, got ${rgba.length}\n`,
      );
      process.exit(1);
    }

    const hash = ChromaHash.encodeWithQuality(w, h, rgba, gamut, tierFromEnv());
    process.stdout.write(Buffer.from(hash.hash));
    break;
  }
  case "decode": {
    const hashBuf = await readStdin();
    if (hashBuf.length < 2) {
      process.stderr.write(`expected a hash, got ${hashBuf.length} bytes\n`);
      process.exit(1);
    }
    const ch = ChromaHash.fromBytes(new Uint8Array(hashBuf));
    const decoded = ch.decode();
    process.stdout.write(Buffer.from(decoded.rgba));
    break;
  }
  case "average-color": {
    const hashBuf2 = await readStdin();
    if (hashBuf2.length < 2) {
      process.stderr.write(`expected a hash, got ${hashBuf2.length} bytes\n`);
      process.exit(1);
    }
    const ch2 = ChromaHash.fromBytes(new Uint8Array(hashBuf2));
    const avg = ch2.averageColor();
    process.stdout.write(Buffer.from([avg.r, avg.g, avg.b, avg.a]));
    break;
  }
  case "batch-encode": {
    // Read one image, encode it `count` times through the BatchEncoder
    // (serial in JS). Used to benchmark bulk throughput.
    const wArg = args[1];
    const hArg = args[2];
    const gamutArg = args[3];
    const countArg = args[4];
    if (!wArg || !hArg || !gamutArg || !countArg) {
      process.stderr.write(
        "Usage: encode-stdin batch-encode <width> <height> <gamut> <count>\n",
      );
      process.exit(1);
    }
    const w = Number.parseInt(wArg, 10);
    const h = Number.parseInt(hArg, 10);
    const count = Number.parseInt(countArg, 10);
    const gamut = gamutMap[gamutArg];
    if (!gamut) {
      process.stderr.write(`unknown gamut: ${gamutArg}\n`);
      process.exit(1);
    }
    const stdinBuf = await readStdin();
    const rgba = new Uint8Array(stdinBuf);
    const quality = tierFromEnv();
    const items: ImageInput[] = Array.from({ length: count }, () => ({
      w,
      h,
      rgba,
      gamut,
      quality,
    }));
    const encoder = new BatchEncoder();
    const hashes = encoder.encodeBatch(items);
    encoder.close();
    // Write one result-derived byte so the work cannot be optimized away.
    process.stdout.write(Buffer.from([hashes[0]?.hash[0] ?? 0]));
    break;
  }
  case "batch-decode": {
    // No batch decode API exists; loop the single decode `count` times.
    const countArg = args[1];
    if (!countArg) {
      process.stderr.write("Usage: encode-stdin batch-decode <count>\n");
      process.exit(1);
    }
    const count = Number.parseInt(countArg, 10);
    const hashBuf = await readStdin();
    if (hashBuf.length < 2) {
      process.stderr.write(`expected a hash, got ${hashBuf.length} bytes\n`);
      process.exit(1);
    }
    const ch = ChromaHash.fromBytes(new Uint8Array(hashBuf));
    let acc = 0;
    for (let i = 0; i < count; i++) {
      acc ^= ch.decode().rgba[0] ?? 0;
    }
    process.stdout.write(Buffer.from([acc & 0xff]));
    break;
  }
  case "bench-encode": {
    const wArg = args[1];
    const hArg = args[2];
    const gamutArg = args[3];
    const itersArg = args[4];
    if (!wArg || !hArg || !gamutArg || !itersArg) {
      process.stderr.write(
        "Usage: encode-stdin bench-encode <width> <height> <gamut> <iters>\n",
      );
      process.exit(1);
    }
    rejectRustOnlyEnv();
    const gamut = gamutMap[gamutArg];
    if (!gamut) {
      process.stderr.write(`unknown gamut: ${gamutArg}\n`);
      process.exit(1);
    }
    const w = Number.parseInt(wArg, 10);
    const h = Number.parseInt(hArg, 10);
    const iters = Number.parseInt(itersArg, 10);
    const rgba = new Uint8Array(await readStdin());
    const quality = tierFromEnv();
    runBench(
      iters,
      () =>
        ChromaHash.encodeWithQuality(w, h, rgba, gamut, quality).hash[0] ?? 0,
    );
    break;
  }
  case "bench-decode": {
    const itersArg = args[1];
    if (!itersArg) {
      process.stderr.write(
        "Usage: encode-stdin bench-decode <iters> [max_width max_height]\n",
      );
      process.exit(1);
    }
    rejectRustOnlyEnv();
    const iters = Number.parseInt(itersArg, 10);
    const ch = ChromaHash.fromBytes(new Uint8Array(await readStdin()));
    const maxWArg = args[2];
    const maxHArg = args[3];
    if (maxWArg && maxHArg) {
      const maxW = Number.parseInt(maxWArg, 10);
      const maxH = Number.parseInt(maxHArg, 10);
      runBench(iters, () => {
        const r = ch.decodeCapped(maxW, maxH);
        return (r.rgba[0] ?? 0) ^ (r.w & 0xff) ^ (r.h & 0xff);
      });
    } else {
      runBench(iters, () => {
        const r = ch.decode();
        return (r.rgba[0] ?? 0) ^ (r.w & 0xff) ^ (r.h & 0xff);
      });
    }
    break;
  }
  case "bench-batch": {
    const wArg = args[1];
    const hArg = args[2];
    const gamutArg = args[3];
    const countArg = args[4];
    if (!wArg || !hArg || !gamutArg || !countArg) {
      process.stderr.write(
        "Usage: encode-stdin bench-batch <width> <height> <gamut> <count>\n",
      );
      process.exit(1);
    }
    rejectRustOnlyEnv();
    const gamut = gamutMap[gamutArg];
    if (!gamut) {
      process.stderr.write(`unknown gamut: ${gamutArg}\n`);
      process.exit(1);
    }
    // This binding's BatchEncoder is serial in JS and takes no thread count, so
    // accept only the values that mean "however many you have".
    const threads = benchEnvInt("CHROMAHASH_BATCH_THREADS", 0);
    if (threads > 1) {
      process.stderr.write(
        `CHROMAHASH_BATCH_THREADS=${threads}: this binding's BatchEncoder is serial and takes no thread count\n`,
      );
      process.exit(1);
    }
    const w = Number.parseInt(wArg, 10);
    const h = Number.parseInt(hArg, 10);
    const count = Number.parseInt(countArg, 10);
    const rgba = new Uint8Array(await readStdin());
    const quality = tierFromEnv();
    const items: ImageInput[] = Array.from({ length: count }, () => ({
      w,
      h,
      rgba,
      gamut,
      quality,
    }));
    const encoder = new BatchEncoder();
    // One batch is one iteration, so the printed number is ns per batch.
    runBench(1, () => encoder.encodeBatch(items)[0]?.hash[0] ?? 0);
    encoder.close();
    break;
  }
  case "bench-info": {
    process.stdout.write("runtime=typescript-wasm\n");
    process.stdout.write(`node_version=${process.versions.node}\n`);
    process.stdout.write("wasm=1\n");
    process.stdout.write("threads=1\n");
    break;
  }

  default:
    usage();
}
