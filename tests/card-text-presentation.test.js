import test from 'node:test';
import assert from 'node:assert/strict';
import {cardFace} from '../project/presentation.js';
import {combatCard,combatChoices,enemyActionCard} from '../project/combat-presentation.js';
import {decorateCard,stageActionDeck,stageNextContent} from '../engine/renderer.js';

class Element {
 constructor(){this.style={};this.children=[];this.attributes=new Map();}
 setAttribute(key,value){this.attributes.set(key,String(value));}
 getAttribute(key){return this.attributes.get(key);}
 removeAttribute(key){this.attributes.delete(key);}
 append(...children){this.children.push(...children);}
 replaceChildren(...children){this.children=children;}
}
globalThis.document={createElement:()=>new Element()};
const variables=[{id:'health',type:'number',initial:10},{id:'energy',type:'number',initial:3}];
const values={health:7,energy:2};
const render=face=>{
 const element=new Element();
 decorateCard(null,element,face.image,face.heading,face.text,false,face);
 return element;
};

test('Caption and Description remain separate and visible across authored card kinds',()=>{
 for(const kind of ['event','discovery','caption','action','item','consumable','combatAction','effect']){
  const card={kind,subtype:'health',name:'Editor only',headline:'Visible [HP]',description:'Supporting [ENERGY]',text:'Obsolete'};
  const before=structuredClone(card),face=cardFace(card,variables,[],values),element=render(face);
  assert.equal(face.heading,'Visible 7',kind);
  assert.equal(face.text,'Supporting 2',kind);
  assert.equal(face.semanticText,true);
  assert.equal(element.getAttribute('data-semantic-text'),'true');
  const [heading,body]=element.children[0].children;
  assert.equal(heading.textContent,'Visible 7');assert.equal(heading.hidden,false);
  assert.equal(body.textContent,'Supporting 2');assert.equal(body.className,'nest-card-description');
  assert.deepEqual(card,before);
 }
});

test('an empty Caption never falls back to the editor Name or obsolete text',()=>{
 for(const kind of ['event','action','item','combatAction','effect']){
  const face=cardFace({kind,name:'Editor only',headline:'',description:'',text:'Obsolete',showName:true});
  assert.equal(face.heading,'');assert.equal(face.text,'');
  assert.equal(render(face).children[0].children[0].hidden,true);
 }
});

test('combat player and enemy captions resolve both fields with their preparation context',()=>{
 const action={kind:'combatAction',type:'attack',resolution:'direct',name:'Editor only',headline:'[DMG] damage',description:'Base [BASEDMG]; [HP] HP',attack:{source:'self',damage:{min:1,max:2}}};
 const player=combatChoices([{id:'attack',action}],'choices',values,variables,{preparationBonus:2}).actions[0];
 assert.equal(player.heading,'3–4 damage');assert.equal(player.label,player.heading);assert.equal(player.text,'Base 1–2; 7 HP');
 const disabled=combatChoices([{id:'attack',action,disabled:true}],'choices',values,variables,{preparationBonus:2}).actions[0];
 assert.equal(disabled.heading,'1–2 damage');
 const enemy=enemyActionCard(action,'enemy',{variables,values,preparationBonus:9});
 assert.equal(enemy.heading,'1–2 damage');assert.equal(enemy.text,'Base 1–2; 7 HP');
 assert.equal(enemy.semanticText,true);
 const effect=combatCard({kind:'effect',name:'Editor only',headline:'[HP] left',description:'[ENERGY] energy'},'effect',{variables,values});
 assert.equal(effect.heading,'7 left');assert.equal(effect.text,'2 energy');
});

test('retained choice faces refresh semantic captions and descriptions independently',()=>{
 const deck={mount:new Element(),decorate:(...args)=>decorateCard(null,...args)};
 let previous=null;
 for(const [heading,text] of [['First','Details'],['Changed','Details'],['Changed','New details'],['','New details']]){
  const content={actions:[{id:'story',cardKind:'discovery',semanticText:true,heading,text}]};
  const bundle=stageActionDeck(deck,content,null,previous);
  if(previous)assert.equal(bundle.cards[0],previous.cards[0]);
  assert.equal(bundle.cardTitles[0].textContent,heading);
  assert.equal(bundle.cardTitles[0].hidden,!heading);
  assert.equal(bundle.cards[0].children[0].children[1].textContent,text);
  previous=bundle;
 }
});

test('retained legacy story faces refresh when semantic presentation becomes active',()=>{
 const deck={mount:new Element(),decorate:(...args)=>decorateCard(null,...args)};
 const action={id:'story',cardKind:'event',heading:'Visible caption',text:'Details'};
 const first=stageActionDeck(deck,{actions:[action]});
 assert.equal(first.cardTitles[0].hidden,true);
 const next=stageActionDeck(deck,{actions:[{...action,semanticText:true}]},null,first);
 assert.equal(next.cards[0],first.cards[0]);
 assert.equal(next.cardTitles[0].textContent,'Visible caption');assert.equal(next.cardTitles[0].hidden,false);
});


test('next-card scene previews keep semantic Caption and Description',()=>{
 const deck={mount:new Element(),decorate:(...args)=>decorateCard(null,...args)};
 stageNextContent(deck,{cardKind:'event',semanticText:true,heading:'Next caption',text:'Next description'});
 const [heading,body]=deck.underlay.children[0].children;
 assert.equal(heading.textContent,'Next caption');assert.equal(heading.hidden,false);
 assert.equal(body.textContent,'Next description');assert.equal(body.className,'nest-card-description');
});


test('legacy raw cards keep their player-visible copy when mapped into semantic fields',()=>{
 for(const kind of ['event','discovery','caption','effect']){
  const face=cardFace({kind,name:'Editor only',text:'Original main copy'});
  assert.equal(face.heading,'Original main copy');assert.equal(face.text,'');
 }
 for(const kind of ['action','combatAction','item','consumable']){
  const face=cardFace({kind,showName:true,name:'Original visible name',text:'Original supporting copy'});
  assert.equal(face.heading,'Original visible name');assert.equal(face.text,'Original supporting copy');
 }
 const enemy=enemyActionCard({kind:'combatAction',name:'Editor only',text:'Enemy main copy'},'enemy');
 assert.equal(enemy.heading,'Enemy main copy');assert.equal(enemy.text,'');
});

test('combat source labels use the source Caption rather than its editor Name',()=>{
 const action={kind:'combatAction',type:'wait',resolution:'direct',name:'Action editor name',headline:'Wait',description:''};
 const source={kind:'item',name:'Source editor name',headline:'Oak club',description:''};
 const choice=combatChoices([{id:'source-action',action,source}],'choices').actions[0];
 assert.equal(choice.label,'Wait');assert.equal(choice.inventoryLabel,'USING · Oak club');
});
