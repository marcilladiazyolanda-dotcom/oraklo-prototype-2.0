const communityRoot = document.querySelector("#community-root");
const communityFollowingRoot = document.querySelector("#community-following-root");
const communitySocial = window.orakloSocial;

const COMMUNITY_PAGE_SIZE = 12;
const COMMUNITY_FOLLOWING_PAGE_SIZE = 8;

const communityState = {
  mode: "community",
  rows: [],
  cursor: null,
  hasMore: false,
  loading: true,
  loadingMore: false,
  error: "",
  followingRows: [],
  followingCursor: null,
  hasMoreFollowing: false,
  loadingFollowing: false,
  followingError: "",
  currentUserId: null
};

function getCommunityResult(event) {
  const result = String(event.prediction_result || "").trim().toLowerCase();
  if (result === "anulado" || event.prediction_is_correct == null) {
    return { key: "annulled", label: "Anulada" };
  }
  if (event.prediction_is_correct === true) return { key: "hit", label: "Acierto" };
  return { key: "miss", label: "Fallo" };
}

function createCommunityCommentBody(event) {
  const body = communitySocial.escapeHtml(event.comment_body || "");
  if (!event.comment_is_spoiler) return `<p class="community-card-body">${body}</p>`;

  return `
    <div class="community-spoiler">
      <button type="button" data-community-spoiler="${event.event_id}" aria-expanded="false">
        Posible spoiler · Mostrar comentario
      </button>
      <p class="community-card-body" data-community-spoiler-content="${event.event_id}" hidden>${body}</p>
    </div>
  `;
}

function createCommunityPredictionBody(event) {
  const result = getCommunityResult(event);
  const prestige = Number(event.prediction_prestige_change) || 0;
  const prestigeLabel = prestige > 0 ? `+${communitySocial.formatNumber(prestige)}` : communitySocial.formatNumber(prestige);

  return `
    <div class="community-prediction-result community-result-${result.key}">
      <div>
        <span>Predijo</span>
        <strong>${communitySocial.escapeHtml(event.prediction_option || "—")}</strong>
      </div>
      <div>
        <span>Resultado oficial</span>
        <strong>${communitySocial.escapeHtml(event.prediction_result || "Anulado")}</strong>
      </div>
      <div>
        <span>Veredicto</span>
        <strong>${result.label}</strong>
      </div>
      <div>
        <span>Prestigio</span>
        <strong>${prestigeLabel}</strong>
      </div>
    </div>
  `;
}

function createCommunityCardActions(event) {
  const auth = window.orakloAuth?.getState?.();
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const isOwn = Boolean(auth?.user?.id && auth.user.id === event.author_id);
  const canReact = !isOwn && (event.viewer_can_react || !isAuthenticated);

  return `
    <div class="community-card-actions">
      <button class="social-action-button${event.viewer_reacted ? " is-active" : ""}" type="button"
        data-community-reaction-type="${event.event_type}"
        data-community-reaction-id="${event.event_id}"
        aria-pressed="${Boolean(event.viewer_reacted)}"
        ${canReact ? "" : "disabled"}
        title="${isOwn ? "No puedes reaccionar a tu propio contenido" : "Buena lectura"}">
        <span aria-hidden="true">✦</span>
        <span>${event.viewer_reacted ? "Retirar" : "Buena lectura"}</span>
        <strong>${communitySocial.formatNumber(event.reaction_count)}</strong>
      </button>
      <a class="social-text-button" href="market-detail.html?id=${encodeURIComponent(event.market_id)}${event.event_type === "comment" ? "#market-comments-section" : ""}">
        ${event.event_type === "comment" ? "Abrir debate" : "Ver resolución"}
      </a>
      ${event.event_type === "comment" && !isOwn ? `
        <button class="social-text-button" type="button" data-community-report="${event.event_id}"${event.viewer_has_open_report ? " disabled" : ""}>
          ${event.viewer_has_open_report ? "Reportado" : "Reportar"}
        </button>
      ` : ""}
    </div>
  `;
}

