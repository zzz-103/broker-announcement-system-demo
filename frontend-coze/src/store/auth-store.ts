import { create } from "zustand";
import {
  clearSession,
  createDemoAdmin,
  getDemoUser,
  getSessionUserId,
  loginDemoUser,
  registerDemoUser,
  setSessionUser,
  type DemoUser,
} from "@/lib/local-platform-service";

interface AuthState {
  user: DemoUser | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  username: string;
  token: string | null;
  error: string;
  restoreSession: () => void;
  login: (username: string, password: string) => Promise<boolean>;
  register: (input: { username: string; password: string; name: string; email: string; department: string }) => Promise<void>;
  createAdmin: (input: { username: string; password: string; name: string }) => Promise<void>;
  logout: () => void;
  clearAuth: (message?: string) => void;
}

function stateForUser(user: DemoUser | null) {
  return {
    user,
    isLoggedIn: Boolean(user),
    isAdmin: Boolean(user?.isAdmin),
    username: user?.username ?? "",
    token: user?.id ?? null,
  };
}

export const useAuthStore = create<AuthState>((set) => ({
  ...stateForUser(null),
  error: "",
  restoreSession: () => {
    const userId = getSessionUserId();
    set({ ...stateForUser(userId ? getDemoUser(userId) : null), error: "" });
  },
  login: async (username, password) => {
    try {
      const user = await loginDemoUser(username, password);
      setSessionUser(user.id);
      set({ ...stateForUser(user), error: "" });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "登录失败，请稍后重试" });
      return false;
    }
  },
  register: async (input) => {
    await registerDemoUser(input);
  },
  createAdmin: async (input) => {
    await createDemoAdmin(input);
  },
  logout: () => {
    clearSession();
    set({ ...stateForUser(null), error: "" });
  },
  clearAuth: (message = "") => {
    clearSession();
    set({ ...stateForUser(null), error: message });
  },
}));
