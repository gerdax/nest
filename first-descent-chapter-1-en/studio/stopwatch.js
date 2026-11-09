export function mountStopwatch(container) {
  const display = container.querySelector('[data-stopwatch-time]');
  const toggle = container.querySelector('[data-stopwatch-toggle]');
  const reset = container.querySelector('[data-stopwatch-reset]');
  let elapsed = 0;
  let startedAt = null;
  let interval;

  function render() {
    const running = startedAt !== null;
    const seconds = Math.floor((elapsed + (running ? performance.now() - startedAt : 0)) / 1000);
    const minutesText = String(Math.floor(seconds / 60)).padStart(2, '0');
    const secondsText = String(seconds % 60).padStart(2, '0');
    const time = `${minutesText}:${secondsText}`;
    if (display.textContent !== time) display.textContent = time;
  }

  function updateControls() {
    const running = startedAt !== null;
    const label = running ? 'Pause timer' : elapsed > 0 ? 'Resume timer' : 'Start timer';
    toggle.textContent = running ? '⏸' : '▶';
    toggle.title = label;
    toggle.setAttribute('aria-label', label);
    render();
  }

  toggle.addEventListener('click', () => {
    if (startedAt === null) {
      startedAt = performance.now();
      interval = setInterval(render, 100);
    } else {
      elapsed += performance.now() - startedAt;
      startedAt = null;
      clearInterval(interval);
    }
    updateControls();
  });

  reset.addEventListener('click', () => {
    clearInterval(interval);
    startedAt = null;
    elapsed = 0;
    updateControls();
  });
}
