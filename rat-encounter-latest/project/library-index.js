/** Operation-scoped lookups retain live definitions and Array.find's first match.
 * Recreate after replacing definitions or changing their IDs/kinds.
 */
export function createLibraryIndex(library) {
  const byId = new Map(), itemsById = new Map();
  let usable = true;
  for (const definition of library) {
    // Unguarded legacy lookups can throw on malformed entries, but only if
    // their scan reaches the entry. Preserve that behavior with direct scans.
    if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) usable = false;
    const id = definition?.id;
    // Map considers NaN equal to itself; the resolver's strict equality does not.
    if (Number.isNaN(id)) continue;
    if (!byId.has(id)) byId.set(id, definition);
    if (definition?.kind === 'item' && !itemsById.has(id)) itemsById.set(id, definition);
  }
  return {byId, itemsById, usable};
}
