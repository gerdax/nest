import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,parseProject,validateProject,compileChapter,exportChapter,importChapter} from '../project/model.js';
import {createDefinition,resolvePlacement,cardKinds} from '../project/cards.js';
import {ProjectController} from '../project/ProjectController.js';
import {cardFace} from '../project/presentation.js';
import {loadProject,saveProject,STORAGE_KEY} from '../project/storage.js';
import {captureCardClipboard,pasteCardClipboard} from '../studio/card-clipboard.js';

function oldProject(version=3){
 const p=createProject();p.version=version;
 const c=p.chapters[0],node=c.nodes.find(n=>n.type==='linear');
 node.cards=[];
 for(const kind of ['health','energy']){
  const d={id:`old-${kind}`,kind,name:`Old ${kind}`,text:'Keep text',image:'art.png',flipImage:true,imageScale:130,imageOffsetY:9,showName:true,value:-2,onCollect:[{op:'add',key:'energy',value:1}],...(kind==='energy'?{visibility:'local',chapterId:c.id}:{})};
  p.library.push(d);node.cards.push({id:`place-${kind}`,definitionId:d.id,conditions:[],overrides:kind==='health'?{value:3,onCollect:[{op:'add',key:'health',value:2}]}:undefined});
 }
 return p;
}
for(const version of [2,3])test(`version ${version} Health/Energy migrate losslessly and idempotently`,()=>{
 const old=oldProject(version),text=JSON.stringify(old),p=parseProject(text);
 for(const subtype of ['health','energy']){
  const before=old.library.find(d=>d.id===`old-${subtype}`),after=p.library.find(d=>d.id===before.id);
  assert.deepEqual(after,{...before,kind:'consumable',subtype});
 }
 assert.equal(JSON.stringify(old),text);assert.deepEqual(validateProject(p),[]);
 assert.deepEqual(parseProject(JSON.stringify(p)),p);
 const chapter=p.chapters[0],node=chapter.nodes.find(n=>n.type==='linear');
 assert.deepEqual(node.cards,JSON.parse(text).chapters[0].nodes.find(n=>n.id===node.id).cards);
 const compiled=compileChapter(p),cards=compiled.nodes.find(n=>n.id===node.id).cards;
 assert.deepEqual(cards[0].effects,[{op:'add',key:'health',value:3},{op:'add',key:'health',value:2}]);
 assert.deepEqual(cards[1].effects,[{op:'add',key:'energy',value:-2},{op:'add',key:'energy',value:1}]);
 for(const card of cards){const face=cardFace(card);assert.equal(face.cardKind,card.subtype);assert.equal(face.value,card.value);}
 const pkg=exportChapter(old);assert(pkg.library.filter(d=>d.id.startsWith('old-')).every(d=>d.kind==='consumable'));
 const imported=importChapter(createProject(),{...pkg,library:pkg.library.map(d=>d.kind==='consumable'?(({subtype,...rest})=>({...rest,kind:subtype}))(d):d)});
 assert.deepEqual(validateProject(imported),[]);assert(!imported.library.some(d=>['health','energy'].includes(d.kind)));
});
test('old primary storage loads migrated content without rewriting its input until save',()=>{
 const text=JSON.stringify(oldProject()),data=new Map([[STORAGE_KEY,text]]),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const loaded=loadProject(storage);assert(!loaded.error);assert.equal(storage.getItem(STORAGE_KEY),text);
 assert(loaded.project.library.filter(d=>d.id.startsWith('old-')).every(d=>d.kind==='consumable'));
 assert.equal(saveProject(loaded.project,storage,{expectedPrimary:text}).ok,true);
 assert(!JSON.parse(storage.getItem(STORAGE_KEY)).library.some(d=>['health','energy'].includes(d.kind)));
});
test('local Consumable clipboard retains subtype and independent source content',()=>{
 const p=parseProject(JSON.stringify(oldProject())),c=p.chapters[0],node=c.nodes.find(n=>n.type==='linear');
 const copy=captureCardClipboard(p,c.id,node.id,'place-energy');
 pasteCardClipboard(p,c,node,node.cards[0],copy);
 const d=p.library.find(d=>d.id===node.cards[0].definitionId);
 assert.equal(d.kind,'consumable');assert.equal(d.subtype,'energy');assert.notEqual(d.id,'old-energy');
 assert.deepEqual(validateProject(p),[]);assert.equal(resolvePlacement(p,node.cards[0]).effects[0].key,'energy');
});
test('new consumables require an explicit supported subtype and no legacy Library kinds remain',()=>{
 assert(!cardKinds.health);assert(!cardKinds.energy);assert(cardKinds.consumable);
 const p=createProject(),d=createDefinition('consumable','new-consumable');p.library.push(d);assert.equal(d.subtype,'health');
 for(const subtype of [undefined,'mana']){d.subtype=subtype;assert(validateProject(p).some(e=>e.message.includes('Consumable subtype')));}
});

test('controller renders Consumable root and choice faces with their resource subtype',()=>{
 const p=parseProject(JSON.stringify(oldProject())),compiled=compileChapter(p);
 class Deck extends EventTarget {reset(){}replaceContent(content){this.content=content;}endContent(){}}
 const deck=new Deck(),controller=new ProjectController(deck,compiled);
 for(const index of [0,1]){
  const content=controller.content({...controller.location,index});
  const subtype=index===0?'health':'energy';
  assert.equal(content.cardKind,subtype);assert.equal(content.actions[0].cardKind,subtype);
 }
 controller.destroy();
});
