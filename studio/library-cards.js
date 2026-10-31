import { canonicalCardKind } from '../project/cards.js';
import { cardDropSlot } from './card-drag.js';
import { uid } from './commands.js';

/** Library additions target the main collection or the Combat Enemy reference. */
export function libraryCardSlot(node, definition) {
  if (!node || !definition || definition.visibility === 'local') return null;
  if (node.type === 'combat') return definition.kind === 'enemy' ? 'enemy' : null;
  const slot = cardDropSlot(node.type, canonicalCardKind(definition.kind));
  return slot && Array.isArray(node[slot]) ? slot : null;
}

/** Compatibility also includes scalar Enemy references on Combat beats. */
export function libraryCardCompatible(node, definition) {
  return !!libraryCardSlot(node, definition);
}

export function appendLibraryCard(project, chapter, node, definitionId) {
  if (!project.chapters.includes(chapter) || !chapter.nodes.includes(node)) return null;
  const definition = project.library.find(card => card.id === definitionId);
  const slot = libraryCardSlot(node, definition);
  if (!slot) return null;
  if (slot === 'enemy') return node.enemy = {definitionId};
  const placement = {id:uid('placement'), definitionId};
  node[slot].push(placement);
  return placement;
}

export function mountLibraryCardActions(root, {onOpen, onAdd}) {
  const entry = event => {
    const button = event.target.closest('[data-definition]');
    return button && root.contains(button) ? button : null;
  };
  const click = event => { const button = entry(event); if (button) onOpen(button.dataset.definition); };
  const doubleClick = event => { const button = entry(event); if (button) onAdd(button.dataset.definition); };
  root.addEventListener('click', click);
  root.addEventListener('dblclick', doubleClick);
  return () => { root.removeEventListener('click', click); root.removeEventListener('dblclick', doubleClick); };
}
