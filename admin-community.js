const adminCommunityRoot = document.querySelector("#admin-community-root");
const adminCommunitySocial = window.orakloSocial;

const ADMIN_COMMUNITY_PAGE_SIZE = 20;

const ADMIN_REPORT_REASON_LABELS = {
  spam: "Spam o contenido repetitivo",
  harassment: "Acoso o ataque personal",
  hate: "Odio o discriminación",
  illegal: "Contenido ilegal o peligroso",
  impersonation: "Suplantación de identidad",
  other: "Otro motivo"
};

const ADMIN_DECISION_LABELS = {
  dismiss: "Reporte descartado",
  hide: "Comentario oculto",
  restrict: "Cuenta restringida",
  hide_and_restrict: "Comentario oculto y cuenta restringida"
};

const adminCommunityState = {
  view: "pending",
  rows: [],
  cursor: null,
  hasMore: false,
  loading: true,
  loadingMore: false,
  error: "",
  actionMessage: "",
  actionTone: "success",
  actingId: null,
  currentUserId: null
};

function getAdminCommunityViewConfig(view = adminCommunityState.view) {
  const configs = {
    pending: { label: "Pendientes", type: "reports", status: "Pendiente" },
    acted: { label: "Actuados", type: "reports", status: "Actuado" },
    dismissed: { label: "Descartados", type: "reports", status: "Descartado" },
    hidden: { label: "Ocultos", type: "hidden" },
    restrictions: { label: "Restricciones", type: "restrictions" }
  };
  return configs[view] || configs.pending;
}

