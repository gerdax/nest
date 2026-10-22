/** All demo-owned delays and animations belong to one cancelable presentation. */
export class PresentationClock {
  revision = 0;
  animations = new Set();
  timers = new Map();

  cancel() {
    this.revision++;
    for (const animation of this.animations) animation.cancel();
    this.animations.clear();
    for (const [timer, resolve] of this.timers) { clearTimeout(timer); resolve(false); }
    this.timers.clear();
    return this.revision;
  }

  wait(milliseconds, revision = this.revision) {
    if (revision !== this.revision) return Promise.resolve(false);
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.timers.delete(timer); resolve(revision === this.revision); }, milliseconds);
      this.timers.set(timer, resolve);
    });
  }

  animate(element, keyframes, options) {
    const animation = element.animate(keyframes, options);
    this.animations.add(animation);
    return animation;
  }
}
