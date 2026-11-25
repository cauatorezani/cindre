/**
 * BASALTE — Maison de Parfum
 * Biblioteca de grafismos e ícones SVG inline de alta precisão.
 * Stroke consistente em 1.25px com pontas arredondadas (editorial luxury).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const ICON_DEFINITIONS = {
  arrow: {
    viewBox: '0 0 20 20',
    width: 18,
    height: 18,
    markup: `
      <path d="M3.25 10H16.25" />
      <path d="M11.75 5.5L16.25 10L11.75 14.5" />
    `,
  },

  'social-fb': {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    mode: 'fill',
    markup: `
      <path d="M13.35 20.5V12.8H15.95L16.35 9.8H13.35V7.9C13.35 7.03 13.59 6.44 14.84 6.44H16.45V3.76C16.17 3.72 15.21 3.64 14.1 3.64C11.77 3.64 10.17 5.06 10.17 7.67V9.8H7.55V12.8H10.17V20.5H13.35Z" />
    `,
  },

  'social-pin': {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    mode: 'fill',
    markup: `
      <path d="M12.22 3.2C7.42 3.2 5 6.42 5 9.93C5 11.56 5.87 13.59 7.26 14.23C7.47 14.33 7.59 14.29 7.64 14.08C7.68 13.93 7.86 13.17 7.95 12.81C7.98 12.69 7.96 12.59 7.87 12.48C7.41 11.92 7.04 10.89 7.04 9.93C7.04 7.46 8.93 5.09 12.14 5.09C14.91 5.09 16.86 6.97 16.86 9.66C16.86 12.71 15.32 14.82 13.31 14.82C12.2 14.82 11.37 13.9 11.63 12.77C11.95 11.42 12.57 9.96 12.57 8.99C12.57 8.11 12.1 7.38 11.13 7.38C9.99 7.38 9.07 8.56 9.07 10.14C9.07 11.15 9.41 11.83 9.41 11.83C9.41 11.83 8.28 16.62 8.07 17.53C7.71 19.05 7.91 20.99 8 21.32C8.04 21.47 8.21 21.51 8.3 21.39C8.43 21.22 9.97 19.19 10.46 17.32C10.62 16.71 11.25 14.25 11.25 14.25C11.67 15.05 12.89 15.73 14.19 15.73C18.06 15.73 20.84 12.17 20.84 7.75C20.84 4.98 17.67 3.2 12.22 3.2Z" />
    `,
  },

  'social-ig': {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    markup: `
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.75" />
      <circle cx="12" cy="12" r="3.85" />
      <circle cx="17.15" cy="6.85" r="0.65" fill="currentColor" stroke="none" />
    `,
  },

  'social-yt': {
    viewBox: '0 0 24 24',
    width: 18,
    height: 18,
    markup: `
      <rect x="2.75" y="5.5" width="18.5" height="13" rx="3.75" />
      <path d="M10.25 9.35L15.15 12L10.25 14.65V9.35Z" />
    `,
  },

  'basalt-grain': {
    viewBox: '0 0 200 18',
    width: 200,
    height: 18,
    markup: `
      <path d="M4 9H78" opacity="0.38" />
      <path d="M122 9H196" opacity="0.38" />
      <path d="M84 9L93.5 3.5L100 6.2L107.5 3L116 9L106.5 14.75L99.5 12.2L92 14.5L84 9Z" opacity="0.82" />
      <path d="M93.5 3.5L99.5 12.2M107.5 3L100 6.2L106.5 14.75" opacity="0.45" />
    `,
  },
};

/**
 * Cria um elemento SVG inline pronto para injeção no DOM.
 * @param {string} iconName Nome do ícone definido em ICON_DEFINITIONS.
 * @returns {SVGSVGElement | null}
 */
export function createSvgIcon(iconName) {
  const key = String(iconName || '').trim().toLowerCase();
  const def = ICON_DEFINITIONS[key];
  if (!def) {
    return null;
  }

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', def.viewBox);
  svg.setAttribute('width', String(def.width));
  svg.setAttribute('height', String(def.height));
  if (def.mode === 'fill') {
    svg.setAttribute('fill', 'currentColor');
    svg.setAttribute('stroke', 'none');
  } else {
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.25');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
  }
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('basalte-svg', `basalte-svg--${key}`);
  svg.innerHTML = def.markup.trim();

  return svg;
}

/**
 * Injeta SVGs inline nítidos em todos os elementos [data-svg-icon].
 * É idempotente e segura para múltiplas invocações.
 * @param {ParentNode} [root=document] Raiz de busca no DOM.
 * @returns {number} Quantidade de ícones montados.
 */
export function mountSvgGraphics(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') {
    return 0;
  }

  const slots = root.querySelectorAll('[data-svg-icon]');
  let mountedCount = 0;

  slots.forEach((slot) => {
    const iconName = (slot.getAttribute('data-svg-icon') || '').trim().toLowerCase();
    if (!iconName) return;

    if (slot.dataset.svgMounted === iconName && slot.querySelector('svg')) {
      mountedCount += 1;
      return;
    }

    const svg = createSvgIcon(iconName);
    if (!svg) return;

    slot.replaceChildren(svg);
    slot.dataset.svgMounted = iconName;
    mountedCount += 1;
  });

  return mountedCount;
}

export const SVG_ICON_NAMES = Object.freeze(Object.keys(ICON_DEFINITIONS));
export default mountSvgGraphics;
