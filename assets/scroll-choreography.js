import Lenis from 'lenis';
import gsap from 'gsap';
import ScrollTrigger from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const HERO_GUARD_SELECTOR = '#cindre-root, #hero-slot';
const FOOTER_SELECTOR = '#cindre-footer, #basalte-footer';
const TEXT_SELECTOR =
  '.cindre-lower [data-glsl-text], .basalte-lower [data-glsl-text], #cindre-footer [data-glsl-text], #basalte-footer [data-glsl-text]';
const BUTTON_SELECTOR = '.btn-pill, .quiz-pill, .newsletter-btn';
const MEDIA_SELECTOR = '.art-media-frame, .slab-stage, .triptych-card';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const MAX_MAGNET_PX = 6;
const MAX_TILT_DEG = 3.2; // Estritamente <= 3.5deg
const TRIPTYCH_PARALLAX_STEPS = [16, 26, 18];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const isInsideHero = (el) => Boolean(el && el.closest(HERO_GUARD_SELECTOR));

const queryGuarded = (selector) =>
  Array.from(document.querySelectorAll(selector)).filter((el) => !isInsideHero(el));

const setRevealSafe = (liquidEngine, el, value) => {
  if (typeof liquidEngine?.setReveal === 'function') {
    liquidEngine.setReveal(el, clamp(value, 0, 1));
  }
};

const pulseSafe = (liquidEngine, el, intensity) => {
  if (typeof liquidEngine?.pulse === 'function' && el) {
    liquidEngine.pulse(el, intensity);
  }
};

const pulseSurfaceSafe = (surfaceEngine, el, intensity) => {
  if (typeof surfaceEngine?.pulseSurface === 'function' && el) {
    surfaceEngine.pulseSurface(el, intensity);
  }
};

const isAtPageBottom = () => {
  const scrollHeight = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0
  );
  return window.scrollY + window.innerHeight >= scrollHeight - 6;
};

/**
 * Configura a coreografia bidirecional de entrada/saida de todos os blocos
 * [data-glsl-text] dentro de .cindre-lower, .basalte-lower, #cindre-footer e #basalte-footer
 * (nunca tocando #cindre-root ou #hero-slot).
 */
