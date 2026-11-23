import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { referenceAngles } from "./reference";
import { clamp01, fbm, hex, mix, Random, scaleRGB, smoothstep, valueNoise, type RGB } from "./paint";

/**
 * Starfall's sky is painted once on the CPU into an equirectangular texture: u follows
 * azimuth (north at the centre), v follows elevation from just below the horizon to the
 * zenith. Everything visible in the reference frame is placed from its frame pixels.
 */
export const SKY = {
  width: 4096,
  height: 1280,
  minElevation: -12 * Math.PI / 180,
} as const;

const DEG = Math.PI / 180;
const TEXELS_PER_RADIAN_U = SKY.width / (Math.PI * 2);
const TEXELS_PER_RADIAN_V = SKY.height / (Math.PI / 2 - SKY.minElevation);
/** Reference frame focal length in pixels per radian (see reference.ts). */
const REFERENCE_FOCAL = 614 / Math.tan(0.54);

const toU = (azimuth: number) => (azimuth / (Math.PI * 2) + 0.5) * SKY.width;
const toV = (elevation: number) => (elevation - SKY.minElevation) * TEXELS_PER_RADIAN_V;

/** Elevation (degrees) → sky colour, sampled from the reference and extended to the zenith. */
const GRADIENT: readonly (readonly [number, RGB])[] = [
  [-12, hex("#4f6f7a")], [0, hex("#587781")], [5, hex("#4f6f7e")], [11, hex("#45657b")], [17, hex("#3b5b73")],
  [21, hex("#35546d")], [24, hex("#31506a")], [27, hex("#2d4862")], [30, hex("#29435c")], [32, hex("#28415a")],
  [34.5, hex("#263e56")], [37, hex("#233649")], [39, hex("#1f2e3e")], [41, hex("#1c2735")], [43, hex("#181f2b")],
  [47, hex("#151b26")], [55, hex("#121822")], [70, hex("#10151e")], [90, hex("#0e131b")],
];

function gradient(elevationDeg: number): RGB {
  for (let i = 1; i < GRADIENT.length; i++) {
    if (elevationDeg <= GRADIENT[i][0]) {
      const [e0, c0] = GRADIENT[i - 1];
      const [e1, c1] = GRADIENT[i];
      return mix(c0, c1, smoothstep(0, 1, (elevationDeg - e0) / (e1 - e0)));
    }
  }
  return GRADIENT[GRADIENT.length - 1][1];
}

class SkyCanvas {
  readonly data = new Uint8Array(SKY.width * SKY.height * 4);

  /** Alpha-blends a colour into one texel; u wraps around the horizon. */
  blend(u: number, v: number, color: RGB, alpha: number): void {
    if (alpha <= 0.002 || v < 0 || v >= SKY.height) return;
    const x = ((Math.floor(u) % SKY.width) + SKY.width) % SKY.width;
    const offset = (Math.floor(v) * SKY.width + x) * 4;
    const a = Math.min(1, alpha);
    for (let c = 0; c < 3; c++) this.data[offset + c] = Math.round(this.data[offset + c] * (1 - a) + color[c] * 255 * a);
  }

  /** Paints a soft elliptical spot with a per-texel colour callback. */
  spot(azimuth: number, elevation: number, radiusU: number, radiusV: number,
    paint: (dx: number, dy: number) => { color: RGB; alpha: number } | null): void {
    const cu = toU(azimuth);
    const cv = toV(elevation);
    const ru = radiusU / Math.max(0.12, Math.cos(elevation));
    for (let v = Math.floor(cv - radiusV); v <= Math.ceil(cv + radiusV); v++) {
      for (let u = Math.floor(cu - ru); u <= Math.ceil(cu + ru); u++) {
        const dx = (u + 0.5 - cu) / ru;
        // +dy is up the sky.
        const dy = (v + 0.5 - cv) / radiusV;
        if (dx * dx + dy * dy > 1) continue;
        const result = paint(dx, dy);
        if (result) this.blend(u, v, result.color, result.alpha);
      }
    }
  }
}

