import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { bindImagePicker, matchImageFilename } from '../studio/image-picker.js';

const catalog = { version: 1, images: [
  { filename: 'scene #1.png', path: 'scene #1.png' },
  { filename: 'same.svg', path: 'one/same.svg' },
  { filename: 'same.svg', path: 'two/same.svg' },
  { filename: 'żółć.PNG', path: 'folder name/żółć.PNG' },
] };

test('filename matching returns encoded repository URLs and all ambiguous paths', () => {
  assert.deepEqual(matchImageFilename('scene #1.png', catalog), [{ path: 'scene #1.png', value: './assets/img/scene%20%231.png' }]);
  assert.deepEqual(matchImageFilename('same.svg', catalog).map(match => match.value), ['./assets/img/one/same.svg', './assets/img/two/same.svg']);
  assert.equal(matchImageFilename('żółć.PNG', catalog)[0].value, './assets/img/folder%20name/%C5%BC%C3%B3%C5%82%C4%87.PNG');
  assert.deepEqual(matchImageFilename('missing.png', catalog), []);
  assert.deepEqual(matchImageFilename('Same.svg', catalog), []);
  assert.deepEqual(matchImageFilename('source.psd', { images: [{ filename: 'source.psd', path: 'source.psd' }] }), []);
});

test('unsafe catalog paths and duplicate entries cannot produce incorrect project URLs', () => {
  const images = ['../same.svg', '/same.svg', 'one//same.svg', 'one\\same.svg', './same.svg', 'one/same.svg', 'one/same.svg']
    .map(path => ({ filename: 'same.svg', path }));
  assert.deepEqual(matchImageFilename('same.svg', { images }), [{ path: 'one/same.svg', value: './assets/img/one/same.svg' }]);
  assert.deepEqual(matchImageFilename(null, catalog), []);
  assert.deepEqual(matchImageFilename('same.svg', {}), []);
});

// A minimal event/DOM harness verifies picker state without claiming browser coverage.
class Element {
  constructor(tag = 'div') { this.tag = tag; this.dataset = {}; this.children = []; this.handlers = new Map(); }
  append(child) { child.parent = this; this.children.push(child); }
  after(child) { child.parent = this.parent; this.parent.children.splice(this.parent.children.indexOf(this) + 1, 0, child); }
  remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; }
  get nextElementSibling() { return this.parent?.children[this.parent.children.indexOf(this) + 1]; }
  hasAttribute(name) { return name === 'data-image-picker-feedback' && 'imagePickerFeedback' in this.dataset; }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  removeEventListener(name) { this.handlers.delete(name); }
  contains(element) { return element === this || this.children.some(child => child.contains(element)); }
  closest(selector) {
    const key = selector === '[data-placement]' ? 'placement' : 'imagePicker';
    return key in this.dataset ? this : this.parent?.closest(selector);
  }
  click() { return this.handlers.get('click')?.({ target: this, preventDefault() {} }); }
  async fire(name) { await this.handlers.get(name)?.(); }
}
function harness() {
  const inputs = [];
  const doc = { body: new Element(), baseURI: 'https://example.test/nest/editor.html', createElement(tag) { const element = new Element(tag); if (tag === 'input') inputs.push(element); return element; } };
  const root = new Element(); root.ownerDocument = doc;
  const placement = new Element(); placement.dataset.placement = 'item-1'; root.append(placement);
  const button = new Element('button'); button.dataset = { imagePicker: '', scope: 'placement', path: 'overrides.image' }; placement.append(button);
  const selections = [], errors = [];
  const cleanup = bindImagePicker(root, { onSelect: (...args) => selections.push(args), onError: message => errors.push(message) });
  const open = () => { root.handlers.get('click')({ target: button, preventDefault() {} }); return inputs.at(-1); };
  return { root, button, inputs, selections, errors, cleanup, open };
}