function setupTextChoreography(liquidEngine, triggers, cleanups) {
  const textNodes = queryGuarded(TEXT_SELECTOR);
  if (!textNodes.length) return () => {};

  const vh = window.innerHeight || 1;
  const atBottom = isAtPageBottom();

  // Batch de leituras antes de qualquer escrita para evitar layout thrashing.
  const entries = textNodes.map((el) => {
    const rect = el.getBoundingClientRect();
    const computedDisplay = window.getComputedStyle(el).display;
    const isFooter = Boolean(el.closest(FOOTER_SELECTOR));
    const isInButton = Boolean(el.closest(BUTTON_SELECTOR));
    const canTranslate = computedDisplay !== 'inline' && !isInButton;

    let enterY = 22;
    let leaveY = 16;
    if (!canTranslate) {
      enterY = 0;
      leaveY = 0;
    } else if (isFooter) {
      enterY = 16;
      leaveY = 12;
    }

    const initiallyVisible = isFooter
      ? rect.top < vh * 0.99 && rect.bottom > 0
      : (rect.top < vh * 0.93 && rect.bottom > vh * 0.05) ||
        (atBottom && rect.top < vh && rect.bottom > 0);

    return {
      el,
      rect,
      canTranslate,
      isFooter,
      enterY,
      leaveY,
      initiallyVisible,
      state: {
        reveal: initiallyVisible ? 1 : 0,
        isVisible: initiallyVisible,
        revealTween: null,
        yTween: null,
      },
      trigger: null,
    };
  });

  // Micro-stagger organico quando varios blocos entram no mesmo frame de scroll.
  let lastEnterFrame = -1;
  let frameEnterCount = 0;
  const nextFrameDelay = () => {
    const currentFrame = gsap.ticker.frame;
    if (currentFrame !== lastEnterFrame) {
      lastEnterFrame = currentFrame;
      frameEnterCount = 0;
    }
    const delay = Math.min(frameEnterCount * 0.045, 0.22);
    frameEnterCount += 1;
    return delay;
  };

  const revealIn = (entry, fromDirection, immediate = false) => {
    const { el, state, canTranslate, isFooter, enterY, leaveY } = entry;

    state.revealTween?.kill();
    state.yTween?.kill();
    state.isVisible = true;

    if (immediate) {
      state.reveal = 1;
      setRevealSafe(liquidEngine, el, 1);
      if (canTranslate) {
        gsap.set(el, { y: 0 });
      }
      return;
    }

    if (canTranslate && state.reveal < 0.05) {
      gsap.set(el, { y: fromDirection >= 0 ? enterY : -leaveY });
    }

    const delay = nextFrameDelay();
    const duration = isFooter ? 0.72 : 0.88;

    state.revealTween = gsap.to(state, {
      reveal: 1,
      duration,
      delay,
      ease: 'power3.out',
      overwrite: 'auto',
      onUpdate: () => {
        setRevealSafe(liquidEngine, el, state.reveal);
      },
    });

    if (canTranslate) {
      state.yTween = gsap.to(el, {
        y: 0,
        duration: duration + 0.04,
        delay,
        ease: 'power3.out',
        overwrite: 'auto',
      });
    }
  };

  const revealOut = (entry, exitDirection) => {
    const { el, state, canTranslate, enterY, leaveY } = entry;

    state.revealTween?.kill();
    state.yTween?.kill();
    state.isVisible = false;

    const duration = 0.48;

    state.revealTween = gsap.to(state, {
      reveal: 0,
      duration,
      ease: 'power2.inOut',
      overwrite: 'auto',
      onUpdate: () => {
        setRevealSafe(liquidEngine, el, state.reveal);
      },
    });

    if (canTranslate) {
      state.yTween = gsap.to(el, {
        y: exitDirection >= 0 ? -leaveY : enterY,
        duration,
        ease: 'power2.inOut',
        overwrite: 'auto',
      });
    }
  };

  // Cria os ScrollTriggers antes de deslocar y inicial para medir posicoes naturais do layout.
  entries.forEach((entry) => {
    const { el, isFooter } = entry;

    const st = ScrollTrigger.create({
      trigger: el,
      start: isFooter ? 'top 99%' : 'top 92%',
      end: isFooter ? 'bottom top' : 'bottom 6%',
      onEnter: () => revealIn(entry, 1),
      onEnterBack: () => revealIn(entry, -1),
      onLeave: () => {
        if (isAtPageBottom()) {
          const r = el.getBoundingClientRect();
          if (r.top < window.innerHeight && r.bottom > 0) {
            revealIn(entry, 1);
            return;
          }
        }
        revealOut(entry, 1);
      },
      onLeaveBack: () => {
        if (window.scrollY <= 2) {
          const r = el.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.96 && r.bottom > 0) {
            revealIn(entry, -1);
            return;
          }
        }
        revealOut(entry, -1);
      },
    });

    entry.trigger = st;
    triggers.push(st);
  });

  // Aplica o estado inicial em lote depois dos ScrollTriggers criados.
  entries.forEach((entry) => {
    const { el, rect, state, canTranslate, enterY, leaveY, initiallyVisible, trigger } = entry;
    const activeNow = initiallyVisible || Boolean(trigger?.isActive);

    if (activeNow) {
      state.reveal = 1;
      state.isVisible = true;
      setRevealSafe(liquidEngine, el, 1);
      if (canTranslate) {
        gsap.set(el, { y: 0 });
      }
    } else {
      state.reveal = 0;
      state.isVisible = false;
      setRevealSafe(liquidEngine, el, 0);
      if (canTranslate) {
        const isAbove = rect.bottom <= vh * 0.05;
        gsap.set(el, { y: isAbove ? -leaveY : enterY });
      }
    }
  });

  // Sincroniza visibilidade apos refresh (resize, carregamento de fontes/imagens).
  const syncVisibleEntries = () => {
    const currentVh = window.innerHeight || 1;
    const bottomReached = isAtPageBottom();
    const topReached = window.scrollY <= 2;

    const snapshots = entries.map((entry) => ({
      entry,
      rect: entry.el.getBoundingClientRect(),
      isActive: Boolean(entry.trigger?.isActive),
    }));

    snapshots.forEach(({ entry, rect, isActive }) => {
      const inBounds = rect.top < currentVh * 0.98 && rect.bottom > 0;
      const shouldBeVisible =
        isActive ||
        (bottomReached && inBounds) ||
        (topReached && rect.top < currentVh * 0.94 && rect.bottom > 0);

      if (shouldBeVisible && (!entry.state.isVisible || entry.state.reveal < 0.99)) {
        revealIn(entry, 1, false);
      }
    });
  };

  ScrollTrigger.addEventListener('refresh', syncVisibleEntries);

  cleanups.push(() => {
    ScrollTrigger.removeEventListener('refresh', syncVisibleEntries);
    entries.forEach(({ el, state, canTranslate }) => {
      state.revealTween?.kill();
      state.yTween?.kill();
      gsap.killTweensOf(state);
      gsap.killTweensOf(el);
      if (canTranslate) {
        gsap.set(el, { clearProps: 'y' });
      }
    });
  });

  return syncVisibleEntries;
}

