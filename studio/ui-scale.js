/** Root editor zoom converts viewport coordinates to unzoomed layout pixels. */
export function uiScale(element) {
 const doc=element?.ownerDocument,win=doc?.defaultView;
 const zoom=doc?.documentElement&&win?.getComputedStyle?Number(win.getComputedStyle(doc.documentElement).zoom):1;
 return Number.isFinite(zoom)&&zoom>0?zoom:1;
}
