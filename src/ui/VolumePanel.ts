import type { GameContext } from '../core/Game';
import type { Volumes } from '../audio/AudioEngine';
import { el } from './dom';

/** Master / music / sfx sliders, persisted to the save. */
export function buildVolumePanel(ctx: GameContext): HTMLElement {
  const panel = el('div', 'volume-panel ink-panel');
  panel.appendChild(el('div', 'panel-title', 'SOUND'));
  const volumes = ctx.save.data.settings.volumes;
  const rows: [keyof Volumes, string][] = [
    ['master', 'Master'],
    ['music', 'Music'],
    ['sfx', 'Effects'],
  ];
  for (const [key, label] of rows) {
    const row = el('label', 'volume-row');
    row.appendChild(el('span', '', label));
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(volumes[key] * 100));
    const value = el('span', 'volume-value', slider.value);
    slider.addEventListener('input', () => {
      volumes[key] = Number(slider.value) / 100;
      value.textContent = slider.value;
      ctx.audio.setVolumes(volumes);
    });
    // Persist + audible preview when the user lets go.
    slider.addEventListener('change', () => {
      ctx.save.write();
      if (key === 'sfx' || key === 'master') ctx.audio.footstep();
    });
    row.append(slider, value);
    panel.appendChild(row);
  }
  return panel;
}
