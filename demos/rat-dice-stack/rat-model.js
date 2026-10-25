export const ACTIONS=Object.freeze([{id:'attack',label:'Attack',cost:2},{id:'dodge',label:'Dodge',cost:1},{id:'recover',label:'Recover',cost:0}]);
const clone=s=>structuredClone(s);
function random(s){s.rng=(Math.imul(s.rng,1664525)+1013904223)>>>0;return s.rng/4294967296;}
const die=s=>1+Math.floor(random(s)*6);
export const terminal=s=>s.hp.some(x=>x===0);
function plan(s){if(terminal(s)){s.rat=null;return;}const heavy=random(s)<.5;s.rat={name:heavy?'UGRYZIENIE':'DRAPNIĘCIE',damage:heavy?3:2,die:die(s)};}
export function initial(seed=123){const s={seed:seed>>>0,rng:seed>>>0,hp:[10,10],energy:10,round:0,playerDie:null,rerolled:false,last:null};plan(s);return s;}
export function roll(s,{reroll=false}={}){if(terminal(s))throw Error('Walka zakończona');if(reroll?(s.playerDie===null||s.rerolled||s.energy<2):s.playerDie!==null)throw Error('Rzut niedostępny');const n=clone(s);if(reroll){n.energy-=2;n.rerolled=true;}n.playerDie=die(n);return n;}
export function preview(s,id){const action=ACTIONS.find(a=>a.id===id);if(!action)throw Error('Nieznana karta');const ready=s.playerDie!==null&&!terminal(s),advantage=ready?Math.sign(s.playerDie-s.rat.die):null;let hit=0,taken=0,gain=0;
 if(ready){if(id==='attack'){hit=advantage>0?3:advantage===0?2:1;taken=advantage>0?0:advantage===0?Math.min(2,s.rat.damage):s.rat.damage;}if(id==='dodge')hit=advantage>0?1:0;if(id==='recover'){taken=Math.max(1,s.rat.damage-(advantage>0?1:0));gain=Math.min(3,10-s.energy);}}
 hit=Math.min(s.hp[1],hit);taken=Math.min(s.hp[0],taken);return {...action,available:ready&&s.energy>=action.cost,ready,advantage,hit,taken,gain,energyAfter:Math.min(10,s.energy-action.cost+gain)};
}
export function resolve(s,id){const p=preview(s,id);if(!p.available)throw Error('Niedostępna karta');const n=clone(s);n.hp=[s.hp[0]-p.taken,s.hp[1]-p.hit];n.energy=p.energyAfter;n.round++;n.last={action:id,label:p.label,playerDie:s.playerDie,ratDie:s.rat.die,ratAttack:s.rat.name,ratDamage:s.rat.damage,advantage:p.advantage,hit:p.hit,taken:p.taken,gain:p.gain,cost:p.cost,rerolled:s.rerolled,hpDelta:n.hp.map((h,i)=>h-s.hp[i]),energyDelta:n.energy-s.energy,totalEnergyDelta:n.energy-s.energy-(s.rerolled?2:0)};n.playerDie=null;n.rerolled=false;plan(n);return n;}
export const verdict=s=>s.hp[0]===0?(s.hp[1]===0?'REMIS':'PRZEGRANA'):'ZWYCIĘSTWO';
