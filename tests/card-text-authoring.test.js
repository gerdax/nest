import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,createChapter} from '../project/model.js';
import {createNode} from '../studio/commands.js';
import {captureNodeClipboard,pasteNodeClipboard} from '../studio/node-clipboard.js';
import {renameVariable,remapVariableClipboard} from '../studio/variable-ids.js';

function fixture(){
 const project=createProject(),chapter=project.chapters[0],node=createNode(project,'linear');
 chapter.nodes.push(node);
 const variable={id:'focus',name:'Focus',type:'number',stat:true,initial:3,min:1,max:10};
 chapter.variables.push(variable);
 const card=project.library.find(d=>d.id===node.cards[0].definitionId);
 Object.assign(card,{headline:'Think [STAT:focus]',description:'Details [STAT:focus]'});
 return {project,chapter,node,card,variable};
}

test('cross-chapter clipboard captures and remaps variables referenced only by Caption and Description',()=>{
 const {project,chapter,node}=fixture();
 const payload=captureNodeClipboard(project,chapter.id,node.id);
 assert.deepEqual(payload.variables.map(v=>v.id),['focus']);
 const destination=createChapter('another','Another');project.chapters.push(destination);
 const pasted=pasteNodeClipboard(project,destination,payload);
 const card=project.library.find(d=>d.id===pasted.cards[0].definitionId);
 const id=destination.variables[0].id;
 assert.notEqual(id,'focus');
 assert.equal(card.headline,`Think [STAT:${id}]`);
 assert.equal(card.description,`Details [STAT:${id}]`);
 assert.equal(payload.definitions.find(d=>d.id===node.cards[0].definitionId).headline,'Think [STAT:focus]');
});

test('renaming a chapter variable updates both copy fields in the document and detached clipboard',()=>{
 const {project,chapter,node,card,variable}=fixture();
 const payload=captureNodeClipboard(project,chapter.id,node.id);
 const rename=renameVariable(project,variable,'Clear mind',chapter);
 remapVariableClipboard(payload,rename);
 for(const copy of [card,payload.definitions.find(d=>d.id===card.id)]){
  assert.equal(copy.headline,'Think [STAT:clear_mind]');
  assert.equal(copy.description,'Details [STAT:clear_mind]');
 }
});
