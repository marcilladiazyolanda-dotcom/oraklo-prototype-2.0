const fallbackUser = window.ORAKLO_DEMO_USER || {
  username: "@Usuario",
  karma: 1000,
  prestigio: 0,
  rango: "Observador"
};

const detailRoot = document.querySelector("#market-detail-root");
const predictionModal = document.querySelector("#prediction-modal");
const predictionModalCheck = document.querySelector("#prediction-modal-check");
const predictionModalEyebrow = document.querySelector("#prediction-modal .eyebrow");
const predictionModalTitle = document.querySelector("#prediction-modal-title");
const predictionModalSummary = document.querySelector("#prediction-modal-description");
const predictionModalWarning = document.querySelector("#prediction-modal .prototype-warning");
const predictionModalPrimary = document.querySelector("#prediction-modal-primary");
const predictionModalClose = document.querySelector("#prediction-modal-close");
const predictionModalOk = document.querySelector("#prediction-modal-ok");

const predictionState = {
  option: "si",
  amount: 50
};

const predictionRules = {
  minKarma: 10,
  maxBeta: 500,
  maxNormalRatio: 0.2
};

const difficultyBonus = {
  "Fácil": 0,
  "Normal": 0.05,
  "Difícil": 0.10,
  "Muy difícil": 0.20,
  "Épica": 0.35
};

const prestigeTable = {
  "Fácil": { hit: 10, miss: -4 },
  "Normal": { hit: 20, miss: -6 },
  "Difícil": { hit: 35, miss: -8 },
  "Muy difícil": { hit: 60, miss: -10 },
  "Épica": { hit: 100, miss: -15 }
};

let detailDataWarning = "";
let currentMarket = null;
let detailClockTimer = null;
let detailCloseRefreshRequested = false;
let currentMarketUsesSupabase = false;

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function escapeDetailHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSafeResolutionUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function createResolutionSourcesMarkup(market) {
  const sources = Array.isArray(market.fuentesResolucion)
    ? market.fuentesResolucion
    : [];
  const sourceItems = sources.map((source) => {
    const url = getSafeResolutionUrl(source.url);
    if (!url) return "";

    const citedText = source.citedText
      ? `<p>${escapeDetailHtml(source.citedText)}</p>`
      : "";

    return `
      <li class="resolution-source-item">
        <a href="${escapeDetailHtml(url)}" target="_blank" rel="noopener noreferrer">
          ${escapeDetailHtml(source.title || "Consultar fuente")}
          <span aria-hidden="true">↗</span>
        </a>
        ${citedText}
      </li>
    `;
  }).filter(Boolean).join("");

  if (!sourceItems) return "";

  const reviewLabel = market.modeloResolucionIa
    ? "Análisis asistido por IA y aprobado por una persona."
    : "Fuentes comprobadas durante la revisión humana.";

  return `
    <div class="resolution-evidence">
      <dt>Motivos y fuentes verificadas</dt>
      <dd>
        <p class="resolution-review-label">${reviewLabel}</p>
        <ul class="resolution-source-list">${sourceItems}</ul>
      </dd>
    </div>
  `;
}

function formatKarma(value) {
  return `${formatNumber(Math.round(Number(value) || 0))} Karma`;
}

function getQueryMarketId() {
  return new URLSearchParams(window.location.search).get("id");
}

function getFallbackMarkets() {
  return Array.isArray(window.ORAKLO_MARKETS) ? window.ORAKLO_MARKETS : [];
}

function getDisplayUser() {
  const authProfile = window.orakloAuth?.getState?.().profile;

  return {
    karma: Number(authProfile?.karma ?? fallbackUser.karma),
    prestige: Number(authProfile?.prestige ?? fallbackUser.prestigio ?? 0),
    rank: authProfile?.rank || fallbackUser.rango || "Observador"
  };
}

function getMarketTiming(market, now = Date.now()) {
  return window.getOrakloMarketTiming(market, now);
}

function getMarketStatusLabel(market, now = Date.now()) {
  const timing = getMarketTiming(market, now);
  if (timing.isResolved && market.resultadoResolucion) {
    return `Resuelto · ${market.resultadoResolucion}`;
  }
  return timing.effectiveStatus;
}

function normalizeRpcMarket(data) {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof window.mapMarketFromSupabase !== "function") {
    return null;
  }

  return window.mapMarketFromSupabase(row);
}

