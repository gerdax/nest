import { ensureCombatDefaults } from './combat-model.js';
import { createError } from '../errors.js';
import { createDefinition } from './cards.js';
import { defaultStats } from './checks.js';

// Shared document data operations; callers choose when to detach mutable data.
export const cloneProject = value => JSON.parse(JSON.stringify(value));
export const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const named = v => typeof v === 'string' && !!v.trim();
export const unique = (base, used) => {
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
};

export const list = value => Array.isArray(value) ? value : [];
export function placements(node) {
  return [...list(node.cards), ...list(node.choices), ...list(node.items), ...(object(node.intro) ? [node.intro] : [])];
}
export function legacyArtwork(node) {
  return (object(node.sequence) ? [node.sequence] : list(node.sequences)).filter(object).flatMap(s => [...list(s.cards),
    ...list(s.items), ...list(s.cards).filter(object).flatMap(c => list(c.choices))]).filter(object);
}

export function walk(value, fn) {
  if (Array.isArray(value)) value.forEach(v => walk(v, fn));
  else if (object(value)) {
    fn(value);
    Object.values(value).forEach(v => walk(v, fn));
  }
}

export function createChapter(id = 'chapter-1', name = 'First chapter') {
  return {id, name, startNode: '', variables: [], nodes: []};
}
/** Definitions visible to a chapter. The returned list is detached from both scopes. */
export function chapterVariables(project, chapter) {
  return [...list(project?.variables), ...list(chapter?.variables)];
}
export function createProject() {
  const event = {...createDefinition('event', 'arrival'), name: 'Arrival', heading: '', text: 'Your expedition begins at the edge of the city.',
    image: './assets/img/city.png'};
  const item = {...createDefinition('item', 'flashlight'), name: 'Flashlight', image: './assets/img/flashlight.png'};
  const action = {...createDefinition('action', 'explore'), name: 'Explore', text: 'Follow the corridor', image: './assets/img/corridor_02.png'};
  return ensureCombatDefaults({
    version: 3,
    kind: 'nest-project',
    id: 'project-1',
    name: 'First expedition',
    allowCycles: true,
    ownedItemsVisibility: 'disabled',
    unavailableActions: 'disabled',
    activeChapterId: 'chapter-1',
    startChapterId: 'chapter-1',
    library: [event, item, action],
    variables: [
      {id: 'energy', name: 'Energy', type: 'number', initial: 3, min: 0, max: 10},
      {id: 'health', name: 'Health', type: 'number', initial: 10, min: 0, max: 10},
      ...defaultStats()
    ],
    chapters: [{
      id: 'chapter-1',
      name: 'First expedition',
      nextChapterId: null,
      variables: [],
      startNode: 'arrival',
      nodes: [
        {id: 'arrival', name: 'Arrival', type: 'linear', x: 80, y: 100,
          cards: [{id: 'arrival-card', definitionId: 'arrival'}], connections: {next: 'supplies'}},
        {id: 'supplies', name: 'Supplies', type: 'container', x: 340, y: 100,
          intro: {id: 'supply-intro', definitionId: 'arrival'},
          items: [{id: 'supply-flashlight', definitionId: 'flashlight'}], connections: {next: 'route'}},
        {id: 'route', name: 'Choose a route', type: 'fork', x: 600, y: 100,
          choices: [{id: 'explore-choice', definitionId: 'explore'}], connections: {'explore-choice': 'encounter'}},
        {id: 'encounter', name: 'Random encounter', type: 'random', x: 860, y: 100,
          routes: [{id: 'quiet', target: 'quiet-passage', weight: 1, conditions: []}], fallback: 'quiet-passage'},
        {id: 'quiet-passage', name: 'Quiet passage', type: 'linear', x: 1120, y: 100,
          cards: [{id: 'quiet-card', definitionId: 'arrival'}], connections: {next: null}}
      ]
    }]
  });
}

export function definitionUsers(project, id) {
  return project.chapters.flatMap(chapter => chapter.nodes.flatMap(node =>
    [...placements(node), ...legacyArtwork(node)]
      .filter(p => p.definitionId === id)
      .map(placement => ({chapterId: chapter.id, nodeId: node.id, placementId: placement.id, chapter, node, placement}))));
}
export function createVariant(project, placement, newId, {chapterId, nodeId} = {}) {
  const next = cloneProject(project), d = next.library.find(d => d.id === placement.definitionId);
  if (!d) throw createError('PROJECT_UNKNOWN_DEFINITION');
  if (!named(newId) || next.library.some(d => d.id === newId)) throw createError('PROJECT_INVALID_OR_DUPLICATE_DEFINITION_ID');
  const matches = definitionUsers(project, placement.definitionId).filter(u => u.placement.id === placement.id
    && (!chapterId || u.chapterId === chapterId) && (!nodeId || u.nodeId === nodeId));
  const exact = matches.find(u => u.placement === placement), target = exact || (matches.length === 1 ? matches[0] : null);
  if (!target) throw createError('PROJECT_PLACEMENT_MUST_IDENTIFY_ONE_LOCATION');
  next.library.push({...cloneProject(d), id: newId, name: `${d.name} variant`});
  const node = next.chapters.find(c => c.id === target.chapterId).nodes.find(n => n.id === target.nodeId);
  const bound = [...placements(node), ...legacyArtwork(node)].find(p => p.id === placement.id && p.definitionId === placement.definitionId);
  bound.definitionId = newId;
  return next;
}
