import {createProject} from './model-data.js';
import {createCombatAction,createWeapon,createEnemy,createEnemyAction} from './combat-model.js';
/** Explicit sample only. Never installed into the user's current project automatically. */
export function createRatCombatProject(){
 const project=createProject();project.id='rat-combat-example';project.name='Rat encounter';
 const chapter=project.chapters[0];chapter.name='Rat encounter';
 const punch=project.library.find(d=>d.id===project.combat.defaultActions[0].definitionId);punch.name='Punch';punch.attack={source:'self',damage:{min:1,max:1},minBonus:0,maxBonus:0};
 const shoot={...createCombatAction('pistol-shoot'),name:'Shoot',image:'./assets/img/Gemini_Generated_Image_esub9oesub9oesubd.jpeg',attack:{source:'weapon',minBonus:0,maxBonus:0}};
 const burst={...createCombatAction('pistol-burst'),name:'Burst',image:shoot.image,check:{pool:[{sides:6,count:3}],modifier:0,target:9},attack:{source:'weapon',minBonus:0,maxBonus:1},cooldown:1};
 const pistol={...createWeapon('pistol'),name:'Pistol',image:shoot.image,combat:{damage:{min:1,max:2},effects:[],actions:[shoot,burst]}};
 const enemy=createEnemy('rat');enemy.name='Rat';enemy.health=4;enemy.introEnabled=true;
 enemy.text='A rat jumps out of the corner!';enemy.image='./assets/img/rat.png';
 enemy.actions=[{...createEnemyAction('bite'),name:'Rat attacks you...',image:'./assets/img/Gemini_Generated_Image_mwbnlrmwbnlrmwbn.png',flipImage:true,imageScale:95,imageOffsetX:10,imageOffsetY:8}];
 enemy.hit={...enemy.hit,name:'Health damage',text:'Rat takes damage!',image:'./assets/img/rat_hit.png',imageScale:85,imageOffsetX:5,imageOffsetY:3};
 enemy.reactions=[{id:'weakened',threshold:{numerator:2,denominator:3},card:{id:'weak-card',kind:'caption',name:'Caption',image:'',text:'Rat seems weakened.'}},{id:'hurt',threshold:{numerator:1,denominator:3},card:{id:'hurt-card',kind:'caption',name:'Caption',image:'',text:'Rat seems severely hurt.'}}];
 enemy.death=[{id:'rat-dead',kind:'caption',name:'Caption',image:'',text:'The rat falls down dead in a puddle of its own blood.'}];
 const playerHit=project.library.find(d=>d.id===project.combat.playerHit.definitionId);Object.assign(playerHit,{name:'You take damage!',imageScale:85,imageOffsetY:3});
 const death=chapter.nodes.find(n=>n.id===chapter.deathNode);const deathCard=project.library.find(d=>d.id===death.cards[0].definitionId);deathCard.text='So.. this is how it feels. And suddenly you feel nothing. You die.';
 project.library.push(pistol,enemy,{id:'rat-after',kind:'caption',name:'After the encounter',showName:false,text:'You survived. The corridor stretches ahead.',image:'',effects:[]});
 chapter.nodes=[{id:'take-pistol',name:'Take Pistol',type:'container',x:80,y:80,introEnabled:false,intro:{id:'pickup-intro',definitionId:'arrival'},retainInventoryItems:true,items:[{id:'pistol-found',definitionId:'pistol'}],connections:{next:'rat-fight'}},{id:'rat-fight',name:'Rat encounter',type:'combat',x:380,y:80,enemy:{definitionId:'rat'},connections:{victory:'after-rat'}},{id:'after-rat',name:'Continue',type:'linear',x:680,y:80,cards:[{id:'after-card',definitionId:'rat-after'}],connections:{next:null}},death];chapter.startNode='take-pistol';
 return project;
}