function paintGradient(canvas: SkyCanvas): void {
  // Coarse value-noise field for the gentle, uneven wash of a hand-painted backdrop.
  const gw = SKY.width / 16 + 2;
  const gh = SKY.height / 16 + 2;
  const grid = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const wrapped = x % (SKY.width / 16);
    grid[y * gw + x] = fbm(wrapped / 7, y / 5, 3) - 0.5;
  }
  const rows: RGB[] = [];
  for (let v = 0; v < SKY.height; v++) rows.push(gradient(((v + 0.5) / TEXELS_PER_RADIAN_V + SKY.minElevation) / DEG));
  const data = canvas.data;
  for (let v = 0; v < SKY.height; v++) {
    const row = rows[v];
    const gy = v / 16;
    const y0 = Math.floor(gy);
    const fy = gy - y0;
    for (let u = 0; u < SKY.width; u++) {
      const gx = u / 16;
      const x0 = Math.floor(gx);
      const fx = gx - x0;
      const a = grid[y0 * gw + x0], b = grid[y0 * gw + x0 + 1];
      const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x0 + 1];
      const mottle = 1 + ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) * 0.16;
      const offset = (v * SKY.width + u) * 4;
      data[offset] = Math.min(255, row[0] * mottle * 255);
      data[offset + 1] = Math.min(255, row[1] * mottle * 255);
      data[offset + 2] = Math.min(255, row[2] * mottle * 255);
      data[offset + 3] = 255;
    }
  }
}

function paintStars(canvas: SkyCanvas, random: Random): void {
  const tints = [hex("#eef2f4"), hex("#f6efd9"), hex("#dfe8f6"), hex("#ffffff")];
  for (let placed = 0, tries = 0; placed < 4600 && tries < 60000; tries++) {
    const azimuth = random.range(-Math.PI, Math.PI);
    const elevation = Math.asin(random.range(Math.sin(6 * DEG), 1));
    // The reference fades stars out into the bright band above the horizon clouds.
    if (random.next() > smoothstep(16 * DEG, 34 * DEG, elevation)) continue;
    placed++;
    const magnitude = random.next() ** 3.2;
    const brightness = 0.28 + magnitude * 0.72;
    const radius = 0.62 + magnitude * 1.15;
    const tint = tints[Math.floor(random.next() * tints.length)];
    canvas.spot(azimuth, elevation, radius + (magnitude > 0.55 ? 2.2 : 0), radius + (magnitude > 0.55 ? 2.2 : 0), (dx, dy) => {
      const r = Math.hypot(dx, dy) * (radius + (magnitude > 0.55 ? 2.2 : 0));
      const core = 1 - smoothstep(radius * 0.35, radius, r);
      const halo = magnitude > 0.55 ? (1 - smoothstep(0, radius + 2.2, r)) * 0.18 : 0;
      return { color: tint, alpha: Math.max(core, halo) * brightness };
    });
  }
}

/** The pale, faintly mauve moon and the single shooting star of the reference. */
function paintMoonAndMeteor(canvas: SkyCanvas): void {
  const moon = referenceAngles(974, 262);
  const radius = 1.28 * DEG;
  const moonColor = hex("#5e6272");
  const moonRim = hex("#6b6a78");
  canvas.spot(moon.azimuth, moon.elevation, radius * 2.4 * TEXELS_PER_RADIAN_U, radius * 2.4 * TEXELS_PER_RADIAN_V, (dx, dy) => {
    const r = Math.hypot(dx, dy) * 2.4;
    const disc = 1 - smoothstep(0.86, 1.02, r);
    const halo = (1 - smoothstep(0.9, 2.4, r)) * 0.07;
    const mottle = 0.92 + valueNoise(dx * 9 + 3, dy * 9) * 0.12;
    return { color: scaleRGB(mix(moonColor, moonRim, clamp01(0.45 - dy * 0.4)), mottle), alpha: Math.max(disc * 0.82, halo) };
  });

  const tail = referenceAngles(1036, 158);
  const head = referenceAngles(1136, 215);
  const steps = 900;
  const meteor = hex("#dce4ea");
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const azimuth = tail.azimuth + (head.azimuth - tail.azimuth) * t;
    const elevation = tail.elevation + (head.elevation - tail.elevation) * t;
    const intensity = smoothstep(0, 0.75, t) * (1 - smoothstep(0.985, 1, t) * 0.4);
    canvas.spot(azimuth, elevation, 1.05, 1.05, (dx, dy) => ({ color: meteor, alpha: (1 - smoothstep(0.3, 1, Math.hypot(dx, dy))) * intensity * 0.22 }));
  }
}

interface Puff {
  azimuth: number;
  elevation: number;
  radius: number;
  /** 0 on the sunlit crest, 1 deep in the cloud's shaded body. */
  depth: number;
}

/** Lit-from-upper-left cauliflower shading used for every cumulus puff. */
const CLOUD = {
  highlight: hex("#a9ab97"),
  lit: hex("#989c8a"),
  mid: hex("#80908a"),
  shade: hex("#5a727c"),
  deep: hex("#465f70"),
  body: hex("#687f85"),
};

