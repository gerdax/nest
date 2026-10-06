export const DEFAULT_SETTINGS = Object.freeze({
  stiffness: 360,
  damping: 56,
  mass: 1.15,
  maxTilt: 12,
  axisThreshold: 34,
  distanceThreshold: 0.14,
  flickVelocity: 325,
  flickDistance: 26,
  commitDuration: 210,
  perspective: 1200,
  stackDepth: 22,
  liftHeight: 56,
  angularStiffness: 350,
  angularDamping: 65,
  gravity: 800,
  revealStartScale: .915,
  revealFullScaleAt: 0.167054298371648,
  choiceStaggerMs: 30,
  flipLeadMs: 100,
  flipAxisTilt: -1
});
export function classifyAxis(x, y, threshold = DEFAULT_SETTINGS.axisThreshold) {
  return Math.hypot(x, y) < threshold ? null : Math.abs(x) > Math.abs(y) ? 'x' : 'y';
}

export function qualifies(distance, velocity, dimension, settings = DEFAULT_SETTINGS) {
  return Math.abs(distance) >= dimension * settings.distanceThreshold || (
    Math.abs(distance) >= settings.flickDistance
    && Math.abs(velocity) >= settings.flickVelocity
    && Math.sign(distance) === Math.sign(velocity)
  );
}

export function resistance(value, min, max) {
  return value < min ? min + (value - min) * 0.22 : value > max ? max + (value - max) * 0.22 : value;
}

export function springStep(s, dt, c) {
  const t = Math.max(0, Math.min(dt, 0.05)),
    error = s.x - s.target;
  const alpha = c.damping / (2 * c.mass),
    omega2 = c.stiffness / c.mass,
    discriminant = alpha * alpha - omega2;
  let e, v;
  if (Math.abs(discriminant) < 1e-6) {
    const q = s.v + alpha * error,
      decay = Math.exp(-alpha * t);
    e = (error + q * t) * decay;
    v = (s.v - alpha * q * t) * decay;
  } else if (discriminant < 0) {
    const omega = Math.sqrt(-discriminant),
      q = (s.v + alpha * error) / omega,
      co = Math.cos(omega * t),
      si = Math.sin(omega * t),
      decay = Math.exp(-alpha * t);
    e = decay * (error * co + q * si);
    v = decay * ((-alpha * error + omega * q) * co + (-alpha * q - omega * error) * si);
  } else {
    const root = Math.sqrt(discriminant),
      r1 = -omega2 / (alpha + root),
      r2 = -alpha - root,
      a = (s.v - r2 * error) / (r1 - r2),
      b = error - a;
    e = a * Math.exp(r1 * t) + b * Math.exp(r2 * t);
    v = r1 * a * Math.exp(r1 * t) + r2 * b * Math.exp(r2 * t);
  }
  s.x = s.target + e;
  s.v = v;
  const precision = c.precision ?? .001;
  if (Math.abs(s.x - s.target) < precision && Math.abs(s.v) < precision * 10) {
    s.x = s.target;
    s.v = 0;
  }
  return s.x !== s.target || s.v !== 0;
}

export function spring(x = 0) {
  return {
    x,
    v: 0,
    target: x
  };
}

export function settingsWith(patch = {}, base = DEFAULT_SETTINGS) {
  const result = {
    ...base
  };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Number.isFinite(patch[key])) {
      const min = ['maxTilt', 'liftHeight', 'gravity', 'choiceStaggerMs', 'flipLeadMs'].includes(key) ? 0 : key === 'distanceThreshold' ? 0.05 : key === 'perspective' ? 400 : key === 'flipAxisTilt' ? -10 : 0.01;
      const max = key === 'choiceStaggerMs' ? 60 : key === 'flipLeadMs' ? 100 : key === 'flipAxisTilt' ? 10 : Infinity;
      result[key] = clamp(patch[key], min, max);
      if (['revealStartScale', 'revealFullScaleAt'].includes(key)) result[key] = Math.min(1, result[key]);
    }
  }
  return result;
}


export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function revealScale(exposedPixels, height, settings = DEFAULT_SETTINGS) {
  const progress = clamp(exposedPixels / (Math.max(1, height) * settings.revealFullScaleAt), 0, 1);
  const eased = progress * progress * (3 - 2 * progress);
  return settings.revealStartScale + (1 - settings.revealStartScale) * eased;
}

export function modulo(value, count) {
  return ((value % count) + count) % count;
}

// An orbit has no seam: every physical card completes the same closed path.
export function carouselPose(index, cursor, count, width, settings = DEFAULT_SETTINGS, peakRadius = null) {
  const angle = (index - cursor) * Math.PI * 2 / count;
  const front = Math.cos(angle);
  const phase = Math.sin(cursor * Math.PI) ** 2;
  const radius = 18 + (peakRadius === null ? width * .28 : peakRadius - 18) * phase;
  // Two opposite points on a circular orbit align at rest. Give the rear
  // card the same small fan as larger sets, reducing this offset geometrically
  // during browsing so the existing crossover clearance stays unchanged.
  const rearFan = count === 2 ? (1 - front) * .5 * (1 - phase) : 0;
  return {
    x: count === 1 ? 0 : Math.sin(angle) * radius + rearFan * 18,
    y: (1 - front) * 7,
    z: -(1 - front) * settings.stackDepth,
    rx: 0,
    ry: -(Math.sin(angle) + rearFan) * settings.maxTilt * .65,
    rz: (Math.sin(angle) + rearFan) * settings.maxTilt * .3,
    front
  };
}

// A shared upward throw with gravity. All choices retain their relative poses.
export function departureDistance(motion, time) {
  const seconds = clamp((time - motion.start) / 1000, 0, motion.duration / 1000);
  return motion.velocity * seconds - .5 * motion.gravity * seconds * seconds;
}
