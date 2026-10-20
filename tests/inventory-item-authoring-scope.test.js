import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createChapter } from '../project/model.js';
import { createDefinition } from '../project/cards.js';
import { eligibleInventoryItems, inventoryItemOptions } from '../studio/item-options.js';
import { nodeInspector, definitionInspector } from '../studio/inspectors.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { normalizeRule } from '../studio/commands.js';

function fixture() {
 const project=createProject(), chapter=project.chapters[0], other=createChapter('other');
 project.chapters.push(other);
 const item=(id,owner)=>({...createDefinition('item',id),name:id,...(owner?{visibility:'local',chapterId:owner}:{visibility:'shared'})});
 project.library=[item('other-item',other.id),item('own-item',chapter.id),item('shared-item'),{...item('orphan-item'),visibility:'local'}];
 project.activeChapterId=other.id;
 const action={...createDefinition('action','action'),visibility:'local',chapterId:chapter.id,
  conditions:[{source:'inventory',key:'own-item',op:'has'}],costs:[{source:'inventory',key:'own-item',amount:1}],
  effects:[{op:'addItem',key:'own-item'}],resolution:'check',
  successEffects:[{op:'removeItem',key:'own-item'}],failureEffects:[{op:'addItem',key:'own-item'}]};
 project.library.push(action);
 const placement={id:'placement',definitionId:action.id,contextItemId:'own-item'};
 const node={id:'fork',type:'fork',name:'Fork',choices:[placement],connections:{}};
 chapter.nodes=[node];
 return {project,chapter,other,action,placement,node,selection:{chapterId:chapter.id,selected:node.id,definitionId:action.id}};
}
function selectOptions(html,path) {
 const tag=`data-path="${path}">`;
 const start=html.indexOf(tag);
 assert.ok(start>=0,`Missing selector ${path}`);
 return html.slice(start+tag.length,html.indexOf('</select>',start));
}
function assertChapterOptions(html,path) {
 const options=selectOptions(html,path);
 assert.match(options,/local: own-item/);
 assert.match(options,/Item: shared-item/);
 assert.doesNotMatch(options,/other-item|orphan-item/);
}
function assertEffectOptions(html,path) {
 const options=selectOptions(html,path);
 assert.match(options,/Item: shared-item/);
 assert.match(options,/<option value="own-item" selected disabled>local: own-item \(unavailable\)<\/option>/);
 assert.doesNotMatch(options,/other-item|orphan-item/);
}

test('editor item candidates require explicit chapter ownership without filtering project library',()=>{
 const {project,chapter}=fixture(),before=structuredClone(project.library);
 assert.deepEqual(eligibleInventoryItems(project,chapter).map(item=>item.id),['own-item','shared-item']);
 assert.deepEqual(eligibleInventoryItems(project).map(item=>item.id),['shared-item']);
 assert.deepEqual(project.library,before);
 assert.deepEqual(inventoryItemOptions(project,chapter,'missing').at(-1),['missing','missing (unavailable)']);
});

test('chapter item effects use shared Library items while requirements, costs and triggers keep chapter candidates',()=>{
 const {project,chapter,node}=fixture();
 const html=nodeInspector(project,chapter,node);
 for(const path of ['conditions.0.key','costs.0.key','contextItemId'])assertChapterOptions(html,path);
 for(const path of ['effects.0.key','successEffects.0.key','failureEffects.0.key'])assertEffectOptions(html,path);
});

test('placement custom rules, appearance conditions, collection and progression effects receive chapter context',()=>{
 const {project,chapter,node,placement,action}=fixture();
 action.visibility='shared';
 placement.overrides={conditions:action.conditions,costs:action.costs,effects:action.effects};
 let html=nodeInspector(project,chapter,node);
 for(const path of ['overrides.conditions.0.key','overrides.costs.0.key'])assertChapterOptions(html,path);
 assertEffectOptions(html,'overrides.effects.0.key');
 const item={...createDefinition('item','collectable'),visibility:'local',chapterId:chapter.id,onCollect:[{op:'addItem',key:'own-item'}]};
 const story={...createDefinition('event','story'),visibility:'local',chapterId:chapter.id,effects:[{op:'removeItem',key:'own-item'}]};
 project.library.push(item,story);
 node.type='linear';node.cards=[{id:'item-placement',definitionId:item.id,conditions:[{source:'inventory',key:'own-item',op:'has'}]},{id:'story-placement',definitionId:story.id}];
 html=nodeInspector(project,chapter,node);
 assertChapterOptions(html,'conditions.0.key');
 for(const path of ['onCollect.0.key','effects.0.key'])assertEffectOptions(html,path);
 node.type='random';node.routes=[{id:'route',conditions:[{source:'inventory',key:'own-item',op:'has'}]}];
 assertChapterOptions(nodeInspector(project,chapter,node),'routes.0.conditions.0.key');
});

test('library rules offer shared items only and keep saved local references visibly unavailable',()=>{
 const {project,action}=fixture();
 action.visibility='shared';
 const html=definitionInspector(project,action);
 for(const path of ['conditions.0.key','costs.0.key','effects.0.key','successEffects.0.key','failureEffects.0.key']) {
  const options=selectOptions(html,path);
  assert.match(options,/Item: shared-item/);
  assert.match(options,new RegExp(`<option value="own-item" selected${path.includes('Effects')||path.startsWith('effects')?' disabled':''}>local: own-item \\(unavailable\\)<\\/option>`));
  assert.doesNotMatch(options,/other-item|orphan-item/);
 }
});

