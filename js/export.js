const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const allowedHighlightColours = new Set([
  "rgb(255, 243, 163)", "rgb(211, 245, 213)", "rgb(255, 214, 232)", "rgb(207, 229, 255)",
  "#fff3a3", "#d3f5d5", "#ffd6e8", "#cfe5ff"
]);

function safeRichHtml(value = "", fallback = "") {
  if (!value) return `<p>${escapeHtml(fallback)}</p>`;
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${String(value)}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  const allowed = new Set(["B", "STRONG", "BR", "P", "DIV", "UL", "OL", "LI", "SPAN"]);
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); continue; }
      if (!allowed.has(child.tagName)) {
        clean(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const background = child.tagName === "SPAN" ? (child.style?.backgroundColor || "") : "";
      for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
      if (child.tagName === "SPAN" && allowedHighlightColours.has(background.toLowerCase())) child.style.backgroundColor = background;
      clean(child);
    }
  };
  clean(root);
  return root.innerHTML || `<p>${escapeHtml(fallback)}</p>`;
}

const download = (filename, text, type) => {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const csvCell = (value) => {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
};

const slug = (value) => String(value || "learner").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const dateValue = (value) => {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
};
const dateLabel = (value) => dateValue(value)?.toLocaleDateString("en-GB") || "—";

export function downloadPortfolioJson(profile, portfolio) {
  download(
    `feedbackloop-${slug(profile.displayName)}.json`,
    JSON.stringify({ exportedAt: new Date().toISOString(), pupil: profile, portfolio }, null, 2),
    "application/json"
  );
}

export function downloadPortfolioCsv(profile, portfolio) {
  const rows = [[
    "Record Type", "Date", "School", "Subject", "Class", "Assessment", "Topic/Skill",
    "Score", "Max Score", "Percentage", "Grade", "Strength", "Next Step", "Status",
    "Reflection", "Action Taken", "Teacher Review"
  ]];

  const schoolName = (schoolId) => portfolio.schools?.find((x) => x.id === schoolId)?.name || schoolId || "";
  const subjectName = (subjectId) => portfolio.subjects?.find((x) => x.id === subjectId)?.name || subjectId || "";
  const className = (classId) => portfolio.classes?.find((x) => x.id === classId)?.name || classId || "";

  for (const item of portfolio.assessments || []) {
    rows.push([
      "Assessment", item.date, schoolName(item.schoolId), subjectName(item.subjectId), className(item.classId),
      item.name, item.topic, item.score, item.maxScore, item.percentage, item.grade, "", "", "", "", "", ""
    ]);
  }
  for (const item of portfolio.feedbackRecords || []) {
    const action = (portfolio.feedbackActions || []).find((x) => x.feedbackId === item.id);
    rows.push([
      "Feedback", item.date, schoolName(item.schoolId), subjectName(item.subjectId), className(item.classId),
      item.assessmentName, item.skill, "", "", "", "", item.strength, item.nextStep, item.status,
      action?.reflection || "", action?.actionTaken || "", action?.teacherReview || ""
    ]);
  }

  download(
    `feedbackloop-${slug(profile.displayName)}.csv`,
    rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8"
  );
}

function filteredPortfolio(portfolio, options = {}) {
  const from = options.dateFrom ? new Date(`${options.dateFrom}T00:00:00`) : null;
  const to = options.dateTo ? new Date(`${options.dateTo}T23:59:59`) : null;
  const include = (item) => {
    if (options.subjectId && options.subjectId !== "all" && item.subjectId !== options.subjectId) return false;
    const date = dateValue(item.date || item.dateIdentified || item.createdAt);
    if (from && date && date < from) return false;
    if (to && date && date > to) return false;
    return true;
  };
  return {
    assessments: (portfolio.assessments || []).filter(include),
    feedbackRecords: (portfolio.feedbackRecords || []).filter((item) => item.status !== "draft" && include(item)),
    improvementBank: (portfolio.improvementBank || []).filter(include)
  };
}

function improvementItems(portfolio, filtered) {
  const storedByFeedback = new Map(filtered.improvementBank.filter((item) => item.feedbackId).map((item) => [item.feedbackId, item]));
  const items = filtered.feedbackRecords.map((record) => {
    const stored = storedByFeedback.get(record.id);
    return {
      ...stored,
      feedbackId: record.id,
      subjectId: record.subjectId,
      title: stored?.title || record.assessmentName || record.skill,
      topic: stored?.topic || record.skill,
      mistake: stored?.mistake || record.nextStep,
      mistakeHtml: stored?.mistakeHtml || record.nextStepHtml,
      improvementPlan: stored?.improvementPlan || record.nextStep,
      status: stored?.status || (record.status === "closed" ? "Improved" : "New"),
      evidence: stored?.evidence || "",
      pinned: stored?.pinned === true,
      dateIdentified: stored?.dateIdentified || record.date
    };
  });
  for (const item of filtered.improvementBank) {
    if (!item.feedbackId || !filtered.feedbackRecords.some((record) => record.id === item.feedbackId)) items.push(item);
  }
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.dateIdentified || 0) - new Date(a.dateIdentified || 0));
}

