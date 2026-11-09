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

export function mountLibraryCardActions(root, {onOpen, onAdd, onDrop}) {
  const entry = event => {
    const button = event.target.closest('[data-definition]');
    return button && root.contains(button) ? button : null;
  };
  const click = event => { const button = entry(event); if (button) onOpen(button.dataset.definition); };
  const doubleClick = event => { const button = entry(event); if (button) onAdd(button.dataset.definition); };
  let drag;
  let indicator;
  const clearIndicator = () => {
    indicator?.removeAttribute('data-library-drop');
    indicator = undefined;
  };
  const finishDrag = () => {
    drag = undefined;
    clearIndicator();
  };
  const dragStart = event => {
    const button = entry(event);
    if (!onDrop || !button?.draggable) return;
    drag = {id:button.dataset.definition, duplicate:event.altKey};
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData('text/plain', drag.id);
  };
  const beforeTarget = (event, button) => {
    const bounds = button.getBoundingClientRect();
    return event.clientX < bounds.left + bounds.width / 2;
  };
  const dragOver = event => {
    if (!drag) return;
    clearIndicator();
    const button = entry(event);
    if (!button) return;
    const duplicate = drag.duplicate || event.altKey;
    if (!duplicate && button.dataset.definition === drag.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = duplicate ? 'copy' : 'move';
    indicator = button;
    button.dataset.libraryDrop = beforeTarget(event, button) ? 'before' : 'after';
  };
  const drop = event => {
    const button = entry(event);
    if (!drag || !button) return;
    event.preventDefault();
    const data = {...drag, duplicate:drag.duplicate || event.altKey,
      targetId:button.dataset.definition, before:beforeTarget(event, button)};
    finishDrag();
    onDrop(data);
  };
  const dragLeave = event => {
    if (!indicator?.contains(event.relatedTarget)) clearIndicator();
  };
  const listeners = {click, dblclick:doubleClick, dragstart:dragStart,
    dragover:dragOver, dragleave:dragLeave, drop, dragend:finishDrag};
  for (const [type, listener] of Object.entries(listeners)) root.addEventListener(type, listener);
  return () => {
    finishDrag();
    for (const [type, listener] of Object.entries(listeners)) root.removeEventListener(type, listener);
  };
}
