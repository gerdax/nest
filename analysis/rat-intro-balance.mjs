// Current saved encounter, tested through the production coordinator.
// Run with Node: node analysis/rat-intro-balance.mjs [trials-per-policy=10000]
// Changes are in-memory only. Damage upgrades are sensitivity probes, not authored weapons.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseProject,compileChapter,validateProject} from '../project/model.js';
import {fight,policies} from './rat-balance.mjs';
const url=new URL('../saved-projects/rat-alternative.json',import.meta.url);
const raw=await readFile(url,'utf8'),project=parseProject(raw),errors=validateProject(project);
if(errors.length)throw new Error(JSON.stringify(errors));
const n=Number(process.argv[2]??10000);
if(!Number.isSafeInteger(n)||n<1)throw new Error('Positive trial count required');
const rat=project.library.find(d=>d.id==='rat');
const selected={attack:policies.attack,prepareOnTell:policies.prepareOnTell,
 prepareWhenUnprepared:s=>!s.prepared?'prepare':'attack',
 defendOnTell:policies.defendOnTell,cautious:policies.cautious,random:policies.random};
const scenarios=[{id:'saved',names:Object.keys(selected)},
 ...[3,5,6,8].map(enemyHealth=>({id:`rat_hp_${enemyHealth}`,enemyHealth})),
 ...[6,8].map(health=>({id:`player_hp_${health}`,health})),
 {id:'zero_energy',energy:0},
 {id:'punch_fixed_2',damage:{min:2,max:2}},
 {id:'damage_2_to_3',damage:{min:2,max:3}}];
const quantile=(a,p)=>a[Math.min(a.length-1,Math.floor(a.length*p))]??null;
const mean=(a,f)=>a.length?a.reduce((s,v)=>s+f(v),0)/a.length:null;
const result={source:'saved-projects/rat-alternative.json',sourceSha256:createHash('sha256').update(raw).digest('hex'),n,
 method:'Production CombatCoordinator, seeded LCG dice; no animation, physical dice or human play testing. Metrics prefixed winner are conditional on winning. Policies are state-aware and receive exact enemy HP; no hidden branch is exposed. No optimal-policy claim. Scenarios mutate compiled copies only.',
 scenarios:[]};
for(const scenario of scenarios){
 const c=compileChapter(project);
 if(scenario.energy!==undefined)c.variables.find(v=>v.id==='energy').initial=scenario.energy;
 if(scenario.damage)c.library.find(d=>d.id==='alternative-attack').attack.damage=scenario.damage;
 const item={...scenario,health:scenario.health??10,enemyHealth:scenario.enemyHealth??rat.health,policies:{}};
 for(const name of scenario.names??['attack','prepareOnTell','cautious']){
  const rows=[];
  for(let i=0;i<n;i++)rows.push(await fight(c,selected[name],Math.imul(i+1,2654435761)>>>0,{health:item.health,enemyHealth:item.enemyHealth}));
  const wins=rows.filter(r=>r.won),p=wins.length/n,z=1.96,den=1+z*z/n;
  const center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
  const turns=wins.map(r=>r.decisions).sort((a,b)=>a-b);
  item.policies[name]={wins:wins.length,winRate:p,confidence95:[center-half,center+half],meanDecisions:mean(rows,r=>r.decisions),winnerHealth:mean(wins,r=>r.hp),winnerEnergy:mean(wins,r=>r.energy),winnerDecisionsMedian:quantile(turns,.5),winnerDecisionsP90:quantile(turns,.9),lowHealthWinShareOfAllTrials:wins.filter(r=>r.hp<=2).length/n,winnerShareAt2HpOrLess:wins.length?wins.filter(r=>r.hp<=2).length/wins.length:null,actions:Object.fromEntries(['attack','prepare','defend'].map(a=>[a,mean(rows,r=>r.counts[a])]))};
  console.log(item.id,name,JSON.stringify(item.policies[name]));
 }
 result.scenarios.push(item);
}
if(createHash('sha256').update(await readFile(url)).digest('hex')!==result.sourceSha256)throw new Error('Source changed during simulation; rerun');
result.totalEncounters=result.scenarios.reduce((sum,s)=>sum+Object.keys(s.policies).length*n,0);
result.productionSourceSha256={};
for(const path of ['project/CombatCoordinator.js','project/combat-rules.js','analysis/rat-balance.mjs']){
 result.productionSourceSha256[path]=createHash('sha256').update(await readFile(new URL('../'+path,import.meta.url))).digest('hex');
}
await writeFile(new URL('./rat-intro-balance-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
