import { InventoryCardPreview } from './InventoryCardPreview.js';
import { InventoryView } from './InventoryView.js';
import { InventorySurface } from './InventorySurface.js';
import { CardBackdrop } from './CardBackdrop.js';
import { ActionContextPanel } from './ActionContextPanel.js';
import { applyCardStyles } from '../project/card-styles.js';
import { acquireDock } from '../editor/dockOwnership.js';
import { playerUIState } from './player-ui-state.js';

/** Player presentation owns views and geometry; gameplay owns every mutation. */
export class PlayerUI {
  constructor(root, {mount, footer, inventoryDock = false, inventoryHost = null,
    trace = () => {}, traceEnabled = () => false, getInput} = {}) {
    this.root = root;
    this.destroyed = false;
    this.trace = trace;
    this.getInput = getInput;
    this.traceEnabled = traceEnabled;
    this.revision = null;
    this.canInspect = false;
    const inventoryRoot = root.querySelector('[data-inventory]');
    this.resources = root.querySelector('[data-resources]');
    this.healthValue = root.querySelector('[data-health-value]');
    this.energyValue = root.querySelector('[data-energy-value]');
    this.status = root.querySelector('[data-status]');
    if (inventoryDock) {inventoryRoot.classList.add('nest-inventory-dock'); this.releaseDock = acquireDock((root.ownerDocument ?? document).body);}
    const container = inventoryHost ?? (inventoryDock ? null : root);
    this.surface = new InventorySurface({container});
    this.backdrop = new CardBackdrop(root.querySelector('.chapter-preview-card-area'), {container});
    this.surface.mount(inventoryRoot);
    // This is a host-provided slot. PlayerUI knows its dimensions, never its
    // editor diagnostics or navigation contents.
    if (footer) {
      this.surface.mount(footer);
      this.footerResize = new ResizeObserver(entries => {
        const height = entries?.[0]?.borderBoxSize?.[0]?.blockSize ?? footer.offsetHeight;
        if (height > 0) {
          const style = this.surface.frame.style;
          if (style.setProperty) style.setProperty('--inventory-footer-height', `${height}px`);
          else style['--inventory-footer-height'] = `${height}px`;
        }
      });
      this.footerResize.observe(footer);
    }
    if (!inventoryDock) root.querySelector('.project-preview').classList.add('project-preview--embedded');
    this.cardPreview = new InventoryCardPreview(mount);
    this.inventory = new InventoryView(inventoryRoot, {getBounds:() => this.surface.bounds(),
      onHold:item => this.cardPreview.show(item), onMotion:event => this.trace(event)});
    this.actionContext = new ActionContextPanel(root.querySelector('[data-action-context]'), {
      onHold:item => this.cardPreview.show(item), canHold:() => this.canInspect && !this.destroyed && playerUIState(this.getInput?.() ?? this.input).canInspect,
    });
  }

  applyStyles(styles) {
    applyCardStyles(this.actionContext.root, styles);
    applyCardStyles(this.surface.frame, styles);
  }

  update(input) {
    if (this.destroyed) return;
    this.input = input;
    const view = playerUIState(input);
    this.canInspect = view.canInspect;
    // Inventory refresh cancels dialogs/deposits. Only a controller notification
    // may refresh it; browsing, drag readiness and dice feedback use the same
    // revision and update context without disturbing an in-flight collection.
    if (input.run && this.revision !== input.revision) {
      this.revision = input.revision;
      let visibleResources = 0;
      for (const resource of view.resources) {
        const meter = this.root.querySelector(`[data-${resource.id}]`);
        meter.hidden = !resource.visible;
        if (!resource.visible) continue;
        visibleResources++;
        this[`${resource.id}Value`].textContent = resource.value;
        meter.setAttribute('aria-label', `${resource.label} ${resource.value}${resource.max === undefined ? '' : ` out of ${resource.max}`}`);
      }
      this.resources.hidden = visibleResources === 0;
      const {items, ...options} = view.inventory;
      this.inventory.update(items, options);
    }
    this.status.textContent = view.status.text;
    this.status.hidden = !view.status.visible;
    this.actionContext.update(view.context);
    this.syncBackdrop();
  }

  setInventoryContext(visible, options) {
    if (this.destroyed) return;
    const changed = this.inventory.visible !== Boolean(visible);
    if (changed) this.trace('InventoryView.setContext:requested', {visible});
    this.inventory.setContext(visible, options);
    this.syncBackdrop();
    if (changed) this.trace('InventoryView.setContext:applied', {visible:!this.inventory.root.hidden, hidden:this.inventory.root.hidden, requestedVisible:this.inventory.visible});
  }

  syncBackdrop() {
    if (!this.destroyed) this.backdrop.setVisible(this.inventory.visible || this.actionContext.visible);
  }

  /** Adapter closures belong to one playback generation, including awaited authorization. */
  inventoryAdapter({active, authorize, exchange}) {
    const live = () => !this.destroyed && active();
    return {
      getTarget:options => live() ? this.inventory.getTarget(options) : null,
      presentPreview:(element, bounds) => live() ? this.surface.presentPreview(element, bounds) : element,
      slotTarget:slot => live() ? this.inventory.slotTarget(slot) : null,
      preview:target => {if (live()) this.inventory.preview(target);},
      stageDeposit:(action, decision) => {if (live()) this.inventory.stageDeposit(action, decision);},
      clearDeposit:() => {if (live()) this.inventory.clearDeposit();},
      traceEnabled:() => live() && this.traceEnabled(),
      trace:(event, data) => {if (live()) this.trace(event, data);},
      setContext:visible => {if (live()) this.setInventoryContext(visible);},
      cancelPending:() => {if (live()) this.inventory.cancelPending();},
      exchange:(action, decision) => live() && exchange(action, decision),
      authorize:async (action, target) => {
        if (!live()) return false;
        const decision = await this.inventory.authorize(action, target);
        if (!live() || !decision) return false;
        const allowed = authorize(action, decision);
        return live() && allowed ? decision : false;
      },
    };
  }

  endInteractions() {
    this.canInspect = false;
    this.inventory.endHold();
    this.actionContext.clear();
    this.cardPreview.reset();
  }

  reset() {
    if (this.destroyed) return;
    this.endInteractions();
    this.cardPreview.card = null;
    this.cardPreview.distance = null;
    this.inventory.cancelPending();
    this.setInventoryContext(false, {immediate:true});
    this.inventory.update([]);
    this.resources.hidden = true;
    this.status.textContent = '';
    this.status.hidden = true;
    this.revision = null;
    this.input = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canInspect = false;
    this.inventory.destroy();
    this.actionContext.destroy();
    this.cardPreview.destroy();
    this.footerResize?.disconnect();
    this.backdrop.destroy();
    this.surface.destroy();
    this.releaseDock?.();
    this.releaseDock = null;
    this.input = null;
    this.getInput = null;
    this.trace = () => {};
    this.traceEnabled = () => false;
  }
}
