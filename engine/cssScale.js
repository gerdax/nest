/** CSS zoom changes viewport measurements, while engine poses use layout pixels. */
export function cssScale(element) {
  const doc = element?.ownerDocument, win = doc?.defaultView;
  const zoom = doc?.documentElement && win?.getComputedStyle
    ? Number(win.getComputedStyle(doc.documentElement).zoom) : 1;
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

export function layoutBounds(element) {
  const bounds = element.getBoundingClientRect(), scale = cssScale(element);
  return Object.fromEntries(['width', 'height', 'left', 'top', 'right', 'bottom'].map(key => [key, bounds[key] / scale]));
}
