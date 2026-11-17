/** Pure per-visit Travel draws. Call only for accepted arrivals, never previews. */
function index(length,rng) {
 if(length===1)return 0;
 const value=rng();
 if(!Number.isFinite(value)||value<0||value>=1)throw new Error('Travel random source must return a number from 0 (inclusive) to 1 (exclusive).');
 return Math.floor(value*length);
}

export function createTravelVisit(config) {
 return {remainingEvents:config.eventCount,segmentRemaining:null,bag:[],lastStepId:null,stepNumber:0,played:new Set()};
}

export function drawTravelStep(config,visit,available,rng,forcedId) {
 if(!available.length)throw new Error('Auto Travel has no available step cards.');
 let segmentRemaining=visit.segmentRemaining;
 if(segmentRemaining===null)segmentRemaining=config.minSteps+index(config.maxSteps-config.minSteps+1,rng);
 let bag=visit.bag.filter(id=>available.some(card=>card.id===id));
 if(!bag.length)bag=available.map(card=>card.id);
 const forced=forcedId===undefined?null:available.find(card=>card.id===forcedId);
 if(forcedId!==undefined&&!forced)throw new Error('The selected Travel step is unavailable.');
 const candidates=bag.length>1?bag.filter(id=>id!==visit.lastStepId):bag;
 let id=forced?.id;
 if(id===undefined&&config.randomizeStepCards!==true){
  const order=config.steps.map(card=>card.id),last=order.indexOf(visit.lastStepId);
  for(let offset=1;offset<=order.length;offset++){
   const next=order[(last+offset)%order.length];
   if(available.some(card=>card.id===next)){id=next;break;}
  }
 }
 id??=candidates[index(candidates.length,rng)];
 return {card:available.find(card=>card.id===id),visit:{...visit,bag:bag.filter(key=>key!==id),lastStepId:id,
  segmentRemaining:segmentRemaining-1,stepNumber:visit.stepNumber+1}};
}
