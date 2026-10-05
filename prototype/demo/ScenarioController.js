const art = '../pre_prototype/img/';
const studies = [
  { title: 'The corridor', text: 'A passage in low light.', image: 'corridor_02.png' },
  { title: 'The surface', text: 'A fragment of the outside.', image: 'city.png' },
  { title: 'The chamber', text: 'A quiet space, held open.', image: 'hall_01.png' },
];
const studyActions = [
  { id: 'observe', label: 'Observe', image: 'goggles_01.png' },
  { id: 'explore', label: 'Explore', image: 'flashlight.png' },
  { id: 'collect', label: 'Collect', image: 'pack.png' },
  { id: 'leave', label: 'Leave the chamber and return to the passage', image: 'escape.png' },
];
const chestCover = {
  title: 'The chest', text: 'A small chest waits in the passage.', image: art + 'box.png',
};
const chestItems = [
  { id: 'goggles', label: 'Goggles', image: art + 'goggles_01.png' },
  { id: 'flashlight', label: 'Flashlight', image: art + 'flashlight.png' },
  { id: 'pack', label: 'Pack', image: art + 'pack.png' },
];
export const CHEST_ITEM_IDS = Object.freeze(chestItems.map(item => item.id));

export function createStudyContent(index, count) {
  const study = studies[index % studies.length];
  return {
    id: `study-${index}-${count}`, interaction: 'choice', ...study,
    image: art + study.image,
    actions: studyActions.slice(0, count).map(action => ({ ...action, image: art + action.image })),
  };
}

export function createChestEntry(remainingIds) {
  const available = new Set(remainingIds).size > 0;
  return {
    id: 'chest-entry', interaction: 'choice', ...chestCover,
    actions: [
      { id: 'open', label: available ? 'Open' : '', accessibleLabel: 'Open chest',
        image: art + 'box.png', disabled: !available, faceDown: !available },
      { id: 'leave', label: 'Go on', image: art + 'escape.png' },
    ],
  };
}

export function createChestContainer(remainingIds) {
  const remaining = new Set(remainingIds);
  return {
    id: 'chest-items', interaction: 'container', ...chestCover,
    actions: chestItems.filter(item => remaining.has(item.id)).map(item => ({ ...item })),
  };
}

// Session-only fixture logic. The deck owns motion; this host owns narrative meaning.
export class ScenarioController {
  constructor(deck, { fixture = '2', onChange = () => {} } = {}) {
    this.deck = deck;
    this.onChange = onChange;
    this.listeners = {
      commit: event => this.handleCommit(event.detail),
      collect: event => this.handleCollect(event.detail),
      transitioncomplete: event => this.handleTransitionComplete(event.detail),
    };
    for (const [type, listener] of Object.entries(this.listeners)) deck.addEventListener(type, listener);
    this.reset(fixture);
  }

  get content() {
    if (this.mode === 'entry') return createChestEntry(this.remainingIds);
    if (this.mode === 'container') return createChestContainer(this.remainingIds);
    return createStudyContent(this.studyIndex, this.actionCount);
  }

  notify(reason, detail = {}) {
    this.onChange({ reason, detail, mode: this.mode, fixture: this.fixture,
      remainingIds: [...this.remainingIds], content: this.content });
  }

  reset(fixture = this.fixture) {
    this.fixture = String(fixture);
    this.studyIndex = 0;
    this.actionCount = this.fixture === 'chest' ? 2 : Number(this.fixture);
    this.remainingIds = new Set(CHEST_ITEM_IDS);
    this.mode = this.fixture === 'chest' ? 'entry' : 'choice';
    this.deck.reset();
    this.deck.replaceContent(this.content);
    this.notify('reset');
  }

  handleCommit(detail) {
    if (detail.contentId !== this.content.id || detail.action?.disabled) return;
    if (this.mode === 'entry' && detail.action?.id === 'open') {
      if (!this.remainingIds.size) return;
      this.mode = 'container';
      this.notify('open', detail);
      this.deck.replaceContent(this.content, { presentation: 'open' });
      return;
    }
    if (this.mode === 'container') return;
    if (this.mode === 'entry') {
      if (detail.action?.id !== 'leave') return;
      this.mode = 'choice';
      this.studyIndex = 0;
    } else {
      this.studyIndex += 1;
      this.actionCount = this.actionCount === 4 ? 2 : this.actionCount + 1;
      if (this.fixture !== 'chest') this.fixture = String(this.actionCount);
    }
    this.notify('advance', detail);
    this.deck.replaceContent(this.content);
  }

  handleCollect(detail) {
    if (this.mode !== 'container' || detail.contentId !== 'chest-items') return;
    if (!this.remainingIds.delete(detail.action?.id)) return;
    // Remember acceptance immediately, before the removal animation completes.
    this.notify('collect', detail);
  }

  handleTransitionComplete(detail) {
    if (detail.transition === 'close' && this.mode === 'container') {
      this.mode = 'entry';
      this.deck.replaceContent(this.content);
    }
    this.notify('transitioncomplete', detail);
  }

  destroy() {
    for (const [type, listener] of Object.entries(this.listeners)) this.deck.removeEventListener(type, listener);
  }
}
