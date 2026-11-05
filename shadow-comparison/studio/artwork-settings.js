import { createError } from '../errors.js';
/** Copy artwork only, leaving card identity, writing and mechanics untouched. */
export function artworkSettings(card) {
  return { image: card.image ?? '', imageScale: card.imageScale ?? 100,
    imageOffsetX: card.imageOffsetX ?? 0, imageOffsetY: card.imageOffsetY ?? 0,
    flipImage: !!card.flipImage };
}

export function parseArtworkSettings(text) {
  const value = JSON.parse(text);
  if (!value || typeof value.image !== 'string' || typeof value.flipImage !== 'boolean' ||
      !Number.isFinite(value.imageScale) || value.imageScale < 10 || value.imageScale > 400 ||
      ['imageOffsetX','imageOffsetY'].some(key => !Number.isFinite(value[key]) || Math.abs(value[key]) > 100)) {
    throw createError('STUDIO_COPIED_IMAGE_SETTINGS_ARE_INVALID');
  }
  return artworkSettings(value);
}