export function printPortfolioReport(profile, portfolio, options = {}) {
  const mode = options.mode || "complete";
  const filtered = filteredPortfolio(portfolio, options);
  const subjectName = (subjectId) => portfolio.subjects?.find((x) => x.id === subjectId)?.name || subjectId || "Other";
  const schoolName = (schoolId) => portfolio.schools?.find((x) => x.id === schoolId)?.name || schoolId || "";
  const className = (classId) => portfolio.classes?.find((x) => x.id === classId)?.name || classId || "";
  const actions = portfolio.feedbackActions || [];
  const subjects = [...new Set([
    ...filtered.assessments.map((item) => item.subjectId),
    ...filtered.feedbackRecords.map((item) => item.subjectId)
  ].filter(Boolean))].sort((a, b) => subjectName(a).localeCompare(subjectName(b)));
  const bank = improvementItems(portfolio, filtered);
  const showAssessments = mode === "complete" || mode === "assessments";
  const showFeedback = mode === "complete" || mode === "feedback";
  const showBank = mode === "complete" || mode === "improvements";
  const dateRange = options.dateFrom || options.dateTo
    ? `${options.dateFrom ? dateLabel(options.dateFrom) : "Beginning"} to ${options.dateTo ? dateLabel(options.dateTo) : "Today"}`
    : "All dates";
  const selectedSubject = options.subjectId && options.subjectId !== "all" ? subjectName(options.subjectId) : "All subjects";

  const popup = window.open("", "_blank", "width=1000,height=800");
  if (!popup) throw new Error("Your browser blocked the PDF report window. Allow pop-ups for FeedbackLoop and try again.");

  const subjectSections = subjects.map((subjectId) => {
    const assessments = filtered.assessments.filter((item) => item.subjectId === subjectId).sort((a, b) => new Date(b.date) - new Date(a.date));
    const feedback = filtered.feedbackRecords.filter((item) => item.subjectId === subjectId).sort((a, b) => new Date(b.date) - new Date(a.date));
    return `<section class="subject-section"><h2>${escapeHtml(subjectName(subjectId))}</h2>
      ${showAssessments ? `<h3>Assessment history</h3>${assessments.length ? `<table><thead><tr><th>Date</th><th>Assessment</th><th>Class</th><th>Score</th><th>Grade</th></tr></thead><tbody>${assessments.map((item) => `<tr><td>${dateLabel(item.date)}</td><td>${escapeHtml(item.name || "")}${item.topic ? `<div class="small">${escapeHtml(item.topic)}</div>` : ""}</td><td>${escapeHtml(className(item.classId))}</td><td>${item.score ?? ""}/${item.maxScore ?? ""}${item.percentage !== null && item.percentage !== undefined ? ` (${item.percentage}%)` : ""}</td><td>${escapeHtml(item.grade || "")}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">No assessment results in this selection.</p>`}` : ""}
      ${showFeedback ? `<h3>Feedback and action record</h3>${feedback.length ? feedback.map((item) => { const action = actions.find((entry) => entry.feedbackId === item.id); return `<article class="feedback-item"><div class="item-head"><div><strong>${escapeHtml(item.assessmentName || item.skill || "Feedback")}</strong><div class="small">${dateLabel(item.date)} · ${escapeHtml(className(item.classId))} · ${escapeHtml(item.feedbackType || "Feedback")}</div></div>${item.percentage !== null && item.percentage !== undefined ? `<div class="result">${item.score}/${item.maxScore}<small>${item.percentage}% · ${escapeHtml(item.grade || "")}</small></div>` : ""}</div><div class="field-block"><span class="label">What went well</span><div class="rich">${safeRichHtml(item.strengthHtml, item.strength)}</div></div><div class="field-block"><span class="label">Next step</span><div class="rich">${safeRichHtml(item.nextStepHtml, item.nextStep)}</div></div>${action ? `<div class="two-column"><div class="field-block"><span class="label">Pupil reflection</span><p>${escapeHtml(action.reflection || "")}</p></div><div class="field-block"><span class="label">Action taken</span><p>${escapeHtml(action.actionTaken || "")}</p></div></div>${action.teacherReview ? `<div class="teacher-review"><span class="label">Teacher review</span><p>${escapeHtml(action.teacherReview)}</p></div>` : ""}` : ""}</article>`; }).join("") : `<p class="empty">No feedback records in this selection.</p>`}` : ""}
    </section>`;
  }).join("");

  const bankSection = showBank ? `<section class="subject-section"><h2>Mistake and improvement bank</h2>${bank.length ? bank.map((item) => `<article class="feedback-item"><div class="item-head"><div><strong>${escapeHtml(item.title || item.topic || "Improvement item")}</strong><div class="small">${escapeHtml(subjectName(item.subjectId))} · ${escapeHtml(item.topic || "Other")} · ${dateLabel(item.dateIdentified)}</div></div><div class="status">${escapeHtml(item.status || "New")}</div></div><div class="field-block"><span class="label">Mistake or next step</span><div class="rich">${safeRichHtml(item.mistakeHtml, item.mistake)}</div></div><div class="field-block"><span class="label">What I will do instead</span><p>${escapeHtml(item.improvementPlan || "")}</p></div>${item.evidence ? `<div class="field-block"><span class="label">Evidence of improvement</span><p>${escapeHtml(item.evidence)}</p></div>` : ""}</article>`).join("") : `<p class="empty">No improvement-bank items in this selection.</p>`}</section>` : "";

  const reportBody = `${showAssessments || showFeedback ? subjectSections : ""}${showBank ? bankSection : ""}`;

  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(profile.displayName)} learning record</title>
    <style>
      @page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#16213d;margin:0;line-height:1.45;font-size:12px}h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:0 0 14px;border-bottom:2px solid #3157d5;padding-bottom:7px}h3{font-size:14px;margin:18px 0 8px;color:#26365e}.cover{min-height:245mm;display:flex;flex-direction:column;justify-content:center;page-break-after:always}.brand{font-weight:800;color:#3157d5;letter-spacing:.08em;text-transform:uppercase}.meta{color:#67708a;margin-top:5px}.summary{margin-top:26px;border:1px solid #dfe5f2;border-radius:12px;padding:16px;display:grid;grid-template-columns:1fr 1fr;gap:10px}.subject-section{page-break-before:always}.subject-section:first-of-type{page-break-before:auto}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:18px}th,td{border:1px solid #dfe5f2;padding:7px;text-align:left;vertical-align:top}th{background:#f3f6ff}.feedback-item{border:1px solid #dfe5f2;border-radius:10px;padding:12px;margin:10px 0;break-inside:avoid;page-break-inside:avoid}.item-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;border-bottom:1px solid #edf0f7;padding-bottom:8px;margin-bottom:10px}.small{color:#67708a;font-size:10px;margin-top:3px}.result{text-align:right;font-weight:bold}.result small{display:block;color:#67708a;font-weight:normal}.label{font-size:9px;text-transform:uppercase;color:#67708a;font-weight:bold;letter-spacing:.06em}.field-block{margin:9px 0}.field-block p,.rich p{margin:3px 0}.rich ul,.rich ol{margin:5px 0;padding-left:22px}.rich li{margin:2px 0}.two-column{display:grid;grid-template-columns:1fr 1fr;gap:12px}.teacher-review{background:#f0f8f2;border-left:4px solid #2e8b57;padding:8px 10px;margin-top:9px}.status{border:1px solid #cdd5e8;border-radius:999px;padding:3px 8px;font-size:10px}.empty{color:#67708a;font-style:italic}.footer{margin-top:24px;font-size:10px;color:#67708a;border-top:1px solid #dfe5f2;padding-top:8px}@media print{button{display:none}.cover{min-height:250mm}}
    </style></head><body>
    <section class="cover"><div class="brand">FeedbackLoop</div><h1>${escapeHtml(profile.displayName)}</h1><div class="meta">Learning and improvement record</div><div class="summary"><div><span class="label">Learner ID</span><br>${escapeHtml(profile.learnerId || "Not assigned")}</div><div><span class="label">Exported</span><br>${new Date().toLocaleString("en-GB")}</div><div><span class="label">Subjects</span><br>${escapeHtml(selectedSubject)}</div><div><span class="label">Date range</span><br>${escapeHtml(dateRange)}</div><div><span class="label">Report type</span><br>${escapeHtml(mode === "complete" ? "Complete learning record" : mode === "feedback" ? "Feedback and actions" : mode === "improvements" ? "Mistake and improvement bank" : "Assessment history")}</div><div><span class="label">Current school</span><br>${escapeHtml(schoolName(profile.schoolId))}</div></div><div class="footer">Confidential teacher-only notes are not included in this pupil report.</div></section>
    ${reportBody || `<p class="empty">No records match this selection.</p>`}
    <div class="footer">Generated by FeedbackLoop. This copy belongs to the pupil's continuing learner profile.</div>
    <script>window.onload=()=>window.print();<\/script></body></html>`);
  popup.document.close();
}
