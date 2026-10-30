import {layoutBounds} from './cssScale.js';

/** Scale card copy as one composition, without changing the gesture plane. */
export function syncCardContentScale(mount) {
  const view=mount.ownerDocument?.defaultView;
  const reference=Number(view?.getComputedStyle?.(mount)?.getPropertyValue?.('--card-reference-width'));
  if(!Number.isFinite(reference)||reference<=0)return;
  const width=layoutBounds(mount).width;
  if(!Number.isFinite(width)||width<=0)return;
  mount.style.setProperty('--card-content-scale',String(width/reference));
}
