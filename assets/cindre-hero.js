/**
 * CINDRE — Maison de Parfum · Paris
 * Port 1:1 da experiência óptica da Hero CINDRE (collection.ts, opticalMath.ts,
 * Masthead, OpticalStage, HeroOverlay, PerfumeSheet e CindreExperience).
 *
 * Adaptação para página contínua:
 * - No estado coleção (inDetail === false), #world é position: absolute dentro de #cindre-root (100vh)
 *   para rolar naturalmente junto com a página.
 * - Ao entrar em zoom/detail, #cindre-root recebe .is-stage-fixed (#world position: fixed; z-index: 45;
 *   #sheet z-index: 55; #masthead z-index: 58) e trava o Lenis (lenisControl.stop()), destravando ao sair.
 */

export const PERFUMES = Object.freeze([
  {
    id: '01',
    index: 0,
    firstName: 'Ambre',
    italicName: 'Solis',
    plain: 'Ambre Solis',
    accent: '#dfa659',
    price: 215,
    concentration: 'Extrait Concentré · 100 ml',
    line: 'Resina de ládano defumada sobre açafrão quente e madeira de oud envelhecida. Denso, dourado, mineral.',
    notes: [
      ['Topo', 'Açafrão persa, bergamota queimada'],
      ['Coração', 'Ládano absoluto, tabaco melado'],
      ['Fundo', 'Âmbar cinza, oud, benjoim de Sião'],
    ],
    detailAlt: 'Ambre Solis — Extrait de Parfum em cristal no nicho de basalto',
  },
  {
    id: '02',
    index: 1,
    firstName: 'Galet',
    italicName: 'Minéral',
    plain: 'Galet Minéral',
    accent: '#9ec4a3',
    price: 185,
    concentration: 'Extrait Concentré · 100 ml',
    line: 'Pedra de rio após a chuva noturna. Folha de figueira esmagada, chá verde e o frescor úmido do basalto.',
    notes: [
      ['Topo', 'Folha de figo, chá verde sencha'],
      ['Coração', 'Acorde de basalto úmido, íris branca'],
      ['Fundo', 'Vetiver do Haiti, semente de ambrette'],
    ],
    detailAlt: 'Galet Minéral — Extrait de Parfum em cristal no nicho de basalto',
  },
  {
    id: '03',
    index: 2,
    firstName: 'Rubis',
    italicName: 'Volcan',
    plain: 'Rubis Volcan',
    accent: '#dc6878',
    price: 240,
    concentration: 'Extrait Concentré · 100 ml',
    line: 'Cereja negra macerada e açafrão cravados em camurça escura. A joia mais profunda da coleção.',
    notes: [
      ['Topo', 'Cereja negra amarga, cardamomo'],
      ['Coração', 'Rosa damascena noturna, davana'],
      ['Fundo', 'Camurça negra, patchouli, fava tonka'],
    ],
    detailAlt: 'Rubis Volcan — Extrait de Parfum em cristal no nicho de basalto',
  },
]);

export const GEO = Object.freeze({
  wall: Object.freeze({
    iw: 1376,
    ih: 860,
    yAnchorCover: 0.54,
    niche: Object.freeze([
      [0.1352, 0.14306, 0.1417, 0.512],
      [0.4324, 0.13833, 0.1417, 0.515],
      [0.7282, 0.1419, 0.1417, 0.50929],
    ]),
    spot: Object.freeze([
      [0.067708, 0.061667, 0.277083, 0.938333],
      [0.360417, 0.055, 0.301042, 0.945],
      [0.660417, 0.061667, 0.277083, 0.938333],
    ]),
    reach: Object.freeze([0.965, 0.965, 0.965]),
  }),
  detail: Object.freeze({
    iw: 1376,
    ih: 768,
    bleed: 1.12,
    crop: Object.freeze([
      [0.0, 0.30363, 0.41, 0.36569],
      [0.28125, 0.30363, 0.41, 0.36569],
      [0.56613, 0.30363, 0.41, 0.36569],
    ]),
    bottleCenterX: Object.freeze([0.52471, 0.53379, 0.54688]),
  }),
});

const MEDIA_CACHE_VERSION = 'v=5';
const EASE_ZOOM = 'cubic-bezier(0.22, 1, 0.36, 1)';
const EASE_CROSSFADE_IN = 'cubic-bezier(0.22, 0.65, 0.2, 1)';
const EASE_EDITORIAL = 'cubic-bezier(0.22, 0.7, 0.16, 1)';
const DUR_ZOOM_IN = 640;
const DUR_ZOOM_OUT = 500;
const DUR_STEP = 280;

export function getWallSrc(tier) {
  return `./assets/media/wall-${tier}.webp?${MEDIA_CACHE_VERSION}`;
}

export function getSpotSrc(index, tier) {
  return `./assets/media/spot-${index + 1}-${tier}.webp?${MEDIA_CACHE_VERSION}`;
}

export function getDetailSrc(index, tier) {
  return `./assets/media/detail-${index + 1}-${tier}.webp?${MEDIA_CACHE_VERSION}`;
}

