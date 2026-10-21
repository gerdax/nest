import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../studio/GraphView.js';
import { CardDrag,cardDropSlot } from '../studio/card-drag.js';

function fixture(){
 const classes=new Set();
 const headerClasses=new Set();
 const header={getBoundingClientRect:()=>({top:60,bottom:100,height:40}),classList:{toggle:(s,v)=>v?headerClasses.add(s):headerClasses.delete(s)}};
 const rows=[0,1,2].map((i)=>({dataset:{cardSlot:'cards',cardPlacement:`card-${i}`},classList:{toggle(){}},getBoundingClientRect:()=>({top:100+i*40,height:40,bottom:140+i*40})}));
 const el={dataset:{id:'target'},querySelector:selector=>selector==='.node-heading'?header:null,querySelectorAll:()=>rows,getBoundingClientRect:()=>({left:200,top:60,right:420,bottom:240,width:220}),classList:{toggle:(s,v)=>v?classes.add(s):classes.delete(s)}};
 const doc={elementFromPoint:()=>({closest:()=>el}),defaultView:{cancelAnimationFrame(){}}};
 const calls=[],root={ownerDocument:doc,getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600}),contains:x=>x===el,querySelectorAll:selector=>selector==='.node'?[el]:selector==='.graph-card-row,.node-heading'?[...rows,header]:rows,focus(){},setPointerCapture(){}};
 const graph={root,openCard(){},nodesById:new Map([['target',{id:'target',type:'linear'}]])};
 graph.blankDrop=e=>GraphView.prototype.blankDrop.call(graph,e);
 const removals=[];
 const drag=new CardDrag(graph,data=>calls.push(data),data=>removals.push(data));
 return {graph,drag,calls,removals,el,rows,classes,header,headerClasses};
}
test('drop compatibility uses explicit non-introduction authoring slots',()=>{
 assert.equal(cardDropSlot('linear','item'),'cards');assert.equal(cardDropSlot('fork','event'),'choices');assert.equal(cardDropSlot('fork','item'),null);
 assert.equal(cardDropSlot('container','item'),'items');assert.equal(cardDropSlot('container','event'),null);assert.equal(cardDropSlot('random','action'),null);assert.equal(cardDropSlot('legacySequence','event'),null);
});
test('drop gaps remain available at row edges, before first and after last',()=>{
 const {drag}=fixture(),d={cardKind:'event'};
 for(const [y,index] of [[100,0],[101,0],[139,1],[141,1],[181,2],[239,3]])assert.equal(drag.target({clientX:250,clientY:y},d).index,index);
 assert.equal(drag.target({clientX:-1,clientY:120},d),null);
});
test('incompatible nodes return a rejection target, not an insertion',()=>{
 const {drag,graph}=fixture();graph.nodesById.get('target').type='container';
 assert.equal(drag.target({clientX:250,clientY:120},{cardKind:'action'}).invalid,true);
});
test('row centres replace the pointed card while edges insert',()=>{
 const {drag}=fixture();
 for(const [y,id] of [[110,'card-0'],[120,'card-0'],[150,'card-1'],[200,'card-2']]){
  const target=drag.target({clientX:250,clientY:y},{cardKind:'event'});
  assert.equal(target.targetPlacementId,id);assert.equal(target.invalid,false);
 }
 assert.equal(drag.target({clientX:250,clientY:139},{cardKind:'event'}).index,1);
});
test('introduction replacement validates its own slot even when the main collection rejects the card',()=>{
 const {drag,graph,rows}=fixture();graph.nodesById.get('target').type='container';rows[0].dataset.cardSlot='intro';
 for(const cardKind of ['event','caption'])assert.equal(drag.target({clientX:250,clientY:120},{cardKind}).invalid,false);
 for(const cardKind of ['item','action'])assert.equal(drag.target({clientX:250,clientY:120},{cardKind}).invalid,true);
 assert.equal(drag.target({clientX:250,clientY:160},{cardKind:'event'}).invalid,true);
});
test('headers accept introduction-compatible kinds even when the intro is missing or disabled',()=>{
 for(const type of ['fork','container'])for(const intro of [undefined,{id:'existing-intro'}])for(const cardKind of ['event','caption']){
  const {drag,graph,header}=fixture();Object.assign(graph.nodesById.get('target'),{type,intro,introEnabled:false});
  const target=drag.target({clientX:250,clientY:80},{cardKind});
  assert.equal(target.header,header);assert.equal(target.slot,'intro');assert.equal(target.invalid,false);
 }
});
test('headers reject incompatible card kinds and nodes without introduction slots',()=>{
 for(const [type,kinds] of [['fork',['action','item','health','energy']],['container',['action','item']],['linear',['event','caption']],['random',['event']],['legacySequence',['event']]]){
  for(const cardKind of kinds){const {drag,graph}=fixture();graph.nodesById.get('target').type=type;
   assert.equal(drag.target({clientX:250,clientY:80},{cardKind}).invalid,true);
  }
 }
});
test('header release explicitly requests the intro slot without needing an existing placement',()=>{
 const {drag,graph,calls}=fixture();graph.nodesById.get('target').type='fork';
 drag.finish({clientX:250,clientY:80,altKey:true},{sourceNodeId:'source',placementId:'card',cardKind:'caption',moved:true});
 assert.deepEqual(calls,[{sourceNodeId:'source',placementId:'card',targetNodeId:'target',targetSlot:'intro',copy:true}]);
});
test('own header accepts an ordinary card but rejects its current introduction',()=>{
 const {drag,graph}=fixture();Object.assign(graph.nodesById.get('target'),{type:'fork',intro:{id:'intro'}});
 assert.equal(drag.target({clientX:250,clientY:80},{sourceNodeId:'target',placementId:'card',cardKind:'event'}).invalid,false);
 assert.equal(drag.target({clientX:250,clientY:80},{sourceNodeId:'target',placementId:'intro',cardKind:'event'}).invalid,true);
});
test('header feedback highlights the header and hides the insertion line; cleanup clears it',()=>{
 const {drag,graph,headerClasses}=fixture();graph.nodesById.get('target').type='container';
 drag.ghost={style:{},remove(){}};drag.line={style:{},remove(){}};
 drag.paint({clientX:250,clientY:80,cardKind:'event',name:'Story'});
 assert.equal(headerClasses.has('card-drop-replace'),true);assert.equal(drag.line.hidden,true);
 assert.equal(drag.ghost.textContent,'Introduction · Story');
 drag.paint({clientX:250,clientY:80,cardKind:'item',name:'Item'});
 assert.equal(headerClasses.has('card-drop-replace'),false);assert.equal(headerClasses.has('card-drop-invalid'),true);
 drag.clear();assert.equal(headerClasses.size,0);
});
test('dropping a card onto itself is rejected, including an Alt copy',()=>{
 const {drag,calls}=fixture(),d={sourceNodeId:'target',placementId:'card-0',cardKind:'event',moved:true};
 drag.finish({clientX:250,clientY:120,altKey:true},d);assert.deepEqual(calls,[]);
});
test('replacement release emits the placement target instead of an insertion gap',()=>{
 const {drag,calls}=fixture();
 drag.finish({clientX:250,clientY:120,altKey:false},{sourceNodeId:'source',placementId:'intro',cardKind:'caption',moved:true});
 assert.deepEqual(calls,[{sourceNodeId:'source',placementId:'intro',targetNodeId:'target',targetPlacementId:'card-0',copy:false}]);
});
test('introductions and ordinary card gestures capture without edits',()=>{
 const {drag,graph,calls}=fixture(),node={dataset:{id:'source'}},row={dataset:{cardSlot:'intro',cardPlacement:'intro',cardType:'event'}};
 const name={textContent:'Card',closest:s=>s==='.node'?node:row},e={pointerId:3,clientX:40,clientY:40,altKey:true,preventDefault(){}};
 assert.equal(drag.start(e,name),true);assert.equal(graph.drag.placementId,'intro');
 row.dataset.cardSlot='cards';assert.equal(drag.start(e,name),true);assert.equal(graph.drag.copy,true);assert.equal(graph.drag.placementId,'intro');assert.deepEqual(calls,[]);
});
test('only moved, valid drops emit one edit and use Alt state at release',()=>{
 const {drag,calls}=fixture(),d={sourceNodeId:'source',placementId:'card',cardKind:'event',moved:true};
 drag.finish({clientX:250,clientY:141,altKey:true},d);
 assert.deepEqual(calls,[{sourceNodeId:'source',placementId:'card',targetNodeId:'target',index:1,copy:true}]);
 drag.finish({clientX:250,clientY:141}, {...d,moved:false});drag.finish({clientX:900,clientY:141},d);assert.equal(calls.length,1);
});
test('drag click suppression is consumed once and cleanup clears drop outlines',()=>{
 const {drag,classes}=fixture();drag.suppressClick=true;classes.add('card-drop-target');drag.clear();
 assert.equal(classes.size,0);assert.equal(drag.consumeClick(),true);assert.equal(drag.consumeClick(),false);
});

