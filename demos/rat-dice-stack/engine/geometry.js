const radians = degrees => degrees * Math.PI / 180;

function dimensions(width, height, perspective) {
  if (![width, height, perspective].every(Number.isFinite) || width <= 0 || height <= 0 || perspective <= 0) {
    throw new RangeError('Card dimensions and perspective must be positive finite numbers');
  }
}

// Coordinates are relative to the untransformed card's top-left corner. CSS
// applies the rightmost rotation first, around the center of the card, before
// translating and projecting around the mount's 50% 45% perspective origin.
export function projectedBounds(pose, width, height, perspective) {
  dimensions(width, height, perspective);
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, turn = 0, turnAxis = 0, face = 0, scale = 1 } = pose;
  if (![x, y, z, rx, ry, rz, turn, turnAxis, face, scale].every(Number.isFinite)) throw new RangeError('Pose must be finite');
  const [ax, ay, az] = [rx, ry, rz].map(radians);
  const cx = Math.cos(ax), sx = Math.sin(ax);
  const cy = Math.cos(ay), sy = Math.sin(ay);
  const cz = Math.cos(az), sz = Math.sin(az);
  const at = radians(turn), aa = radians(turnAxis), af = radians(face);
  const ct = Math.cos(at), st = Math.sin(at), ca = Math.cos(aa), sa = Math.sin(aa);
  const cf = Math.cos(af), sf = Math.sin(af);
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const localX of [-width / 2, width / 2]) {
    for (const localY of [-height / 2, height / 2]) {
      // CSS: Rx Ry Rz Rz(axis) Ry(turn) Rz(-axis) Ry(face) scale.
      const faceX = scale * cf * localX, faceY = scale * localY, faceZ = -scale * sf * localX;
      const axisX = ca * faceX + sa * faceY, axisY = -sa * faceX + ca * faceY;
      const turnX = ct * axisX + st * faceZ, turnZ = -st * axisX + ct * faceZ;
      const tiltedX = ca * turnX - sa * axisY, tiltedY = sa * turnX + ca * axisY;
      const rotatedX = cz * tiltedX - sz * tiltedY;
      const rotatedY = sz * tiltedX + cz * tiltedY;
      const afterY = cy * rotatedX + sy * turnZ;
      const depthY = -sy * rotatedX + cy * turnZ;
      const finalY = cx * rotatedY - sx * depthY;
      const finalZ = sx * rotatedY + cx * depthY + z;
      if (finalZ >= perspective) throw new RangeError('Card crosses the perspective camera plane');
      const factor = perspective / (perspective - finalZ);
      const screenX = width / 2 + (afterY + x) * factor;
      const screenY = height * .45 + (height * .05 + finalY + y) * factor;
      bounds.left = Math.min(bounds.left, screenX);
      bounds.right = Math.max(bounds.right, screenX);
      bounds.top = Math.min(bounds.top, screenY);
      bounds.bottom = Math.max(bounds.bottom, screenY);
    }
  }
  return bounds;
}

// Enclose the complete 0..180-degree turn in a cylinder around its local axis,
// then rotate that cylinder with the card's shared pose. This keeps the radius
// at the card's cross-axis half-width, instead of using its full diagonal.
// The perspective interval includes all depths and both faces of that sweep.
export function turningBounds(pose, width, height, perspective) {
  dimensions(width, height, perspective);
  const { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, turnAxis = 0, scale = 1 } = pose;
  if (![x, y, z, rx, ry, rz, turnAxis, scale, pose.turn ?? 0, pose.face ?? 0].every(Number.isFinite)) {
    throw new RangeError('Pose must be finite');
  }
  const [ax, ay, az, aa] = [rx, ry, rz, turnAxis].map(radians);
  const ca = Math.cos(aa), sa = Math.sin(aa);
  const halfAxis = Math.abs(scale) * (Math.abs(sa) * width + Math.abs(ca) * height) / 2;
  const radius = Math.abs(scale) * (Math.abs(ca) * width + Math.abs(sa) * height) / 2;
  // Local axis (-sin(axis), cos(axis), 0); negative axis angles lean left at
  // the upper endpoint. Apply Rz, then Ry, then Rx, as in projectedBounds.
  const ux = -Math.sin(aa + az), uy = Math.cos(aa + az);
  const vx = Math.cos(ay) * ux, vz = -Math.sin(ay) * ux;
  const axis = [vx, Math.cos(ax) * uy - Math.sin(ax) * vz, Math.sin(ax) * uy + Math.cos(ax) * vz];
  const [extentX, extentY, extentZ] = axis.map(component =>
    Math.abs(component) * halfAxis + Math.sqrt(Math.max(0, 1 - component * component)) * radius);
  if (z + extentZ >= perspective) throw new RangeError('Turn can cross the perspective camera plane');
  const farFactor = perspective / (perspective - z + extentZ);
  const nearFactor = perspective / (perspective - z - extentZ);
  const interval = (center, extent, origin) => {
    const low = center - extent, high = center + extent;
    return [origin + low * (low < 0 ? nearFactor : farFactor), origin + high * (high > 0 ? nearFactor : farFactor)];
  };
  const [left, right] = interval(x, extentX, width / 2);
  const [top, bottom] = interval(y + height * .05, extentY, height * .45);
  return { left, right, top, bottom };
}

// Maximum a*cos(angle)+b*sin(angle) over the permitted absolute angle.
function support(a, b, limit) {
  const angle = Math.min(limit, Math.atan2(b, a));
  return a * Math.cos(angle) + b * Math.sin(angle);
}

// A conservative minimum sufficient radius: enclose every allowed clamped
// rotation, including the pair's orbit tilt plus shared angular spring motion.
// rotateY can only reduce the horizontal span after rotateZ. The depth bound
// includes rotateY followed by rotateX. This intentionally stays valid for any
// shared rotation, so radius does not pulse as an angular spring settles.
export function handoffRadius(count, width, height, settings, rotation = { rx: 0, ry: 0, rz: 0 }) {
  dimensions(width, height, settings.perspective);
  if (!Number.isInteger(count) || count < 2) throw new RangeError('Handoff needs at least two cards');
  if (![settings.maxTilt, settings.stackDepth, rotation.rx ?? 0, rotation.ry ?? 0, rotation.rz ?? 0].every(Number.isFinite)) {
    throw new RangeError('Handoff settings and rotation must be finite');
  }
  const limit = Math.min(Math.abs(radians(settings.maxTilt)), Math.PI / 2);
  const halfX = support(width / 2, height / 2, limit);
  const halfY = support(height / 2, width / 2, limit);
  const depth = Math.sin(limit) * (halfX + halfY);
  const angle = Math.PI / count;
  const centerZ = -(1 - Math.cos(angle)) * settings.stackDepth;
  const farDenominator = settings.perspective - centerZ + depth;
  if (settings.perspective - centerZ <= depth) throw new RangeError('Tilt can cross the perspective camera plane');
  // At crossover, both centers are ±radius*sin(angle). Once all left-card
  // vertices lie left of the origin, the farthest depth gives their smallest
  // distance from it. Each side needs four projected pixels of clearance.
  return Math.max(18, (halfX + 4 * farDenominator / settings.perspective) / Math.sin(angle));
}
