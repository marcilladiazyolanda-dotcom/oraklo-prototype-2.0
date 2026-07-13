import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_MODEL = "gemini-2.5-flash";
const MAX_REQUEST_BYTES = 8_192;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getPublishableKey(): string {
  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");

  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy variable while the project finishes migrating keys.
    }
  }

  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMarket(payload: unknown): JsonRecord | null {
  if (Array.isArray(payload)) {
    return isRecord(payload[0]) ? payload[0] : null;
  }

  return isRecord(payload) ? payload : null;
}

function isMarketClosed(market: JsonRecord): boolean {
  const status = getText(market.status).toLowerCase();
  const closesAt = Date.parse(getText(market.closes_at));
  const hasPassedCutoff = Number.isFinite(closesAt) && closesAt <= Date.now();

  return hasPassedCutoff &&
    ["cerrado", "closed", "resuelto", "resolved"].includes(status);
}

function buildPrompt(market: JsonRecord): string {
  const marketEvidence = {
    id: getText(market.id),
    question: getText(market.question),
    description: getText(market.description),
    closes_at: getText(market.closes_at),
    resolution_source: getText(market.resolution_source),
    yes_criteria: getText(market.yes_criteria),
    no_criteria: getText(market.no_criteria),
    edge_case: getText(market.edge_case),
  };

  return `Eres el analista de evidencia de Oraklo, un prototipo de mercados de prediccion sin dinero real.

Tu trabajo es proponer una resolucion, nunca ejecutarla. Una persona administradora revisara tu propuesta antes de repartir Karma o Prestigio.

REGLAS OBLIGATORIAS:
1. Aplica literalmente los criterios de Si, No y caso dudoso del mercado.
2. Busca en la web y prioriza fuentes primarias y oficiales. Usa prensa reputada solo como apoyo.
3. Solo puedes usar hechos publicados o sucedidos como maximo en la fecha closes_at. Ignora informacion posterior, aunque hoy la conozcas.
4. Rumores, filtraciones, redes no oficiales y predicciones no son prueba suficiente.
5. No inventes fechas, cifras, citas ni URLs.
6. Si la evidencia no basta, hay contradicciones importantes o el mercado esta mal definido, responde "No concluyente". Usa "Anulado" solo si el caso dudoso o la imposibilidad objetiva impiden aplicar Si/No.
7. La ausencia de un anuncio solo permite resolver No cuando el criterio de No lo indique expresamente y haya vencido el cierre.
8. Explica el razonamiento en espanol claro y breve.

Devuelve exclusivamente un objeto JSON valido, sin Markdown, con esta forma:
{
  "proposed_result": "Si | No | Anulado | No concluyente",
  "confidence": "Alta | Media | Baja",
  "summary": "explicacion breve para el usuario",
  "reasons": ["motivo verificable 1", "motivo verificable 2"],
  "cutoff_analysis": "por que las pruebas son validas antes del cierre",
  "caveats": ["duda o limitacion, si existe"],
  "recommended_note": "texto final que podria guardarse tras la aprobacion humana",
  "source_dates": [
    {"title": "titulo de la fuente", "published_at": "YYYY-MM-DD o desconocida", "relevance": "que demuestra"}
  ]
}

MERCADO:
${JSON.stringify(marketEvidence, null, 2)}`;
}

