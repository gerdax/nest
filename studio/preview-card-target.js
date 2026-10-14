/** Resolve the visible card to its authored placement, without predicting playback. */
export function previewCardTarget({ project, chapterId, controller, deck } = {}) {
  if (!controller || !deck || controller.destroyed || deck.destroyed) return null;
  const state = controller.state;
  if (!state?.idle || state.completed || state.checking || deck.busy || deck.state?.busy || deck.drag
    || controller.pendingIntro || controller.pendingItem || controller.stagedDestination
    || !['closed', 'choices'].includes(deck.phase)) return null;
  const location = controller.location;
  const chapter = project?.chapters?.find(chapter => chapter.id === chapterId);
  const node = chapter?.nodes?.find(node => node.id === location?.node?.id);
  if (!node || state.activeNodeId !== node.id) return null;
  let sequence;
  if (['legacySequence', 'legacyPool'].includes(node.type)) {
    sequence = node.type === 'legacySequence' ? node.sequence
      : node.sequences?.find(sequence => sequence.id === location.sequence?.id);
    if (!sequence || sequence.id !== location.sequence?.id) return null;
  } else if (location.sequence) return null;
  const type = sequence?.type ?? node.type;
  const card = sequence?.cards?.[location.index] ?? node.cards?.[location.index];
  let placement, slot, parentCardId;
  if (type === 'linear') { placement = card; slot = 'cards'; }
  else if (['fork', 'forked', 'container'].includes(type)) {
    if (deck.phase === 'closed' && !deck.open) {
      placement = sequence ? (type === 'container' ? sequence.cards?.[0] : card) : node.intro;
      slot = 'cards';
    } else if (deck.phase === 'choices' && deck.open) {
      const action = deck.content?.actions?.[deck.index];
      const candidates = type === 'container' ? sequence?.items ?? node.items
        : sequence ? card?.choices : node.choices;
      placement = candidates?.find(placement => placement.id === action?.id);
      slot = type === 'container' ? 'items' : 'choices';
      if (sequence && slot === 'choices') parentCardId = card?.id;
    }
  }
  if (!placement?.id || !placement.definitionId
    || !project.library?.some(definition => definition.id === placement.definitionId)) return null;
  return { chapterId, nodeId: node.id, placementId: placement.id, definitionId: placement.definitionId,
    ...(sequence ? { sequenceId: sequence.id, slot, ...(slot === 'choices' ? { parentCardId } : {}) } : {}) };
}
