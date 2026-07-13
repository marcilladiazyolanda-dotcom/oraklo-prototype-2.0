const adminResolutionRoot = document.querySelector("#admin-resolution-root");

const adminResolutionState = {
  markets: [],
  selectedMarket: null,
  analysisResponse: null,
  analyzing: false,
  approving: false,
  statusMessage: "",
  statusTone: "info"
};

let lastAdminAuthKey = "";

function escapeAdminHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSafeAdminUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch (_error) {
    return "";
  }
}

function formatAdminDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Fecha no disponible";

  return typeof window.formatOrakloLocalDate === "function"
    ? window.formatOrakloLocalDate(value)
    : new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function createAdminStatusMarkup() {
  if (!adminResolutionState.statusMessage) return "";

  return `
    <p class="admin-status-message admin-status-${escapeAdminHtml(adminResolutionState.statusTone)}">
      ${escapeAdminHtml(adminResolutionState.statusMessage)}
    </p>
  `;
}

async function readFunctionError(error, fallbackMessage) {
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const payload = await response.clone().json();
      if (payload?.message) return payload.message;
    } catch (_error) {
      // Keep the friendly fallback below.
    }
  }

  return fallbackMessage;
}

function renderAdminAccessRequired(message, canLogin = false) {
  adminResolutionRoot.innerHTML = `
    <article class="admin-access-card">
      <p class="eyebrow">Acceso protegido</p>
      <h2>${escapeAdminHtml(message)}</h2>
      <p>Esta pantalla puede investigar y confirmar resoluciones, por lo que está reservada a la administración de Oraklo.</p>
      ${canLogin ? '<button class="primary-button" type="button" data-auth-open>Iniciar sesión</button>' : '<a class="secondary-button" href="index.html">Volver a mercados</a>'}
    </article>
  `;
}

function getMarketStatusLabel(market) {
  return market.resolution_result ? `Resuelto · ${market.resolution_result}` : "Pendiente de resolución";
}

function renderAdminWorkspace() {
  const markets = adminResolutionState.markets;
  const selected = adminResolutionState.selectedMarket;

  if (!markets.length) {
    adminResolutionRoot.innerHTML = `
      ${createAdminStatusMarkup()}
      <article class="admin-access-card">
        <p class="eyebrow">Todo al día</p>
        <h2>No hay mercados cerrados para revisar</h2>
        <p>Los mercados aparecerán aquí cuando alcance su fecha real de cierre.</p>
      </article>
    `;
    return;
  }

  const marketOptions = markets.map((market) => `
    <option value="${escapeAdminHtml(market.id)}"${selected?.id === market.id ? " selected" : ""}>
      ${escapeAdminHtml(getMarketStatusLabel(market))} · ${escapeAdminHtml(market.question)}
    </option>
  `).join("");

  adminResolutionRoot.innerHTML = `
    ${createAdminStatusMarkup()}
    <div class="admin-resolution-layout">
      <section class="admin-market-panel">
        <p class="eyebrow">1 · Elegir mercado</p>
        <h2>Mercado para analizar</h2>
        <label class="admin-field" for="admin-market-select">
          <span>Mercado cerrado</span>
          <select id="admin-market-select">${marketOptions}</select>
        </label>
        ${selected ? createAdminMarketSummary(selected) : ""}
        <button class="primary-button admin-analyze-button" id="admin-analyze-market" type="button"${adminResolutionState.analyzing ? " disabled" : ""}>
          ${adminResolutionState.analyzing ? "Investigando fuentes..." : selected?.resolution_result ? "Auditar con IA" : "Analizar con IA"}
        </button>
        <p class="admin-action-help">El análisis no modifica el mercado ni los saldos.</p>
      </section>

      <section class="admin-analysis-panel" id="admin-analysis-panel">
        ${adminResolutionState.analysisResponse
          ? createAdminAnalysisMarkup(adminResolutionState.analysisResponse, selected)
          : createAdminAnalysisEmptyMarkup()}
      </section>
    </div>
  `;

  bindAdminWorkspaceEvents();
}

