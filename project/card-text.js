/** Player-facing copy. Name remains an editor label; legacy input is read without mutation. */
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const kinds = new Set(['event','narrative','discovery','caption','enemy','effect','action','combatAction','item','consumable','health','energy']);
export function cardText(card, {enemyAction = false} = {}) {
  card = object(card) ? card : {};
  const kind = card.kind ?? card.cardKind;
  const story = enemyAction || ['event','narrative','discovery','caption','enemy','effect'].includes(kind);
  const name = card.name ?? card.label ?? card.title ?? '';
  const headline = story ? card.text ?? '' : ['action','combatAction'].includes(kind) || card.showName === true ? name : '';
  return {
    headline: own(card, 'headline') ? card.headline : headline,
    description: own(card, 'description') ? card.description : story ? '' : card.text ?? ''
  };
}
export function normalizeCardText(card, options = {}) {
  if (!object(card)) return card;
  Object.assign(card, cardText(card, options));
  delete card.text;
  return card;
}
/** Visit schema-owned cards only, never variable maps, rules, or placement overrides. */
export function normalizeProjectCardText(project) {
  const visited = new Set();
  const card = (value, options = {}, fallbackKind) => {
    if (!object(value) || visited.has(value)) return;
    const kind = value.kind ?? value.cardKind ?? fallbackKind;
    if (!kinds.has(kind)) return;
    visited.add(value);
    // Old sequences have title/label instead of kind. Keep their original schema.
    if (!value.kind && !value.cardKind) {
      const copy = {...value, kind};
      const text = cardText(copy, options);
      Object.assign(value, text);
      delete value.text;
    } else normalizeCardText(value, options);
    for (const choice of list(value.choices)) card(choice, {}, 'action');
    if (kind === 'enemy') {
      for (const child of [...list(value.actions), ...list(value.preparedActions), ...list(value.attacks), ...list(value.legacyPreparedActionSources)]) card(child, {enemyAction:true}, 'combatAction');
      for (const child of [...list(value.intro), value.hit, ...list(value.reactions).map(r => r?.card), ...list(value.death), ...Object.values(object(value.preparationCards) ? value.preparationCards : {})]) card(child);
    }
    if (object(value.combat)) for (const action of list(value.combat.actions)) card(action);
    for (const child of [value.blockReveal, value.reveal]) card(child);
  };
  const sequence = value => {
    if (!object(value)) return;
    for (const child of list(value.cards)) card(child, {}, 'event');
    for (const child of list(value.items)) card(child, {}, 'item');
  };
  const chapter = value => {
    if (!object(value)) return;
    for (const node of list(value.nodes)) {
      if (!object(node)) continue;
      for (const child of [...list(node.cards), ...list(node.choices), ...list(node.items), node.intro, ...list(node.travel?.steps)]) {
        // Resolved compiled cards carry authored name/image; ordinary reference
        // placements can contain unrelated legacy metadata and stay untouched.
        if (!object(child) || own(child,'definitionId') && !(typeof child.name === 'string' && typeof child.image === 'string')) continue;
        card(child);
      }
      sequence(node.sequence);
      for (const seq of list(node.sequences)) sequence(seq);
    }
    for (const seq of list(value.sequences)) sequence(seq);
  };
  for (const definition of list(project?.library)) card(definition);
  for (const value of list(project?.chapters)) chapter(value);
  chapter(project?.chapter);
  chapter(project);
  return project;
}

/** Accept raw legacy cards, while rejecting every invalid present canonical field. */
export const validCardText = card => object(card) && ['headline','description'].every(key => !own(card,key) || typeof card[key] === 'string') && (own(card,'headline') || own(card,'description') ? true : typeof card.text === 'string');
