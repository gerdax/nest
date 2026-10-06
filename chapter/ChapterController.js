import { cloneChapter, selectPool, validateChapter } from './model.js';

/** Adapts serializable chapter data to CardDeck's commit/collect choreography. */
export class ChapterController {
  constructor(deck, chapter, { startNode, onChange = () => {}, rng = Math.random, lidMotion = false } = {}) {
    this.deck = deck;
    this.onChange = onChange;
    this.rng = rng;
    this.lidMotion = lidMotion;
    this.destroyed = false;
    this.listeners = {
      commit: event => this.commit(event.detail),
      collect: event => this.collect(event.detail),
      transitioncomplete: event => this.transitionComplete(event.detail)
    };
    // Validate before subscribing, so invalid imports leave no listeners behind.
    this.load(chapter, startNode);
    for (const [name, listener] of Object.entries(this.listeners)) deck.addEventListener(name, listener);
    this.begin(startNode ?? this.chapter.startNode);
  }

  load(chapter, startNode) {
    const errors = validateChapter(chapter);
    if (errors.length) throw new TypeError(errors.map(error => error.message).join('\n'));
    if (startNode !== undefined && !chapter.nodes.some(node => node.id === startNode)) throw new TypeError('Unknown start node');
    this.chapter = cloneChapter(chapter);
    this.nodes = new Map(this.chapter.nodes.map(node => [node.id, node]));
    this.sequences = new Map(this.chapter.sequences.map(sequence => [sequence.id, sequence]));
  }

  get state() {
    return { activeNodeId: this.node?.id ?? null, sequenceId: this.sequence?.id ?? null,
      cardId: this.card?.id ?? null, collectedItems: this.collectedItems.map(item => ({ ...item })), completed: this.completed };
  }

  notify() { if (!this.destroyed) this.onChange(this.state); }

  restart(chapter = this.chapter, startNode) {
    if (this.destroyed) return;
    this.load(chapter, startNode);
    this.deck.reset();
    this.begin(startNode ?? this.chapter.startNode);
  }

  begin(nodeId) {
    this.collectedItems = [];
    this.remainingItems = new Map();
    this.completed = false;
    this.nextPresentation = null;
    this.inContainer = false;
    this.pendingItem = null;
    this.enterNode(nodeId);
  }

  enterNode(nodeId) {
    this.node = this.nodes.get(nodeId);
    this.queue = this.node.type === 'random' ? selectPool(this.node.pool, this.node.count, this.rng) : [this.node.sequenceId];
    this.enterSequence(this.queue.shift());
  }

  enterSequence(id) {
    this.sequence = this.sequences.get(id);
    this.inContainer = false;
    this.pendingItem = null;
    this.card = this.sequence.cards[0];
    this.showCard();
  }

  remaining() {
    if (!this.remainingItems.has(this.sequence.id)) this.remainingItems.set(this.sequence.id, this.sequence.items.map(item => ({ ...item })));
    return this.remainingItems.get(this.sequence.id);
  }

  cardContent() {
    const card = this.card;
    let actions;
    if (this.sequence.type === 'forked') actions = card.choices.map(choice => ({ ...choice }));
    else if (this.sequence.type === 'container') actions = [
      { id: 'open', label: 'Open', image: card.image, ...(this.lidMotion ? { transition: 'lid' } : {}), disabled: this.remaining().length === 0 },
      { id: 'continue', label: 'Leave it', image: card.image }
    ];
    else actions = [{ id: 'continue', label: 'Continue', image: card.image }];
    return { id: `${this.node.id}:${this.sequence.id}:${card.id}`, title: card.title, text: card.text,
      image: card.image, interaction: 'choice', allowClose: false, actions };
  }

  itemContent() {
    return { id: `${this.node.id}:${this.sequence.id}:items`, title: this.card.title, text: this.card.text,
      image: this.card.image, interaction: 'container', allowClose: true, lid: this.lidMotion,
      actions: this.remaining().map(item => ({ ...item })) };
  }

