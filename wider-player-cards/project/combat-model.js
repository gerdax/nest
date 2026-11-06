/** Canonical combat authoring data; no scenario fixtures are installed here. */
const base=(id,kind,name)=>({id,kind,name,showName:true,text:'',image:''});
export const createEffectCard=id=>({...base(id,'effect','Feedback'),headingFromDescription:true});
export const createCombatAction=id=>({...base(id,'combatAction','Combat Action'),type:'attack',conditions:[],costs:[],effects:[],resolution:'check',check:{pool:[{sides:6,count:3}],modifier:0,target:11},successEffects:[],failureEffects:[],target:'opponent',attack:{source:'self',damage:{min:1,max:1},minBonus:0,maxBonus:0},cooldown:0});
export const createEnemyAction=id=>({...createCombatAction(id),name:'Attack',attack:{source:'self',damage:{min:1,max:2},minBonus:0,maxBonus:0}});
// Retain the old factory entry point for existing integrations.
export const createEnemyAttack=createEnemyAction;
export const createWeapon=id=>({...base(id,'item','Weapon'),subtype:'weapon',onCollect:[],permability:0,combat:{damage:{min:1,max:2},effects:[],actions:[]}});
export const createEnemy=id=>({...base(id,'enemy','Enemy'),health:4,actions:[createEnemyAction(`${id}-action`)],hit:{...createEffectCard(`${id}-hit`),name:'Health damage',headingFromDescription:true},reactions:[],death:[{...base(`${id}-death`,'caption','Death'),effects:[]}]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const allocate=(base,used)=>{let id=base,n=2;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;};
/** Presentation-only cards owned by an alternative Enemy, just like its hit/death cards. */
export function ensureEnemyPreparationCards(enemy,used=new Set()){
 if(enemy?.kind!=='enemy'||enemy.mechanics!=='opposed-preparation')return enemy;
 if(!Object.hasOwn(enemy,'preparationCards')&&Array.isArray(enemy.actions)&&enemy.actions.some(a=>a?.type==='prepare'&&Object.hasOwn(a,'preparedActions')))return enemy;
 if(!Object.hasOwn(enemy,'preparationCards'))enemy.preparationCards={};
 if(!object(enemy.preparationCards))return enemy; // Preserve invalid authored data for validation.
 const collect=value=>{if(Array.isArray(value))value.forEach(collect);else if(object(value)){if(typeof value.id==='string')used.add(value.id);Object.values(value).forEach(collect);}};collect(enemy);
 const name=String(enemy.name??'Enemy');
 const defaults=[['block','event','Dodge',`${name} reveals its defense.`],['charge','event','Rush',`${name} reveals its charge!`],['hold','caption','Skip',`The ${name.toLowerCase()} holds its ground`]];
 for(const [key,kind,name,text] of defaults)if(!Object.hasOwn(enemy.preparationCards,key)){
  enemy.preparationCards[key]={...base(allocate(`${enemy.id}-preparation-${key}`,used),kind,name),text,effects:[]};
 }
 // Seed independent prepared checks once; later Attack edits must not retarget Rush.
 const attack=Array.isArray(enemy.actions)?enemy.actions.find(action=>action?.type==='attack'):null;
 const defaultCheck=()=>({pool:[{sides:6,count:3}],modifier:0,target:10});
 const dodge=enemy.preparationCards.block,rush=enemy.preparationCards.charge;
 if(object(dodge)){
  if(!Object.hasOwn(dodge,'resolution'))dodge.resolution='check';
  if(!Object.hasOwn(dodge,'check'))dodge.check=defaultCheck();
 }
 if(object(rush)){
  if(!Object.hasOwn(rush,'resolution'))rush.resolution=attack?.resolution??'check';
  if(!Object.hasOwn(rush,'check'))rush.check=attack&&Object.hasOwn(attack,'check')?structuredClone(attack.check):defaultCheck();
 }
 return enemy;
}
// Legacy reveals keep their authored data; every Defend reveal uses Effect styling.
export const defendRevealCard=card=>({...card,kind:'effect',showValue:false});
/** Presentation-only feedback owned by a player Defend Action. */
export function ensurePlayerBlockReveal(action,used=new Set()){
 if(action?.kind!=='combatAction'||action.type!=='defend'||Object.hasOwn(action,'blockReveal')||Object.hasOwn(action,'reveal'))return action;
 const collect=value=>{if(Array.isArray(value))value.forEach(collect);else if(object(value)){if(typeof value.id==='string')used.add(value.id);Object.values(value).forEach(collect);}};collect(action);
 action.blockReveal={...createEffectCard(allocate(`${action.id}-block-reveal`,used)),name:'Reveal',text:'You blocked the attack',effects:[]};
 return action;
}
export function migratePlayerBlockReveals(project){
 if(!object(project)||!Array.isArray(project.library))return project;
 const used=new Set();
 const collect=value=>{if(Array.isArray(value))value.forEach(collect);else if(object(value)){if(typeof value.id==='string')used.add(value.id);Object.values(value).forEach(collect);}};collect(project);
 const actions=project.library.flatMap(d=>d?.kind==='combatAction'?[d]:d?.kind==='item'&&d.subtype==='weapon'&&Array.isArray(d.combat?.actions)?d.combat.actions:[]).filter(a=>a?.kind==='combatAction'&&a.type==='defend');
 for(const action of actions)ensurePlayerBlockReveal(action,used);
 if(!object(project.combat))return project;
 const valid=card=>object(card)&&['effect','event','caption'].includes(card.kind)&&['id','name','text','image'].every(k=>typeof card[k]==='string')&&['effects','onCollect','successEffects','failureEffects'].every(k=>card[k]===undefined||Array.isArray(card[k])&&!card[k].length);
 const defaults=new Set((project.combat.defaultActions??[]).map(ref=>ref?.definitionId));
 const seed=actions.find(a=>defaults.has(a.id)&&valid(a.blockReveal));
 const promoteSeed=!Object.hasOwn(project.combat,'playerDodge');
 const promote=(card,id,name)=>{const feedback={...defendRevealCard(structuredClone(card)),id:allocate(id,used),name,headingFromDescription:true};delete feedback.visibility;delete feedback.chapterId;delete feedback.showValue;delete feedback.onCollect;delete feedback.successEffects;delete feedback.failureEffects;project.library.push(feedback);return {definitionId:feedback.id};};
 if(!Object.hasOwn(project.combat,'playerDodge')){
  project.combat.playerDodge=seed?promote(seed.blockReveal,'player-dodge','Dodge'):(()=>{const card={...createEffectCard('player-dodge'),text:'You dodge!'};return promote(card,'player-dodge','Dodge');})();
 }
 for(const action of actions){
  if(Object.hasOwn(action,'reveal')||!valid(action.blockReveal))continue;
  const card=action.blockReveal;
  // Generated legacy defaults use the shared card; authored variants retain their own source.
  const generated=!card.image&&card.text==='You blocked the attack'&&['Reveal','Block reveal'].includes(card.name);
  action.reveal=(promoteSeed&&action===seed)||generated?{...project.combat.playerDodge}:promote(card,`${card.id}-feedback`,card.name||'Dodge');
 }
 return project;
}
/** Existing player Actions retain their attack behaviour on upgrade. */
export function migrateCombatActionTypes(project){
 if(!object(project)||!Array.isArray(project.library))return project;
 const migrate=action=>{if(object(action)&&action.kind==='combatAction'&&!Object.hasOwn(action,'type'))action.type='attack';};
 for(const definition of project.library){migrate(definition);if(definition?.kind==='item')for(const action of Array.isArray(definition.combat?.actions)?definition.combat.actions:[])migrate(action);}
 return project;
}
/** Upgrade legacy Enemy Actions without repairing explicitly authored invalid data. */
export function migrateEnemyActions(project){
 if(!object(project)||!Array.isArray(project.library))return project;
 const used=new Set();
 const collect=value=>{if(Array.isArray(value))value.forEach(collect);else if(object(value)){if(typeof value.id==='string')used.add(value.id);Object.values(value).forEach(collect);}};collect(project);
 for(const enemy of project.library){
  if(enemy?.kind!=='enemy')continue;
  if(!Object.hasOwn(enemy,'actions')&&Array.isArray(enemy.attacks)){
   enemy.actions=enemy.attacks.map(action=>object(action)?{...action,...(!Object.hasOwn(action,'kind')?{kind:'combatAction'}:{})}:action);
   delete enemy.attacks;
  }
  for(const action of Array.isArray(enemy.actions)?enemy.actions:[]){
   if(!object(action))continue;
   if(!Object.hasOwn(action,'type'))action.type='attack';
   if(Object.hasOwn(action,'damage')&&!Object.hasOwn(action,'attack')){
    action.attack={source:'self',damage:action.damage,minBonus:0,maxBonus:0};
    delete action.damage;
   }
   const defaults={conditions:[],resolution:action.type==='attack'?'check':'direct',successEffects:[],failureEffects:[],cooldown:0,target:'opponent'};
   for(const [key,value] of Object.entries(defaults))if(!Object.hasOwn(action,key))action[key]=value;
  }
  ensureEnemyPreparationCards(enemy,used);
 }
 return project;
}
/** Upgrade legacy Weapon links to independently owned Actions. Unresolved links
 * survive unchanged so validation can explain the missing source. */
export function migrateWeaponActions(project){
 if(!object(project)||!Array.isArray(project.library))return project;
 const definitions=new Map(),duplicateIds=new Set(),migrated=new Set();
 for(const d of project.library.filter(object)){if(definitions.has(d.id))duplicateIds.add(d.id);definitions.set(d.id,d);}
 for(const weapon of project.library){
  if(weapon?.kind!=='item'||weapon.subtype!=='weapon'||!Array.isArray(weapon.combat?.actions))continue;
  weapon.combat.actions=weapon.combat.actions.map(ref=>{
   if(!object(ref)||typeof ref.definitionId!=='string'||ref.kind==='combatAction')return ref;
   const source=definitions.get(ref.definitionId);if(source?.kind!=='combatAction'||source.visibility==='local'||duplicateIds.has(ref.definitionId))return ref;
   const action={...structuredClone(source),...structuredClone(ref),id:ref.id??source.id};
   delete action.definitionId;delete action.visibility;delete action.chapterId;
   migrated.add(source.id);return action;
  });
 }
 // Only remove sources copied above, and only when no authored reference still
 // needs them. Other standalone/common Actions are never inferred to be unused.
 const referenced=new Set();
 const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(object(value)){if(typeof value.definitionId==='string')referenced.add(value.definitionId);Object.values(value).forEach(visit);}};
 visit(project);
 project.library=project.library.filter(d=>!migrated.has(d?.id)||referenced.has(d.id));
 return project;
}
/** Promote legacy opposed preparation into independently owned Enemy Actions.
 * Legacy presentation cards remain archived on the Enemy. Invalid authored data
 * is left intact for validation rather than silently converted or repaired. */
export function migrateEnemyPreparedActions(project){
 if(!object(project)||!Array.isArray(project.library))return project;
 const used=new Set();
 const collect=value=>{if(Array.isArray(value))value.forEach(collect);else if(object(value)){if(typeof value.id==='string')used.add(value.id);Object.values(value).forEach(collect);}};collect(project);
 // Earlier v3 drafts stored prepared Actions in the common Library. Copy each
 // source once per Enemy. Valid player definitions remain untouched.
 const definitions=new Map(),duplicates=new Set(),copiedBy=new Map();
 for(const d of project.library.filter(object)){if(definitions.has(d.id))duplicates.add(d.id);definitions.set(d.id,d);}
 for(const enemy of project.library){
  if(enemy?.kind!=='enemy'||!Array.isArray(enemy.actions))continue;
  const owned=new Map();
  const convert=ref=>{
   if(!object(ref)||typeof ref.definitionId!=='string'||Object.hasOwn(ref,'actionId'))return;
   const source=definitions.get(ref.definitionId);
   if(source?.kind!=='combatAction'||source.visibility==='local'||duplicates.has(source.id)||Object.hasOwn(enemy,'preparedActions')&&!Array.isArray(enemy.preparedActions))return;
   if(!owned.has(source.id)){
    const action=structuredClone(source);action.id=allocate(`${enemy.id}-prepared-${source.id}`,used);
    delete action.visibility;delete action.chapterId;delete action.definitionId;
    (enemy.preparedActions??=[]).push(action);owned.set(source.id,action.id);
    if(!copiedBy.has(source.id))copiedBy.set(source.id,[]);copiedBy.get(source.id).push(enemy);
   }
   ref.actionId=owned.get(source.id);delete ref.definitionId;
  };
  for(const action of enemy.actions)if(action?.type==='prepare'&&Array.isArray(action.preparedActions))for(const ref of action.preparedActions){convert(ref);convert(ref?.fallback);}
 }
 // A checked full Dodge created by the early shared draft was never a V1
 // player Action. Archive it only after all active references have moved.
 const referenced=new Set();
 const visit=value=>{if(Array.isArray(value))value.forEach(visit);else if(object(value)){if(typeof value.definitionId==='string')referenced.add(value.definitionId);Object.values(value).forEach(visit);}};visit(project);
 const retired=new Set();
 for(const [id,owners] of copiedBy){
  const source=definitions.get(id);
  if(source.type!=='defend'||source.protection!=='all'||source.resolution!=='check'||referenced.has(id)||owners.some(enemy=>Object.hasOwn(enemy,'legacyPreparedActionSources')&&!Array.isArray(enemy.legacyPreparedActionSources)))continue;
  for(const enemy of owners)(enemy.legacyPreparedActionSources??=[]).push(structuredClone(source));
  retired.add(id);
 }
 project.library=project.library.filter(source=>!retired.has(source?.id));
 const empty=value=>value===undefined||Array.isArray(value)&&value.length===0;
 const checkValid=c=>object(c)&&(c.mode==='stat'?typeof c.modifierVariable==='string'&&Number.isInteger(c.difficulty)&&c.difficulty>=1&&c.difficulty<=10:
  (c.mode===undefined||c.mode==='custom')&&Array.isArray(c.pool)&&c.pool.length>0&&c.pool.every(d=>object(d)&&[4,6,8,10,12,20].includes(d.sides)&&Number.isSafeInteger(d.count)&&d.count>=1&&d.count<=30)&&c.pool.reduce((n,d)=>n+d.count,0)<=30&&Number.isFinite(c.modifier)&&Number.isFinite(c.target));
 const cardValid=(card,checked)=>object(card)&&['event','caption'].includes(card.kind)&&['id','name','text','image'].every(k=>typeof card[k]==='string')&&['conditions','costs','effects','onCollect','successEffects','failureEffects'].every(k=>empty(card[k]))&&(card.cooldown===undefined||card.cooldown===0)&&(!checked||['direct','check'].includes(card.resolution)&& (card.resolution!=='check'||checkValid(card.check)));
 const promote=(enemy,card,type,id,extra={})=>{
  const action={...structuredClone(card),id:allocate(id,used),kind:'combatAction',type,presentationKind:card.kind,conditions:[],costs:[],effects:[],successEffects:[],failureEffects:[],cooldown:0,target:'opponent',resolution:'direct',...extra};
  delete action.visibility;delete action.chapterId;delete action.onCollect;
  (enemy.preparedActions??=[]).push(action);return action;
 };
 for(const enemy of [...project.library]){
  if(enemy?.kind!=='enemy'||enemy.mechanics!=='opposed-preparation'||!Array.isArray(enemy.actions)||!object(enemy.preparationCards)||Object.hasOwn(enemy,'preparedActions')&&!Array.isArray(enemy.preparedActions))continue;
  const {block,charge,hold}=enemy.preparationCards;
  if(!cardValid(block,true)||!cardValid(charge,true)||!cardValid(hold,false))continue;
  const attack=enemy.actions.find(a=>a?.type==='attack');
  if(!object(attack?.attack)||attack.attack.source!=='self'||!object(attack.attack.damage)||!['min','max'].every(k=>Number.isSafeInteger(attack.attack.damage[k]))||attack.attack.damage.min<0||attack.attack.damage.max<attack.attack.damage.min||!['minBonus','maxBonus'].every(k=>Number.isSafeInteger(attack.attack[k])))continue;
  if(['conditions','costs'].some(k=>!empty(attack[k]))||attack.cooldown!==0)continue;
  for(const preparation of enemy.actions){
   if(preparation?.type!=='prepare'||Object.hasOwn(preparation,'preparedActions'))continue;
   if(!Number.isSafeInteger(preparation.preparationBonus)||preparation.preparationBonus<1||!Number.isSafeInteger(preparation.damageReduction)||preparation.damageReduction<1||preparation.resolution!=='direct'||['conditions','costs'].some(k=>!empty(preparation[k]))||preparation.cooldown!==0)continue;
   const profile=structuredClone(attack.attack);
   profile.minBonus+=preparation.preparationBonus;profile.maxBonus+=preparation.preparationBonus;
   if(![profile.minBonus,profile.maxBonus,profile.damage.min+profile.minBonus,profile.damage.max+profile.maxBonus].every(Number.isSafeInteger)||profile.damage.min+profile.minBonus<0||profile.damage.max+profile.maxBonus<profile.damage.min+profile.minBonus)continue;
   const prefix=`${preparation.id}-prepared`;
   const skip=promote(enemy,hold,'wait',`${prefix}-skip`);
   const dodge=promote(enemy,block,'defend',`${prefix}-dodge`,{protection:'all',damageReduction:1,resolution:block.resolution,check:structuredClone(block.check)});
   const rush=promote(enemy,charge,'attack',`${prefix}-rush`,{attack:profile,resolution:charge.resolution,check:structuredClone(charge.check),effects:structuredClone(attack.effects??[]),successEffects:structuredClone(attack.successEffects??[]),failureEffects:structuredClone(attack.failureEffects??[])});
   preparation.preparedActions=[{actionId:dodge.id,weight:1,trigger:'incoming-hit',fallback:{actionId:skip.id,when:['defend','wait']}},{actionId:rush.id,weight:1,trigger:'after-player-action'}];
  }
 }
 // Owned attacks describe their complete damage range, including legacy bonuses.
 for(const enemy of project.library)if(enemy?.kind==='enemy')for(const action of Array.isArray(enemy.preparedActions)?enemy.preparedActions:[]){
  const profile=action?.type==='attack'&&action.attack;
  if(profile?.source!=='self'||!object(profile.damage)||![profile.damage.min,profile.damage.max,profile.minBonus,profile.maxBonus].every(Number.isSafeInteger)||profile.damage.min<0||profile.damage.max<profile.damage.min)continue;
  const min=profile.damage.min+profile.minBonus,max=profile.damage.max+profile.maxBonus;
  if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||min<0||max<min)continue;
  profile.damage={...profile.damage,min,max};profile.minBonus=0;profile.maxBonus=0;
 }

 return project;
}
export function ensureChapterDeath(project,chapter){
 if(!object(chapter)||!Array.isArray(chapter.nodes)||!Array.isArray(project.library)||Object.hasOwn(chapter,'deathNode'))return chapter;
 const existing=chapter.nodes.filter(n=>n?.type==='death');if(existing.length){chapter.deathNode=existing[0].id;return chapter;}
 const used=new Set();const collect=v=>{if(Array.isArray(v))v.forEach(collect);else if(object(v)){if(typeof v.id==='string')used.add(v.id);Object.values(v).forEach(collect);}};collect(project);
 const id=allocate(`${chapter.id}-death`,used),definitionId=allocate(`${chapter.id}-death-caption`,used);
 project.library.push({...base(definitionId,'caption','Caption'),showName:false,effects:[],visibility:'local',chapterId:chapter.id});
 chapter.nodes.push({id,name:'Death',type:'death',x:80,y:340,cards:[{id:allocate(`${id}-card`,used),definitionId}],connections:{}});chapter.deathNode=id;return chapter;
}
export function ensureCombatDefaults(project){
 if(!object(project)||!Array.isArray(project.library))return project;
 if(project.version!==undefined&&![1,2,3].includes(project.version))throw new Error('Unsupported project version');
 const used=new Set(project.library.map(d=>d?.id));if(!Object.hasOwn(project,'combat'))project.combat={};
 if(object(project.combat)){
 if(!Object.hasOwn(project.combat,'defaultActions')){const id=allocate('punch',used);project.library.push({...createCombatAction(id),name:'Punch'});project.combat.defaultActions=[{definitionId:id}];}
 if(!Object.hasOwn(project.combat,'playerHit')){const id=allocate('player-hit',used);project.library.push({...createEffectCard(id),name:'Player Hit',text:'You take damage!',image:'./assets/img/player_hit.png'});project.combat.playerHit={definitionId:id};}}
 // All Feedback presentations use Description as player-facing text; Name is an editor label.
 // Carry legacy name-only copy across once; an intentionally cleared description
 // stays empty on future loads.
 for(const definition of project.library){
  const effects=[definition,...(definition?.kind==='enemy'?[definition.hit,...(Array.isArray(definition.reactions)?definition.reactions:[]).map(r=>r?.card)]:[])];
  for(const effect of effects)if(effect?.kind==='effect'&&effect.headingFromDescription!==true){
   if(!effect.text)effect.text=effect.name??'';
   effect.headingFromDescription=true;
  }
  // Reactions are narrative presentations, never resource Feedback presentations.
  if(definition?.kind==='enemy')for(const reaction of Array.isArray(definition.reactions)?definition.reactions:[]){
   if(reaction?.card?.kind==='effect'){
    reaction.card.kind=reaction.card.image?'event':'caption';
    delete reaction.card.headingFromDescription;
   }
  }
 }
 if(!Object.hasOwn(project,'showDeathBeat'))project.showDeathBeat=true;
 for(const chapter of Array.isArray(project.chapters)?project.chapters:[]){
  ensureChapterDeath(project,chapter);
  for(const node of Array.isArray(chapter?.nodes)?chapter.nodes:[]){
   if(node?.type!=='combat'||Object.hasOwn(node,'introEnabled'))continue;
   const enemy=project.library.find(d=>d?.kind==='enemy'&&d.id===node.enemy?.definitionId);
   // Legacy Enemy introductions become a per-beat choice once. Keep the old
   // property for compatibility, and never replace an explicit authored value.
   node.introEnabled=typeof enemy?.introEnabled==='boolean'?enemy.introEnabled:false;
  }
 }
 migrateEnemyActions(project);migrateWeaponActions(project);migrateCombatActionTypes(project);migratePlayerBlockReveals(project);migrateEnemyPreparedActions(project);project.version=3;return project;
}
export const createCombatDefaults=ensureCombatDefaults;
export function createProjectChapter(project,id='chapter-1',name='First chapter'){const chapter={id,name,startNode:'',variables:[],nodes:[]};ensureChapterDeath(project,chapter);return chapter;}
