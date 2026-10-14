const UI_PATH = './assets/img/ui/';
const ICON_NAMES = ['default', 'container', 'dice', 'collect', 'discard'];
export const defaultCardBack = Object.freeze({
  background: `${UI_PATH}cardback.png`,
  icons: Object.freeze(Object.fromEntries(ICON_NAMES.map(name => [name, `${UI_PATH}${name}.png`]))),
  iconScale: 1,
  switchDistance: 6,
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function imagePath(value, fallback) {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/** Validate authored config. Unknown icon names are reserved for extensions. */
export function validateCardBack(value) {
  if (value === undefined) return [];
  if (!isRecord(value)) return ['cardBack must be an object'];
  const errors = [];
  if (value.background !== undefined && !imagePath(value.background, null)) errors.push('cardBack.background must be a nonempty string');
  if (value.icons !== undefined) {
    if (!isRecord(value.icons)) errors.push('cardBack.icons must be an object');
    else for (const name of ICON_NAMES) {
      if (value.icons[name] !== undefined && !imagePath(value.icons[name], null)) errors.push(`cardBack.icons.${name} must be a nonempty string`);
    }
  }
  if (value.iconScale !== undefined && (!Number.isFinite(value.iconScale) || value.iconScale <= 0)) errors.push('cardBack.iconScale must be a positive finite number');
  if (value.switchDistance !== undefined && (!Number.isFinite(value.switchDistance) || value.switchDistance < 0)) errors.push('cardBack.switchDistance must be a nonnegative finite number');
  if (value.switchProgress !== undefined && (!Number.isFinite(value.switchProgress) || value.switchProgress < 0 || value.switchProgress > 1)) errors.push('cardBack.switchProgress must be a number between 0 and 1');
  return errors;
}

/** Resolve layered appearance without changing the supplied content or config. */
export function resolveBackAppearance(content = {}) {
  const value = isRecord(content) ? content : {};
  const config = isRecord(value.cardBack) ? value.cardBack : null;
  const icons = { ...defaultCardBack.icons };
  if (isRecord(config?.icons)) {
    for (const name of ICON_NAMES) icons[name] = imagePath(config.icons[name], icons[name]);
  }
  return {
    background: imagePath(config?.background, defaultCardBack.background),
    icons,
    iconScale: Number.isFinite(config?.iconScale) && config.iconScale > 0 ? config.iconScale : defaultCardBack.iconScale,
    switchDistance: Number.isFinite(config?.switchDistance) && config.switchDistance >= 0 ? config.switchDistance : defaultCardBack.switchDistance,
    ...(Number.isFinite(config?.switchProgress) && config.switchProgress >= 0 && config.switchProgress <= 1 ? { switchProgress: config.switchProgress } : {}),
  };
}

/** Identify the operation being previewed by a cover or action card. */
export function resolveBackOperation(content = {}, options = {}) {
  const value = isRecord(content) ? content : {};
  const { source, action, count, direction, blocked = false } = isRecord(options) ? options : {};
  if (blocked || !['cover', 'actions'].includes(source)) return null;
  if (source === 'cover' && value.flipItemsOnReveal) return 'container';
  if ((source === 'actions' && action?.resolution === 'check') || value.backOperation === 'dice') return 'dice';
  if (source === 'actions' && value.interaction === 'container') {
    if (direction === -1) return 'discard';
    if (direction === 1 && count === 1) return 'collect';
  }
  return null;
}

/** Select at the threshold; temporal hysteresis belongs to the animation caller. */
export function selectBackIcon(appearance, operation, progress, distance = 0) {
  if (!isRecord(appearance) || !isRecord(appearance.icons)) return null;
  const reached = Number.isFinite(appearance.switchProgress)
    ? Number.isFinite(progress) && progress >= appearance.switchProgress
    : Number.isFinite(distance) && distance > 0 && distance >= (appearance.switchDistance ?? defaultCardBack.switchDistance);
  const contextual = reached && ICON_NAMES.includes(operation);
  return appearance.icons[contextual ? operation : 'default'] ?? appearance.icons.default ?? null;
}
