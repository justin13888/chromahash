/**
 * CLI harness for the **pure-TypeScript** decode path (`./decode.ts`).
 *
 * Deliberately imports nothing from `./index.ts`: no `init()`, no `.wasm`
 * fetch, no WebAssembly instantiate. That absence *is* the measurement — the
 * pure-TS decoder exists so latency-sensitive consumers can skip module
 * instantiation, and until now nothing measured whether that trade pays.
 *
 * Encoding is WebAssembly-only, so this harness decodes and nothing else.
 */

import { benchEnvInt, rejectRustOnlyEnv, runBench } from "./bench.ts";
import { averageColor, decode, decodeCapped } from "./decode.ts";

function usage(): never {
  process.stderr.write(
    "Usage:\n" +
      "  decode-stdin decode [max_width max_height]\n" +
      "  decode-stdin average-color\n" +
      "  decode-stdin bench-decode <iters> [max_width max_height]\n" +
      "  decode-stdin bench-info\n",
  );
  process.exit(1);
}

function readStdin(): Promise<Buffer> {
  return new Promise((resolveStdin) => {
    const chunks: Buffer[] = [];
    process.stdin.on("data", (chunk: Buffer) => chunks.push(chunk));
    process.stdin.on("end", () => resolveStdin(Buffer.concat(chunks)));
  });
}

const args = process.argv.slice(2);
const subcommand = args[0];
if (!subcommand) usage();

switch (subcommand) {
  case "decode": {
    const hash = new Uint8Array(await readStdin());
    const maxW = args[1];
    const maxH = args[2];
    const img =
      maxW && maxH
        ? decodeCapped(
            hash,
            Number.parseInt(maxW, 10),
            Number.parseInt(maxH, 10),
          )
        : decode(hash);
    process.stdout.write(Buffer.from(img.rgba));
    break;
  }
  case "average-color": {
    const c = averageColor(new Uint8Array(await readStdin()));
    process.stdout.write(Buffer.from([c.r, c.g, c.b, c.a]));
    break;
  }
  case "bench-decode": {
    const itersArg = args[1];
    if (!itersArg) {
      process.stderr.write(
        "Usage: decode-stdin bench-decode <iters> [max_width max_height]\n",
      );
      process.exit(1);
    }
    rejectRustOnlyEnv();
    const iters = Number.parseInt(itersArg, 10);
    const hash = new Uint8Array(await readStdin());
    const maxWArg = args[2];
    const maxHArg = args[3];
    if (maxWArg && maxHArg) {
      const maxW = Number.parseInt(maxWArg, 10);
      const maxH = Number.parseInt(maxHArg, 10);
      runBench(iters, () => {
        const img = decodeCapped(hash, maxW, maxH);
        return (img.rgba[0] ?? 0) ^ (img.w & 0xff) ^ (img.h & 0xff);
      });
    } else {
      runBench(iters, () => {
        const img = decode(hash);
        return (img.rgba[0] ?? 0) ^ (img.w & 0xff) ^ (img.h & 0xff);
      });
    }
    break;
  }
  case "bench-info": {
    process.stdout.write("runtime=typescript-pure\n");
    process.stdout.write(`node_version=${process.versions.node}\n`);
    process.stdout.write("wasm=0\n");
    process.stdout.write(`threads=${benchEnvInt("UV_THREADPOOL_SIZE", 1)}\n`);
    break;
  }
  default:
    usage();
}
