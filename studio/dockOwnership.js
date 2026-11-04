// Body-level styling is shared by v1 and v2 previews in each document.
const dockOwners = new WeakMap();

export function acquireDock(body) {
  let ownership = dockOwners.get(body);
  if (!ownership) {
    ownership = { count: 0, existing: body.classList.contains('has-inventory-dock') };
    dockOwners.set(body, ownership);
  }
  ownership.count++;
  body.classList.add('has-inventory-dock');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--ownership.count === 0) {
      if (!ownership.existing) body.classList.remove('has-inventory-dock');
      dockOwners.delete(body);
    }
  };
}
