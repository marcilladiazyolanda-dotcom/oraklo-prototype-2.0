const authClient = window.orakloSupabase;

const guestProfile = {
  username: "Invitado",
  karma: 1000,
  prestige: 0,
  rank: "Observador",
  bio: "",
  favoriteCategory: null,
  avatarKey: "oracle",
  profileTheme: "aurora"
};

const authAvatarMarks = {
  oracle: "◇",
  spark: "✦",
  hex: "⬡",
  pulse: "◉",
  delta: "△"
};

const authState = {
  session: null,
  user: null,
  profile: { ...guestProfile },
  ready: false
};

const authListeners = new Set();
let authReadyResolver;
let authMode = "login";
let userMenuOpen = false;

const authReady = new Promise((resolve) => {
  authReadyResolver = resolve;
});

function formatAuthNumber(value) {
  const rounded = Math.round(Number(value) || 0);
  return String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function mapProfileFromSupabase(row, user) {
  return {
    id: row?.id || user?.id || null,
    username: row?.username || user?.user_metadata?.username || user?.email || "@Usuario",
    karma: Number(row?.karma ?? guestProfile.karma),
    prestige: Number(row?.prestige ?? row?.prestigio ?? guestProfile.prestige),
    rank: row?.rank || row?.rango || guestProfile.rank,
    bio: row?.bio || "",
    favoriteCategory: row?.favorite_category || null,
    avatarKey: row?.avatar_key || guestProfile.avatarKey,
    profileTheme: row?.profile_theme || guestProfile.profileTheme
  };
}

function escapeAuthHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getAuthAvatarMark(profile) {
  return authAvatarMarks[profile?.avatarKey] || authAvatarMarks.oracle;
}

function getCurrentAuthState() {
  return {
    session: authState.session,
    user: authState.user,
    profile: authState.profile,
    ready: authState.ready,
    isAuthenticated: Boolean(authState.session),
    isAdmin: authState.user?.app_metadata?.oraklo_admin === true
  };
}

function notifyAuthListeners() {
  const currentState = getCurrentAuthState();
  authListeners.forEach((listener) => listener(currentState));
  window.dispatchEvent(new CustomEvent("oraklo:auth-changed", { detail: currentState }));
}

function injectUserMenu() {
  if (document.querySelector("#oraklo-user-menu")) return;

  const menu = document.createElement("aside");
  menu.id = "oraklo-user-menu";
  menu.className = "user-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Opciones de usuario");
  menu.hidden = true;
  document.body.appendChild(menu);
}

function renderUserMenu() {
  injectUserMenu();
  const menu = document.querySelector("#oraklo-user-menu");
  const profile = authState.profile || guestProfile;
  const profileId = profile.id ? encodeURIComponent(profile.id) : "";
  const isAdmin = authState.user?.app_metadata?.oraklo_admin === true;

  if (!authState.session || !profile.id) {
    menu.hidden = true;
    userMenuOpen = false;
    return;
  }

  menu.className = `user-menu user-menu-theme-${profile.profileTheme || "aurora"}`;
  menu.innerHTML = `
    <div class="user-menu-summary">
      <span class="user-menu-avatar" aria-hidden="true">${escapeAuthHtml(getAuthAvatarMark(profile))}</span>
      <div>
        <strong>${escapeAuthHtml(profile.username)}</strong>
        <span>${escapeAuthHtml(profile.rank)} · ${formatAuthNumber(profile.prestige)} Prestigio</span>
      </div>
    </div>
    <nav class="user-menu-links" aria-label="Cuenta Oraklo">
      <a role="menuitem" href="profile.html?id=${profileId}">
        <span aria-hidden="true">◫</span>
        <span><strong>Mi perfil</strong><small>Ver tu currículum predictivo</small></span>
      </a>
      <a role="menuitem" href="profile.html?id=${profileId}&edit=1">
        <span aria-hidden="true">✎</span>
        <span><strong>Personalizar perfil</strong><small>Username, biografía y estilo</small></span>
      </a>
      <a role="menuitem" href="my-predictions.html">
        <span aria-hidden="true">◎</span>
        <span><strong>Mis predicciones</strong><small>Activas e historial personal</small></span>
      </a>
      <a role="menuitem" href="ranking.html">
        <span aria-hidden="true">⌁</span>
        <span><strong>Clasificación</strong><small>Posición, rangos y temporada</small></span>
      </a>
      ${isAdmin ? `
        <a role="menuitem" href="admin-resolution.html">
          <span aria-hidden="true">✓</span>
          <span><strong>Resolver mercados</strong><small>Panel de revisión administrativa</small></span>
        </a>
      ` : ""}
    </nav>
    <button class="user-menu-signout" type="button" role="menuitem" data-auth-signout>
      <span aria-hidden="true">↪</span>
      <span>Cerrar sesión</span>
    </button>
  `;
}

