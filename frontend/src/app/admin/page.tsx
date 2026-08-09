"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth-store";
import { LoginPageWithApply } from "@/components/login-page-with-apply";
import { SessionLoading } from "@/components/session-loading";

const AdminDashboard = dynamic(
  () => import("@/features/admin/admin-dashboard").then((m) => m.AdminDashboard),
  { ssr: false },
);

export default function AdminPage() {
  const router = useRouter();
  const { isHydrated, isLoggedIn, isAdmin } = useAuthStore();
  const restoreSession = useAuthStore((state) => state.restoreSession);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  useEffect(() => {
    if (isHydrated && isLoggedIn && !isAdmin) {
      router.replace("/custom-intelligence");
    }
  }, [isAdmin, isHydrated, isLoggedIn, router]);

  if (!isHydrated) return <SessionLoading />;

  if (!isLoggedIn) {
    return <LoginPageWithApply />;
  }

  if (!isAdmin) {
    return null;
  }

  return <AdminDashboard onBack={() => router.push("/")} />;
}
