# 033 — Fix dev startup script and DoltgreSQL credentials

> **Status:** COMPLETED
> **Priority:** P0 (critical)
> **Depends on:** None
> **Blocks:** All local development

## Problem

Running `npm run dev` (which invokes `start-dev.ps1`) failed immediately with:

```
Start-Process : This command cannot be run due to the error: %1 is not a valid Win32 application.
```

The script had been refactored in commit `8f05612` to use `Start-Process "npm"` for process-tree tracking, but `npm` on this Windows system resolves to `npm.ps1` (a PowerShell script), not an `.exe`. `Start-Process` cannot execute `.ps1` files directly.

Additionally, the DoltgreSQL credentials in `config.yaml` (`doltgres:lwf`) were out of sync with the `.env` connection string (`postgres:password`), and the `lwf_staging` database had never been created.

## Root Causes

1. **`Start-Process "npm"` fails on Windows** — `npm` is a `.ps1` shim at `C:\Program Files\nodejs\npm.ps1`. `Start-Process` requires an `.exe` binary.
2. **Credential mismatch** — `config.yaml` had user `doltgres` with password `lwf`; `.env` had user `postgres` with password `password`. The `auth.db` cached the old credentials.
3. **Missing database** — The `lwf_staging` directory existed with `.dolt` init but DoltgreSQL didn't recognize it; `CREATE DATABASE lwf_staging` was needed.
4. **DoltgreSQL popup window** — `Start-Process` without `-NoNewWindow` opened doltgres in a separate console window.

## Changes Made

### `start-dev.ps1`
- Replaced `Start-Process "npm"` with `Start-Process node.exe` running `npm-cli.js` directly — resolves the `.ps1` shim issue and handles spaces in `C:\Program Files\nodejs\`
- Added `-NoNewWindow` to the doltgres `Start-Process` call so it stays in the same console
- Added proper quoting for paths containing spaces

### `lwf-staging/config.yaml`
- Changed user from `doltgres` to `postgres`
- Changed password from `lwf` to `password`
- Matches the `DOLT_CONNECTION_STRING` in `.env`

### `admin/src/lib/dolt.ts`
- Updated fallback connection string from `doltgres:lwf` to `postgres:password`

### `.env.example`
- Updated example connection string to match new credentials

### Manual steps (not in code)
- Deleted stale `auth.db` so DoltgreSQL recreates it from config
- Ran `CREATE DATABASE lwf_staging` via psql

## Verification

- `npm run dev` starts both DoltgreSQL and Next.js admin portal in the same console
- `psql -h localhost -p 5433 -U postgres -d lwf_staging` connects successfully
- Admin portal loads at http://localhost:3000 without "database does not exist" error

## Commit Reference
<!-- filled in after commit -->
