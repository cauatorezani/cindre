/**
 * CINDRE — Maison de Parfum · Paris
 * Engine WebGL/GLSL Unificado de Superfícies Líquidas (`#glsl-surfaces-canvas`)
 * Acoplado ao simulador físico compartilhado `fluid-field.js` (ZERO mancha cinza).
 *
 * Arquitetura em contexto WebGL único (WebGL2 com fallback automático WebGL1):
 * - Pass A (Fundo Basalto): amostra `uFluidMap` em `screenUv`, descarta regiões calmas
 *   (`crest < 0.035 && length(grad) < 0.04`) e renderiza apenas o reflexo especular fino
 *   na crista da onda, preservando 100% do fundo `#070608`/`#09090b` e do degradê pós-Hero.
 * - Pass B (Cards `.triptych-card` & Foto `.art-media-frame`): refração líquida real
 *   sobre a textura fotográfica (`object-fit: cover` subpixel-exact) guiada pelo mesmo
 *   `FluidField`, com brilho especular fino na crista e nitidez absoluta em repouso.
 * - Pass C (Botões `.btn-pill`, `.quiz-pill`, `.newsletter-btn`): menisco líquido e
 *   especular fino dentro do `sdRoundedBox` em sincronia com o `FluidField`, preservando
 *   100% de legibilidade no texto HTML.
 */

import { getSharedFluidField } from './fluid-field.js';

const CANVAS_ID = 'glsl-surfaces-canvas';
const STYLE_ID = 'basalte-glsl-surfaces-styles';

const HERO_EXCLUDE_SELECTOR = '#cindre-root, #hero-slot, [data-hero-intact]';
const LOWER_ROOT_SELECTOR = '.cindre-lower, .basalte-lower, #cindre-footer, #basalte-footer';
const MEDIA_SELECTOR = '.triptych-card, .art-media-frame';
const BUTTON_SELECTOR = '.btn-pill, .quiz-pill, .newsletter-btn';

const ENERGY_EPSILON = 0.002;
const FLUID_RECT_THRESHOLD = 0.015;

const DEFAULT_OPTIONS = Object.freeze({
  excludeSelector: HERO_EXCLUDE_SELECTOR,
  lowerSelector: LOWER_ROOT_SELECTOR,
  mediaSelector: MEDIA_SELECTOR,
  buttonSelector: BUTTON_SELECTOR,
  zIndex: 4,
  maxDpr: 2,
  bgIntensity: 1.0,
  mediaIntensity: 1.0,
  buttonIntensity: 1.0,
  respectReducedMotion: true,
});

// ---------------------------------------------------------------------------
// Vertex Shader Compartilhado (Pixel Space -> NDC)
// ---------------------------------------------------------------------------

const SHARED_VERT_SRC = /* glsl */ `
  precision highp float;

  attribute vec2 aPos;

  uniform vec4 uRect;      // x, y, width, height em CSS px
  uniform vec2 uViewport;  // width, height da viewport em CSS px

  varying vec2 vUv;

  void main() {
    vec2 px = uRect.xy + aPos * uRect.zw;
    vec2 ndc = (px / max(uViewport, vec2(1.0))) * 2.0 - 1.0;
    gl_Position = vec4(ndc.x, -ndc.y, 0.0, 1.0);
    vUv = aPos;
  }
`;

// ---------------------------------------------------------------------------
// Chunk GLSL Compartilhado: Signed Distance Function Rounded Box
// ---------------------------------------------------------------------------

const GLSL_SDF_CHUNK = /* glsl */ `
  float sdRoundedBox(vec2 p, vec2 halfSize, float radius) {
    float r = min(radius, min(halfSize.x, halfSize.y));
    vec2 q = abs(p) - halfSize + vec2(r);
    return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
  }

  vec2 decodeFluidGrad(vec2 rg) {
    return (rg - vec2(128.0 / 255.0)) * (255.0 / 127.0);
  }
`;

// ---------------------------------------------------------------------------
// Fragment Shader A: Fundo Basalto — Apenas Crista Especular Fina (ZERO Mancha)
// ---------------------------------------------------------------------------

const BG_FRAG_SRC = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uFluidMap;
  uniform vec2 uViewportPx;    // tamanho real do framebuffer em pixels
  uniform vec2 uSize;          // width, height do quad do fundo em CSS px
  uniform float uIntensity;

  ${GLSL_SDF_CHUNK}

  void main() {
    vec2 screenUv = vec2(
      gl_FragCoord.x / max(uViewportPx.x, 1.0),
      1.0 - gl_FragCoord.y / max(uViewportPx.y, 1.0)
    );

    vec4 f = texture2D(uFluidMap, screenUv);
    vec2 grad = decodeFluidGrad(f.rg);
    float crest = f.b;
    float active = f.a;
    float gradLen = length(grad);

    // Descarta imediatamente qualquer regiao calma: ZERO mancha cinza, fundo #070608 intacto
    if (crest < 0.035 && gradLen < 0.04) {
      discard;
    }

    // Protege integralmente a zona de transicao logo abaixo da Hero (#070608)
    float topFade = smoothstep(0.0, 260.0, vUv.y * uSize.y) * smoothstep(0.0, 0.09, vUv.y);
    float bottomFade = smoothstep(0.0, 0.03, 1.0 - vUv.y);
    float edgeMask = topFade * bottomFade;
    if (edgeMask <= 0.002) {
      discard;
    }

    // Reflexo especular fino e nitido estritamente concentrado na crista da onda
    vec3 normal = normalize(vec3(-grad * 0.52, 1.0));
    vec3 lightDir = normalize(vec3(-0.34, -0.58, 0.74));
    vec3 halfVec = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(normal, halfVec), 0.0), 32.0);

    float ridgeSpec = pow(max(crest, 0.0), 1.6) * 0.22;
    float directionalGlint = spec * crest * 0.14;
    float alpha = clamp((ridgeSpec + directionalGlint) * max(active, crest) * edgeMask * uIntensity, 0.0, 0.25);

    if (alpha <= 0.002) {
      discard;
    }

    // Prata-obsidiana fria com levissimo toque mineral na crista
    vec3 coldObsidianSilver = vec3(0.76, 0.80, 0.86);
    vec3 mineralHint = vec3(0.84, 0.81, 0.76);
    vec3 col = mix(coldObsidianSilver, mineralHint, clamp(spec * 0.45, 0.0, 0.35));

    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Fragment Shader B: Cards Tríptico & Foto Seção 1 (Refração Física Unificada)
