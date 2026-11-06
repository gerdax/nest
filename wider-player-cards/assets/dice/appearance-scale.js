/** Keep legacy trays at their readable pixel size; game trays opt into a
 * reference viewport so their physical dice follow the whole composition. */
export function diceAppearanceScale(width,height,settings={}) {
  const referenceWidth=settings.referenceWidth??width;
  const referenceHeight=settings.referenceHeight??height;
  const referenceScale=Math.min(12,(4400/1.5)/Math.max(1,referenceHeight),12*Math.max(.4,referenceWidth/Math.max(1,referenceHeight)));
  return referenceScale*referenceHeight/Math.max(1,settings.referenceViewportHeight??height)*(settings.sizeMultiplier??1);
}
