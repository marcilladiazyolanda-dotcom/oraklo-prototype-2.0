# Paso 11 · Activación y aceptación del MVP social

Este checklist se ejecuta después de subir el paquete completo y antes de considerar el Paso 11 desplegado. Usa únicamente cuentas y actividad reales de prueba; no rellenes la plataforma con usuarios, comentarios o métricas simulados.

## 1. Aplicar la migración

1. Abre el proyecto correcto de Oraklo en Supabase.
2. Entra en **SQL Editor** y crea una consulta nueva.
3. Copia completo `supabase/migrations/20260718143106_add_social_community_mvp.sql`.
4. Ejecuta la consulta una sola vez y confirma que termina sin errores.
5. No recrees ni sustituyas `place_prediction`, las RPC de perfil o las funciones de resolución.

La migración crea tablas sociales con RLS, revoca el acceso directo de `anon` y `authenticated` y concede únicamente las RPC necesarias. No contiene usuarios, comentarios, seguidores, reacciones o reportes de ejemplo.

## 2. Verificación técnica en Supabase

Ejecuta estas consultas de solo lectura después de la migración:

```sql
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname like 'community_%'
  and c.relkind = 'r'
order by c.relname;
```

Todas las tablas devueltas deben mostrar `rls_enabled = true`.

```sql
select routine_name
from information_schema.routines
where routine_schema = 'public'
  and (
    routine_name like '%community%'
    or routine_name in (
      'get_public_market_comments',
      'create_market_comment',
      'update_market_comment',
      'delete_market_comment',
      'get_public_social_profile',
      'set_profile_following',
      'set_profile_muted',
      'get_my_following'
    )
  )
order by routine_name;
```

Comprueba también que `public.markets.comments_count` sigue existiendo y que las predicciones activas continúan protegidas por sus políticas anteriores.

## 3. Matriz de aceptación funcional

### Invitada

- `community.html` abre el feed `Comunidad` sin iniciar sesión.
- Solo aparecen comentarios visibles y predicciones ya liquidadas reales.
- `Siguiendo`, comentar, responder, reaccionar, seguir, silenciar y reportar solicitan iniciar sesión.
- No aparece el saldo de Karma de ninguna persona ni una opción/cantidad de predicción activa.
- Un mercado sin comentarios muestra un estado vacío, no actividad inventada.

### Cuenta normal A

- Publica un comentario de entre 1 y 500 caracteres en un mercado abierto, cerrado y resuelto.
- Puede marcarlo como spoiler y el texto queda oculto hasta pulsar **Mostrar comentario**.
- Puede editar y eliminar su propio comentario.
- Puede responder a un comentario raíz, pero la respuesta no ofrece otro botón para anidar un tercer nivel.
- Cinco publicaciones dentro de un minuto funcionan como máximo; la siguiente muestra un aviso de espera.
- Puede seguir y dejar de seguir un perfil ajeno; los contadores cambian con datos reales.
- La lista completa de `Cuentas que sigues` solo aparece en su propia sesión.
- Puede silenciar un perfil; al hacerlo deja de seguirlo y su actividad desaparece del feed y de los debates de esa cuenta.
- Puede reportar un comentario o perfil ajeno una vez mientras el reporte esté pendiente.

### Cuenta normal B

- Ve el comentario de A y puede marcar o retirar `Buena lectura`.
- No puede reaccionar a su propio comentario o predicción liquidada.
- La reacción, comentar o seguir no modifica su Karma, Prestigio, rango o posición.
- Su feed `Siguiendo` incluye solo actividad pública de cuentas que sigue y mantiene orden cronológico.
- Una predicción solo entra al feed después de tener `settled_at`; nunca antes.

### Administradora

- `admin-community.html` rechaza cuentas normales aunque conozcan la URL.
- Un reporte pendiente muestra motivo, contexto, captura del objetivo e identidad de quien reportó únicamente en la cola privada.
- Puede descartar un reporte.
- Puede ocultar un comentario y este desaparece del feed y del debate público.
- Puede restaurar el comentario desde `Ocultos`.
- Puede restringir temporalmente una cuenta de prueba y luego levantar la restricción.
- Una cuenta restringida puede seguir leyendo, dejar de seguir, silenciar, retirar una reacción o borrar contenido propio, pero no crear comentarios, seguir o añadir reacciones.
- Cada decisión aparece en el estado revisado correspondiente y queda registrada en `community_moderation_actions`.
- La administración no puede restringirse a sí misma desde la cola.

## 4. Privacidad y seguridad

- Verifica con las herramientas del navegador que las respuestas del feed no contienen `karma`, `karma_risked`, `karma_awarded` ni filas con `settled_at = null`.
- Confirma que una cuenta no puede consultar mediante la interfaz la lista completa de seguidores, seguidos o silencios de otra persona.
- Confirma que el reporte nunca aparece en páginas públicas.
- Comprueba que escribir directamente en las tablas `community_%` con una sesión normal falla; las escrituras deben pasar por RPC.
- Repite las pruebas de acceso después de cerrar sesión para descartar estados de caché.

## 5. Publicación en GitHub Pages

- Sube el contenido completo del ZIP, no archivos sueltos.
- Confirma que todos los HTML cargan recursos con `v=20260718-community1`.
- Espera a que GitHub Pages renueve la caché y abre en incógnito: inicio, comunidad, mercado, perfil, clasificación, predicciones y ambos paneles administrativos.
- Comprueba escritorio y móvil, especialmente cabecera, pestañas, formularios, spoilers, feed y cola administrativa.
- Debido a la desincronización histórica, compara árboles antes de integrar; no hagas `reset`, `rebase` o sobrescritura destructiva de `main`.

Si una comprobación falla, detén la publicación y conserva las tablas y datos para diagnosticar. No elimines el esquema social como primera medida.
