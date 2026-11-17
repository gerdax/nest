import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../studio/GraphView.js';
import { outputsForNode } from '../project/model.js';
import { nodeIcon } from '../studio/node-icons.js';

// This fixture exercises event routing and generated SVG, not browser layout.
class Element {
 constructor(classes='',dataset={},parent=null){this.classes=new Set(classes.split(' '));this.dataset=dataset;this.parent=parent;this.style={setProperty(key,value){this[key]=value;}};this.children=[];this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),remove:name=>this.classes.delete(name)};}
 cloneNode(){return new Element([...this.classes].join(' '),{...this.dataset});}
 removeAttribute(name){if(name==='data-id')delete this.dataset.id;}
 setAttribute(name,value){this[name]=value;}
 appendChild(el){this.children.push(el);el.parent=this;el.isConnected=true;}
 remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(el=>el!==this);}
 closest(selector){for(let el=this;el;el=el.parent)if(el.classes.has(selector.slice(1)))return el;return null;}
 querySelectorAll(selector){return [...this.children,...(this.cardRows||[])].filter(el=>el.classes.has(selector.slice(1)));}
 getBoundingClientRect(){return {width:0,height:0};}
}
class Root extends Element {
 constructor(){super();this.handlers={};this.capture=null;this.parts={'#world':new Element(),'#edges':new Element(),'#nodes':new Element(),'#beat-groups':new Element()};this.ownerDocument={documentElement:new Element(),defaultView:{requestAnimationFrame:()=>1},elementFromPoint:()=>this.hit};
  Object.defineProperty(this.parts['#edges'],'innerHTML',{configurable:true,get:()=>this.edgeMarkup,set:html=>{
   this.edgeMarkup=html;
   this.parts['#edges'].children=[...html.matchAll(/<path class="(edge-line[^"]*)" data-source="([^"]*)" data-exit="([^"]*)"/g)].map(([,cls,source,exit])=>new Element(cls,{source,exit}));
  }});
  Object.defineProperty(this.parts['#nodes'],'innerHTML',{set:html=>{
   this.parts['#nodes'].rendered=html;
   this.nodes=[...html.matchAll(/<article class="([^"]*)" data-id="([^"]*)"[^>]*>(.*?)<\/article>/g)].map(([,classes,id,body])=>{
    const node=new Element(classes,{id},this);node.cardRows=[...body.matchAll(/<div class="(graph-card-row[^"]*)" data-card-slot="[^"]*" data-card-placement="([^"]*)"/g)].map(([,cls,cardPlacement])=>new Element(cls,{cardPlacement},node));node.children=[...body.matchAll(/<button class="([^"]*)" data-exit="([^"]*)"/g)].map(([,cls,exit])=>new Element(cls,{exit},node));return node;
   });
  }});
  const groups=this.parts['#beat-groups'];
  Object.defineProperty(groups,'innerHTML',{set:html=>{
   groups.children=[...html.matchAll(/<div class="(beat-group(?: collapsed)?)" data-group-id="([^"]+)"/g)].map(([,classes,groupId])=>{
    const group=new Element(classes,{groupId},this),header=new Element('beat-group-header',{},group);
    group.children=[header,...['input','output'].map(port=>new Element('beat-group-port',{port},group))];
    group.header=header;
    return group;
   });
  }});
 }
 addEventListener(name,callback){this.handlers[name]=callback;}
 querySelector(selector){return this.parts[selector];}
 querySelectorAll(selector){return selector==='.node'?this.nodes:[];}
 contains(el){for(let parent=el?.parent;parent;parent=parent.parent)if(parent===this)return true;return false;}
 getBoundingClientRect(){return {left:10,top:20,right:1010,bottom:820,width:1000,height:800};}
 setPointerCapture(id){this.capture=id;}
 hasPointerCapture(id){return this.capture===id;}
 releasePointerCapture(id){this.capture=null;this.handlers.lostpointercapture({pointerId:id});}
 focus(){this.focused=true;}
 node(id){return this.nodes.find(n=>n.dataset.id===id);}
 event(name,target,x=300,y=200,pointerId=1){this.handlers[name]({target,clientX:x,clientY:y,pointerId,button:0,preventDefault(){}});}
}

function setup(type='linear') {
 const node={id:'a',type,name:'Named Beat',x:0,y:0,cards:[],choices:[],routes:[],connections:{next:'b'}},
  destination={id:'b',type:'linear',name:'Destination',x:400,y:0,cards:[],connections:{next:null}},
  chapter={id:'chapter',startNode:'b',nodes:[node,destination]},project={library:[]},root=new Root(),commands=[],moves=[],opens=[];
 let graph;
 graph=new GraphView(root,{onSelect:id=>{graph.selectedIds=new Set([id]);graph.render(project,chapter,id);},onMove:(...args)=>moves.push(args),onOpenCard:(...args)=>opens.push(args),onGroupCommand:(type,data)=>commands.push([type,data])});
 graph.render(project,chapter,'b');
 return {root,graph,node,chapter,project,commands,moves,opens,header:()=>new Element('node-heading',{},root.node('a'))};
}

