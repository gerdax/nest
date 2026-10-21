import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyMaterialShine } from '../dice/material-shine.js';

function fakeMaterial() {
  return {
    specularColor: { values: [1, 1, 1], set(...values) { this.values = values; } },
    specularPower: 64,
  };
}

test('shine settings accept zero, preserve omitted defaults and ignore invalid values', () => {
  for (const value of [undefined, null, '0', -1, NaN, Infinity]) {
    const material = fakeMaterial();
    applyMaterialShine(material, { specularIntensity: value, specularPower: value });
    assert.deepEqual(material.specularColor.values, [1, 1, 1]);
    assert.equal(material.specularPower, 64);
  }
  const material = fakeMaterial();
  applyMaterialShine(material, { specularIntensity: 0, specularPower: 0 });
  assert.deepEqual(material.specularColor.values, [0, 0, 0]);
  assert.equal(material.specularPower, 0);
  applyMaterialShine(material, { specularIntensity: 0.25, specularPower: 128 });
  assert.deepEqual(material.specularColor.values, [0.25, 0.25, 0.25]);
  assert.equal(material.specularPower, 128);
});

const base = new URL('../dice/vendor/dice-box/', import.meta.url);
const onscreen = await readFile(new URL('world.onscreen.js', base), 'utf8');
const wrapper = await readFile(new URL('world.offscreen.js', base), 'utf8');
const offscreen = Buffer.from(wrapper.match(/const p = "([^"]+)"/)[1], 'base64').toString('utf8');

test('offscreen worker embeds the current self-contained shine helper and parses', () => {
  assert.ok(offscreen.startsWith(applyMaterialShine.toString()));
  new vm.Script(offscreen);
});

// Execute the actual material-loader methods with Babylon-shaped test doubles.
// This verifies configuration reaches both material paths, without WebGL.
for (const [name, source, bindings] of [
  ['onscreen', onscreen, ['g', 'Re', 'mi']],
  ['offscreen', offscreen, ['B', 'ri', 'Kr']],
]) {
  test(`${name} applies shine to standard materials and both color variants`, async () => {
    const created = [];
    class Material {
      constructor(name) { Object.assign(this, fakeMaterial(), { name }); created.push(this); }
      Vertex_Definitions() { return this; }
      Vertex_MainEnd() { return this; }
      Fragment_Definitions() { return this; }
      Fragment_Custom_Diffuse() { return this; }
      AddAttribute() {}
      clone(name) {
        const copy = new Material(name);
        copy.specularColor.set(...this.specularColor.values);
        copy.specularPower = this.specularPower;
        return copy;
      }
    }
    const methods = source.slice(source.indexOf('async loadStandardMaterial('), source.indexOf('async getTexture('));
    const Loader = new Function(...bindings, 'applyMaterialShine', `return class { ${methods} }`)(
      Material, Material, value => structuredClone(value), applyMaterialShine,
    );
    const loader = new Loader();
    loader.getTexture = async () => ({});
    const options = { theme: 'test', material: { specularIntensity: 0.3, specularPower: 16, specularTexture: 'map.png' } };
    await loader.loadStandardMaterial(options);
    await loader.loadColorMaterial(options);
    assert.equal(created.length, 3);
    for (const material of created) {
      assert.deepEqual(material.specularColor.values, [0.3, 0.3, 0.3]);
      assert.equal(material.specularPower, 16);
    }
  });
}
