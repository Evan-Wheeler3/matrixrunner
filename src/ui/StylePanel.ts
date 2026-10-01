import { el } from './dom';
import { style, applyStyle, exportStyle, GRADES } from '../render/look/LookStyle';
import { CONFIG } from '../config';

/**
 * Live style tuning panel (toggle with F2). Edits the shared `style` object
 * and re-applies it; "Copy JSON" exports values to paste into config.ts.
 */

type Style = typeof style;
type NumKey = { [K in keyof Style]: Style[K] extends number ? K : never }[keyof Style] & string;
type BoolKey = { [K in keyof Style]: Style[K] extends boolean ? K : never }[keyof Style] & string;

interface Slider {
  key: NumKey;
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: [string, Slider[]][] = [
  [
    'Light & lens',
    [
      { key: 'exposure', label: 'Exposure', min: 0.5, max: 3, step: 0.05 },
      { key: 'gradeAmount', label: 'Grade strength', min: 0, max: 1, step: 0.05 },
      { key: 'bloomStrength', label: 'Bloom', min: 0, max: 2.5, step: 0.05 },
      { key: 'bloomRadius', label: 'Bloom radius', min: 0, max: 1, step: 0.05 },
      { key: 'bloomThreshold', label: 'Bloom threshold', min: 0, max: 2, step: 0.05 },
      { key: 'fogDensity', label: 'Haze', min: 0, max: 0.05, step: 0.001 },
      { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05 },
      { key: 'filmGrain', label: 'Film grain', min: 0, max: 0.2, step: 0.005 },
      { key: 'chromaticAberration', label: 'Chromatic aberration', min: 0, max: 0.01, step: 0.0005 },
      { key: 'lensRain', label: 'Lens rain', min: 0, max: 1, step: 0.05 },
    ],
  ],
  [
    'Wet street',
    [
      { key: 'reflections', label: 'Reflections', min: 0, max: 1.5, step: 0.05 },
      { key: 'wetness', label: 'Wetness', min: 0, max: 1, step: 0.05 },
    ],
  ],
  [
    'Graphic novel',
    [
      { key: 'inkLines', label: 'Ink lines', min: 0, max: 1, step: 0.05 },
      { key: 'outlineThickness', label: 'Line thickness', min: 0.5, max: 4, step: 0.1 },
      { key: 'depthEdgeThreshold', label: 'Silhouette sensitivity', min: 0.005, max: 0.2, step: 0.005 },
      { key: 'normalEdgeThreshold', label: 'Crease sensitivity', min: 0.1, max: 3, step: 0.05 },
      { key: 'rimLight', label: 'Character rim light', min: 0, max: 1.5, step: 0.05 },
      { key: 'hatchStrength', label: 'Shadow hatching', min: 0, max: 1, step: 0.05 },
      { key: 'hatchSpacing', label: 'Hatch spacing (m)', min: 0.03, max: 0.25, step: 0.005 },
      { key: 'hatchThreshold', label: 'Hatch shadow level', min: 0.05, max: 1, step: 0.01 },
      { key: 'speedLines', label: 'Speed lines', min: 0, max: 1, step: 0.05 },
      { key: 'boilAmount', label: 'Line wobble', min: 0, max: 3, step: 0.1 },
    ],
  ],
];

const TOGGLES: [BoolKey | 'lowQuality', string][] = [
  ['shadows', 'Shadows'],
  ['comicFx', 'Impact lettering'],
  ['boil', 'Line boil'],
  ['lowQuality', 'Low quality'],
];

export class StylePanel {
  readonly root: HTMLDivElement;
  private syncers: (() => void)[] = [];

  constructor(parent: HTMLElement, private onAction: (action: 'lightning' | 'quality') => void) {
    this.root = el('div', 'style-panel');
    this.root.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.appendChild(el('div', 'style-panel-title', 'LOOK <small>F2 hide · L lightning · P freeze</small>'));

    const gradeRow = el('label', 'style-row');
    gradeRow.appendChild(el('span', '', 'Grade'));
    const select = el('select');
    for (const [id, g] of Object.entries(GRADES)) {
      const opt = el('option', '', g.label);
      opt.value = id;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      style.grade = select.value;
      applyStyle();
    });
    gradeRow.appendChild(select);
    this.root.appendChild(gradeRow);
    this.syncers.push(() => (select.value = style.grade));

    for (const [key, label] of TOGGLES) {
      const row = el('label', 'style-row toggle');
      row.appendChild(el('span', '', label));
      const cb = el('input');
      cb.type = 'checkbox';
      const get = () => (key === 'lowQuality' ? style.quality === 'low' : style[key]);
      cb.checked = get();
      cb.addEventListener('change', () => {
        if (key === 'lowQuality') style.quality = cb.checked ? 'low' : 'high';
        else style[key] = cb.checked;
        applyStyle();
        if (key === 'lowQuality') this.onAction('quality');
      });
      row.appendChild(cb);
      this.root.appendChild(row);
      this.syncers.push(() => (cb.checked = get()));
    }

    for (const [group, sliders] of SLIDERS) {
      this.root.appendChild(el('div', 'style-group', group));
      for (const s of sliders) {
        const row = el('label', 'style-row');
        row.appendChild(el('span', '', s.label));
        const input = el('input');
        input.type = 'range';
        input.min = String(s.min);
        input.max = String(s.max);
        input.step = String(s.step);
        const value = el('span', 'style-value');
        const decimals = s.step < 0.001 ? 4 : s.step < 0.01 ? 3 : s.step < 1 ? 2 : 0;
        const sync = () => {
          input.value = String(style[s.key]);
          value.textContent = Number(style[s.key]).toFixed(decimals);
        };
        input.addEventListener('input', () => {
          style[s.key] = Number(input.value);
          sync();
          applyStyle();
        });
        sync();
        row.append(input, value);
        this.root.appendChild(row);
        this.syncers.push(sync);
      }
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
      for (const sync of this.syncers) sync();
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
