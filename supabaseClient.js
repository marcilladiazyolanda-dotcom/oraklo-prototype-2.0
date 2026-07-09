const SUPABASE_URL = "https://fgrblufbuywxjahpymnh.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_t7BNtHlrectl4bIKE7_3cA_JxH1CGY_";

// Esta es una publishable key publica. La seguridad depende de las politicas RLS de Supabase.
// Nunca usar service_role ni claves secretas en frontend.
window.orakloSupabase = null;

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

function mapMarketFromSupabase(row) {
  const porcentajeSi = toNumber(row.yes_percent, 50);
  const porcentajeNo = toNumber(row.no_percent, 100 - porcentajeSi);

  return {
    id: row.id,
    pregunta: row.question,
    categoria: row.category,
    estado: normalizeStatus(row.status),
    porcentajeSi,
    porcentajeNo,
    dificultad: normalizeDifficulty(row.difficulty),
    karmaTotal: toNumber(row.karma_total),
    participantes: toNumber(row.participants_count),
    comentarios: toNumber(row.comments_count),
    cierre: row.close_label,
    cierreFecha: row.closes_at,
    descripcion: row.description,
    fuenteResolucion: row.resolution_source,
    criterioSi: row.yes_criteria,
    criterioNo: row.no_criteria,
    casoDudoso: row.edge_case,
    destacado: Boolean(row.highlighted),
    popularidad: toNumber(row.popularity),
    fechaCreacion: row.created_at
  };
}

window.mapMarketFromSupabase = mapMarketFromSupabase;
