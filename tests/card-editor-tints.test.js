import test from 'node:test';
import assert from 'node:assert/strict';
import {cardKinds,cardEditorTint,createDefinition} from '../project/cards.js';
import {createProject} from '../project/model.js';
import {definitionInspector,placementInspector,nodeInspector} from '../studio/inspectors.js';

test('every card type defines a distinct editor tint used by both card panel contexts',()=>{
 const project=createProject(),tints=new Set();
 for(const [kind,descriptor] of Object.entries(cardKinds)){
  assert.match(descriptor.editorTint,/^#[0-9a-f]{6}$/i);
  assert.ok(!tints.has(descriptor.editorTint));tints.add(descriptor.editorTint);
  const definition=createDefinition(kind,`tint-${kind}`);project.library.push(definition);
  for(const html of [definitionInspector(project,definition),placementInspector(project,{id:`p-${kind}`,definitionId:definition.id},kind,0,'cards')]){
   assert.ok(html.includes('card-panel'));
   assert.ok(html.includes(`--card-editor-tint:${descriptor.editorTint}`));
  }
 }
 assert.equal(cardEditorTint('narrative'),cardEditorTint('event'));
});

test('collapsible card headers distinguish source and mark custom Library rules only',()=>{
 const project=createProject(),chapter=project.chapters[0];
 const shared={...createDefinition('action','shared-style'),name:'Pick <lock>'};
 const local={...createDefinition('action','local-style'),name:'Local action',visibility:'local',chapterId:chapter.id};
 project.library.push(shared,local);
 for(const [definition,source] of [[shared,'library'],[local,'local']]){
  const placement={id:`p-${source}`,definitionId:definition.id,overrides:{}};
  const html=placementInspector(project,placement,'action',0,'choices',1,chapter);
  assert.match(html,new RegExp(`data-card-source="${source}"`));
  const header=html.match(/<summary>([\s\S]*?)<\/summary>/)[1];
  if(source==='library')assert.match(header,/Pick &lt;lock&gt; <span class="card-custom-marker" role="img" aria-label="Custom rules enabled" title="Custom rules enabled">\*<\/span>/);
  else assert.doesNotMatch(header,/card-custom-marker/);
  delete placement.overrides;
  assert.doesNotMatch(placementInspector(project,placement,'action',0,'choices',1,chapter).match(/<summary>([\s\S]*?)<\/summary>/)[1],/card-custom-marker/);
 }
 const missing=placementInspector(project,{id:'missing',definitionId:'absent',overrides:{}},'action',0,'choices',1,chapter);
 assert.match(missing,/data-card-source="missing"/);assert.doesNotMatch(missing,/card-custom-marker/);
});
test('card sources sort local templates first, then shared cards by type label and name',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='fork');
 project.library=[...project.library,{...createDefinition('action','z'),name:'Zebra'},{...createDefinition('caption','a'),name:'apple'},{...createDefinition('event','b'),name:'Banana'}];
 const before=project.library.map(d=>d.id);
 const html=placementInspector(project,node.choices[0],'action',0,'choices');
 const source=html.match(/<select[^>]*data-path="definitionId"[^>]*>([\s\S]*?)<\/select>/)[1];
 const ids=[...source.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(ids,['local:action','local:caption','local:event','explore','z','a','arrival','b']);
 const linear=placementInspector(project,project.chapters[0].nodes[0].cards[0],'event',0,'cards');
 const linearSource=linear.match(/<select[^>]*data-path="definitionId"[^>]*>([\s\S]*?)<\/select>/)[1];
 const linearIds=[...linearSource.matchAll(/<option value="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(linearIds.slice(0,5),['local:action','local:caption','local:consumable','local:item','local:event']);
 assert.deepEqual(project.library.map(d=>d.id),before);
 const panel=nodeInspector(project,project.chapters[0],node);
 assert.match(panel,/<div class="add-card-buttons">[\s\S]*?\+ Action[\s\S]*?\+ Vignette[\s\S]*?\+ Caption/);
 assert.match(panel,/<hr class="connections-divider"><h3>Connections<\/h3>/);
});

test('dice settings have a dedicated theme hook inside their parent Action panel',()=>{
 const project=createProject(),node=project.chapters[0].nodes.find(n=>n.type==='fork');
 const action=project.library.find(d=>d.kind==='action');action.visibility='local';action.resolution='check';
 const html=placementInspector(project,node.choices[0],'action',0,'choices');
 assert.ok(html.includes(`--card-editor-tint:${cardEditorTint('action')}`));
 assert.match(html,/<div class="entry check-settings"><h3>Check settings<\/h3>/);
});