function createCommunityCard(event) {
  const profileUrl = `profile.html?id=${encodeURIComponent(event.author_id)}`;
  const typeLabel = event.event_type === "comment"
    ? event.comment_is_reply ? "respondió en un debate" : "comentó en un mercado"
    : "cerró una predicción";
  const exactDate = communitySocial.formatDate(event.event_at);

  return `
    <article class="community-card community-card-${event.event_type}" data-community-event="${event.event_key}">
      <header class="community-card-header">
        <a class="community-author" href="${profileUrl}">
          ${communitySocial.createAvatarMarkup(event, "community-avatar")}
          <span>
            <strong>${communitySocial.escapeHtml(event.username)}</strong>
            <small>${communitySocial.escapeHtml(event.rank || "Observador")} · ${typeLabel}</small>
          </span>
        </a>
        <time datetime="${communitySocial.escapeHtml(event.event_at)}" title="${communitySocial.escapeHtml(exactDate)}">
          ${communitySocial.escapeHtml(communitySocial.formatRelativeDate(event.event_at))}
        </time>
      </header>
      <div class="community-market-context">
        <span class="tag">${communitySocial.escapeHtml(event.market_category || "Mercado")}</span>
        <a href="market-detail.html?id=${encodeURIComponent(event.market_id)}">${communitySocial.escapeHtml(event.market_question)}</a>
      </div>
      ${event.event_type === "comment"
        ? createCommunityCommentBody(event)
        : createCommunityPredictionBody(event)}
      ${createCommunityCardActions(event)}
    </article>
  `;
}

