import { initialValues, conditionsMet, applyEffects } from './state.js';
import { nodeType, connectionOutput } from './nodeTypes.js';
import { sequenceType } from './sequenceTypes.js';
import { defaultPresentation } from './presentation.js';
import { cloneChapter, validateChapter } from './model.js';

/** Adapts serializable chapter data to CardDeck's commit/collect choreography. */
export class ChapterController {
  constructor(deck, chapter, { startNode, onChange = () => {}, rng = Math.random, presentation = defaultPresentation } = {}) {
    this.deck = deck;
    this.onChange = onChange;
    this.rng = rng;
    this.presentation = presentation;
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
      cardId: this.card?.id ?? null, variables: { ...this.variables }, collectedItems: this.collectedItems.map(item => ({ ...item })), completed: this.completed };
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
    this.variables = initialValues(this.chapter.variables);
    this.acceptedContent = new Set();
    this.remainingItems = new Map();
    this.completed = false;
    this.stagedDestination = null;
    this.pendingItem = null;
    this.enterNode(nodeId);
  }

  enterNode(nodeId) {
    this.node = this.nodes.get(nodeId);
    this.queue = nodeType(this.node).select(this.node, this.rng);
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

  cardContent(destination = this, { preview = true, values = this.variables, inventory = this.collectedItems } = {}) {
    const { card, sequence, node } = destination;
    const definition = sequenceType(sequence);
    let actions = definition.actions(destination, this.remainingItems.get(this.containerKey(destination)));
    if (sequence.type === 'forked') actions = actions.flatMap(action => conditionsMet(action.conditions, values, inventory) ? [action] : action.unavailable === 'hidden' ? [] : [{...action, disabled: true, accessibleLabel: `${action.label} — requirements not met`}]);
    if (!actions.length && sequence.type === 'forked') actions = [{id:'unavailable', label:'No available choices', disabled:true}];
    let successor = definition.nextCard(sequence, card);
    let successorDestination = successor ? { node, sequence, card: successor } : null;
    if (preview && definition.previewsSuccessor && !successor && !destination.queue?.length) {
      const target = this.nodes.get(node.connections[connectionOutput(node, sequence.exits[0])]);
      if (target?.type === 'static') {
        const nextSequence = this.sequences.get(target.sequenceId);
        successorDestination = { node: target, sequence: nextSequence, card: nextSequence.cards[0] };
      }
    }
    const nextDeckPreview = preview && successorDestination ? {
      content: this.cardContent(successorDestination, { preview: false, values: sequence.type === 'linear' ? applyEffects(values, card.effects) : values, inventory }),
      presentation: this.presentation.entry(successorDestination.sequence)
    } : null;
    const noSuccessor = sequence.type !== 'forked' && !successor && !(destination.queue ?? this.queue)?.length && !node.connections[connectionOutput(node, sequence.exits[0])];
    return { backImage: this.chapter.backImage || '', noSuccessor, nextDeckPreview, nextCardPreview: successor ? { title: successor.title, text: successor.text, image: successor.image, flipImage: !!successor.flipImage } : null, id: `${node.id}:${sequence.id}:${card.id}`, title: card.title, text: card.text,
      image: card.image, flipImage: !!card.flipImage, ...this.presentation.content(sequence), actions };
  }

  showCard({ transition = 'flip' } = {}) {
    this.deck.replaceContent(this.cardContent(), { presentation: this.presentation.entry(this.sequence), transition });
    this.notify();
  }

  // Resolve the next graph location without changing the currently presented event.
  destination(name) {
    let node = this.node;
    let queue = [...this.queue];
    if (!queue.length) {
      const target = node.connections[connectionOutput(node, name)];
      if (target === null || target === undefined) return { completed: true };
      node = this.nodes.get(target);
      queue = nodeType(node).select(node, this.rng);
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
    if (this.destroyed || this.completed || sequenceType(this.sequence).resolvesItems || detail.contentId !== this.deck.content.id) return;
    const action = detail.action;
    if (!action || !this.deck.content.actions.some(candidate => candidate.id === action.id && !candidate.disabled)) return;
    if (this.acceptedContent.has(detail.contentId)) return;
    const source = this.sequence.type === 'forked' ? this.card.choices.find(c=>c.id===action.id) : this.card;
    if (!source || !conditionsMet(source.conditions, this.variables, this.collectedItems)) return;
    const nextValues = applyEffects(this.variables, source.effects);
    this.acceptedContent.add(detail.contentId);
    this.variables = nextValues;
    const result = sequenceType(this.sequence).resolve(this, action);
    if (result?.card) { this.card = result.card; this.showCard({ transition: this.presentation.within(this.sequence) }); }
    else if (result?.exit) this.exit(result.exit);
  }

  resolveItem(detail, transition) {
    if (this.destroyed || this.completed || !sequenceType(this.sequence).resolvesItems || this.pendingItem || detail.contentId !== this.deck.content.id) return;
    const item = this.remaining().find(item => item.id === detail.action?.id);
    if (!item) return;
    this.pendingItem = { item: { ...item, sequenceId: this.sequence.id }, containerKey: this.containerKey(), transition, contentId: detail.contentId };
    if (detail.final) {
      this.stagedDestination = this.destination(this.sequence.exits[0]);
      if (this.stagedDestination.completed) { this.deck.endContent(); return; }
      this.deck.replaceContent(this.cardContent(this.stagedDestination, { values: transition === 'collect' ? applyEffects(this.variables, item.effects) : this.variables, inventory: transition === 'collect' ? [...this.collectedItems,item] : this.collectedItems }), { presentation: this.stagedDestination.completed ? 'closed' : this.presentation.entry(this.stagedDestination.sequence), transition: this.presentation.exit(this.sequence) });
    }
  }

  transitionComplete(detail) {
    if (this.destroyed) return;
    if (this.pendingItem && detail.transition === this.pendingItem.transition && detail.contentId === this.pendingItem.contentId) {
      const { item, transition, containerKey } = this.pendingItem;
      this.pendingItem = null;
      this.remainingItems.set(containerKey, this.remaining().filter(candidate => candidate.id !== item.id));
      if (transition === 'collect') { this.variables = applyEffects(this.variables, item.effects); this.collectedItems.push(item); }
      this.notify();
    } else if (detail.transition === 'commit' && this.stagedDestination) {
      const destination = this.stagedDestination;
      this.stagedDestination = null;
      this.adopt(destination);
    }
  }

  exit(name) {
    const destination = this.destination(name);
    if (destination.completed) { this.adopt(destination); this.deck.endContent(); return; }
    const content = this.cardContent(destination);
    const transition = this.presentation.exit(this.sequence);
    this.adopt(destination);
    this.deck.replaceContent(content, { presentation: destination.completed ? 'closed' : this.presentation.entry(destination.sequence), transition });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const [name, listener] of Object.entries(this.listeners)) this.deck.removeEventListener(name, listener);
  }
}
