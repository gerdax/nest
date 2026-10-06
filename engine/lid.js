import { clamp } from './motion.js?v=container-lid-7';

const ease = value => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

// Keep CSS's center origin and compensate its translation. Rotating the
// center around the top edge is exactly a rigid top-edge hinge, and uses the
// same pose as projectedBounds rather than a separate rendering-only origin.
export function topEdgeHinge(pose, height, angle) {
  if (!angle) return { ...pose };
  const initial = pose.rx * Math.PI / 180;
  const radians = initial + angle * Math.PI / 180;
  return { ...pose, rx: pose.rx + angle,
    y: pose.y + height / 2 * (Math.cos(radians) - Math.cos(initial)),
    z: pose.z + height / 2 * (Math.sin(radians) - Math.sin(initial)) };
}

// The first part follows the finger upward while hinging the stack. Once
// open, it travels above the stage. Running the same path backward closes it.
export function lidPose(pose, progress, height, travel, angle = 75) {
  const p = clamp(progress, 0, 1), hinge = ease(p / .45);
  const pickup = Math.min(120, height * .28) * clamp(p / .45, 0, 1);
  const departure = travel * ease((p - .45) / .55);
  return topEdgeHinge({ ...pose, y: pose.y - pickup - departure }, height,
    clamp(angle, 0, 85) * hinge);
}

export function openingLid(deck) {
  const owner = deck.choiceHistory
    ? deck.content.actions.find(action => deck.choiceRanks.get(action.id) === 0)
    : deck.content.actions[deck.index];
  return !deck.reduced && deck.content.interaction === 'choice'
    && !owner?.disabled && owner?.transition === 'lid';
}
