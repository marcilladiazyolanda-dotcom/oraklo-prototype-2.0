const SUPABASE_URL = "https://fgrblufbuywxjahpymnh.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_t7BNtHlrectl4bIKE7_3cA_JxH1CGY_";

// Esta es una publishable key publica. La seguridad depende de las politicas RLS de Supabase.
// Nunca usar service_role ni claves secretas en frontend.
window.orakloSupabase = null;

const ORAKLO_LOCAL_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const supabaseFactory = window.supabase || globalThis.supabase;

if (supabaseFactory && typeof supabaseFactory.createClient === "function") {
  window.orakloSupabase = supabaseFactory.createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
}

function normalizeStatus(status) {
  const statusLabels = {
    active: "Abierto",
    open: "Abierto",
    opened: "Abierto",
    abierto: "Abierto",
    closed: "Cerrado",
    cerrado: "Cerrado",
    resolved: "Resuelto",
    resuelto: "Resuelto"
  };

  const key = String(status || "").trim().toLowerCase();
  return statusLabels[key] || status || "Abierto";
}

function normalizeDifficulty(difficulty) {
  const difficultyLabels = {
    facil: "Fácil",
    "fácil": "Fácil",
    normal: "Normal",
    dificil: "Difícil",
    "difícil": "Difícil",
    "muy dificil": "Muy difícil",
    "muy difícil": "Muy difícil",
    epica: "Épica",
    "épica": "Épica"
  };

  const key = String(difficulty || "").trim().toLowerCase();
  return difficultyLabels[key] || difficulty || "Normal";
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeResolutionSources(value) {
  let sources = value;

  if (typeof sources === "string") {
    try {
      sources = JSON.parse(sources);
    } catch (_error) {
      sources = [];
    }
  }

  if (!Array.isArray(sources)) return [];

  return sources
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      title: String(source.title || "Fuente de resolución").trim(),
      url: String(source.url || "").trim(),
      citedText: String(source.cited_text || source.citedText || "").trim()
    }))
    .filter((source) => source.url);
}

function getValidTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatOrakloLocalDate(value) {
  const timestamp = getValidTimestamp(value);
  if (timestamp === null) return "Fecha no disponible";

  return ORAKLO_LOCAL_DATE_FORMATTER.format(new Date(timestamp));
}

function formatOrakloExactDate(value) {
  const timestamp = getValidTimestamp(value);
  return timestamp === null ? "" : `Fecha exacta: ${formatOrakloLocalDate(timestamp)}`;
}

function getOrakloEffectiveMarketStatus(market, now = Date.now()) {
  const storedStatus = normalizeStatus(market?.estado || market?.status);
  const resolutionResult = market?.resultadoResolucion || market?.resolution_result;

  if (resolutionResult || storedStatus === "Resuelto") {
    return "Resuelto";
  }

  const closeTimestamp = getValidTimestamp(market?.cierreFecha || market?.closes_at);
  if (storedStatus === "Abierto" && closeTimestamp !== null && closeTimestamp <= now) {
    return "Cerrado";
  }

  return storedStatus;
}

function getOrakloMarketTiming(market, now = Date.now()) {
  const closeTimestamp = getValidTimestamp(market?.cierreFecha || market?.closes_at);
  const effectiveStatus = getOrakloEffectiveMarketStatus(market, now);
  const resolutionResult = market?.resultadoResolucion || market?.resolution_result || "";
  const fallbackLabel = market?.cierre || market?.close_label || "Sin fecha de cierre";
  const hasCloseDate = closeTimestamp !== null;
  const remainingMs = hasCloseDate ? closeTimestamp - now : null;
  let label = fallbackLabel;

  if (effectiveStatus === "Resuelto") {
    label = resolutionResult ? `Resuelto: ${resolutionResult}` : "Resuelto";
  } else if (effectiveStatus === "Cerrado") {
    label = "Cerrado · pendiente de resolución";
  } else if (!hasCloseDate) {
    label = fallbackLabel;
  } else if (remainingMs >= 48 * 60 * 60 * 1000) {
    const days = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    label = `Cierra en ${days} ${days === 1 ? "día" : "días"}`;
  } else if (remainingMs >= 60 * 60 * 1000) {
    label = `Cierra en ${Math.ceil(remainingMs / (60 * 60 * 1000))} h`;
  } else if (remainingMs >= 60 * 1000) {
    label = `Cierra en ${Math.ceil(remainingMs / (60 * 1000))} min`;
  } else {
    label = `Cierra en ${Math.max(1, Math.ceil(remainingMs / 1000))} s`;
  }

  return {
    effectiveStatus,
    label,
    exactLabel: hasCloseDate ? formatOrakloExactDate(closeTimestamp) : "",
    closeTimestamp,
    remainingMs,
    hasCloseDate,
    isOpen: effectiveStatus === "Abierto",
    isClosed: effectiveStatus === "Cerrado",
    isResolved: effectiveStatus === "Resuelto",
    hasExpired: hasCloseDate && closeTimestamp <= now
  };
}

function mapMarketFromSupabase(row) {
  const actualPredictionsCount = toNumber(row.actual_predictions_count, toNumber(row.participants_count));
  const hasRealPredictions = actualPredictionsCount > 0;
  const porcentajeSi = hasRealPredictions ? toNumber(row.yes_percent, 50) : 50;
  const porcentajeNo = hasRealPredictions ? toNumber(row.no_percent, 100 - porcentajeSi) : 50;

  return {
    id: row.id,
    pregunta: row.question,
    categoria: row.category,
    estado: normalizeStatus(row.status),
    porcentajeSi,
    porcentajeNo,
    dificultad: normalizeDifficulty(row.difficulty),
    karmaTotal: hasRealPredictions ? toNumber(row.karma_total) : 0,
    participantes: hasRealPredictions ? toNumber(row.participants_count) : 0,
    comentarios: toNumber(row.comments_count),
    cierre: row.close_label,
    cierreFecha: row.closes_at,
    resultadoResolucion: row.resolution_result,
    notaResolucion: row.resolution_note,
    fechaResolucion: row.resolved_at,
    fuentesResolucion: normalizeResolutionSources(row.resolution_sources),
    modeloResolucionIa: row.resolution_ai_model || "",
    fechaAnalisisIa: row.resolution_ai_generated_at || null,
    descripcion: row.description,
    fuenteResolucion: row.resolution_source,
    criterioSi: row.yes_criteria,
    criterioNo: row.no_criteria,
    casoDudoso: row.edge_case,
    destacado: Boolean(row.highlighted),
    popularidad: toNumber(row.popularity),
    fechaCreacion: row.created_at,
    prediccionesReales: actualPredictionsCount,
    conteoSi: toNumber(row.actual_yes_count),
    conteoNo: toNumber(row.actual_no_count),
    tienePredicciones: hasRealPredictions
  };
}

window.mapMarketFromSupabase = mapMarketFromSupabase;
window.normalizeOrakloResolutionSources = normalizeResolutionSources;
window.getOrakloEffectiveMarketStatus = getOrakloEffectiveMarketStatus;
window.getOrakloMarketTiming = getOrakloMarketTiming;
window.formatOrakloLocalDate = formatOrakloLocalDate;
window.formatOrakloExactDate = formatOrakloExactDate;