function positionUserMenu(trigger) {
  const menu = document.querySelector("#oraklo-user-menu");
  if (!menu || !trigger) return;

  const triggerRect = trigger.getBoundingClientRect();
  const right = Math.max(12, window.innerWidth - triggerRect.right);
  const preferredTop = triggerRect.bottom + 10;
  const maxTop = Math.max(12, window.innerHeight - menu.offsetHeight - 12);

  menu.style.right = `${right}px`;
  menu.style.top = `${Math.min(preferredTop, maxTop)}px`;
}

function closeUserMenu() {
  const menu = document.querySelector("#oraklo-user-menu");
  userMenuOpen = false;
  if (menu) menu.hidden = true;
  document.querySelectorAll("[data-auth-state='user'][data-profile-username]").forEach((button) => {
    button.setAttribute("aria-expanded", "false");
  });
}

function toggleUserMenu(trigger) {
  injectUserMenu();
  const menu = document.querySelector("#oraklo-user-menu");
  if (!menu) return;

  if (userMenuOpen) {
    closeUserMenu();
    return;
  }

  renderUserMenu();
  userMenuOpen = true;
  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  positionUserMenu(trigger);
  menu.querySelector("[role='menuitem']")?.focus();
}

function updateHeaderSessionState() {
  const profile = authState.profile || guestProfile;
  const isAuthenticated = Boolean(authState.session);
  const isAdmin = authState.user?.app_metadata?.oraklo_admin === true;

  document.querySelectorAll("[data-profile-karma]").forEach((node) => {
    node.textContent = formatAuthNumber(profile.karma);
    const pill = node.closest(".karma-pill");
    if (pill) {
      pill.setAttribute("aria-label", `Karma disponible: ${formatAuthNumber(profile.karma)}`);
    }
  });

  document.querySelectorAll("[data-profile-prestige]").forEach((node) => {
    node.textContent = formatAuthNumber(profile.prestige);
  });

  document.querySelectorAll("[data-profile-rank]").forEach((node) => {
    node.textContent = profile.rank;
  });

  document.querySelectorAll("[data-profile-username]").forEach((node) => {
    node.textContent = isAuthenticated ? profile.username : "Entrar";
    node.setAttribute(
      "aria-label",
      isAuthenticated ? `Usuario ${profile.username}` : "Entrar en Oraklo"
    );

    if (node.matches("[data-auth-state='user']")) {
      node.setAttribute("aria-haspopup", "menu");
      node.setAttribute("aria-controls", "oraklo-user-menu");
      node.setAttribute("aria-expanded", String(userMenuOpen));
      node.dataset.profileTheme = profile.profileTheme || "aurora";
    }
  });

  document.querySelectorAll("[data-auth-state='guest']").forEach((node) => {
    node.hidden = isAuthenticated;
  });

  document.querySelectorAll("[data-auth-state='user']").forEach((node) => {
    node.hidden = !isAuthenticated;
  });

  document.querySelectorAll("[data-admin-only]").forEach((node) => {
    node.hidden = !isAuthenticated || !isAdmin;
  });

  document.body.classList.toggle("is-authenticated", isAuthenticated);
  document.body.classList.toggle("is-oraklo-admin", isAuthenticated && isAdmin);

  if (userMenuOpen) {
    renderUserMenu();
  }
}

async function loadProfileForUser(user, fallbackProfile = null) {
  if (!authClient || !user) {
    return { ...guestProfile };
  }

  const { data, error } = await authClient
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return mapProfileFromSupabase(fallbackProfile, user);
  }

  return mapProfileFromSupabase(data, user);
}

async function applySession(session) {
  authState.session = session || null;
  authState.user = session?.user || null;
  authState.profile = authState.user ? await loadProfileForUser(authState.user) : { ...guestProfile };
  updateHeaderSessionState();
  notifyAuthListeners();
}

