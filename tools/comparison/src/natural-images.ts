import fs from "node:fs/promises";
import path from "node:path";
import { ensurePinnedFixture } from "./corpus-pin.ts";
import type { CorpusSplit } from "./corpus.ts";

const NATURAL_DIR = path.resolve(import.meta.dirname, "../fixtures/natural");

export interface NaturalImageSpec {
  /** Stable Picsum photo ID. */
  id: number;
  /**
   * Label used as the filename stem (`<label>.jpg`). Its prefix drives
   * categorization: `natural-`/`chroma-` → Natural, `portrait-` → Portrait,
   * `night-` → Night (see report.ts `categorizeImage`).
   */
  label: string;
  /** Native width on Picsum (must satisfy width*height >= 12MP). */
  width: number;
  /** Native height on Picsum (must satisfy width*height >= 12MP). */
  height: number;
  /**
   * Corpus split: constants sweeps tune on "tune" images only and validate on
   * "holdout" (see corpus.ts). Never move an image from holdout to tune.
   */
  split: CorpusSplit;
  /**
   * SHA-256 of the exact JPEG bytes Picsum serves for `id` at `width`x`height`
   * — the content pin. Verified on every load, cached or freshly downloaded; a
   * mismatch is fatal (see corpus-pin.ts). Picsum re-encodes deterministically,
   * so this is stable; if it ever is not, the corpus changed and every measured
   * mean in `spec/EXPERIMENTS.md` has to be re-measured, not quietly shifted.
   */
  sha256: string;
}

/**
 * Curated set of diverse natural photographs from Picsum Photos (Unsplash).
 * Every image MUST have a native resolution of at least 12 megapixels.
 *
 * The set is curated along the axes the format is actually sensitive to, not
 * by subject matter: illuminant (daylight / tungsten / mixed interior / night
 * artificial), key (high-key white-background framing through to near-black
 * night), chroma (near-neutral snow and monochrome through to flat saturated
 * paint), spatial frequency (flat walls through to dense facades and market
 * clutter), skin tone, and orientation. A gap on one of those axes is a gap in
 * the evidence: constants swept on a corpus that never sees an interior
 * illuminant or a dark skin tone are not measured against them.
 *
 * Adding or removing an image changes every mean in `spec/EXPERIMENTS.md`, so
 * the whole sweep set is re-run in the same change (see §9 there).
 */
