import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { defaultCardColors } from '../project/card-styles.js';

const themeURL = new URL('../dice/themes/nest/', import.meta.url);
const theme = JSON.parse(await readFile(new URL('theme.config.json', themeURL)));

test('Nest covers every numeric die and resolves its local material assets', async () => {
  assert.deepEqual(theme.diceAvailable, ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);
  // Omission intentionally uses the loader's default mesh and face map.
  assert.equal(theme.meshFile, undefined);
  assert.equal(theme.material.type, 'standard');
  assert.equal(theme.material.diffuseTexture, 'numbers.png');
  const png = await readFile(new URL(theme.material.diffuseTexture, themeURL));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString('ascii', 12, 16), 'IHDR');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
  // The default bump atlas would emboss the old d6 digits through the pips.
  assert.equal(theme.material.bumpTexture, undefined);
});

test('the preserved SVG source retains the original Nest palette and vector markings', async () => {
  const svg = await readFile(new URL('numbers.svg', themeURL), 'utf8');
  assert.ok(svg.includes(`fill="${defaultCardColors.big}"`));
  assert.equal(defaultCardColors.big, defaultCardColors.medium);
  assert.match(svg, /fill="#000000"/);
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

const d6Cells = [[850, 310, 174, 180], [395, 15, 174, 180], [220, 15, 174, 180], [850, 490, 174, 180], [850, 670, 174, 180], [850, 850, 174, 174]];

test('Nest preserves every numeric UV silhouette outside the six d6 cells', async () => {
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
  let replacedPixels = 0;
  for (const [x, y, width, height] of d6Cells) {
    for (let row = y; row < y + height; row++) {
      const start = row * 1024 + x;
      replacedPixels += original.subarray(start, start + width).filter(Boolean).length;
      assert.ok(vector.subarray(start, start + width).every(pixel => pixel === 0), 'd6 has no leftover numeric spans');
      original.fill(0, start, start + width);
    }
  }
  assert.ok(replacedPixels > 10000, 'the six numeric faces were replaced');
  assert.deepEqual(vector, original);
});


test('d6 pip counts and locations agree with the unchanged default collider face values', async () => {
  const meshData = JSON.parse(await readFile(new URL('../dice/vendor/dice-box/assets/themes/default/default.json', import.meta.url)));
  const mesh = meshData.meshes.find(mesh => mesh.name === 'd6');
  const collider = meshData.meshes.find(mesh => mesh.name === 'd6_collider');
  const svg = await readFile(new URL('numbers.svg', themeURL), 'utf8');
  function triangles(mesh) {
    return Array.from({ length: mesh.indices.length / 3 }, (_, index) => {
      const ids = mesh.indices.slice(index * 3, index * 3 + 3);
      const positions = ids.map(id => mesh.positions.slice(id * 3, id * 3 + 3));
      const a = positions[1].map((v, i) => v - positions[0][i]);
      const b = positions[2].map((v, i) => v - positions[0][i]);
      const normal = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
      const area = Math.hypot(...normal);
      const axis = normal.findIndex(v => Math.abs(v) === Math.max(...normal.map(Math.abs)));
      return { index, ids, area, direction: `${axis}:${Math.sign(normal[axis])}` };
    });
  }
  const surface = triangles(mesh).filter(triangle => triangle.area > 0.01);
  const groups = [...svg.matchAll(/<g id="d6-face-(\d)">([\s\S]*?)<\/g>/g)];
  assert.equal(groups.length, 6);
  for (const [index, [, value, content]] of groups.entries()) {
    assert.equal(Number(value), index + 1);
    const dots = [...content.matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"\/>/g)].map(match => match.slice(1).map(Number));
    assert.equal(dots.length, Number(value));
    assert.equal(new Set(dots.map(([x, y]) => `${x},${y}`)).size, Number(value));
    const [x, y, width, height] = d6Cells[index];
    for (const [cx, cy, radius] of dots) {
      assert.equal(radius, 11);
      assert.ok(cx-radius > x && cx+radius < x+width && cy-radius > y && cy+radius < y+height);
    }
    const face = surface.filter(triangle => triangle.ids.every(id => {
      const u = mesh.uvs[id * 2] * 1024, v = (1 - mesh.uvs[id * 2 + 1]) * 1024;
      return u >= x && u <= x+width && v >= y && v <= y+height;
    }));
    assert.equal(face.length, 2, 'each pip group covers exactly one square face');
    const colliderFaces = triangles(collider).filter(triangle => triangle.direction === face[0].direction);
    assert.equal(colliderFaces.length, 2, 'both collider triangles cover this visible face');
    for (const triangle of colliderFaces) {
      assert.equal(meshData.colliderFaceMap.d6[triangle.index], Number(value), 'visible pips match the physics result');
    }
  }
});