function parseJsonObject(text: string): JsonRecord | null {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeProposedResult(value: unknown): string {
  const normalized = getText(value).toLowerCase();
  const results: Record<string, string> = {
    si: "Sí",
    "sí": "Sí",
    yes: "Sí",
    no: "No",
    anulado: "Anulado",
    void: "Anulado",
    "no concluyente": "No concluyente",
    inconclusive: "No concluyente",
  };

  return results[normalized] ?? "No concluyente";
}

function normalizeAnalysis(
  parsed: JsonRecord | null,
  rawText: string,
): JsonRecord {
  if (!parsed) {
    return {
      proposed_result: "No concluyente",
      confidence: "Baja",
      summary: rawText || "La IA no ha devuelto un analisis estructurado.",
      reasons: [],
      cutoff_analysis: "Requiere revision humana.",
      caveats: [
        "No se pudo interpretar de forma segura la respuesta de la IA.",
      ],
      recommended_note: "",
      source_dates: [],
    };
  }

  return {
    proposed_result: normalizeProposedResult(parsed.proposed_result),
    confidence: ["Alta", "Media", "Baja"].includes(getText(parsed.confidence))
      ? getText(parsed.confidence)
      : "Baja",
    summary: getText(parsed.summary),
    reasons: Array.isArray(parsed.reasons)
      ? parsed.reasons.map(getText).filter(Boolean).slice(0, 6)
      : [],
    cutoff_analysis: getText(parsed.cutoff_analysis),
    caveats: Array.isArray(parsed.caveats)
      ? parsed.caveats.map(getText).filter(Boolean).slice(0, 6)
      : [],
    recommended_note: getText(parsed.recommended_note),
    source_dates: Array.isArray(parsed.source_dates)
      ? parsed.source_dates.filter(isRecord).slice(0, 10)
      : [],
  };
}

function extractGeminiOutput(payload: JsonRecord): {
  text: string;
  sources: JsonRecord[];
  searchQueries: string[];
} {
  const textParts: string[] = [];
  const searchQueries = new Set<string>();
  const sources = new Map<string, JsonRecord>();
  const steps = Array.isArray(payload.steps) ? payload.steps : [];

  for (const stepValue of steps) {
    if (!isRecord(stepValue)) continue;

    if (
      stepValue.type === "google_search_call" && isRecord(stepValue.arguments)
    ) {
      const queries = Array.isArray(stepValue.arguments.queries)
        ? stepValue.arguments.queries
        : [];
      queries.map(getText).filter(Boolean).forEach((query) =>
        searchQueries.add(query)
      );
    }

    if (stepValue.type !== "model_output") continue;
    const blocks = Array.isArray(stepValue.content) ? stepValue.content : [];

    for (const blockValue of blocks) {
      if (!isRecord(blockValue) || blockValue.type !== "text") continue;
      const blockText = getText(blockValue.text);
      if (blockText) textParts.push(blockText);

      const annotations = Array.isArray(blockValue.annotations)
        ? blockValue.annotations
        : [];
      for (const annotationValue of annotations) {
        if (
          !isRecord(annotationValue) || annotationValue.type !== "url_citation"
        ) continue;
        const url = getText(annotationValue.url);
        if (!/^https?:\/\//i.test(url)) continue;

        const start = Number(
          annotationValue.start_index ?? annotationValue.startIndex,
        );
        const end = Number(
          annotationValue.end_index ?? annotationValue.endIndex,
        );
        const citedText =
          Number.isInteger(start) && Number.isInteger(end) && end > start
            ? blockText.slice(start, end)
            : "";

        if (!sources.has(url)) {
          sources.set(url, {
            title: getText(annotationValue.title) || new URL(url).hostname,
            url,
            cited_text: citedText,
          });
        }
      }
    }
  }

  // Compatibility fallback in case the API also provides a convenience output field.
  if (!textParts.length && typeof payload.output_text === "string") {
    textParts.push(payload.output_text);
  }

  return {
    text: textParts.join("\n").trim(),
    sources: [...sources.values()].slice(0, 12),
    searchQueries: [...searchQueries].slice(0, 12),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({
      error: "METHOD_NOT_ALLOWED",
      message: "Usa una peticion POST.",
    }, 405);
  }

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({
      error: "REQUEST_TOO_LARGE",
      message: "La peticion es demasiado grande.",
    }, 413);
  }

  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse({
      error: "AUTH_REQUIRED",
      message: "Inicia sesion para continuar.",
    }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = getPublishableKey();
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY") ?? "";

  if (!supabaseUrl || !publishableKey || !geminiApiKey) {
    console.error("Missing required Edge Function environment variables.");
    return jsonResponse({
      error: "SERVER_NOT_CONFIGURED",
      message: "El analizador no esta configurado.",
    }, 500);
  }

  try {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        Authorization: authorization,
        apikey: publishableKey,
      },
    });

    if (!userResponse.ok) {
      return jsonResponse({
        error: "AUTH_REQUIRED",
        message: "Tu sesion no es valida.",
      }, 401);
    }

    const user = await userResponse.json() as JsonRecord;
    const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
    if (appMetadata.oraklo_admin !== true) {
      return jsonResponse({
        error: "ADMIN_REQUIRED",
        message: "Esta herramienta es solo para administracion.",
      }, 403);
    }

    const requestBody = await req.json() as JsonRecord;
    const marketId = getText(requestBody.market_id);
    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(marketId)) {
      return jsonResponse({
        error: "INVALID_MARKET_ID",
        message: "El identificador del mercado no es valido.",
      }, 400);
    }

    const marketResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/get_public_market_by_id`,
      {
        method: "POST",
        headers: {
          Authorization: authorization,
          apikey: publishableKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ market_id_input: marketId }),
      },
    );

    if (!marketResponse.ok) {
      console.error("Market RPC failed", marketResponse.status);
      return jsonResponse({
        error: "MARKET_LOOKUP_FAILED",
        message: "No se ha podido consultar el mercado.",
      }, 502);
    }

    const market = normalizeMarket(await marketResponse.json());
    if (!market) {
      return jsonResponse({
        error: "MARKET_NOT_FOUND",
        message: "No se ha encontrado el mercado.",
      }, 404);
    }

    if (!isMarketClosed(market)) {
      return jsonResponse({
        error: "MARKET_NOT_CLOSED",
        message: "El mercado todavia no esta cerrado.",
      }, 409);
    }

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": geminiApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: buildPrompt(market),
          store: false,
          tools: [{ type: "google_search" }],
        }),
        signal: AbortSignal.timeout(90_000),
      },
    );

    if (!geminiResponse.ok) {
      const providerMessage = (await geminiResponse.text()).slice(0, 500);
      console.error(
        "Gemini request failed",
        geminiResponse.status,
        providerMessage,
      );
      const quotaExceeded = geminiResponse.status === 429;
      return jsonResponse({
        error: quotaExceeded ? "AI_QUOTA_EXCEEDED" : "AI_PROVIDER_ERROR",
        message: quotaExceeded
          ? "Se ha alcanzado temporalmente el limite gratuito de la IA."
          : "La IA no ha podido completar el analisis.",
      }, quotaExceeded ? 429 : 502);
    }

    const geminiPayload = await geminiResponse.json() as JsonRecord;
    const extracted = extractGeminiOutput(geminiPayload);
    const analysis = normalizeAnalysis(
      parseJsonObject(extracted.text),
      extracted.text,
    );

    return jsonResponse({
      ok: true,
      market: {
        id: getText(market.id),
        question: getText(market.question),
        status: getText(market.status),
        closes_at: getText(market.closes_at),
      },
      analysis,
      sources: extracted.sources,
      search_queries: extracted.searchQueries,
      evidence_warning: extracted.sources.length
        ? "Comprueba las fuentes y sus fechas antes de aprobar la resolucion."
        : "La IA no ha devuelto fuentes verificables. No apruebes esta propuesta.",
      model: GEMINI_MODEL,
      generated_at: new Date().toISOString(),
      can_resolve_market: false,
    });
  } catch (error) {
    const isTimeout = error instanceof DOMException &&
      error.name === "TimeoutError";
    console.error("Resolution analysis failed", isTimeout ? "timeout" : error);
    return jsonResponse({
      error: isTimeout ? "AI_TIMEOUT" : "ANALYSIS_FAILED",
      message: isTimeout
        ? "La busqueda ha tardado demasiado. Intentalo de nuevo."
        : "No se ha podido completar el analisis.",
    }, isTimeout ? 504 : 500);
  }
});