function createAdminMarketSummary(market) {
  return `
    <dl class="admin-market-summary">
      <div><dt>Cierre</dt><dd>${escapeAdminHtml(formatAdminDate(market.closes_at))}</dd></div>
      <div><dt>Criterio de Sí</dt><dd>${escapeAdminHtml(market.yes_criteria || "No indicado")}</dd></div>
      <div><dt>Criterio de No</dt><dd>${escapeAdminHtml(market.no_criteria || "No indicado")}</dd></div>
      <div><dt>Caso dudoso</dt><dd>${escapeAdminHtml(market.edge_case || "No indicado")}</dd></div>
      <div><dt>Fuente prevista</dt><dd>${escapeAdminHtml(market.resolution_source || "No indicada")}</dd></div>
    </dl>
  `;
}

function createAdminAnalysisEmptyMarkup() {
  return `
    <div class="admin-analysis-empty">
      <p class="eyebrow">2 · Investigar</p>
      <h2>Esperando análisis</h2>
      <p>Gemini buscará información actual, aplicará la fecha de cierre y devolverá motivos con enlaces verificables.</p>
    </div>
  `;
}

function createAdminAnalysisMarkup(response, market) {
  const analysis = response.analysis || {};
  const sources = Array.isArray(response.sources) ? response.sources : [];
  const reasons = Array.isArray(analysis.reasons) ? analysis.reasons : [];
  const caveats = Array.isArray(analysis.caveats) ? analysis.caveats : [];
  const proposedResult = ["Sí", "No", "Anulado"].includes(analysis.proposed_result)
    ? analysis.proposed_result
    : "";
  const isAlreadyResolved = Boolean(market?.resolution_result);

  const reasonItems = reasons.length
    ? reasons.map((reason) => `<li>${escapeAdminHtml(reason)}</li>`).join("")
    : "<li>La IA no ha devuelto motivos estructurados.</li>";
  const caveatMarkup = caveats.length
    ? `<div class="admin-caveats"><h3>Dudas que debes revisar</h3><ul>${caveats.map((item) => `<li>${escapeAdminHtml(item)}</li>`).join("")}</ul></div>`
    : "";
  const sourceMarkup = sources.length
    ? sources.map((source, index) => createAdminSourceMarkup(source, index, isAlreadyResolved)).join("")
    : '<p class="admin-no-sources">No se recibieron fuentes verificables. No resuelvas el mercado.</p>';

  return `
    <div class="admin-analysis-result">
      <p class="eyebrow">2 · Propuesta de la IA</p>
      <div class="admin-proposal-heading">
        <div>
          <span>Resultado propuesto</span>
          <strong>${escapeAdminHtml(analysis.proposed_result || "No concluyente")}</strong>
        </div>
        <span class="admin-confidence">Confianza: ${escapeAdminHtml(analysis.confidence || "Baja")}</span>
      </div>
      <p class="admin-analysis-summary">${escapeAdminHtml(analysis.summary || "Sin resumen disponible.")}</p>

      <div class="admin-reasons">
        <h3>Motivos</h3>
        <ul>${reasonItems}</ul>
      </div>

      <div class="admin-cutoff-check">
        <h3>Comprobación de la fecha límite</h3>
        <p>${escapeAdminHtml(analysis.cutoff_analysis || "No se ha podido comprobar automáticamente.")}</p>
      </div>

      ${caveatMarkup}

      <div class="admin-sources-section">
        <h3>Fuentes encontradas</h3>
        <p>Abre cada enlace y comprueba que la publicación y el hecho sean anteriores al cierre.</p>
        <div class="admin-source-list">${sourceMarkup}</div>
      </div>

      ${isAlreadyResolved
        ? '<div class="admin-audit-notice"><strong>Mercado ya resuelto.</strong><p>Este análisis es únicamente una auditoría y no permite volver a repartir Karma.</p></div>'
        : createAdminApprovalMarkup(response, proposedResult, sources.length)}
    </div>
  `;
}

