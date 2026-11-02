export function selectPool(pool, count = 1, rng = Math.random) {
  const available = pool.map(entry => ({ ...entry }));
  const selected = [];
  const draws = Math.min(count, available.length);
  for (let n = 0; n < draws; n++) {
    const maximum = available.reduce((max, entry) => Math.max(max, entry.weight), 0);
    const total = available.reduce((sum, entry) => sum + entry.weight / maximum, 0);
    const draw = rng();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new TypeError('Random source must return a number from 0 to less than 1');
    let ticket = draw * total;
    let index = available.length - 1;
    for (let i = 0; i < available.length; i++) {
      // A zero draw belongs to the first positive weight, even if scaling
      // an extremely small weight underflows to zero.
      if (draw === 0 && available[i].weight > 0) { index = i; break; }
      ticket -= available[i].weight / maximum;
      if (ticket < 0) { index = i; break; }
    }
    selected.push(available.splice(index, 1)[0].sequenceId);
  }
  return selected;
}

