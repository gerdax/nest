import test from 'node:test';
import assert from 'node:assert/strict';
import {variableIdFromName,allocateVariableId,renameVariable,remapVariableClipboard,variableRenamesBetween} from '../studio/variable-ids.js';
import {createProject,validateProject,normalizeLocalOwnership} from '../project/model.js';
import {createNode,synchronizeConnections} from '../studio/commands.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {DocumentHistory} from '../editor/DocumentHistory.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {captureCardClipboard} from '../studio/card-clipboard.js';

test('variable IDs normalize Polish letters, spaces, punctuation and invalid empty/number starts',()=>{
 for(const [name,id] of [['Los Ady poznany','los_ady_poznany'],['  Żółć ĄĆĘŁŃÓŚŹŻ!  ','zolc_acelnoszz'],['A-B/C!','abc'],['A\n B\tC','a_b_c'],['___A__ B___','a_b'],['!!!','variable'],['123 test','variable_123_test']])assert.equal(variableIdFromName(name),id);
});
test('creation uses collision-safe slugs across both scopes and reserves built-in IDs',()=>{
 const p=createProject(),drafts=new LocalCardDrafts(),selection={chapterId:p.activeChapterId};
 applyDocumentCommand(p,selection,'inspector',{command:'add-variable'},drafts);
 applyDocumentCommand(p,selection,'inspector',{command:'add-chapter-variable'},drafts);
 assert.equal(p.variables.at(-1).id,'new_variable');assert.equal(p.chapters[0].variables.at(-1).id,'new_variable_2');
 assert.equal(allocateVariableId(p,'health'),'health_2');
});
function fixture(){
 const p=createProject(),chapter=p.chapters[0],node=createNode(p,'fork');chapter.nodes.push(node);
 chapter.variables=[{id:'old_flag',name:'Old flag',type:'flag',initial:false}];
 const d=p.library.find(d=>d.id===node.choices[0].definitionId);
 d.conditions=[{source:'variable',key:'old_flag',op:'eq',value:false}];d.effects=[{op:'set',key:'old_flag',value:true}];
 const other=structuredClone(chapter);other.id='other';other.variables=[...chapter.variables.map(v=>({...v}))];
 const copied=structuredClone(d);copied.id='other-action';copied.chapterId=other.id;p.library.push(copied);
 other.nodes=[{...structuredClone(node),choices:[{id:'other-choice',definitionId:copied.id}],connections:{'other-choice':null}}];other.startNode=node.id;p.chapters.push(other);
 normalizeLocalOwnership(p);synchronizeConnections(p);
 return {p,chapter,node,d};
}
test('chapter rename rewrites its own conditions/effects, leaving another chapter and inventory IDs intact',()=>{
 const {p,chapter,node,d}=fixture();
 p.library.push({id:'old_flag',kind:'item',name:'Item',text:'',image:'',onCollect:[]});
 d.conditions.push({source:'inventory',key:'old_flag',op:'has'});
 const other=structuredClone(p.chapters[1]),otherCard=structuredClone(p.library.find(d=>d.id==='other-action'));
 const rename=renameVariable(p,chapter.variables[0],'Los Ady poznany',chapter);
 assert.equal(rename.newId,'los_ady_poznany');assert.equal(d.effects[0].key,rename.newId);assert.equal(d.conditions[0].key,rename.newId);assert.equal(d.conditions[1].key,'old_flag');
 assert.deepEqual(p.chapters[1],other);assert.deepEqual(p.library.find(d=>d.id==='other-action'),otherCard);
 assert.deepEqual(validateProject(p),[]);
});
test('global rename remaps all chapters, override keys and check modifiers but preserves system IDs',()=>{
 const p=createProject(),v={id:'skill',name:'Skill',type:'number',initial:3};p.variables.push(v);
 const d=p.library.find(d=>d.kind==='action');d.resolution='check';d.check={pool:[{sides:6,count:1}],target:4,modifier:0,modifierVariable:'skill'};d.effects=[{op:'add',key:'skill',value:1}];
 p.chapters[0].initialValues={skill:5};
 renameVariable(p,v,'Własna siła');assert.equal(v.id,'wlasna_sila');assert.equal(d.check.modifierVariable,v.id);assert.deepEqual(p.chapters[0].initialValues,{wlasna_sila:5});
 for(const id of ['health','energy','agility','intelligence','composure']){const v=p.variables.find(v=>v.id===id);renameVariable(p,v,'Nazwa');assert.equal(v.id,id);}
});
test('name edits are one undoable transaction and clipboard references follow undo and redo',()=>{
 const {p,chapter,node}=fixture(),before=structuredClone(p),history=new DocumentHistory(p),drafts=new LocalCardDrafts();
 const clipboard=captureCardClipboard(p,chapter.id,node.id,node.choices[0].id);
 const result=transactDocument(history,drafts,d=>applyDocumentCommand(d,{chapterId:chapter.id,selected:node.id},'field',{scope:'chapter',path:'variables.0.name',value:'Los Ady poznany',inputType:'text'},drafts));
 assert.equal(result.failure,undefined);remapVariableClipboard(clipboard,result.result.variableRename);
 assert.equal(clipboard.variables[0].id,'los_ady_poznany');assert.deepEqual(validateProject(result.project),[]);
 const after=history.document;history.undo();for(const change of variableRenamesBetween(after,history.document))remapVariableClipboard(clipboard,change);
 assert.deepEqual(history.document,before);assert.equal(clipboard.variables[0].id,'old_flag');
 history.redo();for(const change of variableRenamesBetween(before,history.document))remapVariableClipboard(clipboard,change);
 assert.equal(clipboard.variables[0].id,'los_ady_poznany');
});
