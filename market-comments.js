const marketCommentsRoot = document.querySelector("#market-comments-root");
const marketCommentsSection = document.querySelector("#market-comments-section");
const marketCommentsSocial = window.orakloSocial;

const MARKET_COMMENT_PAGE_SIZE = 10;

const marketCommentsState = {
  marketId: new URLSearchParams(window.location.search).get("id")?.trim() || "",
  rows: [],
  cursor: null,
  hasMore: false,
  loading: true,
  loadingMore: false,
  error: "",
  replyTo: null,
  editingId: null,
  currentUserId: null
};

function getMarketCommentThreads(rows = marketCommentsState.rows) {
  const threads = [];
  const threadMap = new Map();

  rows.forEach((row) => {
    const threadId = row.thread_id || row.comment_id;
    if (!threadMap.has(threadId)) {
      const thread = { id: threadId, parent: null, replies: [] };
      threadMap.set(threadId, thread);
      threads.push(thread);
    }

    const thread = threadMap.get(threadId);
    if (row.is_reply) thread.replies.push(row);
    else thread.parent = row;
  });

  return threads.filter((thread) => thread.parent);
}

function createMarketCommentBodyMarkup(comment) {
  const body = marketCommentsSocial.escapeHtml(comment.body || "");
  if (!comment.is_spoiler) return `<p class="market-comment-body">${body}</p>`;

  return `
    <div class="market-comment-spoiler">
      <button type="button" data-comment-spoiler="${comment.comment_id}" aria-expanded="false">
        Posible spoiler · Mostrar comentario
      </button>
      <p class="market-comment-body" data-comment-spoiler-content="${comment.comment_id}" hidden>${body}</p>
    </div>
  `;
}

function createMarketCommentEditorMarkup(comment) {
  return `
    <form class="market-comment-edit-form" data-comment-edit-form="${comment.comment_id}">
      <label class="sr-only" for="edit-comment-${comment.comment_id}">Editar comentario</label>
      <textarea id="edit-comment-${comment.comment_id}" maxlength="500" rows="4" required>${marketCommentsSocial.escapeHtml(comment.body || "")}</textarea>
      <div class="market-comment-form-row">
        <label class="market-comment-spoiler-check">
          <input type="checkbox" data-edit-spoiler${comment.is_spoiler ? " checked" : ""}>
          <span>Marcar como spoiler</span>
        </label>
        <span data-edit-comment-count>${String(comment.body || "").length}/500</span>
      </div>
      <p class="social-status" data-comment-edit-status aria-live="polite" hidden></p>
      <div class="market-comment-edit-actions">
        <button class="secondary-button" type="button" data-comment-edit-cancel>Cancelar</button>
        <button class="primary-button" type="submit">Guardar edición</button>
      </div>
    </form>
  `;
}

function createMarketCommentActionsMarkup(comment, isParent) {
  const auth = window.orakloAuth?.getState?.();
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const isOwn = Boolean(auth?.user?.id && auth.user.id === comment.author_id);
  const canReact = !isOwn && (comment.viewer_can_react || !isAuthenticated);
  const reactionLabel = `${comment.viewer_reacted ? "Retirar" : "Marcar"} Buena lectura`;

  return `
    <div class="market-comment-actions">
      <button class="social-action-button${comment.viewer_reacted ? " is-active" : ""}" type="button"
        data-comment-reaction="${comment.comment_id}"
        aria-pressed="${Boolean(comment.viewer_reacted)}"
        ${canReact ? "" : "disabled"}
        title="${isOwn ? "No puedes reaccionar a tu propio contenido" : "Buena lectura"}">
        <span aria-hidden="true">✦</span>
        <span>${reactionLabel}</span>
        <strong>${marketCommentsSocial.formatNumber(comment.reaction_count)}</strong>
      </button>
      ${isParent ? `<button class="social-text-button" type="button" data-comment-reply="${comment.comment_id}" data-comment-username="${marketCommentsSocial.escapeHtml(comment.username || "este comentario")}">Responder</button>` : ""}
      ${comment.viewer_can_edit ? `
        <button class="social-text-button" type="button" data-comment-edit="${comment.comment_id}">Editar</button>
        <button class="social-text-button social-text-danger" type="button" data-comment-delete="${comment.comment_id}">Eliminar</button>
      ` : ""}
      ${!isOwn && comment.author_id ? `
        <button class="social-text-button" type="button" data-comment-report="${comment.comment_id}"${comment.viewer_has_open_report ? " disabled" : ""}>
          ${comment.viewer_has_open_report ? "Reportado" : "Reportar"}
        </button>
      ` : ""}
    </div>
  `;
}