export const CURATED_IMAGES: NaturalImageSpec[] = [
  {
    id: 326,
    label: "natural-food",
    width: 4928,
    height: 3264,
    split: "tune",
    sha256: "050fc946ddd1d959f896bed0f8315552fc57713dbe31e5ba94000726d1e2642d",
  },
  {
    id: 350,
    label: "natural-coast",
    width: 5000,
    height: 3338,
    split: "tune",
    sha256: "136b905c1d7f74ba432a99af3ec94c731eed9d9d339bb3c90a691c7e7efd417f",
  },
  {
    id: 392,
    label: "natural-bridge",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "2d56f201e4976a357e8b698bcfe0f9526995a27f5ff0898d18c1b2eeb85cd328",
  },
  {
    id: 433,
    label: "natural-ocean-sunset",
    width: 4752,
    height: 3168,
    split: "tune",
    sha256: "8236cdb79c8a046201ff454f79baaa5e600fbf1f80fdaee784f8998a4b815609",
  },
  {
    id: 434,
    label: "natural-river",
    width: 4928,
    height: 3264,
    split: "tune",
    sha256: "1d1d8e01c11168d69955afa7260e06b7e8b5abf323bbd079bd68cbc86089be57",
  },
  {
    id: 491,
    label: "natural-tools",
    width: 5000,
    height: 4061,
    split: "tune",
    sha256: "62dd8ca41bf4c90189877c3ee156180131de3e7ee0e73f3353c970d3bef6e1ac",
  },
  {
    id: 870,
    label: "natural-sunset",
    width: 2900,
    height: 4334,
    split: "tune",
    sha256: "d86d62091b02bd724e8c6df57bec4181a8be8715896e21face41fc38c5d621c9",
  },
  {
    id: 964,
    label: "natural-mountains",
    width: 5000,
    height: 3490,
    split: "tune",
    sha256: "d9bca3f7013984861644cc85ac517dbcbae4d21d496c2c3dd441c5027ba61411",
  },
  {
    id: 976,
    label: "natural-tulips",
    width: 5000,
    height: 2901,
    split: "tune",
    sha256: "8acd986e8159839b81bd3c11b922e3360c678031851d8fe71b8af275da82f644",
  },
  {
    id: 1011,
    label: "natural-lake",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "b30294eff0335b49d4e159f78cceb95d15176560adbd02cf35df4fd87cee3128",
  },
  {
    id: 1025,
    label: "natural-pug",
    width: 4951,
    height: 3301,
    split: "tune",
    sha256: "fc587a30b480e7d9b3c945eb1c888ca51ef71760b8b201971aaad1994eeba00d",
  },
  {
    id: 1037,
    label: "natural-forest",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "e56c78966c6e9d8b1cd9a39f9997ab1d837ee703983115aa29a670004310c44e",
  },
  {
    id: 1043,
    label: "natural-autumn",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "1e931ee0d6f6e83d8665a425201dbbbfcac8ae202da51c0aafdeea98a9139b5e",
  },
  {
    id: 1067,
    label: "natural-city",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "0f274e4fa2aba5e4e77013b848585a215b1979cebc183b2305bdb6acec267e6d",
  },
  {
    id: 1074,
    label: "natural-building",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "26f764ef6a1cb713bae0fa2849bf672d9ba5c68b9361f8af6e5ff3c4165b9279",
  },
  // Man-made, indoor and near-achromatic scenes: the corpus was overwhelmingly
  // outdoor daylight landscape, so nothing exercised artificial illuminants,
  // high-key product framing, dense periodic structure or a near-neutral
  // palette (added 2026-08; see spec/EXPERIMENTS.md §9).
  {
    id: 513,
    label: "natural-cafe",
    width: 4373,
    height: 3280,
    split: "tune",
    sha256: "3e51ddb45a7dea7de7c675d011637586b5bf7f5d69431453f80f94f62b31abb2",
  },
  {
    id: 486,
    label: "natural-typewriter",
    width: 3409,
    height: 5000,
    split: "tune",
    sha256: "4512863afc35956b46d7474d2a869d3a67a2dc0b6e2c9235d9f8c0b71355ca00",
  },
  {
    id: 945,
    label: "natural-facade",
    width: 4928,
    height: 3264,
    split: "tune",
    sha256: "c1e5fdba76edda1f4d02e64fbbf7037994219539cf21234254291bfa6a193b16",
  },
  {
    id: 730,
    label: "natural-snow-forest",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "01c8e9295d8a1e20e2400c2ae83dd48b394b7108c768bf9cd7a5820c7e288d5d",
  },
  {
    id: 1059,
    label: "natural-shop",
    width: 5000,
    height: 3337,
    split: "holdout",
    sha256: "084917dd18af8c05412c31c8a5d56a197dd194e105205e0de65a7666d1ef78d0",
  },
  {
    id: 1082,
    label: "natural-piano",
    width: 5000,
    height: 3334,
    split: "holdout",
    sha256: "ef12c3d1e8837f1b3e762815fffef1c57cdc2d69df0104e0a27220ec4785e514",
  },
  {
    id: 940,
    label: "natural-succulents",
    width: 3000,
    height: 4542,
    split: "holdout",
    sha256: "c3268d723bb03d9487333a3f0cd7b6eb95888c5c2691607aea663f66bd213d5f",
  },
  // Portrait / skin tone: people with visible faces or skin, across skin tones
  // and lighting conditions (a category the original corpus lacked entirely).
  // Skin is the one subject where a viewer reads a small ΔE as "wrong", and
  // the chroma DC/AC ranges are what decide it — so the split carries light,
  // medium and dark skin under daylight, backlight, tungsten and shade rather
  // than one lighting condition per tone.
  {
    id: 64,
    label: "portrait-sunglasses",
    width: 4326,
    height: 2884,
    split: "tune",
    sha256: "88ecd293c55c192439e68d310e83ff201dceccea8e36a60d1647ec882106032b",
  },
  {
    id: 823,
    label: "portrait-camera",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "ccee0095ccdb8c9c4a51781c234107add9e712f3d2b4564007281ace80b8755b",
  },
  {
    id: 838,
    label: "portrait-mother-child",
    width: 5000,
    height: 3333,
    split: "holdout",
    sha256: "7fef82de83c575ffaa8ebe419229d500f9e4f5a24512a979065e2d2109e42f17",
  },
  {
    id: 996,
    label: "portrait-backlit",
    width: 4272,
    height: 2848,
    split: "tune",
    sha256: "2b79e5daa810cfe612ade061516a751978a8b2fd488f67db93ea43ebf8445fae",
  },
  {
    id: 1027,
    label: "portrait-face",
    width: 2848,
    height: 4272,
    split: "holdout",
    sha256: "3ca59ba317406c432431c08dec4b35f23fdc82828745d1003b4fdea0fe0217ff",
  },
  {
    id: 856,
    label: "portrait-suit",
    width: 4500,
    height: 3112,
    split: "tune",
    sha256: "0220ca71241566875f08bf4600b9b1feb6ef4ab66b0e8f6e41de22ecd4db6eb5",
  },
  {
    id: 836,
    label: "portrait-guitarist",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "71a0fb62d9798707ab0d4bea2b4c7a9b656bbf7bbd8dc0a828ac3f96faff0520",
  },
  {
    id: 832,
    label: "portrait-dim-indoor",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "1d62cad2c8eb9bafcb67c7ecbd7e5703954fb2e86b0a9e272794be65e9b9ff47",
  },
  {
    id: 1010,
    label: "portrait-child-book",
    width: 5000,
    height: 3333,
    split: "holdout",
    sha256: "5c86090b3716a1d720e22fa6471a442379e4b633472e0ae214ed2fc031165a45",
  },
  // Night / low light: dark scenes where shadow detail and point lights stress
  // the quantizer's dark end.
  {
    id: 903,
    label: "night-milky-way",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "0c2250fb8862b9d67b0478cc4ab91761d130fdf27d8b2628990bf3dd1e756c8f",
  },
  {
    id: 797,
    label: "night-city-rain",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "03e291ae5596f7aa2b1a2fcbd6fa6f83aa0d1949a2f8887cac2e964c4e9b6367",
  },
  {
    id: 901,
    label: "night-aurora",
    width: 4016,
    height: 4016,
    split: "holdout",
    sha256: "5594aa7fa65bc8965c7eee9bc1f59d9f9e41b3950418cf3c62767e06a85f03b2",
  },
  {
    id: 799,
    label: "night-bridge-lights",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "19749fb9da951a2e82e00650d00d6f5923c8cb7a4bb417b1e9624e1c246319fd",
  },
  // High chroma: strongly saturated scenes that stress the chroma range
  // (categorized as Natural — they are ordinary photographs).
  {
    id: 1080,
    label: "chroma-strawberries",
    width: 5000,
    height: 3335,
    split: "tune",
    sha256: "a0c528991ab1648ac771175404312ddce981a20abbc9e081039e5056d267bbc4",
  },
  {
    id: 855,
    label: "chroma-yellow-wall",
    width: 5000,
    height: 3333,
    split: "tune",
    sha256: "a3f86e606f25888467ae29e2c27534bbdbc9abedfab119439f90282613f7e5d9",
  },
  {
    id: 517,
    label: "chroma-orange-tree",
    width: 5000,
    height: 3333,
    split: "holdout",
    sha256: "6c6e79cbb6bb1aae2aec8b4d5f8daebc4ca27ea76b452a942c126531fe6104f0",
  },
  {
    id: 951,
    label: "chroma-stripes",
    width: 4472,
    height: 2803,
    split: "tune",
    sha256: "3c1db5104fe00d895aa9ffd4a6fd5d5ecb21a92b2f969ed4a33f50f5767b83ca",
  },
];

