# Nest Light dice

Pale green faces (`#d2dfb6`, matching the default Big/Medium text palette) with
black markings. The d6 uses traditional circular pips; other dice retain their
numeric markings. This external Dice Box theme uses the bundled default mesh
(the loader’s default when `meshFile` is omitted), preserving geometry, face
values, collider mappings and UVs for every supported die.

`numbers.svg` contains vector horizontal spans following all four alpha levels
of the bundled numeric atlas outside the six separate d6 UV cells. Those six
cells instead contain one through six pips. The original atlas and every vendor
file remain unchanged. The SVG embeds neither raster data nor external
resources and does not depend on an installed font. Numeric silhouettes are
derived from Frank Ali’s Dice Box assets under the bundled
[MIT license](../../vendor/dice-box/LICENSE).

The shared default normal map is omitted so old d6 numerals do not remain
embossed beneath the pips. The standard material fixes body and marking colors
across rolls; the general Dice Box `themeColor` option does not recolor it.
