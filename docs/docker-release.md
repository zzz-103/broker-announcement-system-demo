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
