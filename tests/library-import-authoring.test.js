import test from 'node:test';
import assert from 'node:assert/strict';
import {showLibraryImportDialog} from '../studio/library-import-dialog.js';
import {createProject} from '../project/model.js';
import {createDefinition} from '../project/cards.js';
import {applyDocumentCommand} from '../studio/document-commands.js';
import {transactDocument} from '../studio/document-session.js';
import {LocalCardDrafts} from '../studio/local-card-drafts.js';
import {DocumentHistory} from '../studio/DocumentHistory.js';

class Element extends EventTarget {
 constructor(doc,tag='div') {
  super();this.ownerDocument=doc;this.tagName=tag.toUpperCase();this.children=[];this.attributes=new Map();this.style={};this.hidden=false;this.disabled=false;this.inert=false;this.textContent='';this.value='';
  this.tabIndex=['BUTTON','INPUT'].includes(this.tagName)?0:-1;this.isConnected=true;
  const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)};
 }
 append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}}
 remove(){this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.isConnected=false;}
 setAttribute(k,v){this.attributes.set(k,v);}getAttribute(k){return this.attributes.get(k)??null;}
 contains(target){return target===this||this.children.some(n=>n.contains(target));}
 closest(){for(let n=this;n;n=n.parentElement)if(n.inert||n.hidden)return n;return null;}
 querySelectorAll(){return descendants(this).filter(n=>['BUTTON','INPUT'].includes(n.tagName));}
 focus(){this.ownerDocument.activeElement=this;}
}
const descendants=node=>node.children.flatMap(n=>[n,...descendants(n)]);
function setup(){const doc=new Element(null);doc.ownerDocument=doc;doc.createElement=tag=>new Element(doc,tag);doc.body=new Element(doc);const prior=new Element(doc,'button');doc.body.append(prior);doc.activeElement=prior;return {doc,prior};}
const find=(doc,label)=>descendants(doc.body).find(n=>n.getAttribute('aria-label')===label||n.textContent===label);
const click=node=>node.dispatchEvent(new Event('click'));
const change=(node,checked)=>{node.checked=checked;node.dispatchEvent(new Event('change'));};
function source(){const p=createProject();p.library=[createDefinition('event','story'),createDefinition('combatAction','attack'),{...createDefinition('event','local'),visibility:'local',chapterId:p.activeChapterId}];return p;}

test('Library import can select Content and Common independently and excludes local cards',async()=>{
 const {doc,prior}=setup(),p=source();const pending=showLibraryImportDialog(p,{document:doc});
 assert(!find(doc,'local · Vignette'));
 const content=find(doc,'Content'),common=find(doc,'Common');assert(content.checked&&common.checked);
 change(content,false);assert.equal(find(doc,'Vignette · Vignette').checked,false);
 assert.equal(find(doc,'Combat Action · Combat Action').checked,true);
 click(find(doc,'Import 1 card'));assert.deepEqual(await pending,['attack']);assert.equal(doc.activeElement,prior);
});

test('individual selections update group state and an empty selection cannot import',async()=>{
 const {doc}=setup(),p=source();p.library.push(createDefinition('caption','caption'));
 const pending=showLibraryImportDialog(p,{document:doc});
 change(find(doc,'Vignette · Vignette'),false);assert.equal(find(doc,'Content').indeterminate,true);
 change(find(doc,'Content'),false);change(find(doc,'Common'),false);
 assert.equal(find(doc,'Import 0 cards').disabled,true);
 click(find(doc,'Import 0 cards'));assert(doc.body.children.length>1);
 click(find(doc,'Cancel'));assert.equal(await pending,null);
});

test('Library import is one undoable edit and preserves chapter selection and settings',()=>{
 const destination=createProject(),incoming=createProject();incoming.library.push({...createDefinition('event','new-story'),name:'Imported story'});
 const history=new DocumentHistory(destination),drafts=new LocalCardDrafts(),selection={chapterId:destination.activeChapterId,selected:destination.chapters[0].startNode};
 const result=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,selection,'import-library',{source:incoming,ids:['new-story']},drafts));
 assert.equal(result.failure,undefined);assert(history.document.library.some(d=>d.id==='new-story'));
 assert.deepEqual(history.document.chapters,destination.chapters);assert.deepEqual(history.document.combat,destination.combat);
 assert.equal(history.document.activeChapterId,destination.activeChapterId);
 const imported=history.document;history.undo();assert.deepEqual(history.document,destination);history.redo();assert.deepEqual(history.document,imported);
});

test('an invalid selected Library dependency leaves the document and Undo history untouched',()=>{
 const destination=createProject(),incoming=createProject();
 incoming.library.push({...createDefinition('action','broken'),conditions:[{source:'variable',key:'missing',op:'eq',value:true}]});
 const history=new DocumentHistory(destination),drafts=new LocalCardDrafts();
 const result=transactDocument(history,drafts,draft=>applyDocumentCommand(draft,{},'import-library',{source:incoming,ids:['broken']},drafts));
 assert.match(result.failure,/Missing Library variable dependency/);
 assert.deepEqual(history.document,destination);assert.equal(history.canUndo,false);
});
