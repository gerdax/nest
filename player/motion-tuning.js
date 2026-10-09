import { DEFAULT_SETTINGS } from '../engine/CardDeck.js';

export const motionControls = [
  ['stiffness', 'Spring stiffness', 60, 600, 5, ''],
  ['damping', 'Spring damping', 5, 80, 1, ''],
  ['mass', 'Spring mass', 0.25, 3, 0.05, ''],
  ['maxTilt', 'Maximum tilt', 0, 18, 0.5, '°'],
  ['axisThreshold', 'Axis lock distance', 2, 40, 1, ' px'],
  ['distanceThreshold', 'Commit distance', 0.1, 0.6, 0.01, ' × card dimension'],
  ['flickVelocity', 'Flick velocity', 200, 1600, 25, ' px/s'],
  ['flickDistance', 'Minimum flick distance', 8, 100, 1, ' px'],
  ['commitDuration', 'Commit duration', 100, 1000, 10, ' ms'],
  ['perspective', 'Perspective distance', 650, 2000, 25, ' px'],
  ['stackDepth', 'Card depth separation', 4, 30, 1, ' px'],
  ['liftHeight', 'Lift off deck', 0, 60, 2, ' px'],
  ['grabLift', 'Vertical grab camera lift', 0, 24, 1, ' px'],
  ['angularStiffness', 'Rotational stiffness', 60, 400, 5, ''],
  ['angularDamping', 'Rotational damping', 5, 80, 1, ''],
  ['gravity', 'Throw gravity', 0, 3000, 50, ' px/s²'],
  ['revealStartScale', 'Underlying start scale', .88, 1, .005, ' ×'],
  ['revealFullScaleAt', 'Full size at exposure', .1, .65, 'any', ' × card height'],
  ['choiceStaggerMs', 'Choice stagger', 0, 60, 1, ' ms'],
  ['flipLeadMs', 'Flip lead', 0, 100, 1, ' ms'],
  ['flipAxisTilt', 'Flip axis tilt', -10, 10, 0.5, '°'],
];

export function mountMotionTuning(root, preview) {
  let settings = { ...DEFAULT_SETTINGS, ...preview.deckSettings };
  const controls = root.querySelector('[data-motion-controls]');
  const status = root.querySelector('[data-motion-status]');
  const fallback = root.querySelector('[data-copy-fallback]');
  const jsonField = root.querySelector('[data-settings-json]');
  const fields = new Map();
  const format = (value, unit) => Number(value.toFixed(3)) + unit;
  const apply = () => {
    // Tune both the live deck and decks created by restart or import.
    preview.deckSettings = { ...settings };
    preview.deck?.updateSettings(settings);
    if (!fallback.hidden) jsonField.value = JSON.stringify(settings, null, 2);
  };
  for (const [key, label, min, max, step, unit] of motionControls) {
    const row = document.createElement('div');
    row.className = 'motion-setting';
    const heading = document.createElement('div');
    heading.className = 'motion-setting-label';
    const name = document.createElement('label');
    name.htmlFor = `motion-${key}`;
    name.textContent = label;
    const output = document.createElement('output');
    output.htmlFor = name.htmlFor;
    output.textContent = format(settings[key], unit);
    const input = document.createElement('input');
    Object.assign(input, { type: 'range', id: name.htmlFor, min, max, step, value: settings[key] });
    input.addEventListener('input', () => {
      settings[key] = Number(input.value);
      output.textContent = format(settings[key], unit);
      apply();
      status.textContent = 'Motion settings updated.';
    });
    heading.append(name, output);
    row.append(heading, input);
    controls.append(row);
    fields.set(key, { input, output, unit });
  }
  root.querySelector('[data-motion-defaults]').addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    apply();
    for (const [key, { input, output, unit }] of fields) {
      input.value = settings[key];
      output.textContent = format(settings[key], unit);
    }
    status.textContent = 'Motion defaults restored.';
  });
  root.querySelector('[data-copy-settings]').addEventListener('click', async () => {
    const json = JSON.stringify(settings, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      fallback.hidden = true;
      status.textContent = 'Settings copied.';
    } catch {
      fallback.hidden = false;
      jsonField.value = json;
      jsonField.focus();
      jsonField.select();
      status.textContent = 'Select and copy the settings below.';
    }
  });
  apply();
}
