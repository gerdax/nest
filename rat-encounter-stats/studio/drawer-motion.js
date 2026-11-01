/** Drawer motion is presentation-only: no promise is returned to the card engine. */
export const DRAWER_MOTION = Object.freeze({ duration: 250, distance: 50 });

export class DrawerMotion {
  constructor(root, { onMotion = () => {}, onIdle = () => {} } = {}) {
    this.root = root; this.onMotion = onMotion; this.onIdle = onIdle;
    this.serial = 0; this.animation = null; this.direction = null; this.desiredVisible = null;
    this.destroyed = false;
    this.document = root.ownerDocument ?? globalThis.document;
    this.view = this.document?.defaultView ?? globalThis;
    this.reducedMotion = this.view.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.policyChanged = () => {
      if (!this.destroyed && this.desiredVisible !== null && (this.document?.hidden || this.reducedMotion?.matches)) {
        this.setVisible(this.desiredVisible, { immediate: true });
      }
    };
    this.document?.addEventListener?.('visibilitychange', this.policyChanged);
    this.reducedMotion?.addEventListener?.('change', this.policyChanged);
  }
  get exiting() { return this.direction === 'exit'; }
  pose() {
    if (this.root.hidden) return { opacity: 0, y: DRAWER_MOTION.distance };
    const view = this.root.ownerDocument?.defaultView ?? globalThis;
    const style = view.getComputedStyle?.(this.root) ?? this.root.style;
    const transform = style.transform || '';
    const matrix = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(',').map(Number);
    const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/)?.[1].split(',').map(Number);
    const y = matrix?.[5] ?? matrix3d?.[13] ?? Number(transform.match(/translateY\(([-\d.]+)px\)/)?.[1] ?? 0);
    return { opacity: Number(style.opacity ?? 1), y };
  }
  cancel() {
    ++this.serial;
    const animation = this.animation, direction = this.direction;
    this.animation = null; this.direction = null;
    if (animation) {
      animation.cancel();
      this.onMotion(`${direction}-interrupted`);
    }
    this.root.classList.remove('is-entering'); this.root.classList.remove('is-exiting');
  }
  setVisible(visible, { immediate = false } = {}) {
    if (this.destroyed) return;
    immediate ||= this.document?.hidden === true || this.reducedMotion?.matches === true
      || typeof this.root.animate !== 'function';
    if (visible === this.desiredVisible && !immediate) return;
    const from = this.pose();
    this.cancel(); this.desiredVisible = visible;
    const serial = this.serial;
    const to = { opacity: visible ? 1 : 0, y: visible ? 0 : DRAWER_MOTION.distance };
    this.root.inert = !visible;
    if (visible) this.root.removeAttribute?.('aria-hidden'); else this.root.setAttribute('aria-hidden', 'true');
    this.root.style.opacity = String(to.opacity);
    this.root.style.transform = `translateY(${to.y}px)`;
    if (immediate || !visible && this.root.hidden) {
      this.root.hidden = !visible; this.onIdle(); return;
    }
    this.root.hidden = false;
    this.direction = visible ? 'entrance' : 'exit';
    this.root.classList.add(visible ? 'is-entering' : 'is-exiting');
    const direction = this.direction;
    const animation = this.root.animate([
      { opacity: from.opacity, transform: `translateY(${from.y}px)` },
      { opacity: to.opacity, transform: `translateY(${to.y}px)` },
    ], { duration: DRAWER_MOTION.duration, easing: visible ? 'ease-out' : 'ease-in', fill: 'both' });
    this.animation = animation;
    this.onMotion(`${direction}-started`);
    animation.finished.then(() => {
      if (this.destroyed || serial !== this.serial || this.animation !== animation) return;
      this.animation = null; this.direction = null;
      this.root.hidden = !visible;
      this.root.classList.remove('is-entering'); this.root.classList.remove('is-exiting');
      animation.cancel();
      this.onMotion(`${direction}-finished`); this.onIdle();
    }, () => {});
  }
  destroy() {
    this.document?.removeEventListener?.('visibilitychange', this.policyChanged);
    this.reducedMotion?.removeEventListener?.('change', this.policyChanged);
    this.cancel(); this.destroyed = true;
    this.root.hidden = true; this.root.inert = true;
    this.onMotion = this.onIdle = () => {};
  }
}
