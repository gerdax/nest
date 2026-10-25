import { createError } from '../errors.js';
// Revisions live only for this page session; authored paths remain unchanged.
const revisions = new Map();
let sequence = 0;

function normalizedUrl(image, baseURI) {
  if (typeof image !== 'string' || !image.trim()) return null;
  try {
    return new URL(image, baseURI ?? globalThis.document?.baseURI ?? globalThis.location?.href).href;
  } catch { return null; }
}

export function artworkUrl(image, baseURI) {
  return revisions.get(normalizedUrl(image, baseURI))?.url ?? image;
}

export function setArtworkSource(element, image) {
  element.setAttribute('data-artwork-source', image);
  const url = artworkUrl(image, element.ownerDocument?.baseURI);
  if (element.tagName?.toLowerCase() === 'img') element.src = url;
  else element.style.backgroundImage = `url(${JSON.stringify(url)})`;
}

function preload(url, ImageConstructor) {
  return new Promise((resolve, reject) => {
    const image = new ImageConstructor();
    image.onload = async () => {
      try {
        if (image.decode) await image.decode();
        resolve();
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(createError('ARTWORK_THE_IMAGE_COULD_NOT_BE_LOADED'));
    image.src = url;
  });
}

/** Load a fresh revision before updating matching artwork in the supplied DOM. */
export async function reloadArtwork(image, { root = globalThis.document } = {}) {
  const doc = root?.ownerDocument ?? root;
  const source = normalizedUrl(image, doc?.baseURI);
  if (!source) throw createError('ARTWORK_INVALID_IMAGE_PATH', { image });
  if (!['http:', 'https:', 'file:'].includes(new URL(source).protocol)) return artworkUrl(image, doc?.baseURI);
  const ImageConstructor = doc?.defaultView?.Image ?? globalThis.Image;
  if (!ImageConstructor) throw createError('ARTWORK_CANNOT_RELOAD_ARTWORK_IMAGE_LOADING_IS_UNAVAILABLE');
  const revision = revisions.get(source) ?? {};
  revisions.set(source, revision);
  const request = ++sequence;
  revision.request = request;
  // Append without rewriting the authored query or fragment.
  const hashAt = source.indexOf('#');
  const path = hashAt < 0 ? source : source.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : source.slice(hashAt);
  const url = `${path}${path.includes('?') ? '&' : '?'}nest-artwork-reload=${Date.now()}-${request}${hash}`;
  try { await preload(url, ImageConstructor); }
  catch (error) { throw createError('ARTWORK_RELOAD_FAILED', { image }, { cause: error }); }
  // A slower request must never overwrite a more recent request for this source.
  if (revision.request !== request) return revision.url ?? image;
  revision.url = url;
  const elements = [...(root?.querySelectorAll?.('[data-artwork-source]') ?? [])];
  if (root?.getAttribute?.('data-artwork-source') != null) elements.push(root);
  for (const element of elements) {
    const authored = element.getAttribute('data-artwork-source');
    if (normalizedUrl(authored, element.ownerDocument?.baseURI ?? doc?.baseURI) === source) setArtworkSource(element, authored);
  }
  return url;
}
