# oraklo-prototype-2.0
Prototipo MVP de Oraklo: red social competitiva de predicciones gaming basada en Karma, Prestigio y rankings.

## Resolución asistida por IA

- `admin-resolution.html` es el panel privado de revisión de mercados cerrados.
- `analyze-market-resolution` consulta Gemini con Google Search y solo propone un resultado con fuentes.
- `approve-market-resolution` exige una administradora autenticada y ejecuta la resolución atómica en Supabase.
- La IA nunca puede resolver por sí sola: una persona debe revisar las fuentes, elegir el resultado y confirmar la liquidación.
- Si Gemini no está disponible, el panel permite una resolución manual protegida que también exige fuentes HTTPS y revisión humana.
- Las fuentes aprobadas y la explicación quedan visibles en la ficha pública del mercado.

La clave de Gemini se configura únicamente como secreto `GEMINI_API_KEY` de las Edge Functions. Nunca debe añadirse al frontend ni al repositorio.

## Rangos y clasificación

- El rango se calcula automáticamente desde el Prestigio histórico:
  - Observador: 0–99.
  - Intérprete: 100–249.
  - Analista: 250–499.
  - Visionario: 500–999.
  - Oráculo: 1.000 o más.
- `ranking.html` muestra la clasificación global real, estadísticas y progreso de rango.
- Las temporadas están preparadas, pero desactivadas durante el desarrollo.
- La configuración inicial exige 100 usuarios registrados y una activación administrativa explícita.
- Al empezar una temporada solo se reinicia su clasificación competitiva; el Prestigio histórico y el rango se conservan.

Cuando llegue el lanzamiento, el umbral y la duración se pueden ajustar desde el SQL Editor con una cuenta administrativa. Esta llamada deja preparada la activación; la temporada solo comenzará cuando también se alcance el número indicado de perfiles:

```sql
select public.configure_oraklo_seasons(
  seasons_enabled_input => true,
  minimum_registered_users_input => 100,
  season_length_months_input => 3
);
```

## Recordatorio para el pulido final

- Diseñar un emblema visual propio para cada nivel de Prestigio: Observador, Intérprete, Analista, Visionario y Oráculo.
