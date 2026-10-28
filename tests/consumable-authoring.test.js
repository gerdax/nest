import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createProject,validateProject,parseProject} from '../project/model.js';
import {resolvePlacement} from '../project/cards.js';
import {definitionInspector,cardFields} from '../studio/inspectors.js';
import {applyDocumentCommand} from '../studio/document-commands.js';

test('Library offers one Consumable creation button backed by Health',()=>{
 const html=readFileSync(new URL('../editor.html',import.meta.url),'utf8');
 assert.match(html,/<button data-add-kind="consumable">\+ Consumable<\/button>/);
 assert(!html.includes('data-add-kind="energy"'));
});

test('Consumable subtype changes resource target within one kind without losing authored content',()=>{
 const p=createProject(),selection={chapterId:p.chapters[0].id,selected:p.chapters[0].startNode};
 const added=applyDocumentCommand(p,selection,'add-definition',{kind:'consumable'});
 selection.definitionId=added.selection.definitionId;
 const d=p.library.find(d=>d.id===selection.definitionId);
 Object.assign(d,{name:'Rest station',value:3,text:'Recover here',image:'station.png',imageScale:120,onCollect:[{op:'add',key:'health',value:1}]});
 const before=structuredClone(d);
 for(const kind of ['energy','health']){
  applyDocumentCommand(p,selection,'field',{scope:'definition',path:'subtype',value:kind,inputType:'select-one'});
  assert.deepEqual(d,{...before,subtype:kind});
  assert.match(definitionInspector(p,d),/<h2>Consumable/);
  assert.match(cardFields(p,d),/Consumable subtype<select[^>]*data-path="subtype"/);
  assert.match(cardFields(p,d,'local-definition'),/data-scope="local-definition" data-path="subtype"/);
  assert.deepEqual(resolvePlacement(p,{id:'resource-placement',definitionId:d.id}).effects,[{op:'add',key:kind,value:3},...before.onCollect]);
  assert.deepEqual(validateProject(p),[]);
  assert.equal(parseProject(JSON.stringify(p)).library.find(card=>card.id===d.id).subtype,kind);
 }
});
