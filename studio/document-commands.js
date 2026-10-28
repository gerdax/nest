import { applyCombatArrayCommand } from './combat-authoring.js';
import { createWeapon } from '../project/combat-model.js';
import { createError } from '../errors.js';
import { eligibleInventoryItems } from './item-options.js';
import { placedLocalDefinitions, removeUnplacedLocalDefinitions } from './local-definition-removal.js';
import { applyTagCommand } from './item-tags.js';
import { allocateVariableId, renameVariable } from './variable-ids.js';
import { pasteCardClipboard } from './card-clipboard.js';
import { isStatVariable } from '../project/checks.js';
import { createDefinition, allowedCardKinds, isStoryKind, isConsumableKind } from '../project/cards.js';
import { chapterVariables, createProjectChapter, importChapter, outputsForNode } from '../project/model.js';
import { definitionGraph } from '../project/dependencies.js';
import { removeLibraryDefinition } from './library-removal.js';
import { captureNodeClipboard, pasteNodeClipboard, captureNodesClipboard, pasteNodesClipboard } from './node-clipboard.js';
import { transferCard } from './card-transfer.js';
import { appendLibraryCard } from './library-cards.js';
import { sortedChapters } from '../project/chapter-navigation.js';
import {
  uid, createNode, makePlacement, promoteCard, duplicateNode, duplicatePlacement,
  findPlacement, pathTarget, customizeAction, customizeItem, customizeConsumable, customizeStory, newRule, normalizeRule, addHealthVariable,
} from './commands.js';

function chapterFor(project, selection) {
  return project.chapters.find(chapter => chapter.id === selection.chapterId) || project.chapters[0];
}
function nodeFor(project, selection) {
  return chapterFor(project, selection)?.nodes.find(node => node.id === selection.selected);
}
function ruleChapterFor(project, selection, scope) {
 if(scope==='definition') {
  const definition=project.library.find(card=>card.id===selection.definitionId);
  return definition?.visibility==='local'?project.chapters.find(chapter=>chapter.id===definition.chapterId):undefined;
 }
 return ['node','placement','local-definition'].includes(scope)?chapterFor(project,selection):undefined;
}
export function documentScope(project, selection, {scope, placementId}) {
  if (scope === 'project') return project;
  if (scope === 'chapter') return chapterFor(project, selection);
  if (scope === 'node') return nodeFor(project, selection);
  if (scope === 'definition') return project.library.find(card => card.id === selection.definitionId);
  const placement = findPlacement(nodeFor(project, selection) || {}, placementId);
  if (scope === 'placement') return placement;
  if (scope === 'local-definition') return project.library.find(card => card.id === placement?.definitionId);
}
export function setConnection(node, exit, target) {
  if(node?.type==='death')throw new Error('Death has no connections');
  if (node.type === 'random') {
    if (exit === 'fallback') node.fallback = target;
    else node.routes.find(route => route.id === exit).target = target;
  } else node.connections[exit] = target;
}

