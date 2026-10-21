import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../studio/GraphView.js';
import { createDefinition,cardEditorTint } from '../project/cards.js';

// This fixture exercises event routing and generated SVG, not browser layout.
class Element {
 constructor(classes='',dataset={},parent=null){this.classes=new Set(classes.split(' '));this.dataset=dataset;this.parent=parent;this.style={setProperty(key,value){this[key]=value;}};this.children=[];this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
 closest(selector){for(let el=this;el;el=el.parent)if(el.classes.has(selector.slice(1)))return el;return null;}
 querySelectorAll(selector){return [...this.children,...(this.cardRows||[])].filter(el=>el.classes.has(selector.slice(1)));}
 getBoundingClientRect(){return {width:0,height:0};}
}
class Root extends Element {
 constructor(){super();this.handlers={};this.capture=null;this.parts={'#world':new Element(),'#edges':new Element(),'#nodes':new Element()};this.ownerDocument={elementFromPoint:()=>this.hit};
  Object.defineProperty(this.parts['#nodes'],'innerHTML',{set:html=>{
   this.parts['#nodes'].rendered=html;
   this.nodes=[...html.matchAll(/<article class="([^"]*)" data-id="([^"]*)"[^>]*>(.*?)<\/article>/g)].map(([,classes,id,body])=>{
    const node=new Element(classes,{id},this);node.cardRows=[...body.matchAll(/<div class="(graph-card-row[^"]*)" data-card-slot="[^"]*" data-card-placement="([^"]*)"/g)].map(([,cls,cardPlacement])=>new Element(cls,{cardPlacement},node));node.children=[...body.matchAll(/<button class="([^"]*)" data-exit="([^"]*)"/g)].map(([,cls,exit])=>new Element(cls,{exit},node));return node;
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
 focus(){this.focused=true;}
 node(id){return this.nodes.find(n=>n.dataset.id===id);}
 event(name,target,x=300,y=200,pointerId=1){this.handlers[name]({target,clientX:x,clientY:y,pointerId,button:0,preventDefault(){}});}
}
function setup(){
 const nodes=[{id:'a',name:'A',type:'linear',cards:[],x:0,y:0,connections:{next:'b'}},{id:'b',name:'B',type:'linear',cards:[],x:400,y:50,connections:{next:null}},{id:'c',name:'C',type:'linear',cards:[],x:600,y:150,connections:{next:null}}];
 const chapter={nodes,startNode:'a'},project={library:[],allowCycles:false},root=new Root(),calls=[],moves=[],selections=[],opened=[],deleted=[],creations=[],groups=[],groupMoves=[];
 const graph=new GraphView(root,{onSelectMany:ids=>groups.push(ids),onMoveMany:positions=>groupMoves.push(positions),onCreateConnected:request=>creations.push(request),onDelete:id=>deleted.push(id),onSelect:id=>selections.push(id),onOpenCard:(...args)=>opened.push(args),onConnect:(...args)=>calls.push(args),onMove:(...args)=>moves.push(args)});graph.render(project,chapter,'a','b');
 return {root,graph,chapter,calls,moves,selections,opened,deleted,creations,groups,groupMoves,port:()=>root.node('a').children[0]};
}
test('Delete and Mac Backspace delete the selected beat through the graph callback',()=>{
 for(const key of ['Delete','Backspace']){
  const s=setup();let prevented=false;
  s.root.handlers.keydown({key,target:s.root,preventDefault(){prevented=true;}});
  assert.deepEqual(s.deleted,['a']);assert.equal(prevented,true);
 }
});
test('beat deletion ignores typing, held keys, modifiers, composition, and active gestures',()=>{
 for(const guard of [{repeat:true},{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{defaultPrevented:true},{target:{closest:()=>({})}}]){
  const s=setup();s.root.handlers.keydown({key:'Backspace',target:s.root,...guard,preventDefault(){assert.fail('must preserve input');}});assert.deepEqual(s.deleted,[]);
 }
 const s=setup();s.root.event('pointerdown',s.root.node('a'));
 s.root.handlers.keydown({key:'Delete',target:s.root});assert.deepEqual(s.deleted,[]);
 s.graph.cancel();s.graph.selected='missing';s.root.handlers.keydown({key:'Delete',target:s.root});assert.deepEqual(s.deleted,[]);
});
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
test('stationary output-description click selects its target without panning or connecting',()=>{
 const s=setup();s.root.event('pointerdown',s.port());s.root.event('pointerup',s.root);
 assert.deepEqual(s.calls,[]);assert.equal(s.graph.pending,null);
 assert.deepEqual(s.graph.view,{x:50,y:50,z:1});assert.deepEqual(s.selections,['b']);assert.deepEqual(s.opened,[]);
 s.root.event('pointerdown',s.root.node('c'));assert.deepEqual(s.calls,[]);
});
test('moved output-link drop on empty canvas unlinks only that output',()=>{
 const s=setup();s.root.event('pointerdown',s.port(),200,100);s.root.hit=null;s.root.event('pointerup',s.root,700,220);
 assert.deepEqual(s.calls,[['a','next',false]]);assert.equal(s.graph.pending,null);
});
test('unlinked ports have an explicit class and do not pan on click',()=>{
 const s=setup();s.chapter.nodes[0].connections.next=false;s.graph.render(s.graph.project,s.chapter,'a');
 assert.match(s.root.parts['#nodes'].rendered,/class="port unlinked" data-exit="next"[^>]*>→ Unlinked/);
 const before={...s.graph.view};s.root.event('pointerdown',s.port());s.root.event('pointerup',s.root);
 assert.deepEqual(s.graph.view,before);assert.deepEqual(s.calls,[]);
});
test('keyboard output-description activation selects the target',()=>{
 const s=setup();s.root.handlers.click({detail:0,target:s.port()});
 assert.deepEqual(s.selections,['b']);assert.deepEqual(s.opened,[]);assert.deepEqual(s.calls,[]);
});
test('double clicking the same connector centers and selects only its target',()=>{
 const s=setup();
 s.graph.activatePort('a','next',1000,300,200);s.graph.activatePort('a','next',1200,300,200);
 assert.deepEqual(s.graph.view,{x:-10,y:290,z:1});assert.deepEqual(s.selections,['b','b']);
 assert.deepEqual(s.opened,[]);assert.deepEqual(s.calls,[]);
});
test('slow clicks select targets without centering and cancel clears double-click tracking',()=>{
 const s=setup();s.graph.activatePort('a','next',1000,300,200);s.graph.activatePort('a','next',1600,300,200);
 s.graph.cancel();s.graph.activatePort('a','next',1700,300,200);
 assert.deepEqual(s.selections,['b','b','b']);assert.deepEqual(s.graph.view,{x:50,y:50,z:1});assert.equal(s.opened.length,0);
});
test('clicking or keyboard activating a card name opens that exact card without dragging',()=>{
 for(const detail of [0,1]){
  const s=setup(),row=new Element('graph-card-row',{cardPlacement:'chosen-card'},s.root.node('a')),name=new Element('graph-card-name',{},row);
  if(detail){s.root.event('pointerdown',name);assert.equal(s.graph.drag.kind,'card');assert.equal(s.root.capture,1);
  s.root.event('pointerup',name);}
  s.root.handlers.click({detail,target:name,preventDefault(){}});
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
 assert.match(check,/data-exit="check:success"[^>]*>→ B<\/button>/);assert.match(check,/data-exit="check:failure"[^>]*>→ Unlinked<\/button>/);
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

test('preview highlighting keeps node identity, edge markup, viewport, selection and pending interaction',()=>{
 const s=setup(),nodes=s.graph.nodeElements,ports=s.graph.portElements,edgeMarkup=s.root.parts['#edges'].innerHTML;
 s.graph.pending={nodeId:'a',exit:'next'};
 s.graph.lastPortClick={nodeId:'a',exit:'next',time:1000};
 const pending=s.graph.pending,lastPortClick=s.graph.lastPortClick,view={...s.graph.view},selected=s.graph.selected;
 Object.defineProperty(s.root.parts['#edges'],'innerHTML',{get:()=>edgeMarkup,set(){throw Error('Highlight rebuilt edges');}});
 s.graph.setActive('c');
 assert.equal(s.graph.nodeElements,nodes);assert.equal(s.graph.portElements,ports);
 assert.equal(s.root.node('b').classes.has('active'),false);assert.equal(s.root.node('c').classes.has('active'),true);
 assert.equal(s.root.node('a').classes.has('selected'),true);
 assert.equal(s.graph.active,'c');assert.equal(s.graph.selected,selected);
 assert.equal(s.graph.pending,pending);assert.equal(s.graph.lastPortClick,lastPortClick);
 assert.deepEqual(s.graph.view,view);assert.deepEqual(s.selections,[]);assert.deepEqual(s.calls,[]);
});

test('repeated same-node preview notifications do no DOM work and transitions touch only old/new nodes',()=>{
 const s=setup(),writes=[];
 for(const [id,element] of s.graph.nodeElements){const toggle=element.classList.toggle;element.classList.toggle=(...args)=>{writes.push([id,...args]);toggle(...args);};}
 for(let i=0;i<1000;i++)s.graph.setActive('b');
 assert.deepEqual(writes,[]);
 s.graph.setActive('a');
 assert.deepEqual(writes,[['b','active',false],['a','active',true]]);
 s.graph.setActive(null);
 assert.equal(s.root.node('a').classes.has('active'),false);
 assert.equal(s.graph.active,null);
});

for(const kind of ['node','pan','connect'])test(`preview highlighting preserves an active ${kind} gesture and pointer capture`,()=>{
 const s=setup(),target=kind==='node'?s.root.node('a'):kind==='connect'?s.port():s.root;
 s.root.event('pointerdown',target,200,100);
 s.root.hit=s.root.node('c');s.root.event('pointermove',s.root,230,130);
 const drag=s.graph.drag,nodes=s.graph.nodeElements,view={...s.graph.view},edges=s.root.parts['#edges'].innerHTML;
 s.graph.setActive('c');
 assert.equal(s.graph.drag,drag);assert.equal(s.graph.nodeElements,nodes);assert.equal(s.root.capture,1);
 assert.deepEqual(s.graph.view,view);assert.equal(s.root.parts['#edges'].innerHTML,edges);
 s.graph.cancel();
 assert.equal(s.graph.active,'c');assert.equal(s.root.node('c').classes.has('active'),true);
});

test('full render replaces Library indexes after document replacement and keeps updated preview highlight',()=>{
 const s=setup(),definition={...createDefinition('action','choice'),name:'First'};
 const fork={id:'fork',name:'Fork',type:'fork',x:0,y:0,choices:[{id:'pick',definitionId:'choice'}],connections:{pick:'b'}};
 const chapter={...s.chapter,nodes:[fork,...s.chapter.nodes.slice(1)]};
 s.graph.render({library:[definition]},chapter,'fork','b');
 const oldIndex=s.graph.libraryIndex;
 s.graph.setActive('c');
 const replacement={...definition,name:'Changed',resolution:'check'};
 s.graph.render({library:[replacement]},chapter,'fork',s.graph.active);
 assert.notEqual(s.graph.libraryIndex,oldIndex);
 assert.match(s.root.parts['#nodes'].rendered,/Changed · Success/);
 assert.match(s.root.parts['#nodes'].rendered,/Changed · Failure/);
 assert.equal(s.root.node('c').classes.has('active'),true);
});

test('idle cancellation clears click tracking without replacing graph elements',()=>{
 const s=setup(),node=s.root.node('a'),edges=s.root.parts['#edges'].innerHTML;
 s.graph.lastPortClick={nodeId:'a',exit:'next',time:100,x:200,y:100};
 s.graph.cancel();
 assert.equal(s.graph.lastPortClick,null);
 assert.equal(s.root.node('a'),node);
 assert.equal(s.root.parts['#edges'].innerHTML,edges);
 assert.equal(s.root.node('b').classes.has('active'),true);
});

test('pending cancellation still restores graph markup',()=>{
 const s=setup(),node=s.root.node('a');
 s.graph.pending={nodeId:'a',exit:'next'};
 s.graph.cancel();
 assert.equal(s.graph.pending,null);
 assert.notEqual(s.root.node('a'),node);
 assert.equal(s.root.node('b').classes.has('active'),true);
});


test('unlinked output blank drop requests creation at graph coordinates without an edit',()=>{
 const s=setup();s.chapter.nodes[0].connections.next=false;
 s.graph.view={x:30,y:40,z:.5};s.graph.render(s.graph.project,s.chapter,'a');
 s.root.event('pointerdown',s.port(),200,100);s.root.hit=null;
 s.root.event('pointerup',s.root,700,220);
 assert.deepEqual(s.calls,[]);
 assert.deepEqual(s.creations,[{id:'a',exit:'next',position:{x:1320,y:320},clientX:700,clientY:220}]);
 assert.match(s.root.parts['#edges'].innerHTML,/edge-ghost/);
 assert.equal(s.chapter.nodes[0].connections.next,false);
 s.graph.cancel();assert.equal(s.graph.creation,null);
 assert.doesNotMatch(s.root.parts['#edges'].innerHTML,/edge-ghost/);
});

test('unlinked output click, outside drop and existing-node drop do not request creation',()=>{
 for(const kind of ['click','outside','node']){
  const s=setup();s.chapter.nodes[0].connections.next=false;s.graph.render(s.graph.project,s.chapter,'a');
  s.root.event('pointerdown',s.port(),200,100);
  s.root.hit=kind==='node'?s.root.node('b'):null;
  s.root.event('pointerup',s.root,kind==='click'?200:kind==='outside'?1200:700,kind==='click'?100:220);
  assert.deepEqual(s.creations,[]);
  assert.deepEqual(s.calls,kind==='node'?[['a','next','b']]:[]);
 }
});


test('self-target connections follow the project cycle setting, not legacy chapter flags',()=>{
 const s=setup();
 s.chapter.allowCycles=true;assert.equal(s.graph.validTarget('a','a'),false);
 s.graph.project.allowCycles=true;s.chapter.allowCycles=false;assert.equal(s.graph.validTarget('a','a'),true);
 delete s.graph.project.allowCycles;assert.equal(s.graph.validTarget('a','a'),true);
 assert.equal(s.graph.validTarget('missing','a'),false);
});

test('card drag focuses the canvas, emits one transfer, and suppresses its follow-up click',()=>{
 const s=setup(),transfers=[];s.graph.cardDrag.onTransfer=data=>transfers.push(data);
 const row=new Element('graph-card-row',{cardPlacement:'chosen-card',cardSlot:'cards',cardType:'event'},s.root.node('a')),name=new Element('graph-card-name',{},row);
 s.root.event('pointerdown',name);assert.equal(s.root.focused,true);
 s.graph.drag.moved=true;s.graph.cardDrag.suppressClick=true;s.root.hit=s.root.node('b');
 s.root.event('pointerup',s.root,500,300);
 s.root.handlers.click({detail:0,target:name,preventDefault(){}});
 assert.deepEqual(transfers,[{sourceNodeId:'a',placementId:'chosen-card',targetNodeId:'b',index:0,copy:false}]);
 assert.deepEqual(s.opened,[]);assert.equal(s.root.capture,null);
});
test('Escape and capture loss cancel card drags without transfer or node movement',()=>{
 for(const event of ['Escape','pointercancel','lostpointercapture']){
  const s=setup(),transfers=[];s.graph.cardDrag.onTransfer=data=>transfers.push(data);
  const row=new Element('graph-card-row',{cardPlacement:'chosen-card',cardSlot:'cards',cardType:'event'},s.root.node('a')),name=new Element('graph-card-name',{},row);
  s.root.event('pointerdown',name);s.graph.drag.moved=true;
  if(event==='Escape')s.root.handlers.keydown({key:'Escape',target:s.root});else s.root.event(event,s.root);
  assert.equal(s.graph.drag,null);assert.deepEqual(transfers,[]);assert.deepEqual(s.moves,[]);
 }
});

 test('existing empty graph cards have typed placeholders while absent definitions remain Missing card',()=>{
 const s=setup(),card=createDefinition('event','untitled');
 s.chapter.nodes[0].cards=[{id:'placement',definitionId:card.id}];
 for(const name of ['', '   ']){
  card.name=name;s.graph.render({library:[card]},s.chapter,'a');
  assert.match(s.root.parts['#nodes'].rendered,/>Untitled Vignette<\/button>/);assert.doesNotMatch(s.root.parts['#nodes'].rendered,/Missing card/);
 }
 s.graph.render({library:[]},s.chapter,'a');assert.match(s.root.parts['#nodes'].rendered,/>Missing card<\/button>/);
});

test('unnamed graph cards use an escaped description fallback without modifying the project',()=>{
 const s=setup(),definition={...createDefinition('event','unnamed'),name:'  ',text:'Wake <here>\n& now'};
 const node={id:'a',name:'A',type:'linear',x:0,y:0,cards:[{id:'p',definitionId:definition.id}],connections:{next:null}};
 const project={library:[definition]},before=structuredClone(project);
 s.graph.render(project,{nodes:[node],startNode:node.id},node.id);
 assert.match(s.root.parts['#nodes'].rendered,/Wake &lt;here&gt; &amp; now/);
 assert.deepEqual(project,before);
});

test('beat headers show the authored name once in the badge instead of a separate type and title',()=>{
 const s=setup();s.chapter.nodes[0].name='The <box>';
 s.graph.render({library:[]},s.chapter,'a');
 const html=s.root.parts['#nodes'].rendered;
 assert.match(html,/<span class="badge">START · The &lt;box&gt;<\/span><\/div>/);
 assert.doesNotMatch(html,/<span class="badge">START · Linear<\/span>/);
 assert.equal((html.match(/The &lt;box&gt;/g)||[]).length,1);
});

test('only visible show-once introductions carry the small hourglass indicator',()=>{
 for(const type of ['fork','container']){
  const s=setup(),definition=createDefinition('event','intro');
  const node={id:'a',name:'A',type,x:0,y:0,intro:{id:'intro-placement',definitionId:'intro'},choices:[],items:[],connections:{next:null}};
  const render=()=>{s.graph.render({library:[definition]},{nodes:[node],startNode:'a'},'a');return s.root.parts['#nodes'].rendered;};
  for(const value of [undefined,false]){node.introOnce=value;assert.doesNotMatch(render(),/graph-intro-once/);}
  node.introOnce=true;
  const html=render();assert.equal((html.match(/class="graph-intro-once"/g)||[]).length,1);
  assert.match(html,/aria-label="Introduction shown once" title="Show once"/);
  node.introEnabled=false;assert.doesNotMatch(render(),/graph-intro-once/);
 }
});

function modifiedDown(s,target,x,y,modifier='metaKey'){
 s.root.handlers.pointerdown({target,clientX:x,clientY:y,pointerId:1,button:0,[modifier]:true,preventDefault(){}});
}
for(const modifier of ['metaKey','ctrlKey'])test(`${modifier} drag selects intersecting beats without panning or editing`,()=>{
 const s=setup(),view={...s.graph.view};
 modifiedDown(s,s.root,50,60,modifier);
 s.root.event('pointermove',s.root,650,210);
 assert.deepEqual([...s.graph.selectedIds],['a','b']);
 assert.match(s.root.parts['#edges'].innerHTML,/graph-selection-box/);
 assert.equal(s.root.node('b').classes.has('selected'),true);
 s.root.event('pointerup',s.root,650,210);
 assert.deepEqual(s.groups,[['a','b']]);assert.deepEqual(s.graph.view,view);
 assert.deepEqual(s.calls,[]);assert.deepEqual(s.moves,[]);assert.deepEqual(s.selections,[]);
 assert.doesNotMatch(s.root.parts['#edges'].innerHTML,/graph-selection-box/);
});

test('box selection works in reverse at combined graph and editor zoom',()=>{
 const s=setup();s.graph.view.z=.5;
 s.root.ownerDocument.documentElement={};s.root.ownerDocument.defaultView={getComputedStyle:()=>({zoom:2})};
 // client = root offset + UI scale * (pan + world * graph zoom).
 modifiedDown(s,s.root,700,260);
 s.root.event('pointerup',s.root,100,110);
 assert.deepEqual(s.groups,[['a','b']]);assert.deepEqual(s.graph.view,{x:50,y:50,z:.5});
});

test('modifier click toggles a beat without moving it or opening a card',()=>{
 const s=setup();modifiedDown(s,s.root.node('b'),500,160);
 s.root.event('pointerup',s.root,500,160);assert.deepEqual(s.groups,[['a','b']]);
 modifiedDown(s,s.root.node('a'),100,100);s.root.event('pointerup',s.root,100,100);
 assert.deepEqual(s.groups.at(-1),['b']);assert.deepEqual(s.moves,[]);assert.deepEqual(s.opened,[]);
});

test('selected beats move together with live wires and one group move callback',()=>{
 const s=setup();s.graph.selectedIds=new Set(['a','b']);const before=structuredClone(s.chapter);
 s.root.event('pointerdown',s.root.node('b'),500,160);
 s.root.event('pointermove',s.root,600,210);
 assert.equal(s.root.node('a').style.left,'100px');assert.equal(s.root.node('b').style.left,'500px');
 assert.equal(s.root.node('a').style.top,'50px');assert.equal(s.root.node('b').style.top,'100px');
 assert.deepEqual(s.graph.position(s.chapter.nodes[0]),{x:100,y:50});
 s.graph.render(s.graph.project,s.chapter,'a','b');
 assert.deepEqual([...s.graph.selectedIds],['a','b']);assert.match(s.root.node('a').style.left??s.root.parts['#nodes'].rendered,/100/);
 s.root.event('pointerup',s.root,600,210);
 assert.deepEqual(s.groupMoves,[[{id:'a',x:100,y:50},{id:'b',x:500,y:100}]]);
 assert.deepEqual(s.moves,[]);assert.deepEqual(s.selections,[]);assert.deepEqual(s.chapter,before);
});

for(const cancellation of ['Escape','pointercancel','lostpointercapture'])test(`${cancellation} restores selection and cancels group motion without document edits`,()=>{
 const s=setup();modifiedDown(s,s.root,50,60);s.root.event('pointermove',s.root,650,210);
 if(cancellation==='Escape')s.root.handlers.keydown({key:'Escape'});else s.root.event(cancellation,s.root);
 assert.deepEqual([...s.graph.selectedIds],['a']);assert.deepEqual(s.groups,[]);
 s.graph.selectedIds=new Set(['a','b']);s.root.event('pointerdown',s.root.node('b'),500,160);s.root.event('pointermove',s.root,600,210);
 s.graph.cancel();assert.deepEqual(s.groupMoves,[]);assert.equal(s.graph.position(s.chapter.nodes[0]).x,0);assert.equal(s.graph.position(s.chapter.nodes[0]).y,0);
});

test('a multi-selection cannot delete an arbitrary primary beat and clears on chapter change',()=>{
 const s=setup();s.graph.selectedIds=new Set(['a','b']);
 s.root.handlers.keydown({key:'Delete',target:s.root,preventDefault(){assert.fail('no group delete');}});
 assert.deepEqual(s.deleted,[]);
 s.graph.render(s.graph.project,{...s.chapter,id:'another-chapter'},'a');
 assert.deepEqual([...s.graph.selectedIds],['a']);
});

test('canceling a modifier selection never swallows subsequent keyboard connector activation',()=>{
 const s=setup();modifiedDown(s,s.root,50,60);s.root.event('pointercancel',s.root);
 s.root.handlers.keydown({key:'Enter',target:s.port()});
 s.root.handlers.click({detail:0,target:s.port(),preventDefault(){assert.fail('activation must not be swallowed');}});
 assert.deepEqual(s.selections,['b']);
});

test('preview card highlight distinguishes placements, survives render and clears across chapters',()=>{
 const s=setup();s.chapter.id='chapter';s.graph.project.library=[createDefinition('item','same')];
 s.chapter.nodes[0].cards=[{id:'first',definitionId:'same'},{id:'second',definitionId:'same'}];
 s.graph.render(s.graph.project,s.chapter,'a','a');
 const target=id=>({chapterId:'chapter',nodeId:'a',placementId:id});
 const [first,second]=s.root.node('a').cardRows;
 s.graph.setActiveCard(target('first'));assert.equal(first.classes.has('preview-active'),true);
 s.graph.setActiveCard(target('second'));
 assert.equal(first.classes.has('preview-active'),false);assert.equal(second.classes.has('preview-active'),true);
 const nodes=s.graph.nodeElements;let writes=0;
 second.classList.toggle=()=>writes++;
 s.graph.setActiveCard(target('second'));assert.equal(writes,0);assert.equal(s.graph.nodeElements,nodes);
 s.graph.render(s.graph.project,s.chapter,'a','a');
 assert.equal(s.root.node('a').cardRows[1].classes.has('preview-active'),true);
 s.graph.setActiveCard({...target('second'),chapterId:'other'});
 assert.equal(s.root.node('a').cardRows[1].classes.has('preview-active'),false);
 s.graph.setActiveCard(target('first'));s.graph.setActiveCard(null);
 assert.equal(s.root.node('a').cardRows[0].classes.has('preview-active'),false);
});
