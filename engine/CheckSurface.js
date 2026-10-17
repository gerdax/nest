const aborted = () => new DOMException('Check presentation cancelled.', 'AbortError');

/** An accessible slot on the real underlay, independent of its decorative icons. */
export class CheckSurface {
  constructor(back) {
    this.back = back;
    this.waiters = new Set();
    this.slot = document.createElement('section');
    this.slot.className = 'nest-check-slot';
    this.slot.setAttribute('aria-label', 'Action check');
    this.slot.hidden = false;
    back.classList.add('nest-check-active');
    back.checkSlot = this.slot;
    back.append(this.slot);
  }
  wait(signal) {
    if (this.closed || signal?.aborted) return Promise.reject(aborted());
    if (this.ready) return Promise.resolve(this.slot);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, abort: () => {
        this.waiters.delete(waiter);
        signal.removeEventListener('abort', waiter.abort);
        reject(aborted());
      } };
      this.waiters.add(waiter);
      signal?.addEventListener('abort', waiter.abort, { once: true });
    });
  }
  settle() {
    if (this.closed || this.ready) return;
    this.ready = true;
    this.slot.hidden = false;
    this.back.removeAttribute('aria-hidden');
    this.back.classList.add('nest-check-active');
    for (const waiter of this.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.resolve(this.slot);
    }
    this.waiters.clear();
  }
  clear() {
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter.signal?.removeEventListener('abort', waiter.abort);
      waiter.reject(aborted());
    }
    this.waiters.clear();
    this.slot.remove();
    delete this.back.checkSlot;
    this.back.classList.remove('nest-check-active');
    this.back.setAttribute('aria-hidden', 'true');
  }
}
