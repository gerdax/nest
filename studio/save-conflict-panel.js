/** A conflict never replaces the working document. Both versions stay exportable. */
export function mountSaveConflictPanel(anchor, {onExportDraft, onExportSaved, onReload, onKeepDraft}) {
  const panel = anchor.ownerDocument.createElement('section');
  panel.className = 'save-conflict-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'alert');
  panel.innerHTML = '<strong>Another editor changed the saved project.</strong><span>Your current draft is still open. Export it before reloading, or keep it and preserve the competing save as a backup.</span><div><button type="button" data-conflict="draft">Export this draft</button><button type="button" data-conflict="saved">Download saved version</button><button type="button" data-conflict="reload">Reload saved version</button><button type="button" data-conflict="keep">Keep this draft</button></div>';
  anchor.after(panel);
  let conflict = null, busy = false;
  const buttons = [...panel.querySelectorAll('button')];
  const refresh = () => {
    panel.hidden = !conflict;
    for (const button of buttons) button.disabled = busy || (button.dataset.conflict === 'saved' && conflict?.primary === null);
  };
  const handlers = {draft:onExportDraft, saved:onExportSaved, reload:onReload, keep:onKeepDraft};
  panel.addEventListener('click', async event => {
    const button = event.target.closest('[data-conflict]');
    if (!button || button.disabled || !conflict) return;
    const observed = conflict;
    busy = true;
    refresh();
    try {await handlers[button.dataset.conflict](observed);}
    finally {busy = false; refresh();}
  });
  return {update(value) {conflict = value; refresh();}};
}