function createMarketCommentMarkup(comment, isParent = false) {
  if (comment.status !== "Visible") {
    return `
      <article class="market-comment market-comment-placeholder${isParent ? " is-parent" : " is-reply"}">
        <p>${comment.status === "Eliminado" ? "Comentario eliminado por su autor." : "Comentario oculto por moderación."}</p>
      </article>
    `;
  }

  const profileLink = comment.author_id
    ? `profile.html?id=${encodeURIComponent(comment.author_id)}`
    : "";
  const dateLabel = marketCommentsSocial.formatRelativeDate(comment.created_at);
  const exactDate = marketCommentsSocial.formatDate(comment.created_at);

  return `
    <article class="market-comment${isParent ? " is-parent" : " is-reply"}" data-comment-id="${comment.comment_id}">
      <header class="market-comment-header">
        ${profileLink ? `<a class="market-comment-author" href="${profileLink}">` : '<span class="market-comment-author">'}
          ${marketCommentsSocial.createAvatarMarkup(comment, "market-comment-avatar")}
          <span>
            <strong>${marketCommentsSocial.escapeHtml(comment.username || "@Cuenta eliminada")}</strong>
            <small>${marketCommentsSocial.escapeHtml(comment.rank || "Observador")}</small>
          </span>
        ${profileLink ? "</a>" : "</span>"}
        <span class="market-comment-date">
          <time datetime="${marketCommentsSocial.escapeHtml(comment.created_at)}" title="${marketCommentsSocial.escapeHtml(exactDate)}">${marketCommentsSocial.escapeHtml(dateLabel)}</time>
          ${comment.edited_at ? " · editado" : ""}
        </span>
      </header>
      ${marketCommentsState.editingId === comment.comment_id
        ? createMarketCommentEditorMarkup(comment)
        : `${createMarketCommentBodyMarkup(comment)}${createMarketCommentActionsMarkup(comment, isParent)}`}
    </article>
  `;
}

