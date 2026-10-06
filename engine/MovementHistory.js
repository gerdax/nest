// A bounded, interpolated pointer/spring trajectory. Followers sample the same
// path at earlier times; retaining it across release and re-grab avoids jumps.
export class MovementHistory {
  constructor(time, value) { this.samples = [{ time, value }]; }
  record(time, value) {
    const last = this.samples.at(-1);
    if (time < last.time) return;
    if (time === last.time) last.value = value;
    else this.samples.push({ time, value });
    while (this.samples.length > 2 && this.samples[1].time < time - 500) this.samples.shift();
  }
  at(time) {
    const samples = this.samples;
    if (time <= samples[0].time) return samples[0].value;
    for (let i = 1; i < samples.length; i++) {
      if (time <= samples[i].time) {
        const a = samples[i - 1], b = samples[i];
        return a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
      }
    }
    return samples.at(-1).value;
  }
}
