/** Mechanics only: serializable defaults, validation, outputs and progression.
 * No animation timings, DOM, CSS, dice renderer or inventory UI belongs here.
 */
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const card = uid => ({ id: uid('card'), title: '', text: 'Describe what happens.', image: './assets/img/corridor_02.png' });
export const sequenceTypes = Object.freeze({
  linear: Object.freeze({
    label: 'Linear', inspector: 'story', previewsSuccessor: true,
    create(uid) { return { cards: [card(uid)], exits: ['next'] }; },
    actions({card}) { return [{id:'continue',label:'Continue',image:card.image,flipImage:!!card.flipImage}]; },
    nextCard(sequence, current) { return sequence.cards[sequence.cards.indexOf(current)+1] ?? null; },
    resolve({sequence,card}) { const next=this.nextCard(sequence,card); return next ? {card:next} : {exit:sequence.exits[0]}; },
    validate() {}
  }),
  forked: Object.freeze({
    label: 'Fork', inspector: 'decision',
    create(uid) {
      const choices=['Choice 1','Choice 2'].map(label=>{const id=uid('choice');return {id,label,image:'./assets/img/escape.png',target:`exit:${id}`};});
      return {decisionOnly:true,cards:[{...card(uid),text:'',image:'',choices}],exits:choices.map(c=>c.id)};
    },
    actions({card}) { return card.choices.map(choice=>({...choice})); },
    nextCard() { return null; },
    resolve({sequence,card}, action) {
      const choice=card.choices.find(c=>c.id===action.id);
      if (!choice) return null;
      return choice.target.startsWith('exit:') ? {exit:choice.target.slice(5)} : {card:sequence.cards.find(c=>c.id===choice.target.slice(5))};
    },
    validate(seq,{cards,cardIds,exits,add,hasCycle}) {
      if(seq.decisionOnly && (seq.exits?.length!==cards[0]?.choices?.length || seq.exits?.some(id=>!cards[0]?.choices?.some(c=>c.id===id)))) add(`Decision ${seq.id} needs one output per choice.`);
      if(seq.decisionOnly && cards.length!==1) add(`Decision ${seq.id} needs exactly one choice set.`);
      for(const card of cards.filter(object)) {
        if(!Array.isArray(card.choices)||![2,3].includes(card.choices.length)){add(`Forked card ${card.id} needs two or three choices.`);continue;}
        const ids=new Set();
        for(const choice of card.choices){
          if(!object(choice)||!nonempty(choice.id)||!nonempty(choice.label)||typeof choice.image!=='string'){add(`Card ${card.id} has an invalid choice.`);continue;}
          if(ids.has(choice.id))add(`Card ${card.id} has duplicate choice ID ${choice.id}.`);ids.add(choice.id);
          if(seq.decisionOnly&&choice.target!==`exit:${choice.id}`)add(`Choice ${choice.id} must use its own output.`);
          const target=choice.target;
          if(typeof target!=='string'||!(target.startsWith('card:')&&cardIds.has(target.slice(5))||target.startsWith('exit:')&&exits.has(target.slice(5))))add(`Choice ${choice.id} has an invalid target.`);
        }
      }
      if(hasCycle(cardIds,id=>(Array.isArray(cards.find(c=>c?.id===id)?.choices)?cards.find(c=>c?.id===id).choices:[]).filter(c=>typeof c?.target==='string'&&c.target.startsWith('card:')).map(c=>c.target.slice(5))))add(`Sequence ${seq.id} has a card cycle.`);
    }
  }),
  container: Object.freeze({
    label: 'Container', inspector: 'container', resolvesItems: true,
    create(uid) {return {cards:[card(uid)],exits:['next'],items:[{id:uid('item'),label:'Supplies',image:'./assets/img/pack.png'}]};},
    actions({sequence}, remaining) {return (remaining ?? sequence.items).map(item=>({...item}));},
    nextCard() {return null;}, resolve() {return null;},
    validate(seq,{cards,add}) {
      if(cards.length!==1)add(`Container ${seq.id} needs exactly one intro card.`);
      if(!Array.isArray(seq.items)||!seq.items.length)add(`Container ${seq.id} needs at least one item.`);
      const ids=new Set();
      for(const item of Array.isArray(seq.items)?seq.items:[]){
        if(!object(item)||!nonempty(item.id)||!nonempty(item.label)||typeof item.image!=='string'){add(`Container ${seq.id} has an invalid item.`);continue;}
        if(ids.has(item.id))add(`Container ${seq.id} has duplicate item ID ${item.id}.`);ids.add(item.id);
      }
    }
  })
});
export function sequenceType(sequence) {return Object.hasOwn(sequenceTypes, sequence?.type) ? sequenceTypes[sequence.type] : undefined;}
export function sequenceOutputs(sequence) {return sequence == null ? ['next'] : Array.isArray(sequence.exits) ? sequence.exits : [];}
export function outputLabel(sequence,id) {return sequence?.decisionOnly ? sequence.cards[0]?.choices?.find(c=>c.id===id)?.label || id : id;}
export function createSequence(type,uid,name) {
  const definition=sequenceType({type});if(!definition)throw new TypeError(`Unknown sequence type: ${type}`);
  return {id:uid('sequence'),name,type,...definition.create(uid)};
}