  configureContainer() {
    if (this.sequence.type !== 'container' || this.inContainer || this.completed) return;
    if (this.deck.content.id !== this.cardContent().id) return;
    if (this.remaining().length) this.deck.setActionPreview('open', this.itemContent(), { presentation: 'open' });
  }

  showCard() {
    this.deck.replaceContent(this.cardContent(), { presentation: this.nextPresentation || 'closed' });
    this.nextPresentation = null;
    this.configureContainer();
    this.notify();
  }

  commit(detail) {
    if (this.destroyed || this.completed || this.inContainer || detail.contentId !== this.deck.content.id) return;
    const action = detail.action;
    if (!action || !this.deck.content.actions.some(candidate => candidate.id === action.id && !candidate.disabled)) return;
    if (this.sequence.type === 'container') {
      if (action.id === 'open' && this.remaining().length) {
        const returnContent = this.cardContent();
        this.inContainer = true;
        this.deck.replaceContent(this.itemContent(), { presentation: 'open' });
        // replaceContent queues during commit; return content is installed after its transition completes.
        this.containerReturn = returnContent;
        this.notify();
      } else if (action.id === 'continue') this.exit(this.sequence.exits[0]);
    } else if (this.sequence.type === 'forked') {
      const choice = this.card.choices.find(candidate => candidate.id === action.id);
      if (!choice) return;
      if (choice.target.startsWith('exit:')) this.exit(choice.target.slice(5));
      else { this.card = this.sequence.cards.find(card => card.id === choice.target.slice(5)); this.showCard(); }
    } else {
      const index = this.sequence.cards.indexOf(this.card);
      if (index + 1 < this.sequence.cards.length) { this.card = this.sequence.cards[index + 1]; this.showCard(); }
      else this.exit(this.sequence.exits[0]);
    }
  }

  collect(detail) {
    if (this.destroyed || this.completed || !this.inContainer || this.pendingItem || detail.contentId !== this.deck.content.id) return;
    const item = this.remaining().find(item => item.id === detail.action?.id);
    if (item) this.pendingItem = { ...item, sequenceId: this.sequence.id };
  }

  transitionComplete(detail) {
    if (this.destroyed || this.completed) return;
    if (detail.transition === 'collect' && this.inContainer && this.pendingItem) {
      const item = this.pendingItem;
      this.pendingItem = null;
      this.remainingItems.set(this.sequence.id, this.remaining().filter(candidate => candidate.id !== item.id));
      this.collectedItems.push(item);
      if (!this.remaining().length) {
        // Install the next content now; the engine's identity guard then suppresses automatic close.
        this.inContainer = false;
        this.nextPresentation = this.lidMotion ? 'lid' : null;
        this.exit(this.sequence.exits[0]);
      } else {
        this.deck.setReturnContent(this.cardContent(), { selectedId: 'open' });
        this.notify();
      }
    } else if (detail.transition === 'commit') {
      if (this.inContainer) this.deck.setReturnContent(this.containerReturn, { selectedId: 'open' });
      else this.configureContainer();
    } else if (detail.transition === 'close' && this.inContainer) {
      this.inContainer = false;
      this.configureContainer();
      this.notify();
    }
  }

  exit(name) {
    if (this.queue.length) { this.enterSequence(this.queue.shift()); return; }
    const target = this.node.connections[this.node.type === 'random' ? 'next' : name];
    if (target !== null && target !== undefined) { this.enterNode(target); return; }
    this.completed = true;
    this.inContainer = false;
    this.deck.replaceContent({ id: 'chapter-complete', title: 'Chapter complete', text: 'Your expedition is complete.',
      image: this.card.image, interaction: 'choice', allowClose: false,
      actions: [{ id: 'complete', label: 'Chapter complete', disabled: true }] }, { presentation: this.nextPresentation || 'closed' });
    this.nextPresentation = null;
    this.notify();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [name, listener] of Object.entries(this.listeners)) this.deck.removeEventListener(name, listener);
  }
}