async function loadMarketFromSupabase(marketId) {
  if (!window.orakloSupabase || typeof window.mapMarketFromSupabase !== "function") {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_market_by_id", {
    market_id_input: marketId
  });

  if (error) {
    throw error;
  }

  const market = normalizeRpcMarket(data);
  if (!market) {
    throw new Error("Mercado no encontrado.");
  }

  return market;
}

function getStatusClass(status) {
  const classes = {
    "Abierto": "status-open",
    "Cerrado": "status-closed",
    "Resuelto": "status-resolved"
  };

  return classes[status] || "status-open";
}

function getDifficultyClass(difficulty) {
  const classes = {
    "Fácil": "difficulty-easy",
    "Normal": "difficulty-normal",
    "Difícil": "difficulty-hard",
    "Muy difícil": "difficulty-very-hard",
    "Épica": "difficulty-epic"
  };

  return classes[difficulty] || "difficulty-normal";
}

function getDifficultyFromPercentage(percentage) {
  if (percentage >= 70) return "Fácil";
  if (percentage >= 50) return "Normal";
  if (percentage >= 30) return "Difícil";
  if (percentage >= 15) return "Muy difícil";
  return "Épica";
}

function getMaxKarma() {
  const availableKarma = Math.max(0, Math.floor(getDisplayUser().karma));
  return Math.max(
    0,
    Math.min(
      Math.floor(availableKarma * predictionRules.maxNormalRatio),
      predictionRules.maxBeta,
      availableKarma
    )
  );
}

function clampKarma(value) {
  const maxKarma = getMaxKarma();
  if (maxKarma < predictionRules.minKarma) return maxKarma;

  const parsed = Number(value);
  if (Number.isNaN(parsed)) return predictionRules.minKarma;
  return Math.min(Math.max(Math.floor(parsed), predictionRules.minKarma), maxKarma);
}

function getOptionData(market, option) {
  const percentage = option === "si" ? market.porcentajeSi : market.porcentajeNo;
  const label = option === "si" ? "Sí" : "No";
  const difficulty = getDifficultyFromPercentage(percentage);

  return { label, percentage, difficulty };
}

function calculateEstimate(market) {
  const option = getOptionData(market, predictionState.option);
  const amount = clampKarma(predictionState.amount);
  const calculationPercentage = Math.min(100, Math.max(option.percentage, 10));
  const baseReturnTotal = amount * (100 / calculationPercentage);
  const baseBenefit = Math.max(0, baseReturnTotal - amount);
  const rawBonus = amount * (difficultyBonus[option.difficulty] || 0);
  const maxReturnTotal = amount * 10;
  const returnTotal = Math.min(baseReturnTotal + rawBonus, maxReturnTotal);
  const bonus = Math.max(0, returnTotal - baseReturnTotal);
  const prestige = prestigeTable[option.difficulty] || prestigeTable.Normal;

  return {
    option,
    amount,
    returnTotal,
    baseBenefit,
    bonus,
    maxReturnTotal,
    calculationPercentage,
    isCapped: baseReturnTotal + rawBonus > maxReturnTotal,
    prestigeHit: prestige.hit,
    prestigeMiss: prestige.miss
  };
}

function createTrendMarkup(market) {
  const hasPredictions = market.tienePredicciones !== false && market.prediccionesReales > 0;
  const label = hasPredictions
    ? `Tendencia: Sí ${market.porcentajeSi} por ciento, No ${market.porcentajeNo} por ciento`
    : "Sin predicciones todavía. Barra neutral al 50 por ciento para Sí y No.";

  return `
    <div class="trend-card detail-trend-card${hasPredictions ? "" : " trend-card-empty"}">
      <p class="trend-title">Tendencia actual</p>
      ${hasPredictions ? "" : '<p class="trend-empty-note">Sin predicciones todavía</p>'}
      <div class="trend-row">
        <span>Sí ${market.porcentajeSi}%</span>
        <span>No ${market.porcentajeNo}%</span>
      </div>
      <div class="trend-bar" style="--yes: ${market.porcentajeSi}%; --no: ${market.porcentajeNo}%;" role="img" aria-label="${label}">
        <span class="trend-yes"></span>
        <span class="trend-no"></span>
      </div>
    </div>
  `;
}

