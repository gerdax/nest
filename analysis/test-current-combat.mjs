// Production-coordinator balance test of the frozen published project.
// Run: node analysis/test-current-combat.mjs heuristics
// Then: python3 analysis/checked-preparation-balance-model.py
// Then: node analysis/test-current-combat.mjs optimal
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import process from 'node:process';
import {fight,policies} from './rat-balance.mjs';
import {parseProject,compileChapter,validateProject} from '../project/model.js';

const snapshotUrl=new URL('./checked-preparation-project-snapshot.json',import.meta.url);
const scenarios=[
 {id:'r8_e3_a3_c3',ratHealth:8,startingEnergy:3,agility:3,composure:3,n:10000,full:true},
 {id:'r6_e3_a3_c3',ratHealth:6,startingEnergy:3,agility:3,composure:3,n:10000,full:true},
 {id:'r8_e10_a3_c3',ratHealth:8,startingEnergy:10,agility:3,composure:3,n:10000},
 {id:'r6_e10_a3_c3',ratHealth:6,startingEnergy:10,agility:3,composure:3,n:10000},
 {id:'r8_e3_a4_c3',ratHealth:8,startingEnergy:3,agility:4,composure:3,n:5000,sensitivity:true},
 {id:'r8_e3_a3_c4',ratHealth:8,startingEnergy:3,agility:3,composure:4,n:5000,sensitivity:true},
 {id:'r8_e3_a5_c3',ratHealth:8,startingEnergy:3,agility:5,composure:3,n:5000,sensitivity:true},
 {id:'r8_e3_a3_c5',ratHealth:8,startingEnergy:3,agility:3,composure:5,n:5000,sensitivity:true},
];

function interval(wins,n){
 const p=wins/n,z=1.96,den=1+z*z/n;
 const center=(p+z*z/(2*n))/den,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/den;
 return [center-half,center+half];
}
function summarize(rows){
 const winners=rows.filter(r=>r.won),n=rows.length;
 const mean=(data,value)=>data.length?data.reduce((sum,r)=>sum+value(r),0)/data.length:null;
 const turns=winners.map(r=>r.decisions).sort((a,b)=>a-b);
 return {n,wins:winners.length,winRate:winners.length/n,confidence95:interval(winners.length,n),
  meanDecisions:mean(rows,r=>r.decisions),meanRolls:mean(rows,r=>r.rolls),
  meanPrepares:mean(rows,r=>r.counts.prepare),meanDefends:mean(rows,r=>r.counts.defend),
  fightsUsingPrepare:rows.filter(r=>r.counts.prepare>0).length/n,
  fightsUsingDefend:rows.filter(r=>r.counts.defend>0).length/n,
  winnerHp:mean(winners,r=>r.hp),winnerEnergy:mean(winners,r=>r.energy),
  winnerDecisionMedian:turns[Math.floor(turns.length*.5)]??null,
  winnerDecisionP90:turns[Math.floor(turns.length*.9)]??null};
}
const fromTable=table=>state=>{
 const key=[state.hp,state.rat,state.energy,+state.prepared,+state.guard,state.cue].join(',');
 const action=table[key];if(!action)throw new Error(`Missing policy state ${key}`);return action;
};

export async function runCurrentCombatBalance(phase='all'){
 if(!['heuristics','optimal','all'].includes(phase))throw new Error('Unknown phase');
 const raw=await readFile(snapshotUrl,'utf8'),project=parseProject(raw);
 if(validateProject(project).length)throw new Error('Invalid frozen project');
 const exact=phase==='heuristics'?null:JSON.parse(await readFile(new URL('./checked-preparation-exact-results.json',import.meta.url),'utf8'));
 const result={phase,sourceSha256:createHash('sha256').update(raw).digest('hex'),
  method:{source:'published snapshot',publishedUrl:'https://gerdax.github.io/nest/rat-encounter-player-checks/player.html',
   physicalDice:false,animations:false,startingHealth:10,healthCap:10,energyCap:10,
   winnerMetricsConditional:true,meanDecisionsIncludesLosses:true,
   rng:'LCG1664525/1013904223, seed ((trial+1)*2654435761)>>>0; shared seeds do not imply identical trajectories'},
  scenarios:[],totalEncounters:0};
 for(const scenario of scenarios){
  const compiled=compileChapter(project);
  for(const [id,value] of Object.entries({health:10,energy:scenario.startingEnergy,agility:scenario.agility,composure:scenario.composure})){
   const variable=compiled.variables.find(v=>v.id===id);if(!variable||value<variable.min||value>variable.max)throw new Error(`Invalid ${id}`);
   variable.initial=value;
  }
  const selected={};
  if(phase!=='optimal'){
   const names=scenario.full?Object.keys(policies):scenario.sensitivity?['attack','prepareOnTell']:['attack','prepareOnTell','defendOnTell'];
   for(const name of names)selected[name]=policies[name];
  }
  if(exact){
   const model=exact.models[`${scenario.agility}_${scenario.composure}`];
   selected.optimal=fromTable(model.optimalPolicy);
   if(scenario.full){selected.optimalWithoutPrepare=fromTable(model.noPreparePolicy);selected.optimalWithoutDefend=fromTable(model.noDefendPolicy);}
  }
  const item={...scenario,policies:{}};
  for(const [name,policy] of Object.entries(selected)){
   const rows=[];
   for(let trial=0;trial<scenario.n;trial++)rows.push(await fight(compiled,policy,((trial+1)*2654435761)>>>0,{health:10,enemyHealth:scenario.ratHealth}));
   item.policies[name]=summarize(rows);result.totalEncounters+=scenario.n;
   console.error(`${scenario.id} ${name}: ${(item.policies[name].winRate*100).toFixed(2)}% (${scenario.n})`);
  }
  result.scenarios.push(item);
 }
 return result;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
 const phase=process.argv[2]??'all',result=await runCurrentCombatBalance(phase);
 const destination=new URL(`./checked-preparation-simulation-${phase}.json`,import.meta.url);
 await writeFile(destination,JSON.stringify(result,null,2)+'\n');
 console.log(`Saved ${result.totalEncounters} encounters to ${fileURLToPath(destination)}`);
}
