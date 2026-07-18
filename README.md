# oraklo-prototype-2.0
Prototipo MVP de Oraklo: red social competitiva de predicciones gaming basada en Karma, Prestigio y rankings.

## Continuidad entre chats

- `AGENTS.md` contiene las instrucciones permanentes que Codex debe aplicar al trabajar en esta carpeta.
- `ORAKLO_PROJECT_CONTEXT.md` recoge el estado técnico, decisiones, roadmap, restricciones y comprobaciones necesarias para retomar el proyecto en un chat nuevo.
- Antes de editar, hay que leer ambos documentos y comprobar el estado actual de Git; el transcript anterior no debe ser la única fuente de contexto.

## Resolución asistida por IA

- `admin-resolution.html` es el panel privado de revisión de mercados cerrados.
- `analyze-market-resolution` usa Tavily Search en modo básico para recopilar fuentes anteriores al cierre y Gemini 3 Flash Preview para analizarlas.
- `approve-market-resolution` exige una administradora autenticada y ejecuta la resolución atómica en Supabase.
- La IA nunca puede resolver por sí sola: una persona debe revisar las fuentes, elegir el resultado y confirmar la liquidación.
- Si la ficha usa referencias como «último» o «próximo» sin identificar una fecha concreta, el sistema propone `Anulado`, explica la ambigüedad y usa la ficha original como evidencia. La anulación sigue necesitando confirmación humana.
- Si el mercado está definido pero la búsqueda no encuentra pruebas suficientes, muestra `No concluyente` sin convertirlo en un error técnico ni habilitar una resolución insegura.
- Si Tavily o Gemini no están disponibles, el panel permite una resolución manual protegida que también exige fuentes HTTPS y revisión humana.
- Las fuentes aprobadas y la explicación quedan visibles en la ficha pública del mercado.

Las claves se configuran únicamente como secretos `GEMINI_API_KEY` y `TAVILY_API_KEY` de las Edge Functions. Nunca deben añadirse al frontend ni al repositorio. Cada análisis normal realiza tres búsquedas básicas de Tavily y una petición de texto a Gemini; los límites gratuitos dependen de cada proveedor.

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

## Currículum predictivo

- `profile.html?id=<uuid>` muestra el perfil público real de un predictor.
- La portada prioriza identidad, rango y cuatro métricas esenciales. El resto se reparte entre las pestañas `Resumen`, `Historial` y `Logros` para evitar una ficha saturada.
- Incluye Prestigio, rango, posición global, precisión, aciertos, fallos, racha actual, mejor racha y especialidades.
- El historial público contiene exclusivamente predicciones ya liquidadas y enlaza a la resolución con sus fuentes.
- El Karma disponible y todas las predicciones activas o pendientes continúan siendo privados.
- Las anulaciones aparecen en el historial, pero no cuentan para la precisión, las rachas ni las especialidades.
- Las insignias están preparadas con estados bloqueado/conseguido; sus emblemas visuales definitivos se diseñarán durante el pulido final.
- La posición de temporada muestra «Temporada no iniciada» mientras el sistema siga desactivado.
- El usuario puede personalizar su username, biografía pública, categoría favorita, avatar simbólico y tema visual. La RPC de escritura solo permite modificar el perfil de `auth.uid()` y valida todos los valores en Supabase.
- Al pulsar el `@username` de cualquier cabecera se abre, sin abandonar la página, un menú flotante con el resumen de Karma, Prestigio y rango; accesos al perfil, personalización, mercados, predicciones y clasificación; ayuda, privacidad, panel administrativo cuando corresponda y cierre de sesión.
- Las RPC públicas usan una lista cerrada de campos, `search_path` vacío y permisos explícitos. Es intencionado que puedan atravesar RLS para publicar solo el currículum y los resultados liquidados; nunca devuelven el saldo actual ni filas activas.

Para activar la personalización hay que ejecutar una sola vez en Supabase el archivo:

`supabase/migrations/20260715020000_add_profile_customization.sql`

Los HTML llevan una versión de caché en los recursos locales para que GitHub Pages sirva conjuntamente la nueva estructura, estilos y scripts.

## Comunidad social · Paso 11 MVP

- `community.html` ofrece dos feeds estrictamente cronológicos: actividad pública de toda la comunidad y actividad de las cuentas seguidas.
- El feed mezcla únicamente comentarios visibles y predicciones ya liquidadas. Nunca publica predicciones activas, saldo de Karma ni relaciones privadas completas.
- Cada mercado tiene un debate real con comentarios de hasta 500 caracteres, una sola profundidad de respuesta, edición y borrado lógico del contenido propio y marca de spoiler.
- Los perfiles muestran contadores reales de seguidores y seguidos. La lista completa de cuentas seguidas y los silencios personales solo se entregan a su propietaria autenticada.
- La reacción positiva `Buena lectura` se puede añadir a comentarios y predicciones liquidadas de otras personas. No modifica Karma, Prestigio, rangos o clasificación.
- Los invitados pueden leer; escribir, seguir, reaccionar, silenciar o reportar exige autenticación.
- `admin-community.html` es una cola privada de moderación humana para revisar reportes, ocultar o restaurar comentarios y aplicar o levantar restricciones sociales temporales. Cada decisión queda registrada en una auditoría privada.
- Las tablas sociales tienen RLS y no conceden acceso directo a `anon` o `authenticated`: la API pública se limita a RPC con campos cerrados, `search_path` vacío y permisos explícitos.

Para activar el Paso 11 hay que ejecutar una sola vez en Supabase, después de las migraciones anteriores:

`supabase/migrations/20260718143106_add_social_community_mvp.sql`

Después debe aplicarse la corrección del contador público real:

`supabase/migrations/20260718182915_expose_real_market_comment_counts.sql`

Ambas migraciones fueron aplicadas en producción y el MVP social se validó como invitada, con dos cuentas normales y con administradora el 18 de julio de 2026. La cuenta temporal de aceptación y sus datos se eliminaron al terminar.

La secuencia detallada de activación y pruebas está en `STEP_11_ACCEPTANCE_CHECKLIST.md`.

### Backlog social posterior al MVP

Cuando Oraklo salga del MVP, ampliar el Paso 11 de forma progresiva con: mensajes directos o chat; notificaciones por email o push; menciones; hashtags y tendencias; imágenes, vídeo, GIF y archivos; grupos o comunidades privadas; feed algorítmico; cuentas privadas y solicitudes de seguimiento; hilos con más profundidad; varias reacciones o votos negativos; recompensas sociales de Karma o Prestigio; y moderación o sanciones automatizadas con IA. Ninguno de estos puntos forma parte del MVP actual y deberá diseñarse y aprobarse antes de implementarlo.

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
- Sustituir los avatares simbólicos provisionales por una colección de avatares propios y atractivos, relacionados con el gaming y el universo de Oraklo, manteniendo el tono de oráculo moderno y evitando cualquier estética de casino.
