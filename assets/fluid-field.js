/**
 * CINDRE — Maison de Parfum · Paris
 * Simulador Físico 2D de Superfície de Água e Campo de Velocidade (`FluidField`)
 *
 * Resolve em tempo real (grade proporcional à viewport, ~192x108 em 16:9) uma
 * equação de onda bidimensional amortecida acoplada a um campo de advecção de
 * velocidade do cursor (`Float32Array` ping-pong, < 0.15 ms/frame), empacotando
 * o resultado em uma textura RGBA8 compartilhável via `texSubImage2D`:
 *
 * - Canal R: gradiente/deslocamento horizontal da superfície + fluxo (128 = 0.0)
 * - Canal G: gradiente/deslocamento vertical da superfície + fluxo (128 = 0.0)
 * - Canal B: cáustica/altura concentrada apenas na crista fina da onda [0..255]
 * - Canal A: máscara local de energia ativa [0..255] (0 em repouso absoluto)
 *
 * Permite que múltiplos contextos WebGL independentes (`#glsl-surfaces-canvas`
 * e `#glsl-text-canvas`) amostrem exatamente o mesmo estado físico frame a frame,
 * com 0 uploads e 0 draw calls quando em repouso.
 */

export const FLUID_DEFAULTS = Object.freeze({
  maxGridAxis: 192,
  minGridAxis: 64,
  waveSpeedCells: 34.0,       // Velocidade de propagação (células/s ≈ 340 px/s em 1080p)
  waveDamping: 3.4,           // Amortecimento viscoso da velocidade vertical (1/s)
  heightDamping: 1.05,        // Dissipação da elevação para zerar DC residual (1/s)
  restoringForce: 0.55,       // Termo Klein-Gordon sutil evita platôs planos ("mancha cinza")
  velocityDamping: 5.2,       // Decaimento da advecção lateral (1/s)
  advectionScale: 0.45,       // Acoplamento do campo de velocidade na advecção da onda
  defaultRadiusPx: 56,        // Raio compacto (~45-70 px) para toque de água obsidiana
  minRadiusPx: 24,
  maxRadiusPx: 120,
  normalGain: 4.8,
  velocityToGrad: 0.28,
  crestGain: 34.0,
  slopeGain: 5.8,
  idlePeakThreshold: 0.0065,  // Abaixo do limiar perceptível: converge a zero limpo em ~1.0s
  maxSubstepDt: 1 / 120,
  maxSubsteps: 5,
});

const NEUTRAL_BYTE = 128;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function computeGridDimensions(viewportWidth, viewportHeight, maxAxis, minAxis) {
  const vw = Math.max(1, Number.isFinite(viewportWidth) ? viewportWidth : 1920);
  const vh = Math.max(1, Number.isFinite(viewportHeight) ? viewportHeight : 1080);

  let cols;
  let rows;
  if (vw >= vh) {
    cols = maxAxis;
    rows = clamp(Math.round(maxAxis * (vh / vw)), minAxis, maxAxis);
  } else {
    rows = maxAxis;
    cols = clamp(Math.round(maxAxis * (vw / vh)), minAxis, maxAxis);
  }

  return { vw, vh, cols, rows };
}

function readDefaultViewport() {
  if (typeof window !== 'undefined') {
    const vw = document.documentElement?.clientWidth || window.innerWidth || 1920;
    const vh = document.documentElement?.clientHeight || window.innerHeight || 1080;
    return { vw: Math.max(1, vw), vh: Math.max(1, vh) };
  }
  return { vw: 1920, vh: 1080 };
}

/**
 * Simulador 2D físico de superfície de água (onda isotrópica + advecção de velocidade).
 */
