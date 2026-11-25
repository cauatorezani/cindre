/**
 * CINDRE — Maison de Parfum · Paris
 * Orquestração ESM unificada:
 * - SVG inline (svg-graphics.js)
 * - WebGL GLSL Liquid Text (glsl-text.js)
 * - WebGL GLSL Liquid Surfaces — fundo, cards e botões (glsl-surfaces.js)
 * - Coreografia GSAP ScrollTrigger + Lenis (scroll-choreography.js)
 * - Hero Óptica CINDRE 1:1 (cindre-hero.js)
 * - Interações editoriais reais (hotspots bidirecionais, quiz olfativo, newsletter e dossiê)
 */

import { mountSvgGraphics } from './svg-graphics.js';
import * as glslTextModule from './glsl-text.js';
import { initScrollChoreography } from './scroll-choreography.js';
import { initCindreHero } from './cindre-hero.js';

const DISCOVER_DOSSIERS = Object.freeze({
  'art-pierre': {
    kicker: 'FILOSOFIA CINDRE · PARIS',
    title: "L'art de la pierre et du parfum",
    body:
      'Esculpida entre o silêncio vulcânico do basalto e a delicadeza da alta perfumaria parisiense, cada criação da CINDRE repousa em maceração lenta antes do envase numerado, revelando uma assinatura mineral profunda e luminosa.',
    origin: 'Paris Ier & Grasse, França',
    method: 'Maceração a frio em pequenos lotes',
    notes: 'Basalto · Ládano · Oud Envelhecido',
  },
  natural: {
    kicker: 'MATÉRIAS-PRIMAS RARAS',
    title: 'Ingrédients Naturels',
    body:
      'Favas de baunilha negra curadas ao sol e botânicos colhidos no auge da safra compõem a espinha dorsal sensorial da Maison CINDRE — extrações puras que preservam o caráter orgânico de cada terroir.',
    origin: 'Madagascar & Comores',
    method: 'Infusão artesanal de favas inteiras',
    notes: 'Baunilha Negra · Açafrão · Benjoim',
  },
  rose: {
    kicker: 'CORAÇÃO FLORAL NOTURNO',
    title: 'Pétalas de rosa',
    body:
      'Colhidas antes do nascer do sol para preservar seus ésteres voláteis, nossas pétalas de rosa damascena noturna oferecem uma faceta floral opulenta, escura e levemente especiada.',
    origin: 'Vale de Isparta & Grasse',
    method: 'Destilação a vapor em cobre',
    notes: 'Rosa Damascena · Cereja Negra · Davana',
  },
  sandal: {
    kicker: 'MADEIRA NOBRE',
    title: 'Sândalo de rosa',
    body:
      'Lascas selecionadas de madeira de sândalo envelhecido entregam uma cremosidade envolvente e lactônica, ancorando cada extrait CINDRE na pele com calor arquitetônico duradouro.',
    origin: 'Mysore & Austrália Ocidental',
    method: 'Hidrodestilação lenta de cerne maduro',
    notes: 'Sândalo Cremoso · Camurça Negra · Fava Tonka',
  },
  incense: {
    kicker: 'RASTRO MÍSTICO & MINERAL',
    title: 'Resina de incenso natural',
    body:
      'Lágrimas douradas de olíbano puro e ládano selecionadas manualmente conferem verticalidade incensada, frescor mineral e um rastro hipnótico sobre a pedra vulcânica.',
    origin: 'Dhofar, Omã',
    method: 'Extração CO₂ supercrítica & resinóide',
    notes: 'Olíbano Puro · Ládano · Basalto Úmido',
  },
});

const QUIZ_RECOMMENDATIONS = Object.freeze({
  amber: {
    name: 'Cindre N°01 — Ambre Solis',
    desc: 'Resina de ládano defumada sobre açafrão quente e madeira de oud envelhecida. Denso, dourado, mineral.',
    notes: 'Notas: Açafrão · Ládano · Oud',
    concentration: 'Extrait Concentré · 100 ml · € 215',
  },
  mineral: {
    name: 'Cindre N°02 — Galet Minéral',
    desc: 'Pedra de rio após a chuva noturna. Folha de figueira esmagada, chá verde sencha e o frescor úmido do basalto.',
    notes: 'Notas: Folha de Figo · Basalto Úmido · Vetiver',
    concentration: 'Extrait Concentré · 100 ml · € 185',
  },
  volcan: {
    name: 'Cindre N°03 — Rubis Volcan',
    desc: 'Cereja negra macerada e açafrão cravados em camurça escura. A joia mais profunda da coleção CINDRE.',
    notes: 'Notas: Cereja Negra · Rosa Damascena · Camurça',
    concentration: 'Extrait Concentré · 100 ml · € 240',
  },
  rose: {
    name: 'Cindre N°04 — Velours de Rose',
    desc: 'Pétalas de rosa negra colhidas ao amanhecer envoltas por olíbano puro, sândalo cremoso e um acorde sutil de pedra fria.',
    notes: 'Notas: Rosa Negra · Olíbano · Sândalo',
    concentration: 'Édition Salon Privé · 100 ml · € 230',
  },
});

