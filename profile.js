const profileClient = window.orakloSupabase;
const profileRoot = document.querySelector("#profile-root");

const PROFILE_HISTORY_PAGE_SIZE = 12;

const predictorProfileState = {
  targetId: null,
  profile: null,
  specialties: [],
  history: [],
  historyCursor: null,
  hasMoreHistory: false,
  loadingMore: false,
  historyLoadError: "",
  optionalDataWarning: ""
};

function escapeProfileHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatProfileNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function formatProfilePercent(value) {
  return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(Number(value) || 0)}%`;
}

function formatProfileDate(value, options = {}) {
  if (!value) return "Fecha no disponible";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";

  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: options.short ? "short" : "long",
    year: "numeric",
    ...(options.withTime ? { hour: "2-digit", minute: "2-digit" } : {})
  }).format(date);
}

function formatSignedProfileNumber(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${formatProfileNumber(number)}`;
  return formatProfileNumber(number);
}

function normalizeProfileRow(data) {
  return Array.isArray(data) ? data[0] || null : data || null;
}

function getProfileInitials(username) {
  const clean = String(username || "Oraklo")
    .replace(/^@/, "")
    .trim();
  const parts = clean.split(/[\s._-]+/).filter(Boolean);
  const initials = parts.length > 1
    ? `${parts[0][0] || ""}${parts[1][0] || ""}`
    : clean.slice(0, 2);
  return (initials || "OR").toUpperCase();
}