// ---------------------------------------------------------------------------

const MEDIA_FRAG_SRC = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uTexture;
  uniform sampler2D uFluidMap;
  uniform vec2 uViewportPx;
  uniform vec2 uSize;          // width, height do card em CSS px
  uniform vec4 uUvCover;       // xy = scale, zw = offset (object-fit: cover)
  uniform float uRadius;       // border-radius em CSS px
  uniform float uMaskMode;     // 0.0 = rounded card + vinheta, 1.0 = mascara eliptica
  uniform float uHover;        // [0..1]
  uniform float uIntensity;

  ${GLSL_SDF_CHUNK}

  void main() {
    vec2 screenUv = vec2(
      gl_FragCoord.x / max(uViewportPx.x, 1.0),
      1.0 - gl_FragCoord.y / max(uViewportPx.y, 1.0)
    );

    vec4 f = texture2D(uFluidMap, screenUv);
    vec2 grad = decodeFluidGrad(f.rg);
    float crest = f.b;
    float active = f.a;
    float localEnergy = max(uHover, max(active, crest));

    if (localEnergy <= 0.003) {
      discard;
    }

    // Recorte geometrico exato
    float shapeMask = 1.0;
    if (uMaskMode < 0.5) {
      vec2 p = (vUv - 0.5) * uSize;
      float sdf = sdRoundedBox(p, uSize * 0.5, uRadius);
      shapeMask = 1.0 - smoothstep(-0.75, 0.75, sdf);
    } else {
      vec2 e = (vUv - 0.5) / vec2(0.34, 0.33);
      float r = length(e);
      shapeMask = 1.0 - smoothstep(0.40, 0.95, r);
    }

    if (shapeMask <= 0.002) {
      discard;
    }

    // Atenua deslocamento nas bordas extremas para manter enquadramento limpo
    float borderDamp =
      smoothstep(0.0, 0.045, vUv.x) *
      smoothstep(0.0, 0.045, 1.0 - vUv.x) *
      smoothstep(0.0, 0.045, vUv.y) *
      smoothstep(0.0, 0.045, 1.0 - vUv.y);

    // Refracao fisica direta pelo gradiente do FluidField compartilhado
    vec2 disp = clamp(grad * 0.016 * uIntensity * borderDamp, vec2(-0.032), vec2(0.032));

    float hoverZoom = 1.0 + 0.028 * uHover;
    vec2 zoomedUv = (vUv - 0.5) / hoverZoom + 0.5;
    vec2 coverUv = zoomedUv * uUvCover.xy + uUvCover.zw;
    vec2 sampleUv = clamp(coverUv + disp, vec2(0.002), vec2(0.998));

    // Dispersao cromatica refrativa delicada apenas onde ha gradiente real
    float dispMag = length(disp);
    vec2 chromaDir = normalize(disp + vec2(0.0001)) * clamp(dispMag * 0.20, 0.0, 0.0028);

    float r = texture2D(uTexture, clamp(sampleUv + chromaDir, vec2(0.001), vec2(0.999))).r;
    float g = texture2D(uTexture, sampleUv).g;
    float b = texture2D(uTexture, clamp(sampleUv - chromaDir, vec2(0.001), vec2(0.999))).b;
    vec3 photo = vec3(r, g, b);

    // Vinheta editorial identica ao .triptych-card::after (sem amarelar)
    if (uMaskMode < 0.5) {
      float topVig = smoothstep(0.22, 0.0, vUv.y) * 0.40;
      float botVig = smoothstep(0.78, 1.0, vUv.y) * 0.50;
      photo *= (1.0 - max(topVig, botVig));
    }

    // Brilho especular fino apenas na crista da onda (prata cristalina limpa)
    vec3 normal = normalize(vec3(-grad * 0.48, 1.0));
    vec3 lightDir = normalize(vec3(-0.32, -0.56, 0.76));
    vec3 halfVec = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(normal, halfVec), 0.0), 30.0);

    vec3 crystalLight = vec3(0.92, 0.94, 0.98);
    photo += crystalLight * (crest * 0.16 + spec * crest * 0.18) * uIntensity;

    // Transicao sem salto entre o <img> nativo e a fotografia refratada
    float blendAlpha = smoothstep(0.0, 0.12, localEnergy) * shapeMask;
    gl_FragColor = vec4(photo * blendAlpha, blendAlpha);
  }
