import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';

const themeURL = new URL('../dice/themes/nest/', import.meta.url);
const theme = JSON.parse(await readFile(new URL('theme.config.json', themeURL)));

test('Nest covers every numeric die and resolves its local material assets', async () => {
  assert.deepEqual(theme.diceAvailable, ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  // Omission intentionally uses the loader's default mesh and face map.
  assert.equal(theme.meshFile, undefined);
  assert.equal(theme.material.type, 'standard');
  for (const field of ['diffuseTexture', 'bumpTexture']) {
    assert.ok((await readFile(new URL(theme.material[field], themeURL))).length > 0);
  }
  const svg = await readFile(new URL(theme.material.diffuseTexture, themeURL), 'utf8');
  assert.match(svg, /fill="#0b1610"/);
  assert.match(svg, /fill="#8de8a4"/);
  assert.doesNotMatch(svg, /<(?:image|text|script)\b|(?:href|filter)=/);
});

// Decode only the bundled noninterlaced, indexed 4-bit PNG. Comparing every
// atlas pixel ensures vectorization kept all face numbers at their exact UVs.
function defaultAtlasAlpha(png) {
  let paletteAlpha;
  const compressed = [];
  assert.deepEqual([...png.subarray(24, 29)], [4, 3, 0, 0, 0]);
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'tRNS') paletteAlpha = data;
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  const stride = width / 2;
  const packed = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(width * height);
  let previous = Buffer.alloc(stride);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const distances = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return distances[0] <= distances[1] && distances[0] <= distances[2] ? a : distances[1] <= distances[2] ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride), filter = packed[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const left = row[x - 1] || 0, up = previous[x], upperLeft = previous[x - 1] || 0;
      const prediction = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      assert.notEqual(prediction, undefined);
      row[x] = (packed[y * (stride + 1) + x + 1] + prediction) & 255;
      for (let nibble = 0; nibble < 2; nibble++) {
        const index = nibble ? row[x] & 15 : row[x] >> 4;
        pixels[y * width + x * 2 + nibble] = paletteAlpha[index] ?? 255;
      }
    }
    previous = row;
  }
  return pixels;
}

test('Nest vector markings preserve every default numeric UV silhouette', async () => {
  const original = defaultAtlasAlpha(await readFile(new URL('../dice/vendor/dice-box/assets/themes/default/diffuse-light.png', import.meta.url)));
  const svg = await readFile(new URL('numbers.svg', themeURL), 'utf8');
  const vector = Buffer.alloc(original.length);
  for (const [, opacity, path] of svg.matchAll(/<path opacity="([\d.]+)" d="([^"]+)"\/>/g)) {
    for (const [, x, y, width, closingWidth] of path.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      assert.equal(width, closingWidth);
      const start = Number(y) * 1024 + Number(x);
      vector.fill(Math.round(Number(opacity) * 255), start, start + Number(width));
    }
  }
  assert.deepEqual(vector, original);
});