test('invalid selected chapter references stay selected without leaking into other pickers or changing saved data',()=>{
 const {project,chapter,node,action,placement}=fixture();
 action.costs[0].key='other-item';placement.contextItemId='missing-item';
 const before=structuredClone(project);
 const html=nodeInspector(project,chapter,node);
 assert.match(selectOptions(html,'costs.0.key'),/<option value="other-item" selected>local: other-item \(unavailable\)<\/option>/);
 assert.match(selectOptions(html,'contextItemId'),/<option value="missing-item" selected>missing-item \(unavailable\)<\/option>/);
 assert.doesNotMatch(selectOptions(html,'conditions.0.key'),/other-item|missing-item/);
 assert.deepEqual(project,before);
});

test('rule type switches use the same chapter or Library candidates, including an empty eligible list',()=>{
 const {project,chapter,action,selection}=fixture();
 for(const scope of ['local-definition','placement','node','definition']) {
  if(scope==='definition')action.visibility='shared';
  const root=scope==='definition'||scope==='local-definition'?action:scope==='node'?chapter.nodes[0]:chapter.nodes[0].choices[0];
  root.effects=[{op:'set',key:'energy',value:0}];
  applyDocumentCommand(project,selection,'field',{scope,placementId:'placement',path:'effects.0.op',value:'addItem'});
  assert.equal(root.effects[0].key,'shared-item');
 }
 for(const source of ['conditions','costs']) {
  action[source]=[{source:'variable',key:'energy',...(source==='conditions'?{op:'eq',value:0}:{amount:1})}];
  applyDocumentCommand(project,selection,'field',{scope:'local-definition',placementId:'placement',path:`${source}.0.source`,value:'inventory'});
  assert.equal(action[source][0].key,'own-item');
 }
 project.library=project.library.filter(item=>item.id!=='shared-item'&&item.id!=='own-item');
 const rule={op:'addItem',key:'other-item'};
 normalizeRule(project,rule,'op',chapter);
 assert.equal(rule.key,'');
});

test('legacy local effect targets stay visible but cannot be edited as shared targets',()=>{
 const {project,chapter,node,selection}=fixture();
 const item=project.library.find(item=>item.id==='own-item');
 chapter.variables=[{id:'chapter-flag',name:'Chapter flag',type:'flag',initial:false}];
 item.onCollect=[{op:'addItem',key:'own-item'}];
 const before=structuredClone(project);
 const html=nodeInspector(project,chapter,node);
 assert.doesNotMatch(html,/data-command="edit-shared" data-definition="own-item"/);
 assert.match(html,/Choose a shared Library item/);
 assert.doesNotMatch(html,/data-command="edit-shared" data-definition="other-item"/);
 const detail=definitionInspector(project,item);
 assert.match(detail,/Chapter-local definition/);
 assert.match(detail,/data-command="back-to-beat"/);
 assert.match(detail,/Artwork path/);
 assert.doesNotMatch(detail,/Shared definition|Remove from Library/);
 assertEffectOptions(detail,'onCollect.0.key');
 assert.deepEqual(project,before,'opening the reference does not alter the item or create a placement');
 const selected={...selection,chapterId:project.chapters[1].id,definitionId:item.id};
 applyDocumentCommand(project,selected,'field',{scope:'definition',path:'image',value:'rod.png'});
 assert.equal(item.image,'rod.png');
 item.onCollect=[{op:'set',key:'energy',value:0}];
 applyDocumentCommand(project,selected,'field',{scope:'definition',path:'onCollect.0.op',value:'addItem'});
 assert.equal(item.onCollect[0].key,'shared-item');
 applyDocumentCommand(project,selected,'inspector',{command:'add-rule',scope:'definition',path:'onCollect',ruleKind:'effects'});
 assert.equal(item.onCollect.length,2);
 applyDocumentCommand(project,selected,'field',{scope:'definition',path:'onCollect.1.key',value:'chapter-flag'});
 assert.equal(item.onCollect[1].value,false,'local definition rules can use chapter variables');
});

test('shared effect targets expose Edit shared on the right of Remove',()=>{
 const {project,chapter,node,action}=fixture();
 action.effects=[{op:'addItem',key:'shared-item'},{op:'removeItem',key:'shared-item'}];
 const html=nodeInspector(project,chapter,node);
 assert.match(html,/<div class="rule-entry-actions"><button[^>]*data-command="remove-rule"[^>]*>Remove<\/button><button[^>]*data-command="edit-shared" data-definition="shared-item"[^>]*>Edit shared<\/button><\/div>/);
 assert.doesNotMatch(html,/>Edit item</);
 assert.doesNotMatch(selectOptions(html,'effects.0.key'),/own-item|other-item|orphan-item/);
});

test('effect commands reject local, missing and tag targets without mutating saved rules',()=>{
 const {project,action,selection}=fixture();
 action.effects=[{op:'addItem',key:'shared-item'}];
 for(const key of ['own-item','other-item','missing','tag:tool']) {
  assert.throws(()=>applyDocumentCommand(project,selection,'field',{scope:'local-definition',placementId:'placement',path:'effects.0.key',value:key}),/shared Library item/);
  assert.equal(action.effects[0].key,'shared-item');
 }
 project.library=project.library.filter(item=>item.id!=='shared-item');
 for(const op of ['addItem','removeItem']) {
  const rule={op,key:'own-item'};
  normalizeRule(project,rule,'op',project.chapters[0]);
  assert.equal(rule.key,'','local items cannot be the default when the Library has no items');
 }
});
