import {parseProject} from '../project/model.js';
import {sha256} from './sha256.js';

export function validateProjectFilename(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,119}\.json$/.test(name) ||
      name.includes('..') || /\.backup\.|\.migration\.|pre-migration|before-file-autosave/i.test(name)) {
    throw Error('Use a project filename ending in .json with letters, numbers, spaces, underscores, dots or hyphens.');
  }
  return name;
}
const message = error => error?.message || String(error);

async function revision(text) {
  if (text === null) return null;
  if (typeof text !== 'string') throw Error('The expected saved project is unreadable.');
  return sha256(text);
}

// File storage never consults or writes browser storage. Once selected, API
// failures remain visible so a failed disk save cannot look like a browser save.
export function createProjectFileBackend({fetch = globalThis.fetch, endpoint = '/api/project', filename = 'nest-project.json'} = {}) {
  validateProjectFilename(filename);
  const path = `saved-projects/${filename}`;
  const url = filename === 'nest-project.json' ? endpoint : `${endpoint}${endpoint.includes('?') ? '&' : '?'}file=${encodeURIComponent(filename)}`;
  const listUrl = endpoint.split('?')[0].replace(/\/project$/, '/projects');
  async function get({probe = false} = {}) {
    const response = await fetch(url, {cache:'no-store'});
    if (probe && [404,405].includes(response.status)) return {available:false};
    if (!response.ok) throw Error(`Could not read project file (HTTP ${response.status}).`);
    const data = await response.json();
    if (data?.available !== true || !(data.text === null || typeof data.text === 'string') ||
        !(data.revision === null || /^[a-f0-9]{64}$/.test(data.revision)) || data.path !== path ||
        data.revision !== await revision(data.text)) throw Error('Invalid project file response.');
    return data;
  }
  return Object.freeze({
    get filename() {return filename;},
    get path() {return path;},
    get savedMessage() {return `Saved to ${path}.`;},
    forFile:name => createProjectFileBackend({fetch,endpoint,filename:name}),
    async list() {
      const response = await fetch(listUrl,{cache:'no-store'});
      if ([404,405].includes(response.status)) return {available:false};
      if (!response.ok) throw Error(`Could not list project files (HTTP ${response.status}).`);
      const data = await response.json();
      if (data?.available !== true || !Array.isArray(data.files)) throw Error('Invalid project file list.');
      const names = new Set();
      for (const file of data.files) {
        validateProjectFilename(file?.name);
        if (file.path !== `saved-projects/${file.name}` || names.has(file.name)) throw Error('Invalid project file list.');
        names.add(file.name);
      }
      return data;
    },
    probe:() => get({probe:true}),
    async read() { return (await get()).text; },
    async save(project, {expectedPrimary = null, migrationSourceText} = {}) {
      try {
        const text = JSON.stringify(parseProject(JSON.stringify(project), {allowDraft:true}), null, 2) + '\n';
        const body = {text, expectedRevision:await revision(expectedPrimary)};
        // The server always preserves an existing competing file. This option
        // keeps the shared persistence interface explicit without weakening it.
        if (migrationSourceText !== undefined) {
          if (typeof migrationSourceText !== 'string') throw Error('Invalid migration source.');
          body.migrationSourceText = migrationSourceText;
        }
        const response = await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
        const data = await response.json();
        if (response.status === 409) {
          if (data?.conflict !== true || !(data.text === null || typeof data.text === 'string') ||
              data.path !== path || data.revision !== await revision(data.text)) throw Error('Invalid project conflict response.');
          return {ok:false,conflict:true,primary:data.text};
        }
        if (!response.ok) throw Error(data?.error || `Could not save project file (HTTP ${response.status}).`);
        if (data?.ok !== true || data.text !== text || data.path !== path || data.revision !== await revision(text)) {
          throw Error('The project file save could not be verified.');
        }
        const stored = await get();
        if (stored.text !== text) return {ok:false,conflict:true,primary:stored.text};
        return {ok:true,primary:text,...(data.backupPath ? {backupPath:data.backupPath} : {})};
      } catch (error) { return {ok:false,error:message(error)}; }
    }
  });
}
