import { CardDeck } from '../engine/CardDeck.js';
import { DiceService } from '../dice/DiceService.js';
import { compileChapter, validateProject } from '../project/model.js';
import { ProjectController } from '../project/ProjectController.js';
import { InventoryView } from './InventoryView.js';

/** Playback UI owns dice/inventory presentation, never chapter resolution rules. */
export class ProjectPreview {
  constructor(root, { onChange = () => {}, inventoryDock = false, deckSettings = {} } = {}) {
    this.root = root;
    this.onChange = onChange;
    this.deckSettings = { ...deckSettings };
    this.root.innerHTML = '<section class="project-preview"><div class="chapter-preview-stage"><div class="chapter-preview-deck" tabindex="0"></div></div><p data-status role="status">Stopped.</p><details data-state hidden><summary>Run state</summary><pre></pre></details><section data-inventory></section><div class="check-overlay" hidden role="dialog" aria-modal="true" aria-label="Action check"><div class="check-panel"><h3>Resolving attempt</h3><div class="check-tray"></div><p data-result role="status"></p><button data-cancel type="button">Cancel attempt</button></div></div></section>';
    this.mount = root.querySelector('.chapter-preview-deck');
    this.status = root.querySelector('[data-status]');
    this.overlay = root.querySelector('.check-overlay');
    this.result = root.querySelector('[data-result]');
    this.stateReadout = root.querySelector('[data-state]');
    const inventoryRoot = root.querySelector('[data-inventory]');
    if (inventoryDock) { inventoryRoot.classList.add('nest-inventory-dock'); document.body.classList.add('has-inventory-dock'); }
    this.inventoryDock = inventoryDock;
    this.inventory = new InventoryView(inventoryRoot, { onUse: id => this.controller?.useItem(id) });
    root.querySelector('[data-cancel]').onclick = () => this.controller?.cancelCheck();
    this.cancelKey = event => {
      if (event.key === 'Escape' && !this.overlay.hidden && !this.root.querySelector('[data-cancel]').disabled) { event.preventDefault(); this.controller?.cancelCheck(); }
    };
    document.addEventListener('keydown', this.cancelKey);
  }
  play(project, chapterId = project.activeChapterId, startNode) {
    const issues = validateProject(project);
    if (issues.length) throw new Error(issues.map(issue => issue.message).join('\n'));
    const chapter = compileChapter(project, chapterId);
    if (startNode) chapter.startNode = startNode;
    this.stop();
    this.project = structuredClone(project); this.chapterId = chapterId; this.startNode = startNode; this.compiled = chapter;
    this.deck = new CardDeck(this.mount, { settings: this.deckSettings, content: { id:'project-loading',text:'',actions:[{id:'wait',label:'Loading',disabled:true}] } });
    try {
      this.controller = new ProjectController(this.deck, chapter, {
        onChange: state => this.update(state),
        onError: (error,state) => { this.hideDice(); this.errorNode = state?.activeNodeId; this.errorMessage = error.message || String(error); this.status.textContent = this.errorMessage; },
        rollCheck: (pool, options) => this.roll(pool, options),
        onCheckResult: result => this.showResult(result),
      });
      this.mount.focus({ preventScroll: true });
    } catch (error) { this.stop(); throw error; }
  }
  update(state) {
    if (state.checking || (this.errorMessage && this.errorNode !== state.activeNodeId)) this.errorMessage = null;
    this.state = state;
    const node = this.compiled?.nodes.find(node => node.id === state.activeNodeId);
    const nodeType = { linear: 'Linear', fork: 'Fork', container: 'Container', random: 'Random', legacySequence: 'Legacy sequence', legacyPool: 'Legacy Random' }[node?.type] || node?.type || '';
    this.status.textContent = this.errorMessage || (state.completed ? 'Chapter complete.' : state.checking ? 'Resolving attempt…' : `Playing · ${node?.name || ''} · ${nodeType}`);
    this.stateReadout.hidden = !Object.keys(state.variables || {}).length;
    this.stateReadout.querySelector('pre').textContent = JSON.stringify(state.variables || {}, null, 2);
    this.inventory.update(state.collectedItems || [], { busy: !state.idle, variables: this.compiled?.variables || [], values: state.variables, library: this.compiled?.library || [] });
    this.onChange(state);
  }
  async roll(pool, { signal } = {}) {
    this.hideDice();
    this.overlay.hidden = false;
    this.result.textContent = 'Rolling…';
    this.root.querySelector('[data-cancel]').disabled = false;
    this.dice = new DiceService().mount(this.root.querySelector('.check-tray'));
    try { return await this.dice.roll(pool, { signal }); }
    catch (error) { this.hideDice(); throw error; }
  }
  async showResult(result) {
    this.root.querySelector('[data-cancel]').disabled = true;
    this.result.textContent = `${result.total} / target ${result.target} · ${result.success ? 'Success' : 'Failure'}`;
    await new Promise(resolve => { this.resultTimer = setTimeout(() => { this.resultTimer = null; resolve(); }, 800); this.resolveTimer = resolve; });
    this.hideDice();
  }
  hideDice() {
    if (this.resultTimer) { clearTimeout(this.resultTimer); this.resultTimer = null; this.resolveTimer?.(); }
    this.resolveTimer = null;
    this.dice?.destroy(); this.dice = null;
    this.overlay.hidden = true;
  }
  restart() { if (this.project) this.play(this.project, this.chapterId, this.startNode); }
  stop() {
    this.controller?.destroy(); this.controller = null;
    this.deck?.destroy(); this.deck = null;
    this.hideDice(); this.state = null; this.errorMessage = null;
    this.mount.replaceChildren(); this.inventory.update([]); this.stateReadout.hidden = true;
    this.status.textContent = 'Stopped.';
  }
  destroy() {
    this.stop(); this.inventory.destroy(); document.removeEventListener('keydown', this.cancelKey);
    if (this.inventoryDock) document.body.classList.remove('has-inventory-dock');
    this.root.replaceChildren();
  }
}