test('stationary header selection preserves the node through both clicks and emits one collapse command',()=>{
 const s=setup(),header=s.header(),original=s.root.node('a');
 for(let click=0;click<2;click++){
  s.root.event('pointerdown',header);
  assert.equal(s.root.capture,null);
  assert.equal(s.root.node('a'),original,'selection redraw must preserve the header element');
  s.root.event('pointerup',header);
 }
 assert.deepEqual(s.moves,[]);
 s.root.event('dblclick',header);
 assert.deepEqual(s.commands,[['collapse-beat',{id:'a',collapsed:true}]]);
 assert.equal(s.root.focused,true);
 s.node.collapsed=true;s.graph.render(s.project,s.chapter,'a');
 s.root.event('dblclick',s.header());
 assert.deepEqual(s.commands.at(-1),['collapse-beat',{id:'a',collapsed:false}]);
});

test('collapsed beat shows only its type icon and name, and expanding restores every authored port',()=>{
 for(const type of ['linear','fork','combat','random','randomizer','container','death']){
  const s=setup(type);
  s.node.collapsed=true;
  s.node.routes=[{id:'route',name:'Route',target:'b'}];
  s.node.choices=[{id:'choice',definitionId:'caption'}];
  s.node.cards=[{id:'card',definitionId:'caption'}];
  s.project.library=[{id:'caption',kind:'caption',name:'Hidden Card',visibility:'shared',text:'Text'}];
  s.graph.render(s.project,s.chapter,'a');
  const markup=s.root.parts['#nodes'].rendered.split('</article>')[0];
  assert.match(markup,/collapsed/);assert.match(markup,/aria-expanded="false"/);
  assert.match(markup,/Named Beat/);assert.ok(markup.includes(nodeIcon(type)));
  assert.doesNotMatch(markup,/graph-card-row|node-body|beat-group-count|<button|collapsed-beat-outputs/);
  assert.deepEqual([...s.graph.portElements.get('a').keys()],[]);
  s.node.collapsed=false;s.graph.render(s.project,s.chapter,'a');
  assert.deepEqual([...s.graph.portElements.get('a').keys()],outputsForNode(s.project,s.node));
 }
});

test('collapsed beat wires share side anchors and expanding preserves connections and restores ports',()=>{
 const s=setup('fork');
 s.node.choices=[{id:'first',definitionId:'caption'},{id:'second',definitionId:'caption'}];
 s.project.library=[{id:'caption',kind:'caption',name:'Choice',visibility:'shared',text:'Text'}];
 s.node.connections={first:'b',second:'b'};
 const connections=structuredClone(s.node.connections);
 s.node.collapsed=true;s.chapter.nodes[1].collapsed=true;
 s.graph.render(s.project,s.chapter,'a');
 for(const exit of ['first','second']){
  assert.deepEqual(s.graph.outputPoint(s.node,exit),{x:220,y:30});
  assert.ok(s.root.edgeMarkup.includes(`data-exit="${exit}" d="M220,30 C310,30 310,30 400,30"`));
 }
 assert.deepEqual(s.graph.connectionPoint({nodeId:'b'},false),{x:400,y:30});
 s.root.node('a').getBoundingClientRect=()=>({left:60,right:280,top:70,width:220,height:50});
 assert.deepEqual(s.graph.connectionPoint({nodeId:'a',output:'first'},true),s.graph.point({clientX:280,clientY:95}));
 assert.deepEqual(s.graph.connectionPoint({nodeId:'a'},false),s.graph.point({clientX:60,clientY:95}));
 s.node.collapsed=false;s.graph.render(s.project,s.chapter,'a');
 assert.deepEqual(s.node.connections,connections);
 assert.deepEqual([...s.graph.portElements.get('a').keys()],['first','second']);
 s.root.event('pointerdown',s.graph.portElements.get('a').get('first'));
 assert.equal(s.graph.drag.kind,'connect');assert.equal(s.graph.drag.exit,'first');
 assert.deepEqual(s.commands,[]);
});

test('card rows, inputs, buttons and active drags do not toggle a beat',()=>{
 const s=setup(),header=s.header();
 for(const target of [new Element('graph-card-name',{},s.root.node('a')),new Element('port',{},s.root.node('a')),s.root])s.root.event('dblclick',target);
 const input=new Element('',{},header),closest=input.closest.bind(input);
 input.closest=selector=>selector.includes('input')?input:closest(selector);
 s.root.event('dblclick',input);
 s.root.event('pointerdown',header);s.root.event('dblclick',header);s.root.event('pointerup',header);
 assert.deepEqual(s.commands,[]);assert.deepEqual(s.opens,[]);
});

test('header drags still move once, and leaving or cancelling a stationary press clears it',()=>{
 const s=setup();
 s.root.event('pointerdown',s.header());s.root.event('pointermove',s.root,340,230);
 assert.equal(s.root.capture,1);s.root.event('pointerup',s.root,340,230);
 assert.deepEqual(s.moves,[['a',40,30]]);assert.deepEqual(s.commands,[]);
 for(const event of ['pointerleave','pointercancel']){
  s.root.event('pointerdown',s.header());s.root.event(event,s.root);
  assert.equal(s.graph.drag,null);assert.equal(s.root.classes.has('graph-dragging'),false);
 }
});

test('keyboard activation toggles the focused header and ignores repeat',()=>{
 const s=setup();
 for(const key of ['Enter',' '])s.root.handlers.keydown({target:s.header(),key,preventDefault(){}});
 assert.equal(s.commands.length,2);
 s.root.handlers.keydown({target:s.header(),key:'Enter',repeat:true,preventDefault(){}});
 assert.equal(s.commands.length,2);
});
