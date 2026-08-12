import { create } from "zustand";
import { BackendApiError, getApiBaseUrlLabel, loginAdmin } from "@/lib/api/backend-client";
import { getAuditContext } from "@/lib/audit-context";

const TOKEN_KEY = "adminSessionToken";
const USERNAME_KEY = "adminUsername";
const EMAIL_KEY = "sessionEmail";
const ROLE_KEY = "sessionRole";
const SUPER_ADMIN_KEY = "sessionIsSuperAdmin";

interface AuthState {
  isHydrated: boolean;
  isLoggedIn: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  username: string;
  email: string;
  token: string | null;
  error: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearAuth: (message?: string) => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  return {
    isHydrated: false,
    isLoggedIn: false,
    isAdmin: false,
    isSuperAdmin: false,
    username: "",
    email: "",
    token: null,
    error: "",

    login: async (username: string, password: string) => {
      try {
        const data = await loginAdmin(username, password, getAuditContext());
        window.sessionStorage.setItem(TOKEN_KEY, data.token);
        const displayName = data.name || data.username || username;
        window.sessionStorage.setItem(USERNAME_KEY, displayName);
        const email = data.email?.trim() || "";
        window.sessionStorage.setItem(EMAIL_KEY, email);
        window.sessionStorage.setItem(ROLE_KEY, data.role);
        window.sessionStorage.setItem(SUPER_ADMIN_KEY, String(data.is_super_admin));
        set({
          isHydrated: true,
          isLoggedIn: true,
          isAdmin: data.is_admin,
          isSuperAdmin: data.is_super_admin,
          username: displayName,
          email,
          token: data.token,
          error: "",
        });
        return true;
      } catch (error) {
        const message =
          error instanceof BackendApiError
            ? error.status === 0
              ? `无法访问后端 API（${getApiBaseUrlLabel()}），请检查 FastAPI 端口或网关配置`
              : error.message
            : "Cannot connect to backend service";
        set({ error: message });
        return false;
      }
    },

    logout: () => {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(USERNAME_KEY);
      window.sessionStorage.removeItem(EMAIL_KEY);
      window.sessionStorage.removeItem(ROLE_KEY);
      window.sessionStorage.removeItem(SUPER_ADMIN_KEY);
      set({ isHydrated: true, isLoggedIn: false, isAdmin: false, isSuperAdmin: false, username: "", email: "", token: null, error: "" });
    },

    clearAuth: (message = "") => {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(USERNAME_KEY);
      window.sessionStorage.removeItem(EMAIL_KEY);
      window.sessionStorage.removeItem(ROLE_KEY);
      window.sessionStorage.removeItem(SUPER_ADMIN_KEY);
      set({ isHydrated: true, isLoggedIn: false, isAdmin: false, isSuperAdmin: false, username: "", email: "", token: null, error: message });
    },

    restoreSession: () => {
      const token = window.sessionStorage.getItem(TOKEN_KEY);
      const username = window.sessionStorage.getItem(USERNAME_KEY) || "";
      const email = window.sessionStorage.getItem(EMAIL_KEY) || "";
      const role = window.sessionStorage.getItem(ROLE_KEY);
      const isSuperAdmin = window.sessionStorage.getItem(SUPER_ADMIN_KEY) === "true";
      if (!token) {
        set({ isHydrated: true });
        return;
      }
      set({ isHydrated: true, isLoggedIn: true, isAdmin: role === "admin", isSuperAdmin, username, email, token, error: "" });
    },
  };
});
