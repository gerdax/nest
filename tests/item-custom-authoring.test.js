import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../project/model.js';
import { resolvePlacement } from '../project/cards.js';
import { nodeInspector, placementInspector } from '../studio/inspectors.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { transactDocument } from '../studio/document-session.js';

function fixture() {
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes.find(node=>node.type==='container');
 const placement=node.items[0],definition=project.library.find(card=>card.id===placement.definitionId);
 definition.onCollect=[{op:'add',key:'energy',value:1}];definition.permability=3;
 placement.conditions=[{source:'variable',key:'energy',op:'gte',value:0}];
 return {project,chapter,node,placement,definition,selection:{chapterId:chapter.id,selected:node.id}};
}

test('shared Item custom rules expose only placement collection and Permability controls',()=>{
 const {project,chapter,node,placement,definition,selection}=fixture(),source=structuredClone(definition);
 const before=nodeInspector(project,chapter,node);
 assert.match(before,/Using source rules/);
 assert.match(before,/data-path="useCustomRules"/);
 assert.doesNotMatch(before,/data-path="overrides.permability"/);
 applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,path:'useCustomRules',checked:true});
 assert.deepEqual(placement.overrides,{onCollect:source.onCollect,permability:3});
 assert.notEqual(placement.overrides.onCollect,definition.onCollect);
 const html=nodeInspector(project,chapter,node);
 assert.match(html,/data-path="useCustomRules" checked/);
 assert.match(html,/data-scope="placement" data-path="overrides.permability"/);
 assert.match(html,/data-scope="placement" data-path="overrides.onCollect.0.value"/);
 assert.match(html,/Appearance conditions/);
 assert.doesNotMatch(html,/data-path="overrides.resolution"/);
 applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,path:'overrides.permability',inputType:'number',value:'1'});
 applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,path:'overrides.onCollect.0.value',inputType:'number',value:'2'});
 assert.equal(resolvePlacement(project,placement).permability,1);
 assert.equal(resolvePlacement(project,placement).onCollect[0].value,2);
 assert.deepEqual(definition,source);
 applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,path:'useCustomRules',checked:false});
 assert.equal(placement.overrides,undefined);
 assert.equal(resolvePlacement(project,placement).permability,3);
 assert.deepEqual(placement.conditions,[{source:'variable',key:'energy',op:'gte',value:0}]);
});

test('local Item conversion preserves custom values and edits its own rules directly',()=>{
 const {project,chapter,node,placement,definition,selection}=fixture();
 placement.overrides={onCollect:[{op:'add',key:'energy',value:4}],permability:1};
 new LocalCardDrafts().convert(project,placement);
 const local=project.library.find(card=>card.id===placement.definitionId);
 assert.equal(local.visibility,'local');assert.equal(local.permability,1);
 assert.deepEqual(local.onCollect,[{op:'add',key:'energy',value:4}]);
 assert.equal(definition.permability,3);
 const html=placementInspector(project,placement,'item',0,'items');
 assert.match(html,/data-scope="local-definition" data-path="permability"/);
 assert.doesNotMatch(html,/Use custom rules|data-path="overrides\./);
});

test('Item custom rule edits participate in undo and redo without touching shared definitions',()=>{
 const {project,placement,selection}=fixture(),history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const apply=data=>transactDocument(history,drafts,project=>applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,...data},drafts));
 assert.equal(apply({path:'useCustomRules',checked:true}).failure,undefined);
 assert.equal(apply({path:'overrides.permability',inputType:'number',value:'2'}).failure,undefined);
 const current=()=>history.document.chapters[0].nodes.find(node=>node.id===selection.selected).items[0];
 assert.equal(current().overrides.permability,2);
 history.undo();assert.equal(current().overrides.permability,3);
 history.undo();assert.equal(current().overrides,undefined);
 history.redo();assert.equal(current().overrides.permability,3);
});
