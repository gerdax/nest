import { CardDeck, DEFAULT_SETTINGS } from './engine/CardDeck.js';

const art = '../pre_prototype/img/';
const studies = [
  { title: 'The corridor', text: 'A passage in low light.', image: 'corridor_02.png' },
  { title: 'The surface', text: 'A fragment of the outside.', image: 'city.png' },
  { title: 'The chamber', text: 'A quiet space, held open.', image: 'hall_01.png' },
];
const actions = [
  { id: 'observe', label: 'Observe', image: 'goggles_01.png' },
  { id: 'explore', label: 'Explore', image: 'flashlight.png' },
  { id: 'collect', label: 'Collect', image: 'pack.png' },
  { id: 'leave', label: 'Leave the chamber and return to the passage', image: 'escape.png' },
];
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
];
const mount = document.querySelector('#deck');
const hint = document.querySelector('#hint');
const status = document.querySelector('#status');
const fixture = document.querySelector('#fixture');
const controlRoot = document.querySelector('#settings-controls');
let settings = { ...DEFAULT_SETTINGS };
let actionCount = Number(fixture.value);
let studyIndex = 0;

function content() {
  const study = studies[studyIndex % studies.length];
  return {
    id: `study-${studyIndex}-${actionCount}`,
    ...study,
    image: art + study.image,
    actions: actions.slice(0, actionCount).map(action => ({ ...action, image: art + action.image })),
  };
}

const deck = new CardDeck(mount, { content: content(), settings });

function ready(message = 'Ready.') {
  hint.textContent = 'Lift the top card up to uncover actions. Drag down to return it.';
  status.textContent = message;
}

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
  output.textContent = settings[key] + unit;
  const input = document.createElement('input');
  Object.assign(input, { type: 'range', id: name.htmlFor, min, max, step, value: settings[key] });
  input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    output.textContent = settings[key] + unit;
    deck.updateSettings({ [key]: settings[key] });
  });
  labelRow.append(name, output);
  row.append(labelRow, input);
  controlRoot.append(row);
}

deck.addEventListener('reveal', () => {
  hint.textContent = 'Taking the cover off, then expanding the choices.';
  status.textContent = 'Uncovering choices…';
});
deck.addEventListener('selection', event => {
  const selected = event.detail?.action;
  const label = selected?.label ?? actions[event.detail?.index]?.label;
  if (label) status.textContent = `${label} selected.`;
});
deck.addEventListener('close', () => {
  hint.textContent = 'Compressing the choices, then returning the cover.';
  status.textContent = 'Returning cover…';
});
deck.addEventListener('commit', event => {
  status.textContent = `${event.detail.action.label} committed.`;
  hint.textContent = 'Lifting the choices away, then turning the next card over.';
  studyIndex += 1;
  actionCount = actionCount === 4 ? 2 : actionCount + 1;
  fixture.value = String(actionCount);
  document.querySelector('#fixture-count').textContent = `0${actionCount} actions`;
  deck.replaceContent(content());
});
deck.addEventListener('transitioncomplete', event => {
  if (event.detail.transition === 'commit') ready('Next study ready.');
  if (event.detail.transition === 'close') ready('Cover returned.');
  if (event.detail.transition === 'reveal') {
    hint.textContent = 'Browse either way, endlessly. Lift up to take the action stack.';
    status.textContent = 'Choices ready.';
  }
});

fixture.addEventListener('change', () => {
  actionCount = Number(fixture.value);
  studyIndex = 0;
  deck.reset();
  deck.replaceContent(content());
  document.querySelector('#fixture-count').textContent = `0${actionCount} actions`;
  ready(`${actionCount}-action fixture loaded.`);
});
document.querySelector('#reset').addEventListener('click', () => {
  studyIndex = 0;
  deck.reset();
  deck.replaceContent(content());
  ready('Deck reset.');
});
document.querySelector('#defaults').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS };
  deck.updateSettings(settings);
  for (const [key, , , , , unit] of specs) {
    document.querySelector(`#setting-${key}`).value = settings[key];
    document.querySelector(`#value-${key}`).textContent = settings[key] + unit;
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
  if (!event.persisted) deck.destroy();
});
