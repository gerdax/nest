import { nextChapter } from '../project/chapter-navigation.js';
import { CardDeck } from '../engine/CardDeck.js';
import { DiceService } from '../dice/DiceService.js';
import { compileChapter, validateProject } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';
import { chapterEntryState } from '../project/chapter-entry.js';
import { InventoryCardPreview } from './InventoryCardPreview.js';
import { InventoryView } from './InventoryView.js';
import { InventorySurface } from './InventorySurface.js';
import { CardBackdrop } from './CardBackdrop.js';
import { applyCardStyles } from '../project/card-styles.js';
import { acquireDock } from '../editor/dockOwnership.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { previewCardTarget } from './preview-card-target.js';
import { DiceLayer } from './DiceLayer.js';
import { focusedTriggerItem } from './TriggerItemMini.js';
import { ActionContextPanel } from './ActionContextPanel.js';

/** Playback UI owns dice/inventory presentation, never chapter resolution rules. */
export class ProjectPreview {
  constructor(root, { onChange = () => {}, onStop = () => {}, onGoToCard, inventoryDock = false, inventoryHost = null, deckSettings = {}, presentationPolicy = {} } = {}) {
    this.root = root;
    this.destroyed = false;
    this.generation = 0;
    this.diceGeneration = 0;
    this.onChange = onChange;
    this.onStop = onStop;
    this.onGoToCard = typeof onGoToCard === 'function' ? onGoToCard : null;
    this.deckSettings = { ...deckSettings };
    this.presentationPolicy = { ...presentationPolicy };
    this.root.innerHTML = '<section class="project-preview"><div class="chapter-preview-stage"><div class="player-resources" data-resources hidden><span class="player-resource" data-health aria-label="Health"><img src="./assets/img/ui/hud-health.png" alt=""><span data-health-value></span></span><span class="player-resource" data-energy aria-label="Energy"><span data-energy-value></span><img src="./assets/img/ui/hud-energy.png" alt=""></span></div><div class="chapter-preview-card-area"><div class="chapter-preview-card-layout"><div class="chapter-preview-deck" tabindex="0"></div></div></div><section data-action-context></section></div><div class="preview-status-row"><p data-status role="status" hidden></p></div><footer class="preview-footer" data-preview-footer><details data-state hidden><summary>Run state</summary><pre></pre></details><div data-preview-actions></div></footer><section data-inventory></section><section class="check-surface" data-check-surface hidden aria-label="Action check"><div class="check-tray"></div><div class="check-result" data-result role="status" aria-live="polite"></div></section></section>';
    this.mount = root.querySelector('.chapter-preview-deck');
    this.status = root.querySelector('[data-status]');
    this.nextChapterButton = document.createElement('button');
    this.nextChapterButton.type = 'button';
    this.nextChapterButton.textContent = 'Next chapter';
    this.nextChapterButton.setAttribute('data-next-chapter', '');
    this.nextChapterButton.hidden = true;
    this.nextChapterButton.onclick = () => this.nextChapter();
    root.querySelector('[data-preview-actions]').append(this.nextChapterButton);
    this.resources = root.querySelector('[data-resources]');
    this.healthValue = root.querySelector('[data-health-value]');
    this.energyValue = root.querySelector('[data-energy-value]');
    if (this.onGoToCard) {
      this.goToCardButton = document.createElement('button');
      this.goToCardButton.type = 'button';
      this.goToCardButton.textContent = 'Go to card';
      this.goToCardButton.setAttribute('data-go-to-card', '');
      this.goToCardButton.disabled = true;
      root.querySelector('[data-preview-actions]').append(this.goToCardButton);
      this.goToCardButton.onclick = () => {
        const target = this.cardTarget();
        this.syncCardLink();
        if (target && !this.root.closest?.('[inert]')) this.onGoToCard?.(target);
      };
    }
    this.overlay = root.querySelector('[data-check-surface]');
    this.result = root.querySelector('[data-result]');
    this.stateReadout = root.querySelector('[data-state]');
    const inventoryRoot = root.querySelector('[data-inventory]');
    if (inventoryDock) { inventoryRoot.classList.add('nest-inventory-dock'); this.releaseDock = acquireDock(document.body); }
    this.inventorySurface = new InventorySurface({ container: inventoryHost ?? (inventoryDock ? null : root) });
    this.cardBackdrop = new CardBackdrop(root.querySelector('.chapter-preview-card-area'), { container: inventoryHost ?? (inventoryDock ? null : root) });
    this.inventorySurface.mount(inventoryRoot);
    this.footer = root.querySelector('[data-preview-footer]');
    this.inventorySurface.mount(this.footer);
    this.footerResize = new ResizeObserver(entries => {
      const height = entries?.[0]?.borderBoxSize?.[0]?.blockSize ?? this.footer.offsetHeight;
      if (height > 0) {
        const style = this.inventorySurface.frame.style;
        if (style.setProperty) style.setProperty('--inventory-footer-height', `${height}px`);
        else style['--inventory-footer-height'] = `${height}px`;
      }
    });
    this.footerResize.observe(this.footer);
    if (!inventoryDock) root.querySelector('.project-preview').classList.add('project-preview--embedded');
    this.inventoryCardPreview = new InventoryCardPreview(this.mount);
    this.inventory = new InventoryView(inventoryRoot, { getBounds: () => this.inventorySurface.bounds(), onHold: item => this.inventoryCardPreview.show(item), onMotion: event => this.drawerTrace?.(event) });
    this.actionContext = new ActionContextPanel(root.querySelector('[data-action-context]'), {
      onHold: item => this.inventoryCardPreview.show(item),
      canHold: () => !this.deck?.state?.busy && !this.deck?.drag && !!this.state?.idle,
    });

  }
  play(project, chapterId, startNode, { focus = true, initialState = null } = {}) {
    if (this.destroyed) throw new Error('Project preview has been destroyed');
    if (this.destroying) return;
    if (chapterId === undefined) chapterId = project.activeChapterId;
    const issues = validateProject(project);
    if (issues.length) throw new Error(issues.map(issue => issue.message).join('\n'));
    const chapter = compileChapter(project, chapterId, {additionalDefinitionIds:(initialState?.inventory || []).map(item => item.definitionId ?? item.id)});
    if (startNode) chapter.startNode = startNode;
    const expectedGeneration = this.generation + 1;
    this.stop();
    // A stop observer may replace or destroy playback synchronously.
    if (this.destroyed || this.destroying || this.generation !== expectedGeneration) return;
    const generation = this.generation;
    const active = () => !this.destroyed && this.generation === generation;
    applyCardStyles(this.mount, chapter.cardStyles);
    applyCardStyles(this.actionContext.root, chapter.cardStyles);
    applyCardStyles(this.inventorySurface.frame, chapter.cardStyles);
    this.project = structuredClone(project); this.chapterId = chapterId; this.startNode = startNode; this.compiled = chapter;
    this.initialState = initialState ? structuredClone(initialState) : null;
    try {
      this.deck = new CardDeck(this.mount, { settings: this.deckSettings, presentationPolicy: this.presentationPolicy, inventoryDrawer: {
        getTarget: options => this.inventory.getTarget(options),
        presentPreview: (element, bounds) => this.inventorySurface.presentPreview(element, bounds),
        slotTarget: slot => this.inventory.slotTarget(slot),
        preview: target => this.inventory.preview(target),
        stageDeposit: (action, decision) => this.inventory.stageDeposit(action, decision),
        clearDeposit: () => this.inventory.clearDeposit(),
        traceEnabled: () => typeof this.drawerTrace === 'function',
        trace: (event, data) => this.drawerTrace?.(event, data),
        setContext: visible => {
          const changed = this.inventory.visible !== Boolean(visible);
          if (changed) this.drawerTrace?.('InventoryView.setContext:requested', { visible });
          this.inventory.setContext(visible);
          this.syncBackdrop();
          if (changed) this.drawerTrace?.('InventoryView.setContext:applied', { visible: !this.inventory.root.hidden, hidden: this.inventory.root.hidden, requestedVisible: this.inventory.visible });
        },
        cancelPending: () => this.inventory.cancelPending(),
        exchange: (action, decision) => active() && this.controller?.exchangeCollection(action, decision),
        authorize: async (action, target) => {
          const decision = await this.inventory.authorize(action, target);
          return active() && decision && this.controller?.authorizeCollection(action, decision) ? decision : false;
        }
      }, content: { id:'project-loading',text:'',actions:[{id:'wait',label:'Loading',disabled:true}] } });
      const controller = new ProjectController(this.deck, chapter, {
        initialState:this.initialState,
        onChange: state => { if (active()) this.update(state); },
        onError: (error,state) => { if (!active() || error.code === 'NO_AVAILABLE_CHOICES') return; this.hideDice(); this.errorNode = state?.activeNodeId; this.errorMessage = error.message || String(error); this.status.textContent = this.errorMessage; this.status.hidden = false; },
        rollCheck: (pool, options) => {
          if (!active()) throw new DOMException('Preview stopped.', 'AbortError');
          return this.roll(pool, options);
        },
        onCheckResult: result => active() ? this.showResult(result) : undefined,
      });
      // Initial onChange runs before the controller constructor returns.
      if (!active()) { controller.destroy(); return; }
      this.controller = controller;
      this.cardLinkDeck = this.deck;
      this.cardLinkListener = () => { if (active()) { this.syncCardLink(); this.syncActionContext(); } };
      this.cardLinkEvents = ['selection', 'reveal', 'close', 'commit', 'collect', 'discard', 'transitioncomplete'];
      for (const event of this.cardLinkEvents) this.deck.addEventListener(event, this.cardLinkListener);
      this.syncCardLink();
      this.syncActionContext();
      if (focus) this.mount.focus({ preventScroll: true });
    } catch (error) { if (active()) this.stop(); throw error; }
  }
  update(state) {
    if (this.destroyed) return;
    if (state.checking || (this.errorMessage && this.errorNode !== state.activeNodeId)) this.errorMessage = null;
    if (!state.checking) this.checkPresentation = null;
    this.state = state;
    this.nextChapterButton.hidden = !state.completed || !this.followingChapter();
    let visibleResources = 0;
    for (const [id, label, valueElement] of [['health', 'Health', this.healthValue], ['energy', 'Energy', this.energyValue]]) {
      const definition = this.compiled?.variables.find(variable => variable.id === id);
      const meter = this.root.querySelector(`[data-${id}]`);
      meter.hidden = definition?.type !== 'number';
      if (meter.hidden) continue;
      visibleResources++;
      valueElement.textContent = state.variables[id];
      meter.setAttribute('aria-label', `${label} ${state.variables[id]}${definition.max === undefined ? '' : ` out of ${definition.max}`}`);
    }
    this.resources.hidden = visibleResources === 0;
    const node = this.compiled?.nodes.find(node => node.id === state.activeNodeId);
    const nodeType = nodeTypeLabel(node?.type) || '';
    this.status.textContent = this.errorMessage || (state.completed ? 'Chapter complete.' : state.checking ? 'Resolving attempt…' : `Playing · ${node?.name || ''} · ${nodeType}`);
    this.status.hidden = !this.errorMessage && !state.completed;
    const variables = state.variables || {};
    const ownedItems = (state.collectedItems || []).map(item => ({
      id: item.definitionId ?? item.id,
      name: item.name || item.label || 'Item',
    }));
    this.stateReadout.hidden = !Object.keys(variables).length && !ownedItems.length;
    this.stateReadout.querySelector('pre').textContent = `Variables\n${JSON.stringify(variables, null, 2)}\n\nOwned items\n${JSON.stringify(ownedItems, null, 2)}`;
    this.inventory.update(state.collectedItems || [], { busy: !state.idle, variables: this.compiled?.variables || [], values: state.variables, library: this.compiled?.library || [] });
    this.syncCardLink();
    this.syncActionContext();
    this.onChange(state);
  }
  cardTarget() {
    if (this.destroyed || !this.onGoToCard) return null;
    return previewCardTarget(this);
  }
  syncCardLink() {
    if (this.goToCardButton) this.goToCardButton.disabled = !this.cardTarget();
  }
  syncActionContext() {
    const deck = this.deck;
    const action = deck?.content?.actions?.[deck.index ?? 0];
    const info = !this.state?.completed && !this.state?.checking && deck?.phase === 'choices' ? action?.checkInfo : null;
    this.actionContext?.update({
      info,
      result: this.checkPresentation,
      selectionKey: action?.id ?? null,
      item: focusedTriggerItem(deck, this.state),
      busy: !!deck?.state?.busy || !this.state?.idle,
    });
    this.syncBackdrop();
  }
  syncBackdrop() {
    this.cardBackdrop?.setVisible(this.inventory.visible || this.actionContext?.visible);
  }
  async roll(pool, { signal, target } = {}) {
    if (this.destroyed || signal?.aborted) throw new DOMException('Preview stopped.', 'AbortError');
    this.hideDice();
    const generation = this.diceGeneration;
    const deck = this.deck;
    const prepare = slot => {
      slot.append(this.overlay);
      this.overlay.hidden = false;
      this.result.replaceChildren();
      this.result.removeAttribute('data-outcome');
      this.result.textContent = '';
    };
    const slot = await deck.waitForCheckSurface({ signal, prepare });
    if (this.destroyed || generation !== this.diceGeneration || signal?.aborted) throw new DOMException('Preview stopped.', 'AbortError');
    // Hosts implementing only the readiness contract can prepare after settling.
    if (this.overlay.parentNode !== slot) prepare(slot);
    this.diceLayer = new DiceLayer(this.overlay.querySelector('.check-tray'));
    const dice = this.dice = new DiceService({ appearance: this.diceLayer.appearance }).mount(this.diceLayer.tray);
    try { return await dice.roll(pool, { signal }); }
    catch (error) { if (generation === this.diceGeneration) this.hideDice(); throw error; }
  }
  pauseResult(milliseconds) {
    return new Promise(resolve => {
      this.resolveTimer = resolve;
      this.resultTimer = setTimeout(() => { this.resultTimer = null; this.resolveTimer = null; resolve(); }, milliseconds);
    });
  }
  async showResult(result) {
    if (this.destroyed || result.signal?.aborted) return;
    const generation = this.diceGeneration;
    this.checkPresentation = { target: result.target, total: result.total, success: result.success };
    this.syncActionContext();
    const onAbort = () => { if (generation === this.diceGeneration) this.hideDice(); };
    result.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.pauseResult(1100);
      if (generation !== this.diceGeneration || result.signal?.aborted) return;
      this.diceLayer?.fade();
      await this.pauseResult(200);
      if (generation === this.diceGeneration) {
        this.dice?.destroy(); this.dice = null;
        this.diceLayer?.destroy(); this.diceLayer = null;
        // Keep the result on the back until the controller installs its successor.
      }
    } finally { result.signal?.removeEventListener('abort', onAbort); }
  }
  hideDice() {
    ++this.diceGeneration;
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; this.resolveTimer?.(); }
    this.resolveTimer = null;
    this.dice?.destroy(); this.dice = null;
    this.diceLayer?.destroy(); this.diceLayer = null;
    this.overlay.hidden = true;
    this.checkPresentation = null;
    this.syncActionContext();
  }
  followingChapter() {
    return this.project ? nextChapter(this.project, this.chapterId) : undefined;
  }
  nextChapter() {
    const next = this.followingChapter();
    if (this.destroyed || !this.state?.completed || !this.controller || !next) return false;
    const initialState = chapterEntryState(this.project, next.id, this.controller.state);
    this.play(this.project, next.id, undefined, {initialState});
    return this.chapterId === next.id;
  }
  restart() { if (!this.destroyed && this.project) this.play(this.project, this.chapterId, this.startNode, {initialState:this.initialState}); }
  stop() {
    if (this.destroyed) return;
    const hadPlayback = !!(this.controller || this.deck || this.state);
    ++this.generation;
    for (const event of this.cardLinkEvents || []) this.cardLinkDeck?.removeEventListener(event, this.cardLinkListener);
    this.cardLinkDeck = null; this.cardLinkListener = null; this.cardLinkEvents = null;
    const controller = this.controller, deck = this.deck;
    this.controller = null; this.deck = null;
    this.inventory.endHold?.();
    this.actionContext.clear();
    this.inventoryCardPreview.reset();
    controller?.destroy(); deck?.destroy();
    this.inventoryCardPreview.card = null;
    this.inventoryCardPreview.distance = null;
    this.inventory.cancelPending?.(); this.inventory.setContext?.(false, { immediate: true });
    this.syncBackdrop();
    this.hideDice(); this.state = null; this.errorMessage = null; this.errorNode = null; this.compiled = null;
    this.mount.replaceChildren(); this.inventory.update([]); this.stateReadout.hidden = true;
    this.resources.hidden = true;
    this.nextChapterButton.hidden = true;
    this.status.textContent = ''; this.status.hidden = true;
    this.syncCardLink();
    if (hadPlayback) this.onStop();
  }
  destroy() {
    if (this.destroyed || this.destroying) return;
    this.destroying = true;
    try {
      this.stop();
    } finally {
      this.destroyed = true;
      this.inventory.destroy();
      this.actionContext.destroy();
      this.inventoryCardPreview.destroy();
      this.footerResize.disconnect();
      this.cardBackdrop.destroy();
      this.inventorySurface.destroy();
      if (this.goToCardButton) this.goToCardButton.onclick = null;
      this.onGoToCard = null;
      this.releaseDock?.(); this.releaseDock = null;
      this.project = null; this.compiled = null; this.chapterId = null; this.startNode = undefined;
      this.onChange = () => {};
      this.onStop = () => {};
      this.root.replaceChildren();
      this.destroying = false;
    }
  }
}