/**
 * Configura microinteracoes nos botoes (.btn-pill, .quiz-pill, .newsletter-btn):
 * tracking --mx/--my em %, deslocamento da seta SVG, feedback elastico de clique (scale),
 * pulso GLSL no texto e pulso WebGL na superficie via surfaceEngine.pulseSurface(btn, 0.85).
 * Nunca desloca x/y do botao quando ha [data-glsl-text] interno.
 */
function setupButtonMicrointeractions(liquidEngine, surfaceEngine, cleanups) {
  const buttons = queryGuarded(BUTTON_SELECTOR);
  if (!buttons.length) return;

  buttons.forEach((btn) => {
    const arrowEl = btn.querySelector('svg');
    const glslLabelEl = btn.matches('[data-glsl-text]')
      ? btn
      : btn.querySelector('[data-glsl-text]');
    const hasGlslText = Boolean(glslLabelEl);
    const labelEl = glslLabelEl || btn;

    // Nunca deslocar x/y em botoes que contenham [data-glsl-text] para preservar o alinhamento WebGL.
    const xTo = hasGlslText
      ? null
      : gsap.quickTo(btn, 'x', { duration: 0.4, ease: 'power3.out' });
    const yTo = hasGlslText
      ? null
      : gsap.quickTo(btn, 'y', { duration: 0.4, ease: 'power3.out' });
    const arrowXTo = arrowEl
      ? gsap.quickTo(arrowEl, 'x', { duration: 0.34, ease: 'power3.out' })
      : null;
    const arrowYTo = arrowEl
      ? gsap.quickTo(arrowEl, 'y', { duration: 0.34, ease: 'power3.out' })
      : null;

    let cachedRect = null;
    let cachedScrollY = -1;
    let cachedViewportW = -1;
    let isPressed = false;

    const getRect = () => {
      const currentScrollY = window.scrollY;
      const currentViewportW = window.innerWidth;
      if (!cachedRect || cachedScrollY !== currentScrollY || cachedViewportW !== currentViewportW) {
        cachedRect = btn.getBoundingClientRect();
        cachedScrollY = currentScrollY;
        cachedViewportW = currentViewportW;
      }
      return cachedRect;
    };

    const updatePointerCoords = (event) => {
      const rect = getRect();
      if (!rect.width || !rect.height) return { nx: 0, ny: 0 };

      const px = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((event.clientY - rect.top) / rect.height, 0, 1);

      btn.style.setProperty('--mx', `${(px * 100).toFixed(2)}%`);
      btn.style.setProperty('--my', `${(py * 100).toFixed(2)}%`);

      return {
        nx: (px - 0.5) * 2,
        ny: (py - 0.5) * 2,
      };
    };

    const onPointerEnter = (event) => {
      if (event.pointerType === 'touch') return;
      cachedRect = btn.getBoundingClientRect();
      cachedScrollY = window.scrollY;
      cachedViewportW = window.innerWidth;

      const { nx, ny } = updatePointerCoords(event);
      xTo?.(nx * MAX_MAGNET_PX);
      yTo?.(ny * MAX_MAGNET_PX);
      arrowXTo?.(3 + nx * 2);
      arrowYTo?.(ny * 1.2);

      pulseSafe(liquidEngine, labelEl, 0.7);
      pulseSurfaceSafe(surfaceEngine, btn, 0.85);
    };

    const onPointerMove = (event) => {
      if (event.pointerType === 'touch') return;
      const { nx, ny } = updatePointerCoords(event);
      xTo?.(nx * MAX_MAGNET_PX);
      yTo?.(ny * MAX_MAGNET_PX);
      arrowXTo?.(3 + nx * 2.5);
      arrowYTo?.(ny * 1.5);
    };

    const onPointerLeave = () => {
      cachedRect = null;
      xTo?.(0);
      yTo?.(0);
      arrowXTo?.(0);
      arrowYTo?.(0);

      if (isPressed) {
        isPressed = false;
        gsap.to(btn, {
          scale: 1,
          duration: 0.45,
          ease: 'power3.out',
          overwrite: 'auto',
        });
      }
    };

    const onPointerDown = () => {
      isPressed = true;
      gsap.to(btn, {
        scale: 0.96,
        duration: 0.14,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    };

    const onPointerUp = () => {
      if (!isPressed) return;
      isPressed = false;
      gsap.to(btn, {
        scale: 1,
        duration: 0.64,
        ease: 'elastic.out(1.08, 0.42)',
        overwrite: 'auto',
      });
    };

    const onClick = () => {
      pulseSurfaceSafe(surfaceEngine, btn, 0.85);
    };

    btn.addEventListener('pointerenter', onPointerEnter);
    btn.addEventListener('pointermove', onPointerMove);
    btn.addEventListener('pointerleave', onPointerLeave);
    btn.addEventListener('pointerdown', onPointerDown);
    btn.addEventListener('pointerup', onPointerUp);
    btn.addEventListener('pointercancel', onPointerUp);
    btn.addEventListener('click', onClick);

    cleanups.push(() => {
      btn.removeEventListener('pointerenter', onPointerEnter);
      btn.removeEventListener('pointermove', onPointerMove);
      btn.removeEventListener('pointerleave', onPointerLeave);
      btn.removeEventListener('pointerdown', onPointerDown);
      btn.removeEventListener('pointerup', onPointerUp);
      btn.removeEventListener('pointercancel', onPointerUp);
      btn.removeEventListener('click', onClick);

      gsap.killTweensOf(btn);
      gsap.set(btn, { clearProps: hasGlslText ? 'scale' : 'x,y,scale' });

      if (arrowEl) {
        gsap.killTweensOf(arrowEl);
        gsap.set(arrowEl, { clearProps: 'x,y' });
      }
    });
  });
}

/**
 * Configura parallax de scroll (apenas transform/GPU com scrub: true),
 * tracking independente de brilho especular (--mx, --my), micro-inclinacao 3D (<= 3.5deg)
 * e pulso controlado de superficie WebGL para .art-media-frame, .slab-stage e .triptych-card.
 * Nunca aplica opacity: 0 nem oculta os cards/imagens.
 */
function setupMediaParallaxAndGlare(surfaceEngine, triggers, cleanups) {
  const mediaNodes = queryGuarded(MEDIA_SELECTOR);
  if (!mediaNodes.length) return;

  let triptychIndex = 0;

  mediaNodes.forEach((el) => {
    let amplitude = 22;
    if (el.classList.contains('slab-stage')) {
      amplitude = 28;
    } else if (el.classList.contains('triptych-card')) {
      amplitude = TRIPTYCH_PARALLAX_STEPS[triptychIndex % TRIPTYCH_PARALLAX_STEPS.length];
      triptychIndex += 1;
    }

    // Perspectiva local para micro-inclinacao 3D sem depender de estilo no elemento pai
    // e sem alterar opacity/visibility das imagens.
    gsap.set(el, { transformPerspective: 960 });

    const parallaxTween = gsap.fromTo(
      el,
      { y: -amplitude },
      {
        y: amplitude,
        ease: 'none',
        scrollTrigger: {
          trigger: el,
          start: 'top bottom',
          end: 'bottom top',
          scrub: true,
          invalidateOnRefresh: true,
        },
      }
    );

    if (parallaxTween.scrollTrigger) {
      triggers.push(parallaxTween.scrollTrigger);
    }

    const rotXTo = gsap.quickTo(el, 'rotationX', { duration: 0.45, ease: 'power3.out' });
    const rotYTo = gsap.quickTo(el, 'rotationY', { duration: 0.45, ease: 'power3.out' });

    const glare = { x: 50, y: 50 };
    const applyGlareVars = () => {
      el.style.setProperty('--mx', `${glare.x.toFixed(2)}%`);
      el.style.setProperty('--my', `${glare.y.toFixed(2)}%`);
    };

    const glareXTo = gsap.quickTo(glare, 'x', {
      duration: 0.22,
      ease: 'power2.out',
      onUpdate: applyGlareVars,
    });
    const glareYTo = gsap.quickTo(glare, 'y', {
      duration: 0.22,
      ease: 'power2.out',
      onUpdate: applyGlareVars,
    });

    let cachedRect = null;
    let cachedScrollY = -1;
    let cachedViewportW = -1;

    const getRect = () => {
      const currentScrollY = window.scrollY;
      const currentViewportW = window.innerWidth;
      if (!cachedRect || cachedScrollY !== currentScrollY || cachedViewportW !== currentViewportW) {
        cachedRect = el.getBoundingClientRect();
        cachedScrollY = currentScrollY;
        cachedViewportW = currentViewportW;
      }
      return cachedRect;
    };

    const computeNormalized = (event) => {
      const rect = getRect();
      if (!rect.width || !rect.height) return { px: 0.5, py: 0.5, nx: 0, ny: 0 };

      const px = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      const py = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      return {
        px,
        py,
        nx: (px - 0.5) * 2,
        ny: (py - 0.5) * 2,
      };
    };

    const onPointerEnter = (event) => {
      if (event.pointerType === 'touch') return;
      cachedRect = el.getBoundingClientRect();
      cachedScrollY = window.scrollY;
      cachedViewportW = window.innerWidth;

      const { px, py, nx, ny } = computeNormalized(event);

      // Posiciona o brilho instantaneamente no ponto de entrada para evitar flash vindo do centro.
      const startX = px * 100;
      const startY = py * 100;
      glare.x = startX;
      glare.y = startY;
      glareXTo(startX, startX);
      glareYTo(startY, startY);
      applyGlareVars();

      rotXTo(clamp(-ny * MAX_TILT_DEG, -3.5, 3.5));
      rotYTo(clamp(nx * MAX_TILT_DEG, -3.5, 3.5));

      pulseSurfaceSafe(surfaceEngine, el, 0.55);
    };

    const onPointerMove = (event) => {
      if (event.pointerType === 'touch') return;
      const { px, py, nx, ny } = computeNormalized(event);

      glareXTo(px * 100);
      glareYTo(py * 100);

      rotXTo(clamp(-ny * MAX_TILT_DEG, -3.5, 3.5));
      rotYTo(clamp(nx * MAX_TILT_DEG, -3.5, 3.5));
    };

    const onPointerLeave = () => {
      cachedRect = null;
      rotXTo(0);
      rotYTo(0);
    };

    el.addEventListener('pointerenter', onPointerEnter);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerleave', onPointerLeave);

    cleanups.push(() => {
      el.removeEventListener('pointerenter', onPointerEnter);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('pointerleave', onPointerLeave);

      gsap.killTweensOf(glare);
      parallaxTween.kill();
      gsap.killTweensOf(el);
      gsap.set(el, { clearProps: 'y,rotationX,rotationY,transformPerspective' });
    });
  });
}

/**
 * Inicializa toda a coreografia de scroll, revelacoes GLSL bidirecionais,
 * microinteracoes de botoes, superficies WebGL e parallax/brilho especular nas imagens.
 *
 * @param {object} [liquidEngine] Engine de texto GLSL com metodos setReveal(el, v) e pulse(el, strength)
 * @param {object} [surfaceEngine] Engine de superficies WebGL com metodo pulseSurface(el, strength)
 * @returns {{ lenis: Lenis | null, stop: () => void, start: () => void, destroy: () => void }}
 */
export function initScrollChoreography(liquidEngine, surfaceEngine) {
  const prefersReducedMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia(REDUCED_MOTION_QUERY).matches;

  let destroyed = false;

  if (prefersReducedMotion) {
    const textNodes = queryGuarded(TEXT_SELECTOR);
    textNodes.forEach((el) => {
      setRevealSafe(liquidEngine, el, 1);
      gsap.set(el, { y: 0 });
    });

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
    };

    return {
      lenis: null,
      stop: () => {},
      start: () => {},
      destroy,
    };
  }

  const triggers = [];
  const cleanups = [];

  // 1. Lenis conectado ao ScrollTrigger e ao gsap.ticker.
  const lenis = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true,
    wheelMultiplier: 0.92,
    touchMultiplier: 1.4,
    autoRaf: false,
  });

  const onLenisScroll = () => {
    ScrollTrigger.update();
  };
  lenis.on('scroll', onLenisScroll);

  const onTicker = (time) => {
    lenis.raf(time * 1000);
  };
  gsap.ticker.add(onTicker);
  gsap.ticker.lagSmoothing(0);

  cleanups.push(() => {
    gsap.ticker.remove(onTicker);
    gsap.ticker.lagSmoothing(500, 33);
    if (typeof lenis.off === 'function') {
      lenis.off('scroll', onLenisScroll);
    }
    lenis.destroy();
  });

  // 2. Entrada e saida bidirecional em todos os blocos [data-glsl-text] (fora da Hero).
  setupTextChoreography(liquidEngine, triggers, cleanups);

  // 3. Microinteracoes nos botoes (.btn-pill, .quiz-pill, .newsletter-btn).
  setupButtonMicrointeractions(liquidEngine, surfaceEngine, cleanups);

  // 4. Parallax de scroll + brilho especular independente + micro-tilt 3D nas imagens.
  setupMediaParallaxAndGlare(surfaceEngine, triggers, cleanups);

  // Recalcula posicoes apos carregamento completo de fontes e midia.
  const safeRefresh = () => {
    if (!destroyed) {
      ScrollTrigger.refresh();
    }
  };

  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    document.fonts.ready.then(safeRefresh);
  }

  if (document.readyState !== 'complete') {
    window.addEventListener('load', safeRefresh, { once: true });
    cleanups.push(() => {
      window.removeEventListener('load', safeRefresh);
    });
  }

  const stop = () => {
    if (!destroyed) {
      lenis?.stop?.();
    }
  };

  const start = () => {
    if (!destroyed) {
      lenis?.start?.();
    }
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;

    triggers.forEach((st) => st.kill());
    triggers.length = 0;

    for (let i = cleanups.length - 1; i >= 0; i -= 1) {
      cleanups[i]();
    }
    cleanups.length = 0;
  };

  return { lenis, stop, start, destroy };
}

export default initScrollChoreography;
