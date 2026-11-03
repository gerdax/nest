import {validateProjectFilename} from './project-file-storage.js';

let dialogSerial = 0;
const modalStack = [];
const errorMessage = error => error?.message || String(error);

function modal(doc, title, marker) {
  const previousFocus = doc.activeElement;
  const element = (tag, text) => {
    const node = doc.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const overlay = element('div');
  overlay.className = 'project-settings-overlay';
  overlay.setAttribute(marker, '');
  overlay.addEventListener('keydown', event => event.stopPropagation());
  const dialog = element('section');
  dialog.className = 'project-settings-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.tabIndex = -1;
  dialog.style.padding = '20px';
  dialog.style.gap = '14px';
  dialog.style.overflow = 'auto';
  const heading = element('h2', title);
  heading.id = `project-file-dialog-title-${++dialogSerial}`;
  dialog.setAttribute('aria-labelledby', heading.id);
  dialog.append(heading);
  overlay.append(dialog);
  const blocked = [...doc.body.children].map(node => [node, node.inert]);
  for (const [node] of blocked) node.inert = true;
  const hadOpenClass = doc.body.classList.contains('project-settings-open');
  doc.body.classList.add('project-settings-open');
  doc.body.append(overlay);
  modalStack.push(overlay);
  let busy = false, closed = false, cancel = () => {};
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const controls = () => [...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
    .filter(node => !node.disabled && !node.hidden && node.tabIndex >= 0 && !node.closest('[hidden],[inert]'));
  const focusFirst = () => (controls()[0] || dialog).focus({preventScroll:true});
  const keydown = event => {
    if (modalStack[modalStack.length - 1] !== overlay || overlay.inert) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation();
      if (!busy) cancel();
    } else if (event.key === 'Tab') {
      event.stopPropagation();
      const nodes = controls(), index = nodes.indexOf(doc.activeElement);
      if (!nodes.length) {event.preventDefault(); dialog.focus();}
      else if (event.shiftKey ? index <= 0 : index < 0 || index === nodes.length - 1) {
        event.preventDefault(); nodes[event.shiftKey ? nodes.length - 1 : 0].focus();
      }
    }
  };
  const focusin = event => {if (modalStack[modalStack.length - 1] === overlay && !overlay.inert && !overlay.contains(event.target)) dialog.focus({preventScroll:true});};
  const capture = {capture:true};
  doc.addEventListener('keydown', keydown, capture);
  doc.addEventListener('focusin', focusin);
  dialog.focus({preventScroll:true});
  return {
    element, dialog, promise, focusFirst,
    setCancel(callback) {cancel = callback;},
    get busy() {return busy;},
    get closed() {return closed;},
    setBusy(value) {busy = value; dialog.setAttribute('aria-busy', String(value));},
    close(value) {
      if (closed) return;
      closed = true;
      modalStack.splice(modalStack.indexOf(overlay), 1);
      doc.removeEventListener('keydown', keydown, capture);
      doc.removeEventListener('focusin', focusin);
      overlay.remove();
      for (const [node, inert] of blocked) node.inert = inert;
      if (!hadOpenClass) doc.body.classList.remove('project-settings-open');
      if (previousFocus?.isConnected) previousFocus.focus({preventScroll:true});
      resolve(value);
    }
  };
}

/** Select a local server project; callbacks own all project state and overwrite decisions. */
export function showProjectFileDialog({mode, backend, currentFilename = 'nest-project.json', suggestedName,
  onSubmit, onImport, document = globalThis.document}) {
  if (!['save-as', 'open'].includes(mode)) throw Error('Unknown project file dialog mode.');
  const saveAs = mode === 'save-as';
  const ui = modal(document, saveAs ? 'Save project as' : 'Open project', 'data-project-file-dialog');
  const {element, dialog} = ui;
  const form = element('form');
  form.style.display = 'grid'; form.style.gap = '12px';
  const label = element('label', saveAs ? 'File name' : 'Project file');
  const field = element(saveAs ? 'input' : 'select');
  field.setAttribute('aria-label', saveAs ? 'File name' : 'Project file');
  if (saveAs) {
    field.type = 'text'; field.required = true; field.autocomplete = 'off';
    field.value = suggestedName || `${currentFilename.replace(/\.json$/i, '')}-copy.json`;
  }
  label.append(field); form.append(label);
  form.append(element('p', saveAs ? 'All project files are saved in saved-projects. Include .json in the file name.' :
    'Open a project from saved-projects, or choose a JSON file. Files matching a saved project open directly; other files are imported as a named copy.'));
  const error = element('p'); error.setAttribute('role', 'alert'); error.hidden = true;
  form.append(error);
  const submit = element('button', saveAs ? 'Save as' : 'Open project'); submit.type = 'submit';
  const cancel = element('button', 'Cancel'); cancel.type = 'button';
  const retry = element('button', 'Retry list'); retry.type = 'button'; retry.hidden = true;
  const importer = !saveAs && onImport ? element('input') : null;
  if (importer) {
    importer.type = 'file'; importer.accept = '.json,application/json';
    importer.setAttribute('aria-label', 'Choose JSON file…');
    const importLabel = element('label', 'Choose JSON file…'); importLabel.append(importer); form.append(importLabel);
  }
  form.append(retry, submit, cancel); dialog.append(form);
  let listReady = saveAs;
  const update = () => {
    for (const node of [field, submit, cancel, retry, importer].filter(Boolean)) node.disabled = ui.busy;
    if (!saveAs) {field.disabled ||= !listReady; submit.disabled ||= !listReady || !field.value;}
  };
  const showError = message => {error.textContent = message; error.hidden = !message;};
  const run = async callback => {
    if (ui.busy) return;
    ui.setBusy(true); update(); showError('');
    try {
      const result = await callback();
      if (result?.ok) {ui.close(true); return;}
      showError(result?.error || (result?.cancelled ? 'Operation cancelled. You can choose another file or try again.' : 'Could not complete this operation.'));
    } catch (failure) {showError(errorMessage(failure));}
    finally {
      ui.setBusy(false); update();
      if (!ui.closed && !dialog.contains(document.activeElement)) ui.focusFirst();
    }
  };
  const load = async () => {
    if (ui.busy) return;
    ui.setBusy(true); listReady = false; retry.hidden = true; showError(''); update();
    try {
      const result = await backend.list();
      if (result?.available !== true || !Array.isArray(result.files)) throw Error('Project file listing is unavailable.');
      field.replaceChildren();
      for (const file of result.files) {
        const option = element('option', `${file.name}${file.name === currentFilename ? ' (current)' : ''}`);
        option.value = file.name; field.append(option);
      }
      field.value = result.files.some(file => file.name === currentFilename) ? currentFilename : result.files[0]?.name || '';
      listReady = true;
      if (!result.files.length) showError('No saved projects yet. Import a JSON file to begin.');
    } catch (failure) {showError(errorMessage(failure)); retry.hidden = false;}
    finally {ui.setBusy(false); update(); ui.focusFirst();}
  };
  form.addEventListener('submit', event => {
    event.preventDefault(); event.stopPropagation();
    if (ui.busy || submit.disabled) return;
    try {validateProjectFilename(field.value);} catch (failure) {showError(errorMessage(failure)); field.focus(); return;}
    void run(() => onSubmit(field.value));
  });
  field.addEventListener('change', update);
  cancel.addEventListener('click', () => {if (!ui.busy) ui.close(false);});
  ui.setCancel(() => ui.close(false));
  retry.addEventListener('click', () => {void load();});
  importer?.addEventListener('change', () => {
    const file = importer.files?.[0];
    if (file && !ui.busy) void run(() => onImport(file)).finally(() => {importer.value = '';});
  });
  update();
  if (saveAs) {ui.focusFirst(); field.select?.();} else void load();
  return ui.promise;
}

export function askUnsavedProjectChoice({document = globalThis.document} = {}) {
  const ui = modal(document, 'Unsaved changes', 'data-unsaved-project-dialog');
  ui.dialog.append(ui.element('p', 'Save your changes before switching projects?'));
  for (const [label, value] of [['Save changes', 'save'], ['Discard changes', 'discard'], ['Cancel', 'cancel']]) {
    const button = ui.element('button', label); button.type = 'button';
    button.addEventListener('click', () => ui.close(value)); ui.dialog.append(button);
  }
  ui.setCancel(() => ui.close('cancel')); ui.focusFirst();
  return ui.promise;
}
