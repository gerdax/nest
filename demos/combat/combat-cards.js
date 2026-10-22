import { ACTIONS, legalActions } from './combat-model.js';
import { decorateCard } from './engine/renderer.js?v=no-ending-card-1';

const fronts = Object.freeze({
  attack: { image:'./assets/img/claws.png', text:'Uderz, gdy przeciwnik łapie oddech.\n4 obrażenia.' },
  recover: { image:'./assets/img/hall_01.png', text:'Złap oddech.\nOdzyskaj 2 energii, nawet po trafieniu.' },
  dodge: { image:'./assets/img/escape.png', text:'Zejdź z linii ataku.\nUniknij obrażeń.' },
});

/** The same front payload as project Action cards; no separate mock card skin. */
export function actionFace(id) {
  const action = ACTIONS.find(action => action.id === id);
  if (!action) throw new RangeError(`Unknown action: ${id}`);
  return { ...action, ...fronts[id], heading:action.label, cardKind:'action', actionEnergyCost:action.cost };
}

export function choiceContent(state, serial) {
  const legal = legalActions(state, 0);
  return {
    id:`combat-round-${state.round}-${serial}`, interaction:'choice', allowClose:false,
    decisionOnly:true, autoBrowse:true, choiceFollowerRatio:.82,
    text:'', heading:'', image:'',
    actions:ACTIONS.map(({id}) => ({...actionFace(id),disabled:!legal.includes(id)})),
  };
}

export function tableFront(id) {
  const face = actionFace(id);
  const element = document.createElement('article');
  element.className = 'nest-card nest-action table-front';
  decorateCard(null, element, face.image, face.heading, face.text, false, face);
  return element;
}

/** Take a real engine reverse, clearing only its old pose in the fan. */
export function tableBack(template) {
  const element = template.cloneNode(true);
  const background = element.style.backgroundImage;
  element.removeAttribute('style');
  element.style.backgroundImage = background;
  element.classList.add('table-back');
  element.setAttribute('aria-hidden', 'true');
  return element;
}
