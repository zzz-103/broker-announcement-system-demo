import { create } from "zustand";
import { clearSession, createDemoAdmin, getDemoUser, getSessionUserId, loginDemoUser, registerDemoUser, setSessionUser, type DemoUser } from "@/lib/local-platform-service";

interface AuthState {
  user: DemoUser | null;
  error: string;
  restoreSession: () => void;
  login: (username: string, password: string) => Promise<boolean>;
  register: (input: { username: string; password: string; name: string; email: string; department: string }) => Promise<void>;
  createAdmin: (input: { username: string; password: string; name: string }) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  error: "",
  restoreSession: () => {
    const userId = getSessionUserId();
    set({ user: userId ? getDemoUser(userId) : null, error: "" });
  },
  login: async (username, password) => {
    try {
      const user = await loginDemoUser(username, password);
      setSessionUser(user.id);
      set({ user, error: "" });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : "演示登录失败" });
      return false;
    }
  },
  register: async (input) => { await registerDemoUser(input); },
  createAdmin: async (input) => { await createDemoAdmin(input); },
  logout: () => { clearSession(); set({ user: null, error: "" }); },
}));
