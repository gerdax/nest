import test from 'node:test';
import assert from 'node:assert/strict';
import { InventorySurface } from '../studio/InventorySurface.js';

// DOM ownership and geometry fixture; these checks do not verify browser layout.
class Element {
  constructor(document) {
    this.ownerDocument = document; this.style = { position: '' }; this.children = [];
    this.parentNode = null; this.clientWidth = 0; this.clientHeight = 0;
  }
  get nextSibling() {
    return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] ?? null;
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, next) {
    child.remove();
    const index = next ? this.children.indexOf(next) : this.children.length;
    assert.ok(index >= 0);
    this.children.splice(index, 0, child); child.parentNode = this;
    return child;
  }
  remove() {
    if (!this.parentNode) return;
    this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
}

function environment() {
  const document = { defaultView: { innerWidth: 1200, innerHeight: 800,
    getComputedStyle: element => ({ position: element.style.position || 'static' }) } };
  document.createElement = () => new Element(document);
  document.body = document.createElement();
  globalThis.document = document;
  return document;
}

test('viewport surface uses fixed positioning and viewport bounds when geometry is absent', () => {
  const document = environment(), surface = new InventorySurface();
  assert.equal(surface.frame.parentNode, document.body);
  assert.equal(surface.root, surface.frame);
  assert.equal(surface.frame.className, 'nest-inventory-surface');
  assert.equal(surface.frame.style.position, 'fixed');
  assert.equal(surface.frame.style.inset, '0');
  assert.equal(surface.frame.style.pointerEvents, 'none');
  assert.equal(surface.frame.style.overflow, 'hidden');
  assert.deepEqual(surface.bounds(), { left: 0, top: 0, width: 1200, height: 800, right: 1200, bottom: 800 });
  surface.destroy();
  assert.equal(document.body.children.length, 0);
});

test('preview client coordinates convert to local coordinates using fresh scaled frame geometry', () => {
  const document = environment(), host = document.createElement();
  const surface = new InventorySurface({ container: host }), mini = document.createElement();
  assert.equal(host.style.position, 'relative');
  assert.equal(surface.frame.style.position, 'absolute');
  surface.frame.clientWidth = 400; surface.frame.clientHeight = 200;
  let rect = { left: 100, top: 50, width: 200, height: 100 };
  surface.frame.getBoundingClientRect = () => rect;
  surface.presentPreview(mini, { left: 150, top: 75, width: 40, height: 30 });
  assert.equal(mini.parentNode, surface.frame);
  assert.deepEqual(mini.style, { position: 'absolute', left: '100px', top: '50px', width: '80px',
    height: '60px', minHeight: '0', zIndex: '4000', pointerEvents: 'none' });
  rect = { left: 250, top: 120, width: 800, height: 600 };
  surface.presentPreview(mini, { left: 270, top: 150, width: 60, height: 90 });
  assert.equal(mini.style.left, '10px'); assert.equal(mini.style.top, '10px');
  assert.equal(mini.style.width, '30px'); assert.equal(mini.style.height, '30px');
  assert.deepEqual(surface.bounds(), { ...rect, right: 1050, bottom: 720 });
  surface.destroy();
  assert.equal(host.style.position, '');
});

test('element bounds use the frame and preserve empty geometry instead of viewport dimensions', () => {
  const document = environment(), host = document.createElement();
  host.clientWidth = 340; host.clientHeight = 210;
  const surface = new InventorySurface({ container: host });
  assert.equal(surface.bounds().height, 210);
  surface.frame.getBoundingClientRect = () => ({ left: 20, top: 30, width: 0, height: 0 });
  assert.deepEqual(surface.bounds(), { left: 20, top: 30, width: 0, height: 0, right: 20, bottom: 30 });
  surface.destroy();
});

test('destroy restores mounted drawer order and detached drawers, and is idempotent', () => {
  const document = environment(), parent = document.createElement();
  const before = document.createElement(), drawer = document.createElement(), after = document.createElement();
  for (const child of [before, drawer, after]) parent.appendChild(child);
  const surface = new InventorySurface(), detached = document.createElement();
  surface.mount(drawer); surface.mount(drawer); surface.mount(after); surface.mount(detached);
  const mini = document.createElement();
  surface.presentPreview(mini, { left: 5, top: 10, width: 20, height: 30 });
  surface.destroy(); surface.destroy();
  assert.deepEqual(parent.children, [before, drawer, after]);
  assert.equal(detached.parentNode, null);
  assert.equal(surface.frame.parentNode, null);
  assert.equal(document.body.children.length, 0);
});

test('independent surfaces retain separate previews and shared host positioning until final teardown', () => {
  const document = environment(), host = document.createElement();
  host.style.position = 'static';
  const first = new InventorySurface({ container: host }), second = new InventorySurface({ container: host });
  const a = document.createElement(), b = document.createElement(), c = document.createElement();
  for (const mini of [a, b]) first.presentPreview(mini, { left: 0, top: 0, width: 5, height: 5 });
  second.presentPreview(c, { left: 0, top: 0, width: 5, height: 5 });
  assert.deepEqual(first.frame.children, [a, b]);
  first.destroy();
  assert.equal(host.style.position, 'relative');
  assert.equal(second.frame.parentNode, host); assert.equal(c.parentNode, second.frame);
  second.destroy();
  assert.equal(host.style.position, 'static');
});

test('existing positioning and later externally changed positioning are preserved', () => {
  const document = environment();
  for (const position of ['fixed', 'absolute', 'relative', 'sticky']) {
    const host = document.createElement(); host.style.position = position;
    const surface = new InventorySurface({ container: host });
    surface.destroy(); assert.equal(host.style.position, position);
  }
  const host = document.createElement(), surface = new InventorySurface({ container: host });
  host.style.position = 'absolute'; surface.destroy();
  assert.equal(host.style.position, 'absolute');
});
