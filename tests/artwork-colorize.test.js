import test from 'node:test';
import assert from 'node:assert/strict';
import { applyArtworkColorize } from '../engine/artworkColorize.js';
import { decorateCard, stageNextBack } from '../engine/renderer.js';

class Element {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.style = {};
    this.children = [];
    this.attributes = {};
  }
  setAttribute(key, value) { this.attributes[key] = value; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
}

function documentMock({ body = true, lookup = true } = {}) {
  const doc = { createElement: () => new Element(doc) };
  if (body) doc.body = new Element(doc);
  if (lookup) doc.getElementById = id => doc.body?.children.find(child => child.innerHTML?.includes(`id="${id}"`));
  return doc;
}

function withDocument(doc, callback) {
  const previous = globalThis.document;
  globalThis.document = doc;
  try { return callback(); } finally { globalThis.document = previous; }
}

test('filter maps source luminance to Hue 70 / Saturation 16 with neutral lightness adjustment and preserved alpha', () => {
  const doc = documentMock();
  applyArtworkColorize(doc.createElement('div'));
  const svg = doc.body.children[0].innerHTML;
  assert.match(svg, /color-interpolation-filters="sRGB"/);
  const matrix = svg.match(/values="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  assert.deepEqual(matrix, [
    .2126, .7152, .0722, 0, 0,
    .2126, .7152, .0722, 0, 0,
    .2126, .7152, .0722, 0, 0,
    0, 0, 0, 1, 0
  ]);
  const tables = [...svg.matchAll(/<feFunc[RGB] type="table" tableValues="([^"]+)"/g)]
    .map(match => match[1].split(' ').map(Number));
  assert.equal(tables.length, 3);
  assert.match(svg, /<feFuncA type="identity"/);
  const mapPixel = ([r, g, b, alpha]) => {
    const luminance = matrix[0] * r + matrix[1] * g + matrix[2] * b;
    return [...tables.map(([black, mid, white]) => luminance <= .5
      ? black + (mid - black) * luminance * 2
      : mid + (white - mid) * (luminance - .5) * 2), alpha];
  };
  assert.deepEqual(mapPixel([0, 0, 0, .3]), [0, 0, 0, .3]);
  assert.deepEqual(mapPixel([1, 1, 1, .7]), [1, 1, 1, .7]);
  assert.deepEqual(mapPixel([.5, .5, .5, .4]), [.5533333333333333, .58, .42, .4]);
  const [r, g, b] = mapPixel([.5, .5, .5, 1]);
  const lightness = (g + b) / 2;
  const saturation = (g - b) / (1 - Math.abs(2 * lightness - 1));
  const hue = 60 * ((b - r) / (g - b) + 2);
  assert.ok(Math.abs(hue - 70) < 1e-10);
  assert.ok(Math.abs(saturation - .16) < 1e-10);
  assert.equal(lightness, .5);
  // A red source uses its luminance, rather than retaining its original hue.
  const red = mapPixel([1, 0, 0, .2]);
  assert.ok(Math.abs(red[1] - .58 * .2126 * 2) < 1e-10);
  assert.equal(red[3], .2);
});

test('registers once per owner document, including documents without ID lookup', () => {
  for (const lookup of [true, false]) {
    const first = documentMock({ lookup }), second = documentMock({ lookup });
    withDocument(first, () => {
      const image = second.createElement('img');
      assert.equal(applyArtworkColorize(image), true);
      applyArtworkColorize(second.createElement('div'));
      assert.equal(second.body.children.length, 1);
      assert.equal(first.body.children.length, 0);
      applyArtworkColorize(first.createElement('div'));
      assert.equal(first.body.children.length, 1);
      assert.equal(image.style.filter, 'url("#nest-artwork-colorize")');
      const holder = second.body.children[0];
      assert.equal(holder.attributes['aria-hidden'], 'true');
      assert.match(holder.style.cssText, /width:0;height:0/);
      assert.doesNotMatch(holder.style.cssText, /display\s*:\s*none/);
      assert.match(holder.innerHTML, /width="0" height="0"/);
    });
  }
});

test('a document without body is harmless and can register when its body becomes available', () => {
  const doc = documentMock({ body: false });
  const artwork = doc.createElement('div');
  assert.equal(applyArtworkColorize(artwork), false);
  assert.equal(artwork.style.filter, undefined);
  doc.body = new Element(doc);
  assert.equal(applyArtworkColorize(artwork), true);
  assert.equal(doc.body.children.length, 1);
  withDocument(undefined, () => assert.equal(applyArtworkColorize({ style: {} }), false));
});

test('card artwork alone is filtered, preserving crop/flip and excluding captions, text, texture and backs', () => {
  const doc = documentMock();
  withDocument(doc, () => {
    for (const cardKind of ['event', 'narrative', 'action', 'item']) {
      const card = doc.createElement('article');
      decorateCard(null, card, 'original.png', 'Title', 'Text', true,
        { cardKind, imageScale: 150, imageOffsetX: -12, imageOffsetY: 8, summary: 'Summary' });
      const [copy, artwork, texture] = card.children;
      assert.equal(artwork.style.filter, 'url("#nest-artwork-colorize")');
      assert.match(artwork.className, /nest-artwork-vignetted/);
      assert.equal(artwork.style.backgroundImage, 'url("original.png")');
      assert.equal(artwork.style.transform, 'translate(-12%, 8%) scale(1.5) scaleX(-1)');
      for (const unfiltered of [card, copy, ...copy.children, texture, ...card.children.slice(3)]) {
        assert.equal(unfiltered.style.filter, undefined);
      }
    }
    for (const [image, cardKind] of [['original.png', 'caption'], ['', 'event']]) {
      const card = doc.createElement('article');
      decorateCard(null, card, image, 'Title', 'Text', true, { cardKind, imageScale: 150 });
      assert.equal(card.children[1].style.filter, undefined);
      assert.doesNotMatch(card.children[1].className, /vignetted/);
      assert.equal(card.children[1].style.backgroundImage, undefined);
      if (cardKind === 'caption') assert.equal(card.children[1].style.transform, '');
    }
    const deck = { mount: doc.createElement('div'), content: { cardBack: {background:'back.png',icons:{default:'custom-nest.png'}} } };
    stageNextBack(deck);
    assert.equal(deck.underlayBack.style.backgroundImage, 'url("back.png")');
    assert.equal(deck.underlayBack.style.filter, undefined);
    for (const child of deck.underlayBack.children) assert.equal(child.style.filter, undefined);
    assert.equal(deck.underlayBack.backIcons.get('default').attributes.src, 'custom-nest.png');
    assert.equal(deck.underlayBack.backIcons.get('dice').attributes.src, './assets/img/ui/dice.png');
    assert.equal(deck.underlayBack.backIcons.get('default').hidden, false);
    assert.equal(deck.underlayBack.backIcons.get('dice').hidden, true);
    assert.equal(doc.body.children.length, 1);
  });
});

test('renderer mocks without a body still decorate artwork and crop settings', () => {
  const doc = documentMock({ body: false, lookup: false });
  withDocument(doc, () => {
    const card = doc.createElement('article');
    decorateCard(null, card, 'original.png', '', 'Text', true, { imageScale: 125 });
    assert.equal(card.children[1].style.backgroundImage, 'url("original.png")');
    assert.equal(card.children[1].style.transform, 'scale(1.25) scaleX(-1)');
    assert.equal(card.children[1].style.filter, undefined);
  });
});
