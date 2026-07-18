const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

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

export function downloadPortfolioJson(profile, portfolio) {
  download(
    `feedbackloop-${profile.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`,
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
    `feedbackloop-${profile.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`,
    rows.map((row) => row.map(csvCell).join(",")).join("\n"),
    "text/csv;charset=utf-8"
  );
}

export function printPortfolioReport(profile, portfolio) {
  const subjectName = (subjectId) => portfolio.subjects?.find((x) => x.id === subjectId)?.name || subjectId || "";
  const assessments = [...(portfolio.assessments || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const feedback = [...(portfolio.feedbackRecords || [])].sort((a, b) => new Date(b.date) - new Date(a.date));
  const popup = window.open("", "_blank", "width=1000,height=800");
  if (!popup) throw new Error("Your browser blocked the printable report window.");
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(profile.displayName)} learning record</title>
    <style>
      body{font-family:Arial,sans-serif;color:#16213d;margin:36px;line-height:1.45}h1{margin-bottom:4px}h2{margin-top:30px;border-bottom:2px solid #3157d5;padding-bottom:6px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #dfe5f2;padding:8px;text-align:left;vertical-align:top}th{background:#f3f6ff}.meta{color:#67708a}.item{border:1px solid #dfe5f2;border-radius:10px;padding:12px;margin:10px 0}.label{font-size:11px;text-transform:uppercase;color:#67708a;font-weight:bold}.footer{margin-top:30px;font-size:11px;color:#67708a}
    </style></head><body>
    <h1>${escapeHtml(profile.displayName)}</h1><div class="meta">Learner ID: ${escapeHtml(profile.learnerId || "Not assigned")} · Exported ${new Date().toLocaleString("en-GB")}</div>
    <h2>Assessment history</h2>
    <table><thead><tr><th>Date</th><th>Subject</th><th>Assessment</th><th>Score</th><th>Grade</th></tr></thead><tbody>
      ${assessments.map(a => `<tr><td>${new Date(a.date).toLocaleDateString("en-GB")}</td><td>${escapeHtml(subjectName(a.subjectId))}</td><td>${escapeHtml(a.name)}</td><td>${a.score ?? ""}/${a.maxScore ?? ""} (${a.percentage ?? ""}%)</td><td>${escapeHtml(a.grade || "")}</td></tr>`).join("")}
    </tbody></table>
    <h2>Feedback and improvement record</h2>
    ${feedback.map(f => { const action=(portfolio.feedbackActions||[]).find(x=>x.feedbackId===f.id); return `<div class="item"><strong>${escapeHtml(f.assessmentName || f.skill)}</strong> · ${escapeHtml(subjectName(f.subjectId))} · ${new Date(f.date).toLocaleDateString("en-GB")}<p><span class="label">Strength</span><br>${escapeHtml(f.strength || "")}</p><p><span class="label">Next step</span><br>${escapeHtml(f.nextStep || "")}</p>${action?`<p><span class="label">Pupil reflection</span><br>${escapeHtml(action.reflection || "")}</p><p><span class="label">Action taken</span><br>${escapeHtml(action.actionTaken || "")}</p>`:""}</div>`; }).join("")}
    <div class="footer">This report is a pupil learning record. Confidential teacher-only notes are not included.</div>
    <script>window.onload=()=>window.print();<\/script></body></html>`);
  popup.document.close();
}