function createMarketCommentThreadMarkup(thread) {
  return `
    <div class="market-comment-thread">
      ${createMarketCommentMarkup(thread.parent, true)}
      ${thread.replies.length ? `
        <div class="market-comment-replies" aria-label="Respuestas">
          ${thread.replies.map((reply) => createMarketCommentMarkup(reply, false)).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function createMarketCommentComposerMarkup() {
  const auth = window.orakloAuth?.getState?.();
  if (!auth?.isAuthenticated) {
    return `
      <div class="market-comment-guest-callout">
        <div>
          <strong>Únete al debate</strong>
          <p>Puedes leer todos los comentarios. Inicia sesión para escribir, responder o reaccionar.</p>
        </div>
        <button class="primary-button" type="button" data-auth-open data-auth-message="Inicia sesión para participar en este debate.">Iniciar sesión</button>
      </div>
    `;
  }

  return `
    <form class="market-comment-composer" id="market-comment-composer">
      ${marketCommentsState.replyTo ? `
        <div class="market-comment-replying">
          <span>Respondiendo a <strong>${marketCommentsSocial.escapeHtml(marketCommentsState.replyTo.username)}</strong></span>
          <button type="button" data-comment-reply-cancel aria-label="Cancelar respuesta">×</button>
        </div>
      ` : ""}
      <label for="market-comment-body">${marketCommentsState.replyTo ? "Tu respuesta" : "Comparte tu lectura"}</label>
      <textarea id="market-comment-body" maxlength="500" rows="4" placeholder="Argumenta tu predicción, comparte una señal o plantea una duda..." required></textarea>
      <div class="market-comment-form-row">
        <label class="market-comment-spoiler-check">
          <input id="market-comment-spoiler" type="checkbox">
          <span>Marcar como spoiler</span>
        </label>
        <span id="market-comment-count">0/500</span>
      </div>
      <p class="social-status" id="market-comment-status" aria-live="polite" hidden></p>
      <div class="market-comment-submit-row">
        <small>Texto plano · máximo 500 caracteres</small>
        <button class="primary-button" id="market-comment-submit" type="submit">${marketCommentsState.replyTo ? "Publicar respuesta" : "Publicar comentario"}</button>
      </div>
    </form>
  `;
}

function renderMarketComments() {
  if (!marketCommentsRoot) return;
  const threads = getMarketCommentThreads();

  marketCommentsRoot.innerHTML = `
    <div class="market-comments-heading">
      <div>
        <p class="eyebrow">Comunidad</p>
        <h2 id="market-comments-title">Debate del mercado</h2>
        <p>Comentarios reales de la comunidad. Las opiniones no alteran probabilidades, Karma ni Prestigio.</p>
      </div>
      <a class="secondary-button" href="community.html">Ver feed de comunidad</a>
    </div>
    ${createMarketCommentComposerMarkup()}
    ${marketCommentsState.error ? `<p class="social-status social-status-error">${marketCommentsSocial.escapeHtml(marketCommentsState.error)}</p>` : ""}
    <div class="market-comments-list" aria-live="polite">
      ${marketCommentsState.loading
        ? '<div class="social-loading-card"><strong>Cargando debate...</strong><p>Consultando comentarios reales en Supabase.</p></div>'
        : threads.length
          ? threads.map(createMarketCommentThreadMarkup).join("")
          : '<div class="social-empty-card"><strong>Aún no hay comentarios</strong><p>Este debate comenzará cuando alguien comparta su primera lectura.</p></div>'}
    </div>
    ${marketCommentsState.hasMore ? `
      <button class="secondary-button social-load-more" type="button" data-comments-load-more${marketCommentsState.loadingMore ? " disabled" : ""}>
        ${marketCommentsState.loadingMore ? "Cargando..." : "Ver comentarios anteriores"}
      </button>
    ` : ""}
  `;
}

async function fetchMarketCommentPage(cursor = null) {
  const rows = await marketCommentsSocial.rpc("get_public_market_comments", {
    market_id_input: marketCommentsState.marketId,
    before_created_at_input: cursor?.createdAt || null,
    before_comment_id_input: cursor?.commentId || null,
    limit_count: MARKET_COMMENT_PAGE_SIZE + 1
  });
  const threads = getMarketCommentThreads(rows || []);
  const visibleThreads = threads.slice(0, MARKET_COMMENT_PAGE_SIZE);
  const lastThread = visibleThreads[visibleThreads.length - 1] || null;

  return {
    rows: visibleThreads.flatMap((thread) => [thread.parent, ...thread.replies]),
    hasMore: threads.length > MARKET_COMMENT_PAGE_SIZE,
    cursor: lastThread
      ? {
          createdAt: lastThread.parent.thread_created_at,
          commentId: lastThread.parent.thread_id
        }
      : cursor
  };
}

async function reloadMarketComments() {
  marketCommentsState.loading = true;
  marketCommentsState.error = "";
  marketCommentsState.cursor = null;
  marketCommentsState.hasMore = false;
  renderMarketComments();

  try {
    const page = await fetchMarketCommentPage();
    marketCommentsState.rows = page.rows;
    marketCommentsState.cursor = page.cursor;
    marketCommentsState.hasMore = page.hasMore;
  } catch (error) {
    marketCommentsState.rows = [];
    marketCommentsState.error = marketCommentsSocial.getErrorMessage(error, "No se ha podido cargar el debate real. Recarga la página para volver a intentarlo.");
  } finally {
    marketCommentsState.loading = false;
    renderMarketComments();
  }
}

async function loadMoreMarketComments() {
  if (marketCommentsState.loadingMore || !marketCommentsState.hasMore) return;
  marketCommentsState.loadingMore = true;
  renderMarketComments();

  try {
    const page = await fetchMarketCommentPage(marketCommentsState.cursor);
    marketCommentsState.rows.push(...page.rows);
    marketCommentsState.cursor = page.cursor;
    marketCommentsState.hasMore = page.hasMore;
  } catch (error) {
    marketCommentsState.error = marketCommentsSocial.getErrorMessage(error, "No se han podido cargar más comentarios.");
  } finally {
    marketCommentsState.loadingMore = false;
    renderMarketComments();
  }
}

function adjustMarketCommentCount(delta) {
  const node = document.querySelector("[data-detail-comment-count]");
  if (!node) return;
  const current = Number(String(node.textContent || "0").replace(/\D/g, "")) || 0;
  node.textContent = marketCommentsSocial.formatNumber(Math.max(0, current + delta));
}

async function submitMarketComment(event) {
  event.preventDefault();
  const auth = await marketCommentsSocial.requireAuth("Inicia sesión para publicar en este debate.");
  if (!auth) return;

  const textarea = document.querySelector("#market-comment-body");
  const submit = document.querySelector("#market-comment-submit");
  const status = document.querySelector("#market-comment-status");
  const body = textarea?.value.trim() || "";
  if (!body || body.length > 500) {
    marketCommentsSocial.setStatus(status, "Escribe entre 1 y 500 caracteres.", "error");
    return;
  }

  submit.disabled = true;
  marketCommentsSocial.setStatus(status, "Publicando...", "info");
  try {
    await marketCommentsSocial.rpc("create_market_comment", {
      market_id_input: marketCommentsState.marketId,
      body_input: body,
      parent_id_input: marketCommentsState.replyTo?.id || null,
      is_spoiler_input: Boolean(document.querySelector("#market-comment-spoiler")?.checked)
    });
    marketCommentsState.replyTo = null;
    adjustMarketCommentCount(1);
    await reloadMarketComments();
  } catch (error) {
    marketCommentsSocial.setStatus(status, marketCommentsSocial.getErrorMessage(error), "error");
    submit.disabled = false;
  }
}

async function submitMarketCommentEdit(form) {
  const commentId = form.dataset.commentEditForm;
  const textarea = form.querySelector("textarea");
  const submit = form.querySelector("button[type='submit']");
  const status = form.querySelector("[data-comment-edit-status]");
  const body = textarea?.value.trim() || "";
  if (!body || body.length > 500) {
    marketCommentsSocial.setStatus(status, "Escribe entre 1 y 500 caracteres.", "error");
    return;
  }

  submit.disabled = true;
  marketCommentsSocial.setStatus(status, "Guardando...", "info");
  try {
    await marketCommentsSocial.rpc("update_market_comment", {
      comment_id_input: commentId,
      body_input: body,
      is_spoiler_input: Boolean(form.querySelector("[data-edit-spoiler]")?.checked)
    });
    marketCommentsState.editingId = null;
    await reloadMarketComments();
  } catch (error) {
    marketCommentsSocial.setStatus(status, marketCommentsSocial.getErrorMessage(error), "error");
    submit.disabled = false;
  }
}

async function toggleMarketCommentReaction(button) {
  const commentId = button.dataset.commentReaction;
  const nextActive = button.getAttribute("aria-pressed") !== "true";
  button.disabled = true;

  try {
    const result = await marketCommentsSocial.setReaction("comment", commentId, nextActive);
    if (!result) return;
    const row = marketCommentsState.rows.find((item) => item.comment_id === commentId);
    if (row) {
      row.viewer_reacted = Boolean(result.active);
      row.reaction_count = Number(result.reaction_count) || 0;
    }
    renderMarketComments();
  } catch (error) {
    marketCommentsState.error = marketCommentsSocial.getErrorMessage(error);
    renderMarketComments();
  } finally {
    button.disabled = false;
  }
}

async function deleteMarketComment(commentId) {
  if (!window.confirm("¿Eliminar este comentario? La acción lo retirará del debate.")) return;

  try {
    await marketCommentsSocial.rpc("delete_market_comment", { comment_id_input: commentId });
    marketCommentsState.editingId = null;
    adjustMarketCommentCount(-1);
    await reloadMarketComments();
  } catch (error) {
    marketCommentsState.error = marketCommentsSocial.getErrorMessage(error);
    renderMarketComments();
  }
}

function handleMarketCommentsClick(event) {
  const spoiler = event.target.closest("[data-comment-spoiler]");
  const reply = event.target.closest("[data-comment-reply]");
  const replyCancel = event.target.closest("[data-comment-reply-cancel]");
  const edit = event.target.closest("[data-comment-edit]");
  const editCancel = event.target.closest("[data-comment-edit-cancel]");
  const remove = event.target.closest("[data-comment-delete]");
  const reaction = event.target.closest("[data-comment-reaction]");
  const report = event.target.closest("[data-comment-report]");
  const loadMore = event.target.closest("[data-comments-load-more]");

  if (spoiler) {
    const content = marketCommentsRoot.querySelector(`[data-comment-spoiler-content='${spoiler.dataset.commentSpoiler}']`);
    const expanded = spoiler.getAttribute("aria-expanded") === "true";
    spoiler.setAttribute("aria-expanded", String(!expanded));
    spoiler.textContent = expanded ? "Posible spoiler · Mostrar comentario" : "Ocultar spoiler";
    if (content) content.hidden = expanded;
  }
  if (reply) {
    marketCommentsSocial.requireAuth("Inicia sesión para responder en este debate.").then((auth) => {
      if (!auth) return;
      marketCommentsState.replyTo = {
        id: reply.dataset.commentReply,
        username: reply.dataset.commentUsername
      };
      renderMarketComments();
      document.querySelector("#market-comment-body")?.focus();
    });
  }
  if (replyCancel) {
    marketCommentsState.replyTo = null;
    renderMarketComments();
  }
  if (edit) {
    marketCommentsState.editingId = edit.dataset.commentEdit;
    renderMarketComments();
    document.querySelector(`#edit-comment-${edit.dataset.commentEdit}`)?.focus();
  }
  if (editCancel) {
    marketCommentsState.editingId = null;
    renderMarketComments();
  }
  if (remove) deleteMarketComment(remove.dataset.commentDelete);
  if (reaction) toggleMarketCommentReaction(reaction);
  if (report) {
    const row = marketCommentsState.rows.find((item) => item.comment_id === report.dataset.commentReport);
    marketCommentsSocial.openReport({
      targetType: "comment",
      targetId: report.dataset.commentReport,
      targetLabel: row?.body?.slice(0, 120) || "Comentario del mercado",
      trigger: report
    });
  }
  if (loadMore) loadMoreMarketComments();
}

function handleMarketCommentsInput(event) {
  if (event.target.id === "market-comment-body") {
    const counter = document.querySelector("#market-comment-count");
    if (counter) counter.textContent = `${event.target.value.length}/500`;
  }
  if (event.target.closest("[data-comment-edit-form]") && event.target.matches("textarea")) {
    const counter = event.target.closest("form")?.querySelector("[data-edit-comment-count]");
    if (counter) counter.textContent = `${event.target.value.length}/500`;
  }
}

function handleMarketCommentsSubmit(event) {
  if (event.target.id === "market-comment-composer") submitMarketComment(event);
  if (event.target.matches("[data-comment-edit-form]")) {
    event.preventDefault();
    submitMarketCommentEdit(event.target);
  }
}

async function initializeMarketComments() {
  if (!marketCommentsRoot || !marketCommentsSocial || !marketCommentsState.marketId) {
    if (marketCommentsSection) marketCommentsSection.hidden = true;
    return;
  }

  await window.orakloAuth?.ready;
  marketCommentsState.currentUserId = window.orakloAuth?.getState?.().user?.id || null;
  marketCommentsRoot.addEventListener("click", handleMarketCommentsClick);
  marketCommentsRoot.addEventListener("input", handleMarketCommentsInput);
  marketCommentsRoot.addEventListener("submit", handleMarketCommentsSubmit);

  window.addEventListener("oraklo:social-report-created", (event) => {
    if (event.detail?.targetType !== "comment") return;
    const row = marketCommentsState.rows.find((item) => item.comment_id === event.detail.targetId);
    if (row) row.viewer_has_open_report = true;
    renderMarketComments();
  });

  window.orakloAuth?.onChange?.((auth) => {
    if (!auth.ready) return;
    const nextUserId = auth.user?.id || null;
    if (nextUserId === marketCommentsState.currentUserId) return;
    marketCommentsState.currentUserId = nextUserId;
    marketCommentsState.replyTo = null;
    marketCommentsState.editingId = null;
    reloadMarketComments();
  });

  await reloadMarketComments();
}

initializeMarketComments();
