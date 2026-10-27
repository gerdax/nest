import { ensureCombatDefaults } from './combat-model.js';
import { createDefinition } from './cards.js';
import { cloneProject, unique, walk } from './model-data.js';

export function migrateChapter(v1) {
  const source = cloneProject(v1), id = source.id || 'chapter-1';
  const library = [], used = new Set();
  const project = {version: 2, kind: 'nest-project', id: `${id}-project`, name: source.name, activeChapterId: id, startChapterId: id,
    library, variables: source.variables || [], chapters: []};
  const bind = (raw, kind, seq) => {
    const definitionId = unique(`${seq.id}-${kind}-${raw.id}`, used);
    const d = {...createDefinition(kind, definitionId), name: raw.label || raw.title || raw.id, heading: '', text: raw.text || '', image: raw.image || ''};
    if (raw.flipImage !== undefined) d.flipImage = raw.flipImage;
    if (kind === 'item') {
      d.inventoryKey = `${id}:${raw.id}`;
      d.onCollect = cloneProject(raw.effects || []);
    } else {
      d.effects = cloneProject(raw.effects || []);
      if (kind === 'action') d.conditions = cloneProject(raw.conditions || []);
    }
    library.push(d);
    delete raw.effects;
    delete raw.conditions;
    raw.definitionId = definitionId;
    return {id: raw.id, definitionId};
  };
  const sequences = new Map();
  for (const seq of source.sequences || []) {
    for (const c of seq.cards || []) {
      bind(c, 'event', seq);
      for (const a of c.choices || []) bind(a, 'action', seq);
    }
    for (const i of seq.items || []) bind(i, 'item', seq);
    sequences.set(seq.id, seq);
  }
  const chapter = {id, name: source.name, startNode: source.startNode, nodes: [], ...(source.cardBack !== undefined ? {cardBack: source.cardBack}: {})};
  for (const old of source.nodes || []) {
    const node = {id: old.id, name: old.name, x: old.x, y: old.y, connections: cloneProject(old.connections)};
    const seq = sequences.get(old.sequenceId);
    if (old.type === 'random') Object.assign(node, {type: 'legacyPool', sequences: [...new Set((old.pool
      || []).map(p => p.sequenceId))].map(id => sequences.get(id)).filter(Boolean), pool: cloneProject(old.pool),
      count: old.count});
    else if (seq?.type === 'linear') Object.assign(node, {type: 'linear', cards: seq.cards.map(c => ({id: c.id,
      definitionId: c.definitionId})), connections: {next: old.connections[seq.exits[0]] ?? null}});
    else if (seq?.type === 'container') Object.assign(node, {type: 'container', connections: {next: old.connections[seq.exits[0]] ?? null},
      intro: seq.cards[0] && {id: seq.cards[0].id, definitionId: seq.cards[0].definitionId}, items: (seq.items
      || []).map(i => ({id: i.id, definitionId: i.definitionId}))});
    else if (seq?.decisionOnly) {
      const choices = seq.cards.flatMap(c => c.choices || []);
      Object.assign(node, {type: 'fork', choices: choices.map(c => ({id: c.id, definitionId: c.definitionId,
        ...(c.unavailable ? {unavailable: c.unavailable}: {})})), connections: Object.fromEntries(choices.map(c => [c.id,
        old.connections[c.target?.replace(/^exit:/, '')] ?? null]))});
    }
    else Object.assign(node, {type: 'legacySequence', sequence: seq});
    chapter.nodes.push(node);
  }
  const variableMap = new Map(project.variables.map(v => [v.id, `${id}_${v.id}`]));
  project.variables = project.variables.map(v => ({...v, id: variableMap.get(v.id)}));
  for (const target of [library, chapter]) walk(target, v => {
    if (v.source !== 'inventory' && !['addItem', 'removeItem'].includes(v.op) && v.key && variableMap.has(v.key)) v.key = variableMap.get(v.key);
    if (v.modifierVariable && variableMap.has(v.modifierVariable)) v.modifierVariable = variableMap.get(v.modifierVariable);
  });
  const aliases = new Map(library.filter(d => d.kind === 'item').map(d => [d.inventoryKey.slice(id.length+1), d.inventoryKey]));
  for (const target of [library, chapter]) walk(target, v => {
    if (v.source === 'inventory' && aliases.has(v.key)) v.key = aliases.get(v.key);
  });
  project.chapters.push(chapter);
  return ensureCombatDefaults(project);
}
