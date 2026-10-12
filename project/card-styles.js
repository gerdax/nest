export const defaultCardStyles = Object.freeze({ small: 10, big: 21, medium: 15 });
export const defaultCardColors = Object.freeze({ small: '#a9bb86', big: '#d2dfb6', medium: '#d2dfb6' });
const properties = { small: '--card-small-size', big: '--card-font-size', medium: '--card-medium-size' };
const colorProperties = { small: '--card-title-color', big: '--card-text', medium: '--card-medium-color' };

export function isCardColor(value) {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

export function parseCardColor(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid card text color.');
  const color = `#${value.trim().replace(/^#/, '')}`;
  if (!isCardColor(color)) throw new TypeError('Invalid card text color.');
  const hex = color.slice(1);
  return `#${(hex.length === 3 ? [...hex].map(char => char + char).join('') : hex).toUpperCase()}`;
}

/** Apply project typography without moving artwork, text blocks or cards. */
export function applyCardStyles(element, styles = {}) {
  for (const [key, property] of Object.entries(properties)) {
    const value = `${styles[key] ?? defaultCardStyles[key]}px`;
    if (element.style.setProperty) element.style.setProperty(property, value);
    else element.style[property] = value;
  }
  for (const [key, property] of Object.entries(colorProperties)) {
    const value = styles[`${key}Color`] ?? defaultCardColors[key];
    if (element.style.setProperty) element.style.setProperty(property, value);
    else element.style[property] = value;
  }
}
