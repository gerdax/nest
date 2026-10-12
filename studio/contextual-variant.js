/** Comparison belongs to playback UI; project JSON and authoring order are unchanged. */
export function mountContextualVariant(root, preview) {
  if (!root) return;
  const select = root.querySelector('select');
  let mode = 'shuffle';
  try {
    const saved = localStorage.getItem('nest.contextual-variant');
    if (['current', 'shuffle'].includes(saved)) mode = saved;
  } catch { /* Comparison remains available without storage. */ }
  select.value = mode;
  preview.contextualPresentation = mode;
  select.addEventListener('change', () => {
    preview.contextualPresentation = select.value;
    try { localStorage.setItem('nest.contextual-variant', select.value); } catch {}
    if (preview.project) preview.restart();
  });
}
