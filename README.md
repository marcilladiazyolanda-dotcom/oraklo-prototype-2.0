# oraklo-prototype-2.0
Prototipo MVP de Oraklo: red social competitiva de predicciones gaming basada en Karma, Prestigio y rankings.

## Resolución asistida por IA

- `admin-resolution.html` es el panel privado de revisión de mercados cerrados.
- `analyze-market-resolution` consulta Gemini con Google Search y solo propone un resultado con fuentes.
- `approve-market-resolution` exige una administradora autenticada y ejecuta la resolución atómica en Supabase.
- La IA nunca puede resolver por sí sola: una persona debe revisar las fuentes, elegir el resultado y confirmar la liquidación.
- Las fuentes aprobadas y la explicación quedan visibles en la ficha pública del mercado.

La clave de Gemini se configura únicamente como secreto `GEMINI_API_KEY` de las Edge Functions. Nunca debe añadirse al frontend ni al repositorio.
