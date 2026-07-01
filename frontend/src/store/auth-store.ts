import { create } from "zustand";

interface AuthState {
  isLoggedIn: boolean;
  isAdmin: boolean;
  username: string;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  isAdmin: false,
  username: "",

  login: async (username: string, password: string) => {
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        const data = await res.json();
        set({
          isLoggedIn: true,
          isAdmin: data.isAdmin,
          username: data.username,
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  logout: () => {
    set({ isLoggedIn: false, isAdmin: false, username: "" });
  },
}));