/**
 * Sincroniza hover/foco bidirecional entre os 4 blocos de texto de Ingredientes
 * e os 4 objetos botânicos independentes (.slab-object) sobre a laje de basalto.
 */
function setupIngredientLinkage(liquidEngine) {
  const slabStage = document.querySelector('.slab-stage');
  const slabObjects = Array.from(document.querySelectorAll('.slab-object[data-ingredient]'));
  const blocks = Array.from(document.querySelectorAll('[data-ingredient-block]'));
  const buttons = Array.from(document.querySelectorAll('[data-ingredient-link]'));

  if (!slabStage || !slabObjects.length) return () => {};

  const cleanups = [];
  let activeKey = null;

  const setActiveIngredient = (key, source) => {
    if (activeKey === key) return;
    activeKey = key;

    slabObjects.forEach((obj) => {
      obj.classList.toggle('is-active', Boolean(key) && obj.dataset.ingredient === key);
    });

    blocks.forEach((block) => {
      const isMatch = Boolean(key) && block.dataset.ingredientBlock === key;
      block.classList.toggle('is-linked', isMatch);
      if (isMatch && source === 'object') {
        const heading = block.querySelector('[data-glsl-text]');
        if (heading) {
          liquidEngine?.pulse?.(heading, 0.55);
        }
      }
    });

    buttons.forEach((btn) => {
      btn.classList.toggle('is-linked', Boolean(key) && btn.dataset.ingredientLink === key);
    });
  };

  slabObjects.forEach((obj) => {
    const key = obj.dataset.ingredient;
    const onEnter = () => setActiveIngredient(key, 'object');
    const onLeave = () => setActiveIngredient(null, 'object');

    obj.addEventListener('pointerenter', onEnter);
    obj.addEventListener('focus', onEnter);
    obj.addEventListener('pointerleave', onLeave);
    obj.addEventListener('blur', onLeave);

    cleanups.push(() => {
      obj.removeEventListener('pointerenter', onEnter);
      obj.removeEventListener('focus', onEnter);
      obj.removeEventListener('pointerleave', onLeave);
      obj.removeEventListener('blur', onLeave);
    });
  });

  blocks.forEach((block) => {
    const key = block.dataset.ingredientBlock;
    const onEnter = () => setActiveIngredient(key, 'block');
    const onLeave = () => setActiveIngredient(null, 'block');

    block.addEventListener('pointerenter', onEnter);
    block.addEventListener('focusin', onEnter);
    block.addEventListener('pointerleave', onLeave);
    block.addEventListener('focusout', (event) => {
      if (!block.contains(event.relatedTarget)) {
        onLeave();
      }
    });

    cleanups.push(() => {
      block.removeEventListener('pointerenter', onEnter);
      block.removeEventListener('focusin', onEnter);
      block.removeEventListener('pointerleave', onLeave);
    });
  });

  return () => {
    cleanups.forEach((fn) => fn());
  };
}

/**
 * Configura o quiz olfativo discreto em #trouver-empreinte.
 */
