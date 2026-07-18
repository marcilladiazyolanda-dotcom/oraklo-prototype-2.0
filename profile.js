const profileClient = window.orakloSupabase;
const profileRoot = document.querySelector("#profile-root");

const PROFILE_HISTORY_PAGE_SIZE = 12;

const PROFILE_CATEGORIES = [
  "Lanzamientos",
  "Reviews/Premios",
  "Eventos",
  "Streamers",
  "YouTubers",
  "Industria"
];

const PROFILE_AVATARS = [
  { key: "oracle", mark: "◇", label: "Oráculo" },
  { key: "spark", mark: "✦", label: "Destello" },
  { key: "hex", mark: "⬡", label: "Nexo" },
  { key: "pulse", mark: "◉", label: "Pulso" },
  { key: "delta", mark: "△", label: "Vértice" }
];

const PROFILE_THEMES = [
  { key: "aurora", label: "Aurora" },
  { key: "violet", label: "Violeta" },
  { key: "solar", label: "Solar" },
  { key: "ocean", label: "Océano" },
  { key: "emerald", label: "Esmeralda" }
];

const predictorProfileState = {
  targetId: null,
  profile: null,
  specialties: [],
  history: [],
  historyCursor: null,
  hasMoreHistory: false,
  loadingMore: false,
  historyLoadError: "",
  optionalDataWarning: "",
  customizationAvailable: true,
  socialAvailable: false,
  social: null,
  socialBusy: "",
  socialStatusMessage: "",
  socialStatusTone: "info",
  activeTab: "summary",
  profileSavedMessage: ""
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

function getProfileAvatar(profile) {
  return PROFILE_AVATARS.find((avatar) => avatar.key === profile?.avatar_key)
    || PROFILE_AVATARS[0];
}

function getProfileTheme(profile) {
  return PROFILE_THEMES.some((theme) => theme.key === profile?.profile_theme)
    ? profile.profile_theme
    : "aurora";
}

function getRequestedProfileTab() {
  const tab = window.location.hash.replace(/^#/, "");
  return ["summary", "history", "badges"].includes(tab) ? tab : "summary";
}

function shouldOpenProfileEditor() {
  return new URLSearchParams(window.location.search).get("edit") === "1";
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
    { label: "Posición global", value: profile.global_position ? `#${formatProfileNumber(profile.global_position)}` : "—", tone: "blue" },
    { label: "Precisión", value: formatProfilePercent(profile.accuracy), tone: "green" },
    { label: "Aciertos", value: formatProfileNumber(profile.correct_predictions), tone: "violet" },
    { label: "Mejor racha", value: `${formatProfileNumber(profile.best_streak)}×`, tone: "gold" }
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

function isViewingOwnProfile(profile = predictorProfileState.profile) {
  const authState = window.orakloAuth?.getState?.();
  return Boolean(
    profile?.is_own_profile
    || (authState?.user?.id && authState.user.id === profile?.id)
  );
}

function createProfileSocialMarkup(profile, isOwnProfile) {
  if (!predictorProfileState.socialAvailable || !predictorProfileState.social) {
    return `
      <div class="profile-social-unavailable">
        <span>Comunidad</span>
        <small>Los datos sociales estarán disponibles al activar el Paso 11 en Supabase.</small>
      </div>
    `;
  }

  const social = predictorProfileState.social;
  const followBusy = predictorProfileState.socialBusy === "follow";
  const muteBusy = predictorProfileState.socialBusy === "mute";
  const followDisabled = followBusy || (social.viewer_has_muted && !social.viewer_is_following);

  return `
    <dl class="profile-social-counts" aria-label="Comunidad del perfil">
      <div><dt>Seguidores</dt><dd>${formatProfileNumber(social.follower_count)}</dd></div>
      <div><dt>Siguiendo</dt><dd>${formatProfileNumber(social.following_count)}</dd></div>
    </dl>
    ${isOwnProfile ? `
      <a class="secondary-button profile-community-link" href="community.html">Abrir mi comunidad</a>
    ` : `
      <div class="profile-social-actions">
        <button class="${social.viewer_is_following ? "secondary-button" : "primary-button"}" id="profile-follow-button" type="button"
          aria-pressed="${Boolean(social.viewer_is_following)}"${followDisabled ? " disabled" : ""}
          title="${social.viewer_has_muted ? "Deja de silenciar este perfil para poder seguirlo" : ""}">
          ${followBusy ? "Actualizando..." : social.viewer_is_following ? "Siguiendo" : "Seguir"}
        </button>
        <button class="secondary-button" id="profile-mute-button" type="button" aria-pressed="${Boolean(social.viewer_has_muted)}"${muteBusy ? " disabled" : ""}>
          ${muteBusy ? "Actualizando..." : social.viewer_has_muted ? "Dejar de silenciar" : "Silenciar"}
        </button>
        <button class="profile-report-button" id="profile-report-button" type="button"${social.viewer_has_open_report ? " disabled" : ""}>
          ${social.viewer_has_open_report ? "Perfil reportado" : "Reportar perfil"}
        </button>
      </div>
    `}
    ${predictorProfileState.socialStatusMessage ? `
      <p class="social-status social-status-${escapeProfileHtml(predictorProfileState.socialStatusTone)}">${escapeProfileHtml(predictorProfileState.socialStatusMessage)}</p>
    ` : ""}
  `;
}

async function refreshProfileSocialData({ render = true } = {}) {
  if (!profileClient || !predictorProfileState.targetId || !window.orakloSocial) return;

  try {
    const data = await window.orakloSocial.rpc("get_public_social_profile", {
      profile_id_input: predictorProfileState.targetId
    });
    predictorProfileState.social = window.orakloSocial.normalizeRow(data);
    predictorProfileState.socialAvailable = Boolean(predictorProfileState.social);
  } catch (_error) {
    predictorProfileState.social = null;
    predictorProfileState.socialAvailable = false;
  }

  if (render && predictorProfileState.profile) renderPredictorProfile();
}

async function toggleProfileFollowing() {
  const auth = await window.orakloSocial?.requireAuth("Inicia sesión para seguir este perfil.");
  if (!auth || !predictorProfileState.social || predictorProfileState.socialBusy) return;

  predictorProfileState.socialBusy = "follow";
  predictorProfileState.socialStatusMessage = "";
  renderPredictorProfile();
  try {
    const result = window.orakloSocial.normalizeRow(await window.orakloSocial.rpc("set_profile_following", {
      profile_id_input: predictorProfileState.targetId,
      following_input: !predictorProfileState.social.viewer_is_following
    }));
    predictorProfileState.social.viewer_is_following = Boolean(result?.is_following);
    predictorProfileState.social.follower_count = Number(result?.follower_count) || 0;
    predictorProfileState.socialStatusMessage = result?.is_following
      ? "Ahora sigues este perfil. Su actividad pública aparecerá en tu feed."
      : "Has dejado de seguir este perfil.";
    predictorProfileState.socialStatusTone = "success";
  } catch (error) {
    predictorProfileState.socialStatusMessage = window.orakloSocial.getErrorMessage(error);
    predictorProfileState.socialStatusTone = "error";
  } finally {
    predictorProfileState.socialBusy = "";
    renderPredictorProfile();
  }
}

async function toggleProfileMuted() {
  const auth = await window.orakloSocial?.requireAuth("Inicia sesión para silenciar este perfil.");
  if (!auth || !predictorProfileState.social || predictorProfileState.socialBusy) return;
  const nextMuted = !predictorProfileState.social.viewer_has_muted;

  if (nextMuted && !window.confirm("¿Silenciar este perfil? Sus comentarios y actividad dejarán de aparecer para ti, y también dejarás de seguirlo.")) {
    return;
  }

  predictorProfileState.socialBusy = "mute";
  predictorProfileState.socialStatusMessage = "";
  renderPredictorProfile();
  try {
    const result = window.orakloSocial.normalizeRow(await window.orakloSocial.rpc("set_profile_muted", {
      profile_id_input: predictorProfileState.targetId,
      muted_input: nextMuted
    }));
    predictorProfileState.social.viewer_has_muted = Boolean(result?.is_muted);
    if (result?.is_muted) predictorProfileState.social.viewer_is_following = false;
    predictorProfileState.socialStatusMessage = result?.is_muted
      ? "Perfil silenciado. Su actividad ya no aparecerá para ti."
      : "Has dejado de silenciar este perfil.";
    predictorProfileState.socialStatusTone = "success";
  } catch (error) {
    predictorProfileState.socialStatusMessage = window.orakloSocial.getErrorMessage(error);
    predictorProfileState.socialStatusTone = "error";
  } finally {
    predictorProfileState.socialBusy = "";
    await refreshProfileSocialData({ render: false });
    renderPredictorProfile();
  }
}

function reportPredictorProfile() {
  window.orakloSocial?.openReport({
    targetType: "profile",
    targetId: predictorProfileState.targetId,
    targetLabel: predictorProfileState.profile?.username || "Perfil de Oraklo",
    trigger: document.querySelector("#profile-report-button")
  });
}

function createProfileEditorMarkup(profile) {
  const avatarKey = getProfileAvatar(profile).key;
  const themeKey = getProfileTheme(profile);

  return `
    <div class="modal-backdrop profile-editor-backdrop" id="profile-editor" hidden>
      <section class="modal profile-editor" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title" aria-describedby="profile-editor-note">
        <button class="modal-close" id="profile-editor-close" type="button" aria-label="Cerrar personalización">×</button>
        <p class="eyebrow">Tu identidad en Oraklo</p>
        <h2 id="profile-editor-title">Personalizar perfil</h2>
        <p id="profile-editor-note">Estos datos serán públicos. Tu email, Karma disponible y predicciones activas nunca se mostrarán.</p>

        <form class="profile-editor-form" id="profile-editor-form">
          <div class="profile-editor-grid">
            <label>
              <span>Username</span>
              <input id="profile-editor-username" type="text" value="${escapeProfileHtml(profile.username || "")}" maxlength="25" autocomplete="username" required>
              <small>Entre 3 y 24 caracteres después de @. Letras, números, punto o guion bajo.</small>
            </label>

            <label>
              <span>Categoría favorita</span>
              <select id="profile-editor-category">
                <option value="">Sin categoría favorita</option>
                ${PROFILE_CATEGORIES.map((category) => `
                  <option value="${escapeProfileHtml(category)}"${profile.favorite_category === category ? " selected" : ""}>${escapeProfileHtml(category)}</option>
                `).join("")}
              </select>
              <small>Se mostrará como parte de tu identidad predictiva.</small>
            </label>
          </div>

          <label>
            <span>Biografía</span>
            <textarea id="profile-editor-bio" maxlength="180" rows="3" placeholder="Cuenta qué señales sigues o en qué tipo de mercados destacas...">${escapeProfileHtml(profile.bio || "")}</textarea>
            <small><span id="profile-bio-count">${String(profile.bio || "").length}</span>/180 caracteres</small>
          </label>

          <fieldset class="profile-choice-fieldset">
            <legend>Avatar</legend>
            <div class="profile-avatar-options">
              ${PROFILE_AVATARS.map((avatar) => `
                <label class="profile-avatar-option">
                  <input type="radio" name="profile-avatar" value="${avatar.key}"${avatarKey === avatar.key ? " checked" : ""}>
                  <span aria-hidden="true">${avatar.mark}</span>
                  <small>${avatar.label}</small>
                </label>
              `).join("")}
            </div>
          </fieldset>

          <fieldset class="profile-choice-fieldset">
            <legend>Tema del perfil</legend>
            <div class="profile-theme-options">
              ${PROFILE_THEMES.map((theme) => `
                <label class="profile-theme-option profile-theme-swatch-${theme.key}">
                  <input type="radio" name="profile-theme" value="${theme.key}"${themeKey === theme.key ? " checked" : ""}>
                  <span aria-hidden="true"></span>
                  <small>${theme.label}</small>
                </label>
              `).join("")}
            </div>
          </fieldset>

          <p class="auth-status" id="profile-editor-status" hidden></p>
          <div class="profile-editor-actions">
            <button class="secondary-button" id="profile-editor-cancel" type="button">Cancelar</button>
            <button class="primary-button" id="profile-editor-save" type="submit">Guardar cambios</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function setProfileEditorStatus(message, tone = "info") {
  const node = document.querySelector("#profile-editor-status");
  if (!node) return;
  node.textContent = message || "";
  node.className = `auth-status auth-status-${tone}`;
  node.hidden = !message;
}

function openProfileEditor() {
  if (!isViewingOwnProfile()) return;
  const editor = document.querySelector("#profile-editor");
  if (!editor) return;
  editor.hidden = false;
  document.body.classList.add("has-open-modal");
  document.querySelector("#profile-editor-username")?.focus();
}

function closeProfileEditor() {
  const editor = document.querySelector("#profile-editor");
  if (editor) editor.hidden = true;
  document.body.classList.remove("has-open-modal");
  setProfileEditorStatus("");
}

function getProfileUpdateErrorMessage(error) {
  const details = `${error?.code || ""} ${error?.message || ""}`.toUpperCase();
  if (details.includes("USERNAME_TAKEN") || details.includes("23505")) {
    return "Ese username ya está siendo utilizado. Elige otro.";
  }
  if (details.includes("INVALID_USERNAME")) {
    return "El username debe tener entre 3 y 24 caracteres y solo puede usar letras, números, punto o guion bajo.";
  }
  if (details.includes("INVALID_BIO")) {
    return "La biografía no puede superar los 180 caracteres.";
  }
  if (details.includes("INVALID_CATEGORY")) {
    return "La categoría seleccionada no es válida.";
  }
  if (details.includes("AUTH_REQUIRED") || details.includes("28000")) {
    return "Tu sesión ha caducado. Vuelve a iniciar sesión para guardar.";
  }
  if (details.includes("PROFILE_NOT_FOUND")) {
    return "No se ha encontrado tu perfil. Cierra sesión y vuelve a entrar.";
  }
  if (details.includes("PGRST202") || details.includes("UPDATE_MY_PUBLIC_PROFILE")) {
    return "La personalización todavía no está activada en Supabase. Ejecuta el SQL incluido en esta actualización.";
  }
  return "No se han podido guardar los cambios. Inténtalo de nuevo.";
}

async function handleProfileEditorSubmit(event) {
  event.preventDefault();
  if (!profileClient || !isViewingOwnProfile()) return;

  let username = document.querySelector("#profile-editor-username")?.value.trim() || "";
  const bio = document.querySelector("#profile-editor-bio")?.value.trim() || "";
  const favoriteCategory = document.querySelector("#profile-editor-category")?.value || null;
  const avatarKey = document.querySelector("input[name='profile-avatar']:checked")?.value || "oracle";
  const profileTheme = document.querySelector("input[name='profile-theme']:checked")?.value || "aurora";
  const submitButton = document.querySelector("#profile-editor-save");

  if (username && !username.startsWith("@")) username = `@${username}`;

  if (!/^@[A-Za-z0-9._]{3,24}$/.test(username)) {
    setProfileEditorStatus("Revisa el username: admite letras, números, punto y guion bajo.", "error");
    return;
  }

  if (bio.length > 180) {
    setProfileEditorStatus("La biografía no puede superar los 180 caracteres.", "error");
    return;
  }

  submitButton.disabled = true;
  setProfileEditorStatus("Guardando tu perfil...", "info");

  try {
    const { data, error } = await profileClient.rpc("update_my_public_profile", {
      username_input: username,
      bio_input: bio,
      favorite_category_input: favoriteCategory,
      avatar_key_input: avatarKey,
      profile_theme_input: profileTheme
    });

    if (error) throw error;
    const updated = normalizeProfileRow(data) || {};

    predictorProfileState.profile = {
      ...predictorProfileState.profile,
      username: updated.username || username,
      bio: updated.bio ?? bio,
      favorite_category: updated.favorite_category ?? favoriteCategory,
      avatar_key: updated.avatar_key || avatarKey,
      profile_theme: updated.profile_theme || profileTheme
    };
    predictorProfileState.profileSavedMessage = "Perfil personalizado correctamente.";

    await window.refreshOrakloProfile?.();
    const url = new URL(window.location.href);
    url.searchParams.delete("edit");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    closeProfileEditor();
    renderPredictorProfile();
  } catch (error) {
    setProfileEditorStatus(getProfileUpdateErrorMessage(error), "error");
  } finally {
    submitButton.disabled = false;
  }
}

function setProfileTab(tab, updateUrl = true) {
  const nextTab = ["summary", "history", "badges"].includes(tab) ? tab : "summary";
  predictorProfileState.activeTab = nextTab;

  document.querySelectorAll("[data-profile-tab]").forEach((button) => {
    const selected = button.dataset.profileTab === nextTab;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  document.querySelectorAll("[data-profile-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.profilePanel !== nextTab;
  });

  if (nextTab === "history") renderPublicHistory();

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.hash = nextTab === "summary" ? "" : nextTab;
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
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
  const isOwnProfile = isViewingOwnProfile(profile);
  const decided = Number(profile.resolved_predictions) || 0;
  const annulled = Number(profile.annulled_predictions) || 0;
  const avatar = getProfileAvatar(profile);
  const theme = getProfileTheme(profile);
  const unlockedBadges = badges.filter((badge) => badge.unlocked).length;
  const profileBio = profile.bio
    ? escapeProfileHtml(profile.bio)
    : isOwnProfile
      ? "Añade una biografía para contar cómo analizas el futuro del gaming."
      : "Construyendo su trayectoria como predictor en Oraklo.";

  document.title = `${profile.username || "Perfil"} | Oraklo`;

  profileRoot.innerHTML = `
    <section class="predictor-hero predictor-theme-${theme}" aria-labelledby="predictor-name">
      <div class="predictor-identity">
        <div class="predictor-avatar" aria-hidden="true">
          <span>${escapeProfileHtml(avatar.mark)}</span>
          <small>${escapeProfileHtml(getProfileInitials(profile.username))}</small>
        </div>
        <div class="predictor-copy">
          <p class="eyebrow">Currículum predictivo ${isOwnProfile ? "· Tu perfil" : "· Perfil público"}</p>
          <h1 id="predictor-name">${escapeProfileHtml(profile.username)}</h1>
          <p class="predictor-bio">${profileBio}</p>
          <div class="predictor-meta">
            <span>Desde ${escapeProfileHtml(formatProfileDate(profile.member_since, { short: true }))}</span>
            ${profile.favorite_category ? `<span>Favorita: ${escapeProfileHtml(profile.favorite_category)}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="predictor-hero-side">
        ${isOwnProfile ? '<button class="secondary-button profile-edit-button" id="open-profile-editor" type="button">Personalizar perfil</button>' : ""}
        <div class="profile-social-panel">
          ${createProfileSocialMarkup(profile, isOwnProfile)}
        </div>
        <aside class="predictor-rank-card">
          <span>Rango de Prestigio</span>
          <div class="predictor-rank-mark" aria-hidden="true">${escapeProfileHtml(String(profile.rank || "O").slice(0, 1))}</div>
          <strong>${escapeProfileHtml(profile.rank || "Observador")}</strong>
          <small>${formatProfileNumber(profile.prestige)} de Prestigio histórico</small>
        </aside>
      </div>
    </section>

    <p class="profile-trust-note"><strong>Perfil verificado por resultados reales.</strong> El Karma disponible y las predicciones activas permanecen privados.</p>

    ${predictorProfileState.optionalDataWarning ? `
      <p class="profile-data-warning">${escapeProfileHtml(predictorProfileState.optionalDataWarning)}</p>
    ` : ""}

    ${predictorProfileState.profileSavedMessage ? `
      <p class="profile-save-success">${escapeProfileHtml(predictorProfileState.profileSavedMessage)}</p>
    ` : ""}

    <section class="profile-stat-grid" aria-label="Estadísticas principales">
      ${createProfileStatsMarkup(profile)}
    </section>

    <nav class="profile-tabs" role="tablist" aria-label="Secciones del perfil">
      <button type="button" role="tab" data-profile-tab="summary" aria-selected="true">Resumen</button>
      <button type="button" role="tab" data-profile-tab="history" aria-selected="false">Historial <span>${formatProfileNumber(decided + annulled)}</span></button>
      <button type="button" role="tab" data-profile-tab="badges" aria-selected="false">Logros <span>${formatProfileNumber(unlockedBadges)}</span></button>
    </nav>

    <section class="profile-tab-panel" data-profile-panel="summary">
      <div class="profile-layout">
        <div class="profile-main-column">
          <section class="profile-panel profile-rank-progress-card" aria-labelledby="rank-progress-title">
            <div class="profile-section-heading">
              <div>
                <p class="eyebrow">Siguiente objetivo</p>
                <h2 id="rank-progress-title">${escapeProfileHtml(profile.next_rank || "Rango máximo alcanzado")}</h2>
              </div>
              <strong>${rankProgress.percentage}%</strong>
            </div>
            <div class="ranking-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${rankProgress.percentage}">
              <span style="width: ${rankProgress.percentage}%"></span>
            </div>
            <p class="ranking-progress-copy">${escapeProfileHtml(rankProgress.label)}</p>
          </section>

          <section class="profile-panel" aria-labelledby="specialties-title">
            <div class="profile-section-heading">
              <div>
                <p class="eyebrow">Fortalezas</p>
                <h2 id="specialties-title">Especialidades</h2>
              </div>
              <span>${decided} ${decided === 1 ? "resultado válido" : "resultados válidos"}</span>
            </div>
            <div class="specialties-list">
              ${createSpecialtiesMarkup(predictorProfileState.specialties)}
            </div>
            <p class="profile-method-note">Las anulaciones no alteran la precisión ni las especialidades.</p>
          </section>
        </div>

        <aside class="profile-side-column" aria-label="Resumen complementario">
          <section class="profile-side-card profile-season-card">
            ${createSeasonMarkup(profile)}
          </section>

          <section class="profile-side-card" aria-labelledby="record-title">
            <span class="profile-side-label">Trayectoria</span>
            <h2 id="record-title">Balance de resultados</h2>
            <dl class="profile-record-list">
              <div><dt>Decididas</dt><dd>${formatProfileNumber(profile.resolved_predictions)}</dd></div>
              <div><dt>Aciertos</dt><dd class="value-positive">${formatProfileNumber(profile.correct_predictions)}</dd></div>
              <div><dt>Fallos</dt><dd class="value-negative">${formatProfileNumber(profile.missed_predictions)}</dd></div>
              <div><dt>Racha actual</dt><dd>${formatProfileNumber(profile.current_streak)}×</dd></div>
            </dl>
          </section>
        </aside>
      </div>
    </section>

    <section class="profile-tab-panel" data-profile-panel="history" hidden>
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
    </section>

    <section class="profile-tab-panel" data-profile-panel="badges" hidden>
      <section class="profile-panel profile-achievements-panel" aria-labelledby="badges-title">
        <div class="profile-section-heading">
          <div>
            <p class="eyebrow">Trayectoria reconocida</p>
            <h2 id="badges-title">Logros predictivos</h2>
          </div>
          <span>${formatProfileNumber(unlockedBadges)} de ${formatProfileNumber(badges.length)} conseguidos</span>
        </div>
        <div class="profile-badges-list profile-badges-grid">
          ${createBadgeMarkup(badges)}
        </div>
      </section>
    </section>

    ${isOwnProfile ? createProfileEditorMarkup(profile) : ""}
  `;

  document.querySelector("#load-more-profile-history")?.addEventListener("click", loadMoreProfileHistory);
  document.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => setProfileTab(button.dataset.profileTab));
  });
  document.querySelector("#open-profile-editor")?.addEventListener("click", openProfileEditor);
  document.querySelector("#profile-follow-button")?.addEventListener("click", toggleProfileFollowing);
  document.querySelector("#profile-mute-button")?.addEventListener("click", toggleProfileMuted);
  document.querySelector("#profile-report-button")?.addEventListener("click", reportPredictorProfile);
  document.querySelector("#profile-editor-close")?.addEventListener("click", closeProfileEditor);
  document.querySelector("#profile-editor-cancel")?.addEventListener("click", closeProfileEditor);
  document.querySelector("#profile-editor-form")?.addEventListener("submit", handleProfileEditorSubmit);
  document.querySelector("#profile-editor-bio")?.addEventListener("input", (event) => {
    const counter = document.querySelector("#profile-bio-count");
    if (counter) counter.textContent = event.target.value.length;
  });
  document.querySelector("#profile-editor")?.addEventListener("click", (event) => {
    if (event.target.id === "profile-editor") closeProfileEditor();
  });

  setProfileTab(predictorProfileState.activeTab, false);
  renderPublicHistory();

  if (isOwnProfile && shouldOpenProfileEditor()) {
    openProfileEditor();
  }
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
  predictorProfileState.activeTab = getRequestedProfileTab();

  const [profileResult, specialtiesResult, historyResult, customizationResult, socialResult] = await Promise.all([
    Promise.resolve(
      profileClient.rpc("get_public_predictor_profile", { profile_id_input: targetId })
    ).catch((error) => ({ data: null, error })),
    Promise.resolve(
      profileClient.rpc("get_public_predictor_specialties", { profile_id_input: targetId })
    ).catch((error) => ({ data: [], error })),
    fetchProfileHistory().catch((error) => ({ loadError: error })),
    Promise.resolve(
      profileClient.rpc("get_public_predictor_customization", { profile_id_input: targetId })
    ).catch((error) => ({ data: null, error })),
    Promise.resolve(
      profileClient.rpc("get_public_social_profile", { profile_id_input: targetId })
    ).catch((error) => ({ data: null, error }))
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

  const customization = customizationResult?.error
    ? null
    : normalizeProfileRow(customizationResult?.data);

  predictorProfileState.customizationAvailable = !customizationResult?.error;
  predictorProfileState.socialAvailable = !socialResult?.error && Boolean(normalizeProfileRow(socialResult?.data));
  predictorProfileState.social = predictorProfileState.socialAvailable
    ? normalizeProfileRow(socialResult?.data)
    : null;
  predictorProfileState.profile = {
    ...profile,
    bio: customization?.bio || "",
    favorite_category: customization?.favorite_category || null,
    avatar_key: customization?.avatar_key || "oracle",
    profile_theme: customization?.profile_theme || "aurora"
  };
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

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeProfileEditor();
});

window.addEventListener("hashchange", () => {
  if (predictorProfileState.profile) {
    setProfileTab(getRequestedProfileTab(), false);
  }
});

window.addEventListener("oraklo:social-report-created", (event) => {
  if (
    event.detail?.targetType !== "profile"
    || event.detail?.targetId !== predictorProfileState.targetId
    || !predictorProfileState.social
  ) return;

  predictorProfileState.social.viewer_has_open_report = true;
  predictorProfileState.socialStatusMessage = "Reporte enviado. Moderación lo revisará de forma privada.";
  predictorProfileState.socialStatusTone = "success";
  renderPredictorProfile();
});

window.orakloAuth?.onChange?.((auth) => {
  if (!auth.ready || !predictorProfileState.profile) return;
  predictorProfileState.socialStatusMessage = "";
  refreshProfileSocialData();
});

loadPredictorProfile().catch(() => {
  renderProfileMessage({
    eyebrow: "Error de conexión",
    title: "No se ha podido cargar el perfil",
    message: "Oraklo no ha recibido una respuesta válida. Recarga la página para volver a intentarlo."
  });
});
