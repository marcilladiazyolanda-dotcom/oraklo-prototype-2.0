const categories = [
  "Todos",
  "Lanzamientos",
  "Eventos",
  "Streamers",
  "YouTubers",
  "Industria",
  "Reviews/Premios"
];

const stateFilters = [
  { id: "activos", label: "Activos" },
  { id: "cierran-pronto", label: "Cierran pronto" },
  { id: "populares", label: "Populares" },
  { id: "dificiles", label: "Difíciles" },
  { id: "nuevos", label: "Nuevos" },
  { id: "resueltos", label: "Resueltos" }
];

let markets = [];
const seasonRankingUsers = [];

const activeFilters = {
  category: "Todos",
  state: "activos",
  query: ""
};

const categoryFilterNode = document.querySelector("#category-filters");
const stateFilterNode = document.querySelector("#state-filters");
const marketListNode = document.querySelector("#market-list");
const resultCountNode = document.querySelector("#result-count");
const emptyStateNode = document.querySelector("#empty-state");
const featuredMarketNode = document.querySelector("#featured-market");
const leaderboardPanelNode = document.querySelector("#leaderboard-panel");
const dataSourceWarningNode = document.querySelector("#data-source-warning");
const searchInput = document.querySelector("#market-search");
const clearButton = document.querySelector("#clear-filters");