test('picker only commits matching project paths; cancel and unmatched names retain state', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => { urls.push(url.href); return { ok: true, json: async () => catalog }; };
  try {
    const h = harness();
    let input = h.open(); input.files = []; await input.fire('change');
    input = h.open(); await input.fire('cancel');
    assert.equal(h.selections.length, 0); assert.equal(h.errors.length, 0); assert.equal(urls.length, 0);
    input = h.open(); input.files = [{ name: 'scene #1.png' }]; await input.fire('change');
    assert.deepEqual(h.selections, [['placement', 'item-1', 'overrides.image', './assets/img/scene%20%231.png']]);
    assert.deepEqual(urls, ['https://example.test/nest/assets/image-manifest.json']);
    input = h.open(); input.files = [{ name: 'missing.png' }]; await input.fire('change');
    assert.equal(h.selections.length, 1); assert.match(h.errors[0], /existing path is unchanged/);
    assert.match(h.button.nextElementSibling.textContent, /missing.png/);
    input = h.open(); input.files = [{ name: 'same.svg' }]; await input.fire('change');
    assert.equal(h.selections.length, 1);
    const choices = h.button.nextElementSibling.children;
    assert.deepEqual(choices.map(choice => choice.textContent), ['assets/img/one/same.svg', 'assets/img/two/same.svg']);
    input = h.open(); await input.fire('cancel');
    choices[1].click();
    assert.deepEqual(h.selections[1], ['placement', 'item-1', 'overrides.image', './assets/img/two/same.svg']);
    input = h.open(); h.cleanup(); assert.equal(input.parent, null); assert.equal(h.root.handlers.has('click'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('an open editor recognizes newly added images and rejects removed images on the next selection', async () => {
  const originalFetch = globalThis.fetch;
  let current = catalog, calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.cache, 'no-store');
    return {ok:true,json:async()=>current};
  };
  try {
    const h = harness();
    let input = h.open();input.files = [{name:'scene #1.png'}];await input.fire('change');
    assert.equal(h.selections.length, 1);
    current = {version:1,images:[{filename:'new.jpeg',path:'new.jpeg'}]};
    input = h.open();input.files = [{name:'new.jpeg'}];await input.fire('change');
    assert.equal(h.selections.length, 2);
    assert.equal(h.selections[1][3], './assets/img/new.jpeg');
    input = h.open();input.files = [{name:'scene #1.png'}];await input.fire('change');
    assert.equal(h.selections.length, 2);
    assert.match(h.errors[0], /existing path is unchanged/);
    assert.equal(calls, 3);h.cleanup();
  } finally { globalThis.fetch = originalFetch; }
});

test('catalog failures report inline and allow retry', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? { ok: false } : { ok: true, json: async () => catalog });
  try {
    const h = harness();
    let input = h.open(); input.files = [{ name: 'scene #1.png' }]; await input.fire('change');
    assert.equal(h.selections.length, 0); assert.match(h.errors[0], /catalog/);
    input = h.open(); input.files = [{ name: 'scene #1.png' }]; await input.fire('change');
    assert.equal(h.selections.length, 1); h.cleanup();
  } finally { globalThis.fetch = originalFetch; }
});

test('Python image catalog is recursive, excludes source documents, and serves identical bytes', () => {
  const script = `
import tempfile, threading, urllib.request
from functools import partial
from pathlib import Path
from http.server import ThreadingHTTPServer
from image_catalog import image_files, image_manifest, image_manifest_bytes
from serve import PlaygroundHandler
with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    images = root / 'assets' / 'img'
    (images / 'nested folder').mkdir(parents=True)
    for name in ['a.png', 'source.psd', 'nested folder/a.png', 'nested folder/żółć.PNG']:
        (images / name).write_bytes(b'fixture')
    (images / 'outside.png').symlink_to(root / 'outside.png')
    (root / 'outside.png').write_bytes(b'fixture')
    paths = [entry['path'] for entry in image_manifest(root)['images']]
    assert paths == ['a.png', 'nested folder/a.png', 'nested folder/żółć.PNG'], paths
    assert len(image_files(root)) == 3
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(PlaygroundHandler, directory=str(root))) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        address = 'http://127.0.0.1:' + str(server.server_port) + '/assets/image-manifest.json'
        with urllib.request.urlopen(address) as response:
            assert response.read() == image_manifest_bytes(root)
            assert response.headers['Cache-Control'] == 'no-store'
            assert response.headers.get_content_type() == 'application/json'
        server.shutdown()
        thread.join()
`;
  const result = spawnSync('python3', ['-c', script], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
