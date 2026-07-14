const rankingClient = window.orakloSupabase;

const fallbackRankLadder = [
  { position: 1, name: "Observador", min_prestige: 0, description: "Empieza a construir su historial predictivo." },
  { position: 2, name: "Intérprete", min_prestige: 100, description: "Detecta señales y empieza a leer el mercado con criterio." },
  { position: 3, name: "Analista", min_prestige: 250, description: "Mantiene resultados sólidos y fundamenta sus predicciones." },
  { position: 4, name: "Visionario", min_prestige: 500, description: "Anticipa resultados difíciles con una trayectoria destacada." },
  { position: 5, name: "Oráculo", min_prestige: 1000, description: "Representa el nivel más alto de reputación predictiva." }
];

const fallbackCompetitionStatus = {
  seasons_enabled: false,
  state: "Desactivada",
  minimum_registered_users: 100,
  registered_users: 0,
  users_remaining: 100,
  threshold_reached: false,
  season_length_months: 3,
  season_name: "Temporada 1",
  season_status: "Preparada",
  starts_at: null,
  ends_at: null
};

const rankingState = {
  mode: "global",
  globalRows: [],
  seasonRows: [],
  rankLadder: fallbackRankLadder,
  competition: fallbackCompetitionStatus,
  auth: null,
  mySummary: null,
  loading: true,
  error: ""
};

const rankingBoard = document.querySelector("#ranking-board");
const rankingBoardTitle = document.querySelector("#ranking-board-title");
const rankingBoardNote = document.querySelector("#ranking-board-note");
const competitionStatusCard = document.querySelector("#competition-status-card");
const seasonLaunchSummary = document.querySelector("#season-launch-summary");
const myRankingSummary = document.querySelector("#my-ranking-summary");
const rankLadderNode = document.querySelector("#rank-ladder");

function escapeRankingHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatRankingNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function formatRankingPercent(value) {
  const number = Number(value) || 0;
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(number)}%`;
}

function formatRankingDate(value) {
  if (!value) return "Fecha pendiente";
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Fecha pendiente";
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(timestamp);
}

function normalizeRpcRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

function mapGlobalRankingRow(row, index) {
  return {
    position: Number(row.position ?? index + 1),
    id: row.id,
    username: row.username || "@Usuario",
    prestige: Number(row.prestige) || 0,
    rank: row.rank || "Observador",
    bestCategory: row.best_category || "Pendiente",
    resolvedPredictions: Number(row.resolved_predictions) || 0,
    correctPredictions: Number(row.correct_predictions) || 0,
    accuracy: Number(row.accuracy) || 0,
    nextRank: row.next_rank || null,
    prestigeToNextRank: Number(row.prestige_to_next_rank) || 0
  };
}

function mapSeasonRankingRow(row, index) {
  return {
    position: Number(row.position ?? index + 1),
    id: row.id,
    username: row.username || "@Usuario",
    prestige: Number(row.season_prestige) || 0,
    lifetimePrestige: Number(row.lifetime_prestige) || 0,
    rank: row.rank || "Observador",
    bestCategory: row.best_category || "Pendiente",
    resolvedPredictions: Number(row.resolved_predictions) || 0,
    correctPredictions: Number(row.correct_predictions) || 0,
    accuracy: Number(row.accuracy) || 0,
    seasonName: row.season_name || "Temporada"
  };
}

async function loadGlobalRanking() {
  if (!rankingClient) throw new Error("Supabase no está disponible.");

  const currentResult = await rankingClient.rpc("get_public_global_leaderboard", {
    limit_count: 100
  });

  if (!currentResult.error) {
    return (currentResult.data || []).map(mapGlobalRankingRow);
  }

  const legacyResult = await rankingClient.rpc("get_public_leaderboard", {
    limit_count: 100
  });

  if (legacyResult.error) throw currentResult.error;
  return (legacyResult.data || []).map(mapGlobalRankingRow);
}

async function loadSeasonRanking() {
  if (!rankingClient) throw new Error("Supabase no está disponible.");
  const { data, error } = await rankingClient.rpc("get_public_season_leaderboard", {
    limit_count: 100
  });
  if (error) throw error;
  return (data || []).map(mapSeasonRankingRow);
}

async function loadRankLadder() {
  if (!rankingClient) throw new Error("Supabase no está disponible.");
  const { data, error } = await rankingClient.rpc("get_public_rank_ladder");
  if (error) throw error;
  return (data || []).map((row) => ({
    position: Number(row.position),
    name: row.name,
    min_prestige: Number(row.min_prestige) || 0,
    description: row.description || ""
  }));
}

async function loadCompetitionStatus() {
  if (!rankingClient) throw new Error("Supabase no está disponible.");
  const { data, error } = await rankingClient.rpc("get_public_competition_status");
  if (error) throw error;
  return normalizeRpcRow(data) || fallbackCompetitionStatus;
}

async function loadMyCompetitionSummary() {
  if (!rankingClient || !rankingState.auth?.isAuthenticated) return null;
  const { data, error } = await rankingClient.rpc("get_my_competition_summary");
  if (error) throw error;
  return normalizeRpcRow(data);
}

function getRankProgress(prestige) {
  const ladder = [...rankingState.rankLadder].sort(
    (a, b) => a.min_prestige - b.min_prestige
  );
  const safePrestige = Math.max(0, Number(prestige) || 0);
  let current = ladder[0] || fallbackRankLadder[0];

  ladder.forEach((rank) => {
    if (rank.min_prestige <= safePrestige) current = rank;
  });

  const next = ladder.find((rank) => rank.min_prestige > safePrestige) || null;
  if (!next) {
    return { current, next: null, percentage: 100, remaining: 0 };
  }

  const span = Math.max(1, next.min_prestige - current.min_prestige);
  const progress = safePrestige - current.min_prestige;
  return {
    current,
    next,
    percentage: Math.max(0, Math.min(100, Math.round((progress * 100) / span))),
    remaining: Math.max(0, next.min_prestige - safePrestige)
  };
}

function renderCompetitionStatus() {
  const competition = rankingState.competition || fallbackCompetitionStatus;
  const registered = Number(competition.registered_users) || 0;
  const minimum = Number(competition.minimum_registered_users) || 100;
  const progress = Math.max(0, Math.min(100, Math.round((registered * 100) / minimum)));
  const isActive = competition.state === "Activa";

  competitionStatusCard.classList.toggle("is-active", isActive);
  competitionStatusCard.innerHTML = isActive
    ? `
      <span>Temporada activa</span>
      <strong>${escapeRankingHtml(competition.season_name || "Temporada")}</strong>
      <small>${formatRankingDate(competition.starts_at)} – ${formatRankingDate(competition.ends_at)}</small>
    `
    : `
      <span>Temporadas</span>
      <strong>Preparadas, todavía inactivas</strong>
      <small>Comenzarán únicamente cuando Oraklo se lance y cumpla el umbral configurado.</small>
    `;

  seasonLaunchSummary.innerHTML = isActive
    ? `
      <p class="eyebrow">Temporada activa</p>
      <h2>${escapeRankingHtml(competition.season_name || "Temporada")}</h2>
      <p>Finaliza el ${escapeRankingHtml(formatRankingDate(competition.ends_at))}. El Prestigio histórico no se reiniciará.</p>
    `
    : `
      <p class="eyebrow">Primera temporada</p>
      <h2>${formatRankingNumber(registered)} de ${formatRankingNumber(minimum)} usuarios</h2>
      <div class="ranking-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${minimum}" aria-valuenow="${Math.min(registered, minimum)}">
        <span style="width: ${progress}%"></span>
      </div>
      <p>El sistema está bloqueado durante el desarrollo. Alcanzar el umbral no bastará: también será necesaria la activación de lanzamiento.</p>
    `;
}

function renderMySummary() {
  const auth = rankingState.auth;
  if (!auth?.isAuthenticated) {
    myRankingSummary.innerHTML = `
      <p class="eyebrow">Tu progreso</p>
      <h2>Inicia sesión para ver tu posición</h2>
      <p>Tu Prestigio, rango y progreso aparecerán aquí.</p>
      <button class="secondary-button" type="button" data-auth-open>Iniciar sesión</button>
    `;
    return;
  }

  const profile = auth.profile || {};
  const prestige = Number(profile.prestige) || 0;
  const progress = getRankProgress(prestige);
  const summary = rankingState.mySummary;
  const globalPosition = summary?.global_position
    ? `#${formatRankingNumber(summary.global_position)} global`
    : "Sin posición todavía";
  const progressText = progress.next
    ? `Faltan ${formatRankingNumber(progress.remaining)} de Prestigio para ${escapeRankingHtml(progress.next.name)}.`
    : "Has alcanzado el rango máximo de Oraklo.";

  myRankingSummary.innerHTML = `
    <p class="eyebrow">Tu progreso</p>
    <div class="my-ranking-heading">
      <div>
        <h2>${escapeRankingHtml(profile.rank || progress.current.name)}</h2>
        <p>${formatRankingNumber(prestige)} de Prestigio · ${globalPosition}</p>
      </div>
      <strong class="my-ranking-position">${summary?.global_position ? `#${formatRankingNumber(summary.global_position)}` : "—"}</strong>
    </div>
    <div class="ranking-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percentage}">
      <span style="width: ${progress.percentage}%"></span>
    </div>
    <p class="ranking-progress-copy">${progressText}</p>
  `;
}

function createRankingRow(row, mode) {
  const currentUserId = rankingState.auth?.user?.id;
  const isCurrentUser = Boolean(currentUserId && currentUserId === row.id);
  const prestigeLabel = mode === "season" ? "Prestigio de temporada" : "Prestigio";
  const podiumClass = row.position <= 3 ? ` is-podium position-${row.position}` : "";

  return `
    <article class="ranking-row${podiumClass}${isCurrentUser ? " is-current-user" : ""}" id="ranking-user-${escapeRankingHtml(row.id || row.position)}">
      <span class="ranking-position">${row.position}</span>
      <div class="ranking-identity">
        <strong>${escapeRankingHtml(row.username)}</strong>
        <span>${escapeRankingHtml(row.rank)} · ${escapeRankingHtml(row.bestCategory)}</span>
      </div>
      <div class="ranking-score">
        <strong>${formatRankingNumber(row.prestige)}</strong>
        <span>${prestigeLabel}</span>
      </div>
      <div class="ranking-stat">
        <strong>${formatRankingNumber(row.correctPredictions)}</strong>
        <span>Aciertos</span>
      </div>
      <div class="ranking-stat">
        <strong>${formatRankingPercent(row.accuracy)}</strong>
        <span>Precisión</span>
      </div>
    </article>
  `;
}

function renderRankingBoard() {
  const competition = rankingState.competition || fallbackCompetitionStatus;
  const isSeasonMode = rankingState.mode === "season";
  const seasonIsActive = competition.state === "Activa";
  const rows = isSeasonMode ? rankingState.seasonRows : rankingState.globalRows;

  document.querySelectorAll("[data-ranking-mode]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.rankingMode === rankingState.mode));
  });

  rankingBoardTitle.textContent = isSeasonMode
    ? competition.season_name || "Clasificación de temporada"
    : "Clasificación global";

  if (rankingState.loading) {
    rankingBoardNote.textContent = "Cargando datos reales...";
    rankingBoard.innerHTML = '<p class="loading-state">Preparando clasificación...</p>';
    return;
  }

  if (rankingState.error && !rows.length) {
    rankingBoardNote.textContent = "No se ha podido conectar con la clasificación.";
    rankingBoard.innerHTML = `
      <div class="leaderboard-empty">
        <strong>Clasificación no disponible</strong>
        <p>${escapeRankingHtml(rankingState.error)}</p>
      </div>
    `;
    return;
  }

  if (isSeasonMode && !seasonIsActive) {
    rankingBoardNote.textContent = "La clasificación de temporada aún no ha comenzado.";
    rankingBoard.innerHTML = `
      <div class="leaderboard-empty ranking-season-empty">
        <strong>Temporadas preparadas, pero inactivas</strong>
        <p>No habrá puntuaciones de temporada hasta el lanzamiento oficial y la activación expresa del sistema.</p>
      </div>
    `;
    return;
  }

  if (!rows.length) {
    rankingBoardNote.textContent = "Todavía no hay predictores clasificados.";
    rankingBoard.innerHTML = `
      <div class="leaderboard-empty">
        <strong>Aún no hay predictores clasificados</strong>
        <p>La clasificación aparecerá cuando se resuelvan predicciones y exista Prestigio real.</p>
      </div>
    `;
    return;
  }

  rankingBoardNote.textContent = isSeasonMode
    ? "Solo cuenta el Prestigio neto obtenido durante la temporada activa."
    : "Ordenado por Prestigio histórico, aciertos y porcentaje de precisión.";
  rankingBoard.innerHTML = `
    <div class="ranking-row ranking-row-header" aria-hidden="true">
      <span>Pos.</span>
      <span>Predictor</span>
      <span>Prestigio</span>
      <span>Aciertos</span>
      <span>Precisión</span>
    </div>
    ${rows.map((row) => createRankingRow(row, rankingState.mode)).join("")}
  `;
}

function renderRankLadder() {
  const ladder = [...rankingState.rankLadder].sort(
    (a, b) => a.min_prestige - b.min_prestige
  );
  const currentRank = rankingState.auth?.profile?.rank;

  rankLadderNode.innerHTML = ladder.map((rank, index) => {
    const nextRank = ladder[index + 1];
    const range = nextRank
      ? `${formatRankingNumber(rank.min_prestige)}–${formatRankingNumber(nextRank.min_prestige - 1)}`
      : `${formatRankingNumber(rank.min_prestige)}+`;
    return `
      <article class="rank-tier${currentRank === rank.name ? " is-current" : ""}">
        <span class="rank-tier-number">${index + 1}</span>
        <div>
          <h3>${escapeRankingHtml(rank.name)}</h3>
          <strong>${range} Prestigio</strong>
          <p>${escapeRankingHtml(rank.description)}</p>
        </div>
      </article>
    `;
  }).join("");
}

function renderRankingPage() {
  renderCompetitionStatus();
  renderMySummary();
  renderRankingBoard();
  renderRankLadder();
}

async function refreshMySummary() {
  try {
    rankingState.mySummary = await loadMyCompetitionSummary();
  } catch (_error) {
    rankingState.mySummary = null;
  }
  renderMySummary();
  renderRankLadder();
  renderRankingBoard();
}

async function initializeRanking() {
  renderRankingPage();

  const [globalResult, seasonResult, ladderResult, competitionResult] = await Promise.allSettled([
    loadGlobalRanking(),
    loadSeasonRanking(),
    loadRankLadder(),
    loadCompetitionStatus()
  ]);

  rankingState.globalRows = globalResult.status === "fulfilled" ? globalResult.value : [];
  rankingState.seasonRows = seasonResult.status === "fulfilled" ? seasonResult.value : [];
  rankingState.rankLadder = ladderResult.status === "fulfilled"
    ? ladderResult.value
    : fallbackRankLadder;
  rankingState.competition = competitionResult.status === "fulfilled"
    ? competitionResult.value
    : fallbackCompetitionStatus;
  rankingState.error = globalResult.status === "rejected"
    ? globalResult.reason?.message || "No se han podido cargar los datos."
    : "";
  rankingState.loading = false;

  renderRankingPage();
  await refreshMySummary();
}

document.querySelectorAll("[data-ranking-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    rankingState.mode = button.dataset.rankingMode === "season" ? "season" : "global";
    renderRankingBoard();
  });
});

window.orakloAuth?.onChange((authState) => {
  rankingState.auth = authState;
  refreshMySummary();
});

initializeRanking();
