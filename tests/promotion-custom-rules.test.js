import {restoreFixtureDefaults} from './fixtures/combat-project-support.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject, compileChapter, parseProject, validateProject, exportChapter, importChapter} from '../project/model.js';
import {createDefinition, resolvePlacement} from '../project/cards.js';
import {promoteCard} from '../studio/commands.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {nodeInspector} from '../studio/inspectors.js';
import {transact, initialValues} from '../project/state.js';

const localEffect={op:'set',key:'local-flag',value:true};
const mixedEffects=[{op:'set',key:'energy',value:1},localEffect,{op:'add',key:'energy',value:2}];
function fixture(kind='event') {
 const project=createProject(),chapter=project.chapters[0];
 chapter.variables=[{id:'local-flag',name:'Door open',type:'flag',initial:false},
  {id:'local-stat',name:'Local stat',type:'number',stat:true,min:1,max:10,initial:4}];
 const definition={...createDefinition(kind,'promoted'),visibility:'local',chapterId:chapter.id};
 project.library.push(definition);
 const placement={id:'placed',definitionId:definition.id};
 const node={id:'beat',name:'Beat',type:'linear',x:0,y:0,cards:[placement],connections:{next:null}};
 chapter.nodes=[node];chapter.startNode=node.id;restoreFixtureDefaults(project);
 return {project,chapter,definition,placement,node};
}
const mechanics=card=>Object.fromEntries(['conditions','effects','onCollect','costs','check','resolution','successEffects','failureEffects','value','permability'].filter(key=>card[key]!==undefined).map(key=>[key,card[key]]));

for(const kind of ['event','caption','action','item','health','energy'])test(`${kind} promotion preserves chapter behavior and makes a portable shared definition`,()=>{
 const {project,chapter,definition,placement,node}=fixture(kind);
 const field=['item','health','energy'].includes(kind)?'onCollect':'effects';
 definition[field]=structuredClone(mixedEffects);
 if(kind==='action') {
  definition.conditions=[{source:'variable',key:'local-flag',op:'eq',value:false}];
  definition.costs=[{source:'variable',key:'local-stat',amount:1}];
  definition.successEffects=[localEffect];definition.failureEffects=[localEffect];
 }
 const before=mechanics(resolvePlacement(project,placement));
 promoteCard(project,placement);
 assert.equal(definition.visibility,'shared');assert.equal(definition.chapterId,undefined);
 assert.deepEqual(definition[field],[mixedEffects[0],mixedEffects[2]]);
 assert.deepEqual(placement.overrides[field],mixedEffects);
 assert.deepEqual(mechanics(resolvePlacement(project,placement)),before);
 assert.deepEqual(validateProject(project),[]);
 const fresh={id:'new-instance',definitionId:definition.id};
 assert.ok(!JSON.stringify(mechanics(resolvePlacement(project,fresh))).includes('local-'));
 assert.match(nodeInspector(project,chapter,node),/Use custom rules/);
 const restored=parseProject(JSON.stringify(project));
 assert.deepEqual(mechanics(resolvePlacement(restored,restored.chapters[0].nodes[0].cards[0])),before);
 assert.deepEqual(validateProject(importChapter(createProject(),exportChapter(project))),[]);
 const compiled=compileChapter(project).nodes[0].cards[0];
 assert.deepEqual(compiled[field],before[field]);
 if(['health','energy'].includes(kind)) {
  assert.equal(compiled.onCollect.filter(effect=>effect.op==='add'&&effect.key===kind&&effect.value===definition.value).length,1,'automatic resource gain appears exactly once');
 } else if(kind==='event') {
  const variables=[...project.variables,...chapter.variables];
  const result=transact(initialValues(variables),[],{effects:compiled.effects},variables);
  assert.equal(result.variables.energy,3);assert.equal(result.variables['local-flag'],true);
 }
});

test('every reused placement keeps independent custom rules and placement additions',()=>{
 const {project,chapter,definition,placement,node}=fixture('action');
 definition.effects=structuredClone(mixedEffects);
 const second={id:'second',definitionId:definition.id,effects:[{op:'add',key:'energy',value:3}]};
 placement.effects=[{op:'add',key:'energy',value:1}];
 placement.overrides={effects:[{op:'add',key:'energy',value:99}]}; // ignored on local cards
 node.cards.push(second);
 const before=node.cards.map(card=>mechanics(resolvePlacement(project,card)));
 promoteCard(project,placement);
 assert.deepEqual(node.cards.map(card=>mechanics(resolvePlacement(project,card))),before);
 assert.notEqual(placement.overrides.effects,second.overrides.effects);
 const restored=parseProject(JSON.stringify(project));
 assert.deepEqual(restored.chapters[0].nodes[0].cards.map(card=>mechanics(resolvePlacement(restored,card))),before);
 assert.deepEqual(validateProject(project),[]);
 assert.equal(chapter.variables.length,2);
});