function createAdminSourceMarkup(source, index, isReadOnly) {
  const url = getSafeAdminUrl(source.url);
  if (!url) return "";
  const citedText = source.cited_text
    ? `<p>${escapeAdminHtml(source.cited_text)}</p>`
    : "";

  return `
    <article class="admin-source-card">
      ${isReadOnly ? "" : `<label class="admin-source-check"><input type="checkbox" data-admin-source-index="${index}" checked> Usar esta fuente</label>`}
      <a href="${escapeAdminHtml(url)}" target="_blank" rel="noopener noreferrer">
        ${escapeAdminHtml(source.title || "Consultar fuente")} <span aria-hidden="true">↗</span>
      </a>
      ${citedText}
    </article>
  `;
}

function createAdminApprovalMarkup(response, proposedResult, sourceCount) {
  const note = response.analysis?.recommended_note || response.analysis?.summary || "";
  return `
    <form class="admin-approval-form" id="admin-approval-form">
      <p class="eyebrow">3 · Aprobación humana</p>
      <h3>Decisión final</h3>
      <label class="admin-field" for="admin-resolution-result">
        <span>Resultado oficial</span>
        <select id="admin-resolution-result" required>
          <option value="">Selecciona después de revisar</option>
          <option value="Sí"${proposedResult === "Sí" ? " selected" : ""}>Sí</option>
          <option value="No"${proposedResult === "No" ? " selected" : ""}>No</option>
          <option value="Anulado"${proposedResult === "Anulado" ? " selected" : ""}>Anulado</option>
        </select>
      </label>

      <label class="admin-field" for="admin-resolution-note">
        <span>Explicación que verán los usuarios</span>
        <textarea id="admin-resolution-note" minlength="10" maxlength="4000" required>${escapeAdminHtml(note)}</textarea>
      </label>

      <label class="admin-human-check">
        <input id="admin-human-reviewed" type="checkbox" required>
        <span>He abierto las fuentes, comprobado sus fechas y aplicado personalmente los criterios del mercado.</span>
      </label>

      <button class="danger-button admin-resolve-button" type="submit"${!sourceCount || adminResolutionState.approving ? " disabled" : ""}>
        ${adminResolutionState.approving ? "Resolviendo mercado..." : "Confirmar resolución y repartir Karma"}
      </button>
      <p class="admin-final-warning">Esta acción es irreversible: liquidará todas las predicciones activas del mercado.</p>
    </form>
  `;
}

function bindAdminWorkspaceEvents() {
  document.querySelector("#admin-market-select")?.addEventListener("change", (event) => {
    adminResolutionState.selectedMarket = adminResolutionState.markets.find(
      (market) => market.id === event.target.value
    ) || null;
    adminResolutionState.analysisResponse = null;
    adminResolutionState.statusMessage = "";
    renderAdminWorkspace();
  });

  document.querySelector("#admin-analyze-market")?.addEventListener("click", analyzeSelectedMarket);
  document.querySelector("#admin-approval-form")?.addEventListener("submit", approveSelectedResolution);
}

async function analyzeSelectedMarket() {
  const market = adminResolutionState.selectedMarket;
  if (!market || adminResolutionState.analyzing) return;

  adminResolutionState.analyzing = true;
  adminResolutionState.analysisResponse = null;
  adminResolutionState.statusMessage = "";
  renderAdminWorkspace();

  try {
    const { data, error } = await window.orakloSupabase.functions.invoke(
      "analyze-market-resolution",
      { body: { market_id: market.id } }
    );

    if (error) {
      throw new Error(await readFunctionError(error, "La IA no ha podido analizar este mercado."));
    }

    if (!data?.ok) {
      throw new Error(data?.message || "La IA no ha podido analizar este mercado.");
    }

    adminResolutionState.analysisResponse = data;
  } catch (error) {
    adminResolutionState.statusMessage = error.message || "La IA no ha podido analizar este mercado.";
    adminResolutionState.statusTone = "error";
  } finally {
    adminResolutionState.analyzing = false;
    renderAdminWorkspace();
  }
}

