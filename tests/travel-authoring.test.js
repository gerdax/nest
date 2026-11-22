import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {createNode, findPlacement, placements} from '../studio/commands.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {nodeInspector} from '../studio/inspectors.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {DocumentHistory} from '../studio/DocumentHistory.js';
import {transactDocument} from '../studio/document-session.js';
import {sourceCard} from '../studio/card-navigation.js';
import {previewCardTarget} from '../studio/preview-card-target.js';
import {captureCardClipboard, canPasteCard, pasteCardClipboard} from '../studio/card-clipboard.js';
import {transferCard} from '../studio/card-transfer.js';
import {GraphView} from '../studio/GraphView.js';

function fixture(){
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'randomizer',undefined,chapter.id);
 chapter.nodes.push(node);
 const selection={chapterId:chapter.id,selected:node.id},drafts=new LocalCardDrafts();
 drafts.setContext(chapter.id,node.id);
 const edit=(type,data)=>applyDocumentCommand(project,selection,type,data,drafts);
 const field=(path,value)=>edit('field',{scope:'node',path,value,inputType:'number'});
 const enable=checked=>edit('field',{scope:'node',path:'travel.enabled',checked,inputType:'checkbox'});
 const add=kind=>edit('inspector',{command:'add-placement',slot:'travel.steps',kind});
 return {project,chapter,node,selection,drafts,edit,field,enable,add};
}

test('Travel is opt-in and retains its configuration and ordinary Auto settings when disabled',()=>{
 const f=fixture(),{project,chapter,node,enable,field,add}=f;
 assert.equal(node.travel,undefined);
 assert.match(nodeInspector(project,chapter,node),/data-path="travel.enabled"/);
 assert.doesNotMatch(nodeInspector(project,chapter,node),/data-path="travel.enabled" checked/);
 field('drawCount','3');field('noneWeight','7');enable(true);
 assert.deepEqual(node.travel,{enabled:true,minSteps:2,maxSteps:4,eventCount:2,steps:[]});
 assert.doesNotMatch(nodeInspector(project,chapter,node),/data-path="travel.randomizeStepCards"[^>]*checked/);
 assert.doesNotMatch(nodeInspector(project,chapter,node),/When off, follow the list order/);
 f.edit('field',{scope:'node',path:'travel.randomizeStepCards',checked:true,inputType:'checkbox'});
 assert.match(nodeInspector(project,chapter,node),/data-path="travel.randomizeStepCards"[^>]*checked/);
 f.edit('field',{scope:'node',path:'travel.randomizeStepCards',checked:false,inputType:'checkbox'});
 add('event');field('travel.minSteps','3');field('travel.maxSteps','5');field('travel.eventCount','0');
 f.edit('field',{scope:'node',path:'travel.firstStepCaption',value:'You move on',inputType:'text'});
 const config=structuredClone(node.travel);
 const html=nodeInspector(project,chapter,node);
 const sceneDivider=/<hr class="connections-divider"><h3>Scene selection<\/h3>/;
 assert.match(html,sceneDivider);
 assert.match(html,/Min Steps per segment/);assert.match(html,/Max Steps per segment/);assert.match(html,/Event count/);
 assert.match(html,/First step caption \(optional\)/);assert.match(html,/data-path="travel.firstStepCaption"[^>]+value="You move on"/);
 assert.match(html,/Randomize step cards/);assert.doesNotMatch(html,/data-path="travel.randomizeStepCards"[^>]*checked/);
 assert.deepEqual([...html.matchAll(/data-path="travel\.([^"]+)"/g)].map(([,key])=>key),
  ['eventCount','enabled','minSteps','maxSteps','firstStepCaption','randomizeStepCards']);
 assert.match(html,/<h3>Step cards<\/h3><p class="small">Choose Vignette or Caption cards[^<]+<\/p>/);
 const randomize=html.indexOf('data-path="travel.randomizeStepCards"');
 for(const kind of ['event','caption']){
  const addButton=html.indexOf(`data-slot="travel.steps" data-kind="${kind}"`);
  assert(addButton>=0&&addButton<randomize,`Add ${kind} button should precede Randomize step cards`);
 }
 assert.doesNotMatch(html,/data-path="drawCount"|data-path="noneWeight"/);
 enable(false);
 assert.deepEqual(node.travel,{...config,enabled:false});
 const disabledHtml=nodeInspector(project,chapter,node);
 assert.match(disabledHtml,sceneDivider);
 assert.doesNotMatch(disabledHtml,/data-path="travel\.eventCount"/);
 assert.match(disabledHtml,/data-path="drawCount"[^>]+value="3"/);
 assert.match(disabledHtml,/data-path="noneWeight"[^>]+value="7"/);
 enable(true);assert.deepEqual(node.travel,config);
 assert.equal(node.cards,undefined);
});

