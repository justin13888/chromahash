import { ChromaHash } from "./index.ts";
import type { Gamut } from "./internals.ts";

const gamutMap: Record<string, Gamut> = {
  srgb: "sRGB",
  displayp3: "Display P3",
  adobergb: "Adobe RGB",
  bt2020: "BT.2020",
  prophoto: "ProPhoto RGB",
};

function usage(): never {
  process.stderr.write(
    "Usage:\n  encode-stdin encode <width> <height> <gamut>\n  encode-stdin decode\n  encode-stdin average-color\n",
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

    const hash = ChromaHash.encode(w, h, rgba, gamut);
    process.stdout.write(Buffer.from(hash.hash));
    break;
  }
  case "decode": {
    const hashBuf = await readStdin();
    if (hashBuf.length !== 32) {
      process.stderr.write(`expected 32 bytes, got ${hashBuf.length}\n`);
      process.exit(1);
    }
    const ch = ChromaHash.fromBytes(new Uint8Array(hashBuf));
    const decoded = ch.decode();
    process.stdout.write(Buffer.from(decoded.rgba));
    break;
  }
  case "average-color": {
    const hashBuf2 = await readStdin();
    if (hashBuf2.length !== 32) {
      process.stderr.write(`expected 32 bytes, got ${hashBuf2.length}\n`);
      process.exit(1);
    }
    const ch2 = ChromaHash.fromBytes(new Uint8Array(hashBuf2));
    const avg = ch2.averageColor();
    process.stdout.write(Buffer.from([avg.r, avg.g, avg.b, avg.a]));
    break;
  }
  default:
    usage();
}
