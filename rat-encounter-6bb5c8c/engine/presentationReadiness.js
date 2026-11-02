/** Visual milestones do not unlock input or complete gameplay transitions.
 * Position limits are pixels, angle limits are degrees, speeds are per second.
 * Fan progress is dimensionless. Both residual and speed must be small.
 */
export const DEFAULT_PRESENTATION_POLICY = Object.freeze({
  position: 2, positionSpeed: 20,
  angle: 4, angleSpeed: 40,
  fan: .05, fanSpeed: .5,
  exposureFan: .35, exposureAngle: 45,
});

/** The front face is exposed; it need not yet be nearly stationary. */
export function itemsExposed(exposure, policy = DEFAULT_PRESENTATION_POLICY) {
  return !!exposure && Number.isFinite(exposure.fan) && Number.isFinite(exposure.angle)
    && exposure.fan >= policy.exposureFan && Math.abs(exposure.angle) <= policy.exposureAngle;
}

export function withinVisualTolerance({ state, kind = 'position', scale = 1 }, policy = DEFAULT_PRESENTATION_POLICY) {
  return Math.abs(state.x - state.target) * scale <= policy[kind]
    && Math.abs(state.v) * scale <= policy[`${kind}Speed`];
}

/** Per-presentation, latched signals; consumers can attach after the milestone. */
export class PresentationReadiness {
  constructor(policy = {}) {
    this.policy = { ...DEFAULT_PRESENTATION_POLICY };
    for (const key of Object.keys(this.policy)) {
      if (Number.isFinite(policy[key]) && policy[key] >= 0) this.policy[key] = policy[key];
    }
    this.policy.exposureFan = Math.min(1, this.policy.exposureFan);
    this.policy.exposureAngle = Math.min(89, this.policy.exposureAngle);
    this.revision = null;
    this.visualReady = false;
    this.itemsExposed = false;
    this.fullySettled = false;
  }
  update({ revision, eligible, motions, settlementMotions = motions, canSettle = true, preserveEstablished = false, exposure = null }) {
    if (revision !== this.revision) {
      this.revision = revision;
      this.visualReady = preserveEstablished && this.visualReady;
      this.itemsExposed = preserveEstablished && this.itemsExposed;
      this.fullySettled = false;
    }
    if (eligible) {
      this.itemsExposed ||= itemsExposed(exposure, this.policy);
      this.visualReady ||= motions.every(motion => withinVisualTolerance(motion, this.policy));
      this.fullySettled ||= canSettle && settlementMotions.every(({ state }) => state.x === state.target && state.v === 0);
    }
    return { revision, eligible, itemsExposed: this.itemsExposed, visualReady: this.visualReady, fullySettled: this.fullySettled };
  }
}
