import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_INTERACTIONS_REVISION = "2026-05-20";
const GEMINI_REQUEST_TIMEOUT_MS = 45_000;
const MAX_REQUEST_BYTES = 8_192;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

type GeminiOutput = {
  text: string;
  sources: JsonRecord[];
  searchQueries: string[];
};

type GeminiProviderResult = {
  ok: boolean;
  provider: "interactions" | "generateContent";
  status: number;
  payload: JsonRecord | null;
  detail: string;
};

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

function getHostname(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "Fuente web";
  }
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

function extractInteractionsOutput(payload: JsonRecord): GeminiOutput {
  const textParts: string[] = [];
  const searchQueries = new Set<string>();
  const sources = new Map<string, JsonRecord>();
  const steps = Array.isArray(payload.steps)
    ? payload.steps
    : Array.isArray(payload.outputs)
    ? payload.outputs
    : [];

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

    if (
      stepValue.type === "google_search_result" && isRecord(stepValue.result)
    ) {
      const resultUrl = getText(stepValue.result.url);
      if (/^https?:\/\//i.test(resultUrl) && !sources.has(resultUrl)) {
        sources.set(resultUrl, {
          title: getHostname(resultUrl),
          url: resultUrl,
          cited_text: "",
        });
      }
    }

    const blocks =
      stepValue.type === "model_output" && Array.isArray(stepValue.content)
        ? stepValue.content
        : stepValue.type === "text"
        ? [stepValue]
        : [];

    for (const blockValue of blocks) {
      if (!isRecord(blockValue) || blockValue.type !== "text") continue;
      const blockText = getText(blockValue.text);
      if (blockText) textParts.push(blockText);

      const annotations = Array.isArray(blockValue.annotations)
        ? blockValue.annotations
        : [];
      for (const annotationValue of annotations) {
        if (
          !isRecord(annotationValue) ||
          (annotationValue.type !== "url_citation" && !annotationValue.source)
        ) continue;
        const url = getText(annotationValue.url) ||
          getText(annotationValue.source);
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
            title: getText(annotationValue.title) || getHostname(url),
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

function extractGenerateContentOutput(payload: JsonRecord): GeminiOutput {
  const textParts: string[] = [];
  const searchQueries = new Set<string>();
  const sources = new Map<string, JsonRecord>();
  const candidates = Array.isArray(payload.candidates)
    ? payload.candidates
    : [];

  for (const candidateValue of candidates) {
    if (!isRecord(candidateValue)) continue;

    const content = isRecord(candidateValue.content)
      ? candidateValue.content
      : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    for (const partValue of parts) {
      if (!isRecord(partValue)) continue;
      const partText = getText(partValue.text);
      if (partText) textParts.push(partText);
    }

    const metadata = isRecord(candidateValue.groundingMetadata)
      ? candidateValue.groundingMetadata
      : isRecord(candidateValue.grounding_metadata)
      ? candidateValue.grounding_metadata
      : {};
    const queries = Array.isArray(metadata.webSearchQueries)
      ? metadata.webSearchQueries
      : Array.isArray(metadata.web_search_queries)
      ? metadata.web_search_queries
      : [];
    queries.map(getText).filter(Boolean).forEach((query) =>
      searchQueries.add(query)
    );

    const chunks = Array.isArray(metadata.groundingChunks)
      ? metadata.groundingChunks
      : Array.isArray(metadata.grounding_chunks)
      ? metadata.grounding_chunks
      : [];
    const supports = Array.isArray(metadata.groundingSupports)
      ? metadata.groundingSupports
      : Array.isArray(metadata.grounding_supports)
      ? metadata.grounding_supports
      : [];
    const citedTextByChunk = new Map<number, Set<string>>();

    for (const supportValue of supports) {
      if (!isRecord(supportValue)) continue;
      const segment = isRecord(supportValue.segment)
        ? supportValue.segment
        : {};
      const segmentText = getText(segment.text);
      const indices = Array.isArray(supportValue.groundingChunkIndices)
        ? supportValue.groundingChunkIndices
        : Array.isArray(supportValue.grounding_chunk_indices)
        ? supportValue.grounding_chunk_indices
        : [];

      for (const indexValue of indices) {
        const index = Number(indexValue);
        if (!Number.isInteger(index) || index < 0 || !segmentText) continue;
        if (!citedTextByChunk.has(index)) {
          citedTextByChunk.set(index, new Set());
        }
        citedTextByChunk.get(index)?.add(segmentText);
      }
    }

    chunks.forEach((chunkValue, index) => {
      if (!isRecord(chunkValue)) return;
      const web = isRecord(chunkValue.web)
        ? chunkValue.web
        : isRecord(chunkValue.retrievedContext)
        ? chunkValue.retrievedContext
        : {};
      const url = getText(web.uri) || getText(web.url);
      if (!/^https?:\/\//i.test(url) || sources.has(url)) return;

      sources.set(url, {
        title: getText(web.title) || getHostname(url),
        url,
        cited_text: [...(citedTextByChunk.get(index) ?? [])].join(" ").slice(
          0,
          1000,
        ),
      });
    });
  }

  return {
    text: textParts.join("\n").trim(),
    sources: [...sources.values()].slice(0, 12),
    searchQueries: [...searchQueries].slice(0, 12),
  };
}

async function readGeminiResponse(
  response: Response,
  provider: GeminiProviderResult["provider"],
): Promise<GeminiProviderResult> {
  const responseText = await response.text();
  let payload: JsonRecord | null = null;

  try {
    const parsed = JSON.parse(responseText);
    payload = isRecord(parsed) ? parsed : null;
  } catch {
    // Keep the shortened text for private logs and return a friendly error later.
  }

  return {
    ok: response.ok,
    provider,
    status: response.status,
    payload,
    detail: response.ok ? "" : responseText.slice(0, 600),
  };
}

async function requestGeminiInteractions(
  apiKey: string,
  prompt: string,
): Promise<GeminiProviderResult> {
  try {
    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
          "Api-Revision": GEMINI_INTERACTIONS_REVISION,
        },
        body: JSON.stringify({
          model: GEMINI_MODEL,
          input: prompt,
          store: false,
          tools: [{ type: "google_search" }],
        }),
        signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
      },
    );

    return await readGeminiResponse(response, "interactions");
  } catch (error) {
    return {
      ok: false,
      provider: "interactions",
      status: 0,
      payload: null,
      detail: error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network_error",
    };
  }
}

async function requestGeminiGenerateContent(
  apiKey: string,
  prompt: string,
): Promise<GeminiProviderResult> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.1 },
        }),
        signal: AbortSignal.timeout(GEMINI_REQUEST_TIMEOUT_MS),
      },
    );

    return await readGeminiResponse(response, "generateContent");
  } catch (error) {
    return {
      ok: false,
      provider: "generateContent",
      status: 0,
      payload: null,
      detail: error instanceof DOMException && error.name === "TimeoutError"
        ? "timeout"
        : "network_error",
    };
  }
}

