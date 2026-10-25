import test from 'node:test';
import assert from 'node:assert/strict';
import { artworkUrl, reloadArtwork, setArtworkSource } from '../engine/artworkReload.js';
import { decorateCard } from '../engine/renderer.js';
import { InventoryView } from '../studio/InventoryView.js';
import { TriggerItemMini } from '../studio/TriggerItemMini.js';

class Element {
  constructor(doc, tagName = 'div') {
    this.ownerDocument = doc; this.tagName = tagName; this.style = {}; this.attributes = {}; this.children = [];
    this.classList = { add() {} };
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() {
    return this.children.flatMap(child => [...(child.getAttribute('data-artwork-source') === null ? [] : [child]), ...child.querySelectorAll()]);
  }
}

function fixture(path) {
  const requests = [];
  class Image {
    set src(url) { this.url = url; requests.push(this); }
    async decode() { if (this.decodeError) throw new Error('Invalid image bytes'); }
  }
  const doc = {
    baseURI: `https://nest.test/${path}/editor.html`, defaultView: { Image },
    createElement(tag) { return new Element(doc, tag); }
  };
  const root = doc.createElement('main');
  doc.body = doc.createElement('body');
  return { doc, root, requests };
}

test('repeated reloads preload fresh URLs, preserve query/hash and update only matching scoped artwork', async () => {
  const { doc, root, requests } = fixture('repeat');
  const source = './art.png?size=2%20x&quality=high#crop';
  const background = doc.createElement('div'), image = doc.createElement('img'), other = doc.createElement('img');
  setArtworkSource(background, source);
  setArtworkSource(image, 'https://nest.test/repeat/art.png?size=2%20x&quality=high#crop');
  setArtworkSource(other, './other.png');
  root.append(background, image, other);
  const outside = doc.createElement('img'); setArtworkSource(outside, source);
  background.style.transform = 'scaleX(-1)'; background.style.filter = 'existing';
  const game = { card: { image: source }, history: ['a'], turn: 4 };
  const before = JSON.stringify(game);
  const first = reloadArtwork(game.card.image, { root });
  assert.equal(image.src, 'https://nest.test/repeat/art.png?size=2%20x&quality=high#crop');
  requests[0].onload();
  const firstUrl = await first;
  assert.match(firstUrl, /art\.png\?size=2%20x&quality=high&nest-artwork-reload=[^#]+#crop$/);
  assert.equal(image.src, firstUrl);
  assert.equal(background.style.backgroundImage, `url(${JSON.stringify(firstUrl)})`);
  assert.equal(other.src, './other.png'); assert.equal(outside.src, source);
  assert.equal(background.style.transform, 'scaleX(-1)'); assert.equal(background.style.filter, 'existing');
  const second = reloadArtwork(source, { root }); requests[1].onload();
  const secondUrl = await second;
  assert.notEqual(firstUrl, secondUrl);
  assert.equal(artworkUrl(source, doc.baseURI), secondUrl);
  assert.equal(image.getAttribute('data-artwork-source'), 'https://nest.test/repeat/art.png?size=2%20x&quality=high#crop');
  assert.equal(JSON.stringify(game), before);
});

test('load or decode failure preserves the visible and future revision', async () => {
  const { doc, root, requests } = fixture('failure');
  const image = doc.createElement('img'); setArtworkSource(image, './art.png'); root.append(image);
  const success = reloadArtwork('./art.png', { root }); requests[0].onload(); const previous = await success;
  for (const failDecode of [false, true]) {
    const pending = reloadArtwork('./art.png', { root });
    const rejected = assert.rejects(pending, /previous image is still in use/);
    const request = requests.at(-1);
    if (failDecode) { request.decodeError = true; request.onload(); } else request.onerror();
    await rejected;
    assert.equal(image.src, previous); assert.equal(artworkUrl('./art.png', doc.baseURI), previous);
  }
});

test('slower earlier requests never replace a newer revision', async () => {
  const { doc, root, requests } = fixture('race');
  const first = reloadArtwork('./art.png', { root });
  const second = reloadArtwork('./art.png', { root });
  requests[1].onload(); const newest = await second;
  requests[0].onload(); await first;
  assert.equal(artworkUrl('./art.png', doc.baseURI), newest);
});

test('future card, inventory and trigger renders use the loaded revision', async () => {
  const { doc, root, requests } = fixture('render');
  const pending = reloadArtwork('./art.png', { root }); requests[0].onload(); const url = await pending;
  const previousDoc = globalThis.document; globalThis.document = doc;
  try {
    const card = doc.createElement('article');
    decorateCard(null, card, './art.png', 'Item', 'Text', true, { cardKind: 'item', imageScale: 150 });
    const artwork = card.children[1];
    assert.equal(artwork.style.backgroundImage, `url(${JSON.stringify(url)})`);
    assert.equal(artwork.style.transform, 'scale(1.5) scaleX(-1)');
    const item = { image: './art.png', flipImage: true };
    const inventory = InventoryView.prototype.itemButton.call({}, item);
    assert.equal(inventory.children[0].children[0].src, url);
    const miniRoot = doc.createElement('aside');
    const mini = new TriggerItemMini(miniRoot); mini.update(item);
    assert.equal(miniRoot.children[0].children[0].children[0].src, url);
  } finally { globalThis.document = previousDoc; }
});

test('embedded and blob images remain unchanged without adding cache queries', async () => {
  const { root, requests } = fixture('embedded');
  for (const source of ['data:image/png;base64,AA==', 'blob:https://nest.test/123']) {
    assert.equal(await reloadArtwork(source, { root }), source);
  }
  assert.equal(requests.length, 0);
  for (const source of ['', undefined, null]) await assert.rejects(reloadArtwork(source, { root }), /invalid image path/);
});