test('Travel counts reject fractions, out-of-range values and inverted bounds without changing settings',()=>{
 const {node,enable,field}=fixture();enable(true);
 for(const path of ['travel.minSteps','travel.maxSteps','travel.eventCount']){
  for(const value of ['-1','2.5','101','Infinity']){
   const before=structuredClone(node.travel);
   assert.throws(()=>field(path,value),/whole number/);assert.deepEqual(node.travel,before);
  }
 }
 assert.throws(()=>field('travel.minSteps','5'),/Minimum steps/);
 assert.throws(()=>field('travel.maxSteps','1'),/Minimum steps/);
 assert.throws(()=>field('travel.minSteps','0'),/whole number/);
 field('travel.minSteps','1');field('travel.maxSteps','100');field('travel.eventCount','100');
 assert.equal(node.travel.eventCount,100);
});

test('Travel step placements use existing source, conditions, custom progression and local card editing flows',()=>{
 const f=fixture(),{project,chapter,node,edit,enable,add}=f;
 enable(true);add('event');const p=node.travel.steps[0];
 const local=project.library.find(d=>d.id===p.definitionId);
 assert.equal(local.visibility,'local');assert.equal(local.chapterId,chapter.id);
 assert.equal(findPlacement(node,p.id),p);assert.ok(placements(node).includes(p));
 edit('inspector',{command:'add-rule',scope:'placement',placement:p.id,path:'conditions',ruleKind:'conditions'});
 assert.equal(p.conditions.length,1);
 edit('field',{scope:'local-definition',placementId:p.id,path:'headline',value:'Long road'});
 assert.equal(local.headline,'Long road');
 project.library.push({...createDefinition('caption','shared-step'),visibility:'shared'},createDefinition('action','not-a-step'));
 const source=value=>edit('field',{scope:'placement',placementId:p.id,path:'definitionId',value});
 source('shared-step');assert.equal(p.definitionId,'shared-step');
 edit('field',{scope:'placement',placementId:p.id,path:'useCustomRules',inputType:'checkbox',checked:true});
 edit('inspector',{command:'add-rule',scope:'placement',placement:p.id,path:'overrides.effects',ruleKind:'effects'});
 assert.equal(p.overrides.effects.length,1);
 assert.match(nodeInspector(project,chapter,node),/Card source[\s\S]*local:caption/);
 assert.throws(()=>source('not-a-step'),/same type/);
 assert.throws(()=>source('local:action'),/allowed in this beat/);
 source('local:event');assert.equal(project.library.find(d=>d.id===p.definitionId).headline,'Long road');
 assert.throws(()=>add('item'),/allowed in this beat/);
});

test('Travel step add, duplicate, reorder, remove and enable are atomic history edits with local ownership intact',()=>{
 const f=fixture();f.enable(true);f.add('caption');
 const {selection,drafts}=f,history=new DocumentHistory(f.project);
 const current=()=>history.document.chapters[0].nodes.find(n=>n.id===f.node.id);
 const run=(type,data)=>{
  const result=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,selection,type,data,drafts));
  assert.equal(result.failure,undefined);return result.project;
 };
 const before=history.document,p=current().travel.steps[0];
 run('inspector',{command:'duplicate-placement',placement:p.id});
 const duplicate=current().travel.steps[1];assert.notEqual(duplicate.id,p.id);assert.notEqual(duplicate.definitionId,p.definitionId);
 assert.equal(history.document.library.find(d=>d.id===duplicate.definitionId).chapterId,f.chapter.id);
 history.undo();assert.deepEqual(history.document,before);history.redo();assert.equal(current().travel.steps.length,2);
 run('inspector',{command:'move-placement',placement:duplicate.id,direction:'-1'});
 assert.equal(current().travel.steps[0].id,duplicate.id);
 run('field',{scope:'node',path:'travel.enabled',inputType:'checkbox',checked:false});
 assert.equal(current().travel.steps.length,2);
 assert.ok(history.document.library.some(d=>d.id===duplicate.definitionId));
 run('inspector',{command:'remove-placement',placement:duplicate.id});
 assert.equal(current().travel.steps.length,1);
 assert.ok(!history.document.library.some(d=>d.id===duplicate.definitionId));
 history.undo();assert.equal(current().travel.steps.length,2);
 assert.ok(history.document.library.some(d=>d.id===duplicate.definitionId));
});

