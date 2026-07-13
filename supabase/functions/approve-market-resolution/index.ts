import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MAX_REQUEST_BYTES = 65_536;

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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getPublishableKey(): string {
  const keysJson = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy variable while the project finishes migrating.
    }
  }

  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function getSecretKey(): string {
  const keysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keysJson) {
    try {
      const keys = JSON.parse(keysJson) as Record<string, string>;
      if (keys.default) return keys.default;
    } catch {
      // Fall back to the legacy service role variable during key migration.
    }
  }

  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function normalizeResult(value: unknown): string | null {
  const result = getText(value).toLowerCase();
  const allowed: Record<string, string> = {
    si: "Sí",
    "sí": "Sí",
    yes: "Sí",
    no: "No",
    anulado: "Anulado",
    anulada: "Anulado",
    void: "Anulado",
  };

  return allowed[result] ?? null;
}

function normalizeSources(value: unknown): JsonRecord[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return null;
  }

  const sources: JsonRecord[] = [];
  for (const sourceValue of value) {
    if (!isRecord(sourceValue)) return null;

    const title = getText(sourceValue.title);
    const url = getText(sourceValue.url);
    const citedText = getText(sourceValue.cited_text).slice(0, 1000);

    if (
      title.length < 2 || title.length > 200 || url.length > 2048 ||
      !/^https:\/\//i.test(url)
    ) {
      return null;
    }

    sources.push({ title, url, cited_text: citedText });
  }

  return sources;
}

function friendlyDatabaseError(message: string): {
  error: string;
  message: string;
  status: number;
} {
  const errors = [
    {
      match: "MARKET_ALREADY_RESOLVED",
      error: "MARKET_ALREADY_RESOLVED",
      message: "Este mercado ya esta resuelto.",
      status: 409,
    },
    {
      match: "MARKET_NOT_CLOSED",
      error: "MARKET_NOT_CLOSED",
      message: "El mercado todavia no esta cerrado.",
      status: 409,
    },
    {
      match: "MARKET_NOT_FOUND",
      error: "MARKET_NOT_FOUND",
      message: "No se ha encontrado el mercado.",
      status: 404,
    },
    {
      match: "INVALID_RESOLUTION_RESULT",
      error: "INVALID_RESOLUTION_RESULT",
      message: "El resultado debe ser Si, No o Anulado.",
      status: 400,
    },
    {
      match: "INVALID_RESOLUTION_SOURCE",
      error: "INVALID_RESOLUTION_SOURCE",
      message: "Una de las fuentes no es valida.",
      status: 400,
    },
  ];

  return errors.find((item) => message.includes(item.match)) ?? {
    error: "RESOLUTION_FAILED",
    message: "No se ha podido resolver el mercado.",
    status: 500,
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
  const secretKey = getSecretKey();

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Missing required Supabase Edge Function variables.");
    return jsonResponse({
      error: "SERVER_NOT_CONFIGURED",
      message: "La aprobacion segura no esta configurada.",
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
    const userId = getText(user.id);
    const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
    if (!userId || appMetadata.oraklo_admin !== true) {
      return jsonResponse({
        error: "ADMIN_REQUIRED",
        message: "Esta herramienta es solo para administracion.",
      }, 403);
    }

    const requestBody = await req.json() as JsonRecord;
    const marketId = getText(requestBody.market_id);
    const result = normalizeResult(requestBody.result);
    const note = getText(requestBody.resolution_note);
    const sources = normalizeSources(requestBody.sources);
    const model = getText(requestBody.ai_model).slice(0, 100) || null;
    const generatedAtText = getText(requestBody.ai_generated_at);
    const generatedAt = Number.isFinite(Date.parse(generatedAtText))
      ? new Date(generatedAtText).toISOString()
      : null;

    if (!/^[a-z0-9][a-z0-9_-]{0,119}$/i.test(marketId)) {
      return jsonResponse({
        error: "INVALID_MARKET_ID",
        message: "El identificador del mercado no es valido.",
      }, 400);
    }

    if (!result) {
      return jsonResponse({
        error: "INVALID_RESOLUTION_RESULT",
        message: "El resultado debe ser Si, No o Anulado.",
      }, 400);
    }

    if (note.length < 10 || note.length > 4000) {
      return jsonResponse({
        error: "INVALID_RESOLUTION_NOTE",
        message: "Escribe una explicacion de entre 10 y 4.000 caracteres.",
      }, 400);
    }

    if (!sources) {
      return jsonResponse({
        error: "INVALID_RESOLUTION_SOURCES",
        message: "Selecciona entre 1 y 12 fuentes HTTPS validas.",
      }, 400);
    }

    const headers: Record<string, string> = {
      apikey: secretKey,
      "Content-Type": "application/json",
    };
    if (!secretKey.startsWith("sb_secret_")) {
      headers.Authorization = `Bearer ${secretKey}`;
    }

    const resolutionResponse = await fetch(
      `${supabaseUrl}/rest/v1/rpc/resolve_market_with_evidence`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          market_id_input: marketId,
          result_input: result,
          resolution_note_input: note,
          resolution_sources_input: sources,
          reviewed_by_input: userId,
          ai_model_input: model,
          ai_generated_at_input: generatedAt,
        }),
      },
    );

    if (!resolutionResponse.ok) {
      const errorPayload = await resolutionResponse.json().catch(
        () => ({}),
      ) as JsonRecord;
      const databaseMessage = getText(errorPayload.message);
      console.error(
        "Resolution RPC failed",
        resolutionResponse.status,
        databaseMessage,
      );
      const friendly = friendlyDatabaseError(databaseMessage);
      return jsonResponse(
        { error: friendly.error, message: friendly.message },
        friendly.status,
      );
    }

    const resolution = await resolutionResponse.json();
    return jsonResponse({
      ok: true,
      resolution,
      message: "Mercado resuelto con aprobacion humana y fuentes verificables.",
    });
  } catch (error) {
    console.error("Approval failed", error);
    return jsonResponse({
      error: "APPROVAL_FAILED",
      message: "No se ha podido completar la aprobacion.",
    }, 500);
  }
});
