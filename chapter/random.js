export function selectPool(pool, count = 1, rng = Math.random) {
  const available = pool.map(entry => ({ ...entry }));
  const selected = [];
  const draws = Math.min(count, available.length);
  for (let n = 0; n < draws; n++) {
    const total = available.reduce((sum, entry) => sum + entry.weight, 0);
    const draw = rng();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new TypeError('Random source must return a number from 0 to less than 1');
    let ticket = draw * total;
    let index = available.length - 1;
    for (let i = 0; i < available.length; i++) {
      ticket -= available[i].weight;
      if (ticket < 0) { index = i; break; }
    }
    selected.push(available.splice(index, 1)[0].sequenceId);
  }
  return selected;
}

