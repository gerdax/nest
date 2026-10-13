import test from 'node:test';
import assert from 'node:assert/strict';
import {cardKinds,cardEditorTint,createDefinition} from '../project/cards.js';
import {createProject} from '../project/model.js';
import {definitionInspector,placementInspector} from '../studio/inspectors.js';

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
