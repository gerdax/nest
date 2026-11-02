# Nest Black dice

Enemy rolls use this folder's `numbers.png` atlas directly. `theme.config.json`
sets it as `material.diffuseTexture`, and `dice/frame.js` selects the `nest-black`
theme when combat requests black dice. The current supplied PNG is preserved;
there is no generated recoloring step at load or staging time.

The theme retains Dice Box's numeric silhouettes/UV layout and MIT provenance.
Texture edits must preserve the face-value mapping.