export function formatEuro(amount) {
  return `€ ${amount}`;
}

// ---------------------------------------------------------------------------
// Matemática Óptica (port 1:1 de opticalMath.ts)
// ---------------------------------------------------------------------------

export function pickMediaTier(vw, dpr) {
  const need = vw * Math.min(dpr || 1, 1.5);
  return need > 2880 ? 3840 : 2880;
}

export function pickDetailTier(vw, dpr) {
  const effectiveDpr = Math.min(dpr || 1, 2);
  if (vw >= 2200 || (effectiveDpr >= 1.8 && vw * effectiveDpr > 3000)) {
    return 3840;
  }
  return 2880;
}

export function fitWall(vw, vh) {
  const { iw, ih, yAnchorCover } = GEO.wall;
  const s = Math.max(vw / iw, vh / ih);
  const w = iw * s;
  const h = ih * s;
  const x = (vw - w) / 2;
  const y = h > vh ? (vh - h) * yAnchorCover : (vh - h) / 2;
  return { x, y, w, h };
}

export function fitDetail(index, vw, vh) {
  const safeIdx = index === 1 || index === 2 ? index : 0;
  const { iw, ih, bleed, bottleCenterX } = GEO.detail;
  const s = Math.max(vw / iw, vh / ih) * bleed;
  const w = iw * s;
  const h = ih * s;
  const bx = bottleCenterX[safeIdx];
  const x = (vw - w) / 2 - (bx - 0.5) * w;
  const y = (vh - h) / 2;
  return { x, y, w, h };
}

export function computeZoomMoves(index, vw, vh) {
  const W = fitWall(vw, vh);
  const D = fitDetail(index, vw, vh);
  const c = GEO.detail.crop[index];

  const kx = D.w / (c[2] * W.w);
  const ky = D.h / (c[3] * W.h);
  const cx = W.x + c[0] * W.w;
  const cy = W.y + c[1] * W.h;

  const wtX = D.x - W.x - kx * (cx - W.x);
  const wtY = D.y - W.y - ky * (cy - W.y);
  const dtX = cx - D.x;
  const dtY = cy - D.y;

  return {
    kx,
    ky,
    wallEnd: `translate3d(${wtX}px, ${wtY}px, 0) scale(${kx}, ${ky})`,
    detailStart: `translate3d(${dtX}px, ${dtY}px, 0) scale(${1 / kx}, ${1 / ky})`,
  };
}

const IDENTITY_TRANSFORM = Object.freeze({ sx: 1, sy: 1, tx: 0, ty: 0 });

export function parseComputedTransform(el) {
  if (!el) return IDENTITY_TRANSFORM;
  const raw = window.getComputedStyle(el).transform;
  if (!raw || raw === 'none') return IDENTITY_TRANSFORM;

  if (raw.startsWith('matrix3d(')) {
    const vals = raw.slice(9, -1).split(',').map(Number);
    if (vals.length === 16 && vals.every(Number.isFinite)) {
      return { sx: vals[0], sy: vals[5], tx: vals[12], ty: vals[13] };
    }
  } else if (raw.startsWith('matrix(')) {
    const vals = raw.slice(7, -1).split(',').map(Number);
    if (vals.length === 6 && vals.every(Number.isFinite)) {
      return { sx: vals[0], sy: vals[3], tx: vals[4], ty: vals[5] };
    }
  }

  return IDENTITY_TRANSFORM;
}

export function formatTransform2D(t) {
  return `translate3d(${t.tx}px, ${t.ty}px, 0) scale(${t.sx}, ${t.sy})`;
}

export function computeDetailTransformFromWall(index, vw, vh, wallTransform) {
  const W = fitWall(vw, vh);
  const D = fitDetail(index, vw, vh);
  const c = GEO.detail.crop[index];
  const m = computeZoomMoves(index, vw, vh);

  const dsx = wallTransform.sx / m.kx;
  const dsy = wallTransform.sy / m.ky;
  const dtx = W.x + wallTransform.tx + wallTransform.sx * (c[0] * W.w) - D.x;
  const dty = W.y + wallTransform.ty + wallTransform.sy * (c[1] * W.h) - D.y;

  return `translate3d(${dtx}px, ${dty}px, 0) scale(${dsx}, ${dsy})`;
}

export function computeStepCompensationX(prevIndex, nextIndex, vw, vh) {
  const dPrev = fitDetail(prevIndex, vw, vh);
  const dNext = fitDetail(nextIndex, vw, vh);
  return dPrev.x - dNext.x;
}

// ---------------------------------------------------------------------------
// Utilitários de mídia, animação e timing
// ---------------------------------------------------------------------------

function placeElement(el, rect) {
  if (!el) return;
  const st = el.style;
  st.left = `${rect.x}px`;
  st.top = `${rect.y}px`;
  st.width = `${rect.w}px`;
  st.height = `${rect.h}px`;
}

function decodeImageElement(img) {
  if (!img) return Promise.resolve();
  if (typeof img.decode === 'function') {
    return img.decode().catch(() => {});
  }
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => resolve(), { once: true });
  });
}

