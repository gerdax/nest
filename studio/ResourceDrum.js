const reducedMotion = '(prefers-reduced-motion: reduce)';
const faceAngle = 36;
const maxTicks = 100;
const restingTransform = 'translateZ(calc(-1 * var(--resource-drum-depth)))';

function displayValue(value) {
  const [integer, fraction] = String(Math.abs(value)).split('.');
  return (value < 0 ? '-' : '') + integer.padStart(2, '0') +
    (fraction === undefined ? '' : `.${fraction}`);
}

function planRoll(from, to) {
  if (!Number.isFinite(from) || (from < 0 && to > 0) || (from > 0 && to < 0)) return;
  const precision = Math.max(...[from, to].map(value => String(value).split('.')[1]?.length ?? 0));
  const scale = 10 ** precision;
  const start = Math.round(Math.abs(from) * scale);
  const end = Math.round(Math.abs(to) * scale);
  const ticks = Math.abs(end - start);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start / scale !== Math.abs(from) || end / scale !== Math.abs(to) ||
      ticks === 0 || ticks > maxTicks) return;

  const width = Math.max(precision + 2, String(start).length, String(end).length);
  const digits = String(end).padStart(width, '0');
  const unsigned = precision ? `${digits.slice(0, -precision)}.${digits.slice(-precision)}` : digits;
  return {
    start, scale, ticks, width,
    direction: Math.sign(end - start),
    sign: from < 0 || to < 0 ? -1 : 1,
    label: (from < 0 || to < 0 ? '-' : '') + unsigned,
    duration: Math.min(1350, 180 + ticks * 80),
  };
}

function face(doc, digit, angle = 0) {
  const element = doc.createElement('span');
  element.classList.add('resource-drum-face');
  element.textContent = digit;
  element.style.transform = `rotateX(${angle}deg) translateZ(var(--resource-drum-depth))`;
  return element;
}

function rollKeyframes({start, ticks, direction}, place) {
  let position = Math.floor(start / place);
  let angle = 0;
  const frame = (step, rotation) => ({
    offset: step / ticks,
    transform: `${restingTransform} rotateX(${rotation}deg)`,
  });
  const frames = [frame(0, angle)];
  for (let step = 1; step <= ticks; step++) {
    const nextPosition = Math.floor((start + direction * step) / place);
    if (nextPosition === position) continue;
    // Higher places stay still until the lower wheels reach the carry step.
    if (frames.at(-1).offset < (step - 1) / ticks) frames.push(frame(step - 1, angle));
    // Increasing values turn the wheel downward (negative rotation around X).
    angle -= direction * faceAngle;
    frames.push(frame(step, angle));
    position = nextPosition;
  }
  if (!angle) return;
  if (frames.at(-1).offset < 1) frames.push(frame(ticks, angle));
  return frames;
}

/** Visual only: the HUD's accessible label always reports the committed value. */
export class ResourceDrum {
  constructor(root) {
    this.root = root;
    this.animations = [];
    root.classList.add('resource-drums');
    root.setAttribute('aria-hidden', 'true');
  }

  update(value) {
    if (value === this.value) return;
    const progress = this.animations[0]?.effect.getComputedTiming().progress;
    const active = this.activeRoll;
    const previous = progress == null ? this.value :
      active.sign * (active.start + active.direction * Math.round(progress * active.ticks)) / active.scale;
    this.value = value;
    this.clearRoll();

    const doc = this.root.ownerDocument;
    const label = Number.isFinite(value) ? displayValue(value) : '';
    const reduce = doc.defaultView?.matchMedia?.(reducedMotion)?.matches;
    const roll = label && !reduce ? planRoll(previous, value) : undefined;
    this.render(roll?.label ?? label, roll);

    if (this.animations.length) {
      this.activeRoll = roll;
      this.animations[0].onfinish = () => {
        this.clearRoll();
        this.render(label);
      };
    }
  }

  clearRoll() {
    for (const animation of this.animations) {
      animation.onfinish = null;
      animation.cancel();
    }
    this.animations = [];
    this.activeRoll = undefined;
  }

  render(label, roll) {
    const doc = this.root.ownerDocument;
    let digitIndex = 0;
    const moving = [];
    const elements = Array.from(label, digit => {
      if (!/\d/.test(digit)) {
        const separator = doc.createElement('span');
        separator.classList.add('resource-drum-separator');
        separator.textContent = digit;
        return separator;
      }

      const window = doc.createElement('span');
      window.classList.add('resource-drum-window');
      if (digitIndex % 2) window.classList.add('resource-drum-window--right');
      const place = roll ? 10 ** (roll.width - digitIndex - 1) : 1;
      digitIndex++;
      const rotor = doc.createElement('span');
      rotor.classList.add('resource-drum-rotor');
      window.append(rotor);

      const frames = roll && rotor.animate && rollKeyframes(roll, place);
      if (frames) {
        const first = Math.floor(roll.start / place) % 10;
        for (let i = 0; i < 10; i++) {
          rotor.append(face(doc, (first + i) % 10, i * faceAngle));
        }
        moving.push({rotor, frames});
      } else {
        rotor.append(face(doc, digit));
      }
      return window;
    });
    this.root.replaceChildren(...elements);
    for (const {rotor, frames} of moving) {
      this.animations.push(rotor.animate(frames, {duration: roll.duration, fill: 'both'}));
    }
  }
}
