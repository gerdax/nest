import { validateStateConfig } from './state.js';
import { nodeTypes, nodeType, nodeOutputs } from './nodeTypes.js';
import { sequenceTypes, sequenceType } from './sequenceTypes.js';
/** Chapter files contain only JSON data. Their IDs remain stable across editor changes. */
export function cloneChapter(chapter) {
  return JSON.parse(JSON.stringify(chapter));
}

export { selectPool } from './random.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const string = value => typeof value === 'string' && value.trim().length > 0;
function hasCycle(ids, neighbors) {
  const active = new Set(), visited = new Set();
  function visit(id) {
    if (active.has(id)) return true;
    if (visited.has(id)) return false;
    active.add(id);
    for (const next of neighbors(id)) if (ids.has(next) && visit(next)) return true;
    active.delete(id); visited.add(id);
    return false;
  }
  return [...ids].some(visit);
}

export function validateChapter(chapter) {
  const errors = [];
  const add = (message, nodeId) => errors.push(nodeId ? { nodeId, message } : { message });
  if (!object(chapter)) return [{ message: 'Chapter must be an object.' }];
  if (chapter.version !== 1) add('Chapter version must be 1.');
  if (!string(chapter.name)) add('Chapter needs a name.');
  if (chapter.backImage !== undefined && typeof chapter.backImage !== 'string') add('Card back image must be a string.');
  if (!Array.isArray(chapter.nodes) || !chapter.nodes.length) add('Chapter needs at least one node.');
  if (!Array.isArray(chapter.sequences) || !chapter.sequences.length) add('Chapter needs at least one sequence.');
  const nodes = Array.isArray(chapter.nodes) ? chapter.nodes : [];
  const sequences = Array.isArray(chapter.sequences) ? chapter.sequences : [];
  const nodeMap = new Map(), sequenceMap = new Map();
  for (const node of nodes) {
    if (!object(node) || !string(node.id)) { add('Each node needs an ID.'); continue; }
    if (nodeMap.has(node.id)) add(`Duplicate node ID: ${node.id}.`, node.id);
    nodeMap.set(node.id, node);
  }
  for (const seq of sequences) {
    if (!object(seq) || !string(seq.id)) { add('Each sequence needs an ID.'); continue; }
    if (sequenceMap.has(seq.id)) add(`Duplicate sequence ID: ${seq.id}.`);
    sequenceMap.set(seq.id, seq);
    if (!string(seq.name)) add(`Sequence ${seq.id} needs a name.`);
    if (!Object.hasOwn(sequenceTypes, seq.type)) add(`Sequence ${seq.id} has an unknown type.`);
    if (!Array.isArray(seq.exits) || !seq.exits.length || seq.exits.some(exit => !string(exit)) || new Set(seq.exits).size !== seq.exits.length) add(`Sequence ${seq.id} needs unique named exits.`);
    const exits = new Set(Array.isArray(seq.exits) ? seq.exits : []);
    if (!Array.isArray(seq.cards) || !seq.cards.length) add(`Sequence ${seq.id} needs at least one card.`);
    const cards = Array.isArray(seq.cards) ? seq.cards : [];
    const cardIds = new Set();
    for (const card of cards) {
      if (!object(card) || !string(card.id)) { add(`Sequence ${seq.id} has a card without an ID.`); continue; }
      if (cardIds.has(card.id)) add(`Sequence ${seq.id} has duplicate card ID ${card.id}.`);
      cardIds.add(card.id);
      if (typeof card.title !== 'string' || typeof card.text !== 'string' || typeof card.image !== 'string') add(`Card ${card.id} needs title, text and image fields.`);
    }
    for (const artwork of [...cards, ...(Array.isArray(seq.items) ? seq.items : []), ...cards.flatMap(card => Array.isArray(card?.choices) ? card.choices : [])]) {
      if (artwork?.flipImage !== undefined && typeof artwork.flipImage !== 'boolean') add(`Artwork ${artwork.id}: flipImage must be a boolean.`);
    }
    sequenceType(seq)?.validate(seq, { cards, cardIds, exits, add, hasCycle });
    if (seq.type !== 'forked' && (seq.exits?.length !== 1)) add(`Sequence ${seq.id} needs exactly one exit.`);
  }
  if (!nodeMap.has(chapter.startNode)) add('Start node must reference an existing node.');
  for (const node of nodeMap.values()) {
    if (!string(node.name)) add('Node needs a name.', node.id);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) add('Node position needs finite x and y values.', node.id);
    const definition = nodeType(node);
    const assigned = definition?.sequenceIds(node) || [];
    if (!definition) add('Node has an unknown type.', node.id);
    else definition.validate(node, message => add(message, node.id));
    if (!object(node.connections)) add('Node needs exit connections.', node.id);
    const connections = object(node.connections) ? node.connections : {};
    for (const id of assigned) {
      const seq = sequenceMap.get(id);
      if (!seq) { add(`Unknown sequence: ${id}.`, node.id); continue; }
      for (const exit of nodeOutputs(node, seq)) {
        if (!Object.hasOwn(connections, exit)) add(`Missing connection for exit ${exit}.`, node.id);
      }
    }
    for (const [exit, target] of Object.entries(connections)) {
      if (target !== null && !nodeMap.has(target)) add(`Exit ${exit} points to an unknown node.`, node.id);
    }
  }
  if (hasCycle(new Set(nodeMap.keys()), id => Object.values(object(nodeMap.get(id).connections) ? nodeMap.get(id).connections : {}).filter(value => value !== null))) add('Chapter has a node cycle.');
  errors.push(...validateStateConfig(chapter).map(message => ({message})));
  for (const error of errors) { if (!error.nodeId) { const seq = sequences.find(s => s?.id && error.message.includes(s.id)); if (seq) error.nodeId = nodes.find(n => n?.sequenceId === seq.id || n?.pool?.some(p => p.sequenceId === seq.id))?.id; } }
  return errors;
}