function isValidProfileId(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function getProfileIdFromUrl() {
  const value = new URLSearchParams(window.location.search).get("id");
  return value?.trim() || null;
}

function getRankProgress(profile) {
  const prestige = Math.max(0, Number(profile.prestige) || 0);
  const currentMinimum = Math.max(0, Number(profile.current_rank_min) || 0);
  const nextMinimum = profile.next_rank_min == null
    ? null
    : Math.max(currentMinimum + 1, Number(profile.next_rank_min) || 0);

  if (nextMinimum == null) {
    return { percentage: 100, remaining: 0, label: "Rango máximo alcanzado" };
  }

  const span = Math.max(1, nextMinimum - currentMinimum);
  const percentage = Math.max(0, Math.min(100, Math.round(
    ((prestige - currentMinimum) * 100) / span
  )));

  return {
    percentage,
    remaining: Math.max(0, nextMinimum - prestige),
    label: `Faltan ${formatProfileNumber(nextMinimum - prestige)} de Prestigio para ${profile.next_rank}.`
  };
}

function getProfileBadges(profile) {
  const resolved = Number(profile.resolved_predictions) || 0;
  const correct = Number(profile.correct_predictions) || 0;
  const bestStreak = Number(profile.best_streak) || 0;
  const bestCategoryResolved = Number(profile.best_category_resolved) || 0;
  const bestCategoryAccuracy = Number(profile.best_category_accuracy) || 0;
  const accuracy = Number(profile.accuracy) || 0;

  return [
    {
      key: "primer-veredicto",
      mark: "01",
      name: "Primer veredicto",
      description: "Completar una primera predicción con resultado oficial.",
      unlocked: resolved >= 1,
      progress: `${Math.min(resolved, 1)}/1`
    },
    {
      key: "buen-ojo",
      mark: "05",
      name: "Buen ojo",
      description: "Alcanzar cinco predicciones acertadas.",
      unlocked: correct >= 5,
      progress: `${Math.min(correct, 5)}/5`
    },
    {
      key: "racha-tres",
      mark: "x3",
      name: "En racha",
      description: "Encadenar tres aciertos consecutivos.",
      unlocked: bestStreak >= 3,
      progress: `${Math.min(bestStreak, 3)}/3`
    },
    {
      key: "especialista",
      mark: "EX",
      name: "Especialista",
      description: "Resolver cinco mercados de una categoría con al menos un 60% de precisión.",
      unlocked: bestCategoryResolved >= 5 && bestCategoryAccuracy >= 60,
      progress: `${Math.min(bestCategoryResolved, 5)}/5`
    },
    {
      key: "trayectoria",
      mark: "25",
      name: "Trayectoria",
      description: "Completar veinticinco predicciones decididas.",
      unlocked: resolved >= 25,
      progress: `${Math.min(resolved, 25)}/25`
    },
    {
      key: "impecable",
      mark: "100",
      name: "Impecable",
      description: "Mantener un 100% de precisión tras diez resultados.",
      unlocked: resolved >= 10 && accuracy === 100,
      progress: resolved >= 10 ? formatProfilePercent(accuracy) : `${Math.min(resolved, 10)}/10`
    }
  ];
}

function getHistoryResult(historyItem) {
  const normalizedResult = String(historyItem.resolution_result || "").trim().toLowerCase();
  if (normalizedResult === "anulado" || historyItem.is_correct == null) {
    return { key: "annulled", label: "Anulada" };
  }
  if (historyItem.is_correct === true) {
    return { key: "hit", label: "Acierto" };
  }
  return { key: "miss", label: "Fallo" };
}

function createProfileStatsMarkup(profile) {
  const cards = [
    { label: "Prestigio", value: formatProfileNumber(profile.prestige), tone: "gold" },
    { label: "Posición global", value: profile.global_position ? `#${formatProfileNumber(profile.global_position)}` : "—", tone: "blue" },
    { label: "Precisión", value: formatProfilePercent(profile.accuracy), tone: "green" },
    { label: "Predicciones decididas", value: formatProfileNumber(profile.resolved_predictions), tone: "violet" },
    { label: "Racha actual", value: `${formatProfileNumber(profile.current_streak)} aciertos`, tone: "blue" },
    { label: "Mejor racha", value: `${formatProfileNumber(profile.best_streak)} aciertos`, tone: "gold" }
  ];

  return cards.map((card) => `
    <article class="profile-stat-card profile-stat-${card.tone}">
      <span>${card.label}</span>
      <strong>${card.value}</strong>
    </article>
  `).join("");
}

function createSpecialtiesMarkup(specialties) {
  if (!specialties.length) {
    return `
      <div class="profile-empty-state">
        <strong>Especialidades todavía por descubrir</strong>
        <p>Aparecerán cuando este predictor tenga mercados decididos en alguna categoría.</p>
      </div>
    `;
  }

  return specialties.map((specialty) => `
    <article class="specialty-row${specialty.is_primary ? " is-primary" : ""}">
      <div>
        <span>${specialty.is_primary ? "Especialidad principal" : `Categoría #${formatProfileNumber(specialty.position)}`}</span>
        <strong>${escapeProfileHtml(specialty.category)}</strong>
      </div>
      <div class="specialty-metrics">
        <strong>${formatProfilePercent(specialty.accuracy)}</strong>
        <span>${formatProfileNumber(specialty.correct_predictions)} de ${formatProfileNumber(specialty.resolved_predictions)} aciertos</span>
      </div>
    </article>
  `).join("");
}

function createBadgeMarkup(badges) {
  return badges.map((badge) => `
    <article class="profile-badge${badge.unlocked ? " is-unlocked" : " is-locked"}">
      <span class="profile-badge-mark" aria-hidden="true">${escapeProfileHtml(badge.mark)}</span>
      <div>
        <span>${badge.unlocked ? "Conseguida" : `Progreso ${escapeProfileHtml(badge.progress)}`}</span>
        <strong>${escapeProfileHtml(badge.name)}</strong>
        <p>${escapeProfileHtml(badge.description)}</p>
      </div>
    </article>
  `).join("");
}

function createSeasonMarkup(profile) {
  if (profile.season_state === "Activa") {
    return `
      <span class="profile-side-label">Temporada activa</span>
      <h2>${escapeProfileHtml(profile.season_name || "Temporada")}</h2>
      <strong class="profile-season-position">${profile.season_position ? `#${formatProfileNumber(profile.season_position)}` : "—"}</strong>
      <p>${formatProfileNumber(profile.season_prestige)} de Prestigio conseguido durante la temporada.</p>
    `;
  }

  return `
    <span class="profile-side-label">Temporadas</span>
    <h2>Temporada no iniciada</h2>
    <strong class="profile-season-position">—</strong>
    <p>La posición de temporada aparecerá cuando Oraklo se lance y el sistema sea activado expresamente.</p>
  `;
}

function createHistoryCardMarkup(historyItem) {
  const result = getHistoryResult(historyItem);
  const balance = (Number(historyItem.karma_awarded) || 0) - (Number(historyItem.karma_risked) || 0);
  const balanceClass = balance > 0 ? "value-positive" : balance < 0 ? "value-negative" : "value-neutral";
  const prestigeClass = Number(historyItem.prestige_change) > 0
    ? "value-positive"
    : Number(historyItem.prestige_change) < 0
      ? "value-negative"
      : "value-neutral";

  return `
    <article class="public-history-card public-history-${result.key}">
      <div class="public-history-heading">
        <div>
          <span class="tag">${escapeProfileHtml(historyItem.market_category || "Mercado")}</span>
          <span class="status status-${result.key}">${result.label}</span>
        </div>
        <time datetime="${escapeProfileHtml(historyItem.settled_at)}">${escapeProfileHtml(formatProfileDate(historyItem.settled_at, { short: true }))}</time>
      </div>
      <h3>${escapeProfileHtml(historyItem.market_question || "Mercado no disponible")}</h3>
      <div class="public-history-pick">
        <span>Predijo</span>
        <strong>${escapeProfileHtml(historyItem.option_selected || "—")}</strong>
        <small>Resultado oficial: ${escapeProfileHtml(historyItem.resolution_result || "Anulado")}</small>
      </div>
      <dl class="public-history-metrics">
        <div><dt>Karma arriesgado</dt><dd>${formatProfileNumber(historyItem.karma_risked)}</dd></div>
        <div><dt>Balance final</dt><dd class="${balanceClass}">${formatSignedProfileNumber(balance)}</dd></div>
        <div><dt>Prestigio</dt><dd class="${prestigeClass}">${formatSignedProfileNumber(historyItem.prestige_change)}</dd></div>
      </dl>
      <a class="secondary-button" href="market-detail.html?id=${encodeURIComponent(historyItem.market_id)}">Ver resolución y fuentes</a>
    </article>
  `;
}

function renderPublicHistory() {
  const historyRoot = document.querySelector("#public-profile-history");
  const loadMoreButton = document.querySelector("#load-more-profile-history");
  if (!historyRoot) return;

  if (!predictorProfileState.history.length) {
    historyRoot.innerHTML = `
      <div class="profile-empty-state profile-history-empty">
        <strong>Aún no hay historial público</strong>
        <p>Las predicciones aparecerán aquí únicamente después de que el mercado se resuelva.</p>
      </div>
    `;
  } else {
    historyRoot.innerHTML = predictorProfileState.history
      .map(createHistoryCardMarkup)
      .join("");
  }

  if (predictorProfileState.historyLoadError) {
    historyRoot.insertAdjacentHTML(
      "beforeend",
      `<p class="profile-history-warning">${escapeProfileHtml(predictorProfileState.historyLoadError)}</p>`
    );
  }

  if (loadMoreButton) {
    loadMoreButton.hidden = !predictorProfileState.hasMoreHistory;
    loadMoreButton.disabled = predictorProfileState.loadingMore;
    loadMoreButton.textContent = predictorProfileState.loadingMore
      ? "Cargando historial..."
      : "Ver más resultados";
  }
}

function renderPredictorProfile() {
  const profile = predictorProfileState.profile;
  const rankProgress = getRankProgress(profile);
  const badges = getProfileBadges(profile);
  const isOwnProfile = Boolean(profile.is_own_profile);
  const decided = Number(profile.resolved_predictions) || 0;
  const annulled = Number(profile.annulled_predictions) || 0;

  document.title = `${profile.username || "Perfil"} | Oraklo`;

  profileRoot.innerHTML = `
    <section class="predictor-hero" aria-labelledby="predictor-name">
      <div class="predictor-identity">
        <div class="predictor-avatar" aria-hidden="true">${escapeProfileHtml(getProfileInitials(profile.username))}</div>
        <div>
          <p class="eyebrow">Currículum predictivo ${isOwnProfile ? "· Tu perfil" : "· Perfil público"}</p>
          <h1 id="predictor-name">${escapeProfileHtml(profile.username)}</h1>
          <p>Miembro de Oraklo desde ${escapeProfileHtml(formatProfileDate(profile.member_since))}</p>
        </div>
      </div>
      <aside class="predictor-rank-card">
        <span>Rango de Prestigio</span>
        <div class="predictor-rank-mark" aria-hidden="true">${escapeProfileHtml(String(profile.rank || "O").slice(0, 1))}</div>
        <strong>${escapeProfileHtml(profile.rank || "Observador")}</strong>
        <small>${formatProfileNumber(profile.prestige)} de Prestigio histórico</small>
      </aside>
    </section>

    <section class="profile-privacy-strip" aria-label="Privacidad del perfil">
      <div>
        <strong>Trayectoria verificable</strong>
        <span>Las estadísticas proceden de resultados liquidados en Supabase.</span>
      </div>
      <div>
        <strong>Privacidad protegida</strong>
        <span>El Karma disponible y las predicciones activas no son públicos.</span>
      </div>
    </section>

    ${predictorProfileState.optionalDataWarning ? `
      <p class="profile-data-warning">${escapeProfileHtml(predictorProfileState.optionalDataWarning)}</p>
    ` : ""}

    <section class="profile-stat-grid" aria-label="Estadísticas principales">
      ${createProfileStatsMarkup(profile)}
    </section>

    <div class="profile-layout">
      <div class="profile-main-column">
        <section class="profile-panel" aria-labelledby="rank-progress-title">
          <div class="profile-section-heading">
            <div>
              <p class="eyebrow">Progresión permanente</p>
              <h2 id="rank-progress-title">Camino al siguiente rango</h2>
            </div>
            <strong>${escapeProfileHtml(profile.next_rank || "Rango máximo")}</strong>
          </div>
          <div class="ranking-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rankProgress.percentage}">
            <span style="width: ${rankProgress.percentage}%"></span>
          </div>
          <p class="ranking-progress-copy">${escapeProfileHtml(rankProgress.label)}</p>
        </section>

        <section class="profile-panel" aria-labelledby="specialties-title">
          <div class="profile-section-heading">
            <div>
              <p class="eyebrow">Rendimiento por temática</p>
              <h2 id="specialties-title">Especialidades</h2>
            </div>
            <span>${decided} ${decided === 1 ? "resultado válido" : "resultados válidos"}</span>
          </div>
          <div class="specialties-list">
            ${createSpecialtiesMarkup(predictorProfileState.specialties)}
          </div>
          <p class="profile-method-note">Las predicciones anuladas no cuentan para la precisión ni las especialidades.</p>
        </section>

        <section class="profile-panel public-history-panel" aria-labelledby="history-title">
          <div class="profile-section-heading">
            <div>
              <p class="eyebrow">Resultados verificables</p>
              <h2 id="history-title">Historial público resuelto</h2>
            </div>
            <span>${formatProfileNumber(decided + annulled)} liquidaciones</span>
          </div>
          <div class="public-profile-history" id="public-profile-history"></div>
          <button class="secondary-button profile-load-more" id="load-more-profile-history" type="button" hidden>Ver más resultados</button>
        </section>
      </div>

      <aside class="profile-side-column" aria-label="Resumen complementario">
        <section class="profile-side-card profile-season-card">
          ${createSeasonMarkup(profile)}
        </section>

        <section class="profile-side-card" aria-labelledby="record-title">
          <span class="profile-side-label">Balance histórico</span>
          <h2 id="record-title">Resultados</h2>
          <dl class="profile-record-list">
            <div><dt>Aciertos</dt><dd class="value-positive">${formatProfileNumber(profile.correct_predictions)}</dd></div>
            <div><dt>Fallos</dt><dd class="value-negative">${formatProfileNumber(profile.missed_predictions)}</dd></div>
            <div><dt>Anuladas</dt><dd class="value-neutral">${formatProfileNumber(profile.annulled_predictions)}</dd></div>
          </dl>
        </section>

        <section class="profile-side-card profile-badges-card" aria-labelledby="badges-title">
          <span class="profile-side-label">Insignias en beta</span>
          <h2 id="badges-title">Logros predictivos</h2>
          <div class="profile-badges-list">
            ${createBadgeMarkup(badges)}
          </div>
        </section>
      </aside>
    </div>
  `;

  document.querySelector("#load-more-profile-history")?.addEventListener("click", loadMoreProfileHistory);
  renderPublicHistory();
}

function renderProfileMessage({ eyebrow, title, message, action = "ranking" }) {
  const actionMarkup = action === "login"
    ? '<button class="primary-button" type="button" data-auth-open data-auth-message="Inicia sesión para abrir tu perfil predictivo.">Iniciar sesión</button>'
    : '<a class="primary-button" href="ranking.html">Ver clasificación</a>';

  profileRoot.innerHTML = `
    <section class="profile-message-card">
      <p class="eyebrow">${escapeProfileHtml(eyebrow)}</p>
      <h1>${escapeProfileHtml(title)}</h1>
      <p>${escapeProfileHtml(message)}</p>
      <div class="profile-message-actions">
        ${actionMarkup}
        <a class="secondary-button" href="index.html">Explorar mercados</a>
      </div>
    </section>
  `;
}

async function fetchProfileHistory(cursor = null) {
  const { data, error } = await profileClient.rpc("get_public_predictor_history", {
    profile_id_input: predictorProfileState.targetId,
    before_settled_at_input: cursor?.settledAt || null,
    before_prediction_id_input: cursor?.predictionId || null,
    limit_count: PROFILE_HISTORY_PAGE_SIZE + 1
  });

  if (error) throw error;

  const rows = data || [];
  const visibleRows = rows.slice(0, PROFILE_HISTORY_PAGE_SIZE);
  const lastVisible = visibleRows[visibleRows.length - 1] || null;

  return {
    rows: visibleRows,
    hasMore: rows.length > PROFILE_HISTORY_PAGE_SIZE,
    cursor: lastVisible
      ? {
          settledAt: lastVisible.settled_at,
          predictionId: lastVisible.prediction_id
        }
      : cursor
  };
}

async function loadMoreProfileHistory() {
  if (predictorProfileState.loadingMore || !predictorProfileState.hasMoreHistory) return;

  predictorProfileState.loadingMore = true;
  predictorProfileState.historyLoadError = "";
  renderPublicHistory();

  try {
    const nextPage = await fetchProfileHistory(predictorProfileState.historyCursor);
    predictorProfileState.history.push(...nextPage.rows);
    predictorProfileState.hasMoreHistory = nextPage.hasMore;
    predictorProfileState.historyCursor = nextPage.cursor;
  } catch (_error) {
    predictorProfileState.historyLoadError = "No se ha podido cargar la siguiente parte del historial. Puedes reintentarlo.";
  } finally {
    predictorProfileState.loadingMore = false;
    renderPublicHistory();
  }
}

async function loadPredictorProfile() {
  await window.orakloAuth.ready;
  const authState = window.orakloAuth.getState();
  const requestedId = getProfileIdFromUrl();
  const targetId = requestedId || authState.profile?.id || null;

  if (!targetId) {
    renderProfileMessage({
      eyebrow: "Currículum predictivo",
      title: "Inicia sesión o elige un predictor",
      message: "Tu perfil se abrirá desde tu username. También puedes entrar en cualquier perfil desde la clasificación.",
      action: "login"
    });
    return;
  }

  if (!isValidProfileId(targetId)) {
    renderProfileMessage({
      eyebrow: "Perfil no encontrado",
      title: "Este enlace de perfil no es válido",
      message: "Vuelve a la clasificación y selecciona un predictor disponible."
    });
    return;
  }

  if (!profileClient) {
    renderProfileMessage({
      eyebrow: "Supabase",
      title: "El perfil no está disponible ahora mismo",
      message: "No se ha podido conectar con los datos reales de Oraklo. Inténtalo de nuevo en unos minutos."
    });
    return;
  }

  predictorProfileState.targetId = targetId;
  predictorProfileState.optionalDataWarning = "";

  const [profileResult, specialtiesResult, historyResult] = await Promise.all([
    Promise.resolve(
      profileClient.rpc("get_public_predictor_profile", { profile_id_input: targetId })
    ).catch((error) => ({ data: null, error })),
    Promise.resolve(
      profileClient.rpc("get_public_predictor_specialties", { profile_id_input: targetId })
    ).catch((error) => ({ data: [], error })),
    fetchProfileHistory().catch((error) => ({ loadError: error }))
  ]);

  if (profileResult?.error) {
    renderProfileMessage({
      eyebrow: "Perfil no disponible",
      title: "No se ha podido cargar este currículum",
      message: "Comprueba que el SQL del Paso 10 esté aplicado en Supabase y vuelve a intentarlo."
    });
    return;
  }

  const profile = normalizeProfileRow(profileResult?.data);
  if (!profile) {
    renderProfileMessage({
      eyebrow: "Perfil no encontrado",
      title: "Este predictor no existe",
      message: "Puede que el perfil haya sido eliminado o que el enlace ya no sea válido."
    });
    return;
  }

  predictorProfileState.profile = profile;
  predictorProfileState.specialties = specialtiesResult?.error
    ? []
    : specialtiesResult?.data || [];

  if (!historyResult?.loadError) {
    predictorProfileState.history = historyResult.rows;
    predictorProfileState.hasMoreHistory = historyResult.hasMore;
    predictorProfileState.historyCursor = historyResult.cursor;
  } else {
    predictorProfileState.history = [];
    predictorProfileState.hasMoreHistory = false;
    predictorProfileState.optionalDataWarning = "El resumen está disponible, pero parte del historial no ha podido cargarse.";
  }

  if (specialtiesResult?.error) {
    predictorProfileState.optionalDataWarning = "El perfil está disponible, pero las especialidades no han podido cargarse.";
  }

  renderPredictorProfile();
}

loadPredictorProfile().catch(() => {
  renderProfileMessage({
    eyebrow: "Error de conexión",
    title: "No se ha podido cargar el perfil",
    message: "Oraklo no ha recibido una respuesta válida. Recarga la página para volver a intentarlo."
  });
});
