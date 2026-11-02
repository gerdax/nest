import test from 'node:test';
import assert from 'node:assert/strict';
import {enemyActionSelection,chooseEnemyActionIndex} from '../project/combat-rules.js';

const enemy={actions:[{weight:1},{weight:3},{weight:2}],actionSelection:'random'};
test('weighted enemy action boundaries give each normal action its authored share',()=>{
 for(const [sample,index] of [[0,0],[1/6-Number.EPSILON,0],[1/6,1],[.5,1],[2/3-Number.EPSILON,1],[2/3,2],[.999999,2]])assert.equal(chooseEnemyActionIndex(enemy,()=>sample),index);
 for(const sample of [-.1,1,NaN,Infinity])assert.throws(()=>chooseEnemyActionIndex(enemy,()=>sample),/declaration sample/);
});
test('selection defaults preserve classic Order and opposed Random, with missing weights equal to one',()=>{
 assert.equal(enemyActionSelection({}),'order');assert.equal(enemyActionSelection({mechanics:'opposed-preparation'}),'random');
 const legacy={mechanics:'opposed-preparation',actions:[{},{}]};assert.equal(chooseEnemyActionIndex(legacy,()=>.49),0);assert.equal(chooseEnemyActionIndex(legacy,()=>.5),1);
 assert.equal(enemyActionSelection({...legacy,actionSelection:'order'}),'order');
});
test('Order uses list positions, wraps, ignores weights and does not draw randomness',()=>{
 const ordered={...enemy,actionSelection:'order'};
 for(let index=0;index<9;index++)assert.equal(chooseEnemyActionIndex(ordered,()=>assert.fail('Order must not sample'),index),index%3);
});
test('malformed weights and unsafe sums cannot enter weighted sampling',()=>{
 for(const weight of [undefined,null,0,-1,1.5,'2',Infinity,NaN])assert.throws(()=>chooseEnemyActionIndex({actions:[{weight}],actionSelection:'random'},()=>0),/weights/);
 assert.throws(()=>chooseEnemyActionIndex({actions:[{weight:Number.MAX_SAFE_INTEGER},{weight:1}],actionSelection:'random'},()=>0),/weights/);
 for(const actionSelection of ['unknown',null,undefined])assert.throws(()=>enemyActionSelection({actionSelection}),/selection/);
});
