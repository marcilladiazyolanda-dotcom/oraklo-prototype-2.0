const socialClient = window.orakloSupabase;

const SOCIAL_AVATAR_MARKS = {
  oracle: "◇",
  spark: "✦",
  hex: "⬡",
  pulse: "◉",
  delta: "△"
};

const SOCIAL_REPORT_REASONS = [
  { value: "spam", label: "Spam o contenido repetitivo" },
  { value: "harassment", label: "Acoso o ataque personal" },
  { value: "hate", label: "Odio o discriminación" },
  { value: "illegal", label: "Contenido ilegal o peligroso" },
  { value: "impersonation", label: "Suplantación de identidad" },
  { value: "other", label: "Otro motivo" }
];

const socialReportState = {
  targetType: null,
  targetId: null,
  targetLabel: "",
  trigger: null,
  submitting: false
};

function escapeSocialHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeSocialRow(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function formatSocialNumber(value) {
  return new Intl.NumberFormat("es-ES").format(Number(value) || 0);
}

function formatSocialDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Fecha no disponible";

  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatSocialRelativeDate(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Fecha no disponible";

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat("es-ES", { numeric: "auto" });

  if (absoluteSeconds < 60) return formatter.format(seconds, "second");
  if (absoluteSeconds < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (absoluteSeconds < 604800) return formatter.format(Math.round(seconds / 86400), "day");
  return formatSocialDate(value);
}

function createSocialAvatarMarkup(profile, className = "social-avatar") {
  const avatarKey = profile?.avatar_key || "oracle";
  const theme = profile?.profile_theme || "aurora";
  const mark = SOCIAL_AVATAR_MARKS[avatarKey] || SOCIAL_AVATAR_MARKS.oracle;
  const username = profile?.username || "Cuenta eliminada";

  return `
    <span class="${escapeSocialHtml(className)} social-avatar-theme-${escapeSocialHtml(theme)}" aria-hidden="true">
      ${escapeSocialHtml(mark)}
    </span>
    <span class="sr-only">Avatar de ${escapeSocialHtml(username)}</span>
  `;
}

function getSocialErrorKey(error) {
  return `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`.toUpperCase();
}

function getSocialErrorMessage(error, fallback = "No se ha podido completar la acción. Inténtalo de nuevo.") {
  const details = getSocialErrorKey(error);

  if (details.includes("PGRST202") || details.includes("SCHEMA CACHE") || details.includes("FUNCTION PUBLIC.")) {
    return "Las funciones sociales todavía no están activadas en Supabase. Aplica la migración del Paso 11 y recarga la página.";
  }
  if (details.includes("AUTH_REQUIRED") || details.includes("28000")) {
    return "Inicia sesión para participar en la comunidad.";
  }
  if (details.includes("ADMIN_REQUIRED")) {
    return "Tu cuenta no tiene permiso para realizar esta acción.";
  }
  if (details.includes("COMMUNITY_RESTRICTED")) {
    return "Tu participación social está restringida temporalmente. Puedes seguir leyendo, dejar de seguir, silenciar o borrar contenido propio.";
  }
  if (details.includes("COMMENT_RATE_LIMIT")) {
    return "Has publicado varios mensajes seguidos. Espera un minuto antes de volver a comentar.";
  }
  if (details.includes("REPORT_ALREADY_OPEN")) {
    return "Ya has enviado un reporte pendiente sobre este contenido.";
  }
  if (details.includes("REPORT_RATE_LIMIT")) {
    return "Has enviado varios reportes en poco tiempo. Espera una hora antes de volver a reportar.";
  }
  if (details.includes("DUPLICATE_COMMENT")) {
    return "Ese contenido ya se ha enviado. Espera unos segundos antes de repetirlo.";
  }
  if (details.includes("INVALID_COMMENT_LENGTH")) {
    return "El comentario debe tener entre 1 y 500 caracteres.";
  }
  if (details.includes("INVALID_COMMENT_PARENT")) {
    return "Ya no se puede responder a ese comentario. Actualiza el debate e inténtalo de nuevo.";
  }
  if (details.includes("COMMENT_NOT_EDITABLE") || details.includes("COMMENT_NOT_OWNED")) {
    return "Solo puedes modificar tus propios comentarios visibles.";
  }
  if (details.includes("PROFILE_IS_MUTED")) {
    return "Primero deja de silenciar este perfil para poder seguirlo.";
  }
  if (details.includes("CANNOT_FOLLOW_SELF") || details.includes("CANNOT_MUTE_SELF")) {
    return "Esta acción no está disponible en tu propio perfil.";
  }
  if (details.includes("CANNOT_REACT_TO_OWN_CONTENT")) {
    return "“Buena lectura” está reservada para el contenido de otras personas.";
  }
  if (details.includes("CANNOT_REPORT_OWN_CONTENT")) {
    return "No puedes reportar tu propio contenido.";
  }
  if (details.includes("REPORT_ALREADY_REVIEWED")) {
    return "Otra revisión ya ha resuelto este reporte. Actualiza la cola.";
  }
  if (details.includes("COMMENT_NOT_ACTIONABLE")) {
    return "El comentario ya no está visible y no puede volver a ocultarse.";
  }
  if (details.includes("PROFILE_CANNOT_BE_HIDDEN")) {
    return "Los perfiles no se ocultan en este MVP. Puedes descartar el reporte o aplicar una restricción social.";
  }
  if (details.includes("ADMIN_CANNOT_BE_RESTRICTED")) {
    return "No se puede restringir una cuenta administrativa desde esta cola.";
  }
  if (details.includes("NOT_FOUND") || details.includes("P0002")) {
    return "El contenido ya no está disponible. Actualiza la página.";
  }

  return fallback;
}

async function socialRpc(functionName, params = {}) {
  if (!socialClient) throw new Error("SUPABASE_UNAVAILABLE");
  const { data, error } = await socialClient.rpc(functionName, params);
  if (error) throw error;
  return data;
}

async function requireSocialAuth(message = "Inicia sesión para participar en la comunidad.") {
  if (!window.orakloAuth) return null;
  return window.orakloAuth.requireAuth({ message });
}

async function setSocialReaction(targetType, targetId, active) {
  const auth = await requireSocialAuth("Inicia sesión para marcar una buena lectura.");
  if (!auth) return null;

  return normalizeSocialRow(await socialRpc("set_community_reaction", {
    target_type_input: targetType,
    target_id_input: targetId,
    active_input: Boolean(active)
  }));
}

function setSocialStatus(node, message, tone = "info") {
  if (!node) return;
  node.textContent = message || "";
  node.className = `social-status social-status-${tone}`;
  node.hidden = !message;
}

function injectSocialReportModal() {
  if (document.querySelector("#social-report-modal")) return;

  const wrapper = document.createElement("div");
  wrapper.id = "social-report-modal";
  wrapper.className = "modal-backdrop social-report-backdrop";
  wrapper.hidden = true;
  wrapper.innerHTML = `
    <section class="modal social-report-modal" role="dialog" aria-modal="true" aria-labelledby="social-report-title" aria-describedby="social-report-help">
      <button class="modal-close" type="button" data-social-report-close aria-label="Cerrar reporte">×</button>
      <p class="eyebrow">Seguridad de la comunidad</p>
      <h2 id="social-report-title">Enviar reporte</h2>
      <p id="social-report-help">El reporte es privado y será revisado por una persona administradora.</p>
      <p class="social-report-target" id="social-report-target"></p>
      <form id="social-report-form" class="social-report-form">
        <label>
          <span>Motivo</span>
          <select id="social-report-reason" required>
            ${SOCIAL_REPORT_REASONS.map((reason) => `
              <option value="${reason.value}">${escapeSocialHtml(reason.label)}</option>
            `).join("")}
          </select>
        </label>
        <label>
          <span>Contexto adicional <small>(opcional)</small></span>
          <textarea id="social-report-detail" maxlength="1000" rows="4" placeholder="Explica qué debería revisar moderación..."></textarea>
        </label>
        <p class="social-status" id="social-report-status" aria-live="polite" hidden></p>
        <div class="social-report-actions">
          <button class="secondary-button" type="button" data-social-report-close>Cancelar</button>
          <button class="danger-button" id="social-report-submit" type="submit">Enviar reporte</button>
        </div>
      </form>
    </section>
  `;

  document.body.appendChild(wrapper);
  wrapper.querySelector("#social-report-form")?.addEventListener("submit", handleSocialReportSubmit);
  wrapper.addEventListener("click", (event) => {
    if (event.target === wrapper || event.target.closest("[data-social-report-close]")) {
      closeSocialReportModal();
    }
  });
}

async function openSocialReportModal({ targetType, targetId, targetLabel = "", trigger = null }) {
  const auth = await requireSocialAuth("Inicia sesión para enviar un reporte privado.");
  if (!auth) return false;

  injectSocialReportModal();
  socialReportState.targetType = targetType;
  socialReportState.targetId = targetId;
  socialReportState.targetLabel = targetLabel;
  socialReportState.trigger = trigger || document.activeElement;

  const modal = document.querySelector("#social-report-modal");
  const target = document.querySelector("#social-report-target");
  const form = document.querySelector("#social-report-form");
  if (form) form.reset();
  if (target) target.textContent = targetLabel ? `Contenido: ${targetLabel}` : "";
  setSocialStatus(document.querySelector("#social-report-status"), "");
  modal.hidden = false;
  document.body.classList.add("has-open-modal");
  document.querySelector("#social-report-reason")?.focus();
  return true;
}

function closeSocialReportModal() {
  const modal = document.querySelector("#social-report-modal");
  if (!modal || modal.hidden || socialReportState.submitting) return;
  modal.hidden = true;
  document.body.classList.remove("has-open-modal");
  socialReportState.trigger?.focus?.({ preventScroll: true });
}

async function handleSocialReportSubmit(event) {
  event.preventDefault();
  if (socialReportState.submitting) return;

  const submit = document.querySelector("#social-report-submit");
  const status = document.querySelector("#social-report-status");
  const reason = document.querySelector("#social-report-reason")?.value;
  const detail = document.querySelector("#social-report-detail")?.value.trim() || null;
  socialReportState.submitting = true;
  submit.disabled = true;
  setSocialStatus(status, "Enviando reporte...", "info");

  try {
    const result = normalizeSocialRow(await socialRpc("create_community_report", {
      target_type_input: socialReportState.targetType,
      target_id_input: socialReportState.targetId,
      reason_input: reason,
      detail_input: detail
    }));

    setSocialStatus(status, "Reporte enviado. Moderación lo revisará de forma privada.", "success");
    window.dispatchEvent(new CustomEvent("oraklo:social-report-created", {
      detail: {
        ...result,
        targetType: socialReportState.targetType,
        targetId: socialReportState.targetId
      }
    }));
    window.setTimeout(() => {
      socialReportState.submitting = false;
      submit.disabled = false;
      closeSocialReportModal();
    }, 900);
  } catch (error) {
    setSocialStatus(status, getSocialErrorMessage(error), "error");
    socialReportState.submitting = false;
    submit.disabled = false;
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeSocialReportModal();
});

window.orakloSocial = {
  client: socialClient,
  escapeHtml: escapeSocialHtml,
  normalizeRow: normalizeSocialRow,
  formatNumber: formatSocialNumber,
  formatDate: formatSocialDate,
  formatRelativeDate: formatSocialRelativeDate,
  createAvatarMarkup: createSocialAvatarMarkup,
  getErrorMessage: getSocialErrorMessage,
  rpc: socialRpc,
  requireAuth: requireSocialAuth,
  setReaction: setSocialReaction,
  setStatus: setSocialStatus,
  openReport: openSocialReportModal,
  closeReport: closeSocialReportModal
};