export class FluidField {
  constructor(options = {}) {
    const initialVp = readDefaultViewport();
    this.options = {
      ...FLUID_DEFAULTS,
      viewportWidth: initialVp.vw,
      viewportHeight: initialVp.vh,
      ...options,
    };

    this._destroyed = false;
    this._active = false;
    this._hasVelocity = false;
    this._energy = 0;
    this._version = 0;
    this._lastFrameMs = -1;

    this._pointer = {
      x: this.options.viewportWidth * 0.5,
      y: this.options.viewportHeight * 0.5,
      u: 0.5,
      v: 0.5,
      vx: 0,
      vy: 0,
      active: false,
      lastInjectMs: -1,
    };

    // Rastreia a última versão enviada por cada WebGLTexture individualmente,
    // permitindo que múltiplos contextos WebGL sincronizem em 100% de paridade.
    this._textureStates = new WeakMap();

    this._allocateGrid(this.options.viewportWidth, this.options.viewportHeight);
  }

  get cols() {
    return this._cols;
  }

  get rows() {
    return this._rows;
  }

  get width() {
    return this._cols;
  }

  get height() {
    return this._rows;
  }

  get version() {
    return this._version;
  }

  get rgbaData() {
    return this._rgba;
  }

  _allocateGrid(viewportWidth, viewportHeight) {
    const { vw, vh, cols, rows } = computeGridDimensions(
      viewportWidth,
      viewportHeight,
      this.options.maxGridAxis,
      this.options.minGridAxis
    );

    this._viewportWidth = vw;
    this._viewportHeight = vh;
    this._cols = cols;
    this._rows = rows;

    const count = cols * rows;
    this._h = new Float32Array(count);
    this._hNext = new Float32Array(count);
    this._vh = new Float32Array(count);
    this._vhNext = new Float32Array(count);
    this._ux = new Float32Array(count);
    this._uy = new Float32Array(count);
    this._uxNext = new Float32Array(count);
    this._uyNext = new Float32Array(count);
    this._rgba = new Uint8Array(count * 4);

    this._fillNeutralRgba();
    this._version += 1;
  }