function canTryLegacyFallback(result: GeminiProviderResult): boolean {
  return ![401, 403, 429].includes(result.status);
}

function getFriendlyProviderFailure(result: GeminiProviderResult): {
  error: string;
  message: string;
  status: number;
} {
  const detail = result.detail.toLowerCase();

  if (result.status === 429 || detail.includes("quota")) {
    return {
      error: "AI_QUOTA_EXCEEDED",
      message:
        "Se ha alcanzado temporalmente el limite de Gemini. Reintentalo mas tarde o usa la resolucion manual.",
      status: 429,
    };
  }

  if (
    result.status === 401 || result.status === 403 ||
    detail.includes("api_key_invalid") || detail.includes("permission_denied")
  ) {
    return {
      error: "AI_CONFIGURATION_ERROR",
      message:
        "Gemini ha rechazado la clave configurada. Revisa el secreto GEMINI_API_KEY o usa la resolucion manual.",
      status: 502,
    };
  }

  if (detail.includes("billing")) {
    return {
      error: "AI_BILLING_REQUIRED",
      message:
        "Google solicita habilitar la facturacion para esta busqueda. Puedes usar la resolucion manual con fuentes verificadas.",
      status: 502,
    };
  }

  if (result.status === 0 && result.detail === "timeout") {
    return {
      error: "AI_TIMEOUT",
      message:
        "La busqueda ha tardado demasiado. Reintentalo o usa la resolucion manual.",
      status: 504,
    };
  }

  return {
    error: "AI_PROVIDER_ERROR",
    message:
      "Gemini no esta disponible ahora. Reintentalo o usa la resolucion manual con fuentes verificadas.",
    status: 502,
  };
}

async function analyzeWithGemini(
  apiKey: string,
  prompt: string,
): Promise<
  | {
    ok: true;
    output: GeminiOutput;
    provider: GeminiProviderResult["provider"];
  }
  | { ok: false; failure: ReturnType<typeof getFriendlyProviderFailure> }
> {
  const interactions = await requestGeminiInteractions(apiKey, prompt);
  if (interactions.ok && interactions.payload) {
    const output = extractInteractionsOutput(interactions.payload);
    if (output.text && output.sources.length) {
      return { ok: true, output, provider: interactions.provider };
    }
    console.warn(
      "Gemini Interactions returned incomplete grounded output",
      Boolean(output.text),
      output.sources.length,
    );
  } else {
    console.error(
      "Gemini Interactions failed",
      interactions.status,
      interactions.detail,
    );
  }

  if (!canTryLegacyFallback(interactions)) {
    return { ok: false, failure: getFriendlyProviderFailure(interactions) };
  }

  const generateContent = await requestGeminiGenerateContent(apiKey, prompt);
  if (generateContent.ok && generateContent.payload) {
    const output = extractGenerateContentOutput(generateContent.payload);
    if (output.text && output.sources.length) {
      return { ok: true, output, provider: generateContent.provider };
    }
    console.warn(
      "Gemini generateContent returned incomplete grounded output",
      Boolean(output.text),
      output.sources.length,
    );
    return {
      ok: false,
      failure: {
        error: "AI_NO_EVIDENCE",
        message:
          "La IA no ha devuelto fuentes verificables. Reintentalo o usa la resolucion manual.",
        status: 422,
      },
    };
  }

  console.error(
    "Gemini generateContent failed",
    generateContent.status,
    generateContent.detail,
  );
  return { ok: false, failure: getFriendlyProviderFailure(generateContent) };
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

    const geminiAnalysis = await analyzeWithGemini(
      geminiApiKey,
      buildPrompt(market),
    );
    if (!geminiAnalysis.ok) {
      return jsonResponse({
        error: geminiAnalysis.failure.error,
        message: geminiAnalysis.failure.message,
      }, geminiAnalysis.failure.status);
    }

    const extracted = geminiAnalysis.output;
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
      provider_api: geminiAnalysis.provider,
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
