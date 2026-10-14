const supportedImage = /\.(?:png|jpe?g|webp|gif|svg)$/i;

/** Exact filename matches; paths are relative to assets/img, never local disk paths. */
export function matchImageFilename(filename, catalog) {
  if (typeof filename !== 'string' || !supportedImage.test(filename)) return [];
  return (Array.isArray(catalog?.images) ? catalog.images : []).flatMap(image => {
    if (typeof image?.path !== 'string') return [];
    const segments = image.path.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) return [];
    if (segments.at(-1) !== filename || image.filename !== filename) return [];
    return [{ path: image.path, value: `./assets/img/${segments.map(encodeURIComponent).join('/')}` }];
  }).filter((image, index, matches) => matches.findIndex(other => other.path === image.path) === index);
}

/** Bind delegated picker buttons. Returns a cleanup function for the editor lifecycle. */
export function bindImagePicker(root, { onSelect, onError = () => {} }) {
  const doc = root.ownerDocument;
  const activeInputs = new Set();
  const pending = new WeakMap();
  let disposed = false;
  let catalogPromise;
  function catalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(new URL('./assets/image-manifest.json', doc.baseURI), { cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error('Could not load the project image catalog.');
          return response.json();
        }).then(value => {
          if (value?.version !== 1 || !Array.isArray(value.images)) throw new Error('The project image catalog is invalid.');
          return value;
        }).catch(error => { catalogPromise = undefined; throw error; });
    }
    return catalogPromise;
  }
  function feedback(button, message) {
    const previous = button.nextElementSibling;
    if (previous?.hasAttribute('data-image-picker-feedback')) previous.remove();
    const status = doc.createElement('span');
    status.dataset.imagePickerFeedback = '';
    status.setAttribute('role', 'status');
    status.textContent = message;
    button.after(status);
    return status;
  }
  function fail(button, message) {
    feedback(button, message);
    onError(message);
  }
  function click(event) {
    const button = event.target.closest?.('[data-image-picker]');
    if (!button || !root.contains(button) || button.disabled) return;
    event.preventDefault();
    const scope = button.dataset.scope;
    const path = button.dataset.path;
    const placementId = button.closest('[data-placement]')?.dataset.placement;
    const token = {};
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.webp,.gif,.svg';
    input.hidden = true;
    doc.body.append(input);
    activeInputs.add(input);
    const cleanup = () => { activeInputs.delete(input); input.remove(); };
    input.addEventListener('cancel', cleanup, { once: true });
    input.addEventListener('change', async () => {
      const filename = input.files?.[0]?.name;
      cleanup();
      if (!filename) return;
      pending.set(button, token);
      try {
        const matches = matchImageFilename(filename, await catalog());
        if (disposed || !root.contains(button) || pending.get(button) !== token) return;
        const select = match => {
          if (disposed || !root.contains(button) || pending.get(button) !== token) return;
          onSelect(scope, placementId, path, match.value);
          if (root.contains(button)) feedback(button, `Selected assets/img/${match.path}`);
        };
        if (matches.length === 1) select(matches[0]);
        else if (!matches.length) fail(button, `No supported project image named “${filename}” was found in assets/img. The existing path is unchanged.`);
        else {
          const status = feedback(button, `Several project images are named “${filename}”. Choose a path: `);
          for (const match of matches) {
            const choice = doc.createElement('button');
            choice.type = 'button';
            choice.textContent = `assets/img/${match.path}`;
            choice.addEventListener('click', () => select(match), { once: true });
            status.append(choice);
          }
        }
      } catch (error) {
        if (!disposed && root.contains(button) && pending.get(button) === token) fail(button, error.message || 'Could not select the project image.');
      }
    }, { once: true });
    input.click();
  }
  root.addEventListener('click', click);
  return () => {
    disposed = true;
    root.removeEventListener('click', click);
    for (const input of activeInputs) input.remove();
    activeInputs.clear();
  };
}
