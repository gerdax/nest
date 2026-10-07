const art = './assets/img/';
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

export function createChestContainer(remainingIds) {
  const remaining = new Set(remainingIds);
  return {
    id: 'chest-items', interaction: 'container', allowClose: false, ...chestCover,
    actions: chestItems.filter(item => remaining.has(item.id)).map(item => ({ ...item })),
  };
}

// Compatibility export: the chest now starts directly with its container cover.
export const createChestEntry = createChestContainer;

// Session-only fixture logic. The deck owns motion; this host owns narrative meaning.
export class ScenarioController {
  constructor(deck, { fixture = '2', onChange = () => {} } = {}) {
    this.deck = deck;
    this.onChange = onChange;
    this.destroyed = false;
    this.listeners = {
      commit: event => this.handleCommit(event.detail),
      collect: event => this.handleResolution(event.detail, 'collect'),
      discard: event => this.handleResolution(event.detail, 'discard'),
      transitioncomplete: event => this.handleTransitionComplete(event.detail),
    };
    for (const [type, listener] of Object.entries(this.listeners)) deck.addEventListener(type, listener);
    this.reset(fixture);
  }

  get content() {
    if (this.mode === 'container') return createChestContainer(this.remainingIds);
    return createStudyContent(this.studyIndex, this.actionCount);
  }

  notify(reason, detail = {}) {
    if (this.destroyed) return;
    this.onChange({ reason, detail, mode: this.mode, fixture: this.fixture,
      remainingIds: [...this.remainingIds], collectedItems: this.collectedItems.map(item => ({ ...item })), content: this.content });
  }

  reset(fixture = this.fixture) {
    if (this.destroyed) return;
    this.fixture = String(fixture);
    this.studyIndex = 0;
    this.actionCount = this.fixture === 'chest' ? 2 : Number(this.fixture);
    this.remainingIds = new Set(CHEST_ITEM_IDS);
    this.collectedItems = [];
    this.pendingItem = null;
    this.stagedDestination = false;
    this.mode = this.fixture === 'chest' ? 'container' : 'choice';
    this.deck.reset();
    this.deck.replaceContent(this.content);
    this.notify('reset');
  }

  handleCommit(detail) {
    if (this.destroyed || this.mode === 'container' || detail.contentId !== this.content.id || detail.action?.disabled) return;
    if (!this.content.actions.some(action => action.id === detail.action?.id)) return;
    this.studyIndex += 1;
    this.actionCount = this.actionCount === 4 ? 2 : this.actionCount + 1;
    if (this.fixture !== 'chest') this.fixture = String(this.actionCount);
    this.deck.replaceContent(this.content);
    this.notify('advance', detail);
  }

  handleResolution(detail, transition) {
    if (this.destroyed || this.mode !== 'container' || this.pendingItem || detail.contentId !== this.content.id) return;
    const item = chestItems.find(item => item.id === detail.action?.id && this.remainingIds.has(item.id));
    if (!item) return;
    this.pendingItem = { item: { ...item, sequenceId: 'chest' }, transition, contentId: detail.contentId };
    if (detail.final) {
      this.stagedDestination = true;
      this.deck.replaceContent(createStudyContent(this.studyIndex, this.actionCount));
    }
  }

  handleTransitionComplete(detail) {
    if (this.destroyed) return;
    if (this.pendingItem && detail.transition === this.pendingItem.transition && detail.contentId === this.pendingItem.contentId) {
      const { item, transition } = this.pendingItem;
      this.pendingItem = null;
      this.remainingIds.delete(item.id);
      if (transition === 'collect') this.collectedItems.push(item);
      this.notify(transition, { ...detail, action: { ...item } });
    } else if (detail.transition === 'commit' && this.stagedDestination) {
      this.stagedDestination = false;
      this.mode = 'choice';
      this.notify('advance', detail);
    } else this.notify('transitioncomplete', detail);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [type, listener] of Object.entries(this.listeners)) this.deck.removeEventListener(type, listener);
  }
}
