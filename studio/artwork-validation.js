import {enumerateDefinitionReferences} from '../project/dependencies.js';

function localArtwork(value, base, prefix) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let url;
  try {url = new URL(value, base);}
  catch {return null;}
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) return null;
  try {return decodeURIComponent(url.pathname.slice(prefix.length));}
  catch {return url.pathname.slice(prefix.length);}
}

export function artworkIssues(document, catalog, baseURL) {
  const base = new URL(baseURL);
  const prefix = new URL('./assets/img/', base).pathname;
  const available = new Set([...catalog.images.map(image => image.path), ...(catalog.aliases ?? [])]);
  const chapters = document.chapters ?? [document.chapter].filter(Boolean);
  const users = new Map();
  for (const chapter of chapters) for (const {definitionId} of enumerateDefinitionReferences(chapter)) {
    if (!users.has(definitionId)) users.set(definitionId, new Set());
    users.get(definitionId).add(chapter.name || chapter.id);
  }
  const issues = new Set();
  const inspect = (value, label) => {
    const path = localArtwork(value, base, prefix);
    if (path !== null && !available.has(path)) issues.add(`${label} is missing artwork at assets/img/${path}.`);
  };
  const walk = (value, title, chapter) => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, title, chapter);
    } else if (value && typeof value === 'object') {
      const name = value.name || value.headline || value.title || value.id;
      const label = name ? `${String(name)}${chapter ? ` (${chapter})` : ''}` : title;
      inspect(value.image, label);
      for (const [key, child] of Object.entries(value)) if (key !== 'use') walk(child, label, chapter);
    }
  };
  for (const card of document.library ?? []) {
    const usedBy = [...(users.get(card.id) ?? [])].join(', ');
    const chapter = chapters.find(chapter => chapter.id === card.chapterId);
    walk(card, 'Library', usedBy || chapter?.name || 'Library');
  }
  for (const chapter of chapters) walk(chapter, 'Chapter', chapter.name || chapter.id);
  walk(document.combat, 'Combat settings');
  inspect(document.cardBack?.background, 'Card back');
  inspect(document.cardBack?.icons?.default, 'Card back icon');
  return [...issues];
}

export function createArtworkValidation({baseURL, fetch = globalThis.fetch}) {
  let catalog;
  const request = async () => {
    const response = await fetch(new URL('./assets/image-manifest.json', baseURL), {cache:'no-store'});
    if (!response.ok) throw new Error('Could not check the project artwork catalog.');
    const result = await response.json();
    if (result?.version !== 1 || !Array.isArray(result.images)) throw new Error('Invalid project artwork catalog.');
    return result;
  };
  async function check(document, refresh) {
    if (!catalog || refresh) {
      const pending = catalog = request();
      pending.catch(() => {if (catalog === pending) catalog = undefined;});
    }
    return artworkIssues(document, await catalog, baseURL);
  }
  return {
    projectIssues: (project, {refresh = false} = {}) => check(project, refresh),
    chapterIssues: chapter => check(chapter, true),
  };
}
