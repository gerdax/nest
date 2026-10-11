export const defaultCardStyles = Object.freeze({ small: 10, big: 21, medium: 15 });
const properties = { small: '--card-small-size', big: '--card-font-size', medium: '--card-medium-size' };

/** Apply project typography without moving artwork, text blocks or cards. */
export function applyCardStyles(element, styles = {}) {
  for (const [key, property] of Object.entries(properties)) {
    const value = `${styles[key] ?? defaultCardStyles[key]}px`;
    if (element.style.setProperty) element.style.setProperty(property, value);
    else element.style[property] = value;
  }
}
