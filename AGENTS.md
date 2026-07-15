# Instrucciones permanentes del proyecto Oraklo

## Antes de empezar cualquier tarea

1. Lee `ORAKLO_PROJECT_CONTEXT.md` y `README.md` completos.
2. Inspecciona `git status`, la rama actual, los últimos commits y la diferencia con `origin/main` antes de editar.
3. Conserva cualquier cambio local o remoto que no pertenezca a la tarea. No uses comandos destructivos para sincronizar.
4. No repitas funcionalidades que el contexto marque como terminadas. Si el código y el documento discrepan, comprueba el código y explica la discrepancia.
5. Espera a que la usuaria indique el siguiente resultado que quiere. No inicies por tu cuenta una fase nueva del roadmap.

## Producto y tono

- Oraklo es una red social competitiva de predicciones sobre videojuegos y el ecosistema gaming.
- Karma es el saldo ficticio para participar; Prestigio es la reputación histórica y determina el rango.
- No hay dinero real, pagos, compra de Karma ni Modo Real.
- El tono visual es «oráculo moderno» y gaming. Evita cualquier estética o lenguaje de casino.
- Las predicciones activas y el Karma disponible son privados. El perfil y las predicciones liquidadas sí pueden ser públicos.
- No inventes usuarios, métricas, actividad, comentarios ni resultados. La interfaz debe reflejar datos reales de Supabase o estados vacíos honestos.
- La interfaz y los mensajes para la usuaria deben estar en español, ser claros y evitar errores técnicos crudos.

## Arquitectura y seguridad

- Frontend estático compatible con GitHub Pages: HTML, CSS y JavaScript sin proceso de compilación.
- Backend: Supabase Auth, Postgres/RLS, RPC y Edge Functions.
- Nunca pongas claves, `service_role`, `GEMINI_API_KEY` o `TAVILY_API_KEY` en el frontend o en el repositorio.
- Las operaciones económicas o de liquidación deben ser atómicas y autoritativas en Supabase. El frontend solo ayuda a validar y mostrar mensajes.
- No insertes directamente en `predictions` desde el frontend: usa `place_prediction`.
- No expongas funciones de resolución protegidas a clientes públicos. La resolución requiere administradora autenticada y confirmación humana.
- La IA investiga y propone; nunca liquida por sí sola.
- Las temporadas están preparadas, pero deben permanecer desactivadas hasta alcanzar el umbral de usuarios y recibir activación administrativa explícita.

## Forma de trabajar acordada

- Un único implementador por tarea. No coordines dos agentes editando los mismos archivos simultáneamente.
- Inspecciona antes de cambiar y mantén el alcance pedido. No añadas funciones futuras sin autorización.
- Usa migraciones SQL versionadas para cambios de esquema y documenta qué debe ejecutar manualmente la usuaria.
- Al completar un hito importante, actualiza `ORAKLO_PROJECT_CONTEXT.md` para que el siguiente chat no dependa del transcript.
- La usuaria suele ejecutar SQL/secretos en Supabase y subir manualmente a GitHub el contenido de un ZIP completo.
- No hagas `push`, despliegues ni mutaciones externas salvo petición expresa.
- Tras cambios JavaScript ejecuta comprobación de sintaxis. Revisa también estructura CSS/HTML, rutas, flujo afectado y `git diff --check`.
- Para cambios visuales, verifica escritorio y móvil en proporción al riesgo. Mantén el versionado de recursos para evitar caché antigua de GitHub Pages.
- Entrega un commit claro y, cuando se solicite publicación manual, un ZIP del repositorio completo; no solo los archivos modificados.

## Criterios que nunca deben romperse

- Auth, cabecera y actualización de perfil real.
- Descuento real de Karma al confirmar y persistencia tras recargar.
- Contador basado en `closes_at`, cierre automático visual y bloqueo de predicción tras el vencimiento.
- Resolución atómica con devolución/retorno y Prestigio, tope de retorno x10 y Prestigio nunca inferior a 0.
- Mercados anulados: devolución íntegra del Karma y sin cambio de Prestigio.
- Fuentes de resolución visibles, verificables y anteriores al cierre.
- Ranking y perfiles basados en datos reales; predicciones activas nunca públicas.
- Compatibilidad con GitHub Pages.

## Próxima fase conocida

- Paso 9 (rangos, clasificación y temporadas dormidas): terminado.
- Paso 10 y 10B (currículum predictivo, personalización y menú de cuenta): terminado en la rama de trabajo local.
- Paso 11 previsto: funciones sociales y comunidad. Antes de implementarlo hay que acordar con la usuaria el alcance de comentarios, seguimiento, feed, reacciones, moderación y reportes.
