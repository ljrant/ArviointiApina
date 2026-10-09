# ArviointiApina

ArviointiApina is primarily a **Tampermonkey userscript** for teacher-side grading workflows around Abitti.

## Primary project: Tampermonkey userscript

Install the current script:

https://raw.githubusercontent.com/ljrant/ArviointiApina/main/userscript/ArviointiApina.user.js

Project website:

https://ljrant.github.io/ArviointiApina/

### Current goals

- collect total exam scores from Abitti review pages
- maintain multiple courses/classes
- match students primarily by normalized/fuzzy name, then email
- treat Abitti UUID only as a last-resort hint because it can change between exams
- store earned points and explicit maximum points for each assessment
- weighted assessments and per-student weight overrides/exclusions
- Finnish 4–10 and IB 1–7 grade boundaries
- CSV export and full JSON backup/restore
- compact grade panel usable on other websites

## Repository layout

- `userscript/ArviointiApina.user.js` — primary Tampermonkey userscript
- `web/` — presentation/documentation website for the userscript
- `src/`, `manifest.json` — experimental Chrome extension prototype
- `.github/workflows/pages.yml` — deploys the presentation website

## Browser extension / standalone app

The Chrome-extension code currently in the repository is experimental. It may later become a standalone browser extension/app, but the userscript is the primary implementation for now.

## Data and privacy

ArviointiApina is local-first. Gradebook data is stored locally by the userscript manager. The project does not require an ArviointiApina cloud account or server.

Teachers should protect browser profiles and exported backups appropriately because the data can contain student assessment information.

## Development

Changes to the userscript should be made in `userscript/ArviointiApina.user.js`. Keep the website focused on installation, documentation, privacy, and project status rather than implementing a separate web gradebook.