test('moving onto empty canvas removes once; copy, click, outside and invalid node drops preserve the card',()=>{
 const {drag,graph,calls,removals,el}=fixture();
 const d={sourceNodeId:'source',placementId:'card',cardKind:'event',moved:true};
 graph.root.ownerDocument.elementFromPoint=()=>null;
 drag.finish({clientX:100,clientY:300,altKey:false},d);
 assert.deepEqual(removals,[{sourceNodeId:'source',placementId:'card'}]);
 drag.finish({clientX:100,clientY:300,altKey:true},d);
 drag.finish({clientX:100,clientY:300,altKey:false},{...d,moved:false});
 drag.finish({clientX:900,clientY:300,altKey:false},d);
 graph.root.ownerDocument.elementFromPoint=()=>({closest:()=>el});
 graph.nodesById.get('target').type='random';
 drag.finish({clientX:250,clientY:120,altKey:false},d);
 graph.root.ownerDocument.elementFromPoint=()=>({closest:()=>null});
 drag.finish({clientX:100,clientY:300,altKey:false},d);
 assert.equal(removals.length,1);assert.deepEqual(calls,[]);
});
test('blank canvas feedback previews removal and keeps Alt copying distinct',()=>{
 const {drag,graph}=fixture();
 graph.root.ownerDocument.elementFromPoint=()=>null;
 drag.ghost={style:{},remove(){}};drag.line={style:{},remove(){}};
 drag.paint({clientX:100,clientY:300,name:'Card',copy:false});
 assert.equal(drag.ghost.textContent,'Remove · Card');
 drag.paint({clientX:100,clientY:300,name:'Card',copy:true});
 assert.equal(drag.ghost.textContent,'+ Copy · Card');
});
