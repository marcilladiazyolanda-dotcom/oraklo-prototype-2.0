const demoUser = window.ORAKLO_DEMO_USER || {
  username: "@Usuario",
  karma: 1000,
  prestigio: 0,
  rango: "Observador"
};

const detailRoot = document.querySelector("#market-detail-root");
const predictionModal = document.querySelector("#prediction-modal");
const predictionModalSummary = document.querySelector("#prediction-modal-description");
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

const demoComments = [
  {
    user: "@AnalistaPixel",
    text: "La clave aquí es distinguir rumor de confirmación oficial. Sin fuente primaria no debería resolverse como Sí.",
    reaction: "Buen análisis"
  },
  {
    user: "@FramePerfecto",
    text: "Conviene mirar el historial de anuncios: muchas compañías publican primero en blog oficial y después en redes.",
    reaction: "Fuente útil"
  },
  {
    user: "@LoreTracker",
    text: "Mercado interesante porque obliga a leer fecha, criterio y fuente antes de participar.",
    reaction: "Criterio claro"
  }
];

let detailDataWarning = "";

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(value);
}

function formatKarma(value) {
  return `${formatNumber(Math.round(value))} Karma`;
}

function getQueryMarketId() {
  return new URLSearchParams(window.location.search).get("id");
}

function getFallbackMarkets() {
  return Array.isArray(window.ORAKLO_MARKETS) ? window.ORAKLO_MARKETS : [];
}

async function loadMarketFromSupabase(marketId) {
  if (!window.orakloSupabase || typeof window.mapMarketFromSupabase !== "function") {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase
    .from("markets")
    .select("*")
    .eq("id", marketId)
    .single();

  if (error) {
    throw error;
  }

  return window.mapMarketFromSupabase(data);
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
  return Math.min(demoUser.karma * predictionRules.maxNormalRatio, predictionRules.maxBeta);
}

function clampKarma(value) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return predictionRules.minKarma;
  return Math.min(Math.max(parsed, predictionRules.minKarma), getMaxKarma());
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
  const returnTotal = amount * (100 / option.percentage);
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
  return `
    <div class="trend-card detail-trend-card">
      <p class="trend-title">Tendencia actual</p>
      <div class="trend-row">
        <span>Sí ${market.porcentajeSi}%</span>
        <span>No ${market.porcentajeNo}%</span>
      </div>
      <div class="trend-bar" style="--yes: ${market.porcentajeSi}%; --no: ${market.porcentajeNo}%;" role="img" aria-label="Tendencia: Sí ${market.porcentajeSi} por ciento, No ${market.porcentajeNo} por ciento">
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
      <p>Consultando la información del mercado en Supabase.</p>
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
        <span>Estado del usuario demo</span>
        <strong>${demoUser.rango}</strong>
        <small>Prestigio: ${formatNumber(demoUser.prestigio)}</small>
        <small>Karma disponible: ${formatNumber(demoUser.karma)}</small>
      </div>
    </section>

    ${detailDataWarning ? `<p class="data-source-warning detail-source-warning">${detailDataWarning}</p>` : ""}

    <section class="detail-notices" aria-label="Avisos importantes">
      <p><strong>Privacidad:</strong> Tu predicción activa será privada hasta que el mercado se resuelva.</p>
      <p><strong>Prototipo:</strong> Datos demo para prototipo. Sin dinero real.</p>
      <p><strong>Resolución:</strong> La resolución se basará en la fuente indicada.</p>
    </section>

    <div class="detail-layout">
      <aside class="prediction-panel" aria-labelledby="prediction-heading">
        <p class="eyebrow">Participación demo</p>
        <h2 id="prediction-heading">Hacer predicción</h2>
        <p class="panel-copy">El Karma permite participar. El Prestigio mide tu calidad como predictor.</p>

        <div class="option-grid" role="group" aria-label="Seleccionar opción">
          ${createOptionButton(market, "si")}
          ${createOptionButton(market, "no")}
        </div>

        <div class="karma-input-block">
          <label for="karma-amount">Cantidad de Karma</label>
          <div class="karma-input-row">
            <input id="karma-amount" type="number" min="${predictionRules.minKarma}" max="${getMaxKarma()}" step="10" value="${predictionState.amount}">
            <span class="input-limit">Máx. ${formatNumber(getMaxKarma())}</span>
          </div>
          <div class="quick-amounts" aria-label="Cantidades rápidas">
            <button type="button" data-amount="10">10 K</button>
            <button type="button" data-amount="50">50 K</button>
            <button type="button" data-amount="100">100 K</button>
            <button type="button" data-amount="max">Máx.</button>
          </div>
        </div>

        <div class="estimate-card" id="estimate-card"></div>
        <button class="primary-button confirm-button" id="confirm-prediction" type="button"${market.estado !== "Abierto" ? " disabled" : ""}>Confirmar predicción</button>
        ${market.estado !== "Abierto" ? '<p class="disabled-note">Este mercado no está abierto. La participación queda desactivada en el prototipo.</p>' : ""}
      </aside>

      <section class="detail-main">
        <article class="detail-card">
          <h2>Información del mercado</h2>
          ${createTrendMarkup(market)}
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
          <div class="comment-list">
            ${demoComments.map((comment) => `
              <article class="comment-item">
                <strong>${comment.user}</strong>
                <p>${comment.text}</p>
                <span>${comment.reaction}</span>
              </article>
            `).join("")}
          </div>
          <label class="sr-only" for="comment-placeholder">Comentarios</label>
          <input id="comment-placeholder" class="comment-input" type="text" placeholder="Los comentarios reales se activarán con usuarios registrados." disabled>
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
    <p class="privacy-note">La predicción activa será privada hasta resolución.</p>
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
    openPredictionModal(market);
  });
}

function openPredictionModal(market) {
  const estimate = calculateEstimate(market);

  predictionModalSummary.innerHTML = `
    <dl class="estimate-list modal-estimate-list">
      <div><dt>Mercado</dt><dd>${market.pregunta}</dd></div>
      <div><dt>Opción elegida</dt><dd>${estimate.option.label}</dd></div>
      <div><dt>Karma arriesgado</dt><dd>${formatKarma(estimate.amount)}</dd></div>
      <div><dt>Beneficio base estimado</dt><dd>${formatKarma(estimate.baseBenefit)}</dd></div>
      <div><dt>Bonus dificultad</dt><dd>+${formatKarma(estimate.bonus)}</dd></div>
      <div><dt>Prestigio si acierta</dt><dd>+${estimate.prestigeHit}</dd></div>
      <div><dt>Prestigio si falla</dt><dd>${estimate.prestigeMiss}</dd></div>
      <div><dt>Aviso</dt><dd>Esta predicción no se guarda todavía porque no hay backend.</dd></div>
    </dl>
  `;
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

    detailDataWarning = "No se ha podido cargar este mercado desde Supabase. Mostrando datos demo.";
    renderDetail(fallbackMarket);
  }
}

initializeMarketDetail();
