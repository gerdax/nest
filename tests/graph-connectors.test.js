import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../studio/GraphView.js';
import { createDefinition,cardEditorTint } from '../project/cards.js';

// This fixture exercises event routing and generated SVG, not browser layout.
class Element {
 constructor(classes='',dataset={},parent=null){this.classes=new Set(classes.split(' '));this.dataset=dataset;this.parent=parent;this.style={};this.children=[];this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
 closest(selector){for(let el=this;el;el=el.parent)if(el.classes.has(selector.slice(1)))return el;return null;}
 querySelectorAll(selector){return this.children.filter(el=>el.classes.has(selector.slice(1)));}
 getBoundingClientRect(){return {width:0,height:0};}
}
class Root extends Element {
 constructor(){super();this.handlers={};this.capture=null;this.parts={'#world':new Element(),'#edges':new Element(),'#nodes':new Element()};this.ownerDocument={elementFromPoint:()=>this.hit};
  Object.defineProperty(this.parts['#nodes'],'innerHTML',{set:html=>{
   this.parts['#nodes'].rendered=html;
   this.nodes=[...html.matchAll(/<article class="([^"]*)" data-id="([^"]*)"[^>]*>(.*?)<\/article>/g)].map(([,classes,id,body])=>{
    const node=new Element(classes,{id},this);node.children=[...body.matchAll(/<button class="([^"]*)" data-exit="([^"]*)"/g)].map(([,cls,exit])=>new Element(cls,{exit},node));return node;
   });
  }});
 }
 addEventListener(name,callback){this.handlers[name]=callback;}
 querySelector(selector){return this.parts[selector];}
 querySelectorAll(selector){return selector==='.node'?this.nodes:[];}
 contains(el){return el?.parent===this;}
 getBoundingClientRect(){return {left:10,top:20,right:1010,bottom:820,width:1000,height:800};}
 setPointerCapture(id){this.capture=id;}
 hasPointerCapture(id){return this.capture===id;}
 releasePointerCapture(id){this.capture=null;this.handlers.lostpointercapture({pointerId:id});}
 focus(){}
 node(id){return this.nodes.find(n=>n.dataset.id===id);}
 event(name,target,x=300,y=200,pointerId=1){this.handlers[name]({target,clientX:x,clientY:y,pointerId,button:0,preventDefault(){}});}
}
function setup(){
 const nodes=[{id:'a',name:'A',type:'linear',cards:[],x:0,y:0,connections:{next:'b'}},{id:'b',name:'B',type:'linear',cards:[],x:400,y:50,connections:{next:null}},{id:'c',name:'C',type:'linear',cards:[],x:600,y:150,connections:{next:null}}];
 const chapter={nodes,startNode:'a'},project={library:[]},root=new Root(),calls=[],moves=[],selections=[],opened=[];
 const graph=new GraphView(root,{onSelect:id=>selections.push(id),onOpenCard:(...args)=>opened.push(args),onConnect:(...args)=>calls.push(args),onMove:(...args)=>moves.push(args)});graph.render(project,chapter,'a','b');
 return {root,graph,chapter,calls,moves,selections,opened,port:()=>root.node('a').children[0]};
}
test('port drag captures on root, highlights hit node, and commits only on release',()=>{
 const s=setup();s.root.event('pointerdown',s.port(),200,100);assert.equal(s.root.capture,1);
 s.root.hit=s.root.node('c');s.root.event('pointermove',s.root,700,220);
 assert.equal(s.root.node('c').classes.has('connection-target'),true);assert.match(s.root.parts['#edges'].innerHTML,/edge-ghost/);assert.deepEqual(s.calls,[]);
 s.root.event('pointerup',s.root,700,220);assert.deepEqual(s.calls,[['a','next','c']]);assert.equal(s.graph.pending,null);assert.doesNotMatch(s.root.parts['#edges'].innerHTML,/edge-ghost/);assert.equal(s.root.node('b').classes.has('active'),true);
});
test('clicking or dragging an existing line neither reroutes nor pans the graph',()=>{
 const s=setup(),edge=new Element('edge-hit',{source:'a',exit:'next'},s.root),before={...s.graph.view};
 assert.match(s.root.parts['#edges'].innerHTML,/class="edge-hit" data-source="a" data-exit="next"/);
 s.root.event('pointerdown',edge);assert.equal(s.graph.drag,null);assert.equal(s.root.capture,null);
 s.root.hit=s.root.node('c');s.root.event('pointermove',s.root,700,220);s.root.event('pointerup',s.root,700,220);
 assert.deepEqual(s.calls,[]);assert.deepEqual(s.graph.view,before);assert.equal(s.chapter.nodes[0].connections.next,'b');
});
test('double-clicking an existing line disconnects exactly its source output',()=>{
 const s=setup(),edge=new Element('edge-hit',{source:'a',exit:'next'},s.root);
 s.root.handlers.dblclick({target:edge,preventDefault(){}});
 assert.deepEqual(s.calls,[['a','next',false]]);assert.deepEqual(s.selections,[]);assert.deepEqual(s.opened,[]);
 s.root.handlers.dblclick({target:s.port(),preventDefault(){}});assert.equal(s.calls.length,1);
});
for(const drop of ['self','outside','foreign'])test(`${drop} moved drop preserves connection and clears pending`,()=>{
 const s=setup();s.root.event('pointerdown',s.port(),200,100);s.root.hit=drop==='self'?s.root.node('a'):drop==='foreign'?new Element('node',{id:'c'}):null;
 if(drop==='outside')s.root.hit=s.root.node('c');
 s.root.event('pointerup',s.root,drop==='outside'?1015:700,220);
 assert.deepEqual(s.calls,[]);assert.equal(s.chapter.nodes[0].connections.next,'b');assert.equal(s.graph.pending,null);
});
for(const kind of ['pointercancel','lostpointercapture','Escape'])test(`${kind} cancels without disconnecting`,()=>{
 const s=setup();s.root.event('pointerdown',s.port());s.root.hit=s.root.node('c');s.root.event('pointermove',s.root,700,220);
 if(kind==='Escape')s.root.handlers.keydown({key:'Escape'});else s.root.event(kind,s.root);
 assert.equal(s.graph.drag,null);assert.equal(s.graph.pending,null);assert.deepEqual(s.calls,[]);assert.equal(s.chapter.nodes[0].connections.next,'b');assert.doesNotMatch(s.root.parts['#edges'].innerHTML,/edge-ghost/);
});
test('stationary output-description click does nothing without panning or connecting',()=>{
 const s=setup();s.root.event('pointerdown',s.port());s.root.event('pointerup',s.root);
 assert.deepEqual(s.calls,[]);assert.equal(s.graph.pending,null);
 assert.deepEqual(s.graph.view,{x:50,y:50,z:1});assert.deepEqual(s.selections,[]);assert.deepEqual(s.opened,[]);
 s.root.event('pointerdown',s.root.node('c'));assert.deepEqual(s.calls,[]);
});
test('moved output-link drop on empty canvas unlinks only that output',()=>{
 const s=setup();s.root.event('pointerdown',s.port(),200,100);s.root.hit=null;s.root.event('pointerup',s.root,700,220);
 assert.deepEqual(s.calls,[['a','next',false]]);assert.equal(s.graph.pending,null);
});
test('unlinked ports have an explicit class and do not pan on click',()=>{
 const s=setup();s.chapter.nodes[0].connections.next=false;s.graph.render(s.graph.project,s.chapter,'a');
 assert.match(s.root.parts['#nodes'].rendered,/class="port unlinked" data-exit="next"[^>]*>Next → Unlinked/);
 const before={...s.graph.view};s.root.event('pointerdown',s.port());s.root.event('pointerup',s.root);
 assert.deepEqual(s.graph.view,before);assert.deepEqual(s.calls,[]);
});
test('keyboard output-description activation does nothing',()=>{
 const s=setup();s.root.handlers.click({detail:0,target:s.port()});
 assert.deepEqual(s.selections,[]);assert.deepEqual(s.opened,[]);assert.deepEqual(s.calls,[]);
});
test('double clicking the same connector centers and selects only its target',()=>{
 const s=setup();
 s.graph.activatePort('a','next',1000,300,200);s.graph.activatePort('a','next',1200,300,200);
 assert.deepEqual(s.graph.view,{x:-10,y:290,z:1});assert.deepEqual(s.selections,['b']);
 assert.deepEqual(s.opened,[]);assert.deepEqual(s.calls,[]);
});
test('slow clicks or canceled interactions do not trigger target navigation',()=>{
 const s=setup();s.graph.activatePort('a','next',1000,300,200);s.graph.activatePort('a','next',1600,300,200);
 s.graph.cancel();s.graph.activatePort('a','next',1700,300,200);
 assert.deepEqual(s.selections,[]);assert.equal(s.opened.length,0);
});
test('clicking or keyboard activating a card name opens that exact card without dragging',()=>{
 for(const detail of [0,1]){
  const s=setup(),row=new Element('graph-card-row',{cardPlacement:'chosen-card'},s.root.node('a')),name=new Element('graph-card-name',{},row);
  s.root.event('pointerdown',name);assert.equal(s.graph.drag,null);assert.equal(s.root.capture,null);
  s.root.handlers.click({detail,target:name});
  assert.deepEqual(s.opened,[['a',{chapterId:undefined,nodeId:'a',placementId:'chosen-card'}]]);
  assert.deepEqual(s.selections,[]);assert.deepEqual(s.calls,[]);
 }
});
test('graph groups card types with shared tints and keeps check outcomes in one row',()=>{
 const s=setup(),library=['event','caption','action','item'].map(kind=>({...createDefinition(kind,kind),name:`${kind} card`}));
 const node={id:'fork',name:'Fork',type:'fork',x:0,y:0,intro:{id:'intro',definitionId:'event'},choices:[{id:'story',definitionId:'caption'},{id:'direct',definitionId:'action'},{id:'check',definitionId:'action',overrides:{resolution:'check'}}],connections:{story:'b',direct:'b','check:success':'b','check:failure':false}};
 s.graph.render({library},{nodes:[node,s.chapter.nodes[1]],startNode:node.id},node.id);
 const html=s.root.parts['#nodes'].rendered;
 for(const kind of ['event','caption','action'])assert.ok(html.includes(`--card-editor-tint:${cardEditorTint(kind)}`));
 assert.equal((html.match(/class="graph-card-divider"/g)||[]).length,4);
 const check=html.slice(html.indexOf('data-card-placement="check"'),html.indexOf('</article>'));
 assert.match(check,/Success \| B/);assert.match(check,/Failure \| Unlinked/);
 assert.equal((check.match(/class="graph-card-name"/g)||[]).length,1);assert.doesNotMatch(check,/graph-card-divider/);
 assert.equal(s.graph.portElements.get(node.id).size,4);
 node.introEnabled=false;s.graph.render({library},{nodes:[node,s.chapter.nodes[1]],startNode:node.id});
 assert.doesNotMatch(s.root.parts['#nodes'].rendered,/data-card-placement="intro"/);
});
test('Linear and Container rows show their cards separately from their shared Next connector',()=>{
 const s=setup(),library=[{...createDefinition('event','event'),name:'Story'},{...createDefinition('item','item'),name:'Loot'}];
 for(const node of [{type:'linear',cards:[{id:'first',definitionId:'event'},{id:'second',definitionId:'item'}]},{type:'container',intro:{id:'intro',definitionId:'event'},items:[{id:'loot',definitionId:'item'}]}]){
  const beat={id:'cards',name:'Cards',x:0,y:0,connections:{next:null},...node};
  s.graph.render({library},{nodes:[beat],startNode:beat.id});
  const html=s.root.parts['#nodes'].rendered;
  assert.equal((html.match(/class="graph-card-row /g)||[]).length,2);
  assert.equal((html.match(/data-exit="next"/g)||[]).length,1);
  assert.ok(html.indexOf('data-exit="next"')>html.lastIndexOf('graph-card-name'));
 }
});
test('unrelated pointer cannot move, commit, or cancel an active gesture',()=>{
 const s=setup();s.root.event('pointerdown',s.port());s.root.event('pointercancel',s.root,700,220,2);s.root.event('pointermove',s.root,700,220,2);s.root.event('pointerup',s.root,700,220,2);assert.equal(s.graph.drag.moved,false);assert.equal(s.root.capture,1);assert.deepEqual(s.calls,[]);
});
test('ghost coordinates account for root offset, pan, and zoom',()=>{
 const s=setup();s.graph.view={x:30,y:40,z:.5};s.root.event('pointerdown',s.port(),200,100);s.root.event('pointermove',s.root,300,200);
 assert.equal(s.graph.drag.px,520);assert.equal(s.graph.drag.py,280);assert.match(s.root.parts['#edges'].innerHTML,/edge-ghost" d="M220,104 C310,104 430,280 520,280/);
});
test('moving source and target updates wires immediately without mutating document coordinates',()=>{
 const s=setup();s.graph.view.z=.5;s.root.event('pointerdown',s.root.node('b'),300,200);s.root.event('pointermove',s.root,350,225);
 assert.match(s.root.parts['#edges'].innerHTML,/410,140 500,140/);assert.equal(s.chapter.nodes[1].x,400);s.root.event('pointerup',s.root,350,225);assert.deepEqual(s.moves,[['b',500,100]]);
 s.graph.cancel();s.root.event('pointerdown',s.root.node('a'),300,200);s.root.event('pointermove',s.root,350,225);assert.match(s.root.parts['#edges'].innerHTML,/M320,154 C410,154/);s.graph.cancel();assert.match(s.root.parts['#edges'].innerHTML,/M220,104 C310,104/);
});
test('output geometry uses measured port center when layout is available',()=>{
 const s=setup();s.graph.view={x:30,y:40,z:.5};s.port().getBoundingClientRect=()=>({right:200,top:100,width:110,height:20});s.graph.edges();assert.match(s.root.parts['#edges'].innerHTML,/M320,100 C410,100/);
});


test('preview-triggered rerender keeps node and incoming wire at transient drag coordinates',()=>{
 const s=setup();s.graph.view.z=.5;s.root.event('pointerdown',s.root.node('b'),300,200);s.root.event('pointermove',s.root,350,225);
 s.graph.render(s.graph.project,s.chapter,'b','c');
 assert.match(s.root.parts['#nodes'].rendered,/data-id="b" style="left:500px;top:100px"/);
 assert.match(s.root.parts['#edges'].innerHTML,/410,140 500,140/);assert.equal(s.chapter.nodes[1].x,400);
 s.graph.cancel();assert.match(s.root.parts['#nodes'].rendered,/data-id="b" style="left:400px;top:50px"/);
});

test('card nodes omit the count bar while random nodes retain route summaries',()=>{
 const s=setup();
 const summary=node=>{
  const chapter={startNode:'summary',nodes:[{id:'summary',name:'Summary',x:0,y:0,connections:{},...node}]};
  s.graph.render({library:[]},chapter);
  return s.root.parts['#nodes'].rendered.match(/<div class="node-body">([^<]*)<\/div>/)?.[1];
 };
 assert.equal(summary({type:'linear',cards:[{},{}]}),undefined);
 assert.equal(summary({type:'linear',cards:[{}]}),undefined);
 assert.equal(summary({type:'linear',cards:[] }),undefined);
 for(const [type,slot] of [['fork','choices'],['container','items']]) {
  const node={type,[slot]:[{id:'one'},{id:'two'}],intro:{id:'intro'}};
  assert.equal(summary(node),undefined);
  assert.equal(summary({...node,introEnabled:true,introOnce:true}),undefined);
  assert.equal(summary({...node,introEnabled:false}),undefined);
  assert.equal(summary({...node,intro:undefined}),undefined);
  assert.equal(summary({...node,[slot]:[]}),undefined);
 }
 assert.equal(summary({type:'random',routes:[{id:'route'}]}),'1 route');
 assert.equal(summary({type:'random',routes:[{id:'one'},{id:'two'}]}),'2 routes');
});