function createResolutionMarkup(market) {
  const timing = getMarketTiming(market);
  const resolutionDate = market.fechaResolucion && typeof window.formatOrakloLocalDate === "function"
    ? window.formatOrakloLocalDate(market.fechaResolucion)
    : market.fechaResolucion || "";
  let outcomeRows = "";
  let evidenceRows = "";

  if (market.resultadoResolucion) {
    outcomeRows += `<div class="resolution-outcome"><dt>Resultado oficial</dt><dd>${escapeDetailHtml(market.resultadoResolucion)}</dd></div>`;
    if (market.notaResolucion) {
      outcomeRows += `<div><dt>Explicación de la resolución</dt><dd>${escapeDetailHtml(market.notaResolucion)}</dd></div>`;
    }
    if (resolutionDate) {
      outcomeRows += `<div><dt>Fecha de resolución</dt><dd>${escapeDetailHtml(resolutionDate)}</dd></div>`;
    }
    evidenceRows = createResolutionSourcesMarkup(market);
  } else if (timing.isClosed) {
    outcomeRows = '<div class="resolution-pending"><dt>Estado de resolución</dt><dd>Pendiente de resolución</dd></div>';
  } else if (timing.isResolved) {
    outcomeRows = '<div class="resolution-pending"><dt>Resultado oficial</dt><dd>No disponible</dd></div>';
  }

  return `
    <dl class="resolution-list">
      ${outcomeRows}
      ${evidenceRows}
      <div><dt>Fuente de resolución</dt><dd>${market.fuenteResolucion}</dd></div>
      <div><dt>Criterio de Sí</dt><dd>${market.criterioSi}</dd></div>
      <div><dt>Criterio de No</dt><dd>${market.criterioNo}</dd></div>
      <div><dt>Caso dudoso</dt><dd>${market.casoDudoso}</dd></div>
    </dl>
  `;
}

function renderLoadingState() {
  detailRoot.innerHTML = `
    <section class="not-found-card loading-detail-card">
      <p class="eyebrow">Detalle de mercado</p>
      <h1>Cargando mercado...</h1>
      <p>Consultando métricas públicas en Supabase.</p>
    </section>
  `;
}

function renderNotFound() {
  currentMarket = null;
  stopDetailClock();
  detailRoot.innerHTML = `
    <section class="not-found-card">
      <p class="eyebrow">Detalle de mercado</p>
      <h1>Mercado no encontrado</h1>
      <p>No hemos encontrado un mercado con ese identificador.</p>
      <a class="primary-button" href="index.html">Volver a explorar mercados</a>
    </section>
  `;
}

