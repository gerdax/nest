import {createProject} from '../../project/model.js';
import {createDefinition} from '../../project/cards.js';

/** Separate demonstration; never edits or saves an authored project. */
export function createTravelProject(){
 const project=createProject(),chapter=project.chapters[0],death=chapter.nodes.find(n=>n.type==='death');
 project.name='Auto Travel demonstration';chapter.name='A route to Security';
 project.variables.find(v=>v.id==='health').initial=7;
 project.variables.push({id:'travel-distance',name:'Steps taken',type:'number',initial:0},{id:'heard-pipes',name:'Heard the pipes',type:'flag',initial:false});
 const add=(kind,id,fields)=>{const card={...createDefinition(kind,id),...fields};project.library.push(card);return card;};
 add('event','travel-stairs',{name:'Stairs',headline:'Another flight of stairs. The light above grows smaller.',effects:[{op:'add',key:'travel-distance',value:1}]});
 add('caption','travel-steps',{name:'Footsteps',headline:'Your footsteps return from somewhere below.',effects:[{op:'add',key:'travel-distance',value:1}]});
 add('event','travel-pipes',{visibility:'local',chapterId:chapter.id,name:'Warm pipes',headline:'Warm pipes disappear through the wall.',effects:[{op:'add',key:'travel-distance',value:1}]});
 add('event','travel-noise',{name:'A sound',headline:'Something taps against the other side of a service door.'});
 add('action','travel-listen',{name:'Listen',headline:'Stop and listen',description:'Hold your breath by the door.',effects:[{op:'set',key:'heard-pipes',value:true}]});
 add('action','travel-continue',{name:'Continue',headline:'Keep moving',description:'Leave the sound behind.'});
 add('item','travel-wire',{name:'Wire',headline:'A loop of wire',description:'It may reach where your fingers cannot.',permability:2,image:'./assets/img/card-art/bandages.png'});
 add('consumable','travel-bandage',{name:'Bandage',headline:'A clean strip of cloth',description:'Bind the scrape on your hand.',subtype:'health',value:1,image:'./assets/img/card-art/bandages.png'});
 add('event','travel-arrived',{name:'Security',headline:'SECURITY. At last, a door with light beneath it.'});
 const auto={id:'travel-demo',type:'randomizer',name:'Travel to Security',x:40,y:80,drawCount:1,noneWeight:0,
  travel:{enabled:true,minSteps:2,maxSteps:4,eventCount:3,steps:[
   {id:'travel-stairs-slot',definitionId:'travel-stairs'},
   {id:'travel-steps-slot',definitionId:'travel-steps'},
   {id:'travel-pipes-slot',definitionId:'travel-pipes'}]},
  candidates:[{beatId:'travel-fork',weight:1,conditions:[]},{beatId:'travel-find',weight:1,conditions:[]},{beatId:'travel-heal',weight:1,conditions:[]}],connections:{next:'travel-end'}};
 chapter.nodes=[death,auto,
  {id:'travel-fork',type:'fork',name:'Service door',x:350,y:0,introEnabled:true,intro:{id:'noise-slot',definitionId:'travel-noise'},choices:[{id:'listen-slot',definitionId:'travel-listen'},{id:'continue-slot',definitionId:'travel-continue'}],connections:{'listen-slot':'travel-end','continue-slot':'travel-end'}},
  {id:'travel-find',type:'container',name:'A find',x:350,y:220,introEnabled:false,intro:{id:'unused-intro',definitionId:'travel-noise'},items:[{id:'wire-slot',definitionId:'travel-wire'}],connections:{next:'travel-end'}},
  {id:'travel-heal',type:'linear',name:'A little relief',x:350,y:440,cards:[{id:'heal-slot',definitionId:'travel-bandage'}],connections:{next:'travel-end'}},
  {id:'travel-end',type:'linear',name:'Arrival',x:700,y:80,cards:[{id:'arrival-slot',definitionId:'travel-arrived'}],connections:{next:null}}];
 chapter.startNode=auto.id;
 return project;
}
