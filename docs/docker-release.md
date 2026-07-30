# Windows Docker 发布

`D:\broker-announcement-system-demo` is the Git source and release-script location.
`D:\broker-system` is the production runtime location: Docker Compose, `.env`, mounted
configuration, persistent data, and containers. Do not copy source code into the runtime
directory, and do not use this repository's root `docker-compose.yml` for production releases.

## Release

1. In the demo repository, run `git pull --ff-only`.
2. Change `frontend/package.json` to the required SemVer version, commit it, and push it.
3. From `D:\broker-system`, run:

   ```powershell
   .\deploy-release.ps1 -Version 1.3.2
   ```

The release script requires a clean `master` checkout whose `HEAD` equals `origin/master`.
It builds `broker-backend:<version>` and `broker-frontend:<version>`, labels both images with
the version and Git SHA, changes only `BROKER_VERSION` in the runtime `.env`, recreates the
four production services, and checks the gateway API and homepage.

If the candidate is unhealthy, it restores the previous `BROKER_VERSION` and recreates the
previous containers. Non-sensitive release records and local `.env` backups are written under
`D:\broker-system\deploy\releases`; keep that directory protected by host permissions.

Use `-Force` only when deliberately rebuilding the currently deployed version.

The deployment `.env` may set `BROKER_PUBLIC_URL` (default
`http://localhost:8080`). On a LAN deployment, set it to the address users
actually open, for example `http://10.1.37.22:8080`; release validation checks
that address's API, homepage, and `version.json` version/Git SHA. The script
creates the runtime data directories and
requires the external Compose file to mount `runtime/app-watch-data` into the
backend API container. App Watch itself remains an on-demand subprocess.

The backend image no longer builds the Next.js frontend. Frontend dependencies
are fetched from the lockfile into a persistent BuildKit cache and installed
offline for each version build; Python wheels use persistent BuildKit caches as
well. Dependencies are downloaded again only when the lock/requirements change
or Docker's build cache is explicitly pruned.

The production gateway must send `Cache-Control: no-store` for HTML and
`version.json`. Only content-hashed `/_next/static/` assets should use the
long-lived `immutable` cache policy.

Starting with v1.4.5, the frontend checks `version.json` on startup, window
focus, visibility restore, page-cache restore, and every 60 seconds. If an open
tab is older than the deployed version, it navigates once with a versioned
cache-busting query so users do not remain on an already-loaded old dashboard.

If Docker build cache grows excessively, keep the most useful recent cache and
remove only unused build records:

```powershell
docker buildx prune --force --max-used-space 5GB
```

This does not remove running containers, tagged release images, or volumes. Do
not run `docker system prune --volumes` on the production host.
