import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createEnemy,createCombatAction,validateProject} from '../project/model.js';
import {combatDefinitionFields,combatActionTypeField,preparedActionChoices} from '../studio/combat-authoring.js';
import {commonLibraryGroups,commonLibrary} from '../studio/common-library.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
function fixture(){
 const project=createProject(),enemy=createEnemy('enemy');enemy.mechanics='opposed-preparation';
 enemy.actions=[{...createCombatAction('prepare'),type:'prepare',resolution:'direct',preparedActions:[]}];project.library.push(enemy);
 const selection={chapterId:project.chapters[0].id,definitionId:enemy.id};
 const command=(factory,extra={})=>applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-add',path:'actions.0.preparedActions',factory,...extra});
 const field=(path,value,inputType='text',extra={})=>applyDocumentCommand(project,selection,'field',{scope:'definition',path,value,inputType,...extra});
 return {project,enemy,selection,command,field};
}
test('prepared selection creation is reusable, ordered, weighted and never adds player defaults',()=>{
 const {project,enemy,selection,command,field}=fixture(),defaults=structuredClone(project.combat.defaultActions),libraryIds=project.library.map(d=>d.id);
 for(const factory of ['prepared-dodge','prepared-attack','prepared-wait'])command(factory);
 const refs=enemy.actions[0].preparedActions;
 assert.equal(refs.length,3);assert.deepEqual(project.library.map(d=>d.id),libraryIds);assert.deepEqual(project.combat.defaultActions,defaults);assert.deepEqual(validateProject(project),[]);
 assert.deepEqual(refs.map(ref=>ref.trigger),['incoming-hit','after-player-action','after-player-action']);
 for(const ref of refs){const d=enemy.preparedActions.find(d=>d.id===ref.actionId);assert.equal(d.cooldown,0);assert.deepEqual(d.conditions,[]);assert.deepEqual(d.costs,[]);}
 field('actions.0.preparedActions.0.weight','3','number');assert.equal(refs[0].weight,3);
 for(const value of ['0','-1','1.5',''])assert.throws(()=>field('actions.0.preparedActions.0.weight',value,'number'),/positive integer/);
 const id=refs[0].actionId;
 applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-move',path:'actions.0.preparedActions',index:0,direction:1});assert.equal(refs[1].actionId,id);
 applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-remove',path:'actions.0.preparedActions',index:1});assert.equal(refs.length,2);
});
test('prepared choices constrain trigger capabilities and fallbacks use explicit player action types',()=>{
 const {project,enemy,command,field}=fixture();for(const factory of ['prepared-dodge','prepared-attack','prepared-wait'])command(factory);
 const [dodge,attack,wait]=enemy.actions[0].preparedActions;
 const numeric={...createCombatAction('numeric'),type:'defend',protection:'numeric',damageReduction:2};project.library.push(numeric);
 assert.deepEqual(preparedActionChoices(enemy,'incoming-hit').map(d=>d.id),[dodge.actionId]);
 assert(preparedActionChoices(enemy,'after-player-action').some(d=>d.id===attack.actionId));
 assert.deepEqual(preparedActionChoices(enemy,'fallback').map(d=>d.id),[wait.actionId]);
 const prefix='actions.0.preparedActions.0.fallback';field(`${prefix}.actionId`,wait.actionId);
 assert.deepEqual(dodge.fallback.when,['defend','wait']);
 field(`${prefix}.when.prepare`,'','checkbox',{checked:true});field(`${prefix}.when.defend`,'','checkbox',{checked:false});
 assert.deepEqual(dodge.fallback.when,['wait','prepare']);
 assert.throws(()=>field(`${prefix}.when.attack`,'','checkbox',{checked:true}),/Fallbacks require/);
 const html=combatDefinitionFields(project,enemy);
 for(const type of ['defend','wait','prepare'])assert(html.includes(`data-path="${prefix}.when.${type}"`));
 assert(!html.includes(`data-path="${prefix}.when.attack"`));
 assert(!html.includes('data-path="actions.0.preparedActions.1.fallback.actionId"'));
 assert(!html.includes(`data-definition="${dodge.actionId}"`));assert(html.includes('data-path="preparedActions.0.name"'));
 field('actions.0.preparedActions.0.trigger','after-player-action');assert.equal(dodge.fallback,undefined);
 assert.throws(()=>field(`${prefix}.actionId`,wait.actionId),/Fallbacks require/);
 field('actions.0.preparedActions.0.trigger','incoming-hit');field(`${prefix}.actionId`,wait.actionId);
 field(`${prefix}.actionId`,'');assert.equal(dodge.fallback,undefined);
 const definition=enemy.preparedActions.find(d=>d.id===attack.actionId);definition.costs=[{key:'energy',amount:1}];assert(!preparedActionChoices(enemy,'after-player-action').includes(definition));
});
test('owned actions expose complete editors while shared combat actions keep player rules',()=>{
 const {project,enemy,command,field}=fixture();for(const factory of ['prepared-dodge','prepared-attack','prepared-wait'])command(factory);
 for(const action of enemy.preparedActions)if(action.type!=='wait')action.resolution='check';
 const html=combatDefinitionFields(project,enemy);
 for(const [i,action] of enemy.preparedActions.entries()){
  const prefix=`preparedActions.${i}.`;
  for(const path of ['name','type','text','effects','presentationKind','image','imageScale'])assert(html.includes(`data-path="${prefix}${path}"`),prefix+path);
  for(const path of ['successEffects','failureEffects','check.mode'])assert.equal(html.includes(`data-path="${prefix}${path}"`),action.type!=='wait');
  for(const path of ['conditions','costs','cooldown'])assert(!html.includes(`data-path="${prefix}${path}"`));
 }
 assert(html.includes('Enemy preparation requires no costs/requirements and zero cooldown.'));
 const player={...createCombatAction('player-prepare'),type:'prepare'},playerHtml=combatDefinitionFields(project,player);
 for(const path of ['preparationBonus','costs','conditions','cooldown'])assert(playerHtml.includes(`data-path="${path}"`));
 assert(!playerHtml.includes('preparedActions'));
 enemy.actions[0].type='attack';delete enemy.actions[0].preparedActions;field('actions.0.type','prepare');assert.deepEqual(enemy.actions[0].preparedActions,[]);
 assert(!combatActionTypeField(player).includes('<option value="wait"'));
 field('preparedActions.0.presentationKind','caption');const captionHtml=combatDefinitionFields(project,enemy);assert(!captionHtml.includes('data-path="preparedActions.0.image"'));assert(!captionHtml.includes('data-path="preparedActions.0.imageScale"'));
 field('preparedActions.0.protection','numeric');assert.equal(enemy.preparedActions[0].protection,undefined);assert.equal(enemy.preparedActions[0].resolution,'direct');
});
test('Common contains no embedded Enemy actions and no enemy-only grouping',()=>{
 const {project,enemy,command,field}=fixture();command('prepared-dodge');command('prepared-wait');
 const refs=enemy.actions[0].preparedActions;field('actions.0.preparedActions.0.fallback.actionId',refs[1].actionId);
 const groups=commonLibraryGroups(project);assert.equal(groups.enemyPrepared,undefined);
 assert(!groups.unassigned.some(d=>enemy.preparedActions.some(action=>action.id===d.id)));
 assert(!commonLibrary(project).includes('Enemy prepared actions'));
});
test('deleting an owned action removes selections and fallbacks across Prepare actions in one undoable edit',()=>{
 const {project,enemy,selection,command,field}=fixture();command('prepared-dodge');command('prepared-wait');command('prepared-attack');
 const wait=enemy.preparedActions.find(a=>a.type==='wait');
 field('actions.0.preparedActions.0.fallback.actionId',wait.id);
 enemy.actions.push({...structuredClone(enemy.actions[0]),id:'second-prepare'});
 const unrelated=structuredClone(enemy.actions[0].preparedActions.filter(ref=>ref.actionId!==wait.id).map(ref=>{delete ref.fallback;return ref;}));
 const before=structuredClone(project),history=new DocumentHistory(project);
 history.transact(draft=>applyDocumentCommand(draft,selection,'inspector',{scope:'definition',command:'combat-remove',path:'preparedActions',index:1}));
 const changed=history.document.library.find(d=>d.id===enemy.id);
 assert(!changed.preparedActions.some(action=>action.id===wait.id));
 for(const prepare of changed.actions)assert.deepEqual(prepare.preparedActions,unrelated);
 assert.deepEqual(validateProject(history.document),[]);
 history.undo();assert.deepEqual(history.document,before);history.redo();assert.equal(history.document.library.find(d=>d.id===enemy.id).preparedActions.length,2);
 const html=combatDefinitionFields(project,enemy);assert(!html.includes('Remove Prepare and fallback references before deleting'));
 assert(!/aria-label="Remove prepared action"[^>]*disabled/.test(html));
});
test('deleting the last owned choice leaves Prepare empty without changing its type or dangling references',()=>{
 const {project,enemy,selection,command}=fixture();command('prepared-wait');
 applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-remove',path:'preparedActions',index:0});
 assert.deepEqual(enemy.preparedActions,[]);assert.deepEqual(enemy.actions[0].preparedActions,[]);assert.equal(enemy.actions[0].type,'prepare');
});
test('picker and commands reject another Enemy and shared actions',()=>{
 const {project,enemy,command,field}=fixture();command('prepared-wait');
 const other=createEnemy('other');other.preparedActions=[{...createCombatAction('foreign'),type:'wait',resolution:'direct'}];project.library.push(other);
 assert(!preparedActionChoices(enemy,'after-player-action').some(action=>action.id==='foreign'));
 assert.throws(()=>field('actions.0.preparedActions.0.actionId','foreign'),/owned by this Enemy/);
 command('prepared-dodge');assert.throws(()=>field('actions.0.preparedActions.1.fallback.actionId','foreign'),/owned Wait/);
});