/**
 * Ensure every curated natural image is present and content-pinned.
 *
 * Each file is verified against its declared SHA-256 whether it came from the
 * cache or from the network. A fetch failure or a digest mismatch throws: a
 * partial or drifted corpus would silently move every reported mean, so the
 * run stops rather than producing a number nobody can reproduce.
 *
 * @param only Restrict to these labels — for the CI R-D gate, which scores a
 *   handful of images and should not pull 30 MB it will not look at.
 */
export async function ensureNaturalImages(
  only?: readonly string[],
): Promise<string[]> {
  await fs.mkdir(NATURAL_DIR, { recursive: true });

  const wanted = only ? new Set(only) : null;
  if (wanted) {
    const known = new Set(CURATED_IMAGES.map((s) => s.label));
    for (const label of wanted) {
      if (!known.has(label)) {
        throw new Error(`unknown curated image label: ${label}`);
      }
    }
  }

  const paths: string[] = [];
  let downloadCount = 0;

  for (const { id, label, width, height, sha256 } of CURATED_IMAGES) {
    if (wanted && !wanted.has(label)) continue;
    const filePath = path.join(NATURAL_DIR, `${label}.jpg`);
    const downloaded = await ensurePinnedFixture({
      filePath,
      urls: [`https://picsum.photos/id/${id}/${width}/${height}`],
      sha256,
      label: `${label} (picsum/${id})`,
    });
    if (downloaded) downloadCount++;
    paths.push(filePath);
  }

  if (downloadCount > 0) {
    console.log(
      `Downloaded ${downloadCount} natural image(s) to ${NATURAL_DIR}`,
    );
  }

  return paths;
}
