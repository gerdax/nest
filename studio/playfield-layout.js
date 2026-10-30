// The reset viewport is the design canvas. Fit it uniformly, then distribute
// only the space introduced by a different screen aspect ratio.
export const PLAYFIELD_REFERENCE = Object.freeze({width:359,height:745});

export function playfieldLayout(width,height) {
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)return null;
  const scale=Math.min(width/PLAYFIELD_REFERENCE.width,height/PLAYFIELD_REFERENCE.height);
  return {scale,lift:Math.max(0,height-PLAYFIELD_REFERENCE.height*scale)/2};
}
