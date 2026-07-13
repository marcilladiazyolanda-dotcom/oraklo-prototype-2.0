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

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
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
  const calculationPercentage = Math.max(option.percentage, 1);
  const returnTotal = amount * (100 / calculationPercentage);
  const baseBenefit = returnTotal - amount;
  const bonus = amount * (difficultyBonus[option.difficulty] || 0);
  const prestige = prestigeTable[option.difficulty] || prestigeTable.Normal;

  return {
    option,
    amount,
    returnTotal,
    baseBenefit,
    bonus,
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
  const participationDisabled = market.estado !== "Abierto" || !hasEnoughKarma;
  predictionState.amount = hasEnoughKarma
    ? clampKarma(predictionState.amount || predictionRules.minKarma)
    : 0;
  const noPredictionsNotice = market.tienePredicciones
    ? ""
    : '<p class="market-empty-note">Todavía no hay predicciones en este mercado.</p>';
  const disabledNote = market.estado !== "Abierto"
    ? "Este mercado no está abierto. La participación queda desactivada."
    : !hasEnoughKarma
      ? "Tu saldo actual no permite alcanzar el mínimo de 10 Karma con el límite del 20 %."
      : "";

  detailRoot.innerHTML = `
    <section class="detail-hero" aria-labelledby="detail-title">
      <div>
        <div class="featured-meta">
          <span class="tag">${market.categoria}</span>
          <span class="status ${getStatusClass(market.estado)}">${market.estado}</span>
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
      <p><strong>Prototipo:</strong> Sin dinero real. El Karma se descuenta al confirmar una predicción. El Prestigio se actualizará cuando el mercado se resuelva.</p>
      <p><strong>Resolución:</strong> La resolución se basará en la fuente indicada.</p>
    </section>

    <div class="detail-layout">
      <aside class="prediction-panel" aria-labelledby="prediction-heading">
        <p class="eyebrow">Participación</p>
        <h2 id="prediction-heading">Hacer predicción</h2>
        <p class="panel-copy">El Karma permite participar. El Prestigio mide tu calidad como predictor.</p>

        <div class="option-grid" role="group" aria-label="Seleccionar opción">
          ${createOptionButton(market, "si")}
          ${createOptionButton(market, "no")}
        </div>

        <div class="karma-input-block">
          <label for="karma-amount">Cantidad de Karma</label>
          <div class="karma-input-row">
            <input id="karma-amount" type="number" min="${hasEnoughKarma ? predictionRules.minKarma : 0}" max="${maxKarma}" step="10" value="${predictionState.amount}"${hasEnoughKarma ? "" : " disabled"}>
            <span class="input-limit">Máx. ${formatNumber(maxKarma)}</span>
          </div>
          <div class="quick-amounts" aria-label="Cantidades rápidas">
            <button type="button" data-amount="10"${maxKarma < 10 ? " disabled" : ""}>10 K</button>
            <button type="button" data-amount="50"${maxKarma < 50 ? " disabled" : ""}>50 K</button>
            <button type="button" data-amount="100"${maxKarma < 100 ? " disabled" : ""}>100 K</button>
            <button type="button" data-amount="max"${hasEnoughKarma ? "" : " disabled"}>Máx.</button>
          </div>
        </div>

        <div class="estimate-card" id="estimate-card"></div>
        <button class="primary-button confirm-button" id="confirm-prediction" type="button"${participationDisabled ? " disabled" : ""}>Confirmar predicción</button>
        ${disabledNote ? `<p class="disabled-note">${disabledNote}</p>` : ""}
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
            <div class="stat"><span>Cierre</span><strong>${market.cierre}</strong></div>
          </div>
        </article>

        <article class="detail-card">
          <h2>Resolución</h2>
          <dl class="resolution-list">
            <div><dt>Fuente de resolución</dt><dd>${market.fuenteResolucion}</dd></div>
            <div><dt>Criterio de Sí</dt><dd>${market.criterioSi}</dd></div>
            <div><dt>Criterio de No</dt><dd>${market.criterioNo}</dd></div>
            <div><dt>Caso dudoso</dt><dd>${market.casoDudoso}</dd></div>
          </dl>
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
}

function createOptionButton(market, optionId) {
  const option = getOptionData(market, optionId);
  const selected = predictionState.option === optionId;

  return `
    <button class="option-button${selected ? " is-selected" : ""}" type="button" data-option="${optionId}" aria-pressed="${selected}">
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
  amountInput.addEventListener("input", (event) => {
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
  confirmButton.addEventListener("click", () => {
    if (market.estado !== "Abierto") return;
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
    prediction: result?.prediction || null,
    profile: result?.profile || null
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

  if (market.estado !== "Abierto") {
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
    renderDetail(refreshedMarket);
    return refreshedMarket;
  } catch (_error) {
    detailDataWarning = "La predicción se ha guardado, pero las métricas no han podido actualizarse todavía.";
    renderDetail(market);
    return market;
  }
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
    await syncProfileAfterPrediction(result.profile);
    predictionState.amount = clampKarma(predictionState.amount);
    const refreshedMarket = await refreshMarketAfterPrediction(market);
    openPredictionModal(refreshedMarket, "saved", "", {
      estimate,
      remainingKarma: Number(result.profile?.karma)
    });
  } catch (error) {
    const errorKey = getPredictionErrorKey(error);

    if (errorKey === "AUTH_REQUIRED") {
      window.orakloAuth?.openAuthModal(getFriendlyPredictionError(errorKey));
      return;
    }

    const mode = errorKey === "PREDICTION_ALREADY_EXISTS" ? "duplicate" : "error";
    openPredictionModal(market, mode, getFriendlyPredictionError(errorKey), { estimate });
  } finally {
    const activeButton = document.querySelector("#confirm-prediction");
    if (activeButton) {
      activeButton.disabled = currentMarket?.estado !== "Abierto" || getMaxKarma() < predictionRules.minKarma;
      activeButton.textContent = originalLabel;
    }
  }
}

function openPredictionModal(market, mode = "saved", errorMessage = "", context = {}) {
  const estimate = context.estimate || calculateEstimate(market);
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
      <div><dt>Karma arriesgado</dt><dd>${formatKarma(estimate.amount)}</dd></div>
      ${isSaved ? `<div><dt>Karma restante</dt><dd>${formatKarma(context.remainingKarma)}</dd></div>` : ""}
      <div><dt>Prestigio posible si acierta</dt><dd>+${estimate.prestigeHit}</dd></div>
      <div><dt>Prestigio si falla</dt><dd>${estimate.prestigeMiss}</dd></div>
    </dl>
  `;

  predictionModalWarning.textContent = isSaved
    ? "Tu predicción se ha guardado y el Karma se ha descontado. El Prestigio se actualizará cuando el mercado se resuelva."
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
    renderDetail(market);
  } catch (error) {
    const fallbackMarket = getFallbackMarkets().find((item) => item.id === marketId);

    if (!fallbackMarket) {
      renderNotFound();
      return;
    }

    detailDataWarning = "No se ha podido cargar este mercado desde Supabase. Mostrando mercado de prueba local.";
    renderDetail(fallbackMarket);
  }
}

bindAuthProfileUpdates();
initializeMarketDetail();