function renderDetail(market) {
  currentMarket = market;
  const displayUser = getDisplayUser();
  const maxKarma = getMaxKarma();
  const hasEnoughKarma = maxKarma >= predictionRules.minKarma;
  const timing = getMarketTiming(market);
  const participationDisabled = !timing.isOpen || !hasEnoughKarma;
  predictionState.amount = hasEnoughKarma
    ? clampKarma(predictionState.amount || predictionRules.minKarma)
    : 0;
  const noPredictionsNotice = market.tienePredicciones
    ? ""
    : '<p class="market-empty-note">Todavía no hay predicciones en este mercado.</p>';
  const disabledNote = timing.isResolved
    ? "Este mercado está resuelto. La participación queda desactivada."
    : timing.isClosed
      ? "Este mercado está cerrado y pendiente de resolución."
      : !hasEnoughKarma
        ? "Tu saldo actual no permite alcanzar el mínimo de 10 Karma con el límite del 20 %."
        : "";

  detailRoot.innerHTML = `
    <section class="detail-hero" aria-labelledby="detail-title">
      <div>
        <div class="featured-meta">
          <span class="tag">${market.categoria}</span>
          <span class="status ${getStatusClass(timing.effectiveStatus)}" data-detail-market-status>${getMarketStatusLabel(market)}</span>
          <span class="difficulty ${getDifficultyClass(market.dificultad)}">Dificultad: ${market.dificultad}</span>
        </div>
        <h1 id="detail-title">${market.pregunta}</h1>
        <p class="detail-description">${market.descripcion}</p>
      </div>
      <div class="detail-hero-card">
        <span>Estado del usuario</span>
        <strong>${displayUser.rank}</strong>
        <small>Prestigio: ${formatNumber(displayUser.prestige)}</small>
        <small>Karma disponible: ${formatNumber(displayUser.karma)}</small>
      </div>
    </section>

    ${detailDataWarning ? `<p class="data-source-warning detail-source-warning">${detailDataWarning}</p>` : ""}

    <section class="detail-notices" aria-label="Avisos importantes">
      <p><strong>Privacidad:</strong> Tu predicción activa será privada hasta que el mercado se resuelva.</p>
      <p><strong>Prototipo:</strong> Sin dinero real, sin compra de Karma y sin Modo Real.</p>
      <p><strong>Resolución:</strong> El Karma se descuenta al confirmar. El retorno y el Prestigio se actualizan al resolver; el Prestigio nunca baja de 0. Si se anula, se devuelve todo el Karma y no cambia el Prestigio.</p>
    </section>

    <div class="detail-layout">
      <aside class="prediction-panel" aria-labelledby="prediction-heading">
        <p class="eyebrow">Participación</p>
        <h2 id="prediction-heading">Hacer predicción</h2>
        <p class="panel-copy">El Karma permite participar. El Prestigio mide tu calidad como predictor.</p>

        <div class="option-grid" role="group" aria-label="Seleccionar opción">
          ${createOptionButton(market, "si", participationDisabled)}
          ${createOptionButton(market, "no", participationDisabled)}
        </div>

        <div class="karma-input-block">
          <label for="karma-amount">Cantidad de Karma</label>
          <div class="karma-input-row">
            <input id="karma-amount" type="number" min="${hasEnoughKarma ? predictionRules.minKarma : 0}" max="${maxKarma}" step="10" value="${predictionState.amount}"${participationDisabled ? " disabled" : ""}>
            <span class="input-limit">Máx. ${formatNumber(maxKarma)}</span>
          </div>
          <div class="quick-amounts" aria-label="Cantidades rápidas">
            <button type="button" data-amount="10"${participationDisabled || maxKarma < 10 ? " disabled" : ""}>10 K</button>
            <button type="button" data-amount="50"${participationDisabled || maxKarma < 50 ? " disabled" : ""}>50 K</button>
            <button type="button" data-amount="100"${participationDisabled || maxKarma < 100 ? " disabled" : ""}>100 K</button>
            <button type="button" data-amount="max"${participationDisabled ? " disabled" : ""}>Máx.</button>
          </div>
        </div>

        <div class="estimate-card" id="estimate-card"></div>
        <button class="primary-button confirm-button" id="confirm-prediction" type="button"${participationDisabled ? " disabled" : ""}>Confirmar predicción</button>
        <p class="disabled-note" data-market-disabled-note${disabledNote ? "" : " hidden"}>${disabledNote}</p>
      </aside>

      <section class="detail-main">
        <article class="detail-card">
          <h2>Información del mercado</h2>
          ${createTrendMarkup(market)}
          ${noPredictionsNotice}
          <div class="detail-stat-grid">
            <div class="stat"><span>Karma total</span><strong>${formatNumber(market.karmaTotal)}</strong></div>
            <div class="stat"><span>Participantes</span><strong>${formatNumber(market.participantes)}</strong></div>
            <div class="stat"><span>Comentarios</span><strong>${formatNumber(market.comentarios)}</strong></div>
            <div class="stat detail-close-stat">
              <span>Cierre</span>
              <strong data-detail-market-countdown>${timing.label}</strong>
              <small data-detail-market-exact${timing.exactLabel ? "" : " hidden"}>${timing.exactLabel}</small>
            </div>
          </div>
        </article>

        <article class="detail-card">
          <h2>Resolución</h2>
          ${createResolutionMarkup(market)}
        </article>

        <section class="detail-card comments-card" aria-labelledby="comments-title">
          <h2 id="comments-title">Debate del mercado</h2>
          <p class="comments-placeholder">Los comentarios reales se activarán más adelante.</p>
          <label class="sr-only" for="comment-placeholder">Comentarios</label>
          <input id="comment-placeholder" class="comment-input" type="text" placeholder="Comentarios reales próximamente." disabled>
        </section>
      </section>
    </div>
  `;

  bindDetailEvents(market);
  renderEstimate(market);
  updateDetailClock();
}

function createOptionButton(market, optionId, disabled = false) {
  const option = getOptionData(market, optionId);
  const selected = predictionState.option === optionId;

  return `
    <button class="option-button${selected ? " is-selected" : ""}" type="button" data-option="${optionId}" aria-pressed="${selected}"${disabled ? " disabled" : ""}>
      <span>${option.label}</span>
      <strong>${option.percentage}%</strong>
      <small>Dificultad: ${option.difficulty}</small>
      <small>Valor de entrada: ${option.percentage}%</small>
    </button>
  `;
}

