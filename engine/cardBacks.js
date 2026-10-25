import { errorMessage } from '../errors.js';
export const defaultCardBack = Object.freeze({
  background: './assets/img/ui/cardback.png',
  icons: Object.freeze({ default: './assets/img/ui/default.png' }),
  iconScale: 1,
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function imagePath(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/** Validate active appearance fields; unused legacy settings are ignored. */
export function validateCardBack(value) {
  if (value === undefined) return [];
  if (!isRecord(value)) return [errorMessage('PROJECT_CARDBACK_MUST_BE_AN_OBJECT')];
  const errors = [];
  if (value.background !== undefined && !imagePath(value.background, null)) errors.push(errorMessage('PROJECT_CARDBACK_BACKGROUND_MUST_BE_A_NONEMPTY_STRING'));
  if (value.icons !== undefined) {
    if (!isRecord(value.icons)) errors.push(errorMessage('PROJECT_CARDBACK_ICONS_MUST_BE_AN_OBJECT'));
    else {
      if (value.icons.default !== undefined && !imagePath(value.icons.default, null)) errors.push(errorMessage('PROJECT_CARDBACK_ICONS_DEFAULT_MUST_BE_A_NONEMPTY_STRING'));
    }
  }
  if (value.iconScale !== undefined && (!Number.isFinite(value.iconScale) || value.iconScale <= 0)) errors.push(errorMessage('PROJECT_CARDBACK_ICONSCALE_MUST_BE_A_POSITIVE_FINITE_NUMBER'));
  return errors;
}

/** Resolve layered appearance without changing the supplied content or config. */
export function resolveBackAppearance(content = {}) {
  const value = isRecord(content) ? content : {};
  const config = isRecord(value.cardBack) ? value.cardBack : null;
  const icons = { ...defaultCardBack.icons };
  if (isRecord(config?.icons)) {
    icons.default = imagePath(config.icons.default, icons.default);
  }
  return {
    background: imagePath(config?.background, defaultCardBack.background),
    icons,
    iconScale: Number.isFinite(config?.iconScale) && config.iconScale > 0 ? config.iconScale : defaultCardBack.iconScale,
  };
}
