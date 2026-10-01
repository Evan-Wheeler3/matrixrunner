/** Tiny DOM helpers so UI code stays declarative without a framework. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** A full-screen UI layer owned by one state. */
export class Screen {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, className: string) {
    this.root = el('div', `screen ${className}`);
    parent.appendChild(this.root);
  }

  destroy(): void {
    this.root.remove();
  }
}
