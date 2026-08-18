// ============================================================================
// Einfacher Passwortschutz (nur clientseitig!). KEINE echte Sicherheit –
// das Passwort steht im Code und lässt sich technisch umgehen. Dient nur als
// simple Sperre, damit nicht jeder die App direkt öffnet.
// Passwort ändern: hier anpassen.
// ============================================================================

export const APP_PASSWORD = "1991";

const AUTH_KEY = "stundenzettel-app:auth";

export function isAuthenticated(): boolean {
  try {
    return localStorage.getItem(AUTH_KEY) === "ok";
  } catch {
    return false;
  }
}

/** Prüft das Passwort und merkt sich den Login (bis „Đăng xuất"). */
export function login(password: string): boolean {
  if (password === APP_PASSWORD) {
    try {
      localStorage.setItem(AUTH_KEY, "ok");
    } catch {
      /* ignorieren */
    }
    return true;
  }
  return false;
}

export function logout(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {
    /* ignorieren */
  }
}