for(const mode of ['stat','custom'])test(`${mode} check with a chapter modifier stays on the original fork instance`,()=>{
 const {project,definition,placement,node}=fixture('action');
 definition.resolution='check';
 definition.check=mode==='stat'?{mode,modifierVariable:'local-stat',difficulty:2}
  :{mode,pool:[{sides:20,count:1}],modifier:2,target:10,modifierVariable:'local-stat'};
 node.type='fork';delete node.cards;node.choices=[placement];node.connections={'placed:success':null,'placed:failure':null};
 const before=mechanics(resolvePlacement(project,placement)),connections=structuredClone(node.connections);
 const history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const result=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{chapterId:project.activeChapterId,selected:node.id},'inspector',{command:'promote-card',placement:placement.id},drafts));
 assert.equal(result.failure,undefined);
 const promoted=history.document,p=promoted.chapters[0].nodes[0].choices[0];
 assert.deepEqual(mechanics(resolvePlacement(promoted,p)),before);
 assert.deepEqual(promoted.chapters[0].nodes[0].connections,connections);
 assert.deepEqual(validateProject(promoted),[]);
 assert.ok(!JSON.stringify(promoted.library.find(d=>d.id===definition.id)).includes('local-stat'));
 history.undo();assert.deepEqual(history.document,project);
 history.redo();assert.deepEqual(mechanics(resolvePlacement(history.document,history.document.chapters[0].nodes[0].choices[0])),before);
});

test('local dependency promotion preserves collection rules on existing item instances through a dependency cycle',()=>{
 const {project,definition,placement,node,chapter}=fixture('action');
 const item={...createDefinition('item','dependency'),visibility:'local',chapterId:chapter.id,onCollect:[localEffect,{op:'addItem',key:'dependency'}]};
 const itemPlacement={id:'item-instance',definitionId:item.id};
 const container={id:'box',name:'Box',type:'container',x:200,y:0,intro:{id:'box-intro',definitionId:'arrival'},introEnabled:false,items:[itemPlacement],connections:{next:null}};
 chapter.nodes.push(container);project.library.push(item);
 definition.effects=[{op:'addItem',key:item.id}];
 const before=mechanics(resolvePlacement(project,itemPlacement));
 promoteCard(project,placement);
 assert.equal(item.visibility,'shared');
 assert.deepEqual(item.onCollect,[{op:'addItem',key:item.id}]);
 assert.deepEqual(mechanics(resolvePlacement(project,itemPlacement)),before);
 assert.equal(node.cards[0].definitionId,definition.id);
 assert.deepEqual(validateProject(project),[]);
});

test('non-action chapter conditions move to placement appearance rules',()=>{
 const {project,definition,placement}=fixture('item');
 definition.conditions=[{source:'variable',key:'local-flag',op:'eq',value:false}];
 const before=mechanics(resolvePlacement(project,placement));
 promoteCard(project,placement);
 assert.deepEqual(definition.conditions,[]);
 assert.deepEqual(placement.conditions,before.conditions);
 assert.deepEqual(mechanics(resolvePlacement(project,placement)),before);
 assert.deepEqual(validateProject(project),[]);
});

test('accepted imported story costs and checks remain valid custom mechanics after promotion',()=>{
 const {project,definition,placement}=fixture();
 definition.costs=[{source:'variable',key:'local-stat',amount:1}];
 definition.resolution='check';definition.check={mode:'stat',modifierVariable:'local-stat',difficulty:2};
 definition.successEffects=[localEffect];definition.failureEffects=[localEffect];
 assert.deepEqual(validateProject(project),[]);
 const before=mechanics(resolvePlacement(project,placement));
 promoteCard(project,placement);
 assert.deepEqual(mechanics(resolvePlacement(project,placement)),before);
 assert.deepEqual(validateProject(project),[]);
 assert.deepEqual(definition.costs,[]);assert.equal(definition.resolution,'direct');
 const restored=parseProject(JSON.stringify(project));
 assert.deepEqual(mechanics(resolvePlacement(restored,restored.chapters[0].nodes[0].cards[0])),before);
 assert.deepEqual(validateProject(importChapter(createProject(),exportChapter(project))),[]);
});
