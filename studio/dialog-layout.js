/** Center native dialogs in the visible part of their game frame. */
export function dialogLayout(bounds, width, height) {
  if (!bounds || !(width > 0 && height > 0)) return null;
  const left = Math.max(0, Math.min(width, bounds.left));
  const top = Math.max(0, Math.min(height, bounds.top));
  const right = Math.max(left, Math.min(width, bounds.left + bounds.width));
  const bottom = Math.max(top, Math.min(height, bounds.top + bounds.height));
  return {
    position: 'fixed', boxSizing: 'border-box', inset: `${top}px ${width - right}px ${height - bottom}px ${left}px`,
    margin: 'auto', width: `${Math.max(0, Math.min(360, right - left - 32))}px`,
    maxWidth: `${Math.max(0, right - left - 32)}px`,
    maxHeight: `${Math.max(0, bottom - top - 32)}px`,
  };
}
