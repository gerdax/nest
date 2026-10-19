import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../project/model.js';
import { createDefinition } from '../project/cards.js';
import { applyTagCommand, tagIsUsed, itemTagsEditor } from '../studio/item-tags.js';
import { inventoryItemOptions } from '../studio/item-options.js';
import { cardFields, placementInspector } from '../studio/inspectors.js';
import { rules } from '../studio/forms.js';
import { applyDocumentCommand } from '../studio/document-commands.js';
import { createNode, makePlacement } from '../studio/commands.js';

const taggedProject=()=>{
 const project=createProject();
 applyTagCommand(project,{operation:'add',id:'tool',name:'Tool'});
 return project;
};
test('tag manager trims single words, rejects whitespace/duplicates and preserves stable IDs on rename',()=>{
 const project=taggedProject();
 assert.throws(()=>applyTagCommand(project,{operation:'add',id:'other',name:'tool'}),/already exists/);
 for(const name of ['','two words','line\nbreak'])assert.throws(()=>applyTagCommand(project,{operation:'add',id:'other',name}),/single word/);
 applyTagCommand(project,{operation:'rename',id:'tool',name:' Narzędzie '});
 assert.deepEqual(project.itemTags,[{id:'tool',name:'Narzędzie'}]);
 applyTagCommand(project,{operation:'remove',id:'tool'});
 assert.deepEqual(project.itemTags,[]);
});
test('tag deletion is blocked by item assignments and rule references',()=>{
 for(const use of [p=>p.library.push({...createDefinition('item','key'),tagId:'tool'}),p=>p.library[0].effects.push({source:'inventory',key:'tag:tool',op:'has'}),p=>p.chapters[0].nodes.push({contextItemId:'tag:tool'})]){
  const project=taggedProject();use(project);
  assert.equal(tagIsUsed(project,'tool'),true);
  assert.throws(()=>applyTagCommand(project,{operation:'remove',id:'tool'}),/Remove assignments/);
  assert.match(itemTagsEditor(project),/data-remove-tag="tool" disabled/);
 }
});
test('items have a single tag selector; shared/local changes replace or clear assignment',()=>{
 const project=taggedProject(),item=createDefinition('item','test');project.library.push(item);
 const selection={chapterId:project.chapters[0].id,definitionId:item.id};
 assert.match(cardFields(project,item),/<select[^>]*data-path="tagId"/);
 assert.doesNotMatch(cardFields(project,item),/multiple/);
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'tagId',value:'tool'});
 assert.equal(item.tagId,'tool');
 applyDocumentCommand(project,selection,'field',{scope:'definition',path:'tagId',value:''});
 assert.equal(Object.hasOwn(item,'tagId'),false);
 const node=createNode(project,'container'),placement=makePlacement(project,'item');node.items.push(placement);project.chapters[0].nodes.push(node);
 assert.match(placementInspector(project,placement,'item',0,'items',1),/data-scope="local-definition" data-path="tagId"/);
});
test('tags are offered for requirements and triggers but not grants or costs',()=>{
 const project=taggedProject();
 assert.ok(inventoryItemOptions(project,null,'',{includeTags:true}).some(([id,name])=>id==='tag:tool'&&name==='Tag: Tool'));
 assert.match(rules(project,[{source:'inventory',key:'tag:tool',op:'has'}],'conditions','definition','conditions'),/Tag: Tool/);
 assert.doesNotMatch(rules(project,[{source:'inventory',key:'',amount:1}],'costs','definition','costs'),/Tag: Tool/);
 assert.doesNotMatch(rules(project,[{op:'addItem',key:''}],'effects','definition','effects'),/Tag: Tool/);
 const node=createNode(project,'fork'),placement=makePlacement(project,'action');node.choices.push(placement);
 assert.match(placementInspector(project,placement,'action',0,'choices',1),/Tag: Tool/);
});

