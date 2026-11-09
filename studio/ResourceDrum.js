const reducedMotion = '(prefers-reduced-motion: reduce)';
const faceAngle = 60;

function displayValue(value) {
  const [integer, fraction] = String(Math.abs(value)).split('.');
  return (value < 0 ? '-' : '') + integer.padStart(2, '0') +
    (fraction === undefined ? '' : `.${fraction}`);
}

function alignedDigits(before, next) {
  const [whole, fraction = ''] = before.replace(/^-/, '').split('.');
  const [nextWhole, nextFraction] = next.replace(/^-/, '').split('.');
  if (!/^\d+$/.test(whole) || !/^\d+$/.test(nextWhole) ||
    !/^\d*$/.test(fraction) || !/^\d*$/.test(nextFraction ?? '')) return before;
  const aligned = whole.padStart(nextWhole.length, '0').slice(-nextWhole.length);
  return (next.startsWith('-') ? '-' : '') + aligned +
    (nextFraction === undefined ? '' : `.${fraction.padEnd(nextFraction.length, '0').slice(0, nextFraction.length)}`);
}

function face(doc, digit, angle = 0) {
  const element = doc.createElement('span');
  element.classList.add('resource-drum-face');
  element.textContent = digit;
  element.style.transform = `rotateX(${angle}deg) translateZ(var(--resource-drum-depth))`;
  return element;
}

/** Visual only: the HUD's accessible label always reports the committed value. */
export class ResourceDrum {
  constructor(root) {
    this.root = root;
    this.columns = [];
    root.classList.add('resource-drums');
    root.setAttribute('aria-hidden', 'true');
  }

  update(value) {
    if (value === this.value) return;
    const previous = this.value;
    this.value = value;
    const displayed = this.columns.map(({animation, digits, digit}) => {
      const progress = animation?.effect?.getComputedTiming().progress;
      return progress == null ? digit : digits[Math.round(progress * (digits.length - 1))];
    }).join('');
    for (const column of this.columns) column.animation?.cancel();
    this.columns = [];
    if (!Number.isFinite(value)) {
      this.root.replaceChildren();
      return;
    }

    const doc = this.root.ownerDocument;
    const next = displayValue(value);
    const before = alignedDigits(displayed, next);
    const canRoll = Number.isFinite(previous) && before.length === next.length &&
      [...next].every((char, i) => /\d/.test(char) ? /\d/.test(before[i]) : char === before[i]) &&
      !doc.defaultView?.matchMedia?.(reducedMotion)?.matches;
    const direction = Math.abs(value) > Math.abs(previous) ? 1 : -1;
    let digitIndex = 0;
    const elements = Array.from(next, (digit, i) => {
      if (!/\d/.test(digit)) {
        const separator = doc.createElement('span');
        separator.classList.add('resource-drum-separator');
        separator.textContent = digit;
        this.columns.push({digit});
        return separator;
      }
      const window = doc.createElement('span');
      window.classList.add('resource-drum-window');
      if (digitIndex++ % 2) window.classList.add('resource-drum-window--right');
      const rotor = doc.createElement('span');
      rotor.classList.add('resource-drum-rotor');
      window.append(rotor);
      const state = {digit, rotor};
      this.columns.push(state);

      const from = before[i];
      if (canRoll && digit !== from && rotor.animate) {
        const distance = ((Number(digit) - Number(from)) * direction + 10) % 10;
        // Keep long changes short; show the final consecutive faces on the way in.
        state.digits = [from];
        for (let remaining = Math.min(distance - 1, 2); remaining >= 0; remaining--) {
          state.digits.push(String((Number(digit) - remaining * direction + 10) % 10));
        }
        rotor.append(...state.digits.map((char, index) => face(doc, char, -direction * index * faceAngle)));
      } else {
        rotor.append(face(doc, digit));
      }
      return window;
    });
    this.root.replaceChildren(...elements);

    for (const state of this.columns) {
      if (!state.digits) continue;
      const {rotor, digit, digits} = state;
      const steps = digits.length - 1;
      const animation = rotor.animate([
        {transform: 'translateZ(calc(-1 * var(--resource-drum-depth))) rotateX(0deg)'},
        {transform: `translateZ(calc(-1 * var(--resource-drum-depth))) rotateX(${direction * steps * faceAngle}deg)`},
      ], {duration: 220 + steps * 75, easing: 'cubic-bezier(.32,.1,.24,1)', fill: 'forwards'});
      state.animation = animation;
      animation.onfinish = () => {
        rotor.replaceChildren(face(doc, digit));
        animation.cancel();
        state.animation = null;
      };
    }
  }
}