function renderEstimate(market) {
  const estimate = calculateEstimate(market);
  const card = document.querySelector("#estimate-card");
  const input = document.querySelector("#karma-amount");

  if (input) {
    input.value = estimate.amount;
  }

  card.innerHTML = `
    <p class="eyebrow">Cálculo estimado para prototipo</p>
    <dl class="estimate-list">
      <div><dt>Opción elegida</dt><dd>${estimate.option.label}</dd></div>
      <div><dt>Karma arriesgado</dt><dd>${formatKarma(estimate.amount)}</dd></div>
      <div><dt>Valor de la opción al entrar</dt><dd>${estimate.option.percentage}%</dd></div>
      <div><dt>Beneficio base estimado</dt><dd>${formatKarma(estimate.baseBenefit)}</dd></div>
      <div><dt>Bonus por dificultad</dt><dd>+${formatKarma(estimate.bonus)}</dd></div>
      <div><dt>Retorno total estimado</dt><dd>${formatKarma(estimate.returnTotal)}</dd></div>
      <div><dt>Tope de retorno</dt><dd>×10 · ${formatKarma(estimate.maxReturnTotal)}</dd></div>
      <div><dt>Prestigio posible si acierta</dt><dd>+${estimate.prestigeHit}</dd></div>
      <div><dt>Prestigio si falla</dt><dd>${estimate.prestigeMiss}</dd></div>
    </dl>
    <p class="privacy-note">La predicción activa será privada hasta resolución. El Karma se descontará al confirmar. El Prestigio se actualizará cuando el mercado se resuelva.</p>
  `;
}

function bindDetailEvents(market) {
  document.querySelectorAll("[data-option]").forEach((button) => {
    button.addEventListener("click", () => {
      predictionState.option = button.dataset.option;
      renderDetail(market);
    });
  });

  const amountInput = document.querySelector("#karma-amount");
  amountInput?.addEventListener("input", (event) => {
    predictionState.amount = clampKarma(event.target.value);
    renderEstimate(market);
  });

  document.querySelectorAll("[data-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.amount === "max" ? getMaxKarma() : button.dataset.amount;
      predictionState.amount = clampKarma(value);
      renderEstimate(market);
    });
  });

  const confirmButton = document.querySelector("#confirm-prediction");
  confirmButton?.addEventListener("click", () => {
    if (!getMarketTiming(market).isOpen) return;
    handleConfirmPrediction(market);
  });
}

function getPlacePredictionParams(market, estimate) {
  return {
    market_id_input: market.id,
    option_selected_input: estimate.option.label,
    entry_percentage_input: Math.round(estimate.option.percentage),
    option_difficulty_input: estimate.option.difficulty,
    karma_risked_input: Math.round(estimate.amount),
    base_benefit_estimated_input: Number(estimate.baseBenefit.toFixed(2)),
    difficulty_bonus_estimated_input: Number(estimate.bonus.toFixed(2)),
    prestige_if_hit_input: estimate.prestigeHit,
    prestige_if_miss_input: estimate.prestigeMiss
  };
}

function normalizePlacePredictionResult(data) {
  const result = Array.isArray(data) ? data[0] : data;
  return {
    prediction: Array.isArray(result?.prediction) ? result.prediction[0] : result?.prediction || null,
    profile: Array.isArray(result?.profile) ? result.profile[0] : result?.profile || null
  };
}

function getAuthoritativeEstimate(prediction, fallbackEstimate) {
  if (!prediction) return fallbackEstimate;

  const amount = Number(prediction.karma_risked ?? fallbackEstimate.amount);
  const baseBenefit = Number(
    prediction.base_benefit_estimated ?? fallbackEstimate.baseBenefit
  );
  const bonus = Number(
    prediction.difficulty_bonus_estimated ?? fallbackEstimate.bonus
  );

  return {
    option: {
      label: prediction.option_selected || fallbackEstimate.option.label,
      percentage: Number(
        prediction.entry_percentage ?? fallbackEstimate.option.percentage
      ),
      difficulty: prediction.option_difficulty || fallbackEstimate.option.difficulty
    },
    amount,
    baseBenefit,
    bonus,
    returnTotal: amount + baseBenefit + bonus,
    maxReturnTotal: amount * 10,
    prestigeHit: Number(prediction.prestige_if_hit ?? fallbackEstimate.prestigeHit),
    prestigeMiss: Number(prediction.prestige_if_miss ?? fallbackEstimate.prestigeMiss)
  };
}

