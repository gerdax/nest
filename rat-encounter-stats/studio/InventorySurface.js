// Shared hosts keep their positioning context until the last surface releases it.
const positionedHosts = new WeakMap();

function retainPosition(container) {
  const retained = positionedHosts.get(container);
  if (retained) {
    retained.users++;
    return true;
  }
  const view = container.ownerDocument?.defaultView ?? globalThis;
  const position = view.getComputedStyle?.(container)?.position ?? container.style.position;
  if (position && position !== 'static') return false;
  positionedHosts.set(container, { users: 1, position: container.style.position });
  container.style.position = 'relative';
  return true;
}

function releasePosition(container) {
  const retained = positionedHosts.get(container);
  if (!retained || --retained.users) return;
  if (container.style.position === 'relative') container.style.position = retained.position;
  positionedHosts.delete(container);
}

/** An explicit clipping and coordinate space for a drawer and its drag previews. */
export class InventorySurface {
  constructor({ container = null } = {}) {
    this.container = container;
    this.document = container?.ownerDocument ?? document;
    this.mounted = new Map();
    this.destroyed = false;
    this.ownsPosition = container ? retainPosition(container) : false;
    this.frame = this.root = this.document.createElement('div');
    this.frame.className = 'nest-inventory-surface';
    Object.assign(this.frame.style, {
      position: container ? 'absolute' : 'fixed', inset: '0',
      pointerEvents: 'none', overflow: 'hidden', zIndex: '3000',
    });
    (container ?? this.document.body).appendChild(this.frame);
  }

  mount(root) {
    if (this.destroyed) return root;
    if (!this.mounted.has(root)) {
      this.mounted.set(root, { parent: root.parentNode, next: root.nextSibling });
    }
    this.frame.appendChild(root);
    return root;
  }

  bounds() {
    const rect = this.frame.getBoundingClientRect?.() ?? this.container?.getBoundingClientRect?.();
    const view = this.document.defaultView ?? globalThis;
    const left = rect?.left ?? 0, top = rect?.top ?? 0;
    const width = rect?.width ?? (this.container
      ? this.container.clientWidth ?? 0
      : view.innerWidth ?? this.document.documentElement?.clientWidth ?? 0);
    const height = rect?.height ?? (this.container
      ? this.container.clientHeight ?? 0
      : view.innerHeight ?? this.document.documentElement?.clientHeight ?? 0);
    return { left, top, width, height, right: left + width, bottom: top + height };
  }

  presentPreview(element, { left, top, width, height }) {
    if (this.destroyed) return element;
    const rect = this.bounds();
    const scaleX = this.frame.clientWidth > 0 && rect.width > 0 ? rect.width / this.frame.clientWidth : 1;
    const scaleY = this.frame.clientHeight > 0 && rect.height > 0 ? rect.height / this.frame.clientHeight : 1;
    if (element.parentNode !== this.frame) this.frame.appendChild(element);
    Object.assign(element.style, {
      position: 'absolute', left: `${(left - rect.left) / scaleX}px`,
      top: `${(top - rect.top) / scaleY}px`, width: `${width / scaleX}px`,
      height: `${height / scaleY}px`, minHeight: '0', zIndex: '4000', pointerEvents: 'none',
    });
    return element;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    // Reverse insertion order also restores adjacent mounted siblings correctly.
    for (const [root, { parent, next }] of [...this.mounted].reverse()) {
      if (parent) parent.insertBefore(root, next?.parentNode === parent ? next : null);
      else root.remove();
    }
    this.mounted.clear();
    this.frame.remove();
    if (this.ownsPosition) releasePosition(this.container);
  }
}
