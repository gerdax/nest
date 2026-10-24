import { chapterVariables, compileChapter } from '../project/model.js';
import { initialValues, inventoryQuantity, transact } from '../project/state.js';
import { normalizeRule } from './commands.js';
import { remapVariableReferences } from './variable-ids.js';
import { eligibleInventoryItems } from './item-options.js';

/** Editor-session settings only: never attach these effects to the project. */
export class PreviewOverrides {
 constructor() { this.entries = new Map(); }
 key(project, chapter, node) { return JSON.stringify([project.id, chapter.id, node.id]); }
 effects(project, chapter, node) { return node ? structuredClone(this.entries.get(this.key(project,chapter,node)) || []) : []; }
 nodeEntryEffects(project, chapter) {
  if(project.ignoreAllOverrides===true)return {};
  const items=eligibleInventoryItems(project,chapter);
  return Object.fromEntries(chapter.nodes.flatMap(node=>{
   const effects=this.effects(project,chapter,node);
   for(const effect of effects)if(['addItem','removeItem'].includes(effect.op)&&!items.some(item=>item.id===effect.key))
    throw new Error('Override item is unavailable in this chapter.');
   return effects.length?[[node.id,effects]]:[];
  }));
 }
 clear() { this.entries.clear(); }
 remap(projectId, rename) {
  for(const [key,effects] of this.entries) {
   const [owner,chapterId]=JSON.parse(key);
   if(owner===projectId&&(!rename.chapterId||rename.chapterId===chapterId))
    remapVariableReferences(effects,rename.oldId,rename.newId);
  }
 }
 update(project, chapter, node, {command, path, index, value, inputType}) {
  const effects=this.effects(project,chapter,node);
  if(command==='clear-overrides')effects.length=0;
  else if(command==='add-rule') {
   const variable=chapterVariables(project,chapter)[0];
   effects.push({op:'set',key:variable?.id||'',value:variable?.initial??0});
  } else if(command==='remove-rule')effects.splice(Number(index),1);
  else {
   const match=/^effects\.(\d+)\.(op|key|value)$/.exec(path||'');
   if(!match||!effects[Number(match[1])])throw new Error('Unknown preview override.');
   const rule=effects[Number(match[1])],leaf=match[2];
   rule[leaf]=inputType==='number'?Number(value):leaf==='value'&&['true','false'].includes(value)?value==='true':value;
   if(['op','key'].includes(leaf))normalizeRule(project,rule,leaf,chapter);
  }
  this.entries.set(this.key(project,chapter,node),effects);
 }
 initialState(project, chapter, node) {
  if(project.ignoreAllOverrides===true)return null;
  const effects=this.effects(project,chapter,node);
  if(!effects.length)return null;
  const compiled=compileChapter(project,chapter.id,{additionalDefinitionIds:effects.filter(effect=>effect.op==='addItem').map(effect=>effect.key)});
  const items=eligibleInventoryItems(project,chapter);
  let state={variables:initialValues(compiled.variables),inventory:[]};
  for(const effect of effects) {
   if(['addItem','removeItem'].includes(effect.op)) {
    if(!items.some(item=>item.id===effect.key))throw new Error('Override item is unavailable in this chapter.');
    if(effect.op==='removeItem'&&!inventoryQuantity(state.inventory,effect.key))continue;
   }
   state=transact(state.variables,state.inventory,{effects:[effect]},compiled.variables,compiled.library);
  }
  return state;
 }
}
