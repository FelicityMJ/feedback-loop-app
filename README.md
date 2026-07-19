# FeedbackLoop V6.2

FeedbackLoop is a static GitHub Pages/Firebase school feedback platform built around pupil-entered feedback, teacher class dashboards, department oversight and portable learner histories.

## V6.2 highlights

- One staff login can hold school-administrator, department-head and teacher permissions in the same school.
- Staff switch between **My classes**, **Department overview** and **School administration** without separate profiles.
- Department heads automatically retain teacher access.
- School administrators can manage staff permissions, school setup, internal codes, licences, migration approvals and audit records.
- Initial school and independent-teacher workspaces require an owner-issued pilot activation code.
- Complimentary, active, paused and trial workspace states are represented without deleting school data.
- Existing V6.1 single-role accounts convert safely to V6.2 permission maps.
- Class migration is browser-based, deterministic and resumable.
- Existing pupils reconnect to the destination workspace automatically with the same account and learner ID.
- Classes, results, feedback, reflections and interventions retain migration-origin metadata so histories are not duplicated in exports.

## Existing learning workflow

The app also includes:

- school → department → subject → class structure;
- reusable pupil class codes and scoped staff codes;
- multiple teachers per class;
- pupil-created feedback and assessment records;
- autosaved drafts and live teacher monitoring;
- rich-text strengths and next steps;
- detailed grade and target tracking;
- pupil reflection and closed feedback loops;
- class, pupil and department dashboards;
- at-risk indicators and interventions;
- portable learner IDs, email-change approval and school transfer requests;
- CSV, JSON and printable pupil exports;
- Firebase Authentication, Firestore and security rules;
- a V6.2 multi-role demo.

## Preview

Run through a local web server because the app uses JavaScript modules:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

When Firebase is configured, the site connects to the project in `js/firebase-config.js`. Set `appSettings.forceDemoMode` to `true` temporarily to preview the fictional demo against a configured project.

## Upgrade from V6.1

Read `UPDATE-GUIDE-V6.2.md` before replacing files or publishing rules. The supplied `scripts/backfill-v62-roles.mjs` has a dry-run mode and does not alter class IDs, pupils, results or feedback history.

## Main files

- `index.html` — app entry point.
- `styles.css` — responsive interface.
- `js/app.js` — dashboards, role-area switching and interactions.
- `js/firebase-service.js` — authentication, permissions, Firestore access and migration.
- `js/demo-data.js` — fictional V6.2 data.
- `js/firebase-config.js` — the existing Firebase web configuration.
- `firestore.rules` — V6.2 access rules.
- `firestore.indexes.json` — index configuration.
- `SETUP-GUIDE.md` — owner setup instructions.
- `UPDATE-GUIDE-V6.2.md` — exact V6.1 upgrade sequence.
- `MULTI-ROLE-AND-MIGRATION-DESIGN-V6.2.md` — technical design.
- `scripts` — owner-only Admin SDK tools for activation codes and backfill.

## Pilot boundary

Continue to use fictional accounts until the V6.2 rules have been compiled and tested in a separate Firebase project or Firestore emulator. Before unrestricted production use, move staff-role mutation, licence enforcement and larger migrations to trusted Cloud Functions.

## Licence

Copyright © 2026 Felicity Miller. All rights reserved. See `LICENSE.txt`.
