import test from 'node:test';
import assert from 'node:assert/strict';
import { CardDrag,cardDropSlot } from '../studio/card-drag.js';

function fixture(){
 const classes=new Set();
 const rows=[0,1,2].map((i)=>({dataset:{cardSlot:'cards'},getBoundingClientRect:()=>({top:100+i*40,height:40,bottom:140+i*40})}));
 const el={dataset:{id:'target'},querySelectorAll:()=>rows,getBoundingClientRect:()=>({left:200,top:60,right:420,bottom:240,width:220}),classList:{toggle:(s,v)=>v?classes.add(s):classes.delete(s)}};
 const doc={elementFromPoint:()=>({closest:()=>el}),defaultView:{cancelAnimationFrame(){}}};
 const calls=[],root={ownerDocument:doc,getBoundingClientRect:()=>({left:0,top:0,right:800,bottom:600}),contains:x=>x===el,querySelectorAll:()=>[el],focus(){},setPointerCapture(){}};
 const graph={root,openCard(){},nodesById:new Map([['target',{id:'target',type:'linear'}]])};
 const drag=new CardDrag(graph,data=>calls.push(data));
 return {graph,drag,calls,el,rows,classes};
}
test('drop compatibility uses explicit non-introduction authoring slots',()=>{
 assert.equal(cardDropSlot('linear','item'),'cards');assert.equal(cardDropSlot('fork','event'),'choices');assert.equal(cardDropSlot('fork','item'),null);
 assert.equal(cardDropSlot('container','item'),'items');assert.equal(cardDropSlot('container','event'),null);assert.equal(cardDropSlot('random','action'),null);assert.equal(cardDropSlot('legacySequence','event'),null);
});
test('drop gaps use displayed row midpoints, including before first and after last',()=>{
 const {drag}=fixture(),d={cardKind:'event'};
 for(const [y,index] of [[60,0],[119,0],[120,1],[159,1],[200,3],[239,3]])assert.equal(drag.target({clientX:250,clientY:y},d).index,index);
 assert.equal(drag.target({clientX:-1,clientY:120},d),null);
});
test('incompatible nodes return a rejection target, not an insertion',()=>{
 const {drag,graph}=fixture();graph.nodesById.get('target').type='container';
 assert.equal(drag.target({clientX:250,clientY:120},{cardKind:'action'}).invalid,true);
});
test('introductions cannot start a drag; ordinary card gestures capture without edits',()=>{
 const {drag,graph,calls}=fixture(),node={dataset:{id:'source'}},row={dataset:{cardSlot:'intro',cardPlacement:'intro',cardType:'event'}};
 const name={textContent:'Card',closest:s=>s==='.node'?node:row},e={pointerId:3,clientX:40,clientY:40,altKey:true,preventDefault(){}};
 assert.equal(drag.start(e,name),false);assert.equal(graph.drag,undefined);
 row.dataset.cardSlot='cards';assert.equal(drag.start(e,name),true);assert.equal(graph.drag.copy,true);assert.equal(graph.drag.placementId,'intro');assert.deepEqual(calls,[]);
});
test('only moved, valid drops emit one edit and use Alt state at release',()=>{
 const {drag,calls}=fixture(),d={sourceNodeId:'source',placementId:'card',cardKind:'event',moved:true};
 drag.finish({clientX:250,clientY:140,altKey:true},d);
 assert.deepEqual(calls,[{sourceNodeId:'source',placementId:'card',targetNodeId:'target',index:1,copy:true}]);
 drag.finish({clientX:250,clientY:140}, {...d,moved:false});drag.finish({clientX:900,clientY:140},d);assert.equal(calls.length,1);
});
test('drag click suppression is consumed once and cleanup clears drop outlines',()=>{
 const {drag,classes}=fixture();drag.suppressClick=true;classes.add('card-drop-target');drag.clear();
 assert.equal(classes.size,0);assert.equal(drag.consumeClick(),true);assert.equal(drag.consumeClick(),false);
});
