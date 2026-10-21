// Typing controls keep their native editing keys. Buttons, checkboxes, card
// summaries and panel headers must not steal the editor's assigned shortcuts.
export const typingControls = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]):not([type="color"]):not([type="file"]),textarea,select,' +
  '[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="spinbutton"],[role="combobox"]';

/** Reserved keys never fall through to native activation or focus traversal. */
export function mountViewShortcuts(root, {switchView, togglePreview, toggleAutoplay = () => false, enabled = () => true}) {
  // Window capture runs before focused controls and dialog focus traps.
  const host=root.defaultView ?? root;
  const keydown = event => {
    if (!['Tab', ' ', '/'].includes(event.key) || event.defaultPrevented || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey || event.target?.closest?.(typingControls)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.shiftKey || !enabled()) return;
    const action = event.key === 'Tab' ? switchView : event.key === ' ' ? togglePreview : toggleAutoplay;
    action();
  };
  host.addEventListener('keydown', keydown, {capture:true});
  return () => host.removeEventListener('keydown', keydown, {capture:true});
}
