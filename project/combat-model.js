/** Canonical combat authoring data; no scenario fixtures are installed here. */
const base=(id,kind,name)=>({id,kind,name,showName:true,text:'',image:''});
export const createEffectCard=id=>base(id,'effect','Effect Card');
export const createEnemyAttack=id=>({...base(id,'combatAction','Attack'),check:{pool:[{sides:6,count:3}],modifier:0,target:11},damage:{min:1,max:2},costs:[],effects:[]});
export const createCombatAction=id=>({...base(id,'combatAction','Combat Action'),conditions:[],costs:[],effects:[],resolution:'check',check:{pool:[{sides:6,count:3}],modifier:0,target:11},successEffects:[],failureEffects:[],target:'enemy',attack:{source:'self',damage:{min:1,max:1},minBonus:0,maxBonus:0},cooldown:0});
export const createWeapon=id=>({...base(id,'item','Weapon'),subtype:'weapon',onCollect:[],permability:0,combat:{damage:{min:1,max:2},effects:[],actions:[]}});
export const createEnemy=id=>({...base(id,'enemy','Enemy'),health:4,introEnabled:false,intro:[],attacks:[createEnemyAttack(`${id}-attack`)],hit:createEffectCard(`${id}-hit`),reactions:[],death:[{...base(`${id}-death`,'caption','Death'),effects:[]}]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const allocate=(base,used)=>{let id=base,n=2;while(used.has(id))id=`${base}-${n++}`;used.add(id);return id;};
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
 if(!Object.hasOwn(project.combat,'playerHit')){const id=allocate('player-hit',used);project.library.push({...createEffectCard(id),name:'Player Hit',image:'./assets/img/player_hit.png'});project.combat.playerHit={definitionId:id};}}
 if(!Object.hasOwn(project,'showDeathBeat'))project.showDeathBeat=true;
 for(const chapter of Array.isArray(project.chapters)?project.chapters:[])ensureChapterDeath(project,chapter);project.version=3;return project;
}
export const createCombatDefaults=ensureCombatDefaults;
export function createProjectChapter(project,id='chapter-1',name='First chapter'){const chapter={id,name,startNode:'',variables:[],nodes:[]};ensureChapterDeath(project,chapter);return chapter;}
