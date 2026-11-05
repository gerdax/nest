import { previewCardTarget } from './preview-card-target.js';

/** Chapter IDs scope node IDs; a running preview can outlive editor navigation. */
export function previewActiveNode(preview, chapter, state = preview.state) {
  return preview.chapterId === chapter?.id ? state?.activeNodeId ?? null : null;
}

export function updatePreviewHighlight(graph, preview, chapter, state = preview.state) {
  const active = graph.chapter?.id === chapter?.id ? previewActiveNode(preview, chapter, state) : null;
  const callerId = active && !state.completed ? preview.controller?.location?.randomizerRun?.scene?.callerId : null;
  graph.setActive(active, callerId === active ? null : callerId ?? null);
  graph.setActiveCard(active ? previewCardTarget(preview) : null);
}