export function parseChapter(text, { allowDraft = false } = {}) {
  const chapter = JSON.parse(text);
  if (allowDraft) {
    if (!object(chapter) || chapter.version !== 1 || typeof chapter.name !== 'string' || typeof chapter.startNode !== 'string' || !Array.isArray(chapter.nodes) || !Array.isArray(chapter.sequences)) throw new TypeError('Invalid chapter draft structure.');
    if (chapter.backImage !== undefined && typeof chapter.backImage !== 'string') throw new TypeError('Card back image must be a string.');
    for (const node of chapter.nodes) {
      if (!object(node) || !string(node.id) || typeof node.name !== 'string' || !Object.hasOwn(nodeTypes, node.type) || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !object(node.connections)) throw new TypeError('Invalid node draft structure.');
      if (Object.values(node.connections).some(target => target !== null && typeof target !== 'string')) throw new TypeError('Invalid connection draft structure.');
      if (node.type === 'static' && typeof node.sequenceId !== 'string') throw new TypeError('Invalid static node draft structure.');
      if (node.type === 'random' && (!Array.isArray(node.pool) || typeof node.count !== 'number' || node.pool.some(entry => !object(entry) || typeof entry.sequenceId !== 'string' || typeof entry.weight !== 'number'))) throw new TypeError('Invalid random node draft structure.');
    }
    for (const seq of chapter.sequences) {
      if (!object(seq) || !string(seq.id) || typeof seq.name !== 'string' || !Object.hasOwn(sequenceTypes, seq.type) || !Array.isArray(seq.cards) || !Array.isArray(seq.exits) || seq.exits.some(exit => typeof exit !== 'string')) throw new TypeError('Invalid sequence draft structure.');
      for (const card of seq.cards) {
        if (!object(card) || !string(card.id) || typeof card.title !== 'string' || typeof card.text !== 'string' || typeof card.image !== 'string') throw new TypeError('Invalid card draft structure.');
        if (card.choices !== undefined && (!Array.isArray(card.choices) || card.choices.some(choice => !object(choice) || typeof choice.id !== 'string' || typeof choice.label !== 'string' || typeof choice.image !== 'string' || typeof choice.target !== 'string'))) throw new TypeError('Invalid choice draft structure.');
      }
      if (seq.items !== undefined && (!Array.isArray(seq.items) || seq.items.some(item => !object(item) || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.image !== 'string'))) throw new TypeError('Invalid item draft structure.');
    }
    for (const seq of chapter.sequences) for (const artwork of [...seq.cards, ...(seq.items || []), ...seq.cards.flatMap(card => card.choices || [])]) {
      if (artwork.flipImage !== undefined && typeof artwork.flipImage !== 'boolean') throw new TypeError('Artwork flipImage must be a boolean.');
    }
    const stateErrors = validateStateConfig(chapter, { references: false });
    if (stateErrors.length) throw new TypeError(stateErrors.join('\n'));
    return chapter;
  }
  const errors = validateChapter(chapter);
  if (errors.length) throw new TypeError(errors.map(error => error.message).join('\n'));
  return chapter;
}

