// Headless balance probe. Imports the production coordinator; never saves projects.
// Run: node --input-type=module -e 'import("./analysis/rat-balance.mjs").then(async m=>console.log(JSON.stringify(await m.runBalance(),null,2)))'
import {readFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {CombatCoordinator} from '../project/CombatCoordinator.js';
import {ProjectController} from '../project/ProjectController.js';
import {compileChapter,parseProject} from '../project/model.js';
import {initialValues} from '../project/state.js';

function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export async function fight(compiled,policy,seed,{health,enemyHealth}={}){
 const random=rng(seed),policyRandom=rng(seed^0xa5a5a5a5),enemy=structuredClone(compiled.library.find(d=>d.id==='rat'));
 if(enemyHealth!==undefined)enemy.health=enemyHealth;
 const node={...compiled.nodes.find(n=>n.type==='combat'),introEnabled:false};
 let won=false,dead=false,decisions=0,rolls=0;
 const counts={attack:0,defend:0,prepare:0};
 const deck=new EventEmitter();deck.addEventListener=deck.on;deck.removeEventListener=deck.off;
 Object.assign(deck,{phase:'closed',mount:{inert:false},state:{busy:false},content:{id:'initial'},
  replaceContent(content,options={}){this.content=content;this.phase=options.presentation==='open'?'choices':'closed';},
  async transitionContent(content,options){this.replaceContent(content,options);return true;},async waitForDeparture(){}});
 const host={deck,compiled,generation:1,serial:0,variables:initialValues(compiled.variables),inventory:[],rng:random,
  notify(){},error(error){throw error;},async rollCheck(pool){rolls++;return {dice:pool.flatMap(p=>Array.from({length:p.count},()=>1+Math.floor(random()*p.sides)))};},async onCheckResult(){},
  combatVictoryReason:()=>'',completeCombatVictory(){won=true;},
  commitCombatDamage:ProjectController.prototype.commitCombatDamage,
  commitCombatEffects:ProjectController.prototype.commitCombatEffects,
  deathDestination(){return this.variables.health<=0?{}:null;},handoffDeath(){dead=true;this.combat.dispose();this.combat=null;}};
 if(health!==undefined)host.variables.health=health;
 const c=host.combat=new CombatCoordinator(host,enemy,node);
 await c.start();
 for(let step=0;!won&&!dead&&step<2000;step++){
  if(c.phase==='error')throw new Error('Coordinator paused');
  let action;
  if(c.phase==='choice'){
   // Public information only: no declaration branch or queued action is exposed.
   const state={hp:host.variables.health,rat:c.encounter.enemyHp,energy:host.variables.energy,
    prepared:c.encounter.preparationBonus>0,guard:!!c.playerDefense,
    cue:c.declaration?.action.type==='prepare'?'prepare':'clear',turn:decisions,sample:policyRandom()};
   const name=policy(state),choice=c.choices().find(v=>v.action.type===name&&!v.disabled);
   if(!choice)throw new Error(`Unavailable policy action: ${name}`);
   action={id:choice.id};counts[name]++;decisions++;
  }else action={id:deck.content.actions?.[0]?.id};
  await c.accept({contentId:deck.content.id,action});
 }
 if(!won&&!dead)throw new Error('Policy stalled beyond 2000 card steps');
 c.dispose();
 return {won,hp:host.variables.health,decisions,rolls,energy:host.variables.energy,counts};
}

export const policies={
 attack:()=> 'attack',
 alternate:s=>!s.prepared&&s.rat>2?'prepare':'attack',
 prepareOnTell:s=>s.cue==='prepare'&&!s.prepared&&s.rat>2?'prepare':'attack',
 defendOnTell:s=>s.cue==='prepare'&&s.energy>0?'defend':'attack',
 bankDefense:s=>s.cue==='clear'&&!s.guard&&s.energy>0?'defend':'attack',
 cautious:s=>s.cue==='prepare'&&s.rat>2&&!s.guard&&s.energy>0?'defend':s.cue==='prepare'&&!s.prepared&&s.rat>2?'prepare':'attack',
 random:s=>{const choices=['attack','prepare',...(s.energy>0?['defend']:[])];return choices[Math.floor(s.sample*choices.length)];},
};

export async function runBalance({n=5000,health=10,enemyHealth=8,extraPolicies={},includeDefaultPolicies=true,projectUrl=new URL('../saved-projects/rat-alternative.json',import.meta.url)}={}){
 const project=parseProject(await readFile(projectUrl,'utf8'));
 const compiled=compileChapter(project),results={n,health,enemyHealth,policies:{}};
 for(const [name,policy] of Object.entries({...(includeDefaultPolicies?policies:{}),...extraPolicies})){
  const rows=[];
  for(let i=0;i<n;i++)rows.push(await fight(compiled,policy,((i+1)*2654435761)>>>0,{health,enemyHealth}));
  const wins=rows.filter(r=>r.won),mean=(a,k)=>a.reduce((s,r)=>s+r[k],0)/a.length;
  const sorted=wins.map(r=>r.decisions).sort((a,b)=>a-b);
  results.policies[name]={winRate:wins.length/n,meanDecisions:mean(rows,'decisions'),meanRolls:mean(rows,'rolls'),meanDefends:rows.reduce((s,r)=>s+r.counts.defend,0)/n,fightsUsingDefend:rows.filter(r=>r.counts.defend>0).length/n,
   winnerHp:mean(wins,'hp'),winnerEnergy:mean(wins,'energy'),winnerDecisionMedian:sorted[Math.floor(sorted.length*.5)],winnerDecisionP90:sorted[Math.floor(sorted.length*.9)]};
 }
 return results;
}
