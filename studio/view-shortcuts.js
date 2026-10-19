// Preserve native focus navigation, activation and editing inside controls.
const controls = 'input,textarea,select,button,a[href],summary,label,audio,video,iframe,' +
  '[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],' +
  '[role="checkbox"],[role="radio"],[role="switch"],[role="slider"],[role="spinbutton"],' +
  '[role="combobox"],[role="listbox"],[role="menu"],[role="tablist"],[role="tree"],' +
  '[role="grid"],dialog,[role="dialog"]';

// Library buttons and toggles keep the view-switching Tab shortcut. Text editing
// and compound widgets still own their keyboard navigation; Space stays native.
const libraryTabControls = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]),textarea,select,audio,video,iframe,' +
  '[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="slider"],[role="spinbutton"],' +
  '[role="combobox"],[role="listbox"],[role="menu"],[role="tablist"],[role="tree"],' +
  '[role="grid"],dialog,[role="dialog"]';

/** Contextual editor shortcuts; return false from an action to leave the key alone. */
export function mountViewShortcuts(root, {switchView, togglePreview, enabled = () => true,
  libraryActive = target => !!target?.closest?.('#library-panel')}) {
  const keydown = event => {
    if (!['Tab', ' '].includes(event.key) || event.defaultPrevented || event.repeat || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !enabled()) return;
    const libraryTab = event.key === 'Tab' && libraryActive(event.target);
    if (event.target?.closest?.(libraryTab ? libraryTabControls : controls) || root.getSelection?.()?.toString()) return;
    // Preview's Tab order belongs to playback controls, not the editor views.
    if (event.key === 'Tab' && event.target?.closest?.('#preview-window')) return;
    const action = event.key === 'Tab' ? switchView : togglePreview;
    if (action() !== false) event.preventDefault();
  };
  root.addEventListener('keydown', keydown);
  return () => root.removeEventListener('keydown', keydown);
}
