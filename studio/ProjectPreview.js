import { CardDeck } from '../engine/CardDeck.js';
import { DiceService } from '../dice/DiceService.js';
import { compileChapter, validateProject } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';
import { InventoryView } from './InventoryView.js';
import { applyCardStyles } from '../project/card-styles.js';
import { acquireDock } from '../editor/dockOwnership.js';
import { nodeTypeLabel } from '../project/nodeTypes.js';

/** Playback UI owns dice/inventory presentation, never chapter resolution rules. */
export class ProjectPreview {
  constructor(root, { onChange = () => {}, inventoryDock = false, deckSettings = {} } = {}) {
    this.root = root;
    this.destroyed = false;
    this.generation = 0;
    this.diceGeneration = 0;
    this.onChange = onChange;
    this.deckSettings = { ...deckSettings };
    this.root.innerHTML = '<section class="project-preview"><div class="chapter-preview-stage"><div class="chapter-preview-deck" tabindex="0"></div></div><p data-status role="status">Stopped.</p><details data-state hidden><summary>Run state</summary><pre></pre></details><section data-inventory></section><div class="check-overlay" hidden role="dialog" aria-modal="true" aria-label="Action check"><div class="check-panel"><h3>Resolving attempt</h3><div class="check-tray"></div><p data-result role="status"></p><button data-cancel type="button">Cancel attempt</button></div></div></section>';
    this.mount = root.querySelector('.chapter-preview-deck');
    this.status = root.querySelector('[data-status]');
    this.overlay = root.querySelector('.check-overlay');
    this.result = root.querySelector('[data-result]');
    this.stateReadout = root.querySelector('[data-state]');
    const inventoryRoot = root.querySelector('[data-inventory]');
    if (inventoryDock) { inventoryRoot.classList.add('nest-inventory-dock'); this.releaseDock = acquireDock(document.body); }
    this.inventory = new InventoryView(inventoryRoot, { onUse: id => this.controller?.useItem(id) });
    this.cancelButton = root.querySelector('[data-cancel]');
    this.cancelButton.onclick = () => this.controller?.cancelCheck();
    this.cancelKey = event => {
      if (event.key === 'Escape' && !this.overlay.hidden && !this.root.querySelector('[data-cancel]').disabled) { event.preventDefault(); this.controller?.cancelCheck(); }
    };
    document.addEventListener('keydown', this.cancelKey);
  }
  play(project, chapterId, startNode) {
    if (this.destroyed) throw new Error('Project preview has been destroyed');
    if (chapterId === undefined) chapterId = project.activeChapterId;
    const issues = validateProject(project);
    if (issues.length) throw new Error(issues.map(issue => issue.message).join('\n'));
    const chapter = compileChapter(project, chapterId);
    if (startNode) chapter.startNode = startNode;
    this.stop();
    const generation = this.generation;
    const active = () => !this.destroyed && this.generation === generation;
    applyCardStyles(this.mount, chapter.cardStyles);
    this.project = structuredClone(project); this.chapterId = chapterId; this.startNode = startNode; this.compiled = chapter;
    try {
      this.deck = new CardDeck(this.mount, { settings: this.deckSettings, content: { id:'project-loading',text:'',actions:[{id:'wait',label:'Loading',disabled:true}] } });
      const controller = new ProjectController(this.deck, chapter, {
        onChange: state => { if (active()) this.update(state); },
        onError: (error,state) => { if (!active()) return; this.hideDice(); this.errorNode = state?.activeNodeId; this.errorMessage = error.message || String(error); this.status.textContent = this.errorMessage; },
        rollCheck: (pool, options) => {
          if (!active()) throw new DOMException('Preview stopped.', 'AbortError');
          return this.roll(pool, options);
        },
        onCheckResult: result => active() ? this.showResult(result) : undefined,
      });
      // Initial onChange runs before the controller constructor returns.
      if (!active()) { controller.destroy(); return; }
      this.controller = controller;
      this.mount.focus({ preventScroll: true });
    } catch (error) { if (active()) this.stop(); throw error; }
  }
  update(state) {
    if (this.destroyed) return;
    if (state.checking || (this.errorMessage && this.errorNode !== state.activeNodeId)) this.errorMessage = null;
    this.state = state;
    const node = this.compiled?.nodes.find(node => node.id === state.activeNodeId);
    const nodeType = nodeTypeLabel(node?.type) || '';
    this.status.textContent = this.errorMessage || (state.completed ? 'Chapter complete.' : state.checking ? 'Resolving attempt…' : `Playing · ${node?.name || ''} · ${nodeType}`);
    this.stateReadout.hidden = !Object.keys(state.variables || {}).length;
    this.stateReadout.querySelector('pre').textContent = JSON.stringify(state.variables || {}, null, 2);
    this.inventory.update(state.collectedItems || [], { busy: !state.idle, variables: this.compiled?.variables || [], values: state.variables, library: this.compiled?.library || [] });
    this.onChange(state);
  }
  async roll(pool, { signal } = {}) {
    if (this.destroyed || signal?.aborted) throw new DOMException('Preview stopped.', 'AbortError');
    this.hideDice();
    const generation = this.diceGeneration;
    this.overlay.hidden = false;
    this.result.textContent = 'Rolling…';
    this.root.querySelector('[data-cancel]').disabled = false;
    const dice = this.dice = new DiceService().mount(this.root.querySelector('.check-tray'));
    try { return await dice.roll(pool, { signal }); }
    catch (error) { if (generation === this.diceGeneration) this.hideDice(); throw error; }
  }
  async showResult(result) {
    if (this.destroyed || result.signal?.aborted) return;
    const generation = this.diceGeneration;
    this.cancelButton.disabled = true;
    this.result.textContent = `${result.total} / target ${result.target} · ${result.success ? 'Success' : 'Failure'}`;
    const onAbort = () => { if (generation === this.diceGeneration) this.hideDice(); };
    result.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await new Promise(resolve => {
        this.resultTimer = setTimeout(() => { this.resultTimer = null; resolve(); }, 800);
        this.resolveTimer = resolve;
      });
      if (generation === this.diceGeneration) this.hideDice();
    } finally { result.signal?.removeEventListener('abort', onAbort); }
  }
  hideDice() {
    ++this.diceGeneration;
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; this.resolveTimer?.(); }
    this.resolveTimer = null;
    this.dice?.destroy(); this.dice = null;
    this.overlay.hidden = true;
  }
  restart() { if (!this.destroyed && this.project) this.play(this.project, this.chapterId, this.startNode); }
  stop() {
    if (this.destroyed) return;
    ++this.generation;
    const controller = this.controller, deck = this.deck;
    this.controller = null; this.deck = null;
    controller?.destroy(); deck?.destroy();
    this.hideDice(); this.state = null; this.errorMessage = null; this.errorNode = null; this.compiled = null;
    this.mount.replaceChildren(); this.inventory.update([]); this.stateReadout.hidden = true;
    this.status.textContent = 'Stopped.';
  }
  destroy() {
    if (this.destroyed) return;
    this.stop(); this.destroyed = true;
    this.inventory.destroy(); this.inventory.onUse = () => {};
    document.removeEventListener('keydown', this.cancelKey);
    this.cancelKey = null; this.cancelButton.onclick = null;
    this.releaseDock?.(); this.releaseDock = null;
    this.project = null; this.compiled = null; this.chapterId = null; this.startNode = undefined;
    this.onChange = () => {};
    this.root.replaceChildren();
  }
}