function paintPuffs(canvas: SkyCanvas, puffs: Puff[]): void {
  // Back (high) puffs first; lower, nearer puffs overlap them like painted cauliflower.
  puffs.sort((a, b) => b.elevation - a.elevation);
  const light = { x: -0.66, y: 0.52, z: 0.36 };
  const length = Math.hypot(light.x, light.y, light.z);
  const lx = light.x / length, ly = light.y / length, lz = light.z / length;
  const data = canvas.data;
  const ramp = new Float32Array(15);
  for (const puff of puffs) {
    const d = clamp01(puff.depth);
    // Shade, mid, lit and highlight tones for this puff's depth in the cloud body.
    const tones = [
      mix(CLOUD.shade, CLOUD.deep, 0.35 + d * 0.65),
      mix(CLOUD.mid, CLOUD.shade, 0.25 + d * 0.65),
      mix(mix(CLOUD.highlight, CLOUD.lit, 0.3), CLOUD.body, smoothstep(0.1, 0.8, d)),
      CLOUD.highlight,
    ];
    for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) ramp[i * 3 + c] = tones[i][c] * 255;
    const highlightAmount = 0.6 * (1 - d);
    const cu = toU(puff.azimuth);
    const cv = toV(puff.elevation);
    const ru = puff.radius * TEXELS_PER_RADIAN_U / Math.max(0.12, Math.cos(puff.elevation));
    const rv = puff.radius * TEXELS_PER_RADIAN_V;
    const v0 = Math.max(0, Math.floor(cv - rv)), v1 = Math.min(SKY.height - 1, Math.ceil(cv + rv));
    for (let v = v0; v <= v1; v++) {
      const dy = (v + 0.5 - cv) / rv;
      for (let u = Math.floor(cu - ru); u <= Math.ceil(cu + ru); u++) {
        const dx = (u + 0.5 - cu) / ru;
        const r2 = dx * dx + dy * dy;
        if (r2 > 1) continue;
        const r = Math.sqrt(r2);
        const lambert = dx * lx + dy * ly + Math.sqrt(1 - r2) * lz;
        const a = smoothstep(-0.12, 0.12, lambert);
        const b = smoothstep(0.24, 0.4, lambert);
        const h = smoothstep(0.82, 0.97, lambert) * highlightAmount;
        const alpha = 1 - smoothstep(0.9, 1, r);
        const x = ((u % SKY.width) + SKY.width) % SKY.width;
        const offset = (v * SKY.width + x) * 4;
        for (let c = 0; c < 3; c++) {
          let tone = ramp[c] + (ramp[3 + c] - ramp[c]) * a;
          tone += (ramp[6 + c] - tone) * b;
          tone += (ramp[9 + c] - tone) * h;
          data[offset + c] = data[offset + c] + (tone - data[offset + c]) * alpha;
        }
      }
    }
  }
}

/** Builds a towering bank from its traced top silhouette (frame pixels), filled to the horizon. */
function cumulusFromReference(contour: readonly (readonly [number, number])[], random: Random, bottom = 1010): Puff[] {
  const puffs: Puff[] = [];
  const toPuff = (px: number, py: number, radiusPx: number, depth: number): Puff => {
    const angles = referenceAngles(px, py);
    return { ...angles, radius: radiusPx / REFERENCE_FOCAL, depth };
  };
  for (let i = 0; i < contour.length - 1; i++) {
    const [x0, y0] = contour[i];
    const [x1, y1] = contour[i + 1];
    for (let x = x0; x < x1; x += 20) {
      const t = (x - x0) / (x1 - x0);
      const y = y0 + (y1 - y0) * t;
      const radius = random.range(22, 42);
      puffs.push(toPuff(x + random.range(-6, 6), y + radius * 0.94, radius, random.range(0, 0.1)));
      // A second ring of lobes just under the crest keeps the cauliflower edge crisp.
      const under = random.range(26, 44);
      puffs.push(toPuff(x + random.range(-14, 14), y + radius * 1.5 + under * 0.6, under, random.range(0.05, 0.22)));
      for (let fill = y + radius * 1.8; fill < bottom; fill += random.range(44, 66)) {
        const r = random.range(44, 82);
        const depth = clamp01((fill - y - 30) / 210) * random.range(0.8, 1.1);
        puffs.push(toPuff(x + random.range(-16, 16), fill, r, depth));
      }
    }
  }
  return puffs;
}

