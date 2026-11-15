import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, validateProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {definitionInspector, nodeInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {DocumentHistory} from '../studio/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {transactDocument} from '../studio/document-session.js';

function fixture({shared=false,custom=false,kind='event'}={}){
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 const definition={...createDefinition(kind,'flag-story'),...(shared?{}:{visibility:'local',chapterId:chapter.id}),effects:[]};
 project.library.push(definition);
 const placement={id:'flag-placement',definitionId:definition.id};
 node.cards=[placement];
 if(custom)applyDocumentCommand(project,{chapterId:chapter.id,selected:node.id},'field',{scope:'placement',placementId:placement.id,path:'useCustomRules',checked:true});
 return {project,chapter,node,definition,placement,selection:{chapterId:chapter.id,selected:node.id,definitionId:definition.id},
  data:{command:'set-progression-flag',scope:custom?'placement':'definition',placement:placement.id,
   path:custom?'overrides.effects':'effects',name:'Visited security',variableScope:shared&&!custom?'global':'chapter',value:true}};
}
const run=(f,data={})=>applyDocumentCommand(f.project,f.selection,'inspector',{...f.data,...data});

for(const kind of ['event','caption','discovery'])test(`${kind}: creating a chapter flag and its progression effect is one undo step`,()=>{
 const f=fixture({kind}),history=new DocumentHistory(f.project),drafts=new LocalCardDrafts();
 const result=transactDocument(history,drafts,project=>applyDocumentCommand(project,f.selection,'inspector',f.data,drafts));
 assert.equal(result.failure,undefined);
 const flag=result.project.chapters[0].variables.find(v=>v.name==='Visited security');
 assert.equal(flag.type,'flag');assert.equal(flag.initial,false);
 assert.deepEqual(result.project.library.find(d=>d.id===f.definition.id).effects,[{op:'set',key:flag.id,value:true}]);
 assert.deepEqual(validateProject(result.project),[]);
 assert.equal(history.undo(),true);
 assert.deepEqual(history.document,f.project);
 history.redo();
 assert.deepEqual(history.document,result.project);
});

test('shared Library cards create only global flags',()=>{
 const f=fixture({shared:true});
 run(f);
 assert.equal(f.project.variables.at(-1).initial,false);
 assert.deepEqual(f.definition.effects,[{op:'set',key:f.project.variables.at(-1).id,value:true}]);
 assert.throws(()=>run(f,{variableScope:'chapter'}),/Chapter flags/);
 const html=definitionInspector(f.project,f.definition);
 assert.match(html,/data-flag-open/);
 assert.doesNotMatch(html,/<option value="chapter"/);
});

test('placement custom rules can create chapter flags without changing the shared source',()=>{
 const f=fixture({shared:true,custom:true});
 run(f);
 assert.deepEqual(f.definition.effects,[]);
 assert.equal(f.placement.overrides.effects[0].key,f.chapter.variables.at(-1).id);
 assert.match(nodeInspector(f.project,f.chapter,f.node),/data-effects-path="overrides.effects"/);
});

test('existing same-scope flags are reused and an existing effect is replaced',()=>{
 const f=fixture();f.chapter.variables=[{id:'known',name:'Visited security',type:'flag',initial:true}];
 f.definition.effects=[{op:'add',key:'energy',value:1}];
 run(f,{name:' visited SECURITY ',index:'0',value:false});
 assert.equal(f.chapter.variables.length,1);
 assert.equal(f.chapter.variables[0].initial,true);
 assert.deepEqual(f.definition.effects,[{op:'set',key:'known',value:false}]);
});

test('scope selection and ID collisions do not reuse unrelated variables',()=>{
 const f=fixture();f.project.variables.push({id:'visited_security',name:'Visited security',type:'flag',initial:false});
 run(f);
 assert.equal(f.chapter.variables.at(-1).id,'visited_security_2');
 run(f,{variableScope:'global',value:false});
 assert.deepEqual(f.definition.effects[1],{op:'set',key:'visited_security',value:false});
});

test('invalid input and stale targets leave the document untouched',()=>{
 for(const overrides of [{name:' '},{variableScope:'other'},{value:'true'},{index:'-1'},{index:'99'},{path:'onCollect'}]){
  const f=fixture(),before=structuredClone(f.project);
  assert.throws(()=>run(f,overrides));assert.deepEqual(f.project,before);
 }
 const f=fixture();f.chapter.variables=[{id:'counter',name:'Visited security',type:'number',initial:0}];
 const before=structuredClone(f.project);
 assert.throws(()=>run(f),/Number variable/);assert.deepEqual(f.project,before);
});

test('flag creation is offered for story effects and Action requirements',()=>{
 const f=fixture();f.definition.effects=[{op:'set',key:'energy',value:1}];
 const html=definitionInspector(f.project,f.definition);
 assert.match(html,/value="__create_progression_flag__"/);
 assert.match(html,/data-flag-draft hidden/);
 assert.match(html,/<option value="chapter" selected/);
 const action=createDefinition('action','no-flag');
 assert.match(definitionInspector(f.project,action),/data-effects-path="conditions"/);
 assert.doesNotMatch(definitionInspector(f.project,action),/data-effects-path="effects"/);
 const shared=fixture({shared:true});
 assert.throws(()=>run(shared,{scope:'placement',path:'overrides.effects'}),/editable/);
});

test('appearance flag creation always adds a condition atomically and preserves source rules',()=>{
 const f=fixture({shared:true}),history=new DocumentHistory(f.project),drafts=new LocalCardDrafts();
 const data={...f.data,scope:'placement',path:'conditions',variableScope:'chapter',value:false};
 const result=transactDocument(history,drafts,project=>applyDocumentCommand(project,f.selection,'inspector',data,drafts));
 assert.equal(result.failure,undefined);
 const flag=result.project.chapters[0].variables.find(v=>v.name===data.name);
 assert.equal(flag.initial,false);
 const placement=result.project.chapters[0].nodes[0].cards[0];
 assert.deepEqual(placement.conditions||[],[{source:'variable',op:'eq',key:flag.id,value:false}]);
 assert.deepEqual(result.project.library.find(d=>d.id===f.definition.id),f.definition);
 assert.deepEqual(validateProject(result.project),[]);
 assert.equal(history.undo(),true);assert.deepEqual(history.document,f.project);
 assert.equal(history.redo(),true);assert.deepEqual(history.document,result.project);
});

test('appearance flags reuse existing globals without changing their initial value',()=>{
 const f=fixture({shared:true});
 f.project.variables.push({id:'known',name:'Visited security',type:'flag',initial:true});
 run(f,{scope:'placement',path:'conditions',variableScope:'global'});
 assert.deepEqual(f.placement.conditions,[{source:'variable',op:'eq',key:'known',value:true}]);
 assert.equal(f.project.variables.at(-1).initial,true);
 const before=structuredClone(f.project);
 assert.throws(()=>run(f,{scope:'placement',path:'conditions',value:'yes'}));
 assert.deepEqual(f.project,before);
});

test('appearance panel always uses the created flag and progression footer puts create after add',()=>{
 const f=fixture({shared:true});
 const html=nodeInspector(f.project,f.chapter,f.node);
 assert.match(html,/data-effects-path="conditions"/);
 assert.doesNotMatch(html,/data-flag-use-condition|Use in these appearance conditions/);
 assert.match(html,/Create and add condition/);
 assert.match(html,/Required value/);
 const definition=definitionInspector(f.project,f.definition);
 assert.match(definition,/<div class="rule-footer-actions"><button[^>]*data-command="add-rule"[^>]*>Add effect<\/button><button[^>]*data-flag-open>/);
});


for(const shared of [true,false])test(`Action requirements create a scoped flag and condition (shared=${shared})`,()=>{
 const f=fixture({kind:'action',shared});
 run(f,{path:'conditions',value:false});
 const flag=(shared?f.project.variables:f.chapter.variables).at(-1);
 assert.deepEqual(f.definition.conditions,[{source:'variable',op:'eq',key:flag.id,value:false}]);
 assert.equal(flag.initial,false);
 const html=definitionInspector(f.project,f.definition);
 assert.match(html,/The action is available only when the flag is True/);
 assert.doesNotMatch(html,/The card appears only when the flag/);
 assert.deepEqual(validateProject(f.project),[]);
});

test('shared placement custom Requirements create chapter flags without changing source',()=>{
 const f=fixture({kind:'action',shared:true,custom:true});
 run(f,{path:'overrides.conditions'});
 const flag=f.chapter.variables.at(-1);
 assert.deepEqual(f.definition.conditions,[]);
 assert.deepEqual(f.placement.overrides.conditions,[{source:'variable',op:'eq',key:flag.id,value:true}]);
 assert.match(nodeInspector(f.project,f.chapter,f.node),/data-effects-path="overrides.conditions"/);
});

test('Combat victory flag creation is one undo step and has its own editor',()=>{
 const f=fixture(),drafts=new LocalCardDrafts();
 f.node.type='combat';f.node.enemy={definitionId:''};delete f.node.cards;f.node.connections={victory:false};
 const initial=structuredClone(f.project),combatHistory=new DocumentHistory(initial);
 const data={...f.data,scope:'node',path:'victoryEffects'};
 const result=transactDocument(combatHistory,drafts,project=>applyDocumentCommand(project,f.selection,'inspector',data,drafts));
 assert.equal(result.failure,undefined);
 const flag=result.project.chapters[0].variables.at(-1);
 assert.deepEqual(result.project.chapters[0].nodes[0].victoryEffects,[{op:'set',key:flag.id,value:true}]);
 assert.deepEqual(validateProject(result.project),[]);
 assert.equal(combatHistory.undo(),true);assert.deepEqual(combatHistory.document,initial);
 assert.equal(combatHistory.redo(),true);assert.deepEqual(combatHistory.document,result.project);
 const html=nodeInspector(result.project,result.project.chapters[0],result.project.chapters[0].nodes[0]);
 assert.match(html,/On victory effects/);assert.match(html,/Set on victory/);
 assert.match(html,/Becomes True when this combat is won/);
 assert.match(html,/data-effects-path="victoryEffects"/);
});

for(const embedded of [false,true])test(`local Combat Action Requirements create Chapter flags (embedded=${embedded})`,()=>{
 const f=fixture({kind:'combatAction'}),action=f.definition;
 f.node.cards=[];
 let path='conditions';
 if(embedded){
  const weapon={...createDefinition('item','local-weapon'),visibility:'local',chapterId:f.chapter.id,subtype:'weapon',combat:{damage:{min:1,max:2},effects:[],actions:[action]}};
  f.project.library=f.project.library.filter(d=>d!==action);f.project.library.push(weapon);
  f.selection.definitionId=weapon.id;f.placement.definitionId=weapon.id;f.definition=weapon;
  path='combat.actions.0.conditions';
 }
 const html=definitionInspector(f.project,f.definition);
 assert.match(html,/<option value="chapter" selected/);
 run(f,{path});
 const flag=f.chapter.variables.at(-1);
 assert.deepEqual(action.conditions,[{source:'variable',op:'eq',key:flag.id,value:true}]);
 assert.deepEqual(validateProject(f.project),[]);
});