async function approveSelectedResolution(event) {
  event.preventDefault();
  if (adminResolutionState.approving) return;

  const market = adminResolutionState.selectedMarket;
  const response = adminResolutionState.analysisResponse;
  const result = document.querySelector("#admin-resolution-result")?.value || "";
  const note = document.querySelector("#admin-resolution-note")?.value.trim() || "";
  const humanReviewed = document.querySelector("#admin-human-reviewed")?.checked;
  const selectedSources = Array.from(document.querySelectorAll("[data-admin-source-index]:checked"))
    .map((input) => response.sources[Number(input.dataset.adminSourceIndex)])
    .filter(Boolean);

  if (!market || !response || !result || !humanReviewed || !selectedSources.length) {
    window.alert("Selecciona el resultado, revisa al menos una fuente y confirma la revisión humana.");
    return;
  }

  const confirmed = window.confirm(
    `Vas a resolver “${market.question}” como ${result}. Se repartirán Karma y Prestigio de forma inmediata. ¿Confirmas la resolución?`
  );
  if (!confirmed) return;

  adminResolutionState.approving = true;
  adminResolutionState.statusMessage = "";
  renderAdminWorkspace();

  try {
    const { data, error } = await window.orakloSupabase.functions.invoke(
      "approve-market-resolution",
      {
        body: {
          market_id: market.id,
          result,
          resolution_note: note,
          sources: selectedSources,
          ai_model: response.model,
          ai_generated_at: response.generated_at
        }
      }
    );

    if (error) {
      throw new Error(await readFunctionError(error, "No se ha podido resolver el mercado."));
    }

    if (!data?.ok) {
      throw new Error(data?.message || "No se ha podido resolver el mercado.");
    }

    const resolution = Array.isArray(data.resolution) ? data.resolution[0] : data.resolution;
    await window.refreshOrakloProfile?.();
    adminResolutionState.analysisResponse = null;
    adminResolutionState.statusMessage = `Mercado resuelto correctamente: ${resolution?.winners ?? 0} aciertos, ${resolution?.losers ?? 0} fallos y ${resolution?.total_karma_awarded ?? 0} Karma abonado.`;
    adminResolutionState.statusTone = "success";
    await loadAdminMarkets();
  } catch (error) {
    adminResolutionState.statusMessage = error.message || "No se ha podido resolver el mercado.";
    adminResolutionState.statusTone = "error";
  } finally {
    adminResolutionState.approving = false;
    renderAdminWorkspace();
  }
}

async function loadAdminMarkets() {
  const { data, error } = await window.orakloSupabase.rpc("get_public_markets");
  if (error) throw error;

  adminResolutionState.markets = (Array.isArray(data) ? data : [])
    .filter((market) => {
      const status = String(market.status || "").toLowerCase();
      return status === "cerrado" || status === "closed" || status === "resuelto" || status === "resolved";
    })
    .sort((a, b) => {
      if (Boolean(a.resolution_result) !== Boolean(b.resolution_result)) {
        return a.resolution_result ? 1 : -1;
      }
      return new Date(b.closes_at || 0) - new Date(a.closes_at || 0);
    });

  const currentId = adminResolutionState.selectedMarket?.id;
  adminResolutionState.selectedMarket = adminResolutionState.markets.find(
    (market) => market.id === currentId
  ) || adminResolutionState.markets[0] || null;
  renderAdminWorkspace();
}

async function initializeAdminResolution(authState) {
  if (!authState.isAuthenticated) {
    renderAdminAccessRequired("Inicia sesión con la cuenta administradora.", true);
    return;
  }

  try {
    const { data, error } = await window.orakloSupabase.auth.getUser();
    if (error || data.user?.app_metadata?.oraklo_admin !== true) {
      renderAdminAccessRequired("Tu cuenta no tiene permiso de administración.");
      return;
    }

    await loadAdminMarkets();
  } catch (_error) {
    adminResolutionRoot.innerHTML = `
      <article class="admin-access-card">
        <p class="eyebrow">Error de conexión</p>
        <h2>No se ha podido cargar la administración</h2>
        <p>Recarga la página para volver a intentarlo.</p>
      </article>
    `;
  }
}

window.orakloAuth.onChange((state) => {
  if (!state.ready) return;

  const authKey = `${state.user?.id || "guest"}:${state.isAdmin ? "admin" : "standard"}`;
  if (authKey === lastAdminAuthKey) return;
  lastAdminAuthKey = authKey;
  initializeAdminResolution(state);
});