function preloadAndDecodeUrl(src) {
  if (typeof Image === 'undefined') return Promise.resolve();
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  return decodeImageElement(img);
}

function waitMs(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function waitNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function scheduleIdle(cb, timeoutMs) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(cb, { timeout: timeoutMs });
  }
  return window.setTimeout(cb, Math.min(timeoutMs, 180));
}

function cancelIdle(id) {
  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(id);
  } else {
    window.clearTimeout(id);
  }
}

function waitAnimation(anim) {
  return anim.finished.then(
    () => true,
    () => false
  );
}

function readComputedOpacity(el, fallback) {
  if (!el) return fallback;
  const parsed = Number.parseFloat(window.getComputedStyle(el).opacity);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseHashPerfumeIndex(hash) {
  const clean = String(hash || '').replace(/^#/, '').trim();
  if (clean === '01' || clean === '1') return 0;
  if (clean === '02' || clean === '2') return 1;
  if (clean === '03' || clean === '3') return 2;
  return null;
}

// ---------------------------------------------------------------------------
// Inicialização Principal: initCindreHero({ lenisControl })
// ---------------------------------------------------------------------------

export function initCindreHero({ lenisControl } = {}) {
  const root = document.getElementById('cindre-root');
  if (!root) {
    return {
      enterDetail: async () => {},
      exitDetail: async () => {},
      stepDetail: async () => {},
      destroy: () => {},
    };
  }

  const wallLayer = document.getElementById('wall-layer');
  const wallPlate = document.getElementById('wall-plate');
  const wallImg = document.getElementById('wall');
  const dimOverlay = document.getElementById('dim-overlay');
  const spotImgs = [
    document.getElementById('spot-0'),
    document.getElementById('spot-1'),
    document.getElementById('spot-2'),
  ];
  const zonesContainer = document.getElementById('zones');
  const zoneBtns = [
    document.getElementById('zone-0'),
    document.getElementById('zone-1'),
    document.getElementById('zone-2'),
  ];
  const detailLayer = document.getElementById('detail-layer');
  const detailPlate = document.getElementById('detail-plate');
  const shade = document.getElementById('shade');

  // Masthead
  const brandHome = document.getElementById('brand-home');
  const navCollection = document.getElementById('nav-collection');
  const navNotes = document.getElementById('nav-notes');
  const navParis = document.getElementById('nav-paris');
  const atelierPopover = document.getElementById('atelier-popover');

  // Hero overlay
  const heroEm = document.getElementById('hero-accent-em');
  const heroHintDot = document.getElementById('hero-hint-dot');
  const hintText = document.getElementById('hint-text');

  // Sheet
  const sheet = document.getElementById('sheet');
  const sNum = document.getElementById('s-num');
  const sName = document.getElementById('s-name');
  const sLine = document.getElementById('s-line');
  const sNotes = document.getElementById('s-notes');
  const sPrice = document.getElementById('s-price');
  const sConc = document.getElementById('s-concentration');
  const sPos = document.getElementById('s-pos');
  const sBack = document.getElementById('s-back');
  const sPrev = document.getElementById('s-prev');
  const sNext = document.getElementById('s-next');

  // Estado reativo
  let sessionHighestWallTier = 2880;
  let sessionHighestDetailTier = 2880;
  let wallTier = 2880;
  let detailTier = 2880;
  let wallReady = false;
  let litIndex = null;
  let spotTarget = 0;
  let currentIndex = null;
  let activeDetailIndex = 0;
  let sheetVisible = false;
  let sheetQuick = false;
  let parisOpen = false;
  let transitionId = 0;
  let warmUpRunId = 0;
  let cancelWarmUp = null;
  let placedDetailKey = '';
  let decodedDetailTier = null;
  let rafResize = 0;
  let destroyed = false;

  const detailImgs = [null, null, null];
  const decodeTasks = [null, null, null];

  const metrics = {
    tier: 2880,
    detailTier: 2880,
    glowDecoded: false,
    detailDecoded: [false, false, false],
    lastEnterDelayMs: 0,
    lastBackDelayMs: 0,
    phase: 'idle',
  };

  window.__cindreMetrics = metrics;

  const stopScroll = () => {
    if (typeof lenisControl?.stop === 'function') {
      lenisControl.stop();
    } else if (typeof lenisControl?.lenis?.stop === 'function') {
      lenisControl.lenis.stop();
    }
  };

  const startScroll = () => {
    if (typeof lenisControl?.start === 'function') {
      lenisControl.start();
    } else if (typeof lenisControl?.lenis?.start === 'function') {
      lenisControl.lenis.start();
    }
  };

  const scrollTopImmediate = () => {
    if (window.scrollY <= 1) return;
    if (typeof lenisControl?.lenis?.scrollTo === 'function') {
      lenisControl.lenis.scrollTo(0, { immediate: true, force: true });
    }
    window.scrollTo(0, 0);
  };

  const scrollTopSmooth = () => {
    if (window.scrollY <= 1) return;
    if (typeof lenisControl?.lenis?.scrollTo === 'function') {
      lenisControl.lenis.scrollTo(0, { duration: 1.0 });
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const getStageDimensions = () => ({
    vw: root.clientWidth || window.innerWidth,
    vh: root.clientHeight || window.innerHeight,
  });

  const detectTiers = () => {
    const { vw } = getStageDimensions();
    const dpr = window.devicePixelRatio || 1;
    const wTier = pickMediaTier(vw, dpr);
    const dTier = pickDetailTier(vw, dpr);
    if (wTier > sessionHighestWallTier) sessionHighestWallTier = wTier;
    if (dTier > sessionHighestDetailTier) sessionHighestDetailTier = dTier;
    return {
      nextWallTier: sessionHighestWallTier,
      nextDetailTier: sessionHighestDetailTier,
    };
  };

  const syncStageSources = () => {
    const { nextWallTier, nextDetailTier } = detectTiers();
    const wallChanged = wallTier !== nextWallTier;
    const detailChanged = detailTier !== nextDetailTier;

    wallTier = nextWallTier;
    detailTier = nextDetailTier;
    root.dataset.tier = String(wallTier);
    root.dataset.detailTier = String(detailTier);

    const wallSrc = getWallSrc(wallTier);
    if (wallImg && (wallChanged || wallImg.getAttribute('src') !== wallSrc)) {
      wallImg.src = wallSrc;
    }

    spotImgs.forEach((img, idx) => {
      if (!img) return;
      const src = getSpotSrc(idx, wallTier);
      if (wallChanged || img.getAttribute('src') !== src) {
        img.src = src;
      }
    });

    if (detailChanged) {
      detailImgs.forEach((img, idx) => {
        if (img) {
          img.src = getDetailSrc(idx, detailTier);
        }
      });
    }

    return { wallChanged, detailChanged };
  };

  const syncDomState = () => {
    const inDetail = currentIndex !== null;
    root.dataset.ready = wallReady ? 'true' : 'false';
    root.dataset.detail = inDetail ? 'true' : 'false';

    if (litIndex !== null) {
      root.dataset.lit = String(litIndex);
    } else {
      delete root.dataset.lit;
    }

    if (dimOverlay) {
      dimOverlay.dataset.spot = String(spotTarget);
    }

    if (detailLayer) {
      detailLayer.setAttribute('aria-hidden', String(!inDetail));
    }

    zoneBtns.forEach((btn, idx) => {
      if (!btn) return;
      btn.classList.toggle('is-on', !inDetail && litIndex === idx);
    });

    // Masthead active buttons & popover
    navCollection?.classList.toggle('is-active', !inDetail);
    navNotes?.classList.toggle('is-active', inDetail);
    navParis?.classList.toggle('is-active', parisOpen);
    navParis?.setAttribute('aria-expanded', String(parisOpen));
    if (atelierPopover) {
      atelierPopover.hidden = !parisOpen;
    }

    // Hero accent & hint
    const hoveredPerfume = litIndex !== null ? PERFUMES[litIndex] : null;
    const accentColor = hoveredPerfume ? hoveredPerfume.accent : '#dfa659';
    root.style.setProperty('--cindre-accent', accentColor);
    if (heroEm) heroEm.style.color = accentColor;
    if (heroHintDot) {
      heroHintDot.style.backgroundColor = accentColor;
      heroHintDot.style.boxShadow = `0 0 10px ${accentColor}`;
    }
    if (hintText) {
      hintText.textContent = hoveredPerfume
        ? `${hoveredPerfume.plain} · Explorar`
        : 'Selecione um perfume';
    }

    // PerfumeSheet
    const activePerfume = PERFUMES[currentIndex ?? activeDetailIndex];
    if (sheet && activePerfume) {
      sheet.style.setProperty('--cindre-accent', activePerfume.accent);
      sheet.classList.toggle('is-visible', sheetVisible);
      sheet.classList.toggle('is-quick', sheetQuick);
      sheet.classList.toggle('is-hidden', !inDetail && !sheetVisible);
      sheet.setAttribute('aria-hidden', String(!inDetail && !sheetVisible));

      if (sNum) sNum.textContent = `N° ${activePerfume.id} · Extrait de Parfum`;
      if (sName) {
        sName.textContent = '';
        sName.append(document.createTextNode(`${activePerfume.firstName} `));
        const em = document.createElement('em');
        em.className = 'editorial-em';
        em.textContent = activePerfume.italicName;
        sName.append(em);
      }
      if (sLine) sLine.textContent = activePerfume.line;
      if (sPrice) sPrice.textContent = formatEuro(activePerfume.price);
      if (sConc) sConc.textContent = activePerfume.concentration;
      if (sPos) sPos.textContent = `${activePerfume.id} / 03`;
      if (sNotes) {
        sNotes.textContent = '';
        activePerfume.notes.forEach(([stage, composition]) => {
          const row = document.createElement('div');
          row.className = 'sheet-note-row';
          const dt = document.createElement('dt');
          dt.className = 'sheet-note-stage';
          dt.textContent = stage;
          const dd = document.createElement('dd');
          dd.className = 'sheet-note-comp';
          dd.textContent = composition;
          row.append(dt, dd);
          sNotes.append(row);
        });
      }
    }
  };

  const mountDetailSet = (indices) => {
    if (!detailPlate) return;
    [0, 1, 2].forEach((idx) => {
      const shouldMount = indices.includes(idx);
      const existing = detailImgs[idx];
      if (shouldMount && !existing) {
        const perfume = PERFUMES[idx];
        const img = document.createElement('img');
        img.id = `detail-${idx}`;
        img.src = getDetailSrc(idx, detailTier);
        img.alt = perfume.detailAlt;
        img.decoding = 'async';
        img.className = `detail-img-layer${activeDetailIndex === idx ? ' is-active' : ''}`;
        detailPlate.appendChild(img);
        detailImgs[idx] = img;
      } else if (!shouldMount && existing) {
        existing.remove();
        detailImgs[idx] = null;
      }
    });
  };

  const mountDetailAdditive = (index) => {
    if (!detailPlate || detailImgs[index]) return;
    const perfume = PERFUMES[index];
    const img = document.createElement('img');
    img.id = `detail-${index}`;
    img.src = getDetailSrc(index, detailTier);
    img.alt = perfume.detailAlt;
    img.decoding = 'async';
    img.className = `detail-img-layer${activeDetailIndex === index ? ' is-active' : ''}`;
    detailPlate.appendChild(img);
    detailImgs[index] = img;
  };

  const cancelStageAnimations = () => {
    const targets = [wallPlate, detailPlate, detailLayer, shade, ...detailImgs];
    targets.forEach((el) => {
      el?.getAnimations().forEach((anim) => anim.cancel());
    });
  };

  const ensureDetailDecoded = (index) => {
    mountDetailAdditive(index);
    if (metrics.detailDecoded[index]) {
      return Promise.resolve();
    }
    const existing = decodeTasks[index];
    if (existing) {
      return existing;
    }
    const imgEl = detailImgs[index];
    const task = (
      imgEl ? decodeImageElement(imgEl) : preloadAndDecodeUrl(getDetailSrc(index, detailTier))
    ).then(() => {
      metrics.detailDecoded[index] = true;
    });
    decodeTasks[index] = task;
    return task;
  };

  const warmUpAssets = (targetWallTier, targetDetailTier) => {
    if (decodedDetailTier !== targetDetailTier) {
      decodedDetailTier = targetDetailTier;
      metrics.tier = targetWallTier;
      metrics.detailTier = targetDetailTier;
      metrics.glowDecoded = false;
      metrics.detailDecoded = [false, false, false];
      decodeTasks[0] = null;
      decodeTasks[1] = null;
      decodeTasks[2] = null;
    }

    const runId = ++warmUpRunId;
    const idleId = scheduleIdle(async () => {
      if (destroyed || warmUpRunId !== runId) return;
      for (const idx of [0, 1, 2]) {
        if (destroyed || warmUpRunId !== runId) return;
        await decodeImageElement(spotImgs[idx]);
        await waitMs(24);
      }
      if (destroyed || warmUpRunId !== runId) return;
      metrics.glowDecoded = true;

      for (const idx of [0, 1, 2]) {
        if (destroyed || warmUpRunId !== runId) return;
        if (!metrics.detailDecoded[idx]) {
          void fetch(getDetailSrc(idx, targetDetailTier), {
            priority: 'low',
            cache: 'force-cache',
          }).catch(() => {});
          await waitMs(120);
        }
      }
    }, 600);

    return () => cancelIdle(idleId);
  };

  const placeDetailPlateIfNeeded = (index, vw, vh) => {
    const key = `${index}:${vw}x${vh}`;
    if (placedDetailKey === key) return;
    placedDetailKey = key;
    placeElement(detailPlate, fitDetail(index, vw, vh));
  };

  const applyStageLayout = () => {
    const { vw, vh } = getStageDimensions();
    const activeIdx = currentIndex ?? activeDetailIndex;

    placeElement(wallPlate, fitWall(vw, vh));
    placedDetailKey = '';
    placeDetailPlateIfNeeded(activeIdx, vw, vh);

    if (currentIndex !== null && metrics.phase === 'detail') {
      const m = computeZoomMoves(currentIndex, vw, vh);
      if (wallPlate) wallPlate.style.transform = m.wallEnd;
      if (detailPlate) detailPlate.style.transform = 'none';
    }
  };

  const markWallReady = () => {
    if (wallReady) return;
    wallReady = true;
    syncDomState();
    cancelWarmUp?.();
    cancelWarmUp = warmUpAssets(wallTier, detailTier);
  };

  const lightNiche = (index) => {
    if (currentIndex !== null) return;
    if (litIndex === index) return;
    litIndex = index;
    spotTarget = index;
    if (metrics.phase === 'idle') {
      metrics.phase = 'hover';
    }
    syncDomState();
    mountDetailSet([index]);
    void ensureDetailDecoded(index);
  };

  const unlightNiche = () => {
    if (currentIndex !== null) return;
    litIndex = null;
    if (metrics.phase === 'hover') {
      metrics.phase = 'idle';
    }
    syncDomState();
  };

  const enterDetail = async (index, syncHash = true) => {
    if (
      currentIndex === index &&
      (metrics.phase === 'detail' || metrics.phase === 'zooming-in')
    ) {
      return;
    }

    const t0 = performance.now();
    const myId = ++transitionId;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const durIn = reduce ? 1 : DUR_ZOOM_IN;

    parisOpen = false;
    litIndex = index;
    spotTarget = index;

    // Sincroniza topo e promove #world para position: fixed (tela cheia) antes do zoom
    scrollTopImmediate();
    stopScroll();
    root.classList.add('is-stage-fixed');

    mountDetailSet([index]);
    syncDomState();

    if (!detailImgs[index]) {
      await waitNextFrame();
      if (destroyed || transitionId !== myId) return;
    }

    if (!metrics.detailDecoded[index]) {
      await Promise.race([ensureDetailDecoded(index), waitMs(110)]);
      if (destroyed || transitionId !== myId) return;
    }

    // Batch de leituras antes de escritas
    const wallSnap = parseComputedTransform(wallPlate);
    const detailOpacityNow = readComputedOpacity(detailLayer, 0);
    const shadeOpacityStart = readComputedOpacity(shade, 0);
    const sameDetail = activeDetailIndex === index;
    const detailOpacityStart = sameDetail ? detailOpacityNow : 0;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = computeZoomMoves(index, vw, vh);
    const wallStart = formatTransform2D(wallSnap);
    const detailStart = computeDetailTransformFromWall(index, vw, vh, wallSnap);

    cancelStageAnimations();
    root.classList.add('is-animating');
    detailPlate?.classList.remove('is-stepping');
    detailImgs.forEach((img, idx) => {
      img?.classList.toggle('is-active', idx === index);
    });

    activeDetailIndex = index;
    currentIndex = index;
    metrics.phase = 'zooming-in';
    sheetQuick = false;
    sheetVisible = true;
    syncDomState();

    if (syncHash) {
      window.history.replaceState(null, '', `#${PERFUMES[index].id}`);
    }

    placeDetailPlateIfNeeded(index, vw, vh);
    if (wallPlate) wallPlate.style.transform = wallStart;
    if (detailPlate) detailPlate.style.transform = detailStart;
    if (wallLayer) wallLayer.style.opacity = '1';
    if (detailLayer) detailLayer.style.opacity = String(detailOpacityStart);
    if (shade) shade.style.opacity = String(shadeOpacityStart);

    if (!reduce && wallPlate && detailPlate && detailLayer && shade) {
      const opts = { duration: durIn, easing: EASE_ZOOM, fill: 'forwards' };
      const anim = wallPlate.animate(
        [{ transform: wallStart }, { transform: m.wallEnd }],
        opts
      );
      detailPlate.animate(
        [{ transform: detailStart }, { transform: 'translate3d(0,0,0) scale(1,1)' }],
        opts
      );
      detailLayer.animate(
        [
          { opacity: detailOpacityStart },
          { opacity: Math.max(detailOpacityStart, 0.02), offset: 0.03 },
          { opacity: 1, offset: 0.4 },
          { opacity: 1 },
        ],
        { duration: durIn, easing: EASE_CROSSFADE_IN, fill: 'forwards' }
      );
      shade.animate(
        [
          { opacity: shadeOpacityStart },
          { opacity: shadeOpacityStart, offset: 0.25 },
          { opacity: 1 },
        ],
        { duration: durIn, easing: 'ease-out', fill: 'forwards' }
      );

      metrics.lastEnterDelayMs = +(performance.now() - t0).toFixed(2);
      const completed = await waitAnimation(anim);
      if (destroyed || !completed || transitionId !== myId) return;
    } else {
      metrics.lastEnterDelayMs = +(performance.now() - t0).toFixed(2);
    }

    cancelStageAnimations();
    root.classList.remove('is-animating');
    if (wallPlate) wallPlate.style.transform = m.wallEnd;
    if (detailPlate) detailPlate.style.transform = 'none';
    if (wallLayer) wallLayer.style.opacity = '0';
    if (detailLayer) detailLayer.style.opacity = '1';
    if (shade) shade.style.opacity = '1';

    metrics.phase = 'detail';
  };

  const exitDetail = async () => {
    if (currentIndex === null && metrics.phase !== 'zooming-in') return;
    const t0 = performance.now();
    const myId = ++transitionId;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const durOut = reduce ? 1 : DUR_ZOOM_OUT;

    const index = currentIndex ?? activeDetailIndex;

    const wallSnap = parseComputedTransform(wallPlate);
    const detailSnap = parseComputedTransform(detailPlate);
    const detailOpacityStart = readComputedOpacity(detailLayer, 1);
    const shadeOpacityStart = readComputedOpacity(shade, 1);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = computeZoomMoves(index, vw, vh);
    const wallStart = formatTransform2D(wallSnap);
    const detailStart = formatTransform2D(detailSnap);

    cancelStageAnimations();
    root.classList.add('is-animating');
    detailPlate?.classList.remove('is-stepping');
    detailImgs.forEach((img, idx) => {
      img?.classList.toggle('is-active', idx === index);
    });

    parisOpen = false;
    currentIndex = null;
    litIndex = null;
    metrics.phase = 'zooming-out';
    sheetVisible = false;
    syncDomState();

    if (window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    placeDetailPlateIfNeeded(index, vw, vh);
    if (wallPlate) wallPlate.style.transform = wallStart;
    if (detailPlate) detailPlate.style.transform = detailStart;
    if (wallLayer) wallLayer.style.opacity = '1';
    if (detailLayer) detailLayer.style.opacity = String(detailOpacityStart);
    if (shade) shade.style.opacity = String(shadeOpacityStart);

    if (!reduce && wallPlate && detailPlate && detailLayer && shade) {
      const opts = { duration: durOut, easing: EASE_ZOOM, fill: 'forwards' };
      const anim = wallPlate.animate(
        [{ transform: wallStart }, { transform: 'translate3d(0,0,0) scale(1,1)' }],
        opts
      );
      detailPlate.animate(
        [{ transform: detailStart }, { transform: m.detailStart }],
        opts
      );
      detailLayer.animate(
        [
          { opacity: detailOpacityStart },
          { opacity: detailOpacityStart, offset: 0.22 },
          { opacity: 0, offset: 0.84 },
          { opacity: 0 },
        ],
        { duration: durOut, easing: 'ease-in-out', fill: 'forwards' }
      );
      shade.animate(
        [{ opacity: shadeOpacityStart }, { opacity: 0, offset: 0.5 }, { opacity: 0 }],
        { duration: durOut, easing: 'ease-out', fill: 'forwards' }
      );

      metrics.lastBackDelayMs = +(performance.now() - t0).toFixed(2);
      const completed = await waitAnimation(anim);
      if (destroyed || !completed || transitionId !== myId) return;
    } else {
      metrics.lastBackDelayMs = +(performance.now() - t0).toFixed(2);
    }

    cancelStageAnimations();
    root.classList.remove('is-animating');
    root.classList.remove('is-stage-fixed');
    if (wallPlate) wallPlate.style.transform = 'none';
    if (detailPlate) detailPlate.style.transform = 'none';
    if (detailLayer) detailLayer.style.opacity = '0';
    if (shade) shade.style.opacity = '0';

    applyStageLayout();
    startScroll();

    const hoveredBtn = zonesContainer?.querySelector('.zone-btn:hover');
    if (hoveredBtn && hoveredBtn.dataset.n !== undefined) {
      const hoveredIdx = Number(hoveredBtn.dataset.n);
      litIndex = null;
      metrics.phase = 'idle';
      lightNiche(hoveredIdx);
    } else {
      litIndex = null;
      metrics.phase = 'idle';
      syncDomState();
      mountDetailSet([]);
    }
  };

  const stepDetail = async (dir) => {
    if (currentIndex === null) return;
    const myId = ++transitionId;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    parisOpen = false;

    const prevIdx = currentIndex;
    const nextIdx = (prevIdx + dir + PERFUMES.length) % PERFUMES.length;
    sheetVisible = false;
    syncDomState();
    mountDetailSet([prevIdx, nextIdx]);

    if (!detailImgs[nextIdx]) {
      await waitNextFrame();
      if (destroyed || transitionId !== myId) return;
    }

    if (!metrics.detailDecoded[nextIdx]) {
      await Promise.race([ensureDetailDecoded(nextIdx), waitMs(110)]);
      if (destroyed || transitionId !== myId) return;
    }

    cancelStageAnimations();
    root.classList.add('is-animating');

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const compX = computeStepCompensationX(prevIdx, nextIdx, vw, vh);
    placeDetailPlateIfNeeded(nextIdx, vw, vh);
    if (detailPlate) detailPlate.style.transform = 'none';
    if (wallLayer) wallLayer.style.opacity = '0';
    if (detailLayer) detailLayer.style.opacity = '1';
    if (shade) shade.style.opacity = '1';

    const prevImg = detailImgs[prevIdx];
    const nextImg = detailImgs[nextIdx];
    detailPlate?.classList.add('is-stepping');
    detailImgs.forEach((img, idx) => {
      img?.classList.toggle('is-active', idx === prevIdx || idx === nextIdx);
    });

    activeDetailIndex = nextIdx;
    litIndex = nextIdx;
    spotTarget = nextIdx;
    currentIndex = nextIdx;
    metrics.phase = 'detail';
    sheetQuick = true;
    syncDomState();
    window.history.replaceState(null, '', `#${PERFUMES[nextIdx].id}`);

    window.requestAnimationFrame(() => {
      if (!destroyed && transitionId === myId) {
        sheetVisible = true;
        syncDomState();
      }
    });

    if (!reduce && prevImg && nextImg) {
      const shift = dir * 22;
      prevImg.animate(
        [
          { opacity: 1, transform: `translate3d(${compX}px,0,0) scale(1)` },
          { opacity: 0, transform: `translate3d(${compX - shift}px,0,0) scale(0.99)` },
        ],
        { duration: DUR_STEP, easing: EASE_EDITORIAL, fill: 'forwards' }
      );
      const animNext = nextImg.animate(
        [
          { opacity: 0, transform: `translate3d(${shift}px,0,0) scale(1.016)` },
          { opacity: 1, transform: 'translate3d(0,0,0) scale(1)' },
        ],
        { duration: DUR_STEP, easing: EASE_EDITORIAL, fill: 'forwards' }
      );
      const completed = await waitAnimation(animNext);
      if (destroyed || !completed || transitionId !== myId) return;
    }

    cancelStageAnimations();
    root.classList.remove('is-animating');
    detailPlate?.classList.remove('is-stepping');
    mountDetailSet([nextIdx]);
    detailImgs.forEach((img, idx) => {
      img?.classList.toggle('is-active', idx === nextIdx);
    });
    const m = computeZoomMoves(nextIdx, vw, vh);
    if (wallPlate) wallPlate.style.transform = m.wallEnd;
    if (detailPlate) detailPlate.style.transform = 'none';
    if (wallLayer) wallLayer.style.opacity = '0';
    if (detailLayer) detailLayer.style.opacity = '1';
  };

  // -------------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------------
  const cleanups = [];
  const on = (target, type, handler, opts) => {
    if (!target) return;
    target.addEventListener(type, handler, opts);
    cleanups.push(() => target.removeEventListener(type, handler, opts));
  };

  on(wallPlate, 'pointerleave', (event) => {
    if (event.pointerType !== 'touch') {
      unlightNiche();
    }
  });

  zoneBtns.forEach((btn, idx) => {
    if (!btn) return;
    on(btn, 'pointerenter', (event) => {
      if (event.pointerType !== 'touch') {
        lightNiche(idx);
      }
    });
    on(btn, 'pointerleave', (event) => {
      if (event.pointerType !== 'touch') {
        unlightNiche();
      }
    });
    on(btn, 'focus', () => lightNiche(idx));
    on(btn, 'blur', () => unlightNiche());
    on(btn, 'click', () => {
      void enterDetail(idx);
    });
  });

  on(brandHome, 'click', (event) => {
    parisOpen = false;
    syncDomState();
    event.preventDefault();
    if (currentIndex !== null) {
      void exitDetail();
    } else {
      scrollTopSmooth();
    }
  });

  on(navCollection, 'click', () => {
    parisOpen = false;
    syncDomState();
    if (currentIndex !== null) {
      void exitDetail();
    } else {
      scrollTopSmooth();
    }
  });

  on(navNotes, 'click', () => {
    parisOpen = false;
    syncDomState();
    if (currentIndex === null) {
      void enterDetail(litIndex ?? 0);
    }
  });

  on(navParis, 'click', (event) => {
    event.stopPropagation();
    parisOpen = !parisOpen;
    syncDomState();
  });

  on(document, 'click', (event) => {
    if (!parisOpen) return;
    const target = event.target;
    if (target && !atelierPopover?.contains(target) && target !== navParis) {
      parisOpen = false;
      syncDomState();
    }
  });

  on(sBack, 'click', () => {
    void exitDetail();
  });

  on(sPrev, 'click', () => {
    void stepDetail(-1);
  });

  on(sNext, 'click', () => {
    void stepDetail(1);
  });

  on(window, 'keydown', (event) => {
    if (event.key === 'Escape') {
      if (parisOpen) {
        parisOpen = false;
        syncDomState();
      } else if (currentIndex !== null) {
        void exitDetail();
      }
    } else if (currentIndex !== null && event.key === 'ArrowRight') {
      void stepDetail(1);
    } else if (currentIndex !== null && event.key === 'ArrowLeft') {
      void stepDetail(-1);
    }
  });

  on(window, 'resize', () => {
    window.cancelAnimationFrame(rafResize);
    rafResize = window.requestAnimationFrame(() => {
      const { wallChanged, detailChanged } = syncStageSources();
      applyStageLayout();
      if (wallChanged || detailChanged) {
        cancelWarmUp?.();
        cancelWarmUp = warmUpAssets(wallTier, detailTier);
      }
    });
  });

  // Boot inicial de mídia, geometria e hash deep-link
  syncStageSources();
  syncDomState();
  applyStageLayout();

  if (wallImg) {
    if (wallImg.complete && wallImg.naturalWidth > 0) {
      markWallReady();
    } else {
      on(wallImg, 'load', markWallReady, { once: true });
      on(wallImg, 'error', markWallReady, { once: true });
      if (typeof wallImg.decode === 'function') {
        wallImg.decode().then(markWallReady).catch(markWallReady);
      }
    }
  } else {
    markWallReady();
  }

  const hashIdx = parseHashPerfumeIndex(window.location.hash);
  if (hashIdx !== null) {
    void enterDetail(hashIdx, false);
  }

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    window.cancelAnimationFrame(rafResize);
    cancelWarmUp?.();
    cancelStageAnimations();
    cleanups.forEach((fn) => fn());
    cleanups.length = 0;
  };

  return {
    enterDetail,
    exitDetail,
    stepDetail,
    destroy,
  };
}

export default initCindreHero;