for(const type of ['attack','defend','wait'])test(`leaving Enemy Prepare for ${type} removes selection data and undo restores it`,()=>{
 const {project,enemy,selection,command}=fixture();command('prepared-dodge');
 const prepared=structuredClone(enemy.actions[0]);
 // Keep another Prepare available so this isolates type switching from the enemy's legacy-card requirement.
 enemy.actions.push({...structuredClone(prepared),id:'other-prepare'});
 assert.deepEqual(validateProject(project),[]);
 const history=new DocumentHistory(project);
 history.transact(draft=>{applyDocumentCommand(draft,selection,'field',{scope:'definition',path:'actions.0.type',value:type,inputType:'text'});});
 const changed=history.document.library.find(d=>d.id===enemy.id).actions[0];
 assert.equal(changed.type,type);assert.equal(Object.hasOwn(changed,'preparedActions'),false);
 assert.deepEqual(validateProject(history.document),[]);
 history.undo();assert.deepEqual(history.document.library.find(d=>d.id===enemy.id).actions[0],prepared);
 history.redo();assert.equal(Object.hasOwn(history.document.library.find(d=>d.id===enemy.id).actions[0],'preparedActions'),false);
});

test('changing a migrated owned Wait to Attack initializes damage and preserves later authored profiles',()=>{
 const {project,enemy,command,field}=fixture();command('prepared-wait');
 const action=enemy.preparedActions[0];delete action.attack; // Legacy Skip cards had no attack profile.
 field('preparedActions.0.type','attack');
 assert.deepEqual(action.attack,{source:'self',damage:{min:1,max:1},minBonus:0,maxBonus:0});
 assert(preparedActionChoices(enemy,'after-player-action').includes(action));assert.deepEqual(validateProject(project),[]);
 action.attack.damage={min:4,max:5};field('preparedActions.0.type','wait');field('preparedActions.0.type','attack');
 assert.deepEqual(action.attack.damage,{min:4,max:5});
});

