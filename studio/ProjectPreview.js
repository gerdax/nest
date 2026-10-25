import { createError, errorCode } from '../errors.js';
import { nextChapter } from '../project/chapter-navigation.js';
import { CardDeck } from '../engine/CardDeck.js';
import { DiceService } from '../dice/DiceService.js';
import { compileChapter, validateProject } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';
import { chapterEntryState } from '../project/chapter-entry.js';
import { applyCardStyles } from '../project/card-styles.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';
import { previewCardTarget } from './preview-card-target.js';
import { DiceLayer } from './DiceLayer.js';
import { PlayerUI } from './PlayerUI.js';

/** Playback UI owns dice/inventory presentation, never chapter resolution rules. */
export class ProjectPreview {
  constructor(root, { onChange = () => {}, onStop = () => {}, onCardChange = () => {}, onGoToCard, onNodeError = () => {}, onNodeResolved = () => {}, inventoryDock = false, inventoryHost = null, deckSettings = {}, presentationPolicy = {}, previewOverrides = null } = {}) {
    this.root = root;
    this.destroyed = false;
    this.generation = 0;
    this.diceGeneration = 0;
    this.uiRevision = 0;
    this.onChange = onChange;
    this.onStop = onStop;
    this.onCardChange = onCardChange;
    this.onNodeError = onNodeError;
    this.onNodeResolved = onNodeResolved;
    this.onGoToCard = typeof onGoToCard === 'function' ? onGoToCard : null;
    this.deckSettings = { ...deckSettings };
    this.presentationPolicy = { ...presentationPolicy };
    this.previewOverrides = previewOverrides;
    this.root.innerHTML = '<section class="project-preview"><div class="chapter-preview-stage"><div class="player-resources" data-resources hidden><span class="player-resource" data-health aria-label="Health"><img src="./assets/img/ui/hud-health.png" alt=""><span data-health-value></span></span><span class="player-resource" data-energy aria-label="Energy"><span data-energy-value></span><img src="./assets/img/ui/hud-energy.png" alt=""></span></div><div class="chapter-preview-card-area"><div class="chapter-preview-card-layout"><div class="chapter-preview-deck" tabindex="0"></div></div></div><section data-action-context></section></div><div class="preview-status-row"><p data-status role="status" hidden></p></div><footer class="preview-footer" data-preview-footer><details data-state hidden><summary>Run state</summary><pre></pre></details><div data-preview-actions></div></footer><section data-inventory></section><section class="check-surface" data-check-surface hidden aria-label="Action check"><div class="check-tray"></div><div class="check-result" data-result role="status" aria-live="polite"></div></section></section>';
    this.mount = root.querySelector('.chapter-preview-deck');
    this.nextChapterButton = document.createElement('button');
    this.nextChapterButton.type = 'button';
    this.nextChapterButton.textContent = 'Next chapter';
    this.nextChapterButton.setAttribute('data-next-chapter', '');
    this.nextChapterButton.hidden = true;
    this.nextChapterButton.onclick = () => this.nextChapter();
    root.querySelector('[data-preview-actions]').append(this.nextChapterButton);
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
    this.footer = root.querySelector('[data-preview-footer]');
    this.playerUI = new PlayerUI(root, {mount:this.mount, footer:this.footer, inventoryDock, inventoryHost,
      getInput:() => this.playerUIInput(),
      trace:(...args) => this.drawerTrace?.(...args), traceEnabled:() => typeof this.drawerTrace === 'function',
    });

  }
  play(project, chapterId, startNode, { focus = true, initialState = null } = {}) {
    if (this.destroyed) throw createError('STUDIO_PROJECT_PREVIEW_HAS_BEEN_DESTROYED');
    if (this.destroying) return;
    if (chapterId === undefined) chapterId = project.activeChapterId;
    const issues = validateProject(project);
    if (issues.length) throw createError('STUDIO_PREVIEW_VALIDATION_FAILED', {message: issues.map(issue => issue.message).join('\n')});
    const sourceChapter = project.chapters.find(chapter => chapter.id === chapterId);
    const nodeEntryEffects = sourceChapter ? this.previewOverrides?.nodeEntryEffects(project, sourceChapter) ?? {} : {};
    const additionalDefinitionIds = [
      ...(initialState?.inventory || []).map(item => item.definitionId ?? item.id),
      ...Object.values(nodeEntryEffects).flat().filter(effect => effect.op === 'addItem').map(effect => effect.key),
    ];
    const chapter = compileChapter(project, chapterId, {additionalDefinitionIds});
    if (startNode) chapter.startNode = startNode;
    const expectedGeneration = this.generation + 1;
    this.stop();
    // A stop observer may replace or destroy playback synchronously.
    if (this.destroyed || this.destroying || this.generation !== expectedGeneration) return;
    const generation = this.generation;
    const active = () => !this.destroyed && this.generation === generation;
    applyCardStyles(this.mount, chapter.cardStyles);
    this.playerUI.applyStyles(chapter.cardStyles);
    this.project = structuredClone(project); this.chapterId = chapterId; this.startNode = startNode; this.compiled = chapter;
    this.initialState = initialState ? structuredClone(initialState) : null;
    try {
      this.deck = new CardDeck(this.mount, { settings: this.deckSettings, presentationPolicy: this.presentationPolicy, inventoryDrawer: this.playerUI.inventoryAdapter({
        active,
        exchange:(action, decision) => this.controller?.exchangeCollection(action, decision),
        authorize:(action, decision) => this.controller?.authorizeCollection(action, decision),
      }), content: { id:'project-loading',text:'',actions:[{id:'wait',label:'Loading',disabled:true}] } });
      const controller = new ProjectController(this.deck, chapter, {
        initialState:this.initialState,
        nodeEntryEffects,
        onChange: state => { if (active()) this.update(state); },
        onStart: nodeId => { if (active()) this.onNodeResolved?.({projectId:this.project?.id,chapterId:this.chapterId,nodeId,entryOnly:true}); },
        onSuccess: nodeId => { if (active()) this.onNodeResolved?.({projectId:this.project?.id,chapterId:this.chapterId,nodeId}); },
        onError: (error,state) => { if (!active() || errorCode(error) === 'NO_AVAILABLE_CHOICES') return; this.hideDice(); this.errorNode = state?.activeNodeId; this.errorMessage = error.message || String(error); this.syncPlayerUI(); this.onNodeError?.({projectId:this.project?.id,chapterId:this.chapterId,nodeId:this.errorNode ?? this.startNode ?? this.compiled?.startNode,code:errorCode(error),message:this.errorMessage,entryFailure:!state?.activeNodeId}); },
        rollCheck: (pool, options) => {
          if (!active()) throw createError('STUDIO_PREVIEW_STOPPED');
          return this.roll(pool, options);
        },
        onCheckResult: result => active() ? this.showResult(result) : undefined,
      });
      // Initial onChange runs before the controller constructor returns.
      if (!active()) { controller.destroy(); return; }
      this.controller = controller;
      this.cardLinkDeck = this.deck;
      this.cardLinkListener = () => { if (active()) { this.syncCardLink(); this.syncPlayerUI(); } };
      this.cardLinkEvents = ['selection', 'reveal', 'close', 'commit', 'collect', 'discard', 'transitioncomplete'];
      for (const event of this.cardLinkEvents) this.deck.addEventListener(event, this.cardLinkListener);
      this.syncCardLink();
      if (!active()) return;
      this.syncPlayerUI();
      if (focus) this.mount.focus({ preventScroll: true });
    } catch (error) { if (active()) this.stop(); throw error; }
  }
  update(state) {
    if (this.destroyed) return;
    if (state.checking || (this.errorMessage && this.errorNode !== state.activeNodeId)) this.errorMessage = null;
    if (!state.checking) this.checkPresentation = null;
    this.state = state;
    this.nextChapterButton.hidden = !state.completed || !this.followingChapter();
    ++this.uiRevision;
    // Host diagnostics/navigation are deliberately outside the player UI.
    const variables = state.variables || {};
    const ownedItems = (state.collectedItems || []).map(item => ({
      id: item.definitionId ?? item.id,
      name: item.name || item.label || 'Item',
    }));
    this.stateReadout.hidden = !Object.keys(variables).length && !ownedItems.length;
    this.stateReadout.querySelector('pre').textContent = `Variables\n${JSON.stringify(variables, null, 2)}\n\nOwned items\n${JSON.stringify(ownedItems, null, 2)}`;
    const generation = this.generation;
    this.syncPlayerUI();
    this.syncCardLink();
    if (this.destroyed || this.generation !== generation || this.state !== state) return;
    this.syncPlayerUI();
    this.onChange(state);
  }
  cardTarget() {
    if (this.destroyed || !this.onGoToCard) return null;
    return previewCardTarget(this);
  }
  syncCardLink() {
    const target = this.destroyed ? null : previewCardTarget(this);
    if (this.goToCardButton) this.goToCardButton.disabled = !target;
    this.onCardChange(target);
  }
  playerUIInput() {
    const deck = this.deck, state = deck ? this.state : null;
    const node = this.compiled?.nodes.find(node => node.id === state?.activeNodeId);
    return {
      revision:this.uiRevision,
      run:state,
      card:{action:deck?.content?.actions?.[deck.index ?? 0], phase:deck?.phase, directAdvance:deck?.content?.directAdvance},
      interaction:{busy:!!deck?.state?.busy, dragging:!!deck?.drag},
      definitions:{variables:this.compiled?.variables ?? [], library:this.compiled?.library ?? []},
      feedback:{result:this.checkPresentation, status:{
        text:this.errorMessage || (state?.completed ? 'Chapter complete.' : state?.checking ? 'Resolving attempt…'
          : state ? `Playing · ${node?.name || ''} · ${nodeTypeLabel(node?.type) || ''}` : ''),
        visible:!!this.errorMessage || !!state?.completed,
      }},
    };
  }
  syncPlayerUI() { this.playerUI.update(this.playerUIInput()); }
  syncActionContext() { this.syncPlayerUI(); }
  syncBackdrop() { this.playerUI.syncBackdrop(); }
  // Compatibility views into the single owner, not separate mutable lifetimes.
  get inventory() { return this.playerUI.inventory; }
  get actionContext() { return this.playerUI.actionContext; }
  get inventorySurface() { return this.playerUI.surface; }
  get inventoryCardPreview() { return this.playerUI.cardPreview; }
  get cardBackdrop() { return this.playerUI.backdrop; }
  get releaseDock() { return this.playerUI.releaseDock; }
  get footerResize() { return this.playerUI.footerResize; }
  get resources() { return this.playerUI.resources; }
  get healthValue() { return this.playerUI.healthValue; }
  get energyValue() { return this.playerUI.energyValue; }
  get status() { return this.playerUI.status; }
  async roll(pool, { signal, target } = {}) {
    if (this.destroyed || signal?.aborted) throw createError('STUDIO_PREVIEW_STOPPED');
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
    if (this.destroyed || generation !== this.diceGeneration || signal?.aborted) throw createError('STUDIO_PREVIEW_STOPPED');
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
    this.syncPlayerUI();
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
    this.syncPlayerUI();
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
    this.playerUI.endInteractions();
    controller?.destroy(); deck?.destroy();
    this.playerUI.reset();
    this.state = null; this.errorMessage = null; this.errorNode = null; this.compiled = null;
    this.hideDice();
    this.mount.replaceChildren(); this.stateReadout.hidden = true;
    this.nextChapterButton.hidden = true;
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
      this.playerUI.destroy();
      if (this.goToCardButton) this.goToCardButton.onclick = null;
      this.onGoToCard = null;
      this.project = null; this.compiled = null; this.chapterId = null; this.startNode = undefined;
      this.previewOverrides = null;
      this.onChange = () => {};
      this.onStop = () => {};
      this.onCardChange = () => {};
      this.root.replaceChildren();
      this.destroying = false;
    }
  }
}