async function placePredictionWithSupabase(market, estimate) {
  if (!window.orakloSupabase) {
    throw new Error("SUPABASE_UNAVAILABLE");
  }

  const { data, error } = await window.orakloSupabase.rpc(
    "place_prediction",
    getPlacePredictionParams(market, estimate)
  );

  if (error) {
    throw error;
  }

  return normalizePlacePredictionResult(data);
}

function getPredictionErrorKey(error) {
  const errorText = [error?.code, error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(" ")
    .toUpperCase();
  const knownErrors = [
    "PREDICTION_ALREADY_EXISTS",
    "INSUFFICIENT_KARMA",
    "MAX_KARMA_EXCEEDED",
    "MARKET_NOT_OPEN",
    "AUTH_REQUIRED",
    "PROFILE_NOT_FOUND",
    "MARKET_NOT_FOUND",
    "MIN_KARMA_REQUIRED",
    "INVALID_OPTION",
    "SUPABASE_UNAVAILABLE"
  ];

  const knownError = knownErrors.find((key) => errorText.includes(key));
  if (knownError) return knownError;
  if (error?.code === "23505") return "PREDICTION_ALREADY_EXISTS";
  return "UNKNOWN";
}

function getFriendlyPredictionError(errorKey) {
  const messages = {
    PREDICTION_ALREADY_EXISTS: "Ya tienes una predicción registrada en este mercado.",
    INSUFFICIENT_KARMA: "No tienes Karma suficiente para esta predicción.",
    MAX_KARMA_EXCEEDED: "La cantidad supera el máximo permitido para tu saldo actual.",
    MARKET_NOT_OPEN: "Este mercado ya no está abierto.",
    AUTH_REQUIRED: "Inicia sesión para confirmar tu predicción.",
    PROFILE_NOT_FOUND: "No se ha encontrado tu perfil. Cierra sesión y vuelve a entrar.",
    MARKET_NOT_FOUND: "Este mercado ya no está disponible.",
    MIN_KARMA_REQUIRED: "La cantidad mínima por predicción es 10 Karma.",
    INVALID_OPTION: "Elige Sí o No antes de confirmar tu predicción.",
    SUPABASE_UNAVAILABLE: "No se puede conectar con Supabase ahora mismo. Inténtalo de nuevo en unos instantes.",
    UNKNOWN: "No se ha podido confirmar la predicción. Inténtalo de nuevo."
  };

  return messages[errorKey] || messages.UNKNOWN;
}

function validatePredictionBeforeSave(market, estimate, auth) {
  if (!predictionState.option || !["si", "no"].includes(predictionState.option)) {
    return getFriendlyPredictionError("INVALID_OPTION");
  }

  if (!getMarketTiming(market).isOpen) {
    return getFriendlyPredictionError("MARKET_NOT_OPEN");
  }

  const amount = Number(estimate.amount);
  if (!Number.isFinite(amount) || amount < predictionRules.minKarma) {
    return getFriendlyPredictionError("MIN_KARMA_REQUIRED");
  }

  const availableKarma = Math.max(0, Math.floor(Number(auth?.profile?.karma) || 0));
  const maxAllowed = Math.min(
    Math.floor(availableKarma * predictionRules.maxNormalRatio),
    predictionRules.maxBeta
  );

  if (amount > availableKarma) {
    return getFriendlyPredictionError("INSUFFICIENT_KARMA");
  }

  if (amount > maxAllowed) {
    return getFriendlyPredictionError("MAX_KARMA_EXCEEDED");
  }

  return "";
}

async function syncProfileAfterPrediction(profile) {
  if (profile && typeof window.orakloAuth?.applyProfileSnapshot === "function") {
    window.orakloAuth.applyProfileSnapshot(profile);
  }

  if (typeof window.refreshOrakloProfile === "function") {
    return window.refreshOrakloProfile();
  }

  return window.orakloAuth?.refreshProfile?.();
}

async function refreshMarketAfterPrediction(market) {
  try {
    const refreshedMarket = await loadMarketFromSupabase(market.id);
    detailDataWarning = "";
    currentMarketUsesSupabase = true;
    renderDetail(refreshedMarket);
    return refreshedMarket;
  } catch (_error) {
    detailDataWarning = "La predicción se ha guardado, pero las métricas no han podido actualizarse todavía.";
    renderDetail(market);
    return market;
  }
}

async function refreshMarketAfterClosure(market) {
  try {
    const refreshedMarket = await loadMarketFromSupabase(market.id);
    detailDataWarning = "";
    currentMarketUsesSupabase = true;
    renderDetail(refreshedMarket);
    return refreshedMarket;
  } catch (_error) {
    detailDataWarning = "El mercado se ha cerrado en pantalla, pero no se ha podido sincronizar de nuevo con Supabase.";
    renderDetail(market);
    return market;
  }
}

function disablePredictionControls() {
  document
    .querySelectorAll("[data-option], #karma-amount, [data-amount], #confirm-prediction")
    .forEach((control) => {
      control.disabled = true;
    });
}

function updateDetailClock(now = Date.now()) {
  if (!currentMarket) return;

  const timing = getMarketTiming(currentMarket, now);
  const countdownNode = document.querySelector("[data-detail-market-countdown]");
  const exactDateNode = document.querySelector("[data-detail-market-exact]");
  const statusNode = document.querySelector("[data-detail-market-status]");
  const disabledNoteNode = document.querySelector("[data-market-disabled-note]");

  if (countdownNode) countdownNode.textContent = timing.label;
  if (exactDateNode) {
    exactDateNode.textContent = timing.exactLabel;
    exactDateNode.hidden = !timing.exactLabel;
  }
  if (statusNode) {
    statusNode.className = `status ${getStatusClass(timing.effectiveStatus)}`;
    statusNode.textContent = getMarketStatusLabel(currentMarket, now);
  }

  if (timing.isOpen) return;

  disablePredictionControls();
  if (disabledNoteNode) {
    disabledNoteNode.hidden = false;
    disabledNoteNode.textContent = timing.isResolved
      ? "Este mercado está resuelto. La participación queda desactivada."
      : "Este mercado está cerrado y pendiente de resolución.";
  }

  if (
    timing.isClosed &&
    currentMarket.estado === "Abierto" &&
    currentMarketUsesSupabase &&
    !detailCloseRefreshRequested
  ) {
    detailCloseRefreshRequested = true;
    currentMarket.estado = "Cerrado";
    refreshMarketAfterClosure(currentMarket);
  }
}

function startDetailClock() {
  stopDetailClock();
  updateDetailClock();
  detailClockTimer = window.setInterval(updateDetailClock, 1000);
}

function stopDetailClock() {
  if (detailClockTimer === null) return;
  window.clearInterval(detailClockTimer);
  detailClockTimer = null;
}

async function handleConfirmPrediction(market) {
  const auth = await window.orakloAuth?.requireAuth({
    message: "Inicia sesión para confirmar tu predicción."
  });

  if (!auth) return;

  const estimate = calculateEstimate(market);
  const validationMessage = validatePredictionBeforeSave(market, estimate, auth);
  if (validationMessage) {
    openPredictionModal(market, "error", validationMessage, { estimate });
    return;
  }

  const confirmButton = document.querySelector("#confirm-prediction");
  const originalLabel = confirmButton.textContent;
  confirmButton.disabled = true;
  confirmButton.textContent = "Confirmando...";

  try {
    const result = await placePredictionWithSupabase(market, estimate);
    const authoritativeEstimate = getAuthoritativeEstimate(result.prediction, estimate);
    await syncProfileAfterPrediction(result.profile);
    predictionState.amount = clampKarma(predictionState.amount);
    const refreshedMarket = await refreshMarketAfterPrediction(market);
    openPredictionModal(refreshedMarket, "saved", "", {
      estimate: authoritativeEstimate,
      prediction: result.prediction,
      remainingKarma: Number(result.profile?.karma)
    });
  } catch (error) {
    const errorKey = getPredictionErrorKey(error);

    if (errorKey === "AUTH_REQUIRED") {
      window.orakloAuth?.openAuthModal(getFriendlyPredictionError(errorKey));
      return;
    }

    let modalMarket = market;
    if (errorKey === "MARKET_NOT_OPEN") {
      detailCloseRefreshRequested = true;
      market.estado = "Cerrado";
      modalMarket = await refreshMarketAfterClosure(market);
    }

    const mode = errorKey === "PREDICTION_ALREADY_EXISTS" ? "duplicate" : "error";
    openPredictionModal(modalMarket, mode, getFriendlyPredictionError(errorKey), { estimate });
  } finally {
    const activeButton = document.querySelector("#confirm-prediction");
    if (activeButton) {
      activeButton.disabled = !currentMarket || !getMarketTiming(currentMarket).isOpen || getMaxKarma() < predictionRules.minKarma;
      activeButton.textContent = originalLabel;
    }
  }
}

function openPredictionModal(market, mode = "saved", errorMessage = "", context = {}) {
  const fallbackEstimate = context.estimate || calculateEstimate(market);
  const estimate = mode === "saved"
    ? getAuthoritativeEstimate(context.prediction, fallbackEstimate)
    : fallbackEstimate;
  const isSaved = mode === "saved";
  const isDuplicate = mode === "duplicate";
  const title = isSaved
    ? "Predicción confirmada correctamente"
    : isDuplicate
      ? "Ya tienes una predicción registrada en este mercado."
      : "No se ha podido guardar la predicción";

  predictionModalCheck.hidden = !isSaved;
  predictionModalEyebrow.textContent = isSaved ? "Predicción guardada" : "Aviso";
  predictionModalTitle.textContent = title;
  predictionModalPrimary.hidden = mode === "error";
  predictionModalPrimary.textContent = "Ver mis predicciones";
  predictionModalOk.textContent = "Cerrar";

  predictionModalSummary.innerHTML = `
    <dl class="estimate-list modal-estimate-list">
      <div><dt>Mercado</dt><dd>${market.pregunta}</dd></div>
      <div><dt>Opción elegida</dt><dd>${estimate.option.label}</dd></div>
      <div><dt>Porcentaje de entrada</dt><dd>${estimate.option.percentage}%</dd></div>
      <div><dt>Dificultad guardada</dt><dd>${estimate.option.difficulty}</dd></div>
      <div><dt>Karma arriesgado</dt><dd>${formatKarma(estimate.amount)}</dd></div>
      <div><dt>Beneficio base guardado</dt><dd>${formatKarma(estimate.baseBenefit)}</dd></div>
      <div><dt>Bonus de dificultad guardado</dt><dd>+${formatKarma(estimate.bonus)}</dd></div>
      ${isSaved ? `<div><dt>Karma restante</dt><dd>${formatKarma(context.remainingKarma)}</dd></div>` : ""}
      <div><dt>Prestigio posible si acierta</dt><dd>+${estimate.prestigeHit}</dd></div>
      <div><dt>Prestigio si falla</dt><dd>${estimate.prestigeMiss}</dd></div>
    </dl>
  `;

  predictionModalWarning.textContent = isSaved
    ? "Tu predicción se ha guardado y el Karma se ha descontado. Al resolverse, Oraklo abonará automáticamente el retorno que corresponda y actualizará el Prestigio."
    : isDuplicate
      ? "Puedes revisar tu predicción existente en Mis predicciones."
      : errorMessage || "No se ha guardado ningún dato nuevo.";

  predictionModal.hidden = false;
  predictionModalOk.focus();
}

function closePredictionModal() {
  predictionModal.hidden = true;
}

predictionModalClose.addEventListener("click", closePredictionModal);
predictionModalOk.addEventListener("click", closePredictionModal);
predictionModal.addEventListener("click", (event) => {
  if (event.target === predictionModal) {
    closePredictionModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !predictionModal.hidden) {
    closePredictionModal();
  }
});

function bindAuthProfileUpdates() {
  window.orakloAuth?.onChange?.((auth) => {
    if (!auth.ready || !currentMarket) return;
    predictionState.amount = clampKarma(predictionState.amount);
    renderDetail(currentMarket);
  });
}

async function initializeMarketDetail() {
  const marketId = getQueryMarketId();
  if (!marketId) {
    renderNotFound();
    return;
  }

  renderLoadingState();
  predictionState.amount = predictionRules.minKarma;

  try {
    const market = await loadMarketFromSupabase(marketId);
    detailDataWarning = "";
    currentMarketUsesSupabase = true;
    detailCloseRefreshRequested = false;
    renderDetail(market);
    startDetailClock();
  } catch (error) {
    const fallbackMarket = getFallbackMarkets().find((item) => item.id === marketId);

    if (!fallbackMarket) {
      renderNotFound();
      return;
    }

    detailDataWarning = "No se ha podido cargar este mercado desde Supabase. Mostrando mercado de prueba local.";
    currentMarketUsesSupabase = false;
    renderDetail(fallbackMarket);
    startDetailClock();
  }
}

window.addEventListener("pagehide", stopDetailClock);
window.addEventListener("pageshow", (event) => {
  if (event.persisted && currentMarket) startDetailClock();
});
bindAuthProfileUpdates();
initializeMarketDetail();
