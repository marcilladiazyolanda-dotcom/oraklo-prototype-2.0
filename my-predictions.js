const predictionsRoot = document.querySelector("#my-predictions-root");

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function formatKarma(value) {
  return `${formatNumber(Math.round(Number(value) || 0))} Karma`;
}

function formatDate(value) {
  if (!value) return "Fecha no disponible";
  if (typeof window.formatOrakloLocalDate === "function") {
    return window.formatOrakloLocalDate(value);
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatSignedNumber(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${formatNumber(number)}`;
  return formatNumber(number);
}

function formatSignedKarma(value) {
  const number = Math.round(Number(value) || 0);
  if (number > 0) return `+${formatNumber(number)} Karma`;
  return `${formatNumber(number)} Karma`;
}

function normalizePredictionResult(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["si", "sí"].includes(normalized)) return "Sí";
  if (normalized === "no") return "No";
  if (["anulado", "anulada", "void"].includes(normalized)) return "Anulado";
  return value || "";
}

function getPredictionViewState(prediction, market) {
  const rawStatus = String(prediction.status || "Activa").trim().toLowerCase();
  const officialResult = normalizePredictionResult(
    prediction.resolution_result || market?.resultadoResolucion
  );
  const hasSettlement = Boolean(
    prediction.settled_at ||
    prediction.resolution_result ||
    prediction.is_correct === true ||
    prediction.is_correct === false ||
    ["acertada", "fallada", "anulada"].includes(rawStatus)
  );

  if (hasSettlement && (officialResult === "Anulado" || rawStatus === "anulada")) {
    return { key: "annulled", label: "Anulada", officialResult: "Anulado", settled: true };
  }

  if (hasSettlement && (prediction.is_correct === true || rawStatus === "acertada")) {
    return { key: "hit", label: "Acertada", officialResult, settled: true };
  }

  if (hasSettlement && (prediction.is_correct === false || rawStatus === "fallada")) {
    return { key: "miss", label: "Fallada", officialResult, settled: true };
  }

  const effectiveMarketStatus = market && typeof window.getOrakloEffectiveMarketStatus === "function"
    ? window.getOrakloEffectiveMarketStatus(market)
    : market?.estado;

  if (effectiveMarketStatus && effectiveMarketStatus !== "Abierto") {
    return { key: "pending", label: "Pendiente de resolución", officialResult, settled: false };
  }

  return { key: "active", label: "Activa", officialResult, settled: false };
}

function getPredictionStatusClass(viewState) {
  const classes = {
    active: "status-open",
    pending: "status-pending",
    hit: "status-hit",
    miss: "status-miss",
    annulled: "status-annulled"
  };
  return classes[viewState.key] || "status-open";
}

function createActiveEstimateMarkup(prediction, isPending) {
  return `
    <div><dt>Beneficio base estimado</dt><dd>${formatKarma(prediction.base_benefit_estimated)}</dd></div>
    <div><dt>Bonus dificultad estimado</dt><dd>+${formatKarma(prediction.difficulty_bonus_estimated)}</dd></div>
    <div><dt>Prestigio si acierta</dt><dd>+${formatNumber(prediction.prestige_if_hit)}</dd></div>
    <div><dt>Prestigio si falla</dt><dd>${formatNumber(prediction.prestige_if_miss)}</dd></div>
    ${isPending ? '<div class="prediction-wide-row"><dt>Situación</dt><dd>El mercado está cerrado y espera resolución oficial.</dd></div>' : ""}
  `;
}

function createSettlementMarkup(prediction, viewState) {
  const karmaRisked = Number(prediction.karma_risked) || 0;
  const karmaAwarded = Number(prediction.karma_awarded) || 0;
  const balance = karmaAwarded - karmaRisked;
  const prestigeChange = Number(prediction.prestige_change) || 0;
  const balanceClass = balance > 0 ? "value-positive" : balance < 0 ? "value-negative" : "value-neutral";
  const prestigeClass = prestigeChange > 0
    ? "value-positive"
    : prestigeChange < 0
      ? "value-negative"
      : "value-neutral";
  const annulledNote = viewState.key === "annulled"
    ? '<div class="prediction-wide-row settlement-note settlement-note-annulled"><dt>Anulación</dt><dd>Se devolvió íntegramente el Karma arriesgado y el Prestigio no cambió.</dd></div>'
    : "";

  return `
    <div><dt>Resultado oficial</dt><dd>${viewState.officialResult || "No disponible"}</dd></div>
    <div><dt>Karma recibido al resolver</dt><dd>${formatKarma(karmaAwarded)}</dd></div>
    <div><dt>Balance final</dt><dd class="${balanceClass}">${formatSignedKarma(balance)}</dd></div>
    <div><dt>Cambio real de Prestigio</dt><dd class="${prestigeClass}">${formatSignedNumber(prestigeChange)}</dd></div>
    <div><dt>Fecha de liquidación</dt><dd>${formatDate(prediction.settled_at)}</dd></div>
    ${annulledNote}
  `;
}

function renderPredictionsLoading() {
  predictionsRoot.innerHTML = `
    <section class="not-found-card loading-detail-card">
      <p class="eyebrow">Mis predicciones</p>
      <h2>Cargando predicciones...</h2>
      <p>Consultando tus predicciones guardadas en Supabase.</p>
    </section>
  `;
}

function renderPredictionsGuest() {
  predictionsRoot.innerHTML = `
    <section class="not-found-card predictions-access-card">
      <p class="eyebrow">Acceso necesario</p>
      <h2>Inicia sesión para ver tus predicciones.</h2>
      <p>Tus predicciones se guardan en tu cuenta y permanecen privadas mientras están activas.</p>
      <button class="primary-button" type="button" data-auth-open data-auth-message="Inicia sesión para ver tus predicciones.">Entrar</button>
    </section>
  `;
}

function renderPredictionsEmpty() {
  predictionsRoot.innerHTML = `
    <section class="not-found-card predictions-access-card">
      <p class="eyebrow">Historial vacío</p>
      <h2>Aún no tienes predicciones</h2>
      <p>Entra en un mercado, elige Sí o No y confirma una predicción para verla aquí.</p>
      <a class="primary-button" href="index.html">Explorar mercados</a>
    </section>
  `;
}

function renderPredictionsError(message) {
  predictionsRoot.innerHTML = `
    <section class="not-found-card predictions-access-card">
      <p class="eyebrow">Supabase</p>
      <h2>No se han podido cargar tus predicciones</h2>
      <p>${message || "Revisa la sesión y vuelve a intentarlo."}</p>
      <button class="secondary-button retry-predictions" type="button">Reintentar</button>
    </section>
  `;

  document.querySelector(".retry-predictions")?.addEventListener("click", renderMyPredictions);
}

async function fetchPredictions() {
  const { data, error } = await window.orakloSupabase
    .from("predictions")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return data || [];
}

async function fetchMarketsForPredictions(predictions) {
  const marketIds = [...new Set(predictions.map((prediction) => prediction.market_id).filter(Boolean))];
  if (marketIds.length === 0) {
    return new Map();
  }

  const { data, error } = await window.orakloSupabase.rpc("get_public_markets");

  if (error) {
    return new Map();
  }

  return new Map((data || []).filter((row) => marketIds.includes(row.id)).map((row) => {
    const market = typeof window.mapMarketFromSupabase === "function"
      ? window.mapMarketFromSupabase(row)
      : row;
    return [market.id, market];
  }));
}

function createPredictionCard(prediction, market) {
  const article = document.createElement("article");
  const viewState = getPredictionViewState(prediction, market);
  article.className = `prediction-card prediction-card-${viewState.key}`;

  const marketQuestion = market?.pregunta || prediction.market_id || "Mercado no disponible";
  const marketCategory = market?.categoria || "Mercado";
  const marketHref = `market-detail.html?id=${encodeURIComponent(prediction.market_id)}`;

  article.innerHTML = `
    <div class="prediction-card-header">
      <span class="tag">${marketCategory}</span>
      <span class="status ${getPredictionStatusClass(viewState)}">${viewState.label}</span>
    </div>
    <h2>${marketQuestion}</h2>
    <dl class="prediction-summary-grid">
      <div><dt>Opción elegida</dt><dd>${prediction.option_selected || "No disponible"}</dd></div>
      <div><dt>Porcentaje de entrada</dt><dd>${prediction.entry_percentage ?? "-"}%</dd></div>
      <div><dt>Dificultad</dt><dd>${prediction.option_difficulty || "No disponible"}</dd></div>
      <div><dt>Karma arriesgado</dt><dd>${formatKarma(prediction.karma_risked)}</dd></div>
      ${viewState.settled
        ? createSettlementMarkup(prediction, viewState)
        : createActiveEstimateMarkup(prediction, viewState.key === "pending")}
      <div><dt>Fecha de participación</dt><dd>${formatDate(prediction.created_at)}</dd></div>
    </dl>
    <div class="prediction-card-actions">
      <a class="primary-button" href="${marketHref}">Ver mercado</a>
    </div>
  `;

  return article;
}

function renderPredictionList(predictions, marketsById) {
  predictionsRoot.innerHTML = `
    <div class="section-heading predictions-heading">
      <div>
        <p class="eyebrow">Predicciones privadas</p>
        <h2>${predictions.length} ${predictions.length === 1 ? "predicción" : "predicciones"}</h2>
      </div>
    </div>
    <div class="predictions-grid" id="predictions-list"></div>
  `;

  const list = document.querySelector("#predictions-list");
  predictions.forEach((prediction) => {
    list.appendChild(createPredictionCard(prediction, marketsById.get(prediction.market_id)));
  });
}

async function renderMyPredictions() {
  await window.orakloAuth.ready;
  const authState = window.orakloAuth.getState();

  if (!authState.isAuthenticated) {
    renderPredictionsGuest();
    return;
  }

  if (!window.orakloSupabase) {
    renderPredictionsError("Supabase no está disponible ahora mismo.");
    return;
  }

  renderPredictionsLoading();

  try {
    const predictions = await fetchPredictions();
    if (predictions.length === 0) {
      renderPredictionsEmpty();
      return;
    }

    const marketsById = await fetchMarketsForPredictions(predictions);
    renderPredictionList(predictions, marketsById);
  } catch (error) {
    renderPredictionsError(error.message);
  }
}

window.orakloAuth.onChange(() => {
  renderMyPredictions();
});

renderMyPredictions();