for(const answer of [false,true])test(`prepared action removal confirmation ${answer?'accepts one edit':'cancels without side effects'}`,()=>{
 const {project,enemy}=fixture();enemy.preparedActions=[{id:'wait',name:'Wait'}];
 const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8'),start=source.indexOf('function command(event){'),end=source.indexOf('for(const root of',start),calls=[];
 const context={scopeRoot:()=>enemy,confirm:message=>{calls.push(['confirm',message]);return answer;},preview:{stop:()=>calls.push(['stop'])},edit:(type,data)=>{calls.push(['edit',type,{...data}]);return {ok:true};},report:message=>calls.push(['report',message])};
 runInNewContext(source.slice(start,end),context);
 context.command({target:{closest:()=>({dataset:{command:'combat-remove',scope:'definition',path:'preparedActions',index:'0'}})}});
 assert.deepEqual(calls.map(call=>call[0]),answer?['confirm','stop','edit','report']:['confirm']);
 assert.match(calls[0][1],/Delete “Wait”/);assert.match(calls[0][1],/fallback references/);assert.match(calls[0][1],/Undo restores/);
 if(answer)assert.equal(calls[2][2].path,'preparedActions');
});

test('all fallback checkboxes can be disabled and saved without losing the selected Wait action',async()=>{
 const {project,enemy,command,field}=fixture();command('prepared-dodge');command('prepared-wait');
 const refs=enemy.actions[0].preparedActions,id=refs[1].actionId,prefix='actions.0.preparedActions.0.fallback';
 field(`${prefix}.actionId`,id);
 for(const type of ['defend','wait','prepare'])field(`${prefix}.when.${type}`,'','checkbox',{checked:false});
 assert.deepEqual(refs[0].fallback,{actionId:id,when:[]});assert.deepEqual(validateProject(project),[]);
 assert(combatDefinitionFields(project,enemy).includes('This fallback is disabled.'));
 const {saveProject,loadProject}=await import('../project/storage.js');
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 assert.deepEqual(saveProject(project,storage),{ok:true});
 const loaded=loadProject(storage).project;assert.deepEqual(loaded.library.find(d=>d.id===enemy.id).actions[0].preparedActions[0].fallback,{actionId:id,when:[]});
 field(`${prefix}.when.prepare`,'','checkbox',{checked:true});assert.deepEqual(refs[0].fallback,{actionId:id,when:['prepare']});assert.deepEqual(validateProject(project),[]);
});

test('create actions first, then add choices with Action before editable Trigger',()=>{
 const {project,enemy,selection,field}=fixture(),defaults=structuredClone(project.combat.defaultActions);
 const create=factory=>applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-add',path:'preparedActions',factory});
 for(const factory of ['prepared-dodge','prepared-attack','prepared-wait'])create(factory);
 assert.equal(enemy.preparedActions.length,3);assert.deepEqual(enemy.actions[0].preparedActions,[]);assert.deepEqual(project.combat.defaultActions,defaults);
 applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-add',path:'actions.0.preparedActions',factory:'prepared-reference'});
 const ref=enemy.actions[0].preparedActions[0],defense=enemy.preparedActions.find(a=>a.type==='defend'),attack=enemy.preparedActions.find(a=>a.type==='attack'),wait=enemy.preparedActions.find(a=>a.type==='wait');
 assert.equal(ref.actionId,'');assert.equal(enemy.preparedActions.length,3);
 const p='actions.0.preparedActions.0';field(`${p}.actionId`,attack.id);assert.equal(ref.trigger,'after-player-action');
 field(`${p}.actionId`,defense.id);assert.equal(ref.trigger,'incoming-hit');field(`${p}.fallback.actionId`,wait.id);
 field(`${p}.trigger`,'incoming-hit');assert.equal(ref.actionId,defense.id);assert.equal(ref.fallback.actionId,wait.id);
 const html=combatDefinitionFields(project,enemy);
 assert(html.indexOf('<h3>Prepared actions</h3>')>html.indexOf('<h3>Combat Actions</h3>'));
 assert(html.indexOf(`data-path="${p}.actionId"`)<html.indexOf(`data-path="${p}.trigger"`));
 assert(html.includes('Add choice'));assert(!html.includes('+ prepared action'));assert(!html.includes('Choose an owned prepared action'));
 const choices=html.slice(html.indexOf('<h4>What can this enemy prepare?</h4>'),html.indexOf('<h3>Prepared actions</h3>'));
 assert(!choices.includes('data-factory="prepared-dodge"'));assert(!choices.includes('data-factory="prepared-attack"'));assert(!choices.includes('data-factory="prepared-wait"'));
 assert.deepEqual(validateProject(project),[]);
 field(`${p}.trigger`,'after-player-action');assert.equal(ref.actionId,'');assert.equal(ref.fallback,undefined);
 field(`${p}.actionId`,wait.id);assert.equal(ref.trigger,'after-player-action');assert.deepEqual(validateProject(project),[]);
});

test('owned type edits keep primary timings compatible and remove obsolete Wait responses',()=>{
 const {project,enemy,field,command}=fixture();command('prepared-dodge');command('prepared-wait');
 const refs=enemy.actions[0].preparedActions,wait=enemy.preparedActions[1];
 field('actions.0.preparedActions.0.fallback.actionId',wait.id);
 field('preparedActions.1.type','attack');assert(!refs[0].fallback);assert.equal(refs[1].trigger,'after-player-action');
 field('preparedActions.1.type','defend');assert.equal(wait.protection,'all');assert.equal(refs[1].trigger,'incoming-hit');assert.deepEqual(validateProject(project),[]);
 field('preparedActions.1.protection','numeric');assert.equal(refs[1].actionId,'');assert.equal(refs[1].fallback,undefined);
 assert.deepEqual(validateProject(project,{allowDraft:true}),[]);assert(validateProject(project).some(e=>e.message.includes('expected owned prepared Action')));
});

test('an empty choice or Prepare saves as a draft while playback still requires a complete selection',async()=>{
 const {project,enemy,selection}=fixture(),{saveProject,loadProject}=await import('../project/storage.js');
 const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 assert.deepEqual(saveProject(project,storage),{ok:true});assert(validateProject(project).length>0);
 applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-add',path:'actions.0.preparedActions',factory:'prepared-reference'});
 assert.deepEqual(saveProject(project,storage),{ok:true});assert.deepEqual(validateProject(project,{allowDraft:true}),[]);assert(validateProject(project).length>0);
 assert.equal(loadProject(storage).project.library.find(d=>d.id===enemy.id).actions[0].preparedActions[0].actionId,'');
});

test('one Prepared Action button creates an editable Attack without assigning it to Prepare',()=>{
 const {project,enemy,selection,field}=fixture();
 applyDocumentCommand(project,selection,'inspector',{scope:'definition',command:'combat-add',path:'preparedActions',factory:'prepared-action'});
 assert.equal(enemy.preparedActions.length,1);const action=enemy.preparedActions[0];assert.equal(action.type,'attack');assert.equal(action.name,'Prepared Action');
 assert.deepEqual(enemy.actions[0].preparedActions,[]);
 const html=combatDefinitionFields(project,enemy);
 assert(html.includes('>Add prepared action</button>'));for(const text of ['+ New defense','+ New attack','+ New wait'])assert(!html.includes(text));
 assert(html.indexOf('<h3>Combat Actions</h3>')<html.indexOf('<h3>Prepared actions</h3>'));
 field('preparedActions.0.type','defend');assert.equal(action.type,'defend');assert.equal(action.protection,'all');field('preparedActions.0.type','wait');assert.equal(action.type,'wait');
});

test('adding a Prepared Action opens and reveals its new editor',()=>{
 const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8'),start=source.indexOf('function command(event){'),end=source.indexOf('for(const root of',start),calls=[];
 const inspector={},context={edit:(type,data)=>{calls.push(['edit',type,{...data}]);return {ok:true};},definition:()=>({preparedActions:[{id:'old'},{id:'new'}]}),$:()=>inspector,revealCardEntry:(root,target)=>calls.push(['reveal',root,{...target}])};
 runInNewContext(source.slice(start,end),context);
 context.command({target:{closest:()=>({dataset:{command:'combat-add',scope:'definition',path:'preparedActions',factory:'prepared-action'}})}});
 assert.deepEqual(calls.map(call=>call[0]),['edit','reveal']);assert.equal(calls[1][1],inspector);assert.equal(calls[1][2].definitionPath,'preparedActions.1');
});