function normalizeAdminSnapshot(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function createAdminCommunityTabs() {
  return `
    <div class="admin-community-tabs" role="tablist" aria-label="Colas de moderación">
      ${["pending", "acted", "dismissed", "hidden", "restrictions"].map((view) => {
        const config = getAdminCommunityViewConfig(view);
        const selected = view === adminCommunityState.view;
        return `<button type="button" role="tab" data-admin-community-view="${view}" aria-selected="${selected}" tabindex="${selected ? "0" : "-1"}">${config.label}</button>`;
      }).join("")}
    </div>
  `;
}

function createAdminReportTargetMarkup(report) {
  const snapshot = normalizeAdminSnapshot(report.target_snapshot);
  if (report.target_type === "comment") {
    return `
      <div class="admin-report-target">
        <span>Comentario de ${adminCommunitySocial.escapeHtml(snapshot.author_username || "@Cuenta eliminada")}</span>
        <blockquote>${adminCommunitySocial.escapeHtml(snapshot.body || "El comentario ya no está disponible.")}</blockquote>
        ${snapshot.market_id ? `<a href="market-detail.html?id=${encodeURIComponent(snapshot.market_id)}#market-comments-section">${adminCommunitySocial.escapeHtml(snapshot.market_question || "Abrir mercado")}</a>` : ""}
      </div>
    `;
  }

  return `
    <div class="admin-report-target">
      <span>Perfil reportado</span>
      <strong>${adminCommunitySocial.escapeHtml(snapshot.username || "@Cuenta eliminada")}</strong>
      ${snapshot.bio ? `<blockquote>${adminCommunitySocial.escapeHtml(snapshot.bio)}</blockquote>` : ""}
      <a href="profile.html?id=${encodeURIComponent(report.target_id)}">Abrir perfil público</a>
    </div>
  `;
}

function createAdminReportActionForm(report) {
  const commentTarget = report.target_type === "comment";
  return `
    <form class="admin-report-action-form" data-admin-report-form="${report.report_id}">
      <div class="admin-report-action-grid">
        <label>
          <span>Decisión</span>
          <select name="action" required>
            <option value="dismiss">Descartar reporte</option>
            ${commentTarget ? '<option value="hide">Ocultar comentario</option>' : ""}
            <option value="restrict">Restringir cuenta</option>
            ${commentTarget ? '<option value="hide_and_restrict">Ocultar y restringir</option>' : ""}
          </select>
        </label>
        <label>
          <span>Duración si se restringe</span>
          <select name="hours">
            <option value="24">24 horas</option>
            <option value="72">3 días</option>
            <option value="168">7 días</option>
            <option value="720">30 días</option>
          </select>
        </label>
      </div>
      <label>
        <span>Nota de revisión <small>(recomendada)</small></span>
        <textarea name="note" maxlength="1000" rows="3" placeholder="Motivo y contexto de la decisión..."></textarea>
      </label>
      <p class="social-status" data-admin-action-status aria-live="polite" hidden></p>
      <button class="danger-button" type="submit"${adminCommunityState.actingId === report.report_id ? " disabled" : ""}>
        ${adminCommunityState.actingId === report.report_id ? "Aplicando decisión..." : "Confirmar revisión"}
      </button>
    </form>
  `;
}

function createAdminReportCard(report) {
  const isPending = report.status === "Pendiente";
  return `
    <article class="admin-report-card">
      <header>
        <div>
          <span class="status ${isPending ? "status-closed" : report.status === "Actuado" ? "status-resolved" : "status-annulled"}">${adminCommunitySocial.escapeHtml(report.status)}</span>
          <strong>${adminCommunitySocial.escapeHtml(ADMIN_REPORT_REASON_LABELS[report.reason] || report.reason)}</strong>
        </div>
        <time datetime="${adminCommunitySocial.escapeHtml(report.created_at)}">${adminCommunitySocial.escapeHtml(adminCommunitySocial.formatDate(report.created_at))}</time>
      </header>
      <dl class="admin-report-meta">
        <div><dt>Reportado por</dt><dd>${adminCommunitySocial.escapeHtml(report.reporter_username || "@Cuenta eliminada")}</dd></div>
        <div><dt>Tipo</dt><dd>${report.target_type === "comment" ? "Comentario" : "Perfil"}</dd></div>
        <div><dt>ID de auditoría</dt><dd><code>${adminCommunitySocial.escapeHtml(report.report_id)}</code></dd></div>
      </dl>
      ${report.detail ? `<div class="admin-report-detail"><strong>Contexto del reporte</strong><p>${adminCommunitySocial.escapeHtml(report.detail)}</p></div>` : ""}
      ${createAdminReportTargetMarkup(report)}
      ${isPending ? createAdminReportActionForm(report) : `
        <div class="admin-report-decision">
          <strong>${adminCommunitySocial.escapeHtml(ADMIN_DECISION_LABELS[report.decision] || "Revisión completada")}</strong>
          ${report.review_note ? `<p>${adminCommunitySocial.escapeHtml(report.review_note)}</p>` : ""}
          <small>${report.reviewed_at ? `Revisado ${adminCommunitySocial.escapeHtml(adminCommunitySocial.formatDate(report.reviewed_at))}` : ""}${report.reviewed_by_username ? ` por ${adminCommunitySocial.escapeHtml(report.reviewed_by_username)}` : ""}</small>
        </div>
      `}
    </article>
  `;
}

function createAdminHiddenCommentCard(comment) {
  return `
    <article class="admin-report-card admin-hidden-card">
      <header>
        <div><span class="status status-closed">Oculto</span><strong>${adminCommunitySocial.escapeHtml(comment.author_username)}</strong></div>
        <time datetime="${adminCommunitySocial.escapeHtml(comment.moderated_at)}">${adminCommunitySocial.escapeHtml(adminCommunitySocial.formatDate(comment.moderated_at))}</time>
      </header>
      <blockquote>${adminCommunitySocial.escapeHtml(comment.body)}</blockquote>
      <dl class="admin-report-meta">
        <div><dt>Mercado</dt><dd><a href="market-detail.html?id=${encodeURIComponent(comment.market_id)}#market-comments-section">${adminCommunitySocial.escapeHtml(comment.market_question)}</a></dd></div>
        <div><dt>Moderado por</dt><dd>${adminCommunitySocial.escapeHtml(comment.moderated_by_username || "Cuenta administrativa")}</dd></div>
        <div><dt>Motivo</dt><dd>${adminCommunitySocial.escapeHtml(comment.moderation_reason || "Sin nota")}</dd></div>
      </dl>
      <button class="secondary-button" type="button" data-admin-restore-comment="${comment.comment_id}"${adminCommunityState.actingId === comment.comment_id ? " disabled" : ""}>Restaurar comentario</button>
    </article>
  `;
}

function createAdminRestrictionCard(restriction) {
  return `
    <article class="admin-report-card admin-restriction-card">
      <header>
        <div><span class="status status-closed">Restringida</span><strong>${adminCommunitySocial.escapeHtml(restriction.username)}</strong></div>
        <time datetime="${adminCommunitySocial.escapeHtml(restriction.restricted_until)}">Hasta ${adminCommunitySocial.escapeHtml(adminCommunitySocial.formatDate(restriction.restricted_until))}</time>
      </header>
      <p>${adminCommunitySocial.escapeHtml(restriction.reason)}</p>
      <dl class="admin-report-meta">
        <div><dt>Inicio</dt><dd>${adminCommunitySocial.escapeHtml(adminCommunitySocial.formatDate(restriction.created_at))}</dd></div>
        <div><dt>Aplicada por</dt><dd>${adminCommunitySocial.escapeHtml(restriction.created_by_username || "Cuenta administrativa")}</dd></div>
        <div><dt>Cuenta</dt><dd><a href="profile.html?id=${encodeURIComponent(restriction.user_id)}">Abrir perfil</a></dd></div>
      </dl>
      <button class="secondary-button" type="button" data-admin-lift-restriction="${restriction.restriction_id}"${adminCommunityState.actingId === restriction.restriction_id ? " disabled" : ""}>Levantar restricción</button>
    </article>
  `;
}

function renderAdminCommunityAccess(auth) {
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  adminCommunityRoot.innerHTML = `
    <article class="admin-access-card">
      <p class="eyebrow">Acceso restringido</p>
      <h2>${isAuthenticated ? "Esta cuenta no administra Oraklo" : "Inicia sesión como administradora"}</h2>
      <p>Los reportes contienen información privada y solo pueden consultarse desde una cuenta autorizada.</p>
      ${isAuthenticated
        ? '<a class="secondary-button" href="community.html">Volver a comunidad</a>'
        : '<button class="primary-button" type="button" data-auth-open>Iniciar sesión</button>'}
    </article>
  `;
}

function renderAdminCommunity() {
  if (!adminCommunityRoot) return;
  const auth = window.orakloAuth?.getState?.();
  if (!auth?.isAuthenticated || !auth?.isAdmin) {
    renderAdminCommunityAccess(auth);
    return;
  }

  const config = getAdminCommunityViewConfig();
  let listMarkup = "";
  if (config.type === "reports") listMarkup = adminCommunityState.rows.map(createAdminReportCard).join("");
  if (config.type === "hidden") listMarkup = adminCommunityState.rows.map(createAdminHiddenCommentCard).join("");
  if (config.type === "restrictions") listMarkup = adminCommunityState.rows.map(createAdminRestrictionCard).join("");

  adminCommunityRoot.innerHTML = `
    <div class="admin-community-toolbar">
      <div>
        <p class="eyebrow">Cola privada</p>
        <h2>${config.label}</h2>
      </div>
      ${createAdminCommunityTabs()}
    </div>
    ${adminCommunityState.actionMessage ? `<p class="social-status social-status-${adminCommunityState.actionTone}">${adminCommunitySocial.escapeHtml(adminCommunityState.actionMessage)}</p>` : ""}
    ${adminCommunityState.loading
      ? '<div class="social-loading-card"><strong>Cargando cola...</strong><p>Consultando decisiones y reportes privados.</p></div>'
      : adminCommunityState.error
        ? `<div class="social-empty-card social-error-card"><strong>No se ha podido cargar esta cola</strong><p>${adminCommunitySocial.escapeHtml(adminCommunityState.error)}</p><button class="secondary-button" type="button" data-admin-community-retry>Reintentar</button></div>`
        : listMarkup
          ? `<div class="admin-report-list">${listMarkup}</div>`
          : `<div class="social-empty-card"><strong>No hay elementos en ${config.label.toLowerCase()}</strong><p>La cola se alimenta únicamente con actividad real de Supabase.</p></div>`}
    ${adminCommunityState.hasMore && !adminCommunityState.loading ? `<button class="secondary-button social-load-more" type="button" data-admin-community-more${adminCommunityState.loadingMore ? " disabled" : ""}>${adminCommunityState.loadingMore ? "Cargando..." : "Ver elementos anteriores"}</button>` : ""}
  `;
}

async function fetchAdminCommunityPage(cursor = null) {
  const config = getAdminCommunityViewConfig();
  let rows;

  if (config.type === "reports") {
    rows = await adminCommunitySocial.rpc("get_admin_community_reports", {
      status_filter_input: config.status,
      before_created_at_input: cursor?.date || null,
      before_report_id_input: cursor?.id || null,
      limit_count: ADMIN_COMMUNITY_PAGE_SIZE + 1
    });
  } else if (config.type === "hidden") {
    rows = await adminCommunitySocial.rpc("get_admin_hidden_comments", {
      before_moderated_at_input: cursor?.date || null,
      before_comment_id_input: cursor?.id || null,
      limit_count: ADMIN_COMMUNITY_PAGE_SIZE + 1
    });
  } else {
    rows = await adminCommunitySocial.rpc("get_admin_active_restrictions", {
      before_created_at_input: cursor?.date || null,
      before_restriction_id_input: cursor?.id || null,
      limit_count: ADMIN_COMMUNITY_PAGE_SIZE + 1
    });
  }

  const visibleRows = (rows || []).slice(0, ADMIN_COMMUNITY_PAGE_SIZE);
  const last = visibleRows[visibleRows.length - 1] || null;
  const date = config.type === "hidden" ? last?.moderated_at : last?.created_at;
  const id = config.type === "reports" ? last?.report_id : config.type === "hidden" ? last?.comment_id : last?.restriction_id;
  return {
    rows: visibleRows,
    hasMore: (rows || []).length > ADMIN_COMMUNITY_PAGE_SIZE,
    cursor: last ? { date, id } : cursor
  };
}

async function loadAdminCommunity({ append = false } = {}) {
  if (append) adminCommunityState.loadingMore = true;
  else {
    adminCommunityState.loading = true;
    adminCommunityState.error = "";
    adminCommunityState.rows = [];
    adminCommunityState.cursor = null;
    adminCommunityState.hasMore = false;
  }
  renderAdminCommunity();

  try {
    const page = await fetchAdminCommunityPage(append ? adminCommunityState.cursor : null);
    adminCommunityState.rows = append ? [...adminCommunityState.rows, ...page.rows] : page.rows;
    adminCommunityState.cursor = page.cursor;
    adminCommunityState.hasMore = page.hasMore;
  } catch (error) {
    adminCommunityState.error = adminCommunitySocial.getErrorMessage(error, "No se ha podido consultar la cola privada de moderación.");
  } finally {
    adminCommunityState.loading = false;
    adminCommunityState.loadingMore = false;
    renderAdminCommunity();
  }
}

async function submitAdminReportDecision(form) {
  const reportId = form.dataset.adminReportForm;
  const status = form.querySelector("[data-admin-action-status]");
  const action = form.elements.action.value;
  const note = form.elements.note.value.trim() || null;
  const hours = Number(form.elements.hours.value) || 24;
  adminCommunityState.actingId = reportId;
  form.querySelector("button[type='submit']").disabled = true;
  adminCommunitySocial.setStatus(status, "Aplicando decisión y registrando auditoría...", "info");

  try {
    await adminCommunitySocial.rpc("review_community_report", {
      report_id_input: reportId,
      action_input: action,
      review_note_input: note,
      restriction_hours_input: hours
    });
    adminCommunityState.actionMessage = ADMIN_DECISION_LABELS[action] || "Revisión completada.";
    adminCommunityState.actionTone = "success";
    adminCommunityState.actingId = null;
    await loadAdminCommunity();
  } catch (error) {
    adminCommunitySocial.setStatus(status, adminCommunitySocial.getErrorMessage(error), "error");
    adminCommunityState.actingId = null;
    form.querySelector("button[type='submit']").disabled = false;
  }
}

async function restoreAdminComment(commentId) {
  const reason = window.prompt("Motivo de la restauración (opcional):", "Revisión administrativa");
  if (reason === null) return;
  adminCommunityState.actingId = commentId;
  renderAdminCommunity();
  try {
    await adminCommunitySocial.rpc("restore_community_comment", {
      comment_id_input: commentId,
      reason_input: reason.trim() || null
    });
    adminCommunityState.actionMessage = "Comentario restaurado y decisión registrada.";
    adminCommunityState.actionTone = "success";
    adminCommunityState.actingId = null;
    await loadAdminCommunity();
  } catch (error) {
    adminCommunityState.actionMessage = adminCommunitySocial.getErrorMessage(error);
    adminCommunityState.actionTone = "error";
    adminCommunityState.actingId = null;
    renderAdminCommunity();
  }
}

async function liftAdminRestriction(restrictionId) {
  const reason = window.prompt("Motivo para levantar la restricción (opcional):", "Revisión administrativa");
  if (reason === null) return;
  adminCommunityState.actingId = restrictionId;
  renderAdminCommunity();
  try {
    await adminCommunitySocial.rpc("lift_community_restriction", {
      restriction_id_input: restrictionId,
      reason_input: reason.trim() || null
    });
    adminCommunityState.actionMessage = "Restricción levantada y decisión registrada.";
    adminCommunityState.actionTone = "success";
    adminCommunityState.actingId = null;
    await loadAdminCommunity();
  } catch (error) {
    adminCommunityState.actionMessage = adminCommunitySocial.getErrorMessage(error);
    adminCommunityState.actionTone = "error";
    adminCommunityState.actingId = null;
    renderAdminCommunity();
  }
}

function handleAdminCommunityClick(event) {
  const tab = event.target.closest("[data-admin-community-view]");
  const retry = event.target.closest("[data-admin-community-retry]");
  const more = event.target.closest("[data-admin-community-more]");
  const restore = event.target.closest("[data-admin-restore-comment]");
  const lift = event.target.closest("[data-admin-lift-restriction]");

  if (tab && tab.dataset.adminCommunityView !== adminCommunityState.view) {
    adminCommunityState.view = tab.dataset.adminCommunityView;
    adminCommunityState.actionMessage = "";
    loadAdminCommunity();
  }
  if (retry) loadAdminCommunity();
  if (more) loadAdminCommunity({ append: true });
  if (restore) restoreAdminComment(restore.dataset.adminRestoreComment);
  if (lift) liftAdminRestriction(lift.dataset.adminLiftRestriction);
}

function handleAdminCommunitySubmit(event) {
  const form = event.target.closest("[data-admin-report-form]");
  if (!form) return;
  event.preventDefault();
  submitAdminReportDecision(form);
}

function handleAdminCommunityKeydown(event) {
  if (!event.target.matches("[data-admin-community-view]") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  const tabs = Array.from(adminCommunityRoot.querySelectorAll("[data-admin-community-view]"));
  const currentIndex = tabs.indexOf(event.target);
  if (currentIndex < 0) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
  nextTab.focus();
  if (nextTab.dataset.adminCommunityView !== adminCommunityState.view) {
    adminCommunityState.view = nextTab.dataset.adminCommunityView;
    adminCommunityState.actionMessage = "";
    loadAdminCommunity();
  }
}

async function initializeAdminCommunity() {
  if (!adminCommunityRoot || !adminCommunitySocial) return;
  adminCommunityRoot.addEventListener("click", handleAdminCommunityClick);
  adminCommunityRoot.addEventListener("submit", handleAdminCommunitySubmit);
  adminCommunityRoot.addEventListener("keydown", handleAdminCommunityKeydown);
  await window.orakloAuth?.ready;

  const auth = window.orakloAuth?.getState?.();
  adminCommunityState.currentUserId = auth?.user?.id || null;
  if (!auth?.isAuthenticated || !auth?.isAdmin) {
    adminCommunityState.loading = false;
    renderAdminCommunity();
  } else {
    await loadAdminCommunity();
  }

  window.orakloAuth?.onChange?.((nextAuth) => {
    if (!nextAuth.ready) return;
    const nextUserId = nextAuth.user?.id || null;
    if (nextUserId === adminCommunityState.currentUserId) return;
    adminCommunityState.currentUserId = nextUserId;
    if (nextAuth.isAuthenticated && nextAuth.isAdmin) loadAdminCommunity();
    else renderAdminCommunityAccess(nextAuth);
  });
}

initializeAdminCommunity();