test('Travel step clipboard and transfer preserve placement rules and reject incompatible content',()=>{
 const f=fixture(),{project,chapter,node,enable,add}=f;enable(true);add('event');add('event');
 const [first,second]=node.travel.steps;
 first.conditions=[{source:'variable',key:'energy',op:'gte',value:2}];
 const clipboard=captureCardClipboard(project,chapter.id,node.id,first.id);
 assert.ok(canPasteCard(project,node,second,clipboard));
 pasteCardClipboard(project,chapter,node,second,clipboard);
 assert.notEqual(first.definitionId,second.definitionId);assert.deepEqual(second.conditions,first.conditions);
 const linear=createNode(project,'linear',undefined,chapter.id);chapter.nodes.push(linear);
 const moved=transferCard(project,chapter,{sourceNodeId:node.id,placementId:second.id,targetNodeId:linear.id,index:0});
 assert.equal(moved,second);assert.equal(node.travel.steps.length,1);assert.equal(linear.cards[0],second);
 assert.equal(transferCard(project,chapter,{sourceNodeId:linear.id,placementId:second.id,targetNodeId:node.id,targetSlot:'travel.steps',index:1}),second);
 assert.equal(node.travel.steps[1],second);
 const action=createDefinition('action','incompatible');project.library.push(action);linear.cards.push({id:'action-placement',definitionId:action.id});
 assert.equal(transferCard(project,chapter,{sourceNodeId:linear.id,placementId:'action-placement',targetNodeId:node.id,index:0}),null);
});

test('Travel playback preview resolves the current transient step to its authored placement',()=>{
 const {project,chapter,node,enable,add}=fixture();enable(true);add('caption');const p=node.travel.steps[0];
 const controller={state:{idle:true,activeNodeId:node.id,cardId:'stale'},location:{node,index:0,sequence:{id:'travel:3',type:'linear',cards:[{...p,kind:'caption'}]}}};
 const deck={phase:'closed',open:false};
 const target=previewCardTarget({project,chapterId:chapter.id,controller,deck});
 assert.deepEqual(target,{chapterId:chapter.id,nodeId:node.id,placementId:p.id,definitionId:p.definitionId,slot:'travel.steps'});
 assert.equal(sourceCard(project,target).placement,p);
 controller.location.sequence.cards[0].id='removed';
 assert.equal(previewCardTarget({project,chapterId:chapter.id,controller,deck}),null);
});


test('Travel leaves Auto scene weights, conditions and repeat controls available',()=>{
 const {project,chapter,node,edit,enable}=fixture();
 edit('inspector',{command:'add-randomizer-candidate',sceneType:'beat'});
 edit('field',{scope:'node',path:'candidates.0.weight',value:'2',inputType:'number'});
 edit('field',{scope:'node',path:'candidates.0.allowRepeats',inputType:'checkbox',checked:true});
 edit('inspector',{command:'add-rule',scope:'node',path:'candidates.0.conditions',ruleKind:'conditions'});
 const before=structuredClone(node.candidates);enable(true);
 const html=nodeInspector(project,chapter,node);
 assert.match(html,/data-path="candidates\.0\.weight"[^>]+value="2"/);
 assert.match(html,/data-path="candidates\.0\.allowRepeats" checked/);
 assert.match(html,/data-path="candidates\.0\.conditions\.0\.key"/);
 assert.deepEqual(node.candidates,before);
});

test('graph Auto summary marks enabled Travel without exposing dormant configuration',()=>{
 const {project,node,enable}=fixture();
 const graph={project,definitionsById:new Map(project.library.map(d=>[d.id,d])),port:()=>'<button>Next</button>'};
 assert.doesNotMatch(GraphView.prototype.cardRows.call(graph,node),/Travel/);
 enable(true);
 assert.match(GraphView.prototype.cardRows.call(graph,node),/<div class="node-body"><div>Travel<\/div><\/div>/);
 assert.doesNotMatch(GraphView.prototype.cardRows.call(graph,node),/steps per segment|2 events/);
 enable(false);
 assert.doesNotMatch(GraphView.prototype.cardRows.call(graph,node),/Travel/);
});

test('graph Auto lists event names on separate small-font rows below the optional Travel label',()=>{
 const {project,chapter,node,enable}=fixture();
 const beat=chapter.nodes.find(other=>other.type==='linear');beat.name='Door <opened>';
 chapter.beatGroups=[{id:'scene',name:'Service corridor',memberIds:[]}];
 project.library.push({id:'rat',kind:'enemy',name:'Rat & shadow'});
 node.candidates=[{beatId:beat.id,weight:1},{groupId:'scene',weight:1},{enemy:{definitionId:'rat'},weight:1},{beatId:'missing',weight:1}];
 const graph={project,chapter,definitionsById:new Map(project.library.map(d=>[d.id,d])),port:()=>'<button>Next</button>'};
 for(const travel of [false,true]){
  enable(travel);
  const html=GraphView.prototype.cardRows.call(graph,node);
  assert.match(html,/<div>Door &lt;opened&gt;<\/div><div>Service corridor<\/div><div>Rat &amp; shadow<\/div><div>Missing event<\/div>/);
  assert.equal(html.includes('<div>Travel</div>'),travel);
  assert.doesNotMatch(html,/steps per segment|[0-9] events/);
  if(travel)assert(html.indexOf('<div>Travel</div>')<html.indexOf('<div>Door'));
 }
});