/** Procedural bank along the horizon for directions outside the reference frame. */
function cumulusBank(azimuthDeg: number, widthDeg: number, heightDeg: number, random: Random): Puff[] {
  const puffs: Puff[] = [];
  const steps = Math.ceil(widthDeg / 1.4);
  const seed = random.range(0, 50);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const azimuth = (azimuthDeg - widthDeg / 2 + widthDeg * t) * DEG;
    // Several towers per bank, like the reference's separate cumulus heads.
    const towers = 0.45 + 0.55 * smoothstep(0.35, 0.75, fbm(t * 5 + seed, seed, 3));
    const crest = heightDeg * Math.sin(Math.PI * t) ** 0.6 * towers;
    const radius = random.range(1.1, 2.1) * DEG;
    puffs.push({ azimuth: azimuth + random.range(-0.3, 0.3) * DEG, elevation: crest * DEG - radius * 0.9, radius, depth: random.range(0, 0.12) });
    for (let e = crest - 2.9; e > 0; e -= random.range(2.3, 3.1)) {
      puffs.push({
        azimuth: azimuth + random.range(-0.7, 0.7) * DEG, elevation: e * DEG, radius: random.range(1.6, 2.8) * DEG,
        depth: clamp01((crest - e) / Math.max(6, crest * 0.85)) * random.range(0.75, 1.1),
      });
    }
  }
  return puffs;
}

interface Wisp {
  /** Left/right and top/bottom extent in reference-frame pixels. */
  x0: number; x1: number; y0: number; y1: number;
  lit: string; shade: string;
  alpha?: number;
}

/** Long thin stratus streaks: broken, flat-bottomed, lit along their fluffy upper edge. */
function paintWisp(canvas: SkyCanvas, wisp: Wisp, random: Random, mapper: (x: number, y: number) => { azimuth: number; elevation: number }): void {
  const lit = hex(wisp.lit);
  const shade = hex(wisp.shade);
  const seed = random.range(0, 100);
  const height = wisp.y1 - wisp.y0;
  const steps = Math.ceil((wisp.x1 - wisp.x0) / 2.8);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = wisp.x0 + (wisp.x1 - wisp.x0) * t;
    const taper = Math.sin(Math.PI * t) ** 0.45;
    const presence = smoothstep(0.2, 0.34, fbm(t * 6 + seed, seed * 0.37, 3));
    const thickness = height * 0.62 * taper * presence * (0.25 + 0.75 * fbm(t * 12 + seed, 2.7, 3) ** 1.6);
    if (thickness < 1.2) continue;
    const bottom = wisp.y1 - height * 0.12 + (fbm(t * 3.5 - seed, 4.1, 2) - 0.5) * height * 0.35;
    const top = bottom - thickness;
    for (let y = top; y <= bottom; y += 2.1) {
      const s = (y - top) / Math.max(1, bottom - top);
      const angles = mapper(x, y);
      const color = mix(lit, shade, smoothstep(0.05, 0.85, s));
      const alpha = (wisp.alpha ?? 0.92) * smoothstep(0, 0.12, s) * (1 - smoothstep(0.86, 1, s));
      canvas.spot(angles.azimuth, angles.elevation, 2.1, 2.1, (dx, dy) => ({ color, alpha: alpha * (1 - smoothstep(0.35, 1, Math.hypot(dx, dy))) }));
    }
  }
}

/** Silhouettes traced from the reference (frame x, cloud top y). */
const LEFT_TOWER_CLOUD: readonly (readonly [number, number])[] = [
  [370, 330], [392, 300], [418, 296], [445, 316], [470, 340], [492, 372], [512, 400], [540, 394],
  [565, 380], [592, 392], [612, 414], [640, 424], [676, 444], [706, 438], [730, 440], [742, 470],
];
const CENTER_BANK: readonly (readonly [number, number])[] = [
  [846, 640], [858, 586], [880, 562], [930, 562], [965, 572], [990, 590], [1015, 576], [1045, 556],
  [1075, 560], [1130, 570], [1170, 586], [1205, 604], [1232, 578], [1262, 566], [1292, 560],
  [1330, 576], [1366, 600], [1396, 586], [1440, 588], [1488, 582], [1520, 606], [1548, 618],
];
const RIGHT_TOWER_CLOUD: readonly (readonly [number, number])[] = [
  [1548, 618], [1566, 586], [1592, 566], [1630, 556], [1662, 520], [1690, 482], [1722, 458],
  [1756, 450], [1792, 454], [1822, 452], [1850, 470], [1890, 520],
];

