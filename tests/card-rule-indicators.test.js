import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefinition } from '../project/cards.js';
import { createLibraryIndex } from '../project/library-index.js';
import { cardRuleIndicators } from '../studio/card-rule-indicators.js';
import { GraphView } from '../studio/GraphView.js';

const condition={source:'variable',key:'energy',op:'gte',value:1};
const effect={op:'add',key:'energy',value:1};
const cost={source:'variable',key:'energy',amount:1};
function fixture(kind='action', visibility='shared') {
  const definition={...createDefinition(kind,'source'),visibility};
  const project={library:[definition]}, placement={id:'placement',definitionId:definition.id};
  return {project,placement,definition};
}
const letters=(project,placement)=>cardRuleIndicators(project,placement,createLibraryIndex(project.library)).map(([letter])=>letter).join('');

for(const visibility of ['shared','local'])test(`${visibility} cards show actual trigger, requirement, cost and common effect rules`,()=>{
  const {project,placement,definition}=fixture('action',visibility);
  Object.assign(definition,{conditions:[condition],costs:[cost],effects:[effect]});
  placement.contextItemId='key';
  const before=structuredClone({project,placement});
  assert.equal(letters(project,placement),'TRCE');
  assert.deepEqual({project,placement},before);
});

test('a trigger alone shows T without counting implicit ownership as R',()=>{
  const {project,placement}=fixture();
  project.library.push(createDefinition('item','key'));
  placement.contextItemId='key';
  assert.equal(letters(project,placement),'T');
  placement.conditions=[condition];
  assert.equal(letters(project,placement),'TR');
});

test('dice resolution follows the rule letters; outcome effects do not show E',()=>{
  const {project,placement,definition}=fixture();
  Object.assign(definition,{resolution:'check',successEffects:[effect],failureEffects:[effect]});
  assert.equal(letters(project,placement),'DICE');
  definition.effects=[effect];
  assert.equal(letters(project,placement),'EDICE');
  placement.overrides={resolution:'direct'};
  assert.equal(letters(project,placement),'E');
});

test('shared overrides replace source rules while local cards retain their own rules',()=>{
  const {project,placement,definition}=fixture();
  Object.assign(definition,{conditions:[condition],costs:[cost],effects:[effect]});
  placement.overrides={conditions:[],costs:[],effects:[]};
  assert.equal(letters(project,placement),'');
  placement.effects=[effect];
  assert.equal(letters(project,placement),'E');
  definition.visibility='local';
  assert.equal(letters(project,placement),'RCE');
});

test('Item collection effects show E and respect custom collection rules; Permability adds no letter',()=>{
  const {project,placement,definition}=fixture('item');
  definition.permability=2;
  assert.equal(letters(project,placement),'');
  definition.onCollect=[effect];
  assert.equal(letters(project,placement),'E');
  placement.overrides={onCollect:[],permability:1};
  assert.equal(letters(project,placement),'');
  placement.effects=[effect];placement.conditions=[condition];
  assert.equal(letters(project,placement),'RE');
});

for(const kind of ['event','caption'])test(`${kind} cards include source and placement requirements/effects`,()=>{
  const {project,placement,definition}=fixture(kind);
  definition.effects=[effect];placement.conditions=[condition];
  assert.equal(letters(project,placement),'RE');
});

test('graph places the indicators below the clean card-name button with explanatory labels',()=>{
  const {project,placement,definition}=fixture();
  Object.assign(definition,{name:'Pick <lock>',conditions:[condition],costs:[cost],effects:[effect]});
  placement.contextItemId='key';
  const node={id:'node',type:'fork',introEnabled:false,choices:[placement],connections:{placement:null}};
  const graph=Object.assign(Object.create(GraphView.prototype),{project,libraryIndex:createLibraryIndex(project.library),definitionsById:new Map(project.library.map(card=>[card.id,card])),nodesById:new Map([[node.id,node]])});
  const html=graph.cardRows(node);
  assert.match(html,/<button type="button" class="graph-card-name">Pick &lt;lock&gt;<\/button><small class="graph-card-rules"/);
  assert.match(html,/title="T: Inventory trigger; R: Requirements; C: Costs; E: Effects">T · R · C · E<\/small>/);
  assert.equal((html.match(/class="port /g)||[]).length,1);
  definition.conditions=[];definition.costs=[];definition.effects=[];delete placement.contextItemId;
  assert.doesNotMatch(graph.cardRows(node),/graph-card-rules/);
});

test('missing definitions and malformed draft rules do not break graph indicators',()=>{
  assert.deepEqual(cardRuleIndicators({library:[]},{definitionId:'missing'}),[]);
  const {project,placement,definition}=fixture();definition.conditions={};
  assert.deepEqual(cardRuleIndicators(project,placement),[]);
});


for(const kind of ['health','energy'])for(const visibility of ['shared','local'])test(`${kind} ${visibility} graph shows Value and only additional collection effects as E`,()=>{
  const {project,placement,definition}=fixture(kind,visibility);definition.value=2;
  const node={id:'node',type:'linear',cards:[placement],connections:{next:null}};
  const graph=Object.assign(Object.create(GraphView.prototype),{project,libraryIndex:createLibraryIndex(project.library),definitionsById:new Map(project.library.map(card=>[card.id,card])),nodesById:new Map([[node.id,node]])});
  const text=()=>graph.cardRows(node).match(/class="graph-card-rules"[^>]*>([^<]*)<\/small>/)[1];
  assert.equal(text(),'2');
  definition.onCollect=[effect];assert.equal(text(),'2 · E');
  placement.overrides={value:0,onCollect:[]};
  assert.equal(text(),visibility==='shared'?'0':'2 · E');
  if(visibility==='local')definition.onCollect=[];
  placement.effects=[effect];assert.equal(text(),visibility==='shared'?'0 · E':'2 · E');
  delete placement.effects;delete placement.overrides;definition.onCollect=[];definition.value=-2;
  assert.equal(text(),'-2');
});
