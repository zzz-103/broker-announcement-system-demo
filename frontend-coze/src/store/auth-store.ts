import { create } from "zustand";
import {
  applyForUser,
  getCurrentUser,
  loginDemoUser,
  logoutDemoUser,
  type DemoUser,
} from "@/lib/local-platform-service";

interface AuthState {
  user: DemoUser | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  username: string;
  token: string | null;
  error: string;
  restoreSession: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  register: (input: { username: string; password: string; name: string; email: string; department: string }) => Promise<void>;
  createAdmin: (input: { username: string; password: string; name: string }) => Promise<void>;
  logout: () => Promise<void>;
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
  restoreSession: async () => {
    try {
      set({ ...stateForUser(await getCurrentUser()), error: "" });
    } catch (error) {
      set({ ...stateForUser(null), error: error instanceof Error ? error.message : "会话恢复失败" });
    }
  },
  login: async (username, password) => {
    try {
      const user = await loginDemoUser(username, password);
      set({ ...stateForUser(user), error: "" });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "登录失败，请稍后重试" });
      return false;
    }
  },
  register: async (input) => {
    await applyForUser({ name: input.name, email: input.email, department: input.department });
  },
  createAdmin: async (input) => {
    await applyForUser({ name: input.name, email: "admin@example.invalid", department: "" });
  },
  logout: async () => {
    try {
      await logoutDemoUser();
    } finally {
      set({ ...stateForUser(null), error: "" });
    }
  },
  clearAuth: (message = "") => {
    set({ ...stateForUser(null), error: "" });
    set({ ...stateForUser(null), error: message });
  },
}));
