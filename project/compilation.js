import { ensureCombatDefaults } from './combat-model.js';
import { createError } from '../errors.js';
import { normalizeLocalOwnership } from './local-ownership.js';
import { retainsInventoryItems } from './nodeTypes.js';
import { canonicalCardKind, resolvePlacement } from './cards.js';
import { projectCardBack } from './card-backs.js';
import { definitionGraph } from './dependencies.js';
import { createLibraryIndex } from './library-index.js';
import { cloneProject, legacyArtwork, list, chapterVariables } from './model-data.js';
import { discardPlacementContext, normalizeSingleItems } from './normalization.js';
import { resolveBeatGroups } from './beat-groups.js';
import { inspectRandomizerGroup } from './randomizer.js';

export function compileChapter(project, chapterId = project.activeChapterId, {additionalDefinitionIds = []} = {}) {
  // All resolved mechanics and normalization must operate on detached data.
  project = normalizeSingleItems(normalizeLocalOwnership(ensureCombatDefaults(cloneProject(project))));
  const index = createLibraryIndex(list(project?.library));
  discardPlacementContext(project, index);
  const chapter = project.chapters.find(c => c.id === chapterId);
  if (!chapter) throw createError('PROJECT_UNKNOWN_CHAPTER_ID', { chapterId });
  const grouped = resolveBeatGroups(project, chapter);
  const invalidGroup = grouped.issues.find(issue => !issue.draft);
  if (invalidGroup) throw new Error(invalidGroup.message);
  const result = grouped.chapter === chapter ? cloneProject(chapter) : grouped.chapter;
  delete result.beatGroups;
  const randomizers = chapter.nodes.filter(node => node.type === 'randomizer');
  if (randomizers.length) {
    const groupIds = new Set(randomizers.flatMap(node => list(node.candidates).map(candidate => candidate?.groupId)));
    const entries = [];
    for (const id of groupIds) {
      const {group, usable, exits} = inspectRandomizerGroup(project, chapter, id);
      if (usable) entries.push([id,{entryId:group.entryId,oncePerRun:group.oncePerRun === true,exits}]);
    }
    result.randomizerGroups = Object.fromEntries(entries);
  }
  result.combat = cloneProject(project.combat);
  result.showDeathBeat = project.showDeathBeat;
  result.itemTags = cloneProject(project.itemTags || []);
  result.allowCycles = project.allowCycles !== false;
  result.ownedItemsVisibility = project.ownedItemsVisibility ?? 'disabled';
  result.unavailableActions = project.unavailableActions ?? 'disabled';
  delete result.backImage;
  result.cardBack = {...projectCardBack(project)};
  result.cardStyles = cloneProject(project.cardStyles || {});
  const graph = definitionGraph(project);
  const reachable = graph.reachableFrom([chapter, project.combat, ...additionalDefinitionIds.map(definitionId => ({definitionId})), ...project.library.filter(d => d.visibility !== 'local')]);
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
    if (project.ignoreAllOverrides === true) { delete node.unavailableActions;delete node.entryEffects; }
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
