const FILTER_ID = 'nest-artwork-colorize';
const registrations = new WeakSet();

// Colorize grayscale lightness with HSL(70, 16%, 50%) at the midpoint,
// retaining black/white endpoints and the source alpha. This is an sRGB
// approximation of the authored Colorize adjustment, not a Photoshop pixel match.
const FILTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" aria-hidden="true" focusable="false">
  <defs>
    <filter id="${FILTER_ID}" color-interpolation-filters="sRGB">
      <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0
        0.2126 0.7152 0.0722 0 0
        0.2126 0.7152 0.0722 0 0
        0 0 0 1 0" />
      <feComponentTransfer>
        <feFuncR type="table" tableValues="0 0.5533333333333333 1" />
        <feFuncG type="table" tableValues="0 0.58 1" />
        <feFuncB type="table" tableValues="0 0.42 1" />
        <feFuncA type="identity" />
      </feComponentTransfer>
    </filter>
  </defs>
</svg>`;

export function applyArtworkColorize(element) {
  const doc = element?.ownerDocument || globalThis.document;
  // Renderer-only mocks and documents that have not created a body can still
  // decorate cards without installing a dangling filter reference.
  if (!element?.style || !doc?.body || !doc.createElement) return false;
  const registered = doc.getElementById
    ? doc.getElementById(FILTER_ID)
    : registrations.has(doc);
  if (!registered) {
    const holder = doc.createElement('div');
    holder.setAttribute('aria-hidden', 'true');
    // Keep definitions in the render tree: display:none breaks SVG filter
    // references in some browsers, including Safari.
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;left:-10000px;top:-10000px;';
    holder.innerHTML = FILTER_SVG;
    doc.body.append(holder);
    registrations.add(doc);
  }
  element.style.filter = `url("#${FILTER_ID}")`;
  return true;
}
