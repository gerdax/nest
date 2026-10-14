import { DiceService } from './DiceService.js';
const service = new DiceService().mount(document.getElementById('tray'));
const result = document.getElementById('result');
const roll = document.getElementById('roll');
document.getElementById('controls').addEventListener('submit', async event => {
  event.preventDefault();
  roll.disabled = true;
  result.textContent = 'Trwa rzut…';
  try {
    const outcome = await service.roll([{ sides: Number(document.getElementById('sides').value), count: Number(document.getElementById('count').value) }]);
    result.textContent = outcome.dice.map(die => `d${die.sides}: ${die.value}`).join(' · ');
  } catch (error) {
    result.textContent = error.name === 'AbortError' ? 'Rzut anulowany.' : error.message;
  } finally { roll.disabled = false; }
});
document.getElementById('clear').addEventListener('click', () => {
  service.clear();
  result.textContent = 'Kości wyczyszczone.';
});
window.addEventListener('pagehide', () => service.destroy(), { once: true });
