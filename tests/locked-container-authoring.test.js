import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { createProject, createProjectChapter, exportChapter, importChapter, normalizeLocalOwnership, outputsForNode, parseCurrentProject, validateProject } from '../project/model.js';
import { unusedLocalDefinitions } from '../project/dependencies.js';
import { GraphView } from '../studio/GraphView.js';
import { cardDropSlot } from '../studio/card-drag.js';
import { captureCardClipboard, pasteCardClipboard } from '../studio/card-clipboard.js';
import { transferCard } from '../studio/card-transfer.js';
import { duplicateNode, synchronizeConnections } from '../studio/commands.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { definitionInspector, nodeInspector, placementInspector } from '../studio/inspectors.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { libraryRemovalPlan } from '../studio/library-removal.js';
import { applyTagCommand } from '../studio/item-tags.js';
import { captureNodeClipboard, pasteNodeClipboard } from '../studio/node-clipboard.js';

function fixture() {
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(node=>node.type==='container');
 const selection={chapterId:chapter.id,selected:node.id},drafts=new LocalCardDrafts();
 const field=(scope,path,value,id)=>applyDocumentCommand(project,scope==='definition'?{...selection,definitionId:id}:selection,'field',{
  scope,path,placementId:id,...(typeof value==='boolean'?{inputType:'checkbox',checked:value}:{value})
 },drafts);
 const command=(command,placement,options)=>applyDocumentCommand(project,selection,'inspector',{command,placement,...options},drafts);
 const definition=placement=>project.library.find(definition=>definition.id===placement.definitionId);
 const graph=Object.assign(Object.create(GraphView.prototype),{project,chapter,port:(_node,exit)=>`<button data-exit="${exit}"></button>`});
 const graphRows=()=>{
  graph.definitionsById=new Map(project.library.map(definition=>[definition.id,definition]));
  return graph.cardRows(node);
 };
 return {project,chapter,node,field,command,definition,graphRows};
}

