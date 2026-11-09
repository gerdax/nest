import { definitionGraph } from './dependencies.js';
import { cloneProject, list, named, object, unique, walk } from './model-data.js';
import { compatibleStatVariable, STAT_IDS } from './checks.js';
import { createEffectCard } from './combat-model.js';
import { validateProject } from './validation.js';
import { mergeLibraryContent } from './packages.js';

/** Import shared roots from an already parsed project, including their full
 * definition closure. No chapter or project playback configuration is copied.
 * Inputs remain untouched; the selection is validated before merging and the host owns undo. */
export function importLibrary(project, sourceProject, ids) {
  if (!object(sourceProject) || sourceProject.kind !== 'nest-project' || sourceProject.version !== 3
    || !Array.isArray(sourceProject.library) || !Array.isArray(sourceProject.variables) || !Array.isArray(sourceProject.chapters)) {
    throw new Error('Library import requires a parsed version 3 project');
  }
  const source = cloneProject(sourceProject);
  const byId = new Map(source.library.map(definition => [definition.id, definition]));
  const roots = ids === undefined ? source.library.filter(d => d.visibility !== 'local').map(d => d.id) : ids;
  if (!Array.isArray(roots) || roots.some(id => !named(id) || !byId.has(id) || byId.get(id).visibility === 'local')) {
    throw new Error('Library import selection must contain shared Library definition IDs');
  }
  const reached = new Set([...roots, ...definitionGraph(source).reachableFrom(roots.map(id => byId.get(id)))]);
  for (const id of reached) if (!byId.has(id)) throw new Error(`Missing Library dependency: ${id}`);
  const library = source.library.filter(definition => reached.has(definition.id));
  const variables = [], globals = new Map(source.variables.map(variable => [variable.id, variable]));
  const used = new Set(source.variables.map(variable => variable.id));
  const promoted = new Map();
  const include = variable => {
    if (['health', 'energy', ...STAT_IDS].includes(variable.id)) {
      const target = list(project.variables).find(candidate => candidate.id === variable.id);
      if (target) {
        const numeric = target.type === 'number' && Number.isFinite(target.initial)
          && [target.min, target.max].every(bound => bound === undefined || Number.isFinite(bound));
        const compatible = STAT_IDS.includes(variable.id) ? compatibleStatVariable(target)
          : numeric && (variable.id !== 'health' || Number.isSafeInteger(target.initial)
            && (target.min === undefined || Number.isSafeInteger(target.min) && target.min <= 0)
            && (target.max === undefined || Number.isSafeInteger(target.max) && target.max >= 1));
        if (!compatible) throw new Error(`Incompatible destination resource or stat: ${variable.id}`);
        variable = target;
      } else if (list(project.chapters).some(chapter => list(chapter.variables).some(candidate => candidate.id === variable.id))) {
        throw new Error(`Cannot import global resource or stat over a chapter variable: ${variable.id}`);
      }
    }
    if (!variables.some(existing => existing.id === variable.id)) variables.push(cloneProject(variable));
    return variable.id;
  };
  for (const definition of library) {
    const owner = source.chapters.find(chapter => chapter.id === definition.chapterId);
    const resolveVariable = key => {
      if (globals.has(key)) return include(globals.get(key));
      const candidates = owner ? list(owner.variables).filter(variable => variable.id === key)
        : source.chapters.flatMap(chapter => list(chapter.variables).filter(variable => variable.id === key));
      if (!candidates.length) throw new Error(`Missing Library variable dependency: ${key}`);
      // A legacy unowned local can be portable when every possible owner gives
      // its variable exactly the same definition. Otherwise require an owner.
      if (candidates.some(variable => JSON.stringify(variable) !== JSON.stringify(candidates[0]))) {
        throw new Error(`Ambiguous chapter variable dependency: ${key}`);
      }
      const variable = candidates[0], identity = JSON.stringify(variable);
      if (!promoted.has(identity)) {
        const id = unique(variable.id, used);
        promoted.set(identity, id);
        variables.push({...cloneProject(variable), id});
      }
      return promoted.get(identity);
    };
    const fixedVariable = key => resolveVariable(key);
    if (definition.kind === 'consumable') fixedVariable(definition.subtype);
    walk(definition, value => {
      if (typeof value.text === 'string') {
        value.text = value.text.replace(/\[STAT:([^\[\]\r\n]*)\]/g, (_, key) => `[STAT:${resolveVariable(key)}]`);
        if (value.text.includes('[HP]')) fixedVariable('health');
        if (value.text.includes('[ENERGY]')) fixedVariable('energy');
      }
      if (typeof value.key === 'string' && (value.source === 'variable' || ['set', 'add'].includes(value.op))) value.key = resolveVariable(value.key);
      if (named(value.modifierVariable)) value.modifierVariable = resolveVariable(value.modifierVariable);
    });
    if (definition.visibility === 'local') definition.visibility = 'shared';
    delete definition.chapterId;
  }
  const concreteItems = new Set(library.filter(d => d.kind === 'item').flatMap(d => [d.id, d.inventoryKey].filter(Boolean)));
  const tagIds = new Set();
  walk(library, value => {
    if (named(value.tagId)) tagIds.add(value.tagId);
    for (const key of [value.contextItemId, value.source === 'inventory' ? value.key : undefined]) {
      if (typeof key === 'string' && key.startsWith('tag:') && !concreteItems.has(key)) tagIds.add(key.slice(4));
    }
  });
  const itemTags = list(source.itemTags).filter(tag => tagIds.has(tag.id));
  for (const id of tagIds) if (!itemTags.some(tag => tag.id === id)) throw new Error(`Missing Library tag dependency: ${id}`);
  validateContent({library, variables, itemTags});
  return mergeLibraryContent(project, {library, variables, itemTags});
}

/** Validate only the portable selection, using private feedback and a private
 * chapter to satisfy project invariants. These fixtures never enter the merge. */
function validateContent(content) {
  const used = new Set();
  walk(content, value => {
    for (const key of ['id', 'definitionId', 'contextItemId', 'key', 'actionId']) if (named(value[key])) used.add(value[key]);
  });
  const hit = unique('__library-validation-hit', used), dodge = unique('__library-validation-dodge', used),
    death = unique('__library-validation-death', used);
  const library = [...cloneProject(content.library), createEffectCard(hit), createEffectCard(dodge),
    {id: death, kind: 'caption', name: '', text: '', image: '', effects: []}];
  const chapter = {id:'validation', name:'Validation', variables:[], startNode:'start', deathNode:'death', nodes:[
    {id:'start',name:'Start',type:'linear',x:0,y:0,cards:[],connections:{next:null}},
    {id:'death',name:'Death',type:'death',x:0,y:0,cards:[{id:'death-card',definitionId:death}],connections:{}}
  ]};
  const errors = validateProject({version:3,kind:'nest-project',id:'validation',name:'Validation',
    ...cloneProject(content),library,chapters:[chapter],activeChapterId:chapter.id,showDeathBeat:true,
    combat:{defaultActions:[],playerHit:{definitionId:hit},playerDodge:{definitionId:dodge}}});
  if (errors.length) throw new Error(`Cannot import selected Library content:\n${errors.map(error => error.message).join('\n')}`);
}