/** Apply an already-read form value to a draft, without DOM or browser services. */
function changeField(project, selection, field, localDrafts) {
  const {scope, path, value:raw, checked, inputType, colorField, color} = field;
  const chapter = chapterFor(project, selection), node = nodeFor(project, selection);
  if (scope === 'connection') {
    if(raw.startsWith('target:')&&chapter.nodes.find(n=>n.id===raw.slice(7))?.type==='death')throw new Error('Death cannot have incoming connections');
    setConnection(node, path, raw === 'unlinked' ? false : raw === 'end' ? null : raw.slice(7));
    return;
  }
  if (scope === 'initial-toggle') {
    chapter.initialValues ||= {};
    if (checked) chapter.initialValues = {...chapter.initialValues, [path]:project.variables.find(v => v.id === path).initial};
    else delete chapter.initialValues[path];
    return;
  }
  if (scope === 'initial-value') {
    const variable = project.variables.find(v => v.id === path);
    chapter.initialValues = {...(chapter.initialValues || {}), [path]:variable.type === 'flag' ? raw === 'true' : Number(raw)};
    return;
  }
  const ruleChapter = ruleChapterFor(project, selection, scope);
  const variables = chapterVariables(project, ruleChapter);
  const root = documentScope(project, selection, field);
  if (!root) return;
  if (scope === 'chapter' && path === 'nextChapterId' && raw === '') {
    delete root.nextChapterId;
    return;
  }
  if (scope === 'placement' && path === 'useCustomRules') {
    if (checked) {
      const definition=project.library.find(card=>card.id===root.definitionId);
      if(definition?.kind==='item')customizeItem(project,root);
      else if(isConsumableKind(definition?.kind))customizeConsumable(project,root);
      else if(isStoryKind(definition?.kind))customizeStory(project,root);
      else customizeAction(project,root);
    }
    else delete root.overrides;
    return;
  }
  if (scope === 'node' && path === 'introEnabled' && checked && root.type === 'fork' && !root.intro) root.intro = makePlacement(project, 'event', undefined, chapterFor(project, selection).id);
  if (scope === 'placement' && path === 'definitionId') {
    localDrafts.switchSource(project, root, raw, {allowedKinds:allowedCardKinds(node.type, node.intro === root ? 'intro' : node.type === 'container' ? 'items' : 'cards')});
    return;
  }
  if(['definition','local-definition'].includes(scope)&&root.kind==='consumable'&&path==='subtype'&&!['health','energy'].includes(raw))throw new Error('Consumable subtype must be health or energy');
  const {parent, key} = pathTarget(root, path);
  if(['project','chapter'].includes(scope)&&/^variables\.\d+\.name$/.test(path)){
    return {variableRename:renameVariable(project,parent,raw,scope==='chapter'?chapter:undefined)};
  }
  if (colorField) {
    if (color === undefined) delete parent[key];
    else parent[key] = color;
    return;
  }
  let value = inputType === 'checkbox' ? checked : ['number','range'].includes(inputType) || ['sides','difficulty'].includes(key) ? Number(raw) : raw;
  if(scope==='definition'&&/^reactions\.\d+\.threshold\.percent$/.test(path)) {
    if(!Number.isFinite(value)||value<=0||value>=100)throw new Error('Health threshold must be between 0 and 100 percent');
    let numerator=Math.round(value*1000000),denominator=100000000;
    const gcd=(a,b)=>b?gcd(b,a%b):a,divisor=gcd(numerator,denominator);
    parent.numerator=numerator/divisor;parent.denominator=denominator/divisor;return;
  }
  if ((['value','initial'].includes(key) || path.startsWith('initialValues.')) && ['true','false'].includes(value)) value = value === 'true';
  if (inputType === 'number' && raw === '') { delete parent[key]; return; }
  if (['imageScale','imageOffsetX','imageOffsetY'].includes(key)) value = clampArtwork(key, value);
  if(key==='key'&&['addItem','removeItem'].includes(parent.op)&&value&&!eligibleInventoryItems(project,ruleChapter).some(item=>item.id===value))throw createError('STUDIO_ITEM_EFFECTS_MUST_REFERENCE_AN_ELIGIBLE_ITEM_FROM_THE_OWNING_CHAPTER_OR_SHARED_LIBRARY');
  parent[key] = value;
  if(scope==='definition'&&path==='subtype'&&root.kind==='item'){if(value==='weapon')root.combat??=createWeapon(root.id).combat;else delete root.subtype;return;}
  if(scope==='definition'&&(path==='attack.source'||/^combat\.actions\.\d+\.attack\.source$/.test(path))){parent.minBonus??=0;parent.maxBonus??=0;if(value==='self')parent.damage??={min:1,max:1};return;}
  if (['modifierVariable','contextItemId','tagId'].includes(key) && !value) delete parent[key];
  if (key === 'contextItemId' && (!value||value.startsWith('tag:'))) delete parent.contextOverrideImage;
  if (key === 'resolution' && value === 'check') {
    const check = parent.check;
    // Old Direct actions carry an unused stock custom-check template.
    const stockCheck = check && !check.mode && !check.modifierVariable && !check.difficulty &&
      check.modifier === 0 && check.target === 10 && check.pool?.length === 1 &&
      check.pool[0].sides === 20 && check.pool[0].count === 1;
    if (!check || stockCheck) parent.check = {mode:'stat',modifierVariable:variables.find(isStatVariable)?.id,difficulty:1};
  }
  if (key === 'mode' && value === 'stat') {
    parent.difficulty ??= 1;
    if (!variables.some(v => v.id === parent.modifierVariable && isStatVariable(v))) parent.modifierVariable = variables.find(isStatVariable)?.id;
  }
  if (key === 'mode' && value === 'custom') {
    parent.pool ||= [{sides:20,count:1}]; parent.modifier ??= 0; parent.target ??= 10;
  }
  if (key === 'type' && ['flag','number'].includes(value)) { parent.initial = value === 'flag' ? false : 0; delete parent.min; delete parent.max; }
  if (['source','op','key'].includes(key)) normalizeRule(project, parent, key, ruleChapter);
}
function clampArtwork(key, value) {
  return Math.max(key === 'imageScale' ? 10 : -100, Math.min(key === 'imageScale' ? 400 : 100, value));
}
function inspectorCommand(project, selection, data, localDrafts) {
  const node = nodeFor(project, selection), placement = findPlacement(node || {}, data.placement);
  const descriptor = {scope:data.scope, placementId:data.placement};
  switch (data.command) {
    case 'combat-add':case 'combat-remove':case 'combat-move':applyCombatArrayCommand(documentScope(project,selection,descriptor),data);break;
    case 'reset-artwork': {
      const root = documentScope(project, selection, descriptor);
      delete root.imageScale; delete root.imageOffsetX; delete root.imageOffsetY;
      break;
    }
    case 'add-rule': {
      const {parent, key} = pathTarget(documentScope(project, selection, descriptor), data.path);
      parent[key] ||= [];
      parent[key].push(newRule(project, data.ruleKind, ruleChapterFor(project, selection, data.scope)));
      break;
    }
    case 'remove-rule': {
      const {parent, key} = pathTarget(documentScope(project, selection, descriptor), data.path);
      parent[key].splice(Number(data.index), 1);
      break;
    }
    case 'local-copy': localDrafts.convert(project, placement); break;
    case 'clear-card': localDrafts.clear(project, placement); break;
    case 'promote-card': promoteCard(project, placement); localDrafts.drafts.delete(placement.id); break;
    case 'add-placement': node[data.slot].push(makePlacement(project, data.kind, undefined, chapterFor(project, selection).id)); break;
    case 'duplicate-placement': duplicatePlacement(project, node, placement); break;
    case 'remove-placement': {
      if(!placement)return;
      if(node.type==='death'&&node.cards.length<=1)throw new Error('Death must keep at least one card');
      const definitions=placedLocalDefinitions(project,placement);
      if(node.intro===placement){
        if(node.type==='container')node.intro=makePlacement(project,'event',undefined,chapterFor(project,selection).id);
        else delete node.intro;
        node.introEnabled=false;
      }
      localDrafts.removePlacement(project, placement);
      for (const slot of ['cards','choices','items']) if (node[slot]) node[slot] = node[slot].filter(card => card.id !== placement.id);
      removeUnplacedLocalDefinitions(project,definitions,localDrafts);
      break;
    }
    case 'move-placement':
      for (const slot of ['cards','choices','items']) if (node[slot]) {
        const index = node[slot].findIndex(card => card.id === placement.id), target = index + Number(data.direction);
        if (index >= 0 && target >= 0 && target < node[slot].length) [node[slot][index],node[slot][target]] = [node[slot][target],node[slot][index]];
      }
      break;
    case 'add-route': node.routes.push({id:uid('route'),name:`Route ${node.routes.length+1}`,target:false,weight:1,conditions:[]}); break;
    case 'remove-route': node.routes.splice(Number(data.index), 1); break;
    case 'delete-definition': {
      // Inactive type drafts can outlive their pruned definitions. Their IDs
      // must not be reused by unrelated converted cards during cache refresh.
      const reservedIds = [];
      for (const draft of localDrafts?.drafts.values() ?? []) for (const saved of draft.types.values()) {
        for (const definition of [saved.definition, ...saved.dependencies]) {
          reservedIds.push(definition.id, definition.inventoryKey);
        }
      }
      const {converted} = removeLibraryDefinition(project, selection.definitionId, {reservedIds});
      return {selection:{definitionId:project.library.find(card => card.visibility !== 'local')?.id}, value:converted};
    }
    case 'add-health': addHealthVariable(project); break;
    case 'add-chapter-variable': (chapterFor(project, selection).variables ||= []).push({id:allocateVariableId(project,'New variable'),name:'New variable',type:'number',initial:0}); break;
    case 'remove-chapter-variable': chapterFor(project, selection).variables.splice(Number(data.index), 1); break;
    case 'add-variable': project.variables.push({id:allocateVariableId(project,'New variable'),name:'New variable',type:'number',initial:0}); break;
    case 'remove-variable': project.variables.splice(Number(data.index), 1); break;
  }
}

