import { TriggerItemMini } from './TriggerItemMini.js';

/** Shared caption and CSS visibility lifecycle for selected action context. */
export class ActionContextPanel {
  constructor(root, { onHold = () => {}, canHold = () => true } = {}) {
    this.root = root;
    this.outgoingLayers = new Set();
    const doc = root.ownerDocument ?? document;
    const element = (tag, className) => {
      const node = doc.createElement(tag);
      node.className = className;
      return node;
    };
    root.classList.add('action-context-panel');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-atomic', 'true');
    this.caption = element('p', 'action-context-caption');
    this.blend = element('div', 'action-context-blend');
    this.view = element('div', 'action-context-view');
    this.content = element('div', 'action-context-content');
    this.checkDetails = element('section', 'action-check-details');
    this.checkDetails.setAttribute('aria-label', 'Selected action check');
    const chance = element('div', 'action-check-chance');
    this.checkChance = doc.createElement('strong');
    this.checkRules = element('p', 'action-check-label');
    chance.append(this.checkChance);
    this.checkDetails.append(chance, this.checkRules);
    const miniRoot = element('section', 'nest-trigger-item');
    this.content.append(this.checkDetails, miniRoot);
    this.view.append(this.caption, this.content);
    this.blend.append(this.view);
    root.replaceChildren(this.blend);
    this.mini = new TriggerItemMini(miniRoot, {
      onHold,
      canHold: () => this.visible && canHold(),
    });
    this.clear();
  }

  update({ info = null, item = null, result = null, busy = false, selectionKey = null } = {}) {
    if (result?.total == null) result = null;
    if (result) { info = null; item = null; }
    if (!info && !item && !result) {
      this.visible = false;
      this.root.setAttribute('data-visible', 'false');
      this.root.setAttribute('aria-hidden', 'true');
      this.root.setAttribute('inert', '');
      this.mini.endHold();
      if (this.mini.button) this.mini.button.disabled = true;
      // Keep the last caption and content painted while CSS fades out.
      return;
    }
    const key = JSON.stringify([selectionKey, result ? 'result' : info ? 'check' : 'item', result,
      info ? [info.stat,info.chance,info.label,info.formula,info.rules] : item?.inventoryKey ?? item?.id]);
    const outgoing = this.visible && key !== this.presentationKey ? this.snapshot() : null;
    this.presentationKey = key;
    this.view.setAttribute('data-mode', result ? 'result' : info ? 'check' : 'item');
    this.caption.textContent = result ? `TARGET: ${result.target}  CHECK: ${result.total}` : info ? info.stat ?? '' : 'USING';
    this.checkDetails.hidden = !info && !result;
    this.checkChance.textContent = result ? result.success ? 'SUCCESS' : 'FAILURE' : info ? `${Math.round(parseFloat(info.chance))}%` : '';
    this.checkDetails.setAttribute('data-presentation', result ? 'result' : 'odds');
    if (result?.total != null) this.checkDetails.setAttribute('data-outcome', result.success ? 'success' : 'failure');
    else this.checkDetails.removeAttribute('data-outcome');
    const chance = parseFloat(info?.chance);
    if (info) this.checkDetails.setAttribute('data-odds-level', chance >= 80 ? 'very-high' : chance >= 60 ? 'high'
      : chance >= 40 ? 'medium' : chance >= 20 ? 'low' : 'very-low');
    else this.checkDetails.removeAttribute('data-odds-level');
    this.checkRules.textContent = info?.label ?? '';
    this.checkRules.hidden = !info?.label;
    this.checkDetails.title = info ? [info.formula, info.rules].filter(Boolean).join(' · ') : '';
    this.mini.update(info ? null : item, { busy });
    // An unchanged item can reappear after an interrupted exit.
    if (this.mini.button) this.mini.button.disabled = busy;
    this.root.setAttribute('data-mode', result ? 'result' : info ? 'check' : 'item');
    this.root.hidden = false;
    if (!this.visible) this.root.getBoundingClientRect?.();
    this.visible = true;
    this.root.removeAttribute('inert');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.setAttribute('data-visible', 'true');
    if (outgoing) {
      this.incomingAnimation = this.view.animate([{opacity:0},{opacity:1}], {duration:140,easing:'ease'});
      if (outgoing.node) this.fadeLayer({node:outgoing.node}, Number(outgoing.node.style.opacity));
    }
  }

  snapshot() {
    const win = this.mini.view;
    if (!this.view.animate || !this.view.cloneNode) return null;
    if (win.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { this.cancelCrossfade(); return null; }
    const opacity = Number(win.getComputedStyle?.(this.view).opacity ?? 1);
    const painted = [...this.outgoingLayers].map(layer => ({layer,
      opacity:Number(win.getComputedStyle?.(layer.node).opacity ?? layer.node.style.opacity)}));
    const candidates = painted.filter(entry => entry.opacity >= .005).sort((a,b) => b.opacity-a.opacity);
    const keepLive = opacity >= .005 || candidates.length === 0;
    const layers = candidates.slice(0,keepLive ? 11 : 12);
    const retained = new Set(layers.map(entry=>entry.layer));
    for (const {layer} of painted) if (!retained.has(layer)) {
      layer.animation.cancel(); layer.node.remove(); this.outgoingLayers.delete(layer);
      if (this.outgoing === layer) this.outgoing = null;
    }
    const total = (keepLive ? opacity : 0) + layers.reduce((sum,entry) => sum + entry.opacity,0) || 1;
    const outgoing = keepLive ? this.view.cloneNode(true) : null;
    // Retarget every painted weight on the same clock. Additive blending then
    // keeps their total brightness constant even when selection changes fast.
    this.incomingAnimation?.cancel(); this.incomingAnimation = null;
    for (const entry of layers) this.fadeLayer(entry.layer,entry.opacity / total);
    if (outgoing) {
      outgoing.classList.add('action-context-outgoing');
      outgoing.setAttribute('aria-hidden','true');
      outgoing.setAttribute('inert','');
      outgoing.style.opacity = String(opacity / total);
      this.blend.append(outgoing);
    }
    return {node:outgoing};
  }

  fadeLayer(layer, opacity) {
    layer.animation?.cancel();
    layer.node.style.opacity = String(opacity);
    const animation = layer.node.animate([{opacity},{opacity:0}], {duration:140,easing:'ease'});
    layer.animation = animation;
    this.outgoing = layer;
    this.outgoingLayers.add(layer);
    animation.onfinish = () => {
      if (layer.animation !== animation) return;
      layer.node.remove();
      this.outgoingLayers.delete(layer);
      if (this.outgoing === layer) this.outgoing = null;
    };
  }

  cancelCrossfade() {
    this.incomingAnimation?.cancel(); this.incomingAnimation = null;
    for (const layer of this.outgoingLayers) { layer.animation.cancel(); layer.node.remove(); }
    this.outgoingLayers.clear(); this.outgoing = null;
  }

  clear() {
    this.cancelCrossfade(); this.presentationKey = null;
    this.visible = false;
    this.root.hidden = true;
    this.root.setAttribute('data-visible', 'false');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.setAttribute('inert', '');
    this.root.removeAttribute('data-mode');
    this.view.removeAttribute('data-mode');
    this.caption.textContent = '';
    this.checkChance.textContent = '';
    this.checkRules.textContent = '';
    this.checkRules.hidden = true;
    this.checkDetails.hidden = true;
    this.checkDetails.title = '';
    this.checkDetails.removeAttribute('data-odds-level');
    this.mini.update(null);
  }

  destroy() {
    this.clear();
    this.mini.destroy();
  }
}