function setupOlfactoryQuiz(liquidEngine, surfaceEngine) {
  const panel = document.getElementById('quiz-panel');
  const triggers = Array.from(document.querySelectorAll('.quiz-pill[data-quiz-mode]'));
  const closeBtn = document.querySelector('[data-quiz-close]');
  const facetBtns = Array.from(document.querySelectorAll('.quiz-facet-btn[data-facet]'));
  const eyebrowEl = document.getElementById('quiz-panel-eyebrow');
  const nameEl = document.getElementById('quiz-result-name');
  const descEl = document.getElementById('quiz-result-desc');
  const notesEl = document.getElementById('quiz-result-notes');
  const concEl = document.getElementById('quiz-result-concentration');

  if (!panel || !triggers.length) return () => {};

  const renderFacet = (facetKey) => {
    const data = QUIZ_RECOMMENDATIONS[facetKey] || QUIZ_RECOMMENDATIONS.amber;
    facetBtns.forEach((btn) => {
      const selected = btn.dataset.facet === facetKey;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-selected', String(selected));
    });

    if (nameEl) nameEl.textContent = data.name;
    if (descEl) descEl.textContent = data.desc;
    if (notesEl) notesEl.textContent = data.notes;
    if (concEl) concEl.textContent = data.concentration;
  };

  const syncLayout = () => {
    window.requestAnimationFrame(() => {
      liquidEngine?.refresh?.();
      surfaceEngine?.refresh?.();
    });
  };

  const openPanel = (mode, activeTrigger) => {
    const wasHidden = panel.hidden;
    panel.hidden = false;

    triggers.forEach((btn) => {
      const isActive = btn === activeTrigger;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-expanded', String(isActive));
    });

    if (eyebrowEl) {
      eyebrowEl.textContent =
        mode === 'signature'
          ? 'ASSINATURA OLFATIVA · QUEL EST VOTRE PARFUM'
          : 'EXPLORAÇÃO SENSORIAL · ENCONTRE SUA ESSÊNCIA';
    }

    renderFacet(mode === 'signature' ? 'amber' : 'volcan');

    if (wasHidden) {
      syncLayout();
    }
  };

  const closePanel = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    triggers.forEach((btn) => {
      btn.classList.remove('is-active');
      btn.setAttribute('aria-expanded', 'false');
    });
    syncLayout();
  };

  triggers.forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.quizMode || 'signature';
      const isAlreadyOpen = !panel.hidden && btn.classList.contains('is-active');
      if (isAlreadyOpen) {
        closePanel();
      } else {
        openPanel(mode, btn);
      }
    });
  });

  facetBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      renderFacet(btn.dataset.facet);
    });
  });

  closeBtn?.addEventListener('click', closePanel);

  return () => {
    closePanel();
  };
}

/**
 * Configura validação e feedback real do formulário de newsletter no footer.
 */
function setupNewsletter() {
  const form = document.getElementById('newsletter-form');
  const input = document.getElementById('newsletter-email');
  const feedback = document.getElementById('newsletter-feedback');

  if (!form || !input || !feedback) return;

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();

    if (!emailPattern.test(value)) {
      feedback.classList.add('is-error');
      feedback.textContent = 'Por favor, informe um endereço de e-mail válido.';
      input.focus();
      return;
    }

    feedback.classList.remove('is-error');
    feedback.textContent = 'Merci — seu e-mail foi registrado no círculo privado CINDRE.';
    form.reset();
  });
}

/**
 * Modal editorial discreto acionado pelos botões "Découvrir" e hotspots da laje.
 */
function setupDiscoverModal(scrollCtrl) {
  const modal = document.getElementById('discover-modal');
  const kickerEl = document.getElementById('discover-modal-kicker');
  const titleEl = document.getElementById('discover-modal-title');
  const bodyEl = document.getElementById('discover-modal-body');
  const originEl = document.getElementById('discover-spec-origin');
  const methodEl = document.getElementById('discover-spec-method');
  const notesEl = document.getElementById('discover-spec-notes');
  const closeTargets = Array.from(document.querySelectorAll('[data-modal-close]'));
  const discoverTriggers = Array.from(document.querySelectorAll('[data-discover]'));

  if (!modal || !discoverTriggers.length) return () => {};

  let lastFocused = null;

  const closeModal = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    scrollCtrl?.start?.() ?? scrollCtrl?.lenis?.start?.();
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };

  const openModal = (key) => {
    const dossier = DISCOVER_DOSSIERS[key] || DISCOVER_DOSSIERS['art-pierre'];
    lastFocused = document.activeElement;

    if (kickerEl) kickerEl.textContent = dossier.kicker;
    if (titleEl) titleEl.textContent = dossier.title;
    if (bodyEl) bodyEl.textContent = dossier.body;
    if (originEl) originEl.textContent = dossier.origin;
    if (methodEl) methodEl.textContent = dossier.method;
    if (notesEl) notesEl.textContent = dossier.notes;

    modal.hidden = false;
    document.body.classList.add('modal-open');
    scrollCtrl?.stop?.() ?? scrollCtrl?.lenis?.stop?.();

    const closeButton = modal.querySelector('.discover-close');
    closeButton?.focus();
  };

  discoverTriggers.forEach((trigger) => {
    trigger.addEventListener('click', () => {
      openModal(trigger.dataset.discover);
    });
  });

  closeTargets.forEach((target) => {
    target.addEventListener('click', closeModal);
  });

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && !modal.hidden) {
      closeModal();
    }
  };

  window.addEventListener('keydown', onKeyDown);

  return () => {
    window.removeEventListener('keydown', onKeyDown);
    closeModal();
  };
}

