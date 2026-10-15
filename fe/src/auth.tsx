import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  scopes: string[];
};

type TokenResponse = { access_token: string; user: AuthUser };
export type LoginFailureReason = "invalidCredentials" | "notAdmin" | "connection";
type LoginResult = { ok: true } | { ok: false; reason: LoginFailureReason };
type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  accessToken: string | null;
  authenticatedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  ensureAccessToken: () => Promise<string | null>;
  login: (email: string, password: string) => Promise<LoginResult>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function csrfToken(): string | undefined {
  return document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith("csrf_token="))
    ?.slice("csrf_token=".length);
}

function tokenRefreshDelay(token: string): number {
  try {
    const base64 = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 ? base64.padEnd(Math.ceil(base64.length / 4) * 4, "=") : undefined;
    const payload = padded ? (JSON.parse(atob(padded)) as { exp?: number }) : null;
    if (typeof payload?.exp === "number") {
      return Math.max(5_000, payload.exp * 1_000 - Date.now() - 60_000);
    }
  } catch {
    // A malformed token is retried by the API wrapper and then discarded.
  }
  return 10 * 60_000;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const accessTokenRef = useRef<string | null>(null);
  const refreshInFlight = useRef<Promise<string | null> | null>(null);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const refreshSession = useCallback(async (): Promise<string | null> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const csrf = csrfToken();
    if (!csrf) {
      setAccessToken(null);
      setUser(null);
      return null;
    }
    refreshInFlight.current = (async () => {
      try {
        const response = await fetch("/auth/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
          credentials: "include",
          body: "{}",
        });
        if (!response.ok) throw new Error(`refresh failed: ${response.status}`);
        const payload = (await response.json()) as TokenResponse;
        if (!payload.access_token || payload.user?.role !== "admin")
          throw new Error("invalid refresh response");
        accessTokenRef.current = payload.access_token;
        setAccessToken(payload.access_token);
        setUser(payload.user);
        return payload.access_token;
      } catch {
        accessTokenRef.current = null;
        setAccessToken(null);
        setUser(null);
        return null;
      } finally {
        refreshInFlight.current = null;
      }
    })();
    return refreshInFlight.current;
  }, []);

  useEffect(() => {
    const restore = async () => {
      const csrf = csrfToken();
      // Without the companion CSRF cookie no browser session can be refreshed.
      // Skipping the request avoids an expected 401 for a first-time visitor.
      if (!csrf) {
        setIsLoading(false);
        return;
      }
      try {
        await refreshSession();
      } finally {
        setIsLoading(false);
      }
    };
    void restore();
  }, [refreshSession]);

  useEffect(() => {
    if (!accessToken) return;
    const timer = window.setTimeout(() => void refreshSession(), tokenRefreshDelay(accessToken));
    return () => window.clearTimeout(timer);
  }, [accessToken, refreshSession]);

  const authenticatedFetch = useCallback(
    async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const send = (token: string | null) => {
        const headers = new Headers(init.headers);
        if (token) headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers, credentials: "include" });
      };
      const first = await send(accessTokenRef.current);
      if (first.status !== 401) return first;
      const refreshed = await refreshSession();
      if (!refreshed) return first;
      return send(refreshed);
    },
    [refreshSession]
  );

  const ensureAccessToken = useCallback(async () => {
    const token = accessTokenRef.current;
    // Uploads use XMLHttpRequest for progress reporting, so they cannot use
    // authenticatedFetch's automatic 401 retry. Refresh just before starting
    // an upload when the current JWT is about to expire.
    if (!token || tokenRefreshDelay(token) <= 5_000) return refreshSession();
    return token;
  }, [refreshSession]);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) return { ok: false, reason: "invalidCredentials" };

      const payload = (await response.json()) as TokenResponse;
      if (payload.user.role !== "admin") {
        accessTokenRef.current = null;
        setAccessToken(null);
        setUser(null);
        return { ok: false, reason: "notAdmin" };
      }
      accessTokenRef.current = payload.access_token;
      setAccessToken(payload.access_token);
      setUser(payload.user);
      return { ok: true };
    } catch {
      return { ok: false, reason: "connection" };
    }
  };

  const logout = async () => {
    const headers = new Headers({ "Content-Type": "application/json" });
    const csrf = csrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
    if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
    try {
      await fetch("/auth/logout", {
        method: "POST",
        headers,
        credentials: "include",
        body: "{}",
      });
    } finally {
      accessTokenRef.current = null;
      setAccessToken(null);
      setUser(null);
    }
  };

  const value = useMemo(
    () => ({ user, isLoading, accessToken, authenticatedFetch, ensureAccessToken, login, logout }),
    [accessToken, authenticatedFetch, ensureAccessToken, isLoading, user]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
