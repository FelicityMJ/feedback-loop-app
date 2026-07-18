const GRADE_VALUES = {
  "A1": 9,
  "A2": 8,
  "B3": 7,
  "B4": 6,
  "C5": 5,
  "C6": 4,
  "D7": 3,
  "D8": 2,
  "NO AWARD": 1,
  "N/A": 1,
  // Legacy values are retained so older records still render sensibly.
  "A": 8,
  "B": 6,
  "C": 4,
  "D": 2
};

const GRADE_LABELS = ["A1", "A2", "B3", "B4", "C5", "C6", "D7", "D8", "No Award"];

const gradeValue = (grade) => {
  const key = String(grade || "").trim().toUpperCase();
  return GRADE_VALUES[key] || 0;
};

const gradeFromPercentage = (percentage) => {
  const value = Number(percentage);
  if (!Number.isFinite(value)) return "No Award";
  if (value >= 85) return "A1";
  if (value >= 70) return "A2";
  if (value >= 65) return "B3";
  if (value >= 60) return "B4";
  if (value >= 55) return "C5";
  if (value >= 50) return "C6";
  if (value >= 45) return "D7";
  if (value >= 40) return "D8";
  return "No Award";
};

const escapeXml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export function gradeChartSvg(assessments, targetGrade) {
  const sorted = [...assessments]
    .filter((a) => a.grade && a.verificationStatus !== "pending" && a.verificationStatus !== "returned")
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  if (!sorted.length) {
    return `<div class="empty">No confirmed assessment grades have been recorded for this subject yet.</div>`;
  }

  const width = 760;
  const height = 390;
  const left = 70;
  const right = 24;
  const top = 24;
  const bottom = 58;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const x = (index) => left + (sorted.length === 1 ? innerW / 2 : index * innerW / (sorted.length - 1));
  const y = (value) => top + (9 - value) * innerH / 8;
  const points = sorted.map((a, i) => `${x(i)},${y(gradeValue(a.grade))}`).join(" ");
  const targetValue = gradeValue(targetGrade);
  const targetY = targetValue ? y(targetValue) : null;

  const grid = GRADE_LABELS.map((grade, index) => {
    const value = 9 - index;
    return `
      <line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="#e6eaf3" stroke-width="1"/>
      <text x="${left-14}" y="${y(value)+4}" text-anchor="end" class="chart-title">${grade}</text>`;
  }).join("");

  const labels = sorted.map((a, i) => {
    const label = new Date(a.date).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    return `
      <circle cx="${x(i)}" cy="${y(gradeValue(a.grade))}" r="6" fill="#3157d5" stroke="#ffffff" stroke-width="3">
        <title>${escapeXml(a.name)}: ${escapeXml(a.grade)} (${a.percentage ?? ""}%)</title>
      </circle>
      <text x="${x(i)}" y="${height-25}" text-anchor="middle" class="chart-label">${escapeXml(label)}</text>
      <text x="${x(i)}" y="${Math.max(top+12, y(gradeValue(a.grade))-12)}" text-anchor="middle" class="chart-title">${escapeXml(a.grade)}</text>`;
  }).join("");

  return `
    <svg class="grade-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Assessment grade progress compared with target grade">
      ${grid}
      ${targetY ? `<line x1="${left}" y1="${targetY}" x2="${width-right}" y2="${targetY}" stroke="#7754d8" stroke-width="3" stroke-dasharray="8 6"/>
      <text x="${width-right}" y="${targetY-8}" text-anchor="end" fill="#6342c1" font-size="12" font-weight="800">Target ${escapeXml(targetGrade)}</text>` : ""}
      <polyline points="${points}" fill="none" stroke="#3157d5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${labels}
    </svg>`;
}

export function miniBarSvg(items, valueKey, labelKey) {
  const safe = items.filter((x) => Number.isFinite(Number(x[valueKey])));
  if (!safe.length) return `<div class="empty">No data available.</div>`;
  const max = Math.max(...safe.map((x) => Number(x[valueKey])), 1);
  return safe.map((item) => {
    const pct = Math.round(Number(item[valueKey]) / max * 100);
    return `<div class="progress-row">
      <span>${escapeXml(item[labelKey])}</span>
      <div class="progress-track"><div class="progress-bar" style="width:${pct}%"></div></div>
      <strong>${escapeXml(item[valueKey])}</strong>
    </div>`;
  }).join("");
}

export { gradeValue, gradeFromPercentage, GRADE_LABELS };