/**
 * Navegação suave pelos links internos do footer usando Lenis quando ativo.
 */
function setupSmoothAnchors(scrollCtrl) {
  const anchorLinks = Array.from(
    document.querySelectorAll('.footer-link[href^="#"], .footer-brand[href^="#"]')
  );

  anchorLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      const targetSelector = link.getAttribute('href');
      if (!targetSelector || targetSelector === '#') return;
      const target = document.querySelector(targetSelector);
      if (!target) return;

      event.preventDefault();
      if (typeof scrollCtrl?.lenis?.scrollTo === 'function') {
        scrollCtrl.lenis.scrollTo(target, { offset: -20, duration: 1.2 });
      } else {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

async function bootstrap() {
  // 1. Injeta todos os SVGs inline e inicia imediatamente a Hero óptica CINDRE (Frame 1)
  mountSvgGraphics(document);

  let scrollCtrl = null;
  const lenisProxy = {
    get lenis() {
      return scrollCtrl?.lenis || null;
    },
    stop() {
      scrollCtrl?.stop?.();
    },
    start() {
      scrollCtrl?.start?.();
    },
  };

  let cindreHero = null;
  try {
    cindreHero = initCindreHero({ lenisControl: lenisProxy });
  } catch (error) {
    console.warn('[CINDRE] Falha ao inicializar Hero óptica CINDRE.', error);
  }

  // 2. Aguarda carregamento completo das fontes web (Marcellus, Cormorant Garamond, Plus Jakarta Sans, Inter)
  if (document.fonts && typeof document.fonts.ready?.then === 'function') {
    await document.fonts.ready;
  }

  // 3. Inicializa WebGL GLSL Liquid Surfaces Engine (fundo, cards e botões) + acopla fluidField compartilhado se presente
  let surfaceEngine = null;
  let sharedFluidField = window.__CINDRE_FLUID_FIELD__ || null;
  try {
    const glslSurfacesModule = await import('./glsl-surfaces.js');
    const initLiquidSurfaces =
      glslSurfacesModule.initLiquidSurfacesEngine ||
      glslSurfacesModule.initGlslSurfaces ||
      glslSurfacesModule.default;

    if (typeof initLiquidSurfaces === 'function') {
      surfaceEngine = await initLiquidSurfaces(
        sharedFluidField ? { fluidField: sharedFluidField } : undefined
      );
      sharedFluidField =
        surfaceEngine?.fluidField ||
        surfaceEngine?.getFluidField?.() ||
        window.__CINDRE_FLUID_FIELD__ ||
        sharedFluidField;
    }
  } catch (error) {
    console.warn('[CINDRE] Falha ao inicializar WebGL Liquid Surfaces Engine.', error);
  }

  // 4. Inicializa WebGL GLSL Liquid Text Engine sincronizado ao mesmo fluidField se disponível
  let liquidEngine = null;
  try {
    const initLiquidText =
      glslTextModule.initLiquidTextEngine ||
      glslTextModule.initLiquidText ||
      glslTextModule.initGlslText ||
      glslTextModule.default;

    if (typeof initLiquidText === 'function') {
      liquidEngine = await initLiquidText(
        sharedFluidField ? { fluidField: sharedFluidField } : undefined
      );
    }
  } catch (error) {
    console.warn('[CINDRE] Falha ao inicializar WebGL Liquid Text Engine; mantendo texto nativo.', error);
  }

  // 5. Inicializa coreografia GSAP ScrollTrigger + Lenis sincronizada com texto e superfícies
  try {
    scrollCtrl = initScrollChoreography(liquidEngine, surfaceEngine);
  } catch (error) {
    console.warn('[CINDRE] Falha ao inicializar coreografia de scroll.', error);
  }

  // 6. Ativa interações editoriais reais
  setupIngredientLinkage(liquidEngine);
  setupOlfactoryQuiz(liquidEngine, surfaceEngine);
  setupNewsletter();
  setupDiscoverModal(scrollCtrl);
  setupSmoothAnchors(scrollCtrl);

  // Recalcula métricas após carregamento de imagens tardias
  window.addEventListener(
    'load',
    () => {
      liquidEngine?.refresh?.();
      surfaceEngine?.refresh?.();
    },
    { once: true }
  );

  // Limpeza ordenada ao sair da página
  window.addEventListener(
    'pagehide',
    () => {
      cindreHero?.destroy?.();
      scrollCtrl?.destroy?.();
      surfaceEngine?.destroy?.();
      liquidEngine?.destroy?.();
    },
    { once: true }
  );
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void bootstrap();
  });
} else {
  void bootstrap();
}