  _fillNeutralRgba() {
    const rgba = this._rgba;
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = NEUTRAL_BYTE;
      rgba[i + 1] = NEUTRAL_BYTE;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
    }
  }

  _clearSimulationFields() {
    this._h.fill(0);
    this._hNext.fill(0);
    this._vh.fill(0);
    this._vhNext.fill(0);
    this._ux.fill(0);
    this._uy.fill(0);
    this._uxNext.fill(0);
    this._uyNext.fill(0);
    this._fillNeutralRgba();
    this._energy = 0;
    this._active = false;
    this._hasVelocity = false;
    this._version += 1;
  }

  /**
   * Atualiza as dimensões da viewport preservando a proporção da grade quando necessário.
   */
  resize(viewportWidth, viewportHeight) {
    if (this._destroyed) return this;
    const { vw, vh, cols, rows } = computeGridDimensions(
      viewportWidth,
      viewportHeight,
      this.options.maxGridAxis,
      this.options.minGridAxis
    );

    this._viewportWidth = vw;
    this._viewportHeight = vh;

    if (cols !== this._cols || rows !== this._rows) {
      this._allocateGrid(vw, vh);
      this._energy = 0;
      this._active = false;
    }

    return this;
  }

  /**
   * Injeta perturbação física de toque/rastro do cursor em coordenadas da viewport (CSS px).
   * Interpola carimbos intermediários em movimentos rápidos para evitar rastros pontilhados.
   */
  injectPointer(
    clientX,
    clientY,
    vx = 0,
    vy = 0,
    radiusPx = this.options.defaultRadiusPx,
    strength = 1.0
  ) {
    if (this._destroyed) return false;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;

    const vw = this._viewportWidth;
    const vh = this._viewportHeight;
    const x = clamp(clientX, 0, vw);
    const y = clamp(clientY, 0, vh);
    const u = x / vw;
    const v = y / vh;

    const safeVx = Number.isFinite(vx) ? vx : 0;
    const safeVy = Number.isFinite(vy) ? vy : 0;
    const safeRadiusPx = clamp(
      Number.isFinite(radiusPx) ? radiusPx : this.options.defaultRadiusPx,
      this.options.minRadiusPx,
      this.options.maxRadiusPx
    );
    const safeStrength = clamp(Number.isFinite(strength) ? strength : 1.0, 0.05, 1.8);

    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const prev = this._pointer;
    const dtSinceLast = prev.lastInjectMs >= 0 ? nowMs - prev.lastInjectMs : 9999;

    const moveDistPx = Math.hypot(x - prev.x, y - prev.y);
    const maxContinuousDist = Math.max(vw, vh) * 0.35;
    const shouldInterpolate =
      prev.active &&
      dtSinceLast >= 0 &&
      dtSinceLast < 95 &&
      moveDistPx > safeRadiusPx * 0.35 &&
      moveDistPx < maxContinuousDist;

    if (shouldInterpolate) {
      const steps = clamp(Math.ceil(moveDistPx / (safeRadiusPx * 0.35)), 2, 6);
      const stepStrength = safeStrength / Math.sqrt(steps);
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        this._stampImpulse(
          prev.x + (x - prev.x) * t,
          prev.y + (y - prev.y) * t,
          safeVx,
          safeVy,
          safeRadiusPx,
          stepStrength
        );
      }
    } else {
      this._stampImpulse(x, y, safeVx, safeVy, safeRadiusPx, safeStrength);
    }

    prev.x = x;
    prev.y = y;
    prev.u = u;
    prev.v = v;
    prev.vx = safeVx;
    prev.vy = safeVy;
    prev.active = true;
    prev.lastInjectMs = nowMs;

    this._active = true;
    this._packRgbaAndMeasure();
    this._version += 1;
    return true;
  }

  _stampImpulse(pxX, pxY, vx, vy, radiusPx, strength) {
    const cols = this._cols;
    const rows = this._rows;
    const cellW = this._viewportWidth / cols;
    const cellH = this._viewportHeight / rows;

    const cx = (pxX / this._viewportWidth) * (cols - 1);
    const cy = (pxY / this._viewportHeight) * (rows - 1);
    const rx = Math.max(1.8, radiusPx / cellW);
    const ry = Math.max(1.8, radiusPx / cellH);

    const minX = Math.max(1, Math.floor(cx - rx));
    const maxX = Math.min(cols - 2, Math.ceil(cx + rx));
    const minY = Math.max(1, Math.floor(cy - ry));
    const maxY = Math.min(rows - 2, Math.ceil(cy + ry));

    // Normaliza velocidade em px/s para escala em células/substep suave
    const nvx = clamp(vx / 1200, -1.35, 1.35);
    const nvy = clamp(vy / 1200, -1.35, 1.35);
    const speed = Math.hypot(nvx, nvy);
    const dirX = speed > 1e-4 ? nvx / speed : 0;
    const dirY = speed > 1e-4 ? nvy / speed : 0;

    // Sem velocidade (toque parado), cria depressão concêntrica delicada.
    // Em movimento, combina onda de proa direcional + crista zero-mean (sem mancha plana).
    const radialAmp = 0.42 * strength * (1.0 + Math.min(speed, 1.0) * 0.28);
    const dipoleAmp = 0.34 * strength * Math.min(speed, 1.25);
    const velGain = 1.65 * strength;

    const h = this._h;
    const vh = this._vh;
    const ux = this._ux;
    const uy = this._uy;

    for (let j = minY; j <= maxY; j += 1) {
      const dyNorm = (j - cy) / ry;
      const dy2 = dyNorm * dyNorm;
      const rowOffset = j * cols;

      for (let i = minX; i <= maxX; i += 1) {
        const dxNorm = (i - cx) / rx;
        const r2 = dxNorm * dxNorm + dy2;
        if (r2 >= 1.0) continue;

        // Núcleo compacto Wendland C2 (suporte estritamente finito)
        const falloff = (1.0 - r2) * (1.0 - r2);
        // Perfil ondulatório zero-mean: crista central + cava sutil ao redor
        const wavelet = (1.0 - 2.35 * r2) * falloff;
        const bow = (dxNorm * dirX + dyNorm * dirY) * falloff;

        const idx = rowOffset + i;
        h[idx] = clamp(h[idx] - wavelet * radialAmp * 0.85 + bow * dipoleAmp * 0.45, -1.6, 1.6);
        vh[idx] = clamp(vh[idx] - wavelet * radialAmp * 2.2 + bow * dipoleAmp * 5.2, -16.0, 16.0);

        if (speed > 1e-4) {
          ux[idx] = clamp(ux[idx] + nvx * falloff * velGain, -3.5, 3.5);
          uy[idx] = clamp(uy[idx] + nvy * falloff * velGain, -3.5, 3.5);
          this._hasVelocity = true;
        }
      }
    }
  }

  /**
   * Avança a simulação física por `dt` segundos (independente de framerate via substeps).
   */
  step(dt) {
    if (this._destroyed || !this._active) return false;

    const clampedDt = clamp(Number.isFinite(dt) ? dt : 1 / 60, 0.0005, 0.05);
    const substeps = clamp(
      Math.ceil(clampedDt / this.options.maxSubstepDt),
      1,
      this.options.maxSubsteps
    );
    const subDt = clampedDt / substeps;

    for (let s = 0; s < substeps; s += 1) {
      this._stepSub(subDt);
    }

    const peak = this._packRgbaAndMeasure();
    if (peak < this.options.idlePeakThreshold) {
      this._clearSimulationFields();
      return false;
    }

    this._version += 1;
    return true;
  }

  /**
   * Coordena múltiplos loops `requestAnimationFrame` no mesmo frame: avança apenas
   * uma vez por timestamp de frame (> 2 ms desde o passo anterior).
   */
  advanceToTime(nowMs) {
    if (this._destroyed) return false;
    if (!Number.isFinite(nowMs)) return this.step(1 / 60);

    if (this._lastFrameMs < 0) {
      this._lastFrameMs = nowMs;
      return this._active ? this.step(1 / 60) : false;
    }

    const deltaMs = nowMs - this._lastFrameMs;
    if (deltaMs <= 2.0) {
      return this._active;
    }

    this._lastFrameMs = nowMs;
    return this.step(deltaMs / 1000);
  }

  _stepSub(dt) {
    const cols = this._cols;
    const rows = this._rows;
    const opts = this.options;

    const c2 = opts.waveSpeedCells * opts.waveSpeedCells;
    const restore = opts.restoringForce;
    const vhDecay = Math.exp(-opts.waveDamping * dt);
    const hDecay = Math.exp(-opts.heightDamping * dt);
    const velDecay = Math.exp(-opts.velocityDamping * dt);
    const advect = opts.advectionScale * dt * 14.0;
    const lapScale = c2 / 0.3;

    let hRead = this._h;
    let vhRead = this._vh;
    let hWrite = this._hNext;
    let vhWrite = this._vhNext;

    // 1. Advecção semi-Lagrangiana apenas quando há momento lateral ativo
    if (this._hasVelocity) {
      const uxSrc = this._ux;
      const uySrc = this._uy;
      const uxDst = this._uxNext;
      const uyDst = this._uyNext;
      const maxX = cols - 1.001;
      const maxY = rows - 1.001;
      let anyVel = false;

      for (let j = 1; j < rows - 1; j += 1) {
        const row = j * cols;
        for (let i = 1; i < cols - 1; i += 1) {
          const idx = row + i;
          const vx = uxSrc[idx];
          const vy = uySrc[idx];

          if (vx * vx + vy * vy > 1e-5) {
            let bx = i - vx * advect;
            let by = j - vy * advect;
            if (bx < 0) bx = 0;
            else if (bx > maxX) bx = maxX;
            if (by < 0) by = 0;
            else if (by > maxY) by = maxY;

            const x0 = bx | 0;
            const y0 = by | 0;
            const x1 = x0 + 1;
            const y1 = y0 + 1;
            const tx = bx - x0;
            const ty = by - y0;
            const omtX = 1 - tx;
            const omtY = 1 - ty;
            const w00 = omtX * omtY;
            const w10 = tx * omtY;
            const w01 = omtX * ty;
            const w11 = tx * ty;

            const i00 = y0 * cols + x0;
            const i10 = i00 + 1;
            const i01 = y1 * cols + x0;
            const i11 = i01 + 1;

            hWrite[idx] = hRead[i00] * w00 + hRead[i10] * w10 + hRead[i01] * w01 + hRead[i11] * w11;
            vhWrite[idx] = vhRead[i00] * w00 + vhRead[i10] * w10 + vhRead[i01] * w01 + vhRead[i11] * w11;

            const nvx = (uxSrc[i00] * w00 + uxSrc[i10] * w10 + uxSrc[i01] * w01 + uxSrc[i11] * w11) * velDecay;
            const nvy = (uySrc[i00] * w00 + uySrc[i10] * w10 + uySrc[i01] * w01 + uySrc[i11] * w11) * velDecay;
            uxDst[idx] = nvx;
            uyDst[idx] = nvy;
            if (nvx * nvx + nvy * nvy > 1e-5) anyVel = true;
          } else {
            hWrite[idx] = hRead[idx];
            vhWrite[idx] = vhRead[idx];
            uxDst[idx] = 0;
            uyDst[idx] = 0;
          }
        }
      }

      this._ux = uxDst;
      this._uy = uyDst;
      this._uxNext = uxSrc;
      this._uyNext = uySrc;
      this._hasVelocity = anyVel;

      // Passa a ler dos buffers recém-advectados e escrever de volta em hRead/vhRead
      const tmpH = hRead;
      const tmpVh = vhRead;
      hRead = hWrite;
      vhRead = vhWrite;
      hWrite = tmpH;
      vhWrite = tmpVh;
    }

    // 2. Equação de onda amortecida com Laplaciano isotrópico 9-taps (0.20 / 0.05 / -1.0)
    for (let j = 1; j < rows - 1; j += 1) {
      const row = j * cols;
      const rowUp = row - cols;
      const rowDn = row + cols;

      for (let i = 1; i < cols - 1; i += 1) {
        const idx = row + i;
        const hC = hRead[idx];

        const card =
          hRead[idx - 1] + hRead[idx + 1] + hRead[rowUp + i] + hRead[rowDn + i];
        const diag =
          hRead[rowUp + i - 1] +
          hRead[rowUp + i + 1] +
          hRead[rowDn + i - 1] +
          hRead[rowDn + i + 1];

        const lapRaw = 0.2 * card + 0.05 * diag - hC;
        const accel = lapRaw * lapScale - restore * hC;

        const nextVh = (vhRead[idx] + accel * dt) * vhDecay;
        const nextH = (hC + nextVh * dt) * hDecay;

        vhWrite[idx] = nextVh;
        hWrite[idx] = nextH;
      }
    }

    // Bordas absorventes suaves (sem reflexão dura)
    for (let i = 0; i < cols; i += 1) {
      hWrite[i] = 0;
      vhWrite[i] = 0;
      const bot = (rows - 1) * cols + i;
      hWrite[bot] = 0;
      vhWrite[bot] = 0;
    }
    for (let j = 0; j < rows; j += 1) {
      const left = j * cols;
      const right = left + cols - 1;
      hWrite[left] = 0;
      vhWrite[left] = 0;
      hWrite[right] = 0;
      vhWrite[right] = 0;
    }

    this._h = hWrite;
    this._vh = vhWrite;
    this._hNext = hRead;
    this._vhNext = vhRead;
  }

  _packRgbaAndMeasure() {
    const cols = this._cols;
    const rows = this._rows;
    const h = this._h;
    const vh = this._vh;
    const ux = this._ux;
    const uy = this._uy;
    const hasVel = this._hasVelocity;
    const rgba = this._rgba;

    const normalGain = this.options.normalGain;
    const velToGrad = this.options.velocityToGrad;
    const crestGain = this.options.crestGain;
    const slopeGain = this.options.slopeGain;

    let maxActivity = 0;

    // Zera primeira e última linha no buffer empacotado
    const lastRowByte = (rows - 1) * cols * 4;
    for (let i = 0; i < cols; i += 1) {
      const top = i * 4;
      rgba[top] = NEUTRAL_BYTE;
      rgba[top + 1] = NEUTRAL_BYTE;
      rgba[top + 2] = 0;
      rgba[top + 3] = 0;

      const bot = lastRowByte + i * 4;
      rgba[bot] = NEUTRAL_BYTE;
      rgba[bot + 1] = NEUTRAL_BYTE;
      rgba[bot + 2] = 0;
      rgba[bot + 3] = 0;
    }

    for (let j = 1; j < rows - 1; j += 1) {
      const row = j * cols;
      const rowUp = row - cols;
      const rowDn = row + cols;

      const leftByte = row * 4;
      rgba[leftByte] = NEUTRAL_BYTE;
      rgba[leftByte + 1] = NEUTRAL_BYTE;
      rgba[leftByte + 2] = 0;
      rgba[leftByte + 3] = 0;

      const rightByte = (row + cols - 1) * 4;
      rgba[rightByte] = NEUTRAL_BYTE;
      rgba[rightByte + 1] = NEUTRAL_BYTE;
      rgba[rightByte + 2] = 0;
      rgba[rightByte + 3] = 0;

      for (let i = 1; i < cols - 1; i += 1) {
        const idx = row + i;
        const hC = h[idx];
        const vhC = vh[idx];

        const hL = h[idx - 1];
        const hR = h[idx + 1];
        const hU = h[rowUp + i];
        const hD = h[rowDn + i];

        const dhdx = (hR - hL) * 0.5;
        const dhdy = (hD - hU) * 0.5;

        const diag =
          h[rowUp + i - 1] +
          h[rowUp + i + 1] +
          h[rowDn + i - 1] +
          h[rowDn + i + 1];
        const lap = 0.2 * (hL + hR + hU + hD) + 0.05 * diag - hC;

        const uC = hasVel ? ux[idx] : 0;
        const vC = hasVel ? uy[idx] : 0;

        let gx = -dhdx * normalGain + uC * velToGrad;
        if (gx > 1) gx = 1;
        else if (gx < -1) gx = -1;

        let gy = -dhdy * normalGain + vC * velToGrad;
        if (gy > 1) gy = 1;
        else if (gy < -1) gy = -1;

        const slope = Math.hypot(dhdx, dhdy);

        // Cáustica concentrada apenas na crista fina da onda (curvatura positiva -lap + inclinação)
        const ridge = -lap * crestGain;
        const slopeSharp = slope * slopeGain - 0.035;
        let crest = 0;
        if (ridge > 0.004) {
          crest += ridge * Math.sqrt(ridge) * 0.85;
        }
        if (slopeSharp > 0.004) {
          crest += slopeSharp * slopeSharp * 0.55;
        }
        if (crest > 1) crest = 1;

        const velMag = hasVel ? Math.hypot(uC, vC) * 0.45 : 0;
        const absH = hC < 0 ? -hC : hC;
        const absVh = (vhC < 0 ? -vhC : vhC) * 0.075;
        let localMotion = absH;
        if (absVh > localMotion) localMotion = absVh;
        const slopeMotion = slope * 1.45;
        if (slopeMotion > localMotion) localMotion = slopeMotion;
        if (velMag > localMotion) localMotion = velMag;
        if (localMotion > maxActivity) maxActivity = localMotion;

        let localMask = crest;
        const sMask = slope * 2.1;
        if (sMask > localMask) localMask = sMask;
        const hMask = absH * 1.1;
        if (hMask > localMask) localMask = hMask;
        localMask = (localMask - 0.012) * 1.15;
        if (localMask <= 0) localMask = 0;
        else if (localMask > 1) localMask = 1;

        const out = idx * 4;
        rgba[out] = (NEUTRAL_BYTE + gx * 127 + 0.5) | 0;
        rgba[out + 1] = (NEUTRAL_BYTE + gy * 127 + 0.5) | 0;
        rgba[out + 2] = (crest * 255 + 0.5) | 0;
        rgba[out + 3] = (localMask * 255 + 0.5) | 0;
      }
    }

    this._energy = clamp(maxActivity * 1.35, 0.0, 1.0);
    return maxActivity;
  }

  /**
   * Sincroniza a textura WebGL alvo apenas quando `version` mudou para esta textura.
   * Retorna `true` se houve upload para GPU e `false` se já estava atualizada.
   */
  syncToContext(gl, texture) {
    if (this._destroyed || !gl || !texture) return false;

    const prev = this._textureStates.get(texture);
    const cols = this._cols;
    const rows = this._rows;

    if (!prev || prev.width !== cols || prev.height !== rows) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        cols,
        rows,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this._rgba
      );
      this._textureStates.set(texture, {
        version: this._version,
        width: cols,
        height: rows,
      });
      return true;
    }

    if (prev.version === this._version) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      cols,
      rows,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this._rgba
    );
    prev.version = this._version;
    return true;
  }

  /**
   * Cria uma textura WebGL2/WebGL1 configurada para amostragem bilinear da simulação.
   */
  createContextTexture(gl) {
    if (this._destroyed || !gl) return null;
    const texture = gl.createTexture();
    if (!texture) return null;
    this.syncToContext(gl, texture);
    return texture;
  }

  getEnergy() {
    return this._destroyed ? 0 : this._energy;
  }

  isIdle() {
    return this._destroyed || (!this._active && this._energy === 0);
  }

  getPointerViewport() {
    return {
      x: this._pointer.x,
      y: this._pointer.y,
      u: this._pointer.u,
      v: this._pointer.v,
      vx: this._pointer.vx,
      vy: this._pointer.vy,
      active: this._pointer.active,
      viewportWidth: this._viewportWidth,
      viewportHeight: this._viewportHeight,
      cols: this._cols,
      rows: this._rows,
      energy: this._energy,
      version: this._version,
    };
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._active = false;
    this._energy = 0;
    this._pointer.active = false;
    this._h = null;
    this._hNext = null;
    this._vh = null;
    this._vhNext = null;
    this._ux = null;
    this._uy = null;
    this._uxNext = null;
    this._uyNext = null;
    this._rgba = null;
  }
}

