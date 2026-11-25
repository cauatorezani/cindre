/**
 * CINDRE — Maison de Parfum · Paris
 * Engine WebGL/GLSL de Tipografia Líquida Unificada (`[data-glsl-text]`)
 *
 * Sincronizado ao mesmo `FluidField` compartilhado de `fluid-field.js`:
 * - Quando o ponteiro move sobre o fundo basalto ou sobre um texto, a mesma onda física
 *   propaga-se continuamente pelo fundo e atravessa as letras na direção e instante exatos.
 * - Único contexto WebGL compartilhado (`#glsl-text-canvas`, WebGL2 com fallback WebGL1).
 * - Loop demand-driven: 0 draw calls e rAF suspenso quando `fluidField.isIdle()` e sem
 *   transições de reveal ativas.
 * - Rasterização HiDPI subpixel-exact via Range/TreeWalker + proteção total da Hero
 *   (`#cindre-root, #hero-slot, [data-hero-intact]`).
 * - Integração nativa com `scroll-choreography.js` (`setReveal(el, 0..1)` e `pulse(el, strength)`).
 */

import { getSharedFluidField } from './fluid-field.js';

const STYLE_ELEMENT_ID = 'basalte-glsl-text-styles';
const CANVAS_ELEMENT_ID = 'glsl-text-canvas';
const MAX_CACHED_TEXTURES = 64;
const ENERGY_EPSILON = 0.002;
const FLUID_RECT_THRESHOLD = 0.015;
const REVEAL_FULL_THRESHOLD = 0.996;
const REVEAL_ZERO_THRESHOLD = 0.002;

const DEFAULT_OPTIONS = Object.freeze({
  selector: '[data-glsl-text]',
  excludeSelector: '#cindre-root, #hero-slot, [data-hero-intact]',
  lowerSelector: '.cindre-lower, .basalte-lower, #cindre-footer, #basalte-footer',
  zIndex: 35,
  maxDpr: 2,
  distortionStrength: 1.0,
  chromaStrength: 1.0,
  specularStrength: 1.0,
  dissolveStrength: 1.0,
  prewarmVisible: true,
  respectReducedMotion: true,
});

// ---------------------------------------------------------------------------
// Shaders GLSL Unificados com `uFluidMap` (WebGL1 & WebGL2)
// ---------------------------------------------------------------------------

const VERTEX_SHADER_SOURCE = /* glsl */ `
  precision highp float;

  attribute vec2 aPos;

  uniform vec4 uRect;      // x, y, width, height em CSS px (incluindo bleed)
  uniform vec2 uViewport;  // width, height da viewport em CSS px

  varying vec2 vUv;

  void main() {
    vec2 px = uRect.xy + aPos * uRect.zw;
    vec2 ndc = (px / max(uViewport, vec2(1.0))) * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
    vUv = aPos;
  }
`;

