/** Chapter IDs scope node IDs; a running preview can outlive editor navigation. */
export function previewActiveNode(preview, chapter, state = preview.state) {
  return preview.chapterId === chapter?.id ? state?.activeNodeId ?? null : null;
}

export function updatePreviewHighlight(graph, preview, chapter, state = preview.state) {
  const active = graph.chapter?.id === chapter?.id ? previewActiveNode(preview, chapter, state) : null;
  graph.setActive(active);
}
