import test from 'node:test';
import assert from 'node:assert/strict';
import { uiScale } from '../studio/ui-scale.js';
import { GraphView } from '../studio/GraphView.js';
import { CardDrag } from '../studio/card-drag.js';

// These fixtures verify coordinate math/event routing; browser CSS layout is separate.
function fixture(zoom='.8') {
 const world={style:{setProperty(key,value){this[key]=value;}}},handlers={},moves=[],selections=[];
 const node={id:'a',x:100,y:200};
 const el={dataset:{id:'a'},style:{},closest(selector){return selector==='.node'?this:null;},getBoundingClientRect:()=>({width:88,height:48})};
 const root={classList:{toggle(){}},ownerDocument:{documentElement:{},defaultView:{getComputedStyle:()=>({zoom})}},
  getBoundingClientRect:()=>({left:80,top:40,width:800,height:640,right:880,bottom:680}),
  addEventListener:(name,fn)=>{handlers[name]=fn;},querySelector:()=>world,
  querySelectorAll:()=>[],focus(){},setPointerCapture(){},hasPointerCapture:()=>false};
 const graph=new GraphView(root,{onSelect:id=>selections.push(id),onMove:(...args)=>moves.push(args)});
 graph.nodesById=new Map([['a',node]]);graph.nodeElements=new Map([['a',el]]);graph.chapter={nodes:[node]};graph.edges=()=>{};
 graph.view={x:30,y:40,z:.5};
 const event=(clientX,clientY,target=root,pointerId=1)=>({clientX,clientY,target,pointerId,button:0,preventDefault(){}});
 root.closest=()=>null;
 return {root,graph,world,handlers,node,el,moves,selections,event};
}

test('UI scale uses root computed zoom and defaults safely for fake or unzoomed DOM',()=>{
 assert.equal(uiScale(fixture().root),.8);
 for(const zoom of ['normal','',null,'0','-1','Infinity'])assert.equal(uiScale(fixture(zoom).root),1);
 assert.equal(uiScale({ownerDocument:{defaultView:{}}}),1);
 assert.equal(uiScale(null),1);
});

test('point and measured output coordinates account for editor zoom, graph origin, pan and graph zoom',()=>{
 const {graph}=fixture();
 assert.deepEqual(graph.point({clientX:320,clientY:200}),{x:540,y:320});
 graph.portElements=new Map([['a',new Map([['next',{getBoundingClientRect:()=>({right:320,top:192,width:88,height:16})}]])]]);
 assert.deepEqual(graph.outputPoint({id:'a'},'next'),{x:540,y:320});
});

test('pan follows screen pointer distance and ignores unrelated pointers',()=>{
 const {graph,event}=fixture();
 graph.down(event(200,100));graph.move(event(280,140,undefined,2));
 assert.deepEqual(graph.view,{x:30,y:40,z:.5});
 graph.move(event(280,140));assert.deepEqual(graph.view,{x:130,y:90,z:.5});
 assert.equal((graph.view.x-30)*.8,80);
});

test('node drag divides screen movement by editor and graph zoom, then commits layout position',()=>{
 const {graph,event,el,moves,node}=fixture();
 graph.down(event(200,100,el));graph.move(event(280,140));
 assert.deepEqual({x:graph.drag.px,y:graph.drag.py},{x:300,y:300});
 assert.equal(el.style.left,'300px');assert.equal(el.style.top,'300px');
 assert.deepEqual(node,{id:'a',x:100,y:200});
 graph.up(event(280,140));assert.deepEqual(moves,[['a',300,300]]);
});

test('wheel zoom keeps the graph coordinate under the screen pointer anchored',()=>{
 const {graph,handlers,event}=fixture(),e={...event(320,200),deltaY:-200};
 const before=graph.point(e);handlers.wheel(e);const after=graph.point(e);
 assert.ok(graph.view.z>.5);assert.ok(Math.abs(before.x-after.x)<1e-10);assert.ok(Math.abs(before.y-after.y)<1e-10);
});

test('centerOn uses unzoomed viewport and measured node size',()=>{
 const {graph,selections}=fixture();graph.centerOn('a');
 assert.deepEqual(graph.view,{x:395,y:270,z:.5});assert.deepEqual(selections,['a']);
 // Node center lands at the visual viewport center after both scales.
 assert.equal((graph.view.x+(100+110)*.5)*.8,400);
 assert.equal((graph.view.y+(200+60)*.5)*.8,320);
});

test('fit computes graph zoom and margins using layout viewport dimensions',()=>{
 const {graph}=fixture();graph.chapter.nodes=[{x:0,y:0},{x:1000,y:0}];graph.fit();
 assert.equal(graph.view.z,920/1220);assert.equal(graph.view.x,40);assert.equal(graph.view.y,40);
 assert.ok((graph.view.x+1220*graph.view.z)*.8<=800);
});

test('card drag overlays convert fixed coordinates while hit testing retains screen coordinates',()=>{
 const {graph,root}=fixture(),drag=new CardDrag(graph,()=>{});
 const target={nodeEl:{classList:{toggle(){}},getBoundingClientRect:()=>({left:200,width:176,bottom:300}),querySelector:()=>null},rows:[{getBoundingClientRect:()=>({top:160})}],index:0};
 const d={clientX:250,clientY:160,name:'Card'};
 drag.target=(e)=>{assert.equal(e.clientX,250);assert.equal(e.clientY,160);return target;};
 drag.ghost={style:{}};drag.line={style:{}};drag.paint(d);
 assert.deepEqual(drag.ghost.style,{left:'330px',top:'217.5px'});
 assert.deepEqual(drag.line.style,{left:'253.75px',top:'200px',width:'212.5px'});
 assert.equal(drag.line.hidden,false);
 let frame;root.ownerDocument.defaultView.requestAnimationFrame=callback=>{frame=callback;return 1;};
 graph.drag={kind:'card',moved:true,clientX:85,clientY:200};graph.transform=()=>{};drag.paint=()=>{};
 const previous=graph.view.x;drag.tick();frame();assert.equal((graph.view.x-previous)*.8,6);
});
