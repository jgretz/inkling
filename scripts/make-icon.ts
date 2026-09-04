/**
 * Renders the app icon source at `apps/desk/src-tauri/icons/source.png`.
 *
 * The mark is drawn in code rather than committed as a binary so it can be
 * tuned in a diff. `bunx tauri icon` fans this out into the platform sizes.
 *
 * Run: `bun scripts/make-icon.ts`
 */

import {deflateSync} from 'node:zlib';
import {join} from 'node:path';

const SIZE = 1024;
const OUT = join(import.meta.dir, '..', 'apps', 'desk', 'src-tauri', 'icons', 'source.png');

type Rgb = readonly [number, number, number];

const BACKDROP_TOP: Rgb = [32, 28, 26];
const BACKDROP_BOTTOM: Rgb = [18, 16, 15];
const DROP_TOP: Rgb = [250, 243, 224];
const DROP_BOTTOM: Rgb = [233, 184, 114];

function mix(from: Rgb, to: Rgb, t: number): Rgb {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
  ];
}

/** Signed distance to a rounded rectangle, negative inside. */
function roundedRect(x: number, y: number, half: number, radius: number): number {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Signed distance to an ink drop: a circle with a wedge rising from it to a
 * point. The wedge's flanks are tangent to the circle, so the union has no
 * seam, and it is clipped at the circle's centre line so the circle alone owns
 * the lower half.
 */
function inkDrop(x: number, y: number, radius: number, apex: number): number {
  const circle = Math.hypot(x, y) - radius;
  // Half-angle of the tangent lines drawn from the apex to the circle.
  const sin = radius / apex;
  const cos = Math.sqrt(Math.max(1 - sin * sin, 0));
  const wedge = Math.abs(x) * cos - (y + apex) * sin;
  return Math.min(circle, Math.max(wedge, y));
}

/** Coverage of a shape at a pixel, antialiased across one pixel of distance. */
function coverage(distance: number): number {
  return Math.min(Math.max(0.5 - distance, 0), 1);
}

function render(): Buffer {
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const half = SIZE / 2;

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const x = px - half + 0.5;
      const y = py - half + 0.5;

      const backdrop = mix(BACKDROP_TOP, BACKDROP_BOTTOM, py / SIZE);
      const backdropAlpha = coverage(roundedRect(x, y, half, SIZE * 0.22));

      // The drop hangs low so its point leaves head room at the top.
      const drop = inkDrop(x, y - SIZE * 0.15, SIZE * 0.215, SIZE * 0.58);
      const dropAlpha = coverage(drop);
      const dropColor = mix(DROP_TOP, DROP_BOTTOM, Math.min(Math.max(py / SIZE, 0), 1));

      const rgb = mix(backdrop, dropColor, dropAlpha);
      const offset = (py * SIZE + px) * 4;
      pixels[offset] = Math.round(rgb[0]);
      pixels[offset + 1] = Math.round(rgb[1]);
      pixels[offset + 2] = Math.round(rgb[2]);
      pixels[offset + 3] = Math.round(backdropAlpha * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({length: 256}, function (_unused, index) {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function encodePng(pixels: Buffer): Buffer {
  const stride = SIZE * 4;
  // Filter byte 0 (none) prefixed to each scanline; the image is smooth enough
  // that a smarter filter would not pay for the code.
  const raw = Buffer.alloc((stride + 1) * SIZE);
  for (let row = 0; row < SIZE; row++) {
    raw[row * (stride + 1)] = 0;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, (row + 1) * stride);
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await Bun.write(OUT, encodePng(render()));
process.stdout.write(`wrote ${OUT}\n`);
