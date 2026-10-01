import { el } from './dom';

/**
 * Comic-book effects drawn as DOM/SVG over the canvas: jagged impact bursts
 * and onomatopoeia ("THUD!", "SPLSH!") in hand-lettered style.
 */

export interface PopOptions {
  /** Burst fill color (CSS). */
  color?: string;
  /** Font size in px. */
  size?: number;
  /** Draw the spiky starburst behind the word. */
  burst?: boolean;
  /** Tilt in degrees (random if omitted). */
  tilt?: number;
}

export class ComicFX {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'comic-fx');
    parent.appendChild(this.root);
  }

  /** Pop a word at screen position (CSS px). Removes itself after its animation. */
  pop(word: string, x: number, y: number, opts: PopOptions = {}): void {
    const size = opts.size ?? 44;
    const tilt = opts.tilt ?? (Math.random() * 24 - 12);
    const node = el('div', 'comic-pop');
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.setProperty('--tilt', `${tilt}deg`);
    if (opts.burst !== false) node.appendChild(this.burst(size * 3.2, opts.color ?? '#f7c948'));
    const text = el('span', 'comic-word', word);
    text.style.fontSize = `${size}px`;
    node.appendChild(text);
    this.root.appendChild(node);
    window.setTimeout(() => node.remove(), 900);
  }

  private burst(diameter: number, color: string): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '-50 -50 100 100');
    svg.setAttribute('width', String(diameter));
    svg.setAttribute('height', String(diameter * 0.75));
    svg.classList.add('comic-burst');
    const spikes = 13;
    const pts: string[] = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 44 + Math.random() * 6 : 22 + Math.random() * 8;
      pts.push(`${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`);
    }
    const poly = document.createElementNS(ns, 'polygon');
    poly.setAttribute('points', pts.join(' '));
    poly.setAttribute('fill', color);
    poly.setAttribute('stroke', '#16171c');
    poly.setAttribute('stroke-width', '3.5');
    poly.setAttribute('stroke-linejoin', 'miter');
    svg.appendChild(poly);
    return svg;
  }

  destroy(): void {
    this.root.remove();
  }
}