const FRAGMENT_SHADER_SOURCE = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uTexture;
  uniform sampler2D uFluidMap;
  uniform vec2 uViewportPx;    // tamanho real do framebuffer em pixels
  uniform vec2 uTexSize;       // tamanho do quad em CSS px
  uniform vec2 uPadUv;         // proporcao de bleed nas bordas (padX/w, padY/h)
  uniform float uTime;
  uniform float uReveal;       // [0..1] entrada/saida bidirecional (ScrollTrigger)
  uniform float uOpacity;      // opacidade computada do elemento DOM
  uniform vec4 uConfig;        // x = pxDisplacement, y = chroma, z = specular, w = dissolve

  // Simplex Noise 2D compacto (usado apenas durante transicoes uReveal < 1)
  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(
      0.211324865405187,
      0.366025403784439,
      -0.577350269189626,
      0.024390243902439
    );
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  vec4 sampleSafe(vec2 uv) {
    vec2 clamped = clamp(uv, vec2(0.0), vec2(1.0));
    float inside =
      step(0.0, uv.x) * step(uv.x, 1.0) *
      step(0.0, uv.y) * step(uv.y, 1.0);
    return texture2D(uTexture, clamped) * inside;
  }

  void main() {
    if (uOpacity <= 0.001 || uReveal <= 0.001) {
      discard;
    }

    float revealWave = 1.0 - clamp(uReveal, 0.0, 1.0);

    // Amostra o MESMO FluidField compartilhado nas coordenadas exatas de tela
    vec2 screenUv = vec2(
      gl_FragCoord.x / max(uViewportPx.x, 1.0),
      1.0 - gl_FragCoord.y / max(uViewportPx.y, 1.0)
    );
    vec4 f = texture2D(uFluidMap, screenUv);
    vec2 grad = (f.rg - vec2(128.0 / 255.0)) * (255.0 / 127.0);
    float crest = f.b;
    float active = f.a;
    float gradLen = length(grad);

    // Convergencia matematica exata ao estado 100% nitido quando a onda dissipa
    if (revealWave <= 0.0005 && active <= 0.008 && crest <= 0.008 && gradLen <= 0.012) {
      vec4 crisp = texture2D(uTexture, vUv);
      gl_FragColor = crisp * uOpacity;
      return;
    }

    // Atenuacao suave apenas nas margens extremas do bleed para nunca clippar
    vec2 edgeMargin = max(uPadUv * 0.38, vec2(0.012));
    float edgeFade =
      smoothstep(0.0, edgeMargin.x, vUv.x) *
      smoothstep(0.0, edgeMargin.x, 1.0 - vUv.x) *
      smoothstep(0.0, edgeMargin.y, vUv.y) *
      smoothstep(0.0, edgeMargin.y, 1.0 - vUv.y);

    // Converte deslocamento fisico em pixels (calibrado por fontSize) para UV do quad
    vec2 pxToUv = 1.0 / max(uTexSize, vec2(1.0));
    float pxAmplitude = uConfig.x;
    vec2 fluidDispPx = grad * pxAmplitude;

    // Onda suave durante entrada/saida bidirecional do ScrollTrigger
    float revNoise = 0.0;
    vec2 revealDispPx = vec2(0.0);
    if (revealWave > 0.001) {
      float aspectRatio = clamp(uTexSize.x / max(uTexSize.y, 1.0), 0.35, 14.0);
      vec2 revCoord = vUv * vec2(aspectRatio, 1.0) * 2.2 + vec2(uTime * 0.25, -uTime * 0.48);
      revNoise = snoise(revCoord);
      float revWave = sin(vUv.y * 14.0 - uTime * 3.0 + revNoise * 2.2);
      revealDispPx = vec2(revNoise * 0.65, revWave * 0.85 + 0.55) * revealWave * (pxAmplitude * 0.85);
    }

    vec2 totalDispPx = (fluidDispPx + revealDispPx) * edgeFade;
    float maxPx = pxAmplitude * 1.15;
    totalDispPx = clamp(totalDispPx, vec2(-maxPx), vec2(maxPx));
    vec2 displacement = totalDispPx * pxToUv;
    vec2 uvBase = vUv + displacement;

    float waveIntensity = clamp(max(max(active, crest), gradLen * 0.85) + revealWave * 0.75, 0.0, 1.0);

    // Micro-difusao fluida direcional na direcao exata do gradiente da onda
    vec2 flowDirPx = normalize(totalDispPx + vec2(0.0001, 0.0001));
    vec2 orthoDirPx = vec2(-flowDirPx.y, flowDirPx.x);

    float dissolvePx = waveIntensity * (pxAmplitude * 0.20) * uConfig.w;
    vec2 flowUv = flowDirPx * dissolvePx * pxToUv;
    vec2 orthoUv = orthoDirPx * (dissolvePx * 0.6) * pxToUv;

    // Aberracao cromatica refrativa delicada proporcional ao deslocamento real
    float chromaPx = clamp(length(totalDispPx) * 0.14, 0.0, 1.65) * uConfig.y;
    vec2 chromaUv = flowDirPx * chromaPx * pxToUv;

    vec4 sCenter = sampleSafe(uvBase);
    vec4 sR = sampleSafe(uvBase + chromaUv);
    vec4 sB = sampleSafe(uvBase - chromaUv);

    vec4 sFlow1 = sampleSafe(uvBase + flowUv);
    vec4 sFlow2 = sampleSafe(uvBase - flowUv);
    vec4 sFlow3 = sampleSafe(uvBase + orthoUv);
    vec4 sFlow4 = sampleSafe(uvBase - orthoUv);

    vec4 diffused =
      sCenter * 0.42 +
      (sFlow1 + sFlow2) * 0.19 +
      (sFlow3 + sFlow4) * 0.10;

    float dissolveMix = smoothstep(0.14, 0.94, waveIntensity) * 0.44 * uConfig.w;
    vec4 refracted = vec4(
      mix(sCenter.r, sR.r, 0.68),
      sCenter.g,
      mix(sCenter.b, sB.b, 0.68),
      max(sCenter.a, max(sR.a, sB.a) * 0.82)
    );
    vec4 finalSample = mix(refracted, diffused, dissolveMix);

    float alpha = clamp(finalSample.a, 0.0, 1.0);
    if (alpha <= 0.002) {
      discard;
    }

    vec3 rgb = finalSample.rgb / max(alpha, 0.002);

    // Brilho especular fino da MESMA crista de onda sobre os tracos da letra
    vec3 normal = normalize(vec3(-grad * 0.50, 1.0));
    vec3 lightDir = normalize(vec3(-0.34, -0.58, 0.74));
    vec3 halfVec = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(normal, halfVec), 0.0), 22.0);

    float crestGlint = pow(max(crest, 0.0), 1.45) * 0.26 + spec * crest * 0.24;
    vec3 mineralTint = vec3(0.92, 0.94, 0.98);
    rgb += mineralTint * crestGlint * uConfig.z;

    // Mascara fluida de entrada/saida no scroll
    float revealMask = 1.0;
    if (revealWave > 0.001) {
      float organicSweep = smoothstep(
        (1.0 - vUv.y) * 0.55 - 0.18 + revNoise * 0.16,
        (1.0 - vUv.y) * 0.55 + 0.28 + revNoise * 0.16,
        uReveal * 1.16
      );
      revealMask = smoothstep(0.0, 0.16, uReveal) * mix(uReveal, organicSweep, 0.45);
    }

    float liquidAlpha = alpha * (1.0 - 0.10 * waveIntensity * uConfig.w) * revealMask;
    float outAlpha = clamp(liquidAlpha * uOpacity, 0.0, 1.0);

    gl_FragColor = vec4(rgb * outAlpha, outAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Utilitários de estilo, tipografia, fluido e WebGL
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function injectStylesOnce() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
    #${CANVAS_ELEMENT_ID} {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      display: block;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      contain: strict;
    }

    [data-glsl-text][data-glsl-rendering="true"],
    [data-glsl-text][data-glsl-rendering="true"] *:not(svg):not(svg *),
    [data-glsl-text][data-glsl-hidden="true"],
    [data-glsl-text][data-glsl-hidden="true"] *:not(svg):not(svg *) {
      color: transparent;
      -webkit-text-fill-color: transparent;
      text-shadow: none;
    }

    [data-glsl-text][data-glsl-rendering="true"]::selection,
    [data-glsl-text][data-glsl-rendering="true"] *::selection {
      color: #f4efe6;
      -webkit-text-fill-color: #f4efe6;
      background: rgba(212, 175, 106, 0.28);
    }
  `;
  document.head.appendChild(style);
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    console.error('[glsl-text] Erro de compilação GLSL:', log);
    return null;
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vert || !frag) {
    if (vert) gl.deleteShader(vert);
    if (frag) gl.deleteShader(frag);
    return null;
  }

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    return null;
  }

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    console.error('[glsl-text] Erro de linkagem GLSL:', log);
    return null;
  }

  return program;
}

function applyTextTransform(str, transform) {
  if (!str) return '';
  switch (transform) {
    case 'uppercase':
      return str.toUpperCase();
    case 'lowercase':
      return str.toLowerCase();
    case 'capitalize':
      return str.replace(/\b(\p{L})/gu, (match) => match.toUpperCase());
    default:
      return str;
  }
}

function parseLetterSpacing(value, fontSize) {
  if (!value || value === 'normal') return 0;
  if (value.endsWith('px')) return parseFloat(value) || 0;
  if (value.endsWith('em')) return (parseFloat(value) || 0) * fontSize;
  return parseFloat(value) || 0;
}

function drawTextRun(ctx, text, x, y, letterSpacingPx) {
  if (!text) return;

  if (Math.abs(letterSpacingPx) < 0.05) {
    ctx.fillText(text, x, y);
    return;
  }

  if ('letterSpacing' in ctx) {
    ctx.letterSpacing = `${letterSpacingPx}px`;
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
    return;
  }

  let cursorX = x;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    ctx.fillText(ch, cursorX, y);
    cursorX += ctx.measureText(ch).width + letterSpacingPx;
  }
}

function isInsideIgnoredElement(node, rootEl) {
  let parent = node.parentElement;
  while (parent && parent !== rootEl) {
    const tag = parent.tagName;
    if (tag === 'SVG' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
      return true;
    }
    if (parent.closest && parent.closest('svg')) {
      return true;
    }
    parent = parent.parentElement;
  }
  return false;
}

function extractVisualTextRuns(el, elRect) {
  const runs = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();

  let textNode;
  while ((textNode = walker.nextNode())) {
    const raw = textNode.nodeValue;
    if (!raw || !raw.trim()) continue;
    if (isInsideIgnoredElement(textNode, el)) continue;

    const parent = textNode.parentElement || el;
    const computed = window.getComputedStyle(parent);
    if (computed.visibility === 'hidden' || computed.display === 'none') continue;

    const style = {
      color: computed.color,
      fontSize: computed.fontSize,
      fontStyle: computed.fontStyle,
      fontWeight: computed.fontWeight,
      fontFamily: computed.fontFamily,
      letterSpacing: computed.letterSpacing,
      textTransform: computed.textTransform,
    };

    range.selectNodeContents(textNode);
    const clientRects = range.getClientRects();
    if (!clientRects || clientRects.length === 0) continue;

    if (clientRects.length === 1) {
      const rect = clientRects[0];
      if (rect.width > 0 && rect.height > 0) {
        const cleaned = raw.replace(/\s+/g, ' ');
        const trimmed = cleaned.trim();
        if (trimmed) {
          const leadSpaces = raw.length - raw.trimStart().length;
          const trailSpaces = raw.length - raw.trimEnd().length;
          const startIdx = Math.min(leadSpaces, raw.length);
          const endIdx = Math.max(startIdx, raw.length - trailSpaces);
          range.setStart(textNode, startIdx);
          range.setEnd(textNode, endIdx);
          const tightRect = range.getBoundingClientRect();

          runs.push({
            text: applyTextTransform(trimmed, style.textTransform),
            left: tightRect.left - elRect.left,
            top: tightRect.top - elRect.top,
            width: tightRect.width,
            height: tightRect.height,
            style,
          });
        }
      }
      continue;
    }

    const tokenRegex = /\S+/g;
    let match;
    let currentLine = null;

    while ((match = tokenRegex.exec(raw)) !== null) {
      const wStart = match.index;
      const wEnd = wStart + match[0].length;
      range.setStart(textNode, wStart);
      range.setEnd(textNode, wEnd);
      const wordRect = range.getBoundingClientRect();
      if (wordRect.width === 0 || wordRect.height === 0) continue;

      if (
        !currentLine ||
        Math.abs(wordRect.top - currentLine.rawTop) > Math.max(4, wordRect.height * 0.45) ||
        wordRect.left < currentLine.rawRight - 4
      ) {
        if (currentLine) {
          runs.push({
            text: applyTextTransform(currentLine.text, style.textTransform),
            left: currentLine.rawLeft - elRect.left,
            top: currentLine.rawTop - elRect.top,
            width: currentLine.rawRight - currentLine.rawLeft,
            height: currentLine.rawBottom - currentLine.rawTop,
            style,
          });
        }
        currentLine = {
          text: match[0],
          rawLeft: wordRect.left,
          rawTop: wordRect.top,
          rawRight: wordRect.right,
          rawBottom: wordRect.bottom,
        };
      } else {
        currentLine.text += ` ${match[0]}`;
        currentLine.rawLeft = Math.min(currentLine.rawLeft, wordRect.left);
        currentLine.rawTop = Math.min(currentLine.rawTop, wordRect.top);
        currentLine.rawRight = Math.max(currentLine.rawRight, wordRect.right);
        currentLine.rawBottom = Math.max(currentLine.rawBottom, wordRect.bottom);
      }
    }

    if (currentLine) {
      runs.push({
        text: applyTextTransform(currentLine.text, style.textTransform),
        left: currentLine.rawLeft - elRect.left,
        top: currentLine.rawTop - elRect.top,
        width: currentLine.rawRight - currentLine.rawLeft,
        height: currentLine.rawBottom - currentLine.rawTop,
        style,
      });
    }
  }

  return runs;
}

function getEffectiveOpacity(el) {
  let opacity = 1;
  let current = el;
  let depth = 0;

  while (current && current !== document.documentElement && depth < 6) {
    const cs = window.getComputedStyle(current);
    const val = parseFloat(cs.opacity);
    if (!Number.isNaN(val)) {
      opacity *= val;
    }
    if (opacity <= 0.001 || cs.visibility === 'hidden' || cs.display === 'none') {
      return 0;
    }
    current = current.parentElement;
    depth += 1;
  }

  return opacity;
}

/**
 * Amostra a energia máxima do FluidField sobre o quad de texto (O(1), ~15 leituras).
 * Garante que apenas textos efetivamente atingidos pela onda sejam renderizados na GPU.
 */
function sampleFluidActivityInBox(fluidField, left, top, width, height, vw, vh) {
  if (!fluidField || fluidField.isIdle()) return 0;
  const rgba = fluidField.rgbaData;
  const cols = fluidField.cols;
  const rows = fluidField.rows;
  if (!rgba || !cols || !rows) return 0;

  const u0 = clamp(left / Math.max(vw, 1), 0, 1);
  const u1 = clamp((left + width) / Math.max(vw, 1), 0, 1);
  const v0 = clamp(top / Math.max(vh, 1), 0, 1);
  const v1 = clamp((top + height) / Math.max(vh, 1), 0, 1);

  if (u1 <= u0 || v1 <= v0) return 0;

  const minC = Math.max(0, Math.floor(u0 * (cols - 1)));
  const maxC = Math.min(cols - 1, Math.ceil(u1 * (cols - 1)));
  const minR = Math.max(0, Math.floor(v0 * (rows - 1)));
  const maxR = Math.min(rows - 1, Math.ceil(v1 * (rows - 1)));

  const stepC = Math.max(1, Math.floor((maxC - minC) / 5));
  const stepR = Math.max(1, Math.floor((maxR - minR) / 3));

  let maxVal = 0;
  for (let r = minR; r <= maxR; r += stepR) {
    const rowOff = r * cols;
    for (let c = minC; c <= maxC; c += stepC) {
      const idx = (rowOff + c) * 4;
      const a = rgba[idx + 3];
      const b = rgba[idx + 2];
      const gx = Math.abs(rgba[idx] - 128) * 2;
      const gy = Math.abs(rgba[idx + 1] - 128) * 2;
      if (a > maxVal) maxVal = a;
      if (b > maxVal) maxVal = b;
      if (gx > maxVal) maxVal = gx;
      if (gy > maxVal) maxVal = gy;
    }
  }

  return maxVal / 255;
}

// ---------------------------------------------------------------------------
// Engine Principal: GlslTextEngine (Unificado ao FluidField)
// ---------------------------------------------------------------------------

export class GlslTextEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.fluidField = this.options.fluidField || getSharedFluidField();
    this.fluidTex = null;

    this.canvas = null;
    this.ownsCanvas = false;
    this.gl = null;
    this.program = null;
    this.quadBuffer = null;
    this.uniforms = {};
    this.aPosLoc = -1;

    this.items = new Map();
    this.textureLRU = [];
    this.maxTextureSize = 2048;

    this.dpr = 1;
    this.viewportWidth = 1;
    this.viewportHeight = 1;

    this.webglReady = false;
    this.isRunning = false;
    this.isDestroyed = false;
    this.contextLost = false;
    this.reducedMotion = false;
    this.rafId = null;
    this.lastFrameTime = 0;
    this.elapsedTime = 0;
    this.drawCallsLastFrame = 0;

    // Fallback de ponteiro caso glsl-surfaces.js não esteja ativo
    this._lastPtrX = 0;
    this._lastPtrY = 0;
    this._lastPtrTime = -1;

    this.resizeObserver = null;
    this.intersectionObserver = null;
    this.resizeTimer = null;
    this.reducedMotionQuery = null;

    this._onWindowResize = this._onWindowResize.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onContextLost = this._onContextLost.bind(this);
    this._onContextRestored = this._onContextRestored.bind(this);
    this._onReducedMotionChange = this._onReducedMotionChange.bind(this);
    this._onGlobalPointerActivity = this._onGlobalPointerActivity.bind(this);
    this._onFluidWake = this._onFluidWake.bind(this);
    this._frame = this._frame.bind(this);
  }

  getFluidField() {
    return this.fluidField;
  }

  init() {
    if (this.isDestroyed || typeof window === 'undefined' || typeof document === 'undefined') {
      return this;
    }

    if (this.gl && this.canvas) {
      this.refresh();
      return this;
    }

    this._setupReducedMotion();
    injectStylesOnce();

    this.webglReady = this._initWebGL();
    if (!this.webglReady) {
      return this;
    }

    window.__CINDRE_FLUID_FIELD__ = this.fluidField;

    this._setupObservers();
    window.addEventListener('resize', this._onWindowResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibilityChange, { passive: true });
    window.addEventListener('pointermove', this._onGlobalPointerActivity, { passive: true });
    window.addEventListener('pointerdown', this._onGlobalPointerActivity, { passive: true });
    window.addEventListener('cindre:fluid-wake', this._onFluidWake, { passive: true });

    this.scan();

    if (document.fonts && typeof document.fonts.ready?.then === 'function') {
      document.fonts.ready.then(() => {
        if (!this.isDestroyed) {
          this.invalidateAllTextures();
        }
      });
    }

    return this;
  }

  _setupReducedMotion() {
    if (!this.options.respectReducedMotion || typeof window.matchMedia !== 'function') {
      this.reducedMotion = false;
      return;
    }
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = Boolean(this.reducedMotionQuery.matches);
    if (typeof this.reducedMotionQuery.addEventListener === 'function') {
      this.reducedMotionQuery.addEventListener('change', this._onReducedMotionChange);
    }
  }

  _onReducedMotionChange(event) {
    this.reducedMotion = Boolean(event.matches);
    if (this.reducedMotion) {
      this._releaseAllRenderingStates();
    }
  }

  _initWebGL() {
    let canvas = document.getElementById(CANVAS_ELEMENT_ID);
    if (canvas && canvas.tagName === 'CANVAS') {
      this.ownsCanvas = false;
    } else {
      canvas = document.createElement('canvas');
      canvas.id = CANVAS_ELEMENT_ID;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.zIndex = String(this.options.zIndex);
      this.ownsCanvas = true;
    }
    canvas.dataset.glslEngine = 'cindre-unified-text';

    const contextAttrs = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };

    const gl =
      canvas.getContext('webgl2', contextAttrs) ||
      canvas.getContext('webgl', contextAttrs) ||
      canvas.getContext('experimental-webgl', contextAttrs);

    if (!gl) {
      return false;
    }

    this.canvas = canvas;
    this.gl = gl;

    if (!this._buildGpuResources()) {
      return false;
    }

    canvas.addEventListener('webglcontextlost', this._onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this._onContextRestored, false);

    if (this.ownsCanvas && !canvas.parentNode) {
      document.body.appendChild(canvas);
    }
    this._resizeCanvas();

    return true;
  }

  _buildGpuResources() {
    const gl = this.gl;
    if (!gl) return false;

    const program = createProgram(gl, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    if (!program) {
      return false;
    }

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW
    );

    this.program = program;
    this.quadBuffer = quadBuffer;
    this.fluidTex = this.fluidField.createContextTexture(gl);
    this.maxTextureSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) || 2048, 4096);

    this.aPosLoc = gl.getAttribLocation(program, 'aPos');
    this.uniforms = {
      uRect: gl.getUniformLocation(program, 'uRect'),
      uViewport: gl.getUniformLocation(program, 'uViewport'),
      uViewportPx: gl.getUniformLocation(program, 'uViewportPx'),
      uTexture: gl.getUniformLocation(program, 'uTexture'),
      uFluidMap: gl.getUniformLocation(program, 'uFluidMap'),
      uTexSize: gl.getUniformLocation(program, 'uTexSize'),
      uPadUv: gl.getUniformLocation(program, 'uPadUv'),
      uTime: gl.getUniformLocation(program, 'uTime'),
      uReveal: gl.getUniformLocation(program, 'uReveal'),
      uOpacity: gl.getUniformLocation(program, 'uOpacity'),
      uConfig: gl.getUniformLocation(program, 'uConfig'),
    };

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    return true;
  }

  _resizeCanvas() {
    if (!this.canvas || !this.gl) return;

    const rect = this.canvas.getBoundingClientRect();
    this.viewportWidth = Math.max(1, rect.width || document.documentElement.clientWidth || window.innerWidth);
    this.viewportHeight = Math.max(1, rect.height || document.documentElement.clientHeight || window.innerHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, this.options.maxDpr);

    const targetW = Math.max(1, Math.round(this.viewportWidth * this.dpr));
    const targetH = Math.max(1, Math.round(this.viewportHeight * this.dpr));

    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
      this.gl.viewport(0, 0, targetW, targetH);
    }

    if (this.fluidField) {
      this.fluidField.resize(this.viewportWidth, this.viewportHeight);
    }
  }

  _setupObservers() {
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const item = this.items.get(entry.target);
          if (item) {
            item.dirty = true;
          }
        }
      });
    }

    if (typeof IntersectionObserver !== 'undefined') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const item = this.items.get(entry.target);
            if (!item) continue;
            item.inView = entry.isIntersecting;
            if (item.inView && this.options.prewarmVisible && item.dirty && !item.texture) {
              this._schedulePrewarm(item);
            }
          }
        },
        { rootMargin: '220px 0px' }
      );
    }
  }

  _schedulePrewarm(item) {
    if (item.prewarmScheduled || this.isDestroyed) return;
    item.prewarmScheduled = true;

    const run = () => {
      item.prewarmScheduled = false;
      if (this.isDestroyed || this.contextLost || !this.items.has(item.el)) return;
      if (item.inView && item.dirty && !item.rendering) {
        this._ensureTexture(item);
      }
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run, { timeout: 900 });
    } else {
      window.setTimeout(run, 100);
    }
  }

  // -------------------------------------------------------------------------
  // Acorda automaticamente quando o FluidField recebe energia na zona inferior
  // -------------------------------------------------------------------------

  _onGlobalPointerActivity(event) {
    if (this.reducedMotion || this.contextLost || !this.webglReady) return;
    if (event.pointerType === 'touch') return;
    if (document.body.classList.contains('modal-open')) return;
    if (event.target instanceof Element && this.options.excludeSelector && event.target.closest(this.options.excludeSelector)) {
      this._lastPtrTime = -1;
      return;
    }

    // Se glsl-surfaces.js não estiver dirigindo o fluidField, injeta diretamente como fallback
    if (window.__CINDRE_FLUID_DRIVER__ !== 'surfaces') {
      const now = performance.now();
      let vx = 0;
      let vy = 0;
      if (this._lastPtrTime >= 0) {
        const dtSec = Math.max((now - this._lastPtrTime) / 1000, 0.004);
        if (dtSec < 0.14) {
          vx = (event.clientX - this._lastPtrX) / dtSec;
          vy = (event.clientY - this._lastPtrY) / dtSec;
        }
      }
      this._lastPtrX = event.clientX;
      this._lastPtrY = event.clientY;
      this._lastPtrTime = now;

      this.fluidField.injectPointer(
        event.clientX,
        event.clientY,
        vx,
        vy,
        54,
        event.type === 'pointerdown' ? 1.15 : 0.95
      );
    }

    if (!this.fluidField.isIdle()) {
      this._ensureRunning();
    }
  }

  _onFluidWake() {
    if (!this.reducedMotion && !this.contextLost && this.webglReady && !this.fluidField.isIdle()) {
      this._ensureRunning();
    }
  }

  // -------------------------------------------------------------------------
  // Registro de Elementos `[data-glsl-text]`
  // -------------------------------------------------------------------------

  scan(root = document) {
    if (this.isDestroyed || !root || typeof root.querySelectorAll !== 'function') {
      return 0;
    }

    const nodes = root.querySelectorAll(this.options.selector);
    const exclude = this.options.excludeSelector;
    let count = 0;

    nodes.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      if (exclude && el.closest(exclude)) return;
      this.registerElement(el);
      count += 1;
    });

    return count;
  }

  registerElement(el) {
    if (!(el instanceof HTMLElement) || this.items.has(el) || this.isDestroyed) {
      return this.items.get(el) || null;
    }

    if (this.options.excludeSelector && el.closest(this.options.excludeSelector)) {
      return null;
    }

    const item = {
      el,
      texture: null,
      texWidth: 0,
      texHeight: 0,
      padX: 30,
      padY: 24,
      baseFontSize: 16,
      pxAmplitude: 6.5,
      fontScale: 0.5,
      dirty: true,
      inView: false,
      prewarmScheduled: false,
      rendering: false,
      hidden: false,
      hovered: false,
      reveal: 1.0,
      listeners: null,
    };

    const onPointerEnter = (event) => {
      if (this.reducedMotion || this.contextLost || !this.webglReady) return;
      if (event.pointerType === 'touch' || item.reveal <= REVEAL_ZERO_THRESHOLD) return;
      item.hovered = true;
      this._ensureTexture(item);
      if (window.__CINDRE_FLUID_DRIVER__ !== 'surfaces') {
        this.fluidField.injectPointer(event.clientX, event.clientY, 0, 0, 52, 0.9);
      }
      this._ensureRunning();
    };

    const onPointerLeave = () => {
      item.hovered = false;
    };

    el.addEventListener('pointerenter', onPointerEnter, { passive: true });
    el.addEventListener('pointerleave', onPointerLeave, { passive: true });

    item.listeners = { onPointerEnter, onPointerLeave };
    this.items.set(el, item);

    if (this.resizeObserver) this.resizeObserver.observe(el);
    if (this.intersectionObserver) this.intersectionObserver.observe(el);

    return item;
  }

  unregisterElement(el) {
    const item = this.items.get(el);
    if (!item) return;

    this._setDomRenderingState(item, false);
    this._setDomHiddenState(item, false);

    if (item.listeners) {
      el.removeEventListener('pointerenter', item.listeners.onPointerEnter);
      el.removeEventListener('pointerleave', item.listeners.onPointerLeave);
    }

    if (this.resizeObserver) this.resizeObserver.unobserve(el);
    if (this.intersectionObserver) this.intersectionObserver.unobserve(el);

    this._disposeItemTexture(item);
    this.items.delete(el);
  }

  // -------------------------------------------------------------------------
  // Contrato com `scroll-choreography.js` (`setReveal` e `pulse`)
  // -------------------------------------------------------------------------

  setReveal(el, value) {
    if (!(el instanceof HTMLElement) || this.isDestroyed) return;

    const v = clamp(Number.isFinite(value) ? value : 1, 0, 1);

    if (!this.webglReady || this.reducedMotion || this.contextLost) {
      el.style.opacity = v >= REVEAL_FULL_THRESHOLD ? '' : String(v);
      return;
    }

    let item = this.items.get(el);
    if (!item) {
      item = this.registerElement(el);
      if (!item) return;
    }

    item.reveal = v;

    if (v <= REVEAL_ZERO_THRESHOLD) {
      this._setDomRenderingState(item, false);
      this._setDomHiddenState(item, true);
      return;
    }

    this._setDomHiddenState(item, false);

    if (v < REVEAL_FULL_THRESHOLD) {
      if (item.dirty || !item.texture) {
        this._ensureTexture(item);
      }
      if (item.texture) {
        this._setDomRenderingState(item, true);
        this._ensureRunning();
      }
    } else if (this.fluidField.isIdle()) {
      this._setDomRenderingState(item, false);
    } else {
      this._ensureRunning();
    }
  }

  pulse(el, intensity = 0.75) {
    if (!(el instanceof HTMLElement) || this.isDestroyed || this.reducedMotion || !this.webglReady || this.contextLost) {
      return;
    }

    let target = el;
    if (!this.items.has(target)) {
      const nested = target.querySelector(this.options.selector);
      if (nested instanceof HTMLElement && this.items.has(nested)) {
        target = nested;
      } else if (target.matches(this.options.selector)) {
        this.registerElement(target);
      } else {
        return;
      }
    }

    const item = this.items.get(target);
    if (!item || item.reveal <= REVEAL_ZERO_THRESHOLD) return;

    const strength = clamp(Number.isFinite(intensity) ? intensity : 0.75, 0.25, 1.3);
    this.triggerWave(target, 0.5, 0.5, strength);
  }

  triggerWave(el, normX = 0.5, normY = 0.5, strength = 1.0) {
    if (!(el instanceof HTMLElement) || this.isDestroyed || this.reducedMotion || !this.webglReady || this.contextLost) {
      return;
    }

    const item = this.items.get(el) || this.registerElement(el);
    if (!item || item.reveal <= REVEAL_ZERO_THRESHOLD) return;

    this._ensureTexture(item);
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const px = rect.left + rect.width * clamp(normX, 0.05, 0.95);
      const py = rect.top + rect.height * clamp(normY, 0.05, 0.95);
      this.fluidField.injectPointer(px, py, 0, 0, 56, clamp(strength, 0.25, 1.35));
    }

    this._ensureRunning();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cindre:fluid-wake'));
    }
  }

  refresh(root = document) {
    if (this.isDestroyed) return this;
    this._resizeCanvas();
    this.scan(root);
    this.invalidateAllTextures();
    return this;
  }

  resize() {
    this._onWindowResize();
    return this;
  }

  invalidateAllTextures() {
    this.items.forEach((item) => {
      item.dirty = true;
    });
  }

  _setDomRenderingState(item, active) {
    if (item.rendering === active) return;
    item.rendering = active;
    if (active) {
      item.el.setAttribute('data-glsl-rendering', 'true');
      item.el.classList.add('glsl-text-ready');
    } else {
      item.el.removeAttribute('data-glsl-rendering');
      if (!item.hidden) {
        item.el.classList.remove('glsl-text-ready');
      }
    }
  }

  _setDomHiddenState(item, hidden) {
    if (item.hidden === hidden) return;
    item.hidden = hidden;
    if (hidden) {
      item.el.setAttribute('data-glsl-hidden', 'true');
      item.el.classList.add('glsl-text-ready');
    } else {
      item.el.removeAttribute('data-glsl-hidden');
      if (!item.rendering) {
        item.el.classList.remove('glsl-text-ready');
      }
    }
  }

  _releaseAllRenderingStates() {
    this.items.forEach((item) => {
      item.hovered = false;
      this._setDomRenderingState(item, false);
      this._setDomHiddenState(item, item.reveal <= REVEAL_ZERO_THRESHOLD);
    });
    if (this.gl && !this.contextLost) {
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this._stopLoop();
  }

  // -------------------------------------------------------------------------
  // Rasterização HiDPI Subpixel-Exact (DOM → Textura WebGL)
  // -------------------------------------------------------------------------

  _ensureTexture(item) {
    if (!this.gl || this.contextLost) return;

    if (!item.dirty && item.texture) {
      this._touchLRU(item);
      return;
    }

    const el = item.el;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;

    const wasRendering = item.rendering;
    const wasHidden = item.hidden;
    const hadReadyClass = el.classList.contains('glsl-text-ready');
    if (wasRendering) el.removeAttribute('data-glsl-rendering');
    if (wasHidden) el.removeAttribute('data-glsl-hidden');
    if (hadReadyClass) el.classList.remove('glsl-text-ready');

    const baseStyle = window.getComputedStyle(el);
    const baseFontSize = parseFloat(baseStyle.fontSize) || 16;
    const padX = Math.round(clamp(baseFontSize * 0.9, 24, 68));
    const padY = Math.round(clamp(baseFontSize * 0.8, 20, 60));

    const quadW = Math.ceil(rect.width + padX * 2);
    const quadH = Math.ceil(rect.height + padY * 2);

    const runs = extractVisualTextRuns(el, rect);

    if (wasRendering) el.setAttribute('data-glsl-rendering', 'true');
    if (wasHidden) el.setAttribute('data-glsl-hidden', 'true');
    if (hadReadyClass) el.classList.add('glsl-text-ready');

    if (runs.length === 0) return;

    const maxScaleX = this.maxTextureSize / Math.max(quadW, 1);
    const maxScaleY = this.maxTextureSize / Math.max(quadH, 1);
    const scale = Math.min(this.dpr, maxScaleX, maxScaleY);

    const canvasW = Math.max(2, Math.ceil(quadW * scale));
    const canvasH = Math.max(2, Math.ceil(quadH * scale));

    const offscreen = document.createElement('canvas');
    offscreen.width = canvasW;
    offscreen.height = canvasH;

    const ctx = offscreen.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, quadW, quadH);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[i];
      const st = run.style;
      const fontSize = parseFloat(st.fontSize) || baseFontSize;
      const fontStyle = st.fontStyle || 'normal';
      const fontWeight = st.fontWeight || '400';
      const fontFamily = st.fontFamily || 'serif';
      const letterSpacingPx = parseLetterSpacing(st.letterSpacing, fontSize);

      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = st.color || '#ececec';

      const metrics = ctx.measureText(run.text);
      const ascent =
        typeof metrics.actualBoundingBoxAscent === 'number' && metrics.actualBoundingBoxAscent > 0
          ? metrics.actualBoundingBoxAscent
          : fontSize * 0.78;
      const descent =
        typeof metrics.actualBoundingBoxDescent === 'number' && metrics.actualBoundingBoxDescent >= 0
          ? metrics.actualBoundingBoxDescent
          : fontSize * 0.22;

      const glyphHeight = ascent + descent;
      const drawX = run.left + padX;
      const drawY = run.top + padY + (run.height - glyphHeight) * 0.5 + ascent;

      drawTextRun(ctx, run.text, drawX, drawY, letterSpacingPx);
    }

    const gl = this.gl;
    if (!item.texture) {
      item.texture = gl.createTexture();
    }

    gl.bindTexture(gl.TEXTURE_2D, item.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, offscreen);
    gl.bindTexture(gl.TEXTURE_2D, null);

    offscreen.width = 0;
    offscreen.height = 0;

    item.padX = padX;
    item.padY = padY;
    item.baseFontSize = baseFontSize;
    item.fontScale = clamp((baseFontSize - 10) / 34, 0.28, 1.0);
    // Amplitude fisica em pixels proporcional ao tamanho da fonte (nunca embaralha fontes pequenas)
    item.pxAmplitude = clamp(baseFontSize * 0.26, 3.2, 13.5);
    item.texWidth = quadW;
    item.texHeight = quadH;
    item.dirty = false;

    this._touchLRU(item);
    this._evictTexturesIfNeeded();
  }

  _touchLRU(item) {
    const idx = this.textureLRU.indexOf(item);
    if (idx !== -1) {
      this.textureLRU.splice(idx, 1);
    }
    this.textureLRU.push(item);
  }

  _evictTexturesIfNeeded() {
    while (this.textureLRU.length > MAX_CACHED_TEXTURES) {
      const candidate = this.textureLRU.find((it) => !it.rendering && !it.hovered);
      if (!candidate) break;
      this._disposeItemTexture(candidate);
    }
  }

  _disposeItemTexture(item) {
    if (item.texture && this.gl && !this.contextLost) {
      this.gl.deleteTexture(item.texture);
    }
    item.texture = null;
    item.dirty = true;
    const idx = this.textureLRU.indexOf(item);
    if (idx !== -1) {
      this.textureLRU.splice(idx, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Loop de Renderização Demand-Driven Unificado ao FluidField
  // -------------------------------------------------------------------------

  _ensureRunning() {
    if (this.isRunning || this.isDestroyed || this.contextLost || !this.webglReady || document.hidden) {
      return;
    }
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.rafId = window.requestAnimationFrame(this._frame);
  }

  _stopLoop() {
    this.isRunning = false;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.drawCallsLastFrame = 0;
  }

  _frame(now) {
    if (!this.isRunning || this.isDestroyed || this.contextLost) return;

    const dt = Math.min(Math.max((now - this.lastFrameTime) / 1000, 0.001), 0.05);
    this.lastFrameTime = now;
    this.elapsedTime += dt;

    // Avança e sincroniza o MESMO FluidField compartilhado (noop se surfaces já avançou neste frame)
    this.fluidField.advanceToTime(now);
    const gl = this.gl;
    if (this.fluidTex) {
      this.fluidField.syncToContext(gl, this.fluidTex);
    }

    const fluidActive = !this.fluidField.isIdle();
    const u = this.uniforms;
    const vw = this.viewportWidth;
    const vh = this.viewportHeight;
    const vpPxW = this.canvas.width;
    const vpPxH = this.canvas.height;

    gl.viewport(0, 0, vpPxW, vpPxH);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let keepRunning = fluidActive;
    let drawCalls = 0;

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.aPosLoc);
    gl.vertexAttribPointer(this.aPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(u.uViewport, vw, vh);
    gl.uniform2f(u.uViewportPx, vpPxW, vpPxH);
    gl.uniform1f(u.uTime, this.elapsedTime);
    gl.uniform1i(u.uTexture, 0);
    gl.uniform1i(u.uFluidMap, 1);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fluidTex);

    this.items.forEach((item) => {
      const revealTransitioning =
        item.reveal > REVEAL_ZERO_THRESHOLD && item.reveal < REVEAL_FULL_THRESHOLD;

      if (item.reveal <= REVEAL_ZERO_THRESHOLD) {
        this._setDomRenderingState(item, false);
        this._setDomHiddenState(item, true);
        return;
      }

      if (!fluidActive && !revealTransitioning) {
        this._setDomRenderingState(item, false);
        this._setDomHiddenState(item, false);
        return;
      }

      const rect = item.el.getBoundingClientRect();
      const quadX = rect.left - item.padX;
      const quadY = rect.top - item.padY;
      const quadW = rect.width + item.padX * 2;
      const quadH = rect.height + item.padY * 2;

      // Frustum culling rigoroso
      if (quadX + quadW < 0 || quadX > vw || quadY + quadH < 0 || quadY > vh) {
        if (!revealTransitioning) {
          this._setDomRenderingState(item, false);
        }
        return;
      }

      // Verifica se a onda física do FluidField realmente atravessa este bloco de texto
      const localFluid = fluidActive
        ? sampleFluidActivityInBox(this.fluidField, quadX, quadY, quadW, quadH, vw, vh)
        : 0;

      if (!revealTransitioning && localFluid < FLUID_RECT_THRESHOLD) {
        this._setDomRenderingState(item, false);
        this._setDomHiddenState(item, false);
        return;
      }

      keepRunning = true;

      if (item.dirty || !item.texture) {
        this._ensureTexture(item);
      }
      if (!item.texture) {
        this._setDomRenderingState(item, false);
        return;
      }

      const opacity = getEffectiveOpacity(item.el);
      if (opacity <= ENERGY_EPSILON) {
        return;
      }

      this._setDomHiddenState(item, false);
      this._setDomRenderingState(item, true);

      const fs = item.fontScale || 0.5;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, item.texture);
      gl.uniform4f(
        u.uConfig,
        item.pxAmplitude * this.options.distortionStrength,
        this.options.chromaStrength * (0.35 + 0.65 * fs),
        this.options.specularStrength,
        this.options.dissolveStrength * (0.30 + 0.70 * fs)
      );
      gl.uniform4f(u.uRect, quadX, quadY, quadW, quadH);
      gl.uniform2f(u.uTexSize, quadW, quadH);
      gl.uniform2f(u.uPadUv, item.padX / Math.max(quadW, 1), item.padY / Math.max(quadH, 1));
      gl.uniform1f(u.uReveal, item.reveal);
      gl.uniform1f(u.uOpacity, opacity);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls += 1;
    });

    this.drawCallsLastFrame = drawCalls;

    if (keepRunning) {
      this.rafId = window.requestAnimationFrame(this._frame);
    } else {
      this._stopLoop();
    }
  }

  // -------------------------------------------------------------------------
  // Eventos de Sistema, Context Lost/Restored & Limpeza Absoluta de VRAM
  // -------------------------------------------------------------------------

  _onWindowResize() {
    if (this.isDestroyed) return;
    this._resizeCanvas();
    clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      if (!this.isDestroyed) {
        this.invalidateAllTextures();
      }
    }, 160);
  }

  _onVisibilityChange() {
    if (document.hidden) {
      this._stopLoop();
    } else {
      let hasActive = !this.fluidField.isIdle();
      if (!hasActive) {
        this.items.forEach((item) => {
          if (item.reveal > REVEAL_ZERO_THRESHOLD && item.reveal < REVEAL_FULL_THRESHOLD) {
            hasActive = true;
          }
        });
      }
      if (hasActive) {
        this._ensureRunning();
      }
    }
  }

  _onContextLost(event) {
    event.preventDefault();
    this.contextLost = true;
    this.fluidTex = null;
    this._releaseAllRenderingStates();
    this.items.forEach((item) => {
      item.texture = null;
      item.dirty = true;
    });
    this.textureLRU.length = 0;
  }

  _onContextRestored() {
    if (this.isDestroyed || !this.gl) return;
    if (!this._buildGpuResources()) return;
    this.contextLost = false;
    this._resizeCanvas();
    this.invalidateAllTextures();
  }

  getStats() {
    let texturesAllocated = 0;
    let activeElements = 0;
    this.items.forEach((item) => {
      if (item.texture) texturesAllocated += 1;
      if (item.rendering) activeElements += 1;
    });

    return {
      registeredElements: this.items.size,
      activeElements,
      texturesAllocated,
      fluidEnergy: Number(this.fluidField.getEnergy().toFixed(3)),
      fluidIdle: this.fluidField.isIdle(),
      drawCallsLastFrame: this.drawCallsLastFrame,
      isRunning: this.isRunning,
      dpr: this.dpr,
      contextLost: this.contextLost,
    };
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this._stopLoop();

    clearTimeout(this.resizeTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onWindowResize);
      window.removeEventListener('pointermove', this._onGlobalPointerActivity);
      window.removeEventListener('pointerdown', this._onGlobalPointerActivity);
      window.removeEventListener('cindre:fluid-wake', this._onFluidWake);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }

    if (this.reducedMotionQuery && typeof this.reducedMotionQuery.removeEventListener === 'function') {
      this.reducedMotionQuery.removeEventListener('change', this._onReducedMotionChange);
    }

    const elements = Array.from(this.items.keys());
    for (const el of elements) {
      this.unregisterElement(el);
    }
    this.textureLRU.length = 0;

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.intersectionObserver) {
      this.intersectionObserver.disconnect();
      this.intersectionObserver = null;
    }

    if (this.gl && !this.contextLost) {
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      if (this.fluidTex) this.gl.deleteTexture(this.fluidTex);
      if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
      if (this.program) this.gl.deleteProgram(this.program);
    }

    if (this.canvas) {
      this.canvas.removeEventListener('webglcontextlost', this._onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this._onContextRestored);
      if (this.ownsCanvas) {
        this.canvas.remove();
      }
      this.canvas = null;
    }

    this.gl = null;
    this.fluidTex = null;
    this.program = null;
    this.quadBuffer = null;
  }
}

// ---------------------------------------------------------------------------
// API Singleton & Auto-Boot Seguro
// ---------------------------------------------------------------------------

let singletonEngine = null;
let autoInitCancelled = false;

export function initGlslText(options = {}) {
  autoInitCancelled = true;

  if (singletonEngine && !singletonEngine.isDestroyed) {
    if (options && Object.keys(options).length > 0) {
      Object.assign(singletonEngine.options, options);
      if (options.fluidField) {
        singletonEngine.fluidField = options.fluidField;
      }
    }
    singletonEngine.refresh();
    return singletonEngine;
  }

  singletonEngine = new GlslTextEngine(options).init();

  if (typeof window !== 'undefined') {
    window.__BASALTE_GLSL_TEXT__ = singletonEngine;
    window.__CINDRE_GLSL_TEXT__ = singletonEngine;
  }

  return singletonEngine;
}

export const initLiquidTextEngine = initGlslText;
export const initGLSLText = initGlslText;
export const initLiquidText = initGlslText;
export const createLiquidTextEngine = initGlslText;

export function refreshGlslText(root = document) {
  if (!singletonEngine || singletonEngine.isDestroyed) {
    return initGlslText();
  }
  return singletonEngine.refresh(root);
}

export function destroyGlslText() {
  autoInitCancelled = true;
  if (singletonEngine) {
    singletonEngine.destroy();
    singletonEngine = null;
  }
  if (typeof window !== 'undefined') {
    delete window.__BASALTE_GLSL_TEXT__;
    delete window.__CINDRE_GLSL_TEXT__;
  }
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const scheduleAutoBoot = () => {
    window.requestAnimationFrame(() => {
      if (autoInitCancelled || singletonEngine || window.__BASALTE_DISABLE_GLSL_AUTO_INIT__) {
        return;
      }
      if (document.querySelector('[data-glsl-text]')) {
        initGlslText();
      }
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleAutoBoot, { once: true });
  } else {
    scheduleAutoBoot();
  }
}

export default initGlslText;
