# Arviointiapina

Arviointiapina is a local-first teacher grading utility for collecting exam results, combining them into a course gradebook, and calculating weighted final grades.

## Web app

The repository now includes a static web application in `web/`.

Features:
- multiple courses/classes
- students as rows and assessments as columns
- raw points + per-assessment maximum points
- adjustable default weights
- per-student weight overrides and exclusions
- missing-result redistribution or zero policy
- Finnish 4–10 and IB 1–7 boundary sets
- CSV import/export
- full JSON backup/restore
- local browser storage only

The web app deliberately does not scrape Abitti directly: a normal website cannot access another site's DOM because of browser origin isolation. The browser extension/userscript remains the collector for Abitti. Export collected results as CSV/JSON and import them into the web app.

### Local use

Open `web/index.html` in a browser, or serve the repository with any static server.

### GitHub Pages

`.github/workflows/pages.yml` deploys the `web/` directory when changes reach `main`. GitHub Pages must be enabled for the repository with **GitHub Actions** selected as the deployment source.

## Chrome extension

The existing Manifest V3 extension remains under `src/`.

Current extension goals:
- Abitti adapter
- right-hand side panel
- local-only data
- CSV grade import
- automatic grade calculation
- site-specific adapters
