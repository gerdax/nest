import test from 'node:test';
import assert from 'node:assert/strict';
import { definitionUsage } from '../studio/definition-usage.js';
import { definitionGraph } from '../project/dependencies.js';
import { sourceCard } from '../studio/card-navigation.js';

const requirement = key => ({source:'inventory', key, op:'has'});
const effect = key => ({op:'addItem', key});
const fixture = () => ({library:[{id:'item',kind:'item',name:'Key',inventoryKey:'key'}, {id:'action',kind:'action',name:'Open door',visibility:'local',chapterId:'chapter'}],chapters:[{id:'chapter',name:'Chapter',nodes:[{id:'node',name:'Door',cards:[]}]}]});
const letters = row => row.markers.map(([letter]) => letter).join('');

test('chapter placements and gameplay references are distinct, and only actual references supply markers', () => {
 const project=fixture(), node=project.chapters[0].nodes[0];
 node.cards=[{id:'key-placement',definitionId:'item'}, {id:'action-placement',definitionId:'action'}];
 project.library[1].conditions=[requirement('key')];
 project.library[1].costs=[{source:'variable',key:'energy',amount:1}];
 project.library[1].effects=[{op:'add',key:'energy',value:1}];
 const usage=definitionUsage(project,'item');
 assert.equal(usage.placements.length,1);assert.equal(usage.placements[0].name,'Chapter → Door');
 assert.equal(usage.references.length,1);assert.equal(usage.references[0].name,'Open door');assert.equal(letters(usage.references[0]),'R');
 assert.equal(sourceCard(project,usage.references[0].target).placement,node.cards[1]);
 assert.equal(sourceCard(project,usage.placements[0].target).placement,node.cards[0]);
});

test('local source occurrences and placement rules aggregate TRCE with exact cross-chapter identities', () => {
 const project=fixture(), node=project.chapters[0].nodes[0];
 const placement=()=>({id:'same',definitionId:'action',contextItemId:'item',overrides:{costs:[{source:'inventory',key:'key',amount:1}],conditions:[requirement('key')],effects:[effect('key')]}});
 node.cards=[placement()];
 project.chapters.push({id:'other',name:'Other',nodes:[{id:'node',name:'Door',cards:[placement()]}]});
 project.library[1].conditions=[requirement('item')];
 project.library[1].successEffects=[effect('key')];project.library[1].failureEffects=[effect('key')];
 const usage=definitionUsage(project,'item');
 assert.equal(usage.references.length,2);
 assert.deepEqual(usage.references.map(letters),['TRCE','TRCE']);
 for(const row of usage.references) assert.equal(sourceCard(project,row.target).placement.id,'same');
 assert.notEqual(usage.references[0].chapterId,usage.references[1].chapterId);
});

test('shared definitions open their Library source and local unplaced drafts explain unavailable navigation', () => {
 const project=fixture(),source=project.library[1];source.effects=[effect('key')];
 let row=definitionUsage(project,'item').references[0];
 assert.equal(row.name,'Open door');assert.equal(row.chapterId,'chapter');assert.match(row.unavailableReason,/no placement/);assert.equal(row.target,undefined);assert.equal(row.definitionId,undefined);
 source.visibility='shared';
 project.chapters[0].nodes[0].cards=[{id:'a',definitionId:'action'},{id:'b',definitionId:'action'}];
 const usage=definitionUsage(project,'item');assert.equal(usage.references.length,1);
 row=usage.references[0];assert.equal(row.definitionId,'action');assert.equal(row.target,undefined);assert.equal(letters(row),'E');
});

for(const field of ['sequence','sequences']) test(`legacy ${field} cards, items and nested choices retain exact sourceCard targets`, () => {
 const project=fixture(),node=project.chapters[0].nodes[0];
 const sequence={id:'seq',cards:[{id:'parent',definitionId:'item',choices:[{id:'same',definitionId:'action',contextItemId:'item'}]},{id:'other-parent',definitionId:'action',choices:[{id:'same',definitionId:'item',effects:[effect('key')]}]}],items:[{id:'same',definitionId:'item'}]};
 delete node.cards;node[field]=field==='sequence'?sequence:[sequence];
 const usage=definitionUsage(project,'item');
 assert.equal(usage.placements.length,3);
 for(const row of usage.placements) assert.equal(sourceCard(project,row.target).placement.definitionId,'item');
 assert.equal(usage.references.length,2);
 for(const row of usage.references) assert.ok(sourceCard(project,row.target));
 const trigger=usage.references.find(row=>letters(row)==='T');assert.equal(trigger.name,'Open door');assert.equal(trigger.target.parentCardId,'parent');
 const effects=usage.references.find(row=>letters(row)==='E');assert.equal(effects.target.parentCardId,'other-parent');
});

test('native choices, items and introductions resolve exact owners', () => {
 const project=fixture(), node=project.chapters[0].nodes[0];
 for(const slot of ['cards','choices','items'])node[slot]=[{id:slot,definitionId:'item',effects:[effect('key')]}];
 node.intro={id:'intro',definitionId:'item',conditions:[requirement('key')]};
 const usage=definitionUsage(project,'item');assert.equal(usage.placements.length,4);assert.equal(usage.references.length,4);
 for(const row of [...usage.placements,...usage.references])assert.ok(sourceCard(project,row.target));
});

test('node, route and chapter rules use meaningful navigation without fake placement targets', () => {
 const project=fixture(),chapter=project.chapters[0],node=chapter.nodes[0];
 chapter.conditions=[requirement('key')];node.effects=[effect('key')];node.routes=[{id:'route',name:'Secret passage',conditions:[requirement('key')]},{id:'unnamed',effects:[effect('key')]}];
 const rows=definitionUsage(project,'item').references;
 assert.deepEqual(rows.map(row=>row.name),['Chapter','Door','Secret passage','Route 2']);
 assert.deepEqual(rows.map(letters),['R','E','R','E']);
 for(const row of rows)assert.equal(row.target,undefined);
 assert.equal(rows[0].nodeId,undefined);assert.equal(rows[2].nodeId,'node');
});

test('inventory aliases resolve every matching definition; input and graph semantics are unchanged', () => {
 const project=fixture();project.library.push({id:'alias',kind:'item',name:'Alias',inventoryKey:'key'});
 project.chapters[0].nodes[0].cards=[{id:'a',definitionId:'action',conditions:[requirement('key')],effects:[effect('key')]}];
 const snapshot=structuredClone(project),before=structuredClone(definitionGraph(project).users('item'));
 assert.equal(letters(definitionUsage(project,'item').references[0]),'RE');
 assert.equal(letters(definitionUsage(project,'alias').references[0]),'RE');
 assert.deepEqual(project,snapshot);assert.deepEqual(definitionGraph(project).users('item'),before);
});

test('empty or missing projects and missing definitions return empty usage', () => {
 for(const project of [undefined,{}, {library:[],chapters:[]},fixture()])assert.deepEqual(definitionUsage(project,'missing'),{placements:[],references:[]});
});