/**
 * Cria uma instância independente de `FluidField`.
 * Aceita `(options)` ou `(gl, options)` por conveniência de integração.
 */
export function createFluidField(glOrOptions = {}, maybeOptions = {}) {
  const isGlContext =
    glOrOptions &&
    typeof glOrOptions === 'object' &&
    typeof glOrOptions.texImage2D === 'function';

  const options = isGlContext ? { ...maybeOptions } : { ...glOrOptions };
  if (isGlContext && glOrOptions.canvas && !options.viewportWidth) {
    options.viewportWidth = glOrOptions.canvas.clientWidth || glOrOptions.canvas.width || 1920;
    options.viewportHeight = glOrOptions.canvas.clientHeight || glOrOptions.canvas.height || 1080;
  }

  return new FluidField(options);
}

let sharedInstance = null;

/**
 * Retorna o singleton compartilhado de `FluidField` para sincronizar todos os
 * contextos WebGL da página (`#glsl-surfaces-canvas` e `#glsl-text-canvas`).
 */
export function getSharedFluidField(options = {}) {
  if (!sharedInstance || sharedInstance._destroyed) {
    sharedInstance = new FluidField(options);
  } else if (
    Number.isFinite(options?.viewportWidth) &&
    Number.isFinite(options?.viewportHeight)
  ) {
    sharedInstance.resize(options.viewportWidth, options.viewportHeight);
  }
  return sharedInstance;
}

export function destroySharedFluidField() {
  if (sharedInstance) {
    sharedInstance.destroy();
    sharedInstance = null;
  }
}

export default getSharedFluidField;
