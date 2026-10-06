import test from 'node:test';
import assert from 'node:assert/strict';
import { projectedBounds, turningBounds, handoffRadius } from '../engine/geometry.js';

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`);
}

test('unrotated projection respects center and 50% 45% perspective origin', () => {
  assert.deepEqual(projectedBounds({}, 200, 300, 1000), { left: 0, right: 200, top: 0, bottom: 300 });
  const bounds = projectedBounds({ x: 20, y: -10, z: 100 }, 200, 300, 1000);
  close(bounds.left, 100 - 80 * 10 / 9);
  close(bounds.right, 100 + 120 * 10 / 9);
  close(bounds.top, 135 - 145 * 10 / 9);
  close(bounds.bottom, 135 + 155 * 10 / 9);
});

test('scale occurs before rotations and rotations use centered CSS order', () => {
  const quarterTurn = projectedBounds({ rz: 90, scale: 2 }, 200, 100, 1000);
  close(quarterTurn.left, 0); close(quarterTurn.right, 200);
  close(quarterTurn.top, -150); close(quarterTurn.bottom, 250);
  // Z first swaps the long axis into Y; X then moves it into depth, leaving
  // the horizontal axis at ±50 and the vertical axis on the center line.
  const crossed = projectedBounds({ rz: 90, rx: 90 }, 200, 100, 1000);
  close(crossed.left, 100 - 50 * 1000 / 900);
  close(crossed.right, 100 + 50 * 1000 / 900);
  close(crossed.top, 45 + 5 * 1000 / 1100);
  close(crossed.bottom, 45 + 5 * 1000 / 900);
});

test('Y rotation foreshortens the horizontal span with opposite depth at each edge', () => {
  const result = projectedBounds({ ry: 45 }, 200, 100, 1000);
  const extent = 100 / Math.sqrt(2);
  close(result.left, 100 - extent * 1000 / (1000 - extent));
  close(result.right, 100 + extent * 1000 / (1000 + extent));
  close(result.top, 45 - 45 * 1000 / (1000 - extent));
  close(result.bottom, 45 + 55 * 1000 / (1000 - extent));
});

test('a tilted quarter turn projects onto the left-leaning axis, with depth at each corner', () => {
  const angle = -3 * Math.PI / 180;
  const sine = Math.sin(angle), cosine = Math.cos(angle);
  const xs = [], ys = [];
  for (const x of [-100, 100]) for (const y of [-150, 150]) {
    const alongAxis = -sine * x + cosine * y;
    const depth = -(cosine * x + sine * y);
    const factor = 1000 / (1000 - depth);
    xs.push(100 - sine * alongAxis * factor);
    ys.push(135 + (15 + cosine * alongAxis) * factor);
  }
  const bounds = projectedBounds({ turn: 90, turnAxis: -3 }, 200, 300, 1000);
  close(bounds.left, Math.min(...xs)); close(bounds.right, Math.max(...xs));
  close(bounds.top, Math.min(...ys)); close(bounds.bottom, Math.max(...ys));
  assert.ok(Math.min(...xs) < 100 && Math.max(...xs) > 100);
  // The upper endpoint is left of center, confirming the angle convention.
  assert.ok(100 + sine * 150 < 100);
});

test('projection follows the complete noncommuting CSS rotation sequence', () => {
  const pose = { x: 17, y: -21, z: 34, rx: 11, ry: -13, rz: 7, turnAxis: -3, turn: 67, face: 180, scale: .91 };
  const rotate = ([x, y, z], axis, degrees) => {
    const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    if (axis === 'x') return [x, c * y - s * z, s * y + c * z];
    if (axis === 'y') return [c * x + s * z, y, -s * x + c * z];
    return [c * x - s * y, s * x + c * y, z];
  };
  const projected = [];
  for (const x of [-100, 100]) for (const y of [-150, 150]) {
    let point = [x * pose.scale, y * pose.scale, 0];
    for (const [axis, degrees] of [['y', pose.face], ['z', -pose.turnAxis], ['y', pose.turn], ['z', pose.turnAxis], ['z', pose.rz], ['y', pose.ry], ['x', pose.rx]]) {
      point = rotate(point, axis, degrees);
    }
    const factor = 1000 / (1000 - point[2] - pose.z);
    projected.push([100 + (point[0] + pose.x) * factor, 135 + (15 + point[1] + pose.y) * factor]);
  }
  const bounds = projectedBounds(pose, 200, 300, 1000);
  close(bounds.left, Math.min(...projected.map(p => p[0])));
  close(bounds.right, Math.max(...projected.map(p => p[0])));
  close(bounds.top, Math.min(...projected.map(p => p[1])));
  close(bounds.bottom, Math.max(...projected.map(p => p[1])));
});

test('front and reverse faces have coincident bounds throughout the tilted turn', () => {
  for (const turn of [0, 29, 90, 137, 180]) {
    const pose = { x: -40, y: 7, z: -20, rx: 9, ry: -6, rz: 11, turnAxis: -3, turn, scale: 1.2 };
    const front = projectedBounds(pose, 200, 300, 1000);
    const back = projectedBounds({ ...pose, face: 180 }, 200, 300, 1000);
    for (const edge of ['left', 'right', 'top', 'bottom']) close(front[edge], back[edge]);
  }
});

test('full-turn cylinder envelope contains every sampled tilted plane and both faces', () => {
  for (const turnAxis of [-27, -3, 0, 18]) for (const scale of [.7, 1, -1]) {
    for (const position of [{ x: 0, y: 0 }, { x: 340, y: -420 }, { x: -310, y: 370 }]) {
      const pose = { ...position, z: -30, rx: 18, ry: -13, rz: 9, turnAxis, scale };
      const envelope = turningBounds(pose, 200, 300, 650);
      for (let turn = 0; turn <= 180; turn += 2) for (const face of [0, 180]) {
        const bounds = projectedBounds({ ...pose, turn, face }, 200, 300, 650);
        assert.ok(bounds.left >= envelope.left - 1e-8 && bounds.right <= envelope.right + 1e-8);
        assert.ok(bounds.top >= envelope.top - 1e-8 && bounds.bottom <= envelope.bottom + 1e-8);
      }
    }
  }
  // An upright sweep's depth radius is half the width, not half the diagonal.
  const upright = turningBounds({}, 200, 300, 1000);
  close(upright.left, 100 - 100 * 1000 / 900);
  close(upright.right, 100 + 100 * 1000 / 900);
  close(upright.top, 135 - 135 * 1000 / 900);
  close(upright.bottom, 135 + 165 * 1000 / 900);
});

const clamp = (value, tilt) => Math.max(-tilt, Math.min(tilt, value));
function pair(count, radius, settings, rotation) {
  return [-1, 1].map(side => {
    const angle = side * Math.PI / count;
    const front = Math.cos(angle);
    return {
      x: Math.sin(angle) * radius, y: (1 - front) * 7, z: -(1 - front) * settings.stackDepth,
      rx: clamp(rotation.rx, settings.maxTilt),
      ry: clamp(-Math.sin(angle) * settings.maxTilt * .65 + rotation.ry, settings.maxTilt),
      rz: clamp(Math.sin(angle) * settings.maxTilt * .3 + rotation.rz, settings.maxTilt)
    };
  });
}

for (const count of [2, 3, 4]) {
  test(`${count} cards have at least an eight-pixel crossover gap at tuning extremes`, () => {
    for (const width of [249, 340]) {
      const height = width * 4 / 3;
      for (const perspective of [650, 1000, 1600]) for (const maxTilt of [0, 6, 18]) for (const stackDepth of [0, 10, 30]) {
        const settings = { perspective, maxTilt, stackDepth };
        for (const rx of [-maxTilt, 0, maxTilt]) for (const ry of [-maxTilt, 0, maxTilt]) for (const rz of [-maxTilt, 0, maxTilt]) {
          const rotation = { rx, ry, rz };
          const radius = handoffRadius(count, width, height, settings, rotation);
          assert.ok(Number.isFinite(radius) && radius >= 18);
          const [left, right] = pair(count, radius, settings, rotation).map(pose => projectedBounds(pose, width, height, perspective));
          assert.ok(right.left - left.right >= 8 - 1e-8, `Gap ${right.left - left.right}: ${JSON.stringify({ count, width, settings, rotation })}`);
        }
      }
    }
  });
}

test('invalid dimensions and camera-plane crossings fail explicitly', () => {
  assert.throws(() => projectedBounds({}, 0, 100, 1000), RangeError);
  assert.throws(() => projectedBounds({}, 200, 100, 0), RangeError);
  assert.throws(() => projectedBounds({ z: 1000 }, 200, 100, 1000), RangeError);
  assert.throws(() => projectedBounds({ turnAxis: NaN }, 200, 100, 1000), RangeError);
  assert.throws(() => turningBounds({ z: 900 }, 200, 300, 1000), RangeError);
  assert.throws(() => turningBounds({ turn: Infinity }, 200, 300, 1000), RangeError);
});
