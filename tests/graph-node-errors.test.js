import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphView } from '../studio/GraphView.js';

// This DOM fixture verifies incremental updates and reconstruction, not painting.
class Element {
 constructor(classes='',dataset={}){
  this.classes=new Set(classes.split(/\s+/));this.dataset=dataset;this.attributes=new Map();
  this.style={setProperty(){}};
  this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};
 }
 setAttribute(name,value){this.attributes.set(name,value);}
 removeAttribute(name){this.attributes.delete(name);}
 getAttribute(name){return this.attributes.get(name)??null;}
 querySelectorAll(){return [];}
}
class Root extends Element {
 constructor(){
  super();this.parts={'#world':new Element(),'#nodes':new Element(),'#edges':new Element()};
  Object.defineProperty(this.parts['#nodes'],'innerHTML',{set:html=>{
   this.nodes=[...html.matchAll(/<article class="([^"]*)" data-id="([^"]*)"/g)]
    .map(([,classes,id])=>new Element(classes,{id}));
  }});
 }
 addEventListener(){}
 querySelector(selector){return this.parts[selector];}
 querySelectorAll(selector){return selector==='.node'?this.nodes:[];}
}
const node=id=>({id,name:id,type:'linear',cards:[],x:0,y:0,connections:{next:null}});
function setup(){
 const root=new Root(),graph=new GraphView(root,{});
 const project={library:[]},chapter={id:'first',nodes:[node('a'),node('b')],startNode:'a'};
 graph.render(project,chapter,'a','a');
 return {root,graph,project,chapter};
}

test('node errors update existing DOM with accessible messages and preserve interaction state',()=>{
 const {graph,root}=setup(),a=graph.nodeElements.get('a'),b=graph.nodeElements.get('b');
 a.classList.toggle('connection-target',true);
 const nodesBefore=root.nodes,drag={kind:'connect'};graph.drag=drag;
 graph.setNodeErrors(new Map([['a',['Missing target','Invalid condition']]]));
 assert.equal(root.nodes,nodesBefore);
 assert.equal(graph.nodeElements.get('a'),a);
 assert.equal(graph.drag,drag);
 for(const state of ['has-error','selected','active','connection-target'])assert.equal(a.classes.has(state),true,state);
 assert.equal(a.getAttribute('aria-invalid'),'true');
 assert.equal(a.getAttribute('aria-description'),'Missing target\nInvalid condition');
 assert.equal(a.getAttribute('title'),'Missing target\nInvalid condition');
 assert.equal(a.getAttribute('data-error-message'),'Missing target\nInvalid condition');
 assert.equal(b.classes.has('has-error'),false);
 assert.equal(b.getAttribute('aria-invalid'),null);
 graph.setActive('b');
 assert.equal(a.classes.has('has-error'),true);
 assert.equal(a.classes.has('active'),false);
});

test('resolved errors and empty message lists remove only error state',()=>{
 const {graph}=setup(),a=graph.nodeElements.get('a');
 graph.setNodeErrors(new Map([['a',['Broken']]]));
 graph.setNodeErrors(new Map([['a',[]]]));
 assert.equal(a.classes.has('has-error'),false);
 for(const name of ['aria-invalid','aria-description','data-error-message','title'])assert.equal(a.getAttribute(name),null);
 assert.equal(a.classes.has('selected'),true);
 assert.equal(a.classes.has('active'),true);
 graph.setNodeErrors(new Map([['a',['Broken']]]));
 graph.setNodeErrors(new Map());
 assert.equal(a.classes.has('has-error'),false);
});

test('saved errors survive rendering and chapter-filtered replacements clear reused node ids',()=>{
 const {graph,project,chapter}=setup(),before=graph.nodeElements.get('a');
 const messages=['Broken'],errors=new Map([['a',messages],['absent',['No node']]]);
 graph.setNodeErrors(errors);
 messages.push('Later mutation');errors.clear();
 graph.render(project,chapter,'a','a');
 const a=graph.nodeElements.get('a');
 assert.notEqual(a,before);
 assert.equal(a.classes.has('has-error'),true);
 assert.equal(a.getAttribute('aria-description'),'Broken');
 const next={id:'second',nodes:[node('a')],startNode:'a'};
 graph.render(project,next,'a',null);
 graph.setNodeErrors(new Map());
 assert.equal(graph.nodeElements.get('a').classes.has('has-error'),false);
 graph.setNodeErrors(new Map([['a',['Second chapter error']]]));
 graph.render(project,next,'a',null);
 assert.equal(graph.nodeElements.get('a').getAttribute('aria-description'),'Second chapter error');
});

test('errors may be supplied before the first render',()=>{
 const graph=new GraphView(new Root(),{});
 graph.setNodeErrors(new Map([['a',['Broken']]]));
 graph.render({library:[]},{id:'first',nodes:[node('a')]},'a',null);
 assert.equal(graph.nodeElements.get('a').classes.has('has-error'),true);
});

test('all errored beats are highlighted and fixing one leaves the others marked',()=>{
 const {graph}=setup();
 graph.setNodeErrors(new Map([['a',['Broken route']],['b',['Invalid check']]]));
 assert.equal(graph.nodeElements.get('a').classes.has('has-error'),true);
 assert.equal(graph.nodeElements.get('b').classes.has('has-error'),true);
 graph.setNodeErrors(new Map([['b',['Invalid check']]]));
 assert.equal(graph.nodeElements.get('a').classes.has('has-error'),false);
 assert.equal(graph.nodeElements.get('b').classes.has('has-error'),true);
});