function formatNumber(value) {
  return new Intl.NumberFormat("es-ES").format(value);
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function getMarketUrl(market) {
  return `market-detail.html?id=${encodeURIComponent(market.id)}`;
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

function getStatusClass(status) {
  const classes = {
    "Abierto": "status-open",
    "Cerrado": "status-closed",
    "Resuelto": "status-resolved"
  };

  return classes[status] || "status-open";
}

function isDifficultMarket(market) {
  return ["Difícil", "Muy difícil", "Épica"].includes(market.dificultad);
}

function getFallbackMarkets() {
  return Array.isArray(window.ORAKLO_MARKETS) ? window.ORAKLO_MARKETS : [];
}

function setDataSourceWarning(message) {
  if (!dataSourceWarningNode) return;
  dataSourceWarningNode.textContent = message;
  dataSourceWarningNode.hidden = !message;
}

async function loadMarketsFromSupabase() {
  if (!window.orakloSupabase || typeof window.mapMarketFromSupabase !== "function") {
    throw new Error("Supabase no está disponible.");
  }

  const { data, error } = await window.orakloSupabase
    .from("markets")
    .select("*")
    .order("highlighted", { ascending: false })
    .order("popularity", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return (data || []).map(window.mapMarketFromSupabase);
}

function getFilteredMarkets() {
  const query = normalizeText(activeFilters.query.trim());
  let filtered = markets.filter((market) => {
    const matchesCategory =
      activeFilters.category === "Todos" || market.categoria === activeFilters.category;
    const searchable = normalizeText(`${market.pregunta} ${market.categoria} ${market.estado}`);
    const matchesQuery = query.length === 0 || searchable.includes(query);

    return matchesCategory && matchesQuery;
  });

  if (activeFilters.state === "activos") {
    filtered = filtered.filter((market) => market.estado === "Abierto");
  }

  if (activeFilters.state === "cierran-pronto") {
    filtered = filtered
      .filter((market) => market.estado === "Abierto")
      .sort((a, b) => new Date(a.cierreFecha) - new Date(b.cierreFecha));
  }

  if (activeFilters.state === "populares") {
    filtered = filtered
      .filter((market) => market.estado === "Abierto")
      .sort((a, b) => b.popularidad - a.popularidad);
  }

  if (activeFilters.state === "dificiles") {
    filtered = filtered
      .filter((market) => market.estado === "Abierto" && isDifficultMarket(market))
      .sort((a, b) => b.popularidad - a.popularidad);
  }

  if (activeFilters.state === "nuevos") {
    filtered = filtered
      .filter((market) => market.estado === "Abierto")
      .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion));
  }

  if (activeFilters.state === "resueltos") {
    filtered = filtered.filter((market) => market.estado === "Resuelto");
  }

  return filtered;
}

function createTrendMarkup(market) {
  return `
    <div class="trend-card">
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

function createMarketCard(market) {
  const card = document.createElement("article");
  card.className = "market-card";
  card.innerHTML = `
    <div class="market-card-header">
      <span class="tag">${market.categoria}</span>
      <span class="status ${getStatusClass(market.estado)}">${market.estado}</span>
    </div>
    <h3>${market.pregunta}</h3>
    ${createTrendMarkup(market)}
    <div class="market-stats-line" aria-label="Datos de actividad del mercado">
      <span class="difficulty ${getDifficultyClass(market.dificultad)}">Dificultad: ${market.dificultad}</span>
      <span class="metric metric-karma">${formatNumber(market.karmaTotal)} Karma</span>
      <span class="metric metric-users">${formatNumber(market.participantes)} participantes</span>
      <span class="metric metric-comments">${formatNumber(market.comentarios)} comentarios</span>
    </div>
    <p class="close-date">${market.cierre}</p>
    <div class="card-actions">
      <a class="primary-button" href="${getMarketUrl(market)}">Ver mercado</a>
    </div>
  `;

  return card;
}

function getUserProfileUrl(user) {
  return `profile.html?user=${encodeURIComponent(user.username)}`;
}

function createLeaderboardRow(user, index) {
  const link = document.createElement("a");
  link.className = "leaderboard-row";
  link.href = getUserProfileUrl(user);
  link.setAttribute("aria-label", `Ver perfil de ${user.username}`);
  link.innerHTML = `
    <span class="rank-position">${index + 1}</span>
    <span>
      <span class="rank-user">${user.username}</span>
      <span class="rank-meta">${formatNumber(user.prestigio)} Prestigio · ${user.rango}</span>
      <span class="rank-category">Mejor categoría: ${user.mejorCategoria}</span>
    </span>
  `;

  return link;
}

function renderLeaderboard() {
  leaderboardPanelNode.innerHTML = "";

  if (seasonRankingUsers.length === 0) {
    leaderboardPanelNode.innerHTML = `
      <div class="leaderboard-empty">
        <div class="leaderboard-placeholder" aria-hidden="true">
          <span class="placeholder-line"></span>
          <span class="placeholder-line"></span>
          <span class="placeholder-line"></span>
        </div>
        <strong>Aún no hay predictores clasificados</strong>
        <p>El ranking se activará cuando se resuelvan los primeros mercados.</p>
      </div>
    `;
    return;
  }

  const list = document.createElement("div");
  list.className = "leaderboard-list";
  seasonRankingUsers.forEach((user, index) => {
    list.appendChild(createLeaderboardRow(user, index));
  });
  leaderboardPanelNode.appendChild(list);
}

function renderFilterButtons() {
  categoryFilterNode.innerHTML = "";
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.type = "button";
    button.textContent = category;
    button.setAttribute("aria-pressed", String(activeFilters.category === category));
    button.addEventListener("click", () => {
      activeFilters.category = category;
      render();
    });
    categoryFilterNode.appendChild(button);
  });

  stateFilterNode.innerHTML = "";
  stateFilters.forEach((filter) => {
    const button = document.createElement("button");
    button.className = "chip";
    button.type = "button";
    button.textContent = filter.label;
    button.setAttribute("aria-pressed", String(activeFilters.state === filter.id));
    button.addEventListener("click", () => {
      activeFilters.state = filter.id;
      render();
    });
    stateFilterNode.appendChild(button);
  });
}

function renderFeaturedMarket() {
  const market = markets.find((item) => item.destacado);
  if (!market) {
    featuredMarketNode.hidden = true;
    return;
  }

  featuredMarketNode.hidden = false;
  featuredMarketNode.innerHTML = `
    <div class="featured-card">
      <div>
        <div class="featured-meta">
          <span class="tag">Mercado destacado</span>
          <span class="tag">${market.categoria}</span>
          <span class="status ${getStatusClass(market.estado)}">${market.estado}</span>
        </div>
        <h2 class="featured-question">${market.pregunta}</h2>
        <p class="featured-copy">Un mercado de alta actividad para medir criterio, anticipación y lectura del calendario de la industria.</p>
      </div>
      <div>
        ${createTrendMarkup(market)}
        <div class="stats">
          <div class="stat"><span>Karma total</span><strong>${formatNumber(market.karmaTotal)}</strong></div>
          <div class="stat"><span>Participantes</span><strong>${formatNumber(market.participantes)}</strong></div>
          <div class="stat"><span>Comentarios</span><strong>${formatNumber(market.comentarios)}</strong></div>
        </div>
        <p class="close-date">${market.cierre}</p>
        <a class="primary-button" href="${getMarketUrl(market)}">Ver mercado</a>
      </div>
    </div>
  `;
}

function renderMarkets() {
  const filteredMarkets = getFilteredMarkets();
  marketListNode.innerHTML = "";

  filteredMarkets.forEach((market) => {
    marketListNode.appendChild(createMarketCard(market));
  });

  const count = filteredMarkets.length;
  resultCountNode.textContent = `${count} ${count === 1 ? "mercado" : "mercados"}`;
  emptyStateNode.hidden = count !== 0;
}

function renderLoadingState() {
  renderFilterButtons();
  renderLeaderboard();
  featuredMarketNode.hidden = true;
  resultCountNode.textContent = "";
  emptyStateNode.hidden = true;
  marketListNode.innerHTML = '<p class="loading-state">Cargando mercados...</p>';
}

function render() {
  renderFilterButtons();
  renderFeaturedMarket();
  renderMarkets();
  renderLeaderboard();
}

clearButton.addEventListener("click", () => {
  activeFilters.category = "Todos";
  activeFilters.state = "activos";
  activeFilters.query = "";
  searchInput.value = "";
  render();
  searchInput.focus();
});

searchInput.addEventListener("input", (event) => {
  activeFilters.query = event.target.value;
  render();
});

async function initializeMarkets() {
  renderLoadingState();

  try {
    markets = await loadMarketsFromSupabase();
    setDataSourceWarning("");
  } catch (error) {
    markets = getFallbackMarkets();
    setDataSourceWarning("No se han podido cargar los mercados desde Supabase. Mostrando datos demo.");
  }

  render();
}

initializeMarkets();
