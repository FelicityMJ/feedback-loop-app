# FeedbackLoop V6.3

FeedbackLoop is a static GitHub Pages/Firebase school feedback platform built around pupil-entered feedback, teacher class dashboards, department oversight and portable learner histories.

## V6.3 — Feedback to Action

V6.3 builds on the V6.2 multi-role account and migration foundation. It adds:

- teacher-led **live feedback sessions** with prepared class, title, topic, feedback type and instructions;
- live counts for submitted, active, draft, not-started and red-confidence pupils;
- a structured **mistake and improvement bank** with topics, status, confidence, pins and evidence;
- automatic use of existing feedback as bank items, so no V6.3 data backfill is required;
- transparent support-indicator points and reasons;
- teacher professional reviews and overrides that retain the original calculated level;
- audit records for support-indicator reviews;
- bulleted and numbered-list formatting alongside bold and four highlight colours;
- a pupil **Save as PDF** workflow that preserves approved rich formatting;
- PDF choices for complete record, feedback/actions, improvement bank or assessment history, with subject and date filters.

## V6.2 foundation retained

- One staff login can hold school-administrator, department-head and teacher permissions.
- Staff switch between **My classes**, **Department overview** and **School administration**.
- Department heads automatically retain teacher access.
- School and independent-teacher workspaces are invitation-only.
- Existing V6.1 roles convert safely without changing class, pupil, result or feedback IDs.
- Class migration is deterministic and resumable, with automatic pupil reconnection.

## Preview

Run through a local web server because the app uses JavaScript modules:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

When Firebase is configured, the site connects to the project in `js/firebase-config.js`. Set `appSettings.forceDemoMode` to `true` temporarily to preview fictional V6.3 data.

## Upgrade

- From an already working V6.2 installation, follow `UPDATE-GUIDE-V6.3.md`.
- From V6.1, complete `UPDATE-GUIDE-V6.2.md` first, including the role backfill, and then apply V6.3.
- V6.3 itself requires **no Admin SDK script or Firestore data backfill**.

## Main files

- `index.html` — app entry point.
- `styles.css` — responsive interface and V6.3 session, bank and risk styling.
- `js/app.js` — dashboards, rich editor, live sessions, improvement bank and professional risk reviews.
- `js/firebase-service.js` — authentication, permissions, Firestore access, portfolios and migration.
- `js/export.js` — CSV, JSON and formatted print-to-PDF learning records.
- `js/demo-data.js` — fictional V6.3 data.
- `js/firebase-config.js` — existing Firebase web configuration; do not replace with a template.
- `firestore.rules` — V6.3 access rules.
- `firestore.indexes.json` — unchanged index configuration.
- `UPDATE-GUIDE-V6.3.md` — exact V6.2 to V6.3 update sequence.
- `FEEDBACK-TO-ACTION-DESIGN-V6.3.md` — V6.3 functional and data design.
- `MULTI-ROLE-AND-MIGRATION-DESIGN-V6.2.md` — retained V6.2 foundation design.
- `scripts` — owner-only V6.2 Admin SDK tools; not required for the V6.3 update.

## Pilot boundary

Continue to use fictional accounts until the V6.3 rules and every role path have been tested in a separate Firebase project or Firestore emulator. Before unrestricted production use, move sensitive cross-school administration, licence enforcement and larger migrations to trusted Cloud Functions.

## Licence

Copyright © 2026 Felicity Miller. All rights reserved. See `LICENSE.txt`.