function setAuthStatus(message, tone = "neutral") {
  const statusNode = document.querySelector("#auth-status");
  if (!statusNode) return;
  statusNode.textContent = message || "";
  statusNode.className = `auth-status ${tone ? `auth-status-${tone}` : ""}`.trim();
  statusNode.hidden = !message;
}

function setAuthMode(mode) {
  authMode = mode;
  const isSignup = authMode === "signup";
  const titleNode = document.querySelector("#auth-modal-title");
  const submitNode = document.querySelector("#auth-submit");
  const usernameGroup = document.querySelector("#auth-username-group");
  const usernameInput = document.querySelector("#auth-username");

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.authMode === authMode));
  });

  if (titleNode) {
    titleNode.textContent = isSignup ? "Crear cuenta" : "Iniciar sesión";
  }

  if (submitNode) {
    submitNode.textContent = isSignup ? "Crear cuenta" : "Entrar";
  }

  if (usernameGroup && usernameInput) {
    usernameGroup.hidden = !isSignup;
    usernameInput.required = isSignup;
  }

  setAuthStatus("");
}

function injectAuthModal() {
  if (document.querySelector("#auth-modal")) return;

  const modal = document.createElement("div");
  modal.className = "modal-backdrop auth-modal-backdrop";
  modal.id = "auth-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <section class="modal auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-modal-title" aria-describedby="auth-status">
      <button class="modal-close" id="auth-modal-close" type="button" aria-label="Cerrar acceso">×</button>
      <p class="eyebrow">Acceso Oraklo</p>
      <h2 id="auth-modal-title">Iniciar sesión</h2>
      <div class="auth-tabs" role="group" aria-label="Modo de acceso">
        <button type="button" data-auth-mode="login" aria-pressed="true">Iniciar sesión</button>
        <button type="button" data-auth-mode="signup" aria-pressed="false">Crear cuenta</button>
      </div>
      <form class="auth-form" id="auth-form">
        <label id="auth-username-group" hidden>
          <span>Username</span>
          <input id="auth-username" type="text" autocomplete="username" minlength="3" maxlength="24" placeholder="@Visionario">
        </label>
        <label>
          <span>Email</span>
          <input id="auth-email" type="email" autocomplete="email" required placeholder="tu@email.com">
        </label>
        <label>
          <span>Password</span>
          <input id="auth-password" type="password" autocomplete="current-password" required minlength="6" placeholder="Mínimo 6 caracteres">
        </label>
        <p class="auth-status" id="auth-status" hidden></p>
        <button class="primary-button auth-submit" id="auth-submit" type="submit">Entrar</button>
      </form>
      <p class="prototype-warning">Sin dinero real. El Prestigio se actualizará cuando los mercados se resuelvan.</p>
    </section>
  `;

  document.body.appendChild(modal);
  setAuthMode("login");
}

function openAuthModal(message = "") {
  injectAuthModal();
  const modal = document.querySelector("#auth-modal");
  modal.hidden = false;
  setAuthMode("login");
  setAuthStatus(message, message ? "info" : "neutral");
  document.querySelector("#auth-email")?.focus();
}

function closeAuthModal() {
  const modal = document.querySelector("#auth-modal");
  if (modal) {
    modal.hidden = true;
  }
}

function normalizeUsername(username) {
  const trimmed = username.trim();
  if (!trimmed) return "";
  return trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  if (!authClient) {
    setAuthStatus("Supabase no está disponible ahora mismo.", "error");
    return;
  }

  const email = document.querySelector("#auth-email")?.value.trim();
  const password = document.querySelector("#auth-password")?.value;
  const username = normalizeUsername(document.querySelector("#auth-username")?.value || "");
  const submitButton = document.querySelector("#auth-submit");

  if (authMode === "signup" && !username) {
    setAuthStatus("Elige un username para crear la cuenta.", "error");
    return;
  }

  submitButton.disabled = true;
  setAuthStatus(authMode === "signup" ? "Creando cuenta..." : "Entrando...", "info");

  try {
    if (authMode === "signup") {
      const { data, error } = await authClient.auth.signUp({
        email,
        password,
        options: {
          data: { username }
        }
      });

      if (error) throw error;

      if (data.session) {
        await applySession(data.session);
        setAuthStatus("Cuenta creada. Ya estás dentro.", "success");
        window.setTimeout(closeAuthModal, 700);
      } else {
        setAuthStatus("Cuenta creada. Revisa tu email para confirmar el acceso.", "success");
      }
    } else {
      const { data, error } = await authClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await applySession(data.session);
      setAuthStatus("Sesión iniciada.", "success");
      window.setTimeout(closeAuthModal, 500);
    }
  } catch (error) {
    setAuthStatus(error.message || "No se ha podido completar el acceso.", "error");
  } finally {
    submitButton.disabled = false;
  }
}

async function signOut() {
  if (!authClient) return;
  closeUserMenu();
  await authClient.auth.signOut();
  await applySession(null);
}

function bindAuthUi() {
  injectAuthModal();
  injectUserMenu();

  document.addEventListener("click", (event) => {
    const openButton = event.target.closest("[data-auth-open]");
    const signOutButton = event.target.closest("[data-auth-signout]");
    const modeButton = event.target.closest("[data-auth-mode]");
    const profileButton = event.target.closest(
      "[data-auth-state='user'][data-profile-username]"
    );
    const clickedInsideUserMenu = event.target.closest("#oraklo-user-menu");

    if (openButton) {
      openAuthModal(openButton.dataset.authMessage || "");
    }

    if (signOutButton) {
      signOut();
    }

    if (modeButton) {
      setAuthMode(modeButton.dataset.authMode);
    }

    if (profileButton && authState.profile?.id) {
      event.preventDefault();
      toggleUserMenu(profileButton);
      return;
    }

    if (userMenuOpen && !clickedInsideUserMenu) {
      closeUserMenu();
    }
  });

  document.querySelector("#auth-modal-close")?.addEventListener("click", closeAuthModal);
  document.querySelector("#auth-form")?.addEventListener("submit", handleAuthSubmit);
  document.querySelector("#auth-modal")?.addEventListener("click", (event) => {
    if (event.target.id === "auth-modal") {
      closeAuthModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    const modal = document.querySelector("#auth-modal");
    if (event.key === "Escape" && modal && !modal.hidden) {
      closeAuthModal();
    }
    if (event.key === "Escape" && userMenuOpen) {
      closeUserMenu();
    }
  });

  window.addEventListener("resize", closeUserMenu);
  window.addEventListener("scroll", closeUserMenu, { passive: true });
}

async function requireAuth(options = {}) {
  await authReady;
  if (authState.session) {
    return getCurrentAuthState();
  }

  openAuthModal(options.message || "Inicia sesión para continuar.");
  return null;
}

function onAuthChange(listener) {
  authListeners.add(listener);
  if (authState.ready) {
    listener(getCurrentAuthState());
  }

  return () => authListeners.delete(listener);
}

async function refreshProfile() {
  if (!authState.user) {
    return getCurrentAuthState();
  }

  authState.profile = await loadProfileForUser(authState.user, authState.profile);
  updateHeaderSessionState();
  notifyAuthListeners();
  return getCurrentAuthState();
}

function applyProfileSnapshot(profileRow) {
  if (!authState.user || !profileRow) {
    return getCurrentAuthState();
  }

  authState.profile = mapProfileFromSupabase(profileRow, authState.user);
  updateHeaderSessionState();
  notifyAuthListeners();
  return getCurrentAuthState();
}

async function initializeAuth() {
  bindAuthUi();
  updateHeaderSessionState();

  if (!authClient) {
    authState.ready = true;
    authReadyResolver(getCurrentAuthState());
    notifyAuthListeners();
    return;
  }

  const { data } = await authClient.auth.getSession();
  let initialSession = data.session;

  if (initialSession) {
    const { data: verifiedUserData } = await authClient.auth.getUser();
    if (verifiedUserData.user) {
      initialSession = { ...initialSession, user: verifiedUserData.user };
    }
  }

  await applySession(initialSession);

  authClient.auth.onAuthStateChange((_event, session) => {
    applySession(session);
  });

  authState.ready = true;
  authReadyResolver(getCurrentAuthState());
  notifyAuthListeners();
}

window.orakloAuth = {
  ready: authReady,
  getState: getCurrentAuthState,
  onChange: onAuthChange,
  openAuthModal,
  closeAuthModal,
  requireAuth,
  refreshProfile,
  applyProfileSnapshot,
  signOut
};

window.refreshOrakloProfile = refreshProfile;

initializeAuth();
