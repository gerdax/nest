// Headless balance probe. Imports the production coordinator; never saves projects.
// Run: node analysis/defense-comparison-2026-11-02/compare.mjs 10000
import {readFile,writeFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {CombatCoordinator} from '../../project/CombatCoordinator.js';
import {ProjectController} from '../../project/ProjectController.js';
import {compileChapter,parseProject} from '../../project/model.js';
import {initialValues} from '../../project/state.js';

function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
export async function fight(compiled,policy,seed,{health,enemyHealth,mode='current'}={}){
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
 const nativeDefense=c.resolveOpposedDefense.bind(c);
 let guaranteedBlocks=0, exhausted=false;
 c.resolveOpposedDefense=async function(result,attempt){
  if(mode==='energyOnly'&&result.actor==='enemy'&&result.action.type==='attack'&&result.success&&result.rolledDamage&&this.playerDefense){
   guaranteedBlocks++;
   return Object.freeze({...result,defense:{actor:'player',success:true},blockedDamage:result.rolledDamage,damage:0,targetHp:result.targetHp+result.damage});
  }
  return nativeDefense(result,attempt);
 };
 await c.start();
 for(let step=0;!won&&!dead&&step<2000;step++){
  if(c.phase==='error')throw new Error('Coordinator paused');
  let action;
  if(c.phase==='choice'){
   // Public information only: no declaration branch or queued action is exposed.
   const state={hp:host.variables.health,rat:c.encounter.enemyHp,energy:host.variables.energy,
    prepared:c.encounter.preparationBonus>0,guard:!!c.playerDefense,
    cue:c.declaration?.action.type==='prepare'?'prepare':'clear',turn:decisions,sample:policyRandom()};
   const legal=c.choices().filter(v=>!v.disabled);
   state.legal=legal.map(v=>v.action.type);
   const requested=policy(state);
   const choice=legal.find(v=>v.action.type===requested)??legal.find(v=>v.action.type==='prepare');
   const name=choice?.action.type;
   if(!legal.some(v=>v.action.type==='attack'))exhausted=true;
   if(!choice)throw new Error(`Unavailable policy action: ${name}`);
   action={id:choice.id};counts[name]++;decisions++;
  }else action={id:deck.content.actions?.[0]?.id};
  await c.accept({contentId:deck.content.id,action});
 }
 if(!won&&!dead)throw new Error('Policy stalled beyond 2000 card steps');
 c.dispose();
 return {won,guaranteedBlocks,exhausted,hp:host.variables.health,decisions,rolls,energy:host.variables.energy,counts};
}

import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateProject} from '../../project/model.js';
const policies={
 attack:()=> 'attack',
 prepareEveryOther:s=>!s.prepared?'prepare':'attack',
 prepareOnTell:s=>s.cue==='prepare'&&!s.prepared?'prepare':'attack',
 defendOnTell:s=>s.cue==='prepare'&&s.energy>0?'defend':'attack',
 defendWhenHurt:s=>s.cue==='prepare'&&s.hp<=4&&s.energy>=3?'defend':!s.prepared?'prepare':'attack',
 bankDefense:s=>s.cue==='clear'&&!s.guard&&s.energy>=3?'defend':!s.prepared?'prepare':'attack',
 random:s=>{const a=s.legal;return a[Math.floor(s.sample*a.length)];},
};
function summarize(rows){
 const winners=rows.filter(r=>r.won),n=rows.length,p=winners.length/n,z=1.96,den=1+z*z/n;
 const mean=(r,f)=>r.length?r.reduce((s,x)=>s+f(x),0)/r.length:null;
 const half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den,center=(p+z*z/(2*n))/den;
 return {n,wins:winners.length,winRate:p,confidence95:[center-half,center+half],meanDecisions:mean(rows,r=>r.decisions),meanRolls:mean(rows,r=>r.rolls),meanDefends:mean(rows,r=>r.counts.defend),winnerHp:mean(winners,r=>r.hp),winnerEnergy:mean(winners,r=>r.energy),energyExhaustionRate:mean(rows,r=>+r.exhausted),meanGuaranteedBlocks:mean(rows,r=>r.guaranteedBlocks)};
}
const raw=await readFile(new URL('./project-snapshot.json',import.meta.url),'utf8'),project=parseProject(raw);
assert.deepEqual(validateProject(project),[]);
const compiled=compileChapter(project),n=Number(process.argv[2]??10000);
const randomOnly=process.argv.includes('--random-only');
const report=randomOnly?JSON.parse(await readFile(new URL('./results.json',import.meta.url),'utf8')):{sourceSha256:createHash('sha256').update(raw).digest('hex'),n,method:{engine:'production CombatCoordinator with instance-only counterfactual defense override',physicalDice:false,animations:false,playerDefense:'guaranteed full block in energyOnly; same action and energy cost; rat defense unchanged',policies:'public state only; unavailable attacks/defends fall back to free Prepare',rng:'LCG; shared starting seeds, different roll counts can diverge trajectories',winnerMetricsConditional:true,optimality:'fixed policies, no claim of optimal play'},scenarios:[]};
for(const energy of [3,10]){
 const scenario=randomOnly?report.scenarios.find(s=>s.energy===energy):{energy,ratHp:compiled.library.find(d=>d.id==='rat').health,playerHp:10,variants:{}};
 const energyVariable=compiled.variables.find(v=>v.id==='energy');energyVariable.initial=energy;
 for(const variant of ['current_paidPunch','energyOnly_paidPunch','current_freePunch','energyOnly_freePunch']){
  const mode=variant.split('_')[0];
  compiled.library.find(d=>d.id==='alternative-attack').costs=variant.endsWith('freePunch')?[]:[{source:'variable',key:'energy',amount:1}];
  if(!randomOnly)scenario.variants[variant]={};
  for(const [name,policy] of Object.entries(policies)){
   if(randomOnly&&name!=='random')continue;
   const rows=[];
   for(let i=0;i<n;i++)rows.push(await fight(compiled,policy,Math.imul(i+1,2654435761)>>>0,{mode}));
   const stats=summarize(rows);scenario.variants[variant][name]=stats;
   console.log(`E${energy} ${variant} ${name}: ${(100*stats.winRate).toFixed(2)}% HP=${stats.winnerHp?.toFixed(2)}`);
  }
 }
 // With no defense chosen, the variants must be identical including all metrics.
 for(const cost of ['paidPunch','freePunch'])for(const name of ['attack','prepareEveryOther','prepareOnTell'])assert.deepEqual(scenario.variants['current_'+cost][name],scenario.variants['energyOnly_'+cost][name]);
 if(!randomOnly)report.scenarios.push(scenario);
 await writeFile(new URL('./results.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}
console.log(`Completed ${n*(randomOnly?8:56)} encounters`);
