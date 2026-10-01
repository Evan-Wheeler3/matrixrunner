import { el } from './dom';
import { style, applyStyle, exportStyle, PALETTES } from '../render/comic/ComicStyle';
import { CONFIG } from '../config';

/**
 * Live style tuning panel (toggle with F2). Edits the shared `style` object
 * and re-applies it; "Copy JSON" exports values to paste into config.ts.
 */

type NumKey = { [K in keyof typeof style]: (typeof style)[K] extends number ? K : never }[keyof typeof style];

interface Slider {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: Slider[] = [
  { key: 'outlineThickness', label: 'Outline thickness', min: 0, max: 4, step: 0.1 },
  { key: 'depthEdgeThreshold', label: 'Silhouette sensitivity', min: 0.005, max: 0.2, step: 0.005 },
  { key: 'normalEdgeThreshold', label: 'Crease sensitivity', min: 0.05, max: 1.5, step: 0.05 },
  { key: 'hatchSpacing', label: 'Hatch spacing (m)', min: 0.04, max: 0.3, step: 0.01 },
  { key: 'hatchStrength', label: 'Hatch darkness', min: 0, max: 1, step: 0.05 },
  { key: 'hatchThreshold1', label: 'Shadow start (dots)', min: 0.3, max: 1.3, step: 0.02 },
  { key: 'hatchThreshold2', label: 'Cross-hatch start', min: 0.1, max: 1.0, step: 0.02 },
  { key: 'halftoneSize', label: 'Halftone dot size', min: 3, max: 16, step: 1 },
  { key: 'boilFps', label: 'Line boil fps', min: 4, max: 16, step: 1 },
  { key: 'boilAmount', label: 'Line wobble', min: 0, max: 3, step: 0.1 },
  { key: 'paperGrain', label: 'Paper grain', min: 0, max: 1, step: 0.05 },
  { key: 'exposure', label: 'Exposure', min: 0.5, max: 2, step: 0.05 },
  { key: 'nightAmount', label: 'Night tone', min: 0, max: 1, step: 0.05 },
  { key: 'skyDarkness', label: 'Night sky', min: 0, max: 1, step: 0.05 },
  { key: 'fogDensity', label: 'Haze', min: 0, max: 0.04, step: 0.001 },
  { key: 'lightBands', label: 'Light bands', min: 2, max: 3, step: 1 },
  { key: 'speedLines', label: 'Speed lines', min: 0, max: 1, step: 0.05 },
];

export class StylePanel {
  readonly root: HTMLDivElement;
  private inputs = new Map<string, () => void>();

  constructor(parent: HTMLElement, private onAction: (action: 'lightning' | 'quality') => void) {
    this.root = el('div', 'style-panel');
    // Keep keystrokes in the panel from steering the runner.
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.appendChild(el('div', 'style-panel-title', 'STYLE <small>F2 hide · L lightning · P freeze</small>'));

    const pal = el('label', 'style-row');
    pal.appendChild(el('span', '', 'Palette'));
    const select = el('select');
    for (const [id, p] of Object.entries(PALETTES)) {
      const opt = el('option', '', p.label);
      opt.value = id;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      style.palette = select.value;
      applyStyle();
    });
    pal.appendChild(select);
    this.root.appendChild(pal);
    this.inputs.set('palette', () => (select.value = style.palette));

    const toggles: [string, () => boolean, (v: boolean) => void][] = [
      ['Line boil', () => style.boil, (v) => (style.boil = v)],
      ['Low quality', () => style.quality === 'low', (v) => (style.quality = v ? 'low' : 'high')],
    ];
    for (const [label, get, set] of toggles) {
      const row = el('label', 'style-row toggle');
      row.appendChild(el('span', '', label));
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = get();
      cb.addEventListener('change', () => {
        set(cb.checked);
        applyStyle();
        if (label === 'Low quality') this.onAction('quality');
      });
      row.appendChild(cb);
      this.root.appendChild(row);
      this.inputs.set(label, () => (cb.checked = get()));
    }

    for (const s of SLIDERS) {
      const row = el('label', 'style-row');
      row.appendChild(el('span', '', s.label));
      const input = el('input');
      input.type = 'range';
      input.min = String(s.min);
      input.max = String(s.max);
      input.step = String(s.step);
      const value = el('span', 'style-value');
      const sync = () => {
        input.value = String(style[s.key]);
        value.textContent = Number(style[s.key]).toFixed(s.step < 0.01 ? 3 : s.step < 1 ? 2 : 0);
      };
      input.addEventListener('input', () => {
        (style[s.key] as number) = Number(input.value);
        sync();
        applyStyle();
      });
      sync();
      row.append(input, value);
      this.root.appendChild(row);
      this.inputs.set(s.key, sync);
    }

    const buttons = el('div', 'style-buttons');
    const copy = el('button', 'btn small', 'Copy JSON');
    const out = el('textarea', 'style-json hidden');
    copy.addEventListener('click', () => {
      const json = exportStyle();
      out.value = json;
      out.classList.remove('hidden');
      out.select();
      navigator.clipboard?.writeText(json).catch(() => undefined);
    });
    const reset = el('button', 'btn small', 'Reset');
    reset.addEventListener('click', () => {
      Object.assign(style, CONFIG.style);
      applyStyle();
      for (const sync of this.inputs.values()) sync();
      this.onAction('quality');
    });
    const flash = el('button', 'btn small', 'Lightning');
    flash.addEventListener('click', () => this.onAction('lightning'));
    buttons.append(copy, reset, flash);
    this.root.append(buttons, out);
    parent.appendChild(this.root);
  }

  toggle(): void {
    this.root.classList.toggle('hidden');
  }

  destroy(): void {
    this.root.remove();
  }
}
