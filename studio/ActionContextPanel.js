import { TriggerItemMini } from './TriggerItemMini.js';

/** Shared caption and CSS visibility lifecycle for selected action context. */
export class ActionContextPanel {
  constructor(root, { onHold = () => {}, canHold = () => true } = {}) {
    this.root = root;
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
    root.replaceChildren(this.caption, this.content);
    this.mini = new TriggerItemMini(miniRoot, {
      onHold,
      canHold: () => this.visible && canHold(),
    });
    this.clear();
  }

  update({ info = null, item = null, busy = false } = {}) {
    if (!info && !item) {
      this.visible = false;
      this.root.setAttribute('data-visible', 'false');
      this.root.setAttribute('aria-hidden', 'true');
      this.root.setAttribute('inert', '');
      this.mini.endHold();
      if (this.mini.button) this.mini.button.disabled = true;
      // Keep the last caption and content painted while CSS fades out.
      return;
    }
    this.caption.textContent = info ? info.stat ?? '' : 'USING';
    this.checkDetails.hidden = !info;
    this.checkChance.textContent = info ? `${Math.round(parseFloat(info.chance))}%` : '';
    this.checkRules.textContent = info?.label ?? '';
    this.checkRules.hidden = !info?.label;
    this.checkDetails.title = info ? [info.formula, info.rules].filter(Boolean).join(' · ') : '';
    this.mini.update(info ? null : item, { busy });
    // An unchanged item can reappear after an interrupted exit.
    if (this.mini.button) this.mini.button.disabled = busy;
    this.root.setAttribute('data-mode', info ? 'check' : 'item');
    this.root.hidden = false;
    if (!this.visible) this.root.getBoundingClientRect?.();
    this.visible = true;
    this.root.removeAttribute('inert');
    this.root.setAttribute('aria-hidden', 'false');
    this.root.setAttribute('data-visible', 'true');
  }

  clear() {
    this.visible = false;
    this.root.hidden = true;
    this.root.setAttribute('data-visible', 'false');
    this.root.setAttribute('aria-hidden', 'true');
    this.root.setAttribute('inert', '');
    this.root.removeAttribute('data-mode');
    this.caption.textContent = '';
    this.checkChance.textContent = '';
    this.checkRules.textContent = '';
    this.checkRules.hidden = true;
    this.checkDetails.hidden = true;
    this.checkDetails.title = '';
    this.mini.update(null);
  }

  destroy() {
    this.clear();
    this.mini.destroy();
  }
}