const REFERENCE_WISPS: readonly Wisp[] = [
  // Pale cloud bank across the top right with a dark underside.
  { x0: 1290, x1: 2020, y0: -40, y1: 62, lit: "#62777a", shade: "#33475a", alpha: 0.95 },
  { x0: 1470, x1: 1960, y0: 58, y1: 92, lit: "#3c5262", shade: "#25384c", alpha: 0.85 },
  { x0: 1131, x1: 1450, y0: 296, y1: 372, lit: "#7d8a84", shade: "#4a6474" },
  { x0: 1568, x1: 1930, y0: 340, y1: 446, lit: "#7f8b82", shade: "#4d6675" },
  { x0: 1668, x1: 1830, y0: 204, y1: 246, lit: "#728079", shade: "#46606e" },
  { x0: 1848, x1: 1935, y0: 182, y1: 204, lit: "#647470", shade: "#3f5868" },
  { x0: 1488, x1: 1712, y0: 494, y1: 524, lit: "#6e7f7a", shade: "#4b6574" },
  { x0: 448, x1: 760, y0: 326, y1: 366, lit: "#6f807c", shade: "#48616f" },
  { x0: 842, x1: 1000, y0: 436, y1: 474, lit: "#6a7c79", shade: "#46606f" },
  { x0: 872, x1: 1010, y0: 486, y1: 502, lit: "#5f7476", shade: "#435c6c" },
  { x0: 1222, x1: 1350, y0: 450, y1: 472, lit: "#617676", shade: "#455e6d" },
  { x0: 1300, x1: 1495, y0: 500, y1: 528, lit: "#6a7c78", shade: "#47606f" },
  { x0: 1242, x1: 1495, y0: 546, y1: 578, lit: "#6c7e79", shade: "#49626f" },
  { x0: 740, x1: 900, y0: 336, y1: 356, lit: "#2c4258", shade: "#1f3044", alpha: 0.7 },
];

export function paintSkyTexture(): Uint8Array {
  const canvas = new SkyCanvas();
  const random = new Random(90210);
  paintGradient(canvas);
  paintStars(canvas, random);
  paintMoonAndMeteor(canvas);

  const fromReference = (x: number, y: number) => referenceAngles(x, y);
  for (const wisp of REFERENCE_WISPS) paintWisp(canvas, wisp, random, fromReference);

  // Stratus streaks elsewhere in the sky, authored in (azimuth°, elevation°) at 20 px/degree,
  // close to the reference frame's own pixel density so the brush spacing matches.
  const fromDegrees = (x: number, y: number) => ({ azimuth: x / 20 * DEG, elevation: -y / 20 * DEG });
  for (let i = 0; i < 46; i++) {
    const azimuth = random.range(60, 300);
    const az = azimuth > 180 ? azimuth - 360 : azimuth;
    const elevation = random.range(14, 44);
    const width = random.range(160, 520);
    const thick = random.range(36, 80);
    const tone = random.next();
    paintWisp(canvas, {
      x0: az * 20 - width / 2, x1: az * 20 + width / 2, y0: -elevation * 20 - thick / 2, y1: -elevation * 20 + thick / 2,
      lit: tone < 0.75 ? "#768680" : "#3a5064", shade: tone < 0.75 ? "#4a6372" : "#26394c", alpha: 0.85,
    }, random, fromDegrees);
  }

  for (const contour of [LEFT_TOWER_CLOUD, CENTER_BANK, RIGHT_TOWER_CLOUD]) paintPuffs(canvas, cumulusFromReference(contour, random));
  // The horizon is ringed with the same towering banks behind and beside the player.
  for (const [azimuth, width, height] of [
    [-78, 26, 26], [-104, 22, 18], [-136, 30, 30], [-168, 24, 20], [168, 28, 27], [136, 24, 19],
    [104, 30, 31], [76, 22, 22], [-58, 12, 14], [58, 14, 15],
  ] as const) paintPuffs(canvas, cumulusBank(azimuth, width, height, random));
  return canvas.data;
}

/** Inside-facing latitude/longitude dome whose UVs match the sky texture layout. */
export function skyDomeData(radius: number): VertexData {
  const rings = 72;
  const sectors = 144;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const elevation = -Math.PI / 2 + Math.PI * ring / rings;
    for (let sector = 0; sector <= sectors; sector++) {
      const azimuth = -Math.PI + Math.PI * 2 * sector / sectors;
      positions.push(Math.cos(elevation) * Math.sin(azimuth) * radius, Math.sin(elevation) * radius, Math.cos(elevation) * Math.cos(azimuth) * radius);
      uvs.push(sector / sectors, clamp01(toV(elevation) / SKY.height));
    }
  }
  for (let ring = 0; ring < rings; ring++) for (let sector = 0; sector < sectors; sector++) {
    const a = ring * (sectors + 1) + sector;
    const b = a + sectors + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const data = new VertexData();
  data.positions = positions;
  data.uvs = uvs;
  data.indices = indices;
  return data;
}

export const skyTexelU = toU;
