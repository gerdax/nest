# Nest Forest dice

Nearblack forest green faces with pale green numeric markings. This external
Dice Box theme uses the bundled default mesh (the loader's default when
`meshFile` is omitted), preserving its face values and UV layout for every
supported numeric die. Its normal map is referenced from the untouched vendor
assets.

`numbers.svg` contains vector horizontal spans following all four alpha levels
of the bundled default numeric atlas. The original atlas and every vendor file
remain unchanged. The SVG embeds neither raster data nor external resources,
and does not depend on an installed font. Numeric silhouettes are derived from
Frank Ali's Dice Box assets under the bundled [MIT license](../../vendor/dice-box/LICENSE).

The standard material fixes both body and marking colors across all rolls;
the general Dice Box `themeColor` option does not recolor this theme.
