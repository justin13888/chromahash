import { ChromaHash } from "./index.ts";
import type { Gamut } from "./internals.ts";

const args = process.argv.slice(2);
if (args.length !== 3) {
  process.stderr.write("Usage: encode-stdin <width> <height> <gamut>\n");
  process.exit(1);
}

const wArg = args[0];
const hArg = args[1];
const gamutArg = args[2];

if (!wArg || !hArg || !gamutArg) {
  process.stderr.write("Usage: encode-stdin <width> <height> <gamut>\n");
  process.exit(1);
}

const w = Number.parseInt(wArg, 10);
const h = Number.parseInt(hArg, 10);

const gamutMap: Record<string, Gamut> = {
  srgb: "sRGB",
  displayp3: "Display P3",
  adobergb: "Adobe RGB",
  bt2020: "BT.2020",
  prophoto: "ProPhoto RGB",
};

const gamut = gamutMap[gamutArg];
if (!gamut) {
  process.stderr.write(`unknown gamut: ${gamutArg}\n`);
  process.exit(1);
}

const expectedLen = w * h * 4;
const chunks: Buffer[] = [];

process.stdin.on("data", (chunk: Buffer) => {
  chunks.push(chunk);
});

process.stdin.on("end", () => {
  const rgba = new Uint8Array(Buffer.concat(chunks));
  if (rgba.length !== expectedLen) {
    process.stderr.write(`expected ${expectedLen} bytes, got ${rgba.length}\n`);
    process.exit(1);
  }

  const hash = ChromaHash.encode(w, h, rgba, gamut);
  process.stdout.write(Buffer.from(hash.hash));
});
