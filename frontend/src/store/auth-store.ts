import { create } from "zustand";
import { BackendApiError, loginAdmin } from "@/lib/api/backend-client";

const TOKEN_KEY = "adminSessionToken";
const USERNAME_KEY = "adminUsername";
const ROLE_KEY = "sessionRole";

interface AuthState {
  isLoggedIn: boolean;
  isAdmin: boolean;
  username: string;
  token: string | null;
  error: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  clearAuth: (message?: string) => void;
  restoreSession: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  return {
    isLoggedIn: false,
    isAdmin: false,
    username: "",
    token: null,
    error: "",

    login: async (username: string, password: string) => {
      try {
        const data = await loginAdmin(username, password);
        window.sessionStorage.setItem(TOKEN_KEY, data.token);
        window.sessionStorage.setItem(USERNAME_KEY, data.username || username);
        window.sessionStorage.setItem(ROLE_KEY, data.role);
        set({
          isLoggedIn: true,
          isAdmin: data.is_admin,
          username: data.username || username,
          token: data.token,
          error: "",
        });
        return true;
      } catch (error) {
        const message =
          error instanceof BackendApiError
            ? error.status === 0
              ? "无法连接 FastAPI 后端，请确认 http://localhost:8000 已启动"
              : error.message
            : "Cannot connect to backend service";
        set({ error: message });
        return false;
      }
    },

    logout: () => {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(USERNAME_KEY);
      window.sessionStorage.removeItem(ROLE_KEY);
      set({ isLoggedIn: false, isAdmin: false, username: "", token: null, error: "" });
    },

    clearAuth: (message = "") => {
      window.sessionStorage.removeItem(TOKEN_KEY);
      window.sessionStorage.removeItem(USERNAME_KEY);
      window.sessionStorage.removeItem(ROLE_KEY);
      set({ isLoggedIn: false, isAdmin: false, username: "", token: null, error: message });
    },

    restoreSession: () => {
      const token = window.sessionStorage.getItem(TOKEN_KEY);
      const username = window.sessionStorage.getItem(USERNAME_KEY) || "";
      const role = window.sessionStorage.getItem(ROLE_KEY);
      if (!token) return;
      set({ isLoggedIn: true, isAdmin: role === "admin", username, token, error: "" });
    },
  };
});