test('node and card clipboards restore deleted tag metadata and merge recreated names',async()=>{
 const {captureNodeClipboard,pasteNodeClipboard}=await import('../studio/node-clipboard.js');
 const {captureCardClipboard,pasteCardClipboard}=await import('../studio/card-clipboard.js');
 for(const cardOnly of [false,true])for(const recreate of [false,true]) {
  const project=taggedProject(),chapter=project.chapters[0],node=createNode(project,'container');
  const placement=makePlacement(project,'item');node.items.push(placement);chapter.nodes.push(node);
  const item=project.library.find(d=>d.id===placement.definitionId);item.tagId='tool';
  const copied=cardOnly?captureCardClipboard(project,chapter.id,node.id,placement.id):captureNodeClipboard(project,chapter.id,node.id);
  delete item.tagId;applyTagCommand(project,{operation:'remove',id:'tool'});
  if(recreate)applyTagCommand(project,{operation:'add',id:'new-tool',name:'TOOL'});
  const result=cardOnly?pasteCardClipboard(project,chapter,node,placement,copied):pasteNodeClipboard(project,chapter,copied).items.at(-1);
  assert.equal(project.library.find(d=>d.id===result.definitionId).tagId,recreate?'new-tool':'tool');
  assert.equal(project.itemTags.length,1);
  assert.equal(copied.definitions.find(d=>d.id===item.id).tagId,'tool');
 }
});
test('restoring a saved local Item type also restores its deleted tag',async()=>{
 const {LocalCardDrafts}=await import('../studio/local-card-drafts.js');
 const project=taggedProject(),chapter=project.chapters[0],node=createNode(project,'container');
 const placement=makePlacement(project,'item');node.items.push(placement);chapter.nodes.push(node);
 project.library.find(d=>d.id===placement.definitionId).tagId='tool';
 const drafts=new LocalCardDrafts();drafts.setContext(chapter.id,node.id);
 drafts.switchSource(project,placement,'local:health',{allowedKinds:['item','health']});
 assert.equal(tagIsUsed(project,'tool'),false);
 applyTagCommand(project,{operation:'remove',id:'tool'});
 drafts.switchSource(project,placement,'local:item',{allowedKinds:['item','health']});
 assert.equal(project.library.find(d=>d.id===placement.definitionId).tagId,'tool');
 assert.deepEqual(project.itemTags,[{id:'tool',name:'Tool'}]);
});

test('snapshot tag restoration avoids legacy concrete item namespaces',async()=>{
 const {restoreSnapshotTags}=await import('../studio/tag-snapshots.js');
 const project=createProject();project.library.push(createDefinition('item','tag:tool'));
 const snapshot={kind:'item',id:'snapshot-item',tagId:'tool',conditions:[{source:'inventory',key:'tag:tool',op:'has'}]};
 restoreSnapshotTags(project,snapshot,[{id:'tool',name:'Tool'}]);
 assert.deepEqual(project.itemTags,[{id:'tool-2',name:'Tool'}]);
 assert.equal(snapshot.tagId,'tool-2');assert.equal(snapshot.conditions[0].key,'tag:tool-2');
});

test('Item tags are a Project settings section between variables and card backs',async()=>{
 const {projectSettingsInspector}=await import('../studio/inspectors.js');
 const {readFileSync}=await import('node:fs');
 const project=taggedProject(),html=projectSettingsInspector(project);
 const variables=html.indexOf('data-project-variables'),tags=html.indexOf('data-project-item-tags'),backs=html.indexOf('data-project-card-backs');
 assert.ok(variables>=0&&variables<tags&&tags<backs);
 assert.match(html,/<details id="item-tags-editor" class="state-panel" data-project-item-tags><summary>Item tags · 1<\/summary>/);
 assert.match(html,/data-tag-name="tool" value="Tool"/);
 assert.doesNotMatch(readFileSync(new URL('../editor.html',import.meta.url),'utf8'),/id="item-tags-editor"/);
});
