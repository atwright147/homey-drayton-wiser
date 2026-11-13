---
name: homey-cli
description: Use the Homey CLI to validate, build, install, run, or diagnose this Drayton Wiser app on Homey Pro, including remote pairing tests and post-install checks.
---

# Homey CLI

Work from the repository root. Follow `AGENTS.md` for project rules and `docs/development.md` for pairing details. Use the existing `homey-devices` or `quality-release` agent when the task calls for delegated device work or release review; this skill supplies the CLI procedure.

## Choose the operation

- For a code change, run the relevant local checks, then `homey app validate --level publish`. Run `homey app build` when packaging or runtime behavior needs checking.
- Use `homey app install` for an authorized persistent installation on the selected Homey.
- Use `homey app run --remote` for authorized pairing and live development tests. The default Docker mode does not reliably route this app's pairing session.
- Check `homey select current` against the intended target before a live command; use `homey list` when the target is unclear. Avoid `--clean` unless the user explicitly asks to delete app data and paired devices. Avoid `--skip-build` unless the build has already been verified for the exact source being installed.

## Verify a live result

Do not rely on the CLI exit code alone. Inspect its output, then use read-only Homey CLI or API checks to confirm the app is installed and running, devices are available, and expected readings update. Report which live checks were performed. Pairing or heating and hot-water control writes require authorization for those actions; an install or release review request alone does not authorize them. Keep hub secrets, tokens, and full private payloads out of logs and reports.

If installation reports `Missing File` or an apparent success without the expected app state, check `homey --version` and try a current CLI before retrying once. In this project, CLI 4.4.1 produced that misleading result while 4.6.3 installed successfully; treat those versions as incident history, not a pinned requirement. If edited code or pairing views do not appear, clear the ignored `.homeybuild` cache and rebuild before another run.
