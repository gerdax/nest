import test from 'node:test';
import assert from 'node:assert/strict';
import { projectedBounds, handoffRadius } from '../engine/geometry.js';

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
});
