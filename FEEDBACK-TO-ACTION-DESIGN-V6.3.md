# FeedbackLoop V6.3 — Feedback to Action design

## Scope

V6.3 improves the path from receiving feedback to acting on it. It deliberately excludes V6.4 spaced resurfacing and the topic-based exam-readiness map.

## Live feedback sessions

A teacher creates a session for one assigned class and provides the shared activity details. The session stores:

```text
classId
subjectId
pupilIds
feedbackType
title
skill
assessmentComponent
instructions
date
status
createdBy
```

The `pupilIds` array is a roster snapshot used both for display and Firestore access control. A pupil sees only open sessions containing their UID. Closing a session prevents new starts while preserving existing drafts. Archiving removes it from the ordinary teacher session list without deleting records.

Pupil feedback records link back through `sessionId`. Existing autosave behaviour provides the live teacher view; keystrokes are not streamed character by character.

## Mistake and improvement bank

Each completed pupil feedback record can be represented as an improvement item. Existing records are converted in memory when displayed, so V6.2 data needs no rewrite. A stored item is created when the pupil submits new feedback, edits the improvement details or pins an older item.

Stored fields include:

```text
feedbackId
pupilId
classId
subjectId
title
topic
mistake
mistakeHtml
improvementPlan
status
confidence
pinned
evidence
dateIdentified
```

Statuses are:

```text
New
Practising
Improved
Secure
Needs revisiting
```

The bank can be filtered by status and topic and searched across mistakes, plans and evidence. Similar topic labels show a related-record count but are not automatically merged.

## Transparent support indicators

The automatic concern score is built from visible contributions rather than a hidden label. Current contributions include target gap, declining results, open feedback loops, repeated red confidence and active intervention.

The calculated score and level are always retained. A staff review creates a separate `riskOverrides` record containing:

```text
pupilId
classId
calculatedLevel
selectedLevel
decision
reason
reviewDate
active
createdBy
createdByName
```

A class-specific review takes priority in that class. A school-wide review is used only when there is no class-specific review. Superseded reviews remain stored but are marked inactive. Each new review also writes an audit event.

## Rich formatting and PDF

The editor supports:

- bold;
- yellow, green, pink and blue highlight;
- bulleted lists;
- numbered lists;
- clear formatting.

All rich text is sanitised through an allow-list before storage and again before PDF output. Scripts, links, arbitrary styles and unsupported HTML are discarded.

The pupil PDF workflow is a print-optimised browser report. The pupil selects report type, subject and optional date range, then uses the browser’s **Save as PDF** destination. Approved rich formatting is retained and confidential teacher-only notes are excluded.

## Compatibility

V6.3 does not alter V6.2 role maps, class IDs, pupil IDs, learner IDs, assessments, feedback IDs or transfer history. The class migration process additionally carries stored improvement-bank items when a class is moved. Feedback sessions and risk reviews are workspace operational records and are not copied as part of the historical class migration.
