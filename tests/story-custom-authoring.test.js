import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../project/model.js';
import { createDefinition, resolvePlacement } from '../project/cards.js';
import { nodeInspector } from '../studio/inspectors.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { LocalCardDrafts } from '../studio/local-card-drafts.js';
import { DocumentHistory } from '../editor/DocumentHistory.js';
import { transactDocument } from '../studio/document-session.js';

function fixture(kind='event') {
 const project=createProject(),chapter=project.chapters[0],node=chapter.nodes[0];
 const definition={...createDefinition(kind,'story'),effects:[{op:'add',key:'energy',value:1}]};
 project.library.push(definition);
 const placement={id:'story-placement',definitionId:definition.id,conditions:[{source:'variable',key:'energy',op:'gte',value:0}]};
 node.cards=[placement];
 return {project,chapter,node,placement,definition,selection:{chapterId:chapter.id,selected:node.id}};
}

for(const kind of ['event','caption'])test(`${kind} has one progression rule set and a shared-only custom toggle`,()=>{
 const {project,chapter,node,placement,definition,selection}=fixture(kind),source=structuredClone(definition);
 let html=nodeInspector(project,chapter,node);
 assert.match(html,/Using source rules/);assert.match(html,/Use custom rules/);
 assert.doesNotMatch(html,/Additional effects|On progression effects/);
 const field=data=>applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,...data});
 field({path:'useCustomRules',checked:true});
 html=nodeInspector(project,chapter,node);
 assert.equal((html.match(/On progression effects/g)||[]).length,1);
 assert.match(html,/data-scope="placement" data-path="overrides.effects.0.value"/);
 assert.doesNotMatch(html,/Additional effects/);
 field({path:'overrides.effects.0.value',inputType:'number',value:'3'});
 assert.equal(resolvePlacement(project,placement).effects[0].value,3);
 assert.deepEqual(definition,source);
 field({path:'useCustomRules',checked:false});
 assert.equal(resolvePlacement(project,placement).effects[0].value,1);
 assert.equal(placement.conditions.length,1);
 new LocalCardDrafts().convert(project,placement);
 html=nodeInspector(project,chapter,node);
 assert.equal((html.match(/On progression effects/g)||[]).length,1);
 assert.match(html,/data-scope="local-definition" data-path="effects.0.value"/);
 assert.doesNotMatch(html,/Additional effects|Use custom rules|overrides.effects/);
});

test('enabling custom story rules absorbs additional effects once and retains appearance conditions',()=>{
 const {project,placement,selection}=fixture();
 placement.effects=[{op:'add',key:'energy',value:2}];
 applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,path:'useCustomRules',checked:true});
 assert.deepEqual(placement.overrides.effects.map(effect=>effect.value),[1,2]);
 assert.equal(placement.effects,undefined);
 assert.deepEqual(resolvePlacement(project,placement).effects.map(effect=>effect.value),[1,2]);
 assert.equal(placement.conditions.length,1);
});

test('custom story edits are undoable and local conversion keeps the effective progression rules',()=>{
 const {project,placement,selection}=fixture(),history=new DocumentHistory(project),drafts=new LocalCardDrafts();
 const apply=data=>transactDocument(history,drafts,project=>applyDocumentCommand(project,selection,'field',{scope:'placement',placementId:placement.id,...data},drafts));
 apply({path:'useCustomRules',checked:true});
 apply({path:'overrides.effects.0.value',inputType:'number',value:'4'});
 const current=()=>history.document.chapters[0].nodes[0].cards[0];
 assert.equal(current().overrides.effects[0].value,4);
 history.undo();assert.equal(current().overrides.effects[0].value,1);
 history.undo();assert.equal(current().overrides,undefined);
 history.redo();history.redo();
 const restored=history.document,p=restored.chapters[0].nodes[0].cards[0];
 drafts.convert(restored,p);
 assert.equal(resolvePlacement(restored,p).effects[0].value,4);
});
