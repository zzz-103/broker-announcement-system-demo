"use client";

import { useEffect } from "react";

import { APP_VERSION } from "@/lib/app-version";

type DeploymentVersion = {
  version?: unknown;
};

const VERSION_CHECK_INTERVAL_MS = 60_000;
const VERSION_QUERY_KEY = "__app_version";

export function DeploymentVersionGuard() {
  useEffect(() => {
    let checking = false;

    const checkVersion = async () => {
      if (checking) return;
      checking = true;
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" },
        });
        if (!response.ok) return;

        const payload = (await response.json()) as DeploymentVersion;
        const deployedVersion =
          typeof payload.version === "string" ? payload.version.trim() : "";
        if (!deployedVersion || deployedVersion === APP_VERSION) return;

        const target = new URL(window.location.href);
        target.searchParams.set(VERSION_QUERY_KEY, deployedVersion);
        window.location.replace(target.toString());
      } catch {
        // A transient version-check failure must not interrupt dashboard use.
      } finally {
        checking = false;
      }
    };

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkVersion();
    };

    void checkVersion();
    const intervalId = window.setInterval(
      () => void checkVersion(),
      VERSION_CHECK_INTERVAL_MS,
    );
    window.addEventListener("focus", checkVersion);
    window.addEventListener("pageshow", checkVersion);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkVersion);
      window.removeEventListener("pageshow", checkVersion);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  return null;
}