`;

// ---------------------------------------------------------------------------
// Fragment Shader C: Botões Pill SDF (Menisco Líquido + Crista Especular Fina)
// ---------------------------------------------------------------------------

const BUTTON_FRAG_SRC = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform sampler2D uFluidMap;
  uniform vec2 uViewportPx;
  uniform vec2 uSize;          // width, height do botao em CSS px
  uniform float uRadius;       // border-radius computado (pill)
  uniform float uHover;        // [0..1]
  uniform float uIntensity;
  uniform vec2 uMouse;         // cursor em UV local [0..1]

  ${GLSL_SDF_CHUNK}

  void main() {
    vec2 halfSize = uSize * 0.5;
    vec2 p = (vUv - 0.5) * uSize;
    float sdf = sdRoundedBox(p, halfSize, uRadius);

    // Recorte exato na geometria da pilula
    float inside = 1.0 - smoothstep(-0.85, 0.65, sdf);
    if (inside <= 0.002) {
      discard;
    }

    vec2 screenUv = vec2(
      gl_FragCoord.x / max(uViewportPx.x, 1.0),
      1.0 - gl_FragCoord.y / max(uViewportPx.y, 1.0)
    );

    vec4 f = texture2D(uFluidMap, screenUv);
    vec2 grad = decodeFluidGrad(f.rg);
    float crest = f.b;
    float active = f.a;
    float gradLen = length(grad);
    float localEnergy = max(uHover, max(active, crest));

    if (localEnergy <= 0.003) {
      discard;
    }

    // Menisco luminoso fino na borda arredondada
    float distFromEdge = -sdf;
    float meniscusBorder = exp(-pow((distFromEdge - 1.0) * 0.85, 2.0));
    float innerRim = exp(-distFromEdge * 0.18);

    // Proximidade do cursor no botao (somente quando hovered)
    float aspectRatio = clamp(uSize.x / max(uSize.y, 1.0), 1.0, 14.0);
    vec2 md = (vUv - uMouse) * vec2(aspectRatio, 1.0);
    float cursorFocus = exp(-dot(md, md) * 4.5) * uHover;

    // Reflexo especular fino da onda que atravessa o botao
    vec3 normal = normalize(vec3(-grad * 0.55, 1.0));
    vec3 lightDir = normalize(vec3((uMouse.x - 0.5) * 0.8, (uMouse.y - 0.5) * 0.8 - 0.35, 0.85));
    vec3 halfVec = normalize(lightDir + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(normal, halfVec), 0.0), 26.0);

    float waveCrest = pow(max(crest, 0.0), 1.45);
    float borderAlpha = meniscusBorder * (0.28 * uHover + 0.36 * cursorFocus + 0.44 * waveCrest + 0.16 * gradLen);
    float interiorAlpha = (waveCrest * 0.18 + spec * waveCrest * 0.22 + innerRim * 0.07 * uHover);

    float alpha = clamp((borderAlpha + interiorAlpha) * inside * uIntensity, 0.0, 0.64);
    if (alpha <= 0.002) {
      discard;
    }

    vec3 coldSilver = vec3(0.80, 0.84, 0.90);
    vec3 mineralGold = vec3(0.86, 0.76, 0.60);
    vec3 col = mix(coldSilver, mineralGold, clamp(meniscusBorder * 0.52 + cursorFocus * 0.32, 0.0, 0.65));
    col = mix(col, vec3(0.97, 0.98, 1.0), clamp(spec * waveCrest * 0.65, 0.0, 0.65));

    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// ---------------------------------------------------------------------------
// Utilitários WebGL, Fluid Sampling & Layout
// ---------------------------------------------------------------------------

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function injectSurfaceStylesOnce() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${CANVAS_ID} {
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
      z-index: 4;
      contain: strict;
    }

    [data-glsl-surface="media"][data-glsl-surface-ready="true"] .hover-glow-layer {
      opacity: 0;
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
    console.error('[glsl-surfaces] Erro de compilação GLSL:', log);
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
    console.error('[glsl-surfaces] Erro de linkagem GLSL:', log);
    return null;
  }

  return program;
}

function computeCoverTransform(imgW, imgH, boxW, boxH, baseZoom = 1.02) {
  if (!imgW || !imgH || !boxW || !boxH) {
    return { sx: 1, sy: 1, ox: 0, oy: 0 };
  }

  const imgAspect = imgW / imgH;
  const boxAspect = boxW / boxH;

  let sx = 1;
  let sy = 1;
  if (imgAspect > boxAspect) {
    sx = boxAspect / imgAspect;
  } else {
    sy = imgAspect / boxAspect;
  }

  sx /= baseZoom;
  sy /= baseZoom;

  return {
    sx,
    sy,
    ox: (1 - sx) * 0.5,
    oy: (1 - sy) * 0.5,
  };
}

function parseBorderRadiusPx(el, rect) {
  const cs = window.getComputedStyle(el);
  const raw = parseFloat(cs.borderTopLeftRadius);
  if (Number.isNaN(raw)) return 0;
  return Math.min(raw, Math.min(rect.width, rect.height) * 0.5);
}

/**
 * Amostra a atividade máxima do FluidField sobre um retângulo em CSS px (custo O(1) ~16 taps).
 * Evita draw calls desnecessários em cards/botões distantes da onda.
 */
function sampleFluidActivityInRect(fluidField, rect, vw, vh) {
  if (!fluidField || fluidField.isIdle()) return 0;
  const rgba = fluidField.rgbaData;
  const cols = fluidField.cols;
  const rows = fluidField.rows;
  if (!rgba || !cols || !rows) return 0;

  const u0 = clamp(rect.left / Math.max(vw, 1), 0, 1);
  const u1 = clamp(rect.right / Math.max(vw, 1), 0, 1);
  const v0 = clamp(rect.top / Math.max(vh, 1), 0, 1);
  const v1 = clamp(rect.bottom / Math.max(vh, 1), 0, 1);

  if (u1 <= u0 || v1 <= v0) return 0;

  const minC = Math.max(0, Math.floor(u0 * (cols - 1)));
  const maxC = Math.min(cols - 1, Math.ceil(u1 * (cols - 1)));
  const minR = Math.max(0, Math.floor(v0 * (rows - 1)));
  const maxR = Math.min(rows - 1, Math.ceil(v1 * (rows - 1)));

  const stepC = Math.max(1, Math.floor((maxC - minC) / 5));
  const stepR = Math.max(1, Math.floor((maxR - minR) / 4));

  let maxByte = 0;
  for (let r = minR; r <= maxR; r += stepR) {
    const rowOff = r * cols;
    for (let c = minC; c <= maxC; c += stepC) {
      const idx = (rowOff + c) * 4;
      const a = rgba[idx + 3];
      const b = rgba[idx + 2];
      if (a > maxByte) maxByte = a;
      if (b > maxByte) maxByte = b;
    }
  }

  return maxByte / 255;
}

// ---------------------------------------------------------------------------
// Engine Principal: LiquidSurfacesEngine
// ---------------------------------------------------------------------------

export class LiquidSurfacesEngine {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };

    this.fluidField = this.options.fluidField || getSharedFluidField();
    this.fluidTex = null;

    this.canvas = null;
    this.ownsCanvas = false;
    this.gl = null;
    this.quadBuffer = null;

    this.bgProgram = null;
    this.bgUniforms = null;
    this.bgAPos = -1;

    this.mediaProgram = null;
    this.mediaUniforms = null;
    this.mediaAPos = -1;

    this.buttonProgram = null;
    this.buttonUniforms = null;
    this.buttonAPos = -1;

    this.webglReady = false;
    this.isRunning = false;
    this.isDestroyed = false;
    this.contextLost = false;
    this.reducedMotion = false;

    this.dpr = 1;
    this.viewportWidth = 1;
    this.viewportHeight = 1;
    this.rafId = null;
    this.lastFrameTime = 0;
    this.drawCallsLastFrame = 0;

    // Rastreamento de ponteiro para cálculo exato de velocidade (vx, vy em px/s)
    this._lastPtrX = 0;
    this._lastPtrY = 0;
    this._lastPtrTime = -1;

    this.lowerContainers = [];
    this.mediaItems = new Map();
    this.buttonItems = new Map();

    this.reducedMotionQuery = null;
    this.resizeTimer = null;

    this._onWindowResize = this._onWindowResize.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onContextLost = this._onContextLost.bind(this);
    this._onContextRestored = this._onContextRestored.bind(this);
    this._onReducedMotionChange = this._onReducedMotionChange.bind(this);
    this._onGlobalPointerMove = this._onGlobalPointerMove.bind(this);
    this._onGlobalPointerDown = this._onGlobalPointerDown.bind(this);
    this._onGlobalPointerLeave = this._onGlobalPointerLeave.bind(this);
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
    injectSurfaceStylesOnce();

    this.webglReady = this._initWebGL();
    if (!this.webglReady) {
      return this;
    }

    window.__CINDRE_FLUID_FIELD__ = this.fluidField;
    window.__CINDRE_FLUID_DRIVER__ = 'surfaces';

    window.addEventListener('resize', this._onWindowResize, { passive: true });
    document.addEventListener('visibilitychange', this._onVisibilityChange, { passive: true });
    window.addEventListener('pointermove', this._onGlobalPointerMove, { passive: true });
    window.addEventListener('pointerdown', this._onGlobalPointerDown, { passive: true });
    window.addEventListener('cindre:fluid-wake', this._onFluidWake, { passive: true });
    document.addEventListener('pointerleave', this._onGlobalPointerLeave, { passive: true });

    this.scan();
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
      this._clearAndStop();
    }
  }

  _initWebGL() {
    let canvas = document.getElementById(CANVAS_ID);
    if (canvas && canvas.tagName === 'CANVAS') {
      this.ownsCanvas = false;
    } else {
      canvas = document.createElement('canvas');
      canvas.id = CANVAS_ID;
      canvas.setAttribute('aria-hidden', 'true');
      canvas.style.zIndex = String(this.options.zIndex);
      this.ownsCanvas = true;
    }
    canvas.dataset.glslEngine = 'cindre-unified-surfaces';

    const attrs = {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    };

    const gl =
      canvas.getContext('webgl2', attrs) ||
      canvas.getContext('webgl', attrs) ||
      canvas.getContext('experimental-webgl', attrs);

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

    const bgProgram = createProgram(gl, SHARED_VERT_SRC, BG_FRAG_SRC);
    const mediaProgram = createProgram(gl, SHARED_VERT_SRC, MEDIA_FRAG_SRC);
    const buttonProgram = createProgram(gl, SHARED_VERT_SRC, BUTTON_FRAG_SRC);

    if (!bgProgram || !mediaProgram || !buttonProgram) {
      if (bgProgram) gl.deleteProgram(bgProgram);
      if (mediaProgram) gl.deleteProgram(mediaProgram);
      if (buttonProgram) gl.deleteProgram(buttonProgram);
      return false;
    }

    const quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW
    );

    this.quadBuffer = quadBuffer;
    this.fluidTex = this.fluidField.createContextTexture(gl);

    this.bgProgram = bgProgram;
    this.bgAPos = gl.getAttribLocation(bgProgram, 'aPos');
    this.bgUniforms = {
      uRect: gl.getUniformLocation(bgProgram, 'uRect'),
      uViewport: gl.getUniformLocation(bgProgram, 'uViewport'),
      uViewportPx: gl.getUniformLocation(bgProgram, 'uViewportPx'),
      uFluidMap: gl.getUniformLocation(bgProgram, 'uFluidMap'),
      uSize: gl.getUniformLocation(bgProgram, 'uSize'),
      uIntensity: gl.getUniformLocation(bgProgram, 'uIntensity'),
    };

    this.mediaProgram = mediaProgram;
    this.mediaAPos = gl.getAttribLocation(mediaProgram, 'aPos');
    this.mediaUniforms = {
      uRect: gl.getUniformLocation(mediaProgram, 'uRect'),
      uViewport: gl.getUniformLocation(mediaProgram, 'uViewport'),
      uViewportPx: gl.getUniformLocation(mediaProgram, 'uViewportPx'),
      uTexture: gl.getUniformLocation(mediaProgram, 'uTexture'),
      uFluidMap: gl.getUniformLocation(mediaProgram, 'uFluidMap'),
      uSize: gl.getUniformLocation(mediaProgram, 'uSize'),
      uUvCover: gl.getUniformLocation(mediaProgram, 'uUvCover'),
      uRadius: gl.getUniformLocation(mediaProgram, 'uRadius'),
      uMaskMode: gl.getUniformLocation(mediaProgram, 'uMaskMode'),
      uHover: gl.getUniformLocation(mediaProgram, 'uHover'),
      uIntensity: gl.getUniformLocation(mediaProgram, 'uIntensity'),
    };

    this.buttonProgram = buttonProgram;
    this.buttonAPos = gl.getAttribLocation(buttonProgram, 'aPos');
    this.buttonUniforms = {
      uRect: gl.getUniformLocation(buttonProgram, 'uRect'),
      uViewport: gl.getUniformLocation(buttonProgram, 'uViewport'),
      uViewportPx: gl.getUniformLocation(buttonProgram, 'uViewportPx'),
      uFluidMap: gl.getUniformLocation(buttonProgram, 'uFluidMap'),
      uSize: gl.getUniformLocation(buttonProgram, 'uSize'),
      uRadius: gl.getUniformLocation(buttonProgram, 'uRadius'),
      uHover: gl.getUniformLocation(buttonProgram, 'uHover'),
      uIntensity: gl.getUniformLocation(buttonProgram, 'uIntensity'),
      uMouse: gl.getUniformLocation(buttonProgram, 'uMouse'),
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

  // -------------------------------------------------------------------------
  // Descoberta & Registro (Hero #cindre-root / #hero-slot Protegida)
  // -------------------------------------------------------------------------

  _isExcluded(el) {
    if (!el || typeof el.closest !== 'function') return true;
    return Boolean(this.options.excludeSelector && el.closest(this.options.excludeSelector));
  }

  scan(root = document) {
    if (this.isDestroyed || !root || typeof root.querySelectorAll !== 'function') {
      return this;
    }

    this.lowerContainers = Array.from(root.querySelectorAll(this.options.lowerSelector)).filter(
      (el) => el instanceof HTMLElement && !this._isExcluded(el)
    );

    const mediaNodes = root.querySelectorAll(this.options.mediaSelector);
    mediaNodes.forEach((el) => {
      if (el instanceof HTMLElement && !this._isExcluded(el)) {
        this._registerMedia(el);
      }
    });

    const buttonNodes = root.querySelectorAll(this.options.buttonSelector);
    buttonNodes.forEach((el) => {
      if (el instanceof HTMLElement && !this._isExcluded(el)) {
        this._registerButton(el);
      }
    });

    return this;
  }

  _registerMedia(el) {
    if (this.mediaItems.has(el)) return;
    const img = el.querySelector('img');
    if (!img) return;

    const isArtFrame = el.classList.contains('art-media-frame');
    el.setAttribute('data-glsl-surface', 'media');

    const item = {
      el,
      img,
      isArtFrame,
      texture: null,
      textureLoaded: false,
      naturalWidth: 0,
      naturalHeight: 0,
      hovered: false,
      hover: 0,
      listeners: null,
    };

    const uploadIfReady = () => {
      if (!this.isDestroyed && !this.contextLost && img.complete && img.naturalWidth > 0) {
        this._uploadImageTexture(item);
      }
    };

    const onEnter = (event) => {
      if (this.reducedMotion || this.contextLost || !this.webglReady) return;
      if (event.pointerType === 'touch') return;
      if (!item.textureLoaded) this._uploadImageTexture(item);
      item.hovered = true;
      this.fluidField.injectPointer(event.clientX, event.clientY, 0, 0, 56, 0.9);
      this._ensureRunning();
    };
    const onLeave = () => {
      item.hovered = false;
    };

    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    img.addEventListener('load', uploadIfReady, { passive: true });

    item.listeners = { onEnter, onLeave, uploadIfReady };
    this.mediaItems.set(el, item);

    uploadIfReady();
  }

  _uploadImageTexture(item) {
    const gl = this.gl;
    const img = item.img;
    if (!gl || this.contextLost || !img || !img.complete || img.naturalWidth === 0) {
      return false;
    }

    try {
      if (!item.texture) {
        item.texture = gl.createTexture();
      }
      gl.bindTexture(gl.TEXTURE_2D, item.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.bindTexture(gl.TEXTURE_2D, null);

      item.naturalWidth = img.naturalWidth;
      item.naturalHeight = img.naturalHeight;
      item.textureLoaded = true;
      item.el.setAttribute('data-glsl-surface-ready', 'true');
      return true;
    } catch (error) {
      console.warn('[glsl-surfaces] Não foi possível carregar textura de mídia:', error);
      return false;
    }
  }

  _registerButton(el) {
    if (this.buttonItems.has(el)) return;
    el.setAttribute('data-glsl-surface', 'button');

    const item = {
      el,
      hovered: false,
      hover: 0,
      mouseX: 0.5,
      mouseY: 0.5,
      targetMouseX: 0.5,
      targetMouseY: 0.5,
      listeners: null,
    };

    const updateBtnUv = (event) => {
      const rect = el.getBoundingClientRect();
      item.targetMouseX = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
      item.targetMouseY = clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1);
    };

    const onEnter = (event) => {
      if (this.reducedMotion || this.contextLost || !this.webglReady) return;
      if (event.pointerType === 'touch') return;
      item.hovered = true;
      updateBtnUv(event);
      item.mouseX = item.targetMouseX;
      item.mouseY = item.targetMouseY;
      this.fluidField.injectPointer(event.clientX, event.clientY, 0, 0, 46, 0.85);
      this._ensureRunning();
    };

    const onMove = (event) => {
      if (this.reducedMotion || this.contextLost || !this.webglReady) return;
      if (event.pointerType === 'touch') return;
      item.hovered = true;
      updateBtnUv(event);
      this._ensureRunning();
    };

    const onLeave = () => {
      item.hovered = false;
    };

    const onDown = (event) => {
      if (this.reducedMotion || this.contextLost || !this.webglReady) return;
      updateBtnUv(event);
      this.fluidField.injectPointer(event.clientX, event.clientY, 0, 0, 58, 1.15);
      this._ensureRunning();
    };

    const onFocus = () => {
      if (this.reducedMotion || this.contextLost || !this.webglReady) return;
      item.hovered = true;
      item.targetMouseX = 0.5;
      item.targetMouseY = 0.5;
      const rect = el.getBoundingClientRect();
      this.fluidField.injectPointer(
        rect.left + rect.width * 0.5,
        rect.top + rect.height * 0.5,
        0,
        0,
        48,
        0.75
      );
      this._ensureRunning();
    };

    const onBlur = () => {
      item.hovered = false;
    };

    el.addEventListener('pointerenter', onEnter, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerleave', onLeave, { passive: true });
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('focus', onFocus, { passive: true });
    el.addEventListener('blur', onBlur, { passive: true });

    item.listeners = { onEnter, onMove, onLeave, onDown, onFocus, onBlur };
    this.buttonItems.set(el, item);
  }

  // -------------------------------------------------------------------------
  // Injeção Unificada no FluidField Compartilhado (Fora da Hero #cindre-root)
  // -------------------------------------------------------------------------

  _getLowerBoundsInViewport() {
    if (!this.lowerContainers.length) {
      return null;
    }

    let minTop = Infinity;
    let maxBottom = -Infinity;

    for (let i = 0; i < this.lowerContainers.length; i += 1) {
      const r = this.lowerContainers[i].getBoundingClientRect();
      if (r.height <= 0) continue;
      if (r.top < minTop) minTop = r.top;
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    }

    if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom)) {
      return null;
    }

    const top = Math.max(0, minTop);
    const bottom = Math.min(this.viewportHeight, maxBottom);
    const height = bottom - top;

    if (height <= 2) {
      return null;
    }

    return {
      x: 0,
      y: top,
      w: this.viewportWidth,
      h: height,
      rawTop: minTop,
    };
  }

  _isPointerInLowerZone(event) {
    if (document.body.classList.contains('modal-open')) return false;
    if (event.target instanceof Element && this._isExcluded(event.target)) return false;

    const bounds = this._getLowerBoundsInViewport();
    if (!bounds) return false;
    return event.clientY >= bounds.y && event.clientY <= bounds.y + bounds.h;
  }

  _onGlobalPointerMove(event) {
    if (this.reducedMotion || this.contextLost || !this.webglReady) return;
    if (event.pointerType === 'touch') return;

    if (!this._isPointerInLowerZone(event)) {
      this._lastPtrTime = -1;
      return;
    }

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

    this.fluidField.injectPointer(event.clientX, event.clientY, vx, vy, 54, 0.95);
    this._ensureRunning();
  }

  _onGlobalPointerDown(event) {
    if (this.reducedMotion || this.contextLost || !this.webglReady) return;
    if (!this._isPointerInLowerZone(event)) return;

    this.fluidField.injectPointer(event.clientX, event.clientY, 0, 0, 62, 1.15);
    this._ensureRunning();
  }

  _onGlobalPointerLeave() {
    this._lastPtrTime = -1;
  }

  _onFluidWake() {
    if (!this.reducedMotion && !this.contextLost && this.webglReady && !this.fluidField.isIdle()) {
      this._ensureRunning();
    }
  }

  _notifyFluidWake() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cindre:fluid-wake'));
    }
  }

  // -------------------------------------------------------------------------
  // API Pública: pulseSurface, refresh, getStats, destroy
  // -------------------------------------------------------------------------

  pulseSurface(el, strength = 0.9) {
    if (this.isDestroyed || this.reducedMotion || this.contextLost || !this.webglReady) {
      return;
    }

    const power = clamp(Number.isFinite(strength) ? strength : 0.9, 0.2, 1.4);

    if (el instanceof HTMLElement && !this._isExcluded(el)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const cx = rect.left + rect.width * 0.5;
        const cy = rect.top + rect.height * 0.5;
        const radius = clamp(Math.max(rect.width, rect.height) * 0.22, 42, 72);
        this.fluidField.injectPointer(cx, cy, 0, 0, radius, power);
      }

      const mediaItem =
        this.mediaItems.get(el) || this.mediaItems.get(el.closest(this.options.mediaSelector));
      if (mediaItem && !mediaItem.textureLoaded) {
        this._uploadImageTexture(mediaItem);
      }
    }

    this._ensureRunning();
    this._notifyFluidWake();
  }

  refresh(root = document) {
    if (this.isDestroyed) return this;
    this._resizeCanvas();
    this.scan(root);
    this.mediaItems.forEach((item) => {
      if (!item.textureLoaded && item.img.complete && item.img.naturalWidth > 0) {
        this._uploadImageTexture(item);
      }
    });
    return this;
  }

  getStats() {
    let mediaTextures = 0;
    this.mediaItems.forEach((item) => {
      if (item.textureLoaded) mediaTextures += 1;
    });

    return {
      lowerContainers: this.lowerContainers.length,
      registeredMedia: this.mediaItems.size,
      mediaTexturesLoaded: mediaTextures,
      registeredButtons: this.buttonItems.size,
      fluidEnergy: Number(this.fluidField.getEnergy().toFixed(3)),
      fluidIdle: this.fluidField.isIdle(),
      drawCallsLastFrame: this.drawCallsLastFrame,
      isRunning: this.isRunning,
      dpr: this.dpr,
      contextLost: this.contextLost,
    };
  }

  // -------------------------------------------------------------------------
  // Loop de Renderização Demand-Driven (0 draw calls quando fluidField.isIdle())
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

  _clearAndStop() {
    this.mediaItems.forEach((item) => {
      item.hovered = false;
      item.hover = 0;
    });
    this.buttonItems.forEach((item) => {
      item.hovered = false;
      item.hover = 0;
    });
    if (this.gl && !this.contextLost) {
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
    this._stopLoop();
  }

  _frame(now) {
    if (!this.isRunning || this.isDestroyed || this.contextLost) return;

    const dt = Math.min(Math.max((now - this.lastFrameTime) / 1000, 0.001), 0.05);
    this.lastFrameTime = now;

    // Avança e sincroniza o FluidField compartilhado uma única vez por frame
    this.fluidField.advanceToTime(now);
    const gl = this.gl;
    if (this.fluidTex) {
      this.fluidField.syncToContext(gl, this.fluidTex);
    }

    const fluidActive = !this.fluidField.isIdle();
    const vw = this.viewportWidth;
    const vh = this.viewportHeight;
    const vpPxW = this.canvas.width;
    const vpPxH = this.canvas.height;

    gl.viewport(0, 0, vpPxW, vpPxH);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);

    const attackK = 1 - Math.exp(-9.0 * dt);
    const releaseK = 1 - Math.exp(-3.2 * dt);
    const mouseK = 1 - Math.exp(-15.0 * dt);

    let activeCount = fluidActive ? 1 : 0;
    let drawCalls = 0;

    // Bind da textura compartilhada de fluido na unidade TEXTURE1
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fluidTex);

    // -----------------------------------------------------------------------
    // 1. PASS A: Fundo Basalto (apenas crista especular fina — ZERO mancha)
    // -----------------------------------------------------------------------
    if (fluidActive) {
      const bounds = this._getLowerBoundsInViewport();
      if (bounds) {
        const u = this.bgUniforms;
        gl.useProgram(this.bgProgram);
        gl.enableVertexAttribArray(this.bgAPos);
        gl.vertexAttribPointer(this.bgAPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(u.uViewport, vw, vh);
        gl.uniform2f(u.uViewportPx, vpPxW, vpPxH);
        gl.uniform4f(u.uRect, bounds.x, bounds.y, bounds.w, bounds.h);
        gl.uniform2f(u.uSize, bounds.w, bounds.h);
        gl.uniform1i(u.uFluidMap, 1);
        gl.uniform1f(u.uIntensity, this.options.bgIntensity);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        drawCalls += 1;
      }
    }

    // -----------------------------------------------------------------------
    // 2. PASS B: Cards do Tríptico & Foto da Seção 1 (Refração Unificada)
    // -----------------------------------------------------------------------
    let mediaProgramBound = false;
    this.mediaItems.forEach((item) => {
      const targetHover = item.hovered ? 1.0 : 0.0;
      const k = item.hovered ? attackK : releaseK;
      item.hover += (targetHover - item.hover) * k;
      if (!item.hovered && item.hover < ENERGY_EPSILON) {
        item.hover = 0;
      }

      if (item.hover <= 0 && !fluidActive) return;

      const rect = item.el.getBoundingClientRect();
      if (
        rect.width < 2 ||
        rect.height < 2 ||
        rect.right < 0 ||
        rect.left > vw ||
        rect.bottom < 0 ||
        rect.top > vh
      ) {
        return;
      }

      const localFluid = fluidActive
        ? sampleFluidActivityInRect(this.fluidField, rect, vw, vh)
        : 0;

      if (item.hover <= ENERGY_EPSILON && localFluid < FLUID_RECT_THRESHOLD) {
        return;
      }

      activeCount += 1;

      if (!item.textureLoaded || !item.texture) {
        if (!this._uploadImageTexture(item)) return;
      }

      if (!mediaProgramBound) {
        gl.useProgram(this.mediaProgram);
        gl.enableVertexAttribArray(this.mediaAPos);
        gl.vertexAttribPointer(this.mediaAPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(this.mediaUniforms.uViewport, vw, vh);
        gl.uniform2f(this.mediaUniforms.uViewportPx, vpPxW, vpPxH);
        gl.uniform1i(this.mediaUniforms.uTexture, 0);
        gl.uniform1i(this.mediaUniforms.uFluidMap, 1);
        gl.uniform1f(this.mediaUniforms.uIntensity, this.options.mediaIntensity);
        mediaProgramBound = true;
      }

      const cover = computeCoverTransform(
        item.naturalWidth,
        item.naturalHeight,
        rect.width,
        rect.height,
        1.02
      );
      const radius = item.isArtFrame ? 0 : parseBorderRadiusPx(item.el, rect);

      const u = this.mediaUniforms;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, item.texture);
      gl.uniform4f(u.uRect, rect.left, rect.top, rect.width, rect.height);
      gl.uniform2f(u.uSize, rect.width, rect.height);
      gl.uniform4f(u.uUvCover, cover.sx, cover.sy, cover.ox, cover.oy);
      gl.uniform1f(u.uRadius, radius);
      gl.uniform1f(u.uMaskMode, item.isArtFrame ? 1.0 : 0.0);
      gl.uniform1f(u.uHover, item.hover);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls += 1;
    });

    // -----------------------------------------------------------------------
    // 3. PASS C: Botões Pill SDF (Menisco Líquido + Crista Unificada)
    // -----------------------------------------------------------------------
    let buttonProgramBound = false;
    this.buttonItems.forEach((item) => {
      const targetHover = item.hovered ? 1.0 : 0.0;
      const k = item.hovered ? attackK : releaseK;
      item.hover += (targetHover - item.hover) * k;
      if (!item.hovered && item.hover < ENERGY_EPSILON) {
        item.hover = 0;
      }
      item.mouseX += (item.targetMouseX - item.mouseX) * mouseK;
      item.mouseY += (item.targetMouseY - item.mouseY) * mouseK;

      if (item.hover <= 0 && !fluidActive) return;

      const rect = item.el.getBoundingClientRect();
      if (
        rect.width < 2 ||
        rect.height < 2 ||
        rect.right < 0 ||
        rect.left > vw ||
        rect.bottom < 0 ||
        rect.top > vh
      ) {
        return;
      }

      const localFluid = fluidActive
        ? sampleFluidActivityInRect(this.fluidField, rect, vw, vh)
        : 0;

      if (item.hover <= ENERGY_EPSILON && localFluid < FLUID_RECT_THRESHOLD) {
        return;
      }

      activeCount += 1;

      if (!buttonProgramBound) {
        gl.useProgram(this.buttonProgram);
        gl.enableVertexAttribArray(this.buttonAPos);
        gl.vertexAttribPointer(this.buttonAPos, 2, gl.FLOAT, false, 0, 0);
        gl.uniform2f(this.buttonUniforms.uViewport, vw, vh);
        gl.uniform2f(this.buttonUniforms.uViewportPx, vpPxW, vpPxH);
        gl.uniform1i(this.buttonUniforms.uFluidMap, 1);
        gl.uniform1f(this.buttonUniforms.uIntensity, this.options.buttonIntensity);
        buttonProgramBound = true;
      }

      const radius = parseBorderRadiusPx(item.el, rect);
      const u = this.buttonUniforms;
      gl.uniform4f(u.uRect, rect.left, rect.top, rect.width, rect.height);
      gl.uniform2f(u.uSize, rect.width, rect.height);
      gl.uniform1f(u.uRadius, radius);
      gl.uniform1f(u.uHover, item.hover);
      gl.uniform2f(u.uMouse, item.mouseX, item.mouseY);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      drawCalls += 1;
    });

    this.drawCallsLastFrame = drawCalls;

    if (activeCount > 0) {
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
        this._resizeCanvas();
      }
    }, 140);
  }

  _onVisibilityChange() {
    if (document.hidden) {
      this._stopLoop();
    } else if (!this.fluidField.isIdle()) {
      this._ensureRunning();
    }
  }

  _onContextLost(event) {
    event.preventDefault();
    this.contextLost = true;
    this.fluidTex = null;
    this._clearAndStop();
    this.mediaItems.forEach((item) => {
      item.texture = null;
      item.textureLoaded = false;
      item.el.removeAttribute('data-glsl-surface-ready');
    });
  }

  _onContextRestored() {
    if (this.isDestroyed || !this.gl) return;
    if (!this._buildGpuResources()) return;
    this.contextLost = false;
    this._resizeCanvas();
    this.mediaItems.forEach((item) => {
      this._uploadImageTexture(item);
    });
  }

  destroy() {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this._stopLoop();

    clearTimeout(this.resizeTimer);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onWindowResize);
      window.removeEventListener('pointermove', this._onGlobalPointerMove);
      window.removeEventListener('pointerdown', this._onGlobalPointerDown);
      window.removeEventListener('cindre:fluid-wake', this._onFluidWake);
      if (window.__CINDRE_FLUID_DRIVER__ === 'surfaces') {
        delete window.__CINDRE_FLUID_DRIVER__;
      }
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.removeEventListener('pointerleave', this._onGlobalPointerLeave);
    }

    if (this.reducedMotionQuery && typeof this.reducedMotionQuery.removeEventListener === 'function') {
      this.reducedMotionQuery.removeEventListener('change', this._onReducedMotionChange);
    }

    this.mediaItems.forEach((item) => {
      const { el, img, listeners } = item;
      if (listeners) {
        el.removeEventListener('pointerenter', listeners.onEnter);
        el.removeEventListener('pointerleave', listeners.onLeave);
        img.removeEventListener('load', listeners.uploadIfReady);
      }
      el.removeAttribute('data-glsl-surface');
      el.removeAttribute('data-glsl-surface-ready');
      if (item.texture && this.gl && !this.contextLost) {
        this.gl.deleteTexture(item.texture);
      }
      item.texture = null;
    });
    this.mediaItems.clear();

    this.buttonItems.forEach((item) => {
      const { el, listeners } = item;
      if (listeners) {
        el.removeEventListener('pointerenter', listeners.onEnter);
        el.removeEventListener('pointermove', listeners.onMove);
        el.removeEventListener('pointerleave', listeners.onLeave);
        el.removeEventListener('pointerdown', listeners.onDown);
        el.removeEventListener('focus', listeners.onFocus);
        el.removeEventListener('blur', listeners.onBlur);
      }
      el.removeAttribute('data-glsl-surface');
    });
    this.buttonItems.clear();
    this.lowerContainers.length = 0;

    if (this.gl && !this.contextLost) {
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
      if (this.fluidTex) this.gl.deleteTexture(this.fluidTex);
      if (this.quadBuffer) this.gl.deleteBuffer(this.quadBuffer);
      if (this.bgProgram) this.gl.deleteProgram(this.bgProgram);
      if (this.mediaProgram) this.gl.deleteProgram(this.mediaProgram);
      if (this.buttonProgram) this.gl.deleteProgram(this.buttonProgram);
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
    this.quadBuffer = null;
    this.bgProgram = null;
    this.mediaProgram = null;
    this.buttonProgram = null;
  }
}

// ---------------------------------------------------------------------------
// API Pública Singleton (ESM)
// ---------------------------------------------------------------------------

let singletonSurfaces = null;

export async function initLiquidSurfacesEngine(options = {}) {
  if (singletonSurfaces && !singletonSurfaces.isDestroyed) {
    if (options && Object.keys(options).length > 0) {
      Object.assign(singletonSurfaces.options, options);
    }
    singletonSurfaces.refresh();
    return singletonSurfaces;
  }

  singletonSurfaces = new LiquidSurfacesEngine(options).init();

  if (typeof window !== 'undefined') {
    window.__BASALTE_GLSL_SURFACES__ = singletonSurfaces;
    window.__CINDRE_GLSL_SURFACES__ = singletonSurfaces;
  }

  return singletonSurfaces;
}

export const initGlslSurfaces = initLiquidSurfacesEngine;

export function refreshLiquidSurfaces(root = document) {
  if (!singletonSurfaces || singletonSurfaces.isDestroyed) {
    return initLiquidSurfacesEngine();
  }
  return singletonSurfaces.refresh(root);
}

export function destroyLiquidSurfaces() {
  if (singletonSurfaces) {
    singletonSurfaces.destroy();
    singletonSurfaces = null;
  }
  if (typeof window !== 'undefined') {
    delete window.__BASALTE_GLSL_SURFACES__;
    delete window.__CINDRE_GLSL_SURFACES__;
  }
}

export default initLiquidSurfacesEngine;
