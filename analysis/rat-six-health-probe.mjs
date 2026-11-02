// First: python3 analysis/rat-health-comparison.py
// Then: node --input-type=module -e 'import("./analysis/rat-six-health-probe.mjs").then(async m=>console.log(JSON.stringify(await m.runSixHealthComparison(),null,2)))'
// Headless fair-dice checks; does not write or alter either saved project.
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runBalance} from './rat-balance.mjs';

export async function runSixHealthComparison(n=10000){
 const source=new URL('../saved-projects/rat-alternative.json',import.meta.url);
 const variant=new URL('../saved-projects/rat-alternative-six-health.json',import.meta.url);
 const exact=JSON.parse(await readFile(new URL('./rat-health-comparison-exact.json',import.meta.url),'utf8'));
 const policyFor=table=>s=>table[[s.hp,s.rat,s.energy,+s.prepared,+s.guard,s.cue].join(',')];
 const optimal=policyFor(exact.optimalPolicy);
 const result=await runBalance({n,enemyHealth:6,projectUrl:variant,
  extraPolicies:{optimal,optimalWithoutDefend:policyFor(exact.noDefendPolicy)}});
 const eight=await runBalance({n,enemyHealth:8,projectUrl:source,includeDefaultPolicies:false,extraPolicies:{optimal}});
 result.eightHealthOptimal=eight.policies.optimal;
 result.exact=exact.byRatHealth;
 result.method={totalEncounters:n*10,playerHealth:10,energy:3,productionCoordinator:true,
  physicalDice:false,animations:false,meanDecisionsIncludesLosses:true,winnerMetricsConditional:true,
  sourceSha256:createHash('sha256').update(await readFile(source)).digest('hex'),
  variantSha256:createHash('sha256').update(await readFile(variant)).digest('hex')};
 return result;
}
