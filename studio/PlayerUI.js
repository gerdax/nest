import {resolveDescription} from '../project/description-tokens.js';
import { InventoryCardPreview } from './InventoryCardPreview.js';
import { InventoryView } from './InventoryView.js';
import { InventorySurface } from './InventorySurface.js';
import { CardBackdrop } from './CardBackdrop.js';
import { ActionContextPanel } from './ActionContextPanel.js';
import { applyCardStyles } from '../project/card-styles.js';
import { acquireDock } from './dockOwnership.js';
import { playerUIState } from './player-ui-state.js';
import { layoutBounds } from '../engine/cssScale.js';
import { playfieldLayout } from './playfield-layout.js';

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
    this.resourceIcons = {health:{}, energy:{}};
    const inventoryRoot = root.querySelector('[data-inventory]');
    this.resources = root.querySelector('[data-resources]');
    this.healthValue = root.querySelector('[data-health-value]');
    this.energyValue = root.querySelector('[data-energy-value]');
    this.status = root.querySelector('[data-status]');
    if (inventoryDock) {inventoryRoot.classList.add('nest-inventory-dock'); this.releaseDock = acquireDock((root.ownerDocument ?? document).body);}
    const container = inventoryHost ?? (inventoryDock ? null : root);
    this.surface = new InventorySurface({container});
    const cardArea = root.querySelector('.chapter-preview-card-area');
    this.backdrop = new CardBackdrop(cardArea, {container});
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
      onHold:item => this.showInventoryCard(item), onMotion:event => this.trace(event)});
    this.actionContext = new ActionContextPanel(root.querySelector('[data-action-context]'), {
      onHold:item => this.showInventoryCard(item), canHold:() => this.canInspect && !this.destroyed && playerUIState(this.getInput?.() ?? this.input).canInspect,
    });
    const playfield=root.closest?.('.nest-playfield')??root;
    const setStyle=(element,key,value)=>{
      if(element.style.setProperty)element.style.setProperty(key,value);
      else element.style[key]=value;
    };
    this.syncContextWidth=()=>{
      if(this.destroyed)return;
      const bounds=layoutBounds(root),layout=playfieldLayout(bounds.width,bounds.height);
      if(layout){
        setStyle(playfield,'--playfield-scale',String(layout.scale));
        setStyle(root,'--playfield-composition-lift',`${layout.lift}px`);
      }
      const cardBounds=layoutBounds(mount);
      const width=cardBounds.width;
      if(Number.isFinite(width)&&width>0){
        this.actionContext.root.style.width=`${width}px`;
        this.resources.style.width=`${width}px`;
      }
      // The inventory peek moves the card plane, but the HUD follows its resting position.
      const plane=this.cardPreview.plane;
      const translate=plane.ownerDocument?.defaultView?.getComputedStyle?.(plane).translate;
      const cameraY=parseFloat(translate?.split(/\s+/)[1])||0;
      const cardTop=cardBounds.top-bounds.top-cameraY;
      const stageTop=layoutBounds(root.querySelector('.chapter-preview-stage')).top-bounds.top;
      const baseline=this.resources.querySelector('.player-resource:not([hidden]) .resource-baseline');
      if(baseline && cardTop>0 && Number.isFinite(stageTop)){
        const baselineOffset=layoutBounds(baseline).top-layoutBounds(this.resources).top;
        setStyle(root,'--playfield-hud-top-y',`${cardTop*.75-stageTop-baselineOffset}px`);
      }
    };
    this.contextResize=new ResizeObserver(this.syncContextWidth);
    this.contextResize.observe(root);
    this.contextResize.observe(mount);
    this.syncContextWidth();
    root.ownerDocument?.fonts?.ready.then(this.syncContextWidth);
  }

  applyStyles(styles) {
    applyCardStyles(this.actionContext.root, styles);
    applyCardStyles(this.surface.frame, styles);
  }

  showInventoryCard(item) {
    if(!item){this.cardPreview.show(item);return;}
    const text=resolveDescription(item.text??'',{card:item,variables:this.input?.definitions?.variables??[],values:this.input?.run?.variables??{}}).text;
    this.cardPreview.show({...item,text});
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
        this.updateResourceIcon(resource.id, resource.visible ? resource.value : undefined, meter);
        if (!resource.visible) continue;
        visibleResources++;
        this[`${resource.id}Value`].textContent = resource.value;
        meter.setAttribute('aria-label', `${resource.label} ${resource.value}${resource.max === undefined ? '' : ` out of ${resource.max}`}`);
      }
      const resourcesHidden = visibleResources === 0;
      if (this.resources.hidden !== resourcesHidden) {
        this.resources.hidden = resourcesHidden;
        if (!resourcesHidden) this.syncContextWidth();
      }
      const {items, ...options} = view.inventory;
      this.inventory.update(items, options);
    }
    this.status.textContent = view.status.text;
    this.status.hidden = !view.status.visible;
    this.actionContext.update(view.context);
    this.syncBackdrop();
  }

  updateResourceIcon(id, value, meter) {
    const state = this.resourceIcons[id];
    const previous = state.value;
    state.value = value;
    if (value === previous) return;
    state.animation?.cancel();
    state.animation = null;
    if (!Number.isFinite(value) || !Number.isFinite(previous)) return;
    if (this.root.ownerDocument?.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;

    const gained = value > previous;
    const target = gained ? meter.querySelector('.resource-icon-flash') : meter;
    const restingOpacity = gained ? 0 : 1;
    const pulseOpacity = gained ? 1 : 0.28;
    const lastPulse = 390;
    const duration = lastPulse + 520;
    const keyframes = [
      {opacity:restingOpacity, offset:0},
      {opacity:pulseOpacity, offset:130 / duration},
      {opacity:restingOpacity, offset:260 / duration},
      {opacity:pulseOpacity, offset:lastPulse / duration, easing:'ease-out'},
      {opacity:restingOpacity, offset:1},
    ];
    state.animation = target?.animate?.(keyframes, {duration:gained ? duration * 3 : duration});
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
    for (const id of Object.keys(this.resourceIcons)) this.updateResourceIcon(id, undefined);
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
    for (const id of Object.keys(this.resourceIcons)) this.updateResourceIcon(id, undefined);
    this.destroyed = true;
    this.canInspect = false;
    this.inventory.destroy();
    this.actionContext.destroy();
    this.cardPreview.destroy();
    this.footerResize?.disconnect();
    this.contextResize.disconnect();
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
