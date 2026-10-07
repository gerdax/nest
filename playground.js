import { CardDeck, DEFAULT_SETTINGS } from './engine/CardDeck.js?v=container-items-1';

import { ScenarioController, createStudyContent } from './demo/ScenarioController.js?v=container-items-1';
import { InventoryStrip } from './demo/InventoryStrip.js?v=container-items-1';

const specs = [
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
  ['angularStiffness', 'Rotational stiffness', 60, 400, 5, ''],
  ['angularDamping', 'Rotational damping', 5, 80, 1, ''],
  ['gravity', 'Throw gravity', 0, 3000, 50, ' px/s²'],
  ['revealStartScale', 'Underlying start scale', .88, 1, .005, ' ×'],
  ['revealFullScaleAt', 'Full size at exposure', .1, .65, 'any', ' × card height'],
  ['choiceStaggerMs', 'Choice stagger', 0, 60, 1, ' ms'],
  ['flipLeadMs', 'Flip lead', 0, 100, 1, ' ms'],
  ['flipAxisTilt', 'Flip axis tilt', -10, 10, 0.5, '°'],
];
const mount = document.querySelector('#deck');
const hint = document.querySelector('#hint');
const status = document.querySelector('#status');
const fixture = document.querySelector('#fixture');
const requestedFixture = new URLSearchParams(location.search).get('fixture');
if (['2', '3', '4', 'chest'].includes(requestedFixture)) fixture.value = requestedFixture;
const controlRoot = document.querySelector('#settings-controls');
let settings = { ...DEFAULT_SETTINGS };
const deck = new CardDeck(mount, { content: createStudyContent(0, 2), settings });
let controller;
const inventory = new InventoryStrip(document.querySelector('#inventory'));

function ready(message = 'Ready.') {
  hint.textContent = 'Lift the top card up to uncover actions.';
  status.textContent = message;
}

function browse(mode) {
  hint.textContent = mode === 'container'
    ? 'Browse items left / right. Swipe up to discard; swipe down to take.'
    : 'Browse either way, endlessly. Lift up to take the selected action.';
  status.textContent = mode === 'container' ? 'Items ready.' : 'Choices ready.';
}

function updateScenario({ reason, detail, mode, fixture: selectedFixture, content, collectedItems = [] }) {
  inventory.update(collectedItems);
  fixture.value = selectedFixture;
  document.querySelector('#fixture-count').textContent = mode === 'container'
    ? `${String(content.actions.length).padStart(2, '0')} items`
    : `${String(content.actions.length).padStart(2, '0')} actions`;
  if (reason === 'reset') {
    ready(selectedFixture === 'chest' ? 'Chest fixture loaded.' : `${selectedFixture}-action fixture loaded.`);
    if (mode === 'container') hint.textContent = 'Swipe the container description up to reveal its items.';
  }
  if (reason === 'open') {
    status.textContent = 'Opening chest…';
    hint.textContent = 'Lifting the container description to uncover its items.';
  }
  if (reason === 'collect' || reason === 'discard') {
    status.textContent = reason === 'collect' ? `${detail.action.label} taken.` : `${detail.action.label} discarded.`;
    hint.textContent = content.actions.length
      ? 'Browse the remaining items. Up discards; down takes.'
      : 'Revealing the next card and turning it over.';
  }
  if (reason === 'advance') {
    if (detail.action) {
      status.textContent = `${detail.action.label} committed.`;
      hint.textContent = 'Lifting the choices away, then turning the next card over.';
    } else ready('Next event ready.');
  }
  if (reason === 'transitioncomplete') {
    if (detail.transition === 'commit') {
      if (mode === 'container') browse(mode);
      else ready('Next study ready.');
    }
    if (detail.transition === 'close') {
      browse(mode);
      if (mode === 'entry') status.textContent = `${content.actions[deck.state.index].label} selected.`;
    }
    if (detail.transition === 'reveal' || (['collect', 'discard'].includes(detail.transition) && content.actions.length)) browse(mode);
  }
}
controller = new ScenarioController(deck, { fixture: fixture.value, onChange: updateScenario });

for (const [key, label, min, max, step, unit] of specs) {
  const row = document.createElement('div');
  row.className = 'setting';
  const labelRow = document.createElement('div');
  labelRow.className = 'setting-label';
  const name = document.createElement('label');
  name.htmlFor = `setting-${key}`;
  name.textContent = label;
  const output = document.createElement('output');
  output.htmlFor = name.htmlFor;
  output.id = `value-${key}`;
  output.textContent = Number(settings[key].toFixed(3)) + unit;
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', id: name.htmlFor, min, max, step, value: settings[key] });
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    output.textContent = Number(settings[key].toFixed(3)) + unit;
    deck.updateSettings({ [key]: settings[key] });
  });
  labelRow.append(name, output);
  row.append(labelRow, input);
  controlRoot.append(row);
}

deck.addEventListener('reveal', () => {
  const items = controller.mode === 'container';
  hint.textContent = items ? 'Taking the cover off, then expanding the items.' : 'Taking the cover off, then expanding the choices.';
  status.textContent = items ? 'Uncovering items…' : 'Uncovering choices…';
});
for (const type of ['collect', 'discard']) {
  deck.addEventListener(type, ({ detail }) => {
    status.textContent = type === 'collect' ? `Taking ${detail.action.label}…` : `Discarding ${detail.action.label}…`;
    hint.textContent = detail.final ? 'The last item reveals the next card back.'
      : type === 'collect' ? 'Moving this card down toward your inventory.' : 'Discarding this card upward.';
  });
}
deck.addEventListener('selection', event => {
  const selected = event.detail?.action;
  if (selected?.disabled || selected?.faceDown) {
    browse(controller.mode);
  } else if (selected?.label) {
    status.textContent = `${selected.label} selected.`;
  }
});
deck.addEventListener('close', () => {
  hint.textContent = controller.mode === 'container'
    ? 'Closing the items and returning directly to the choices.'
    : 'Compressing the cards, then returning the cover.';
  status.textContent = controller.mode === 'container' ? 'Closing chest…' : 'Returning cover…';
});
fixture.addEventListener('change', () => controller.reset(fixture.value));
document.querySelector('#reset').addEventListener('click', () => {
  controller.reset();
  ready('Deck reset.');
});
document.querySelector('#defaults').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  deck.updateSettings(settings);
  for (const [key, , , , , unit] of specs) {
    document.querySelector(`#setting-${key}`).value = settings[key];
    document.querySelector(`#value-${key}`).textContent = Number(settings[key].toFixed(3)) + unit;
  }
  status.textContent = 'Motion defaults restored.';
});
document.querySelector('#copy-settings').addEventListener('click', async () => {
  const json = JSON.stringify(settings, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    document.querySelector('#copy-fallback').hidden = true;
    status.textContent = 'Settings copied.';
  } catch {
    const fallback = document.querySelector('#copy-fallback');
    const textarea = document.querySelector('#settings-json');
    fallback.hidden = false;
    textarea.value = json;
    textarea.focus();
    textarea.select();
    status.textContent = 'Settings ready to copy below.';
  }
});

window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    controller.destroy();
    deck.destroy();
  }
});
