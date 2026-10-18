import { normalizeLocalOwnership } from './local-ownership.js';
import { retainsInventoryItems } from './nodeTypes.js';
import { canonicalCardKind, resolvePlacement } from './cards.js';
import { projectCardBack } from './card-backs.js';
import { definitionGraph } from './dependencies.js';
import { createLibraryIndex } from './library-index.js';
import { cloneProject, legacyArtwork, list, chapterVariables } from './model-data.js';
import { discardPlacementContext, normalizeSingleItems } from './normalization.js';

export function compileChapter(project, chapterId = project.activeChapterId) {
  // All resolved mechanics and normalization must operate on detached data.
  project = normalizeLocalOwnership(cloneProject(project));
  const index = createLibraryIndex(list(project?.library));
  discardPlacementContext(project, index);
  const chapter = project.chapters.find(c => c.id === chapterId);
  if (!chapter) throw new TypeError(`Unknown chapter: ${chapterId}`);
  const result = cloneProject(chapter);
  result.allowCycles = project.allowCycles !== false;
  result.ownedItemsVisibility = project.ownedItemsVisibility ?? 'disabled';
  result.unavailableActions = project.unavailableActions ?? 'disabled';
  delete result.backImage;
  result.cardBack = {...projectCardBack(project), switchIcons: project.switchCardBackIcons !== false};
  result.cardStyles = cloneProject(project.cardStyles || {});
  const graph = definitionGraph(project);
  const reachable = graph.reachableFrom([chapter, ...project.library.filter(d => d.visibility !== 'local')]);
  result.library = project.library.filter(d => d.visibility !== 'local' || reachable.has(d.id)).map(d => ({
    ...cloneProject(d),
    kind: canonicalCardKind(d.kind),
    definitionId: d.id,
    ...(d.kind === 'item' ? {inventoryKey: d.inventoryKey ?? d.id} : {})
  }));
  result.variables = chapterVariables(project, chapter).map(variable => ({
    ...variable,
    initial: Object.hasOwn(chapter.initialValues ?? {}, variable.id)
      ? chapter.initialValues[variable.id]
      : variable.initial,
  }));
  for (const node of result.nodes) {
    if (['container','linear'].includes(node.type)) node.retainInventoryItems = retainsInventoryItems(node);
    for (const key of ['cards', 'choices', 'items']) if (node[key]) node[key] = node[key].map(p => resolvePlacement(project, p, index));
    if (node.intro) node.intro = resolvePlacement(project, node.intro, index);
    for (const raw of legacyArtwork(node)) if (raw.definitionId) {
      const resolved = resolvePlacement(project, raw, index);
      const originalId = raw.id;
      Object.assign(raw, resolved, {cardKind: resolved.kind, name: resolved.name, heading: resolved.heading,
        inventoryKey: resolved.inventoryKey, title: resolved.heading || resolved.name, label: resolved.name,
        text: resolved.text, image: resolved.image, flipImage: resolved.flipImage});
      if (resolved.kind === 'item') raw.effects = resolved.onCollect || [];
      else raw.effects = resolved.effects || [];
      if (resolved.kind === 'action') raw.conditions = resolved.conditions || [];
      raw.id = originalId;
    }
  }
  return normalizeSingleItems(result);
}