function renderCommunityFeed() {
  if (!communityRoot) return;
  const auth = window.orakloAuth?.getState?.();
  const feedNote = document.querySelector("#community-feed-note");
  if (feedNote) {
    feedNote.textContent = communityState.mode === "following"
      ? "Solo actividad pública de las cuentas que sigues, de más reciente a más antiguo."
      : "Comentarios y predicciones liquidadas, de más reciente a más antiguo.";
  }

  document.querySelectorAll("[data-community-mode]").forEach((button) => {
    const selected = button.dataset.communityMode === communityState.mode;
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  if (communityState.loading) {
    communityRoot.innerHTML = '<div class="social-loading-card"><strong>Cargando comunidad...</strong><p>Consultando actividad pública real en Supabase.</p></div>';
    return;
  }

  if (communityState.error) {
    communityRoot.innerHTML = `
      <div class="social-empty-card social-error-card">
        <strong>No se ha podido cargar el feed</strong>
        <p>${communitySocial.escapeHtml(communityState.error)}</p>
        <button class="secondary-button" type="button" data-community-retry>Reintentar</button>
      </div>
    `;
    return;
  }

  if (!communityState.rows.length) {
    const followingEmpty = communityState.mode === "following";
    communityRoot.innerHTML = `
      <div class="social-empty-card">
        <strong>${followingEmpty ? "Tu feed de Siguiendo está vacío" : "La comunidad aún no tiene actividad pública"}</strong>
        <p>${followingEmpty
          ? "Sigue perfiles desde la clasificación o desde sus currículums predictivos para construir este feed."
          : "Aquí aparecerán comentarios reales y predicciones después de que sus mercados se liquiden."}</p>
        ${followingEmpty ? '<a class="primary-button" href="ranking.html">Descubrir predictores</a>' : ""}
      </div>
    `;
    return;
  }

  communityRoot.innerHTML = `
    <div class="community-card-list">
      ${communityState.rows.map(createCommunityCard).join("")}
    </div>
    ${communityState.hasMore ? `
      <button class="secondary-button social-load-more" type="button" data-community-load-more${communityState.loadingMore ? " disabled" : ""}>
        ${communityState.loadingMore ? "Cargando..." : "Ver actividad anterior"}
      </button>
    ` : ""}
  `;

  if (communityState.mode === "following" && !auth?.isAuthenticated) {
    communityRoot.innerHTML = '<div class="social-empty-card"><strong>Inicia sesión para abrir tu feed</strong><button class="primary-button" type="button" data-auth-open>Iniciar sesión</button></div>';
  }
}

function createFollowingRow(profile) {
  return `
    <article class="community-following-row">
      <a href="profile.html?id=${encodeURIComponent(profile.profile_id)}">
        ${communitySocial.createAvatarMarkup(profile, "community-following-avatar")}
        <span>
          <strong>${communitySocial.escapeHtml(profile.username)}</strong>
          <small>${communitySocial.escapeHtml(profile.rank || "Observador")} · ${communitySocial.formatNumber(profile.follower_count)} seguidores</small>
        </span>
      </a>
      <button type="button" data-community-unfollow="${profile.profile_id}" aria-label="Dejar de seguir a ${communitySocial.escapeHtml(profile.username)}">×</button>
    </article>
  `;
}

function renderCommunityFollowing() {
  if (!communityFollowingRoot) return;
  const auth = window.orakloAuth?.getState?.();

  if (!auth?.isAuthenticated) {
    communityFollowingRoot.innerHTML = `
      <div class="community-following-guest">
        <p>Inicia sesión para consultar tu lista privada.</p>
        <button class="secondary-button" type="button" data-auth-open>Iniciar sesión</button>
      </div>
    `;
    return;
  }

  if (communityState.loadingFollowing) {
    communityFollowingRoot.innerHTML = '<p class="community-sidebar-state">Cargando tu red...</p>';
    return;
  }

  if (communityState.followingError) {
    communityFollowingRoot.innerHTML = `<p class="social-status social-status-error">${communitySocial.escapeHtml(communityState.followingError)}</p>`;
    return;
  }

  if (!communityState.followingRows.length) {
    communityFollowingRoot.innerHTML = `
      <div class="community-following-guest">
        <p>Todavía no sigues ninguna cuenta.</p>
        <a class="secondary-button" href="ranking.html">Ver clasificación</a>
      </div>
    `;
    return;
  }

  communityFollowingRoot.innerHTML = `
    <div class="community-following-list">${communityState.followingRows.map(createFollowingRow).join("")}</div>
    ${communityState.hasMoreFollowing ? '<button class="social-text-button community-following-more" type="button" data-following-load-more>Ver más cuentas</button>' : ""}
  `;
}

async function fetchCommunityPage(cursor = null) {
  const rows = await communitySocial.rpc("get_public_community_feed", {
    feed_mode_input: communityState.mode,
    before_event_at_input: cursor?.eventAt || null,
    before_event_key_input: cursor?.eventKey || null,
    limit_count: COMMUNITY_PAGE_SIZE + 1
  });
  const visibleRows = (rows || []).slice(0, COMMUNITY_PAGE_SIZE);
  const last = visibleRows[visibleRows.length - 1] || null;
  return {
    rows: visibleRows,
    hasMore: (rows || []).length > COMMUNITY_PAGE_SIZE,
    cursor: last ? { eventAt: last.event_at, eventKey: last.event_key } : cursor
  };
}

async function loadCommunityFeed({ append = false } = {}) {
  if (append) communityState.loadingMore = true;
  else {
    communityState.loading = true;
    communityState.error = "";
    communityState.cursor = null;
    communityState.hasMore = false;
  }
  renderCommunityFeed();

  try {
    const page = await fetchCommunityPage(append ? communityState.cursor : null);
    communityState.rows = append ? [...communityState.rows, ...page.rows] : page.rows;
    communityState.cursor = page.cursor;
    communityState.hasMore = page.hasMore;
  } catch (error) {
    communityState.error = communitySocial.getErrorMessage(error, "No se ha podido consultar la actividad real de Oraklo.");
    if (!append) communityState.rows = [];
  } finally {
    communityState.loading = false;
    communityState.loadingMore = false;
    renderCommunityFeed();
  }
}

async function fetchFollowingPage(cursor = null) {
  const rows = await communitySocial.rpc("get_my_following", {
    before_created_at_input: cursor?.createdAt || null,
    before_profile_id_input: cursor?.profileId || null,
    limit_count: COMMUNITY_FOLLOWING_PAGE_SIZE + 1
  });
  const visibleRows = (rows || []).slice(0, COMMUNITY_FOLLOWING_PAGE_SIZE);
  const last = visibleRows[visibleRows.length - 1] || null;
  return {
    rows: visibleRows,
    hasMore: (rows || []).length > COMMUNITY_FOLLOWING_PAGE_SIZE,
    cursor: last ? { createdAt: last.followed_at, profileId: last.profile_id } : cursor
  };
}

async function loadCommunityFollowing({ append = false } = {}) {
  const auth = window.orakloAuth?.getState?.();
  if (!auth?.isAuthenticated) {
    communityState.followingRows = [];
    communityState.followingCursor = null;
    communityState.hasMoreFollowing = false;
    renderCommunityFollowing();
    return;
  }

  communityState.loadingFollowing = true;
  communityState.followingError = "";
  renderCommunityFollowing();
  try {
    const page = await fetchFollowingPage(append ? communityState.followingCursor : null);
    communityState.followingRows = append ? [...communityState.followingRows, ...page.rows] : page.rows;
    communityState.followingCursor = page.cursor;
    communityState.hasMoreFollowing = page.hasMore;
  } catch (error) {
    communityState.followingError = communitySocial.getErrorMessage(error, "No se ha podido cargar tu lista privada.");
  } finally {
    communityState.loadingFollowing = false;
    renderCommunityFollowing();
  }
}

async function setCommunityMode(mode) {
  if (mode === communityState.mode) return;
  if (mode === "following") {
    const auth = await communitySocial.requireAuth("Inicia sesión para ver la actividad de las cuentas que sigues.");
    if (!auth) return;
  }
  communityState.mode = mode === "following" ? "following" : "community";
  await loadCommunityFeed();
}

async function toggleCommunityReaction(button) {
  const eventId = button.dataset.communityReactionId;
  const eventType = button.dataset.communityReactionType;
  const nextActive = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true;

  try {
    const result = await communitySocial.setReaction(eventType, eventId, nextActive);
    if (!result) return;
    const row = communityState.rows.find((item) => item.event_type === eventType && item.event_id === eventId);
    if (row) {
      row.viewer_reacted = Boolean(result.active);
      row.reaction_count = Number(result.reaction_count) || 0;
    }
    renderCommunityFeed();
  } catch (error) {
    communityState.error = communitySocial.getErrorMessage(error);
    renderCommunityFeed();
  }
}

async function unfollowCommunityProfile(button) {
  const profileId = button.dataset.communityUnfollow;
  button.disabled = true;
  try {
    await communitySocial.rpc("set_profile_following", {
      profile_id_input: profileId,
      following_input: false
    });
    communityState.followingRows = communityState.followingRows.filter((profile) => profile.profile_id !== profileId);
    renderCommunityFollowing();
    if (communityState.mode === "following") loadCommunityFeed();
  } catch (error) {
    communityState.followingError = communitySocial.getErrorMessage(error);
    renderCommunityFollowing();
  }
}

function handleCommunityClick(event) {
  const modeButton = event.target.closest("[data-community-mode]");
  const spoiler = event.target.closest("[data-community-spoiler]");
  const reaction = event.target.closest("[data-community-reaction-id]");
  const report = event.target.closest("[data-community-report]");
  const loadMore = event.target.closest("[data-community-load-more]");
  const retry = event.target.closest("[data-community-retry]");
  const followingMore = event.target.closest("[data-following-load-more]");
  const unfollow = event.target.closest("[data-community-unfollow]");

  if (modeButton) setCommunityMode(modeButton.dataset.communityMode);
  if (spoiler) {
    const content = communityRoot.querySelector(`[data-community-spoiler-content='${spoiler.dataset.communitySpoiler}']`);
    const expanded = spoiler.getAttribute("aria-expanded") === "true";
    spoiler.setAttribute("aria-expanded", String(!expanded));
    spoiler.textContent = expanded ? "Posible spoiler · Mostrar comentario" : "Ocultar spoiler";
    if (content) content.hidden = expanded;
  }
  if (reaction) toggleCommunityReaction(reaction);
  if (report) {
    const row = communityState.rows.find((item) => item.event_type === "comment" && item.event_id === report.dataset.communityReport);
    communitySocial.openReport({
      targetType: "comment",
      targetId: report.dataset.communityReport,
      targetLabel: row?.comment_body?.slice(0, 120) || "Comentario de comunidad",
      trigger: report
    });
  }
  if (loadMore) loadCommunityFeed({ append: true });
  if (retry) loadCommunityFeed();
  if (followingMore) loadCommunityFollowing({ append: true });
  if (unfollow) unfollowCommunityProfile(unfollow);
}

function handleCommunityKeydown(event) {
  if (!event.target.matches("[data-community-mode]") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = Array.from(document.querySelectorAll("[data-community-mode]"));
  const currentIndex = tabs.indexOf(event.target);
  if (currentIndex < 0) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  nextTab.focus();
  setCommunityMode(nextTab.dataset.communityMode);
}

async function initializeCommunity() {
  if (!communityRoot || !communityFollowingRoot || !communitySocial) return;
  await window.orakloAuth?.ready;
  communityState.currentUserId = window.orakloAuth?.getState?.().user?.id || null;

  document.addEventListener("click", handleCommunityClick);
  document.addEventListener("keydown", handleCommunityKeydown);
  window.addEventListener("oraklo:social-report-created", (event) => {
    if (event.detail?.targetType !== "comment") return;
    const row = communityState.rows.find((item) => item.event_type === "comment" && item.event_id === event.detail.targetId);
    if (row) row.viewer_has_open_report = true;
    renderCommunityFeed();
  });

  window.orakloAuth?.onChange?.((auth) => {
    if (!auth.ready) return;
    const nextUserId = auth.user?.id || null;
    if (nextUserId === communityState.currentUserId) return;
    communityState.currentUserId = nextUserId;
    if (!auth.isAuthenticated && communityState.mode === "following") communityState.mode = "community";
    loadCommunityFeed();
    loadCommunityFollowing();
  });

  await Promise.all([loadCommunityFeed(), loadCommunityFollowing()]);
}

initializeCommunity();
