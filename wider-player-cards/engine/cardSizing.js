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

/** Opt-in playfields scale spatial deck geometry from authored design values.
 * Unconfigured demos keep their original settings and motion. */
export function cardLayoutSettings(mount,base) {
  const value=Number(mount.ownerDocument?.defaultView?.getComputedStyle?.(mount)?.getPropertyValue?.('--card-layout-scale'));
  if(!Number.isFinite(value)||value<=0)return {...base};
  const scale=Number.isFinite(value)&&value>0?value:1;
  const settings={...base,layoutScale:scale};
  for(const key of ['perspective','stackDepth','liftHeight','grabLift'])settings[key]=base[key]*scale;
  return settings;
}