test('locking a Container creates fixed local choices and preserves its introduction, Items and Next',()=>{
 const {project,chapter,node,field,command,definition,graphRows}=fixture();
 const {intro,items,connections}=node;
 assert.doesNotMatch(nodeInspector(project,chapter,node),/Allow forcing|Lock methods/);
 field('node','locked',true);
 const [lockpick,force,leave]=node.choices;
 assert.deepEqual(node.choices.map(choice=>choice.lockMethod),['lockpick','force','leave']);
 assert.deepEqual(definition(lockpick).check,{mode:'stat',modifierVariable:'composure',difficulty:1});
 assert.deepEqual(definition(force).check,{mode:'stat',modifierVariable:'agility',difficulty:4});
 assert.deepEqual(definition(force).costs,[{source:'variable',key:'energy',amount:2}]);
 assert.equal(definition(leave).resolution,'direct');
 assert.equal(node.allowForcing,false);
 assert.equal(node.intro,intro);assert.equal(node.items,items);assert.equal(node.connections,connections);
 assert.deepEqual(outputsForNode(project,node),['next']);
 assert.deepEqual(validateProject(project),[]);

 const panel=placement=>placementInspector(project,placement,'action',0,'choices',3,chapter,node);
 assert.match(nodeInspector(project,chapter,node),/Locked introduction/);
 assert.ok(!nodeInspector(project,chapter,node).includes(`data-placement="${force.id}"`));
 assert.match(panel(lockpick),/Inventory trigger/);
 assert.doesNotMatch(panel(force),/Inventory trigger/);
 assert.match(panel(force),/Check settings/);
 assert.match(panel(leave),/Card source/);assert.match(panel(leave),/Paste/);
 assert.doesNotMatch(panel(leave),/Check settings|Costs|Requirements|Inventory trigger|Use custom rules/);
 for(const placement of node.choices)assert.doesNotMatch(panel(placement),/duplicate-placement|remove-placement|move-placement/);

 const before=graphRows();
 assert.match(before,/data-lock-method="leave"/);
 assert.doesNotMatch(before,/data-lock-method="(?:lockpick|force)"/);
 field('placement','contextItemId','flashlight',lockpick.id);
 field('node','allowForcing',true);
 assert.match(nodeInspector(project,chapter,node),/Cost: 2 Energy/);
 assert.match(graphRows(),/Locked introduction/);
 assert.deepEqual([...graphRows().matchAll(/data-lock-method="([^"]+)"/g)].map(([,method])=>method),['lockpick','force','leave']);
 assert.deepEqual([...graphRows().matchAll(/data-exit="([^"]+)"/g)].map(([,exit])=>exit),['next']);

 for(const [action,data] of [['add-placement',{slot:'choices',kind:'action'}],['remove-placement',{}],['move-placement',{direction:1}],['duplicate-placement',{}]]){
  assert.throws(()=>command(action,lockpick.id,data));
 }
 assert.equal(cardDropSlot('container','action'),null);
 assert.equal(transferCard(project,chapter,{sourceNodeId:node.id,placementId:lockpick.id,targetNodeId:chapter.startNode,index:0}),null);

 definition(lockpick).check.difficulty=3;
 definition(force).check.difficulty=6;
 const beforeToggle=structuredClone(node.choices);
 field('node','locked',false);
 assert.doesNotMatch(graphRows(),/data-lock-method|Locked introduction/);
 assert.doesNotMatch(nodeInspector(project,chapter,node),/Allow forcing|Lock methods/);
 field('node','locked',true);
 assert.deepEqual(node.choices,beforeToggle);
 assert.equal(node.allowForcing,true);
 assert.equal(definition(lockpick).check.difficulty,3);
 assert.equal(definition(force).check.difficulty,6);
 command('clear-card',lockpick.id);
 assert.deepEqual(definition(lockpick).check,{mode:'stat',modifierVariable:'composure',difficulty:1});
 command('clear-card',force.id);
 assert.equal(force.lockMethod,'force');
 assert.equal(definition(force).costs[0].amount,2);
 assert.deepEqual(definition(force).check,{mode:'stat',modifierVariable:'agility',difficulty:4});
 assert.deepEqual(validateProject(project),[]);
});

test('shared lock sources keep local drafts and allow editing active rules over multiple saves',()=>{
 const {project,chapter,node,field,command,definition}=fixture();
 field('node','locked',true);
 const [lockpick,force,leave]=node.choices;
 const originalForce=definition(force),originalId=force.id;
 const shared=createDefinition('action','shared-force');project.library.push(shared);
 field('placement','definitionId',shared.id,force.id);
 assert.deepEqual(validateProject(project),[]);
 field('node','allowForcing',true);
 assert.ok(validateProject(project).some(issue=>/Force open requires a dice check/.test(issue.message)));
 assert.ok(validateProject(project).some(issue=>/Force open requires a positive Energy cost/.test(issue.message)));
 assert.doesNotThrow(()=>parseCurrentProject(JSON.stringify(project),{allowDraft:true}));
 field('placement','useCustomRules',true,force.id);
 field('placement','overrides.resolution','check',force.id);
 command('add-rule',force.id,{scope:'placement',path:'overrides.costs',ruleKind:'costs'});
 field('placement','overrides.costs.0.amount',3,force.id);
 field('placement','overrides.costs.0.hideBadge',true,force.id);
 assert.equal(resolvePlacement(project,force).costs[0].amount,3);
 assert.deepEqual(shared.costs,[]);assert.equal(shared.resolution,'direct');
 assert.deepEqual(validateProject(project),[]);
 field('placement','definitionId','local:action',force.id);
 assert.equal(force.id,originalId);assert.equal(force.lockMethod,'force');
 assert.deepEqual(definition(force),originalForce);

 field('placement','definitionId',shared.id,lockpick.id);
 assert.deepEqual(validateProject(project),[]);
 project.itemTags=[{id:'tools',name:'Tools'}];
 field('placement','contextItemId','tag:tools',lockpick.id);
 assert.ok(validateProject(project).some(issue=>issue.nodeId===node.id&&/Lockpick requires a dice check/.test(issue.message)));
 field('placement','useCustomRules',true,lockpick.id);
 field('placement','overrides.resolution','check',lockpick.id);
 assert.deepEqual(validateProject(project),[]);

 field('placement','definitionId',shared.id,leave.id);
 Object.assign(shared,{resolution:'check',costs:[{source:'variable',key:'energy',amount:5}]});
 const leavePanel=placementInspector(project,leave,'action',0,'choices',3,chapter,node);
 assert.match(leavePanel,/Go to definition/);
 assert.match(leavePanel,/data-card-preview/);
 assert.doesNotMatch(leavePanel,/Costs|Requirements|Check settings|Use custom rules|Inventory trigger|Dice resolution/);
 assert.deepEqual(validateProject(project),[]);
});

test('fixed roles survive compatible card paste, node duplication, and chapter packages',()=>{
 const {project,chapter,node,field,definition}=fixture();
 field('node','locked',true);
 const [lockpick,force]=node.choices;
 field('placement','contextItemId','flashlight',lockpick.id);
 const fork=chapter.nodes.find(node=>node.type==='fork'),forkChoice=fork.choices[0];
 const lockpickClipboard=captureCardClipboard(project,chapter.id,node.id,lockpick.id);
 const forceId=force.id;
 pasteCardClipboard(project,chapter,node,force,lockpickClipboard);
 assert.equal(force.id,forceId);assert.equal(force.lockMethod,'force');assert.equal(force.contextItemId,undefined);
 pasteCardClipboard(project,chapter,fork,forkChoice,lockpickClipboard);
 assert.equal(forkChoice.lockMethod,undefined);assert.equal(forkChoice.contextItemId,'flashlight');
 const forkClipboard=captureCardClipboard(project,chapter.id,fork.id,forkChoice.id);
 pasteCardClipboard(project,chapter,node,lockpick,forkClipboard);
 assert.equal(lockpick.lockMethod,'lockpick');assert.equal(lockpick.contextItemId,'flashlight');
 const duplicate=duplicateNode(project,node);chapter.nodes.push(duplicate);
 assert.deepEqual(duplicate.choices.map(choice=>choice.lockMethod),['lockpick','force','leave']);
 assert.notEqual(definition(duplicate.choices[1]).id,definition(force).id);
 const copied=pasteNodeClipboard(project,chapter,captureNodeClipboard(project,chapter.id,node.id));
 assert.deepEqual(copied.choices.map(choice=>choice.lockMethod),['lockpick','force','leave']);
 assert.notEqual(copied.choices[0].id,lockpick.id);
 synchronizeConnections(project);

 const base=createProject();
 const imported=importChapter(base,exportChapter(project,chapter.id));
 const importedChapter=imported.chapters.find(chapter=>chapter.id===imported.activeChapterId);
 const importedNode=importedChapter.nodes.find(node=>node.type==='container');
 assert.deepEqual(importedNode.choices.map(choice=>choice.lockMethod),['lockpick','force','leave']);
 assert.equal(importedNode.choices[0].contextItemId,'flashlight');
 assert.deepEqual(validateProject(imported),[]);
});

test('validation reports malformed lock slots and unsupported contexts without throwing',()=>{
 const {project,node,field}=fixture();
 field('node','locked',true);
 const errors=mutate=>{
  const copy=structuredClone(project),container=copy.chapters[0].nodes.find(beat=>beat.id===node.id);
  mutate(container,copy);
  return validateProject(copy).map(({message})=>message).join('\n');
 };
 assert.match(errors(node=>{ node.choices={}; }),/requires one Lockpick, one Force open, and one Leave/);
 assert.match(errors(node=>{ node.choices[0]=null; }),/requires one Lockpick, one Force open, and one Leave/);
 assert.match(errors(node=>{ node.choices[0].lockMethod='force'; }),/requires one Lockpick, one Force open, and one Leave/);
 assert.match(errors(node=>{ node.locked='true';node.allowForcing=1; }),/Locked requires[\s\S]*Allow forcing requires/);
 assert.match(errors(node=>{ node.choices[0].definitionId='flashlight'; }),/incompatible card kind/);
 assert.match(errors(node=>{ node.choices[0].contextItemId='unknown'; }),/inventory context/i);
 assert.match(errors(node=>{ node.choices[1].contextItemId='flashlight'; }),/inventory context/i);
 assert.match(errors(node=>{ node.items[0].lockMethod='leave'; }),/Invalid Container lock method placement/);
});

test('locking a Container without an Energy variable leaves optional Force unconfigured',()=>{
 const {project,chapter,node,field,definition}=fixture();
 project.variables=project.variables.filter(variable=>variable.id!=='energy');
 field('node','locked',true);
 const [lockpick,force]=node.choices;
 field('placement','contextItemId','flashlight',lockpick.id);
 assert.deepEqual(definition(force).costs,[]);
 assert.deepEqual(validateProject(project),[]);
 field('node','allowForcing',true);
 assert.match(nodeInspector(project,chapter,node),/Force open requires a numeric Energy variable/);
 assert.ok(validateProject(project).some(issue=>/Force open requires a positive Energy cost/.test(issue.message)));
 assert.ok(!project.variables.some(variable=>variable.id==='energy'));
});

test('Item sources author a positive whole-number Forcing bonus independently',()=>{
 const {project,chapter,node,field,command,definition}=fixture();
 const shared=definition(node.items[0]),consumable=createDefinition('consumable','energy-snack');
 project.library.push(consumable);
 assert.match(definitionInspector(project,shared),/Forcing bonus[\s\S]*data-scope="definition" data-path="forcingBonus"[\s\S]*min="1" step="1" value=""/);
 assert.doesNotMatch(definitionInspector(project,consumable),/Forcing bonus/);
 assert.throws(()=>field('definition','forcingBonus','4',consumable.id),/Item definition/);
 assert.throws(()=>field('placement','forcingBonus','4',node.items[0].id),/Item definition/);
 field('definition','forcingBonus','4',shared.id);
 assert.equal(shared.forcingBonus,4);
 command('local-copy',node.items[0].id);
 const local=definition(node.items[0]);
 const localPanel=placementInspector(project,node.items[0],'item',0,'items',1,chapter,node);
 assert.match(localPanel,/Forcing bonus[\s\S]*data-scope="local-definition" data-path="forcingBonus"[\s\S]*value="4"/);
 field('local-definition','forcingBonus','2',node.items[0].id);
 for(const invalid of ['0','-1','1.5',String(Number.MAX_SAFE_INTEGER+1)]){
  assert.throws(()=>field('local-definition','forcingBonus',invalid,node.items[0].id),/positive whole number/);
 }
 assert.equal(local.forcingBonus,2);assert.equal(shared.forcingBonus,4);
 field('local-definition','forcingBonus','',node.items[0].id);
 assert.equal(Object.hasOwn(local,'forcingBonus'),false);
 for(const invalid of [0,1.5,Infinity,'3']){
  local.forcingBonus=invalid;
  assert.ok(validateProject(project).some(issue=>/Forcing bonus/.test(issue.message)));
 }
 delete local.forcingBonus;
 consumable.forcingBonus=2;
 assert.ok(validateProject(project).some(issue=>/Forcing bonus/.test(issue.message)));
 delete consumable.forcingBonus;
 assert.deepEqual(validateProject(project),[]);
});

test('Force open selects an optional Item or tag and can disable bare-handed attempts',()=>{
 const {project,chapter,node,field,definition,graphRows}=fixture();
 project.itemTags=[{id:'pry-tools',name:'PryTool'}];
 field('node','locked',true);field('node','allowForcing',true);
 const [lockpick,force,leave]=node.choices;
 const panel=placement=>placementInspector(project,placement,'action',0,'choices',3,chapter,node);
 assert.match(panel(force),/Assist tool/);
 assert.match(panel(force),/value="flashlight"/);
 assert.match(panel(force),/value="tag:pry-tools"/);
 assert.match(panel(force),/data-path="allowBareHanded" checked[\s\S]*Allow bare-handed/);
 assert.doesNotMatch(panel(force),/Roll bonus/);
 assert.doesNotMatch(panel(lockpick),/Assist tool/);assert.doesNotMatch(panel(leave),/Assist tool/);
 assert.throws(()=>field('placement','assistTool.bonus','2',force.id),/Choose an Item or tag/);
 assert.throws(()=>field('placement','assistTool.key','flashlight',leave.id),/Force open placement/);
 assert.throws(()=>field('placement','allowBareHanded',false,leave.id),/Force open placement/);
 assert.throws(()=>field('placement','assistTool.key','arrival',force.id),/Choose an Item or tag/);

 const before=structuredClone(definition(force));
 assert.equal(libraryRemovalPlan(project,'flashlight').blocked,false);
 field('placement','allowBareHanded',false,force.id);
 assert.doesNotMatch(graphRows(),/data-lock-method="force"/);
 field('placement','assistTool.key','flashlight',force.id);
 assert.deepEqual(force.assistTool,{source:'inventory',key:'flashlight'});
 assert.match(graphRows(),/data-lock-method="force"/);
 assert.doesNotMatch(panel(force),/Roll bonus/);
 assert.match(panel(force),/Go to definition: Flashlight/);
 assert.equal(libraryRemovalPlan(project,'flashlight').blocked,true);
 field('placement','assistTool.key','tag:pry-tools',force.id);
 assert.deepEqual(force.assistTool,{source:'inventory',key:'tag:pry-tools'});
 assert.throws(()=>applyTagCommand(project,{operation:'remove',id:'pry-tools'}),/references before deleting/i);
 assert.deepEqual(definition(force),before);

 const shared={...before,id:'shared-force-assist',visibility:'shared'};delete shared.chapterId;
 project.library.push(shared);
 field('placement','definitionId',shared.id,force.id);
 field('placement','definitionId','local:action',force.id);
 field('node','allowForcing',false);
 assert.doesNotMatch(nodeInspector(project,chapter,node),/Assist tool/);
 field('node','allowForcing',true);
 assert.equal(force.assistTool.key,'tag:pry-tools');
 assert.equal(force.allowBareHanded,false);
 assert.deepEqual(validateProject(project),[]);
 field('placement','assistTool.key','',force.id);
 assert.equal(Object.hasOwn(force,'assistTool'),false);
 assert.doesNotMatch(graphRows(),/data-lock-method="force"/);
 assert.doesNotMatch(panel(force),/Roll bonus/);
 assert.doesNotThrow(()=>applyTagCommand(project,{operation:'remove',id:'pry-tools'}));
 Object.assign(definition(force),{resolution:'direct',costs:[]});
 assert.deepEqual(validateProject(project),[]);
 field('placement','allowBareHanded',true,force.id);
 assert.ok(validateProject(project).some(issue=>/Force open requires a dice check/.test(issue.message)));
});

test('Force open tool references follow clipboard and chapter ownership',()=>{
 const {project,chapter,node,field}=fixture();
 const tool={...createDefinition('item','pry-bar'),visibility:'local',chapterId:chapter.id,forcingBonus:3};
 project.library.push(tool);
 field('node','locked',true);field('node','allowForcing',true);
 const [,force,leave]=node.choices;
 field('placement','assistTool.key',tool.id,force.id);
 field('placement','allowBareHanded',false,force.id);
 assert.ok(!unusedLocalDefinitions(project).includes(tool));
 const cardClipboard=captureCardClipboard(project,chapter.id,node.id,force.id);
 assert.ok(cardClipboard.definitions.some(definition=>definition.id===tool.id));
 const count=project.library.length;
 pasteCardClipboard(project,chapter,node,leave,cardClipboard);
 assert.equal(leave.assistTool,undefined);
 assert.equal(leave.allowBareHanded,undefined);
 assert.equal(project.library.length,count+1);

 const other=createProjectChapter(project,'other','Other');project.chapters.push(other);
 const nodeClipboard=captureNodeClipboard(project,chapter.id,node.id);
 const copy=pasteNodeClipboard(project,other,nodeClipboard);other.startNode=copy.id;
 const [,copiedForce]=copy.choices;
 const copiedTool=project.library.find(definition=>definition.id===copiedForce.assistTool.key);
 assert.equal(copiedTool.chapterId,other.id);assert.notEqual(copiedTool.id,tool.id);
 assert.equal(copiedTool.forcingBonus,3);assert.equal(copiedForce.allowBareHanded,false);
 pasteCardClipboard(project,other,copy,copiedForce,cardClipboard);
 const pastedTool=project.library.find(definition=>definition.id===copiedForce.assistTool.key);
 assert.equal(pastedTool.chapterId,other.id);assert.notEqual(pastedTool.id,tool.id);
 assert.equal(pastedTool.forcingBonus,3);assert.equal(copiedForce.allowBareHanded,false);

 copiedForce.assistTool.key=tool.id;
 normalizeLocalOwnership(project);
 const normalizedTool=project.library.find(definition=>definition.id===copiedForce.assistTool.key);
 assert.equal(normalizedTool.chapterId,other.id);assert.notEqual(normalizedTool.id,tool.id);
 assert.deepEqual(validateProject(project),[]);
 const target=createProject();target.library.push({...tool,visibility:'shared',chapterId:undefined});
 const pkg=exportChapter(project,chapter.id);
 assert.ok(pkg.library.some(definition=>definition.id===tool.id));
 const imported=importChapter(target,pkg),importedChapter=imported.chapters.find(chapter=>chapter.id===imported.activeChapterId);
 const importedForce=importedChapter.nodes.find(node=>node.type==='container').choices[1];
 const importedTool=imported.library.find(definition=>definition.id===importedForce.assistTool.key);
 assert.equal(importedTool.chapterId,importedChapter.id);assert.notEqual(importedTool.id,tool.id);
 assert.equal(importedTool.forcingBonus,3);assert.equal(importedForce.allowBareHanded,false);
 assert.deepEqual(validateProject(imported),[]);
});

test('Force open validates role and reference, tolerates legacy bonuses, and preserves tags on import',()=>{
 const {project,chapter,node,field}=fixture();
 project.itemTags=[{id:'tools',name:'PryTool'}];
 field('node','locked',true);
 const [,force,leave]=node.choices;
 field('placement','assistTool.key','tag:tools',force.id);
 const valid=force.assistTool;
 for(const invalid of [null,[],{...valid,source:'variable'},{...valid,key:'tag:missing'},{...valid,key:'arrival'}]){
  force.assistTool=invalid;
  assert.ok(validateProject(project).some(issue=>issue.nodeId===node.id&&/Assist tool/.test(issue.message)));
 }
 force.assistTool=valid;
 leave.assistTool={...valid};
 assert.ok(validateProject(project).some(issue=>issue.nodeId===node.id&&/Assist tool/.test(issue.message)));
 delete leave.assistTool;
 leave.allowBareHanded=false;
 assert.ok(validateProject(project).some(issue=>issue.nodeId===node.id&&/Allow bare-handed/.test(issue.message)));
 delete leave.allowBareHanded;
 force.allowBareHanded='false';
 assert.ok(validateProject(project).some(issue=>issue.nodeId===node.id&&/Allow bare-handed/.test(issue.message)));
 delete force.allowBareHanded;
 force.assistTool={...valid,bonus:11};
 const parsed=parseCurrentProject(JSON.stringify(project));
 assert.deepEqual(validateProject(parsed),[]);
 assert.ok(!parsed.library.some(definition=>Object.hasOwn(definition,'forcingBonus')));
 force.assistTool=valid;

 const target=createProject();target.itemTags=[{id:'tools',name:'OtherTool'}];
 const imported=importChapter(target,exportChapter(project,chapter.id));
 const copied=imported.chapters.find(chapter=>chapter.id===imported.activeChapterId).nodes.find(node=>node.type==='container');
 const importedTag=imported.itemTags.find(tag=>tag.name==='PryTool');
 assert.notEqual(importedTag.id,'tools');
 assert.deepEqual(copied.choices[1].assistTool,{source:'inventory',key:`tag:${importedTag.id}`});
 assert.deepEqual(validateProject(imported),[]);
});