/** Commands mutate only the supplied history draft and return explicit UI changes. */
export function applyDocumentCommand(project, selection, type, data = {}, localDrafts) {
  const chapter = chapterFor(project, selection), node = nodeFor(project, selection);
  switch (type) {
    case 'item-tag': return applyTagCommand(project,data);
    case 'field': return changeField(project, selection, data, localDrafts);
    case 'inspector': return inspectorCommand(project, selection, data, localDrafts);
    case 'connect': if(chapter.nodes.find(n=>n.id===data.target)?.type==='death')throw new Error('Death cannot have incoming connections');setConnection(chapter.nodes.find(n => n.id === data.id), data.exit, data.target); break;
    case 'move-node': Object.assign(chapter.nodes.find(n => n.id === data.id), {x:data.x, y:data.y}); break;
    case 'move-nodes': {
      for(const position of data.positions){
        const target=chapter.nodes.find(node=>node.id===position.id);
        if(!target||!Number.isFinite(position.x)||!Number.isFinite(position.y))throw createError('STUDIO_THE_SELECTED_BEATS_CAN_NO_LONGER_BE_MOVED');
        Object.assign(target,{x:position.x,y:position.y});
      }
      break;
    }
    case 'image': {
      const target = documentScope(project, selection, data);
      if (!target) throw createError('STUDIO_SELECT_THE_CARD_AGAIN_BEFORE_CHOOSING_ITS_IMAGE');
      const {parent, key} = pathTarget(target, data.path);
      parent[key] = ['imageScale','imageOffsetX','imageOffsetY'].includes(key) ? clampArtwork(key, data.value) : data.value;
      break;
    }
    case 'paste-artwork': Object.assign(project.library.find(card => card.id === data.id), data.settings); break;
    case 'add-library-card': {
      const added = appendLibraryCard(project, chapter, node, data.definitionId);
      return added ? {value:added.id} : {};
    }
    case 'select-chapter': {
      const target = project.chapters.find(c => c.id === data.id);
      project.activeChapterId = target.id;
      return {selection:{chapterId:target.id, selected:target.startNode}};
    }
    case 'delete-chapter': {
      if (project.chapters.length <= 1) throw createError('STUDIO_THE_PROJECT_MUST_KEEP_AT_LEAST_ONE_CHAPTER');
      const index = project.chapters.findIndex(candidate => candidate.id === (data.id ?? selection.chapterId));
      if (index < 0) throw createError('STUDIO_THE_CHAPTER_NO_LONGER_EXISTS');
      const removedChapterId = project.chapters[index].id;
      const removedDefinitions = definitionGraph(project).reachableFrom(project.chapters[index]);
      project.chapters.splice(index, 1);
      for (const remaining of project.chapters) if (remaining.nextChapterId === removedChapterId) delete remaining.nextChapterId;
      if (project.startChapterId === removedChapterId) project.startChapterId = sortedChapters(project)[0].id;
      const retained = definitionGraph(project).retained();
      project.library = project.library.filter(card => card.visibility !== 'local'
        || !removedDefinitions.has(card.id) && card.chapterId !== removedChapterId || retained.has(card.id));
      const next = project.chapters[Math.min(index, project.chapters.length - 1)];
      project.activeChapterId = next.id;
      return {selection:{chapterId:next.id, selected:next.startNode}};
    }
    case 'add-chapter': {
      const added = createProjectChapter(project,uid('chapter'), `Chapter ${project.chapters.length+1}`), first = createNode(project, 'linear', undefined, added.id);
      added.nodes.push(first); added.startNode = first.id; project.chapters.push(added); project.activeChapterId = added.id;
      return {selection:{chapterId:added.id, selected:first.id}};
    }
    case 'add-common-action': {
      const added=createDefinition('combatAction',uid('combatAction'));project.library.push(added);
      project.combat.defaultActions.push({definitionId:added.id});
      return {selection:{definitionId:added.id,mode:'library'}};
    }
    case 'use-common-action': {
      const action=project.library.find(d=>d.id===data.id&&d.kind==='combatAction'&&d.visibility!=='local');
      if(!action||action.attack?.source==='weapon')throw new Error('Default combat Actions must work without a Weapon');
      if(!project.combat.defaultActions.some(ref=>ref.definitionId===action.id))project.combat.defaultActions.push({definitionId:action.id});break;
    }
    case 'move-common-action': {
      const list=project.combat.defaultActions,index=list.findIndex(ref=>ref.definitionId===data.id),target=index+Number(data.direction);
      if(index>=0&&target>=0&&target<list.length)[list[index],list[target]]=[list[target],list[index]];break;
    }
    case 'remove-common-action': project.combat.defaultActions=project.combat.defaultActions.filter(ref=>ref.definitionId!==data.id);break;
    case 'use-common-effect': {
      if(!project.library.some(d=>d.id===data.id&&d.kind==='effect'&&d.visibility!=='local'))throw new Error('Select an Effect Card');
      project.combat.playerHit={definitionId:data.id};break;
    }
    case 'add-definition': {
      const added = createDefinition(data.kind, uid(data.kind)); project.library.push(added);
      return {selection:{definitionId:added.id, mode:'library'}};
    }
    case 'add-node': {
      const added = createNode(project, data.type, data.position, chapter.id); chapter.nodes.push(added);
      if (!chapter.startNode) chapter.startNode = added.id;
      return {selection:{selected:added.id}};
    }
    case 'paste-card': {
      const placement=findPlacement(node||{},data.placementId);
      if(!placement)throw createError('STUDIO_THE_DESTINATION_CARD_NO_LONGER_EXISTS');
      const pasted=pasteCardClipboard(project,chapter,node,placement,data.clipboard);
      localDrafts.drafts.delete(placement.id);
      return {value:pasted.id};
    }
    case 'paste-nodes':
    case 'duplicate-disconnected-nodes':
    case 'duplicate-nodes': {
      const clipboard=type!=='paste-nodes'?captureNodesClipboard(project,chapter.id,data.ids):data.clipboard;
      const added=pasteNodesClipboard(project,chapter,clipboard,{position:data.position});
      if(type!=='paste-nodes')for(const node of added)node.name+=' copy';
      if(type==='duplicate-disconnected-nodes'){
        const ids=new Set(added.map(node=>node.id)),target=id=>ids.has(id)?id:false;
        for(const node of added){
          for(const key of Object.keys(node.connections||{}))node.connections[key]=target(node.connections[key]);
          if(node.type==='random'){
            for(const route of node.routes||[])route.target=target(route.target);
            node.fallback=target(node.fallback);
          }
        }
      }
      return {selection:{selected:added[0].id,selectedIds:added.map(node=>node.id),mode:'chapter'},value:added[0].id};
    }
    case 'paste-node': {
      const added = pasteNodeClipboard(project, chapter, data.clipboard, {position:data.position});
      return {selection:{selected:added.id, mode:'chapter'}, value:added.id};
    }
    case 'discard-card': {
      const source=chapter?.nodes.find(candidate=>candidate.id===data.sourceNodeId);
      if(!source||!findPlacement(source,data.placementId))return {};
      inspectorCommand(project,{...selection,selected:source.id},{command:'remove-placement',placement:data.placementId},localDrafts);
      return {selection:{selected:source.id,mode:'chapter'}};
    }
    case 'transfer-card': {
      const transferred = transferCard(project, chapter, data);
      return transferred ? {selection:{selected:data.targetNodeId, mode:'chapter'}, value:transferred.id} : {};
    }
    case 'create-connected-node': {
      const source = chapter?.nodes.find(candidate => candidate.id === data.id);
      if (!source) throw createError('STUDIO_THE_SOURCE_BEAT_NO_LONGER_EXISTS');
      if (!outputsForNode(project, source).includes(data.exit)) throw createError('STUDIO_THE_SOURCE_OUTPUT_NO_LONGER_EXISTS');
      const added = createNode(project, data.type, data.position, chapter.id);
      chapter.nodes.push(added);
      setConnection(source, data.exit, added.id);
      return {selection:{selected:added.id}};
    }
    case 'duplicate-disconnected-node': {
      const clipboard = captureNodeClipboard(project, chapter.id, data.id);
      const added = pasteNodeClipboard(project, chapter, clipboard, {position:data.position});
      added.name += ' copy';
      if (added.connections) for (const exit of Object.keys(added.connections)) added.connections[exit] = false;
      if (added.type === 'random') {
        for (const route of added.routes || []) route.target = false;
        added.fallback = false;
      }
      return {selection:{selected:added.id}};
    }
    case 'duplicate-node': {
      const added = duplicateNode(project, node); chapter.nodes.push(added);
      return {selection:{selected:added.id}};
    }
    case 'delete-node':
    case 'delete-nodes': {
      const requested=type==='delete-node'?[node?.id]:data.ids;
      if(!Array.isArray(requested)||!requested.length||requested.some(id=>!chapter?.nodes.some(candidate=>candidate.id===id))) {
        throw createError('STUDIO_THE_SELECTED_BEAT_NO_LONGER_EXISTS');
      }
      if(requested.some(id=>chapter.nodes.find(n=>n.id===id)?.type==='death'))throw new Error('The mandatory Death beat cannot be deleted or cut');
      const ids=new Set(requested);
      const definitions=placedLocalDefinitions(project,chapter.nodes.filter(candidate=>ids.has(candidate.id)));
      chapter.nodes = chapter.nodes.filter(candidate => !ids.has(candidate.id));
      removeUnplacedLocalDefinitions(project,definitions,localDrafts);
      for (const remaining of chapter.nodes) {
        for (const key of Object.keys(remaining.connections || {})) if (ids.has(remaining.connections[key])) remaining.connections[key] = false;
        for (const route of remaining.routes || []) if (ids.has(route.target)) route.target = false;
        if (ids.has(remaining.fallback)) remaining.fallback = false;
      }
      if (ids.has(chapter.startNode)) chapter.startNode = chapter.nodes.find(n=>n.type!=='death')?.id || '';
      return {selection:{selected:chapter.startNode}};
    }
    case 'set-start': if(node.type==='death')throw new Error('Death cannot be the chapter start');chapter.startNode = node.id; break;
    case 'import': {
      const next = data.raw.kind === 'nest-project' ? data.incoming : importChapter(project, data.raw);
      const active = next.chapters.find(c => c.id === next.activeChapterId) || next.chapters[0];
      return {project:next, selection:{chapterId:next.activeChapterId, selected:active.startNode}};
    }
  }
  return {};
}
