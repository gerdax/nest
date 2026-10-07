/** Chapter files contain only JSON data. Their IDs remain stable across editor changes. */
export function cloneChapter(chapter) {
  return JSON.parse(JSON.stringify(chapter));
}

export function selectPool(pool, count = 1, rng = Math.random) {
  const available = pool.map(entry => ({ ...entry }));
  const selected = [];
  const draws = Math.min(count, available.length);
  for (let n = 0; n < draws; n++) {
    const total = available.reduce((sum, entry) => sum + entry.weight, 0);
    const draw = rng();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new TypeError('Random source must return a number from 0 to less than 1');
    let ticket = draw * total;
    let index = available.length - 1;
    for (let i = 0; i < available.length; i++) {
      ticket -= available[i].weight;
      if (ticket < 0) { index = i; break; }
    }
    selected.push(available.splice(index, 1)[0].sequenceId);
  }
  return selected;
}

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
    if (!['linear', 'forked', 'container'].includes(seq.type)) add(`Sequence ${seq.id} has an unknown type.`);
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
    if (seq.type === 'forked') {
      if (seq.decisionOnly && (seq.exits?.length !== cards[0]?.choices?.length || seq.exits?.some(id => !cards[0]?.choices?.some(c => c.id === id)))) add(`Decision ${seq.id} needs one output per choice.`);
      if (seq.decisionOnly && cards.length !== 1) add(`Decision ${seq.id} needs exactly one choice set.`);
      for (const card of cards.filter(object)) {
        if (!Array.isArray(card.choices) || ![2, 3].includes(card.choices.length)) { add(`Forked card ${card.id} needs two or three choices.`); continue; }
        const choiceIds = new Set();
        for (const choice of card.choices) {
          if (!object(choice) || !string(choice.id) || !string(choice.label) || typeof choice.image !== 'string') { add(`Card ${card.id} has an invalid choice.`); continue; }
          if (choiceIds.has(choice.id)) add(`Card ${card.id} has duplicate choice ID ${choice.id}.`);
          choiceIds.add(choice.id);
          if (seq.decisionOnly && choice.target !== `exit:${choice.id}`) add(`Choice ${choice.id} must use its own output.`);
          const target = choice.target;
          if (typeof target !== 'string' || !(target.startsWith('card:') && cardIds.has(target.slice(5)) || target.startsWith('exit:') && exits.has(target.slice(5)))) add(`Choice ${choice.id} has an invalid target.`);
        }
      }
      if (hasCycle(cardIds, id => (Array.isArray(cards.find(card => card?.id === id)?.choices) ? cards.find(card => card?.id === id).choices : []).filter(choice => typeof choice?.target === 'string' && choice.target.startsWith('card:')).map(choice => choice.target.slice(5)))) add(`Sequence ${seq.id} has a card cycle.`);
    }
    if (seq.type === 'container') {
      if (cards.length !== 1) add(`Container ${seq.id} needs exactly one intro card.`);
      if (!Array.isArray(seq.items) || !seq.items.length) add(`Container ${seq.id} needs at least one item.`);
      const itemIds = new Set();
      for (const item of Array.isArray(seq.items) ? seq.items : []) {
        if (!object(item) || !string(item.id) || !string(item.label) || typeof item.image !== 'string') { add(`Container ${seq.id} has an invalid item.`); continue; }
        if (itemIds.has(item.id)) add(`Container ${seq.id} has duplicate item ID ${item.id}.`);
        itemIds.add(item.id);
      }
    }
    if (seq.type !== 'forked' && (seq.exits?.length !== 1)) add(`Sequence ${seq.id} needs exactly one exit.`);
  }
  if (!nodeMap.has(chapter.startNode)) add('Start node must reference an existing node.');
  for (const node of nodeMap.values()) {
    if (!string(node.name)) add('Node needs a name.', node.id);
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) add('Node position needs finite x and y values.', node.id);
    let assigned = [];
    if (node.type === 'static') {
      assigned = [node.sequenceId];
    } else if (node.type === 'random') {
      if (!Array.isArray(node.pool) || !node.pool.length) add('Random node needs a sequence pool.', node.id);
      const pool = Array.isArray(node.pool) ? node.pool : [];
      assigned = pool.map(entry => entry?.sequenceId);
      if (new Set(assigned).size !== assigned.length) add('Random pool must not repeat a sequence.', node.id);
      if (pool.some(entry => !object(entry) || !Number.isFinite(entry.weight) || entry.weight <= 0)) add('Pool weights must be positive finite numbers.', node.id);
      if (!Number.isInteger(node.count) || node.count < 1 || node.count > pool.length) add('Random count must be from 1 to the pool size.', node.id);
    } else add('Node has an unknown type.', node.id);
    if (!object(node.connections)) add('Node needs exit connections.', node.id);
    const connections = object(node.connections) ? node.connections : {};
    for (const id of assigned) {
      const seq = sequenceMap.get(id);
      if (!seq) { add(`Unknown sequence: ${id}.`, node.id); continue; }
      for (const exit of node.type === 'random' ? ['next'] : (Array.isArray(seq.exits) ? seq.exits : [])) {
        if (!Object.hasOwn(connections, exit)) add(`Missing connection for exit ${exit}.`, node.id);
      }
    }
    for (const [exit, target] of Object.entries(connections)) {
      if (target !== null && !nodeMap.has(target)) add(`Exit ${exit} points to an unknown node.`, node.id);
    }
  }
  if (hasCycle(new Set(nodeMap.keys()), id => Object.values(object(nodeMap.get(id).connections) ? nodeMap.get(id).connections : {}).filter(value => value !== null))) add('Chapter has a node cycle.');
  for (const error of errors) { if (!error.nodeId) { const seq = sequences.find(s => s?.id && error.message.includes(s.id)); if (seq) error.nodeId = nodes.find(n => n?.sequenceId === seq.id || n?.pool?.some(p => p.sequenceId === seq.id))?.id; } }
  return errors;
}

