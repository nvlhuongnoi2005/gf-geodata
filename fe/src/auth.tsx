import {
  createContext,
  useContext,
  useEffect,
  useMemo,
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

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restore = async () => {
      const headers = new Headers({ "Content-Type": "application/json" });
      const csrf = csrfToken();
      // Without the companion CSRF cookie no browser session can be refreshed.
      // Skipping the request avoids an expected 401 for a first-time visitor.
      if (!csrf) {
        setIsLoading(false);
        return;
      }
      headers.set("X-CSRF-Token", csrf);
      try {
        const response = await fetch("/auth/refresh", {
          method: "POST",
          headers,
          credentials: "include",
          body: "{}",
        });
        if (response.ok) {
          const payload = (await response.json()) as TokenResponse;
          setAccessToken(payload.access_token);
          setUser(payload.user);
        }
      } catch {
        // Backend not reachable, stay in signed-out state
      } finally {
        setIsLoading(false);
      }
    };
    void restore();
  }, []);

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
        setAccessToken(null);
        setUser(null);
        return { ok: false, reason: "notAdmin" };
      }
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
      setAccessToken(null);
      setUser(null);
    }
  };

  const value = useMemo(
    () => ({ user, isLoading, accessToken, login, logout }),
    [accessToken, isLoading, user]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
