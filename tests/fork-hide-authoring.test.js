import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProject, compileChapter, exportChapter, parseProject, validateProject} from '../project/model.js';
import {resolvePlacement} from '../project/cards.js';
import {placementInspector, definitionInspector} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {cardRuleIndicators} from '../studio/card-rule-indicators.js';
import {duplicatePlacement, duplicateNode, makePlacement, synchronizeConnections} from '../studio/commands.js';
import {captureCardClipboard, pasteCardClipboard} from '../studio/card-clipboard.js';
import {transferCard} from '../studio/card-transfer.js';

function fixture() {
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(node=>node.type==='fork');
 const placement=node.choices[0];
 return {project,chapter,node,placement,selection:{chapterId:chapter.id,selected:node.id}};
}
const edit=(f,placement,checked)=>applyDocumentCommand(f.project,f.selection,'field',{
 scope:'placement',path:'hideAfterUse',placementId:placement.id,inputType:'checkbox',checked,
});

test('Fork choices place Hide after use at the bottom left beside Duplicate, outside placement-fields',()=>{
 const f=fixture();
 for(const placement of [f.placement,makePlacement(f.project,'event',undefined,f.chapter.id)]) {
  const kind=f.project.library.find(d=>d.id===placement.definitionId).kind;
  let html=placementInspector(f.project,placement,kind,0,'choices',2,f.chapter);
  assert.match(html,/<div class="row card-panel-actions" data-placement="[^"]+"><label class="field check-field"><input type="checkbox" data-scope="placement" data-path="hideAfterUse"\s*>Hide after use<\/label><button[^>]*data-command="duplicate-placement"[^>]*>Duplicate<\/button><\/div><\/details>/);
  assert.ok(html.indexOf('data-path="hideAfterUse"')>html.indexOf('class="placement-fields"'));
  assert.ok(html.indexOf('data-path="hideAfterUse"')>html.indexOf('class="inspector-card-preview"'));
  assert.match(html,new RegExp(`data-placement="${placement.id}"`));
  placement.hideAfterUse=true;
  html=placementInspector(f.project,placement,kind,0,'choices',2,f.chapter);
  assert.match(html,/data-path="hideAfterUse" checked/);
 }
 for(const slot of ['intro','cards','items','travel.steps']) {
  assert.doesNotMatch(placementInspector(f.project,f.placement,'action',0,slot,2,f.chapter),/data-path="hideAfterUse"/);
 }
 assert.doesNotMatch(definitionInspector(f.project,f.project.library.find(d=>d.id===f.placement.definitionId)),/data-path="hideAfterUse"/);
});

test('editor change handler binds checkbox to its enclosing placement without placement-fields',()=>{
 const f=fixture(),second={...f.placement,id:'other-choice'};f.node.choices.push(second);
 const source=readFileSync(new URL('../studio/editor.js',import.meta.url),'utf8');
 const start=source.indexOf('function changeField(event){');
 const handler=source.slice(start,source.indexOf('for(const root of',start));
 const context={edit:(command,data)=>applyDocumentCommand(f.project,f.selection,command,data)};
 runInNewContext(handler,context);
 const target={dataset:{scope:'placement',path:'hideAfterUse'},checked:true,type:'checkbox',value:'on',
  matches:()=>false,closest:selector=>selector==='[data-placement]'?{dataset:{placement:second.id}}:null};
 context.changeField({target});
 assert.equal(second.hideAfterUse,true);assert.equal(f.placement.hideAfterUse,undefined);
 target.checked=false;context.changeField({target});assert.equal(second.hideAfterUse,false);
 assert.equal(f.project.library.find(d=>d.id===second.definitionId).hideAfterUse,undefined);
});

test('toggle rejects non-Fork placements and malformed checkbox values',()=>{
 const f=fixture();edit(f,f.placement,true);assert.equal(f.placement.hideAfterUse,true);
 edit(f,f.placement,false);assert.equal(f.placement.hideAfterUse,false);
 assert.throws(()=>edit(f,f.placement,'true'),/Fork choice/);
 const linear=f.chapter.nodes.find(n=>n.type==='linear');
 assert.throws(()=>applyDocumentCommand(f.project,{...f.selection,selected:linear.id},'field',{
  scope:'placement',path:'hideAfterUse',placementId:linear.cards[0].id,checked:true,inputType:'checkbox',
 }),/Fork choice/);
});

