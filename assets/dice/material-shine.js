// Keep this function self-contained: the offscreen worker embeds the same source.
export function applyMaterialShine(material, options) {
  if (Number.isFinite(options.specularIntensity) && options.specularIntensity >= 0) {
    const intensity = options.specularIntensity;
    material.specularColor.set(intensity, intensity, intensity);
  }
  if (Number.isFinite(options.specularPower) && options.specularPower >= 0) {
    material.specularPower = options.specularPower;
  }
}
