// Counterfactual comparisons only. No live project or production-rule writes.
// Run after: python3 analysis/four-hp-balance-options.py
// node analysis/four-hp-options-probe.mjs model
// node analysis/four-hp-options-probe.mjs production
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import process from 'node:process';
import {fight,policies} from './rat-balance.mjs';
import {parseProject,compileChapter} from '../project/model.js';

const root=new URL('./',import.meta.url);
const profiles={
 baseline:{base:2,bonus:2,bite:2,charge:4},
 autoPrepare:{base:2,bonus:2,bite:2,charge:4,automatic:true},
 durablePrepare:{base:2,bonus:2,bite:2,charge:4,durable:true},
 focusedPrepare:{base:2,bonus:2,bite:2,charge:4,accuracy:2},
 partialDefend:{base:2,bonus:2,bite:2,charge:4,partial:2},
 granularDamage:{base:1,bonus:3,bite:1,charge:2},
};
function rng(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
const fromTable=table=>s=>{
 const key=[s.hp,s.rat,s.energy,+s.prepared,+s.guard,s.cue].join(',');
 const action=table[key];if(!action)throw new Error(`Missing policy state ${key}`);return action;
};

// Independent actual-3d6 simulator: deliberately does not import model edges.
export function virtualFight(profile,policy,seed,{energy:startingEnergy=3,agility=3,composure=3,health=10}={}){
 const rules=profiles[profile],random=rng(seed),policyRandom=rng(seed^0xa5a5a5a5);
 let hp=health,rat=4,energy=startingEnergy,prepared=false,guard=false,cue,branch;
 let decisions=0,rolls=0;
 const counts={attack:0,prepare:0,defend:0};
 const check=(modifier=0,target=10)=>{
  rolls++;let total=modifier;
  for(let i=0;i<3;i++)total+=1+Math.floor(random()*6);
  return total>=target;
 };
 const incoming=damage=>{
  if(check()){
   if(!guard)hp-=damage;
   else if(rules.partial)hp-=Math.max(0,damage-rules.partial);
   else if(!check())hp-=damage;
  }
  hp=Math.max(0,hp);guard=false;
 };
 const declare=()=>{
  if(random()<.5){incoming(rules.bite);cue='clear';branch=null;}
  else {cue='prepare';branch=random()<.5?'block':'charge';}
 };
 declare();
 while(hp>0&&rat>0&&decisions<1000){
  const state={hp,rat,energy,prepared,guard,cue,turn:decisions,sample:policyRandom()};
  const action=policy(state);counts[action]++;decisions++;
  if(action==='attack'){
   let hit=check(agility+(prepared?(rules.accuracy??0):0),13);
   if(hit&&branch==='block'&&check())hit=false;
   if(hit)rat=Math.max(0,rat-rules.base-(prepared?rules.bonus:0));
   if(!rules.durable||hit)prepared=false;
  }else if(action==='prepare'){
   if(rules.automatic||check(composure,13))prepared=true;
  }else if(action==='defend'){
   if(energy<1)throw new Error('Unavailable Defend');
   energy--;guard=true;
  }else throw new Error(`Invalid action ${action}`);
  if(rat<=0)break;
  if(cue==='prepare'&&branch==='charge'){incoming(rules.charge);cue='clear';branch=null;}
  else {
   if(cue==='prepare')guard=false;
   declare();
  }
 }
 if(hp>0&&rat>0)throw new Error('Virtual policy stalled');
 return {won:rat<=0,hp,energy,decisions,rolls,counts};
}

function summarize(rows){
 const wins=rows.filter(r=>r.won),mean=(a,f)=>a.length?a.reduce((sum,r)=>sum+f(r),0)/a.length:null;
 return {n:rows.length,wins:wins.length,winRate:wins.length/rows.length,
  meanDecisions:mean(rows,r=>r.decisions),winnerDecisions:mean(wins,r=>r.decisions),
  winnerHp:mean(wins,r=>r.hp),winnerEnergy:mean(wins,r=>r.energy),
  meanPrepares:mean(rows,r=>r.counts.prepare),meanDefends:mean(rows,r=>r.counts.defend),
  prepareUseRate:rows.filter(r=>r.counts.prepare>0).length/rows.length,
  defendUseRate:rows.filter(r=>r.counts.defend>0).length/rows.length};
}

export async function runOptionsProbe(mode='model'){
 if(!['model','production'].includes(mode))throw new Error('Unknown probe mode');
 const raw=await readFile(new URL('checked-preparation-project-snapshot.json',root),'utf8');
 const original=parseProject(raw),exact=JSON.parse(await readFile(new URL('four-hp-balance-exact.json',root),'utf8'));
 const output={mode,sourceSha256:createHash('sha256').update(raw).digest('hex'),
  method:{ratHealth:4,healthCap:10,energyCap:10,startingHealth:10,physicalDice:false,animations:false,
   liveProjectChanged:false,metricsConditionalOnWin:['winnerDecisions','winnerHp','winnerEnergy'],
   description:mode==='production'?'Production coordinator with isolated authored-data overrides for baseline/automatic Preparation/rescaled damage.':'Independent actual-dice Monte Carlo of six counterfactual rule profiles; no exact-model edges imported.'},
  scenarios:[],totalEncounters:0};
 for(const profile of mode==='production'?['baseline','autoPrepare','granularDamage']:Object.keys(profiles)){
  const starts=mode==='production'?[[3,3,3],[10,3,3]]:[[3,3,3],[10,3,3],[3,4,3],[3,3,4]];
  for(const [energy,agility,composure] of starts){
   const model=exact.profiles[profile].models[`${agility}_${composure}`];
   const selected=mode==='production'?Object.fromEntries(['attack','alternate','prepareOnTell'].map(n=>[n,policies[n]]))
    :agility===3&&composure===3?{...policies}:{};
   selected.optimal=fromTable(model.optimalPolicy);
   if(mode==='model'&&agility===3&&composure===3){selected.optimalWithoutPrepare=fromTable(model.noPreparePolicy);selected.optimalWithoutDefend=fromTable(model.noDefendPolicy);}
   const project=structuredClone(original),rules=profiles[profile];
   const playerAttack=project.library.find(d=>d.id==='alternative-attack');
   const prep=project.library.find(d=>d.id==='alternative-preparation');
   const rat=project.library.find(d=>d.id==='rat');
   playerAttack.attack.damage={min:rules.base,max:rules.base};prep.preparationBonus=rules.bonus;
   if(rules.automatic)prep.resolution='direct';
   rat.actions.find(a=>a.type==='attack').attack.damage={min:rules.bite,max:rules.bite};
   rat.actions.find(a=>a.type==='prepare').preparationBonus=rules.charge-rules.bite;
   const compiled=compileChapter(project);
   for(const [id,value] of Object.entries({energy,agility,composure}))compiled.variables.find(v=>v.id===id).initial=value;
   const row={profile,playerHealth:10,ratHealth:4,startingEnergy:energy,agility,composure,policies:{}};
   const n=mode==='production'?10000:20000;
   for(const [name,policy] of Object.entries(selected)){
    const results=[];
    for(let trial=0;trial<n;trial++){
     const seed=((trial+1)*2654435761)>>>0;
     results.push(mode==='production'?await fight(compiled,policy,seed,{health:10,enemyHealth:4}):virtualFight(profile,policy,seed,{energy,agility,composure}));
    }
    row.policies[name]=summarize(results);output.totalEncounters+=n;
    console.error(`${mode} ${profile} E${energy} A${agility} C${composure} ${name}: ${(row.policies[name].winRate*100).toFixed(2)}%`);
   }
   output.scenarios.push(row);
  }
 }
 return output;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const mode=process.argv[2]??'model',result=await runOptionsProbe(mode);
 const file=new URL(`four-hp-options-${mode}-simulation.json`,root);
 await writeFile(file,JSON.stringify(result,null,2)+'\n');
 console.log(`Saved ${result.totalEncounters} ${mode} encounters.`);
}