test('Hide after use resolves and compiles per placement without modifying Library source',()=>{
 const f=fixture(),second={...f.placement,id:'other-choice',hideAfterUse:false};
 f.placement.hideAfterUse=true;f.node.choices.push(second);synchronizeConnections(f.project);
 const before=structuredClone(f.project);
 const compiled=compileChapter(f.project).nodes.find(n=>n.id===f.node.id);
 assert.equal(compiled.choices[0].hideAfterUse,true);assert.equal(compiled.choices[1].hideAfterUse,false);
 assert.equal(resolvePlacement(f.project,{id:'default',definitionId:f.placement.definitionId}).hideAfterUse,undefined);
 assert.equal(compileChapter(f.project).library.find(d=>d.id===f.placement.definitionId).hideAfterUse,undefined);
 assert.deepEqual(f.project,before);
 // An invalid Library property must never supply a placement's behavior.
 f.project.library.find(d=>d.id===f.placement.definitionId).hideAfterUse=true;
 assert.equal(resolvePlacement(f.project,{id:'default',definitionId:f.placement.definitionId}).hideAfterUse,undefined);
});

test('H indicator uses explicit true only and follows existing rule markers',()=>{
 const f=fixture(),definition=f.project.library.find(d=>d.id===f.placement.definitionId);
 Object.assign(definition,{conditions:[{source:'variable',key:'energy',op:'gte',value:1}],costs:[{source:'variable',key:'energy',amount:1}]});
 f.placement.contextItemId='flashlight';f.placement.hideAfterUse=true;
 assert.deepEqual(cardRuleIndicators(f.project,f.placement),[['T','Inventory trigger'],['R','Requirements'],['C','Costs'],['H','Hide after use']]);
 assert.match(placementInspector(f.project,f.placement,'action',0,'choices',1,f.chapter),/title="T: Inventory trigger; R: Requirements; C: Costs; H: Hide after use"/);
 for(const value of [false,undefined,'true']) {
  f.placement.hideAfterUse=value;
  assert.equal(cardRuleIndicators(f.project,f.placement).some(([letter])=>letter==='H'),false);
 }
});

test('validation accepts optional boolean on Fork choices and rejects other scopes',()=>{
 const f=fixture();
 for(const value of [true,false]) {f.placement.hideAfterUse=value;assert.deepEqual(validateProject(f.project),[]);}
 for(const value of ['true',1,null,undefined]) {
  f.placement.hideAfterUse=value;
  assert.ok(validateProject(f.project).some(e=>e.message.includes('Hide after use')));
 }
 delete f.placement.hideAfterUse;
 const vignette=makePlacement(f.project,'event',undefined,f.chapter.id);vignette.hideAfterUse=true;
 f.node.choices.push(vignette);synchronizeConnections(f.project);assert.deepEqual(validateProject(f.project),[]);
 const linear=f.chapter.nodes.find(n=>n.type==='linear');linear.cards[0].hideAfterUse=false;
 assert.ok(validateProject(f.project).some(e=>e.message.includes('Hide after use')));
 delete linear.cards[0].hideAfterUse;
 f.project.library.find(d=>d.id===f.placement.definitionId).hideAfterUse=false;
 assert.ok(validateProject(f.project).some(e=>e.message.includes('Hide after use')));
});

test('copy, duplication, project serialization and portable chapter export preserve placement flag',()=>{
 const f=fixture();f.placement.hideAfterUse=true;
 const copy=duplicatePlacement(f.project,f.node,f.placement);assert.equal(copy.hideAfterUse,true);
 const nodeCopy=duplicateNode(f.project,f.node);assert.equal(nodeCopy.choices[0].hideAfterUse,true);
 const clipboard=captureCardClipboard(f.project,f.chapter.id,f.node.id,f.placement.id);
 copy.hideAfterUse=false;pasteCardClipboard(f.project,f.chapter,f.node,copy,clipboard);assert.equal(copy.hideAfterUse,true);
 for(const loaded of [parseProject(JSON.stringify(f.project)),parseProject(JSON.stringify(exportChapter(f.project)))]) {
  const node=loaded.chapters[0].nodes.find(n=>n.id===f.node.id);
  assert.equal(node.choices[0].hideAfterUse,true);assert.equal(node.choices[1].hideAfterUse,true);
  assert.equal(loaded.library.find(d=>d.id===f.placement.definitionId).hideAfterUse,undefined);
  assert.deepEqual(validateProject(loaded),[]);
 }
});

test('moving or pasting a choice into a Linear removes the Fork-only option',()=>{
 const f=fixture();f.placement.hideAfterUse=true;
 const linear=f.chapter.nodes.find(node=>node.type==='linear'),target=makePlacement(f.project,'action',undefined,f.chapter.id);
 linear.cards.push(target);
 const clipboard=captureCardClipboard(f.project,f.chapter.id,f.node.id,f.placement.id);
 pasteCardClipboard(f.project,f.chapter,linear,target,clipboard);
 assert.equal(target.hideAfterUse,undefined);
 const moved=transferCard(f.project,f.chapter,{sourceNodeId:f.node.id,placementId:f.placement.id,targetNodeId:linear.id,index:linear.cards.length});
 assert(moved);assert.equal(linear.cards.at(-1).hideAfterUse,undefined);
 synchronizeConnections(f.project);
 assert.deepEqual(validateProject(f.project),[]);
});
