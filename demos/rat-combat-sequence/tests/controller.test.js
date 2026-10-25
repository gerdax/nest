import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CombatDemo} from '../combat-demo.js';
import {initial} from '../combat-model.js';
function harness({value=6,error=null,wait=async()=>true}={}){
 const elements=new Map();const demo=Object.create(CombatDemo.prototype);
 Object.assign(demo,{epoch:1,abort:new AbortController(),state:initial(),history:[],clock:{wait},$:s=>{if(!elements.has(s))elements.set(s,{hidden:true,textContent:''});return elements.get(s);},setPhase(p){this.phase=p;},hud(){},async afterRat(){this.next='hero';},async enterRat(){this.next='rat';},async showEnd(){this.next='ended';},diceFactory(){return {mount(){return this;},async roll(){if(error)throw error;return {dice:[{value}]};},destroy(){}};}});return demo;
}
test('enemy applies health once then presents hero choices',async()=>{const d=harness();await d.attack('rat','attack');assert.equal(d.state.heroHp,9);assert.equal(d.history.length,1);assert.equal(d.next,'hero');});
test('hero result is written on the check surface and advances',async()=>{const d=harness();d.state={...initial(),actor:'hero'};const slot={};await d.attack('hero','weapon',slot);assert.equal(d.state.ratHp,1);assert.match(slot.textContent,/SUCCESS/);assert.equal(d.next,'rat');});
test('terminal enemy hit ends before choices',async()=>{const d=harness();d.state=initial({heroHp:1});await d.attack('rat','attack');assert.equal(d.next,'ended');assert.equal(d.state.heroHp,0);});
test('terminal hero hit ends before another rat attack',async()=>{const d=harness();d.state={...initial({ratHp:1}),actor:'hero'};await d.attack('hero','attack');assert.equal(d.next,'ended');});
test('WebGL error changes no resources and supports retry',async()=>{let fail=true;const d=harness();d.diceFactory=()=>({mount(){return this;},async roll(){if(fail)throw Error('No WebGL');return {dice:[{value:4}]};},destroy(){}});await d.attack('rat','attack');assert.equal(d.phase,'error');assert.equal(d.state.heroHp,10);assert.equal(d.history.length,0);fail=false;await d.attack(d.rollRequest.actor,d.rollRequest.action);assert.equal(d.history.length,1);assert.equal(d.state.heroHp,9);});
test('a roll that completes after restart cannot mutate the new state',async()=>{let finish;const d=harness();d.diceFactory=()=>({mount(){return this;},roll(){return new Promise(r=>finish=r);},destroy(){}});const running=d.attack('rat','attack');await new Promise(r=>setTimeout(r,0));d.epoch++;d.state=initial();finish({dice:[{value:6}]});await running;assert.equal(d.state.heroHp,10);assert.equal(d.history.length,0);});
test('canceled result hold cannot start a successor',async()=>{const d=harness({wait:async ms=>ms!==1200});await d.attack('rat','attack');assert.equal(d.state.heroHp,9);assert.equal(d.next,undefined);});
test('repeated accepted input during hero roll is ignored',async()=>{const d=harness();d.phase='hero-roll';await d.accept({id:'weapon'});assert.equal(d.history.length,0);});
