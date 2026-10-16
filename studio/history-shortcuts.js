/** Project history shortcuts leave native field editing and modal dialogs alone. */
export function mountHistoryShortcuts(root, { undo, redo }) {
  const keydown = event => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.altKey) return;
    if (!(event.metaKey || event.ctrlKey) || event.key?.toLowerCase() !== 'z') return;
    if (event.target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],dialog,[role="dialog"]')) return;
    event.preventDefault();
    (event.shiftKey ? redo : undo)();
  };
  root.addEventListener('keydown', keydown);
  return () => root.removeEventListener('keydown', keydown);
}