export function parseChapter(text, { allowDraft = false } = {}) {
  const chapter = JSON.parse(text);
  if (allowDraft) {
    if (!object(chapter) || chapter.version !== 1 || typeof chapter.name !== 'string' || typeof chapter.startNode !== 'string' || !Array.isArray(chapter.nodes) || !Array.isArray(chapter.sequences)) throw new TypeError('Invalid chapter draft structure.');
    for (const node of chapter.nodes) {
      if (!object(node) || !string(node.id) || typeof node.name !== 'string' || !['static', 'random'].includes(node.type) || !Number.isFinite(node.x) || !Number.isFinite(node.y) || !object(node.connections)) throw new TypeError('Invalid node draft structure.');
      if (Object.values(node.connections).some(target => target !== null && typeof target !== 'string')) throw new TypeError('Invalid connection draft structure.');
      if (node.type === 'static' && typeof node.sequenceId !== 'string') throw new TypeError('Invalid static node draft structure.');
      if (node.type === 'random' && (!Array.isArray(node.pool) || typeof node.count !== 'number' || node.pool.some(entry => !object(entry) || typeof entry.sequenceId !== 'string' || typeof entry.weight !== 'number'))) throw new TypeError('Invalid random node draft structure.');
    }
    for (const seq of chapter.sequences) {
      if (!object(seq) || !string(seq.id) || typeof seq.name !== 'string' || !['linear', 'forked', 'container'].includes(seq.type) || !Array.isArray(seq.cards) || !Array.isArray(seq.exits) || seq.exits.some(exit => typeof exit !== 'string')) throw new TypeError('Invalid sequence draft structure.');
      for (const card of seq.cards) {
        if (!object(card) || !string(card.id) || typeof card.title !== 'string' || typeof card.text !== 'string' || typeof card.image !== 'string') throw new TypeError('Invalid card draft structure.');
        if (card.choices !== undefined && (!Array.isArray(card.choices) || card.choices.some(choice => !object(choice) || typeof choice.id !== 'string' || typeof choice.label !== 'string' || typeof choice.image !== 'string' || typeof choice.target !== 'string'))) throw new TypeError('Invalid choice draft structure.');
      }
      if (seq.items !== undefined && (!Array.isArray(seq.items) || seq.items.some(item => !object(item) || typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.image !== 'string'))) throw new TypeError('Invalid item draft structure.');
    }
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
