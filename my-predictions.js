const predictionsRoot = document.querySelector("#my-predictions-root");

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function formatKarma(value) {
  return `${formatNumber(Math.round(Number(value) || 0))} Karma`;
}

function formatDate(value) {
  if (!value) return "Fecha no disponible";
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
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
  article.className = "prediction-card";

  const marketQuestion = market?.pregunta || prediction.market_id || "Mercado no disponible";
  const marketCategory = market?.categoria || "Mercado";
  const marketHref = `market-detail.html?id=${encodeURIComponent(prediction.market_id)}`;

  article.innerHTML = `
    <div class="prediction-card-header">
      <span class="tag">${marketCategory}</span>
      <span class="status status-open">${prediction.status || "Activa"}</span>
    </div>
    <h2>${marketQuestion}</h2>
    <dl class="prediction-summary-grid">
      <div><dt>Opción elegida</dt><dd>${prediction.option_selected || "No disponible"}</dd></div>
      <div><dt>Porcentaje de entrada</dt><dd>${prediction.entry_percentage ?? "-"}%</dd></div>
      <div><dt>Dificultad</dt><dd>${prediction.option_difficulty || "No disponible"}</dd></div>
      <div><dt>Karma arriesgado</dt><dd>${formatKarma(prediction.karma_risked)}</dd></div>
      <div><dt>Beneficio base estimado</dt><dd>${formatKarma(prediction.base_benefit_estimated)}</dd></div>
      <div><dt>Bonus dificultad</dt><dd>+${formatKarma(prediction.difficulty_bonus_estimated)}</dd></div>
      <div><dt>Prestigio si acierta</dt><dd>+${formatNumber(prediction.prestige_if_hit)}</dd></div>
      <div><dt>Prestigio si falla</dt><dd>${formatNumber(prediction.prestige_if_miss)}</dd></div>
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