export function createLegacyStarterChapter() {
  const card = (id, title, text, image) => ({ id, title, text, image: `./assets/img/${image}.png` });
  return {
    version: 1, name: 'First expedition', startNode: 'arrival',
    nodes: [
      { id: 'arrival', name: 'Arrival', type: 'static', x: 80, y: 100, sequenceId: 'arrival-sequence', connections: { next: 'supplies' } },
      { id: 'supplies', name: 'Supplies', type: 'static', x: 360, y: 100, sequenceId: 'supply-sequence', connections: { next: 'encounter' } },
      { id: 'encounter', name: 'Random encounter', type: 'random', x: 640, y: 100, pool: [{ sequenceId: 'fork-sequence', weight: 2 }, { sequenceId: 'quiet-sequence', weight: 1 }], count: 1, connections: { next: null, escape: null } }
    ],
    sequences: [
      { id: 'arrival-sequence', name: 'Arrival', type: 'linear', cards: [card('city', 'The silent city', 'Your expedition begins at the edge of the city.', 'city'), card('hall', 'Inside the hall', 'A supply box waits beside the stairs.', 'hall_01')], exits: ['next'] },
      { id: 'supply-sequence', name: 'Supply box', type: 'container', cards: [card('box', 'A supply box', 'Decide which equipment to keep from the supply box.', 'box')], items: [{ id: 'flashlight', label: 'Flashlight', image: './assets/img/flashlight.png' }, { id: 'goggles', label: 'Protective goggles', image: './assets/img/goggles_01.png' }], exits: ['next'] },
      { id: 'fork-sequence', name: 'The crossing', type: 'forked', cards: [{ ...card('crossing', 'A dark crossing', 'Choose where to go next.', 'corridor_02'), choices: [{ id: 'explore', label: 'Explore the corridor', image: './assets/img/corridor_02.png', target: 'card:exit' }, { id: 'leave', label: 'Leave the building', image: './assets/img/escape.png', target: 'exit:escape' }] }, { ...card('exit', 'Daylight ahead', 'The corridor opens onto the street.', 'escape'), choices: [{ id: 'street', label: 'Step outside', image: './assets/img/city.png', target: 'exit:next' }, { id: 'escape', label: 'Take the side exit', image: './assets/img/escape.png', target: 'exit:escape' }] }], exits: ['next', 'escape'] },
      { id: 'quiet-sequence', name: 'A quiet passage', type: 'linear', cards: [card('passage', 'A quiet passage', 'You find a clear route out of the building.', 'corridor_02')], exits: ['next'] }
    ]
  };
}

/** Upgrade static legacy forks into separate decision nodes without losing routes.
 * Legacy forks in random pools keep their v1 runner behavior for compatibility.
 */
export function upgradeDecisionNodes(chapter) {
  const result = cloneChapter(chapter);
  const unique = (base, values) => { let id = base, n = 2; while (values.has(id)) id = `${base}-${n++}`; values.add(id); return id; };
  const nodeIds = new Set(result.nodes.map(n => n.id)), sequenceIds = new Set(result.sequences.map(s => s.id));
  const originals = [...result.nodes];
  for (const node of originals) {
    const seq = result.sequences.find(s => s.id === node.sequenceId);
    if (node.type !== 'static' || seq?.type !== 'forked' || seq.decisionOnly || !seq.cards.length) continue;
    const routes = { ...node.connections };
    const mapping = new Map(seq.cards.map((card, i) => [card.id, i === 0 ? node.id : unique(`${node.id}-${card.id}`, nodeIds)]));
    seq.cards.forEach((card, i) => {
      const id = unique(`${seq.id}-${card.id}-decision`, sequenceIds);
      const choices = (card.choices || []).map(choice => ({ ...choice, target: `exit:${choice.id}` }));
      const decision = { id, name: card.title || seq.name, type: 'forked', decisionOnly: true,
        cards: [{ ...card, title: '', text: '', choices }], exits: choices.map(c => c.id) };
      result.sequences.push(decision);
      const connections = Object.fromEntries((card.choices || []).map(c => [c.id, c.target?.startsWith('card:') ? mapping.get(c.target.slice(5)) ?? null : routes[c.target?.slice(5)] ?? null]));
      const target = i === 0 ? node : { ...node, id: mapping.get(card.id), name: card.title || `${node.name} ${i+1}`, x: node.x + i*260, y: node.y+220 };
      target.sequenceId = id; target.connections = connections;
      if (i) result.nodes.push(target);
    });
  }
  result.sequences = result.sequences.filter(s => s.type !== 'forked' || s.decisionOnly || result.nodes.some(n => n.sequenceId === s.id || n.pool?.some(p => p.sequenceId === s.id)));
  return result;
}

export function createStarterChapter() {
  const chapter = createLegacyStarterChapter();
  chapter.nodes[1].connections.next = 'crossing';
  chapter.nodes.push({ id: 'crossing', name: 'Choose a route', type: 'static', x: 640, y: 100,
    sequenceId: 'route-decision', connections: { explore: 'encounter', leave: null } });
  chapter.nodes[2].x = 920;
  chapter.nodes[2].pool = [{ sequenceId: 'quiet-sequence', weight: 1 }, { sequenceId: 'arrival-sequence', weight: 1 }];
  chapter.nodes[2].connections = { next: null };
  chapter.sequences = chapter.sequences.filter(s => s.id !== 'fork-sequence');
  chapter.sequences.push({ id: 'route-decision', name: 'Choose a route', type: 'forked', decisionOnly: true,
    cards: [{ id: 'route', title: '', text: '', image: '', choices: [
      { id: 'explore', label: 'Explore the corridor', image: './assets/img/corridor_02.png', target: 'exit:explore' },
      { id: 'leave', label: 'Leave the building', image: './assets/img/escape.png', target: 'exit:leave' }
    ] }], exits: ['explore', 'leave'] });
  return chapter;
}
