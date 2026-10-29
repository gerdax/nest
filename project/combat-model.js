/** Canonical combat authoring data; no scenario fixtures are installed here. */
const base=(id,kind,name)=>({id,kind,name,showName:true,text:'',image:''});
export const createEffectCard=id=>({...base(id,'effect','Effect Card'),headingFromDescription:true});
export const createCombatAction=id=>({...base(id,'combatAction','Combat Action'),type:'attack',conditions:[],costs:[],effects:[],resolution:'check',check:{pool:[{sides:6,count:3}],modifier:0,target:11},successEffects:[],failureEffects:[],target:'opponent',attack:{source:'self',damage:{min:1,max:1},minBonus:0,maxBonus:0},cooldown:0});
export const createEnemyAction=id=>({...createCombatAction(id),name:'Attack',attack:{source:'self',damage:{min:1,max:2},minBonus:0,maxBonus:0}});
// Retain the old factory entry point for existing integrations.
export const createEnemyAttack=createEnemyAction;
export const createWeapon=id=>({...base(id,'item','Weapon'),subtype:'weapon',onCollect:[],permability:0,combat:{damage:{min:1,max:2},effects:[],actions:[]}});
export const createEnemy=id=>({...base(id,'enemy','Enemy'),health:4,introEnabled:false,actions:[createEnemyAction(`${id}-action`)],hit:{...createEffectCard(`${id}-hit`),name:'Health damage',headingFromDescription:true},reactions:[],death:[{...base(`${id}-death`,'caption','Death'),effects:[]}]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const allocate=(base,used)=>{let id=base,n=2;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;};
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
 // All Effect Cards use Description as player-facing text; Name is an editor label.
 // Carry legacy name-only copy across once; an intentionally cleared description
 // stays empty on future loads.
 for(const definition of project.library){
  const effects=[definition,...(definition?.kind==='enemy'?[definition.hit,...(Array.isArray(definition.reactions)?definition.reactions:[]).map(r=>r?.card)]:[])];
  for(const effect of effects)if(effect?.kind==='effect'&&effect.headingFromDescription!==true){
   if(!effect.text)effect.text=effect.name??'';
   effect.headingFromDescription=true;
  }
 }
 if(!Object.hasOwn(project,'showDeathBeat'))project.showDeathBeat=true;
 for(const chapter of Array.isArray(project.chapters)?project.chapters:[])ensureChapterDeath(project,chapter);migrateEnemyActions(project);migrateWeaponActions(project);migrateCombatActionTypes(project);project.version=3;return project;
}
export const createCombatDefaults=ensureCombatDefaults;
export function createProjectChapter(project,id='chapter-1',name='First chapter'){const chapter={id,name,startNode:'',variables:[],nodes:[]};ensureChapterDeath(project,chapter);return chapter;}
