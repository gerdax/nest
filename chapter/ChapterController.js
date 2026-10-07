import { cloneChapter, selectPool, validateChapter } from './model.js';

/** Adapts serializable chapter data to CardDeck's commit/collect choreography. */
export class ChapterController {
  constructor(deck, chapter, { startNode, onChange = () => {}, rng = Math.random } = {}) {
    this.deck = deck;
    this.onChange = onChange;
    this.rng = rng;
    this.destroyed = false;
    this.listeners = {
      commit: event => this.commit(event.detail),
      collect: event => this.resolveItem(event.detail, 'collect'),
      discard: event => this.resolveItem(event.detail, 'discard'),
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
    this.stagedDestination = null;
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
    this.pendingItem = null;
    this.card = this.sequence.cards[0];
    this.showCard();
  }

  containerKey(destination = this) { return JSON.stringify([destination.node.id, destination.sequence.id]); }

  remaining() {
    const key = this.containerKey();
    if (!this.remainingItems.has(key)) this.remainingItems.set(key, this.sequence.items.map(item => ({ ...item })));
    return this.remainingItems.get(key);
  }

  cardContent(destination = this) {
    const { card, sequence, node } = destination;
    let actions;
    if (sequence.type === 'forked') actions = card.choices.map(choice => ({ ...choice }));
    else if (sequence.type === 'container') actions = (this.remainingItems.get(this.containerKey(destination)) ?? sequence.items).map(item => ({ ...item }));
    else actions = [{ id: 'continue', label: 'Continue', image: card.image }];
    return { id: `${node.id}:${sequence.id}:${card.id}`, title: card.title, text: card.text,
      image: card.image, interaction: sequence.type === 'container' ? 'container' : 'choice', allowClose: false, actions };
  }

  endingContent() {
    return { id: 'chapter-complete', title: 'Chapter complete', text: 'Your expedition is complete.',
      image: this.card.image, interaction: 'choice', allowClose: false,
      actions: [{ id: 'complete', label: 'Chapter complete', disabled: true }] };
  }

  showCard() {
    this.deck.replaceContent(this.cardContent());
    this.notify();
  }

  // Resolve the next graph location without changing the currently presented event.
  destination(name) {
    let node = this.node;
    let queue = [...this.queue];
    if (!queue.length) {
      const target = node.connections[node.type === 'random' ? 'next' : name];
      if (target === null || target === undefined) return { completed: true };
      node = this.nodes.get(target);
      queue = node.type === 'random' ? selectPool(node.pool, node.count, this.rng) : [node.sequenceId];
    }
    const sequence = this.sequences.get(queue.shift());
    return { node, sequence, card: sequence.cards[0], queue, completed: false };
  }

  adopt(destination) {
    this.completed = destination.completed;
    if (!this.completed) Object.assign(this, destination);
    this.notify();
  }

  commit(detail) {
    if (this.destroyed || this.completed || this.sequence.type === 'container' || detail.contentId !== this.deck.content.id) return;
    const action = detail.action;
    if (!action || !this.deck.content.actions.some(candidate => candidate.id === action.id && !candidate.disabled)) return;
    if (this.sequence.type === 'forked') {
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

  resolveItem(detail, transition) {
    if (this.destroyed || this.completed || this.sequence.type !== 'container' || this.pendingItem || detail.contentId !== this.deck.content.id) return;
    const item = this.remaining().find(item => item.id === detail.action?.id);
    if (!item) return;
    this.pendingItem = { item: { ...item, sequenceId: this.sequence.id }, containerKey: this.containerKey(), transition, contentId: detail.contentId };
    if (detail.final) {
      this.stagedDestination = this.destination(this.sequence.exits[0]);
      this.deck.replaceContent(this.stagedDestination.completed ? this.endingContent() : this.cardContent(this.stagedDestination));
    }
  }

  transitionComplete(detail) {
    if (this.destroyed) return;
    if (this.pendingItem && detail.transition === this.pendingItem.transition && detail.contentId === this.pendingItem.contentId) {
      const { item, transition, containerKey } = this.pendingItem;
      this.pendingItem = null;
      this.remainingItems.set(containerKey, this.remaining().filter(candidate => candidate.id !== item.id));
      if (transition === 'collect') this.collectedItems.push(item);
      this.notify();
    } else if (detail.transition === 'commit' && this.stagedDestination) {
      const destination = this.stagedDestination;
      this.stagedDestination = null;
      this.adopt(destination);
    }
  }

  exit(name) {
    const destination = this.destination(name);
    const content = destination.completed ? this.endingContent() : this.cardContent(destination);
    this.adopt(destination);
    this.deck.replaceContent(content);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [name, listener] of Object.entries(this.listeners)) this.deck.removeEventListener(name, listener);
  }
}
