import {
  isDemoMode,
  observeAuth,
  observeSchoolFeedback,
  demoSignInAs,
  signIn,
  signInWithGoogle,
  registerWithInvite,
  registerWithInviteGoogle,
  registerIndependentTeacher,
  registerIndependentTeacherGoogle,
  registerSchoolWithActivation,
  registerSchoolWithActivationGoogle,
  previewPupilClassInvite,
  joinPupilClass,
  joinTeacherWorkspace,
  loadWorkspaceStructure,
  createClassMigrationRequest,
  decideClassMigrationRequest,
  completeClassMigration,
  switchWorkspace,
  resetPassword,
  sendPupilPasswordReset,
  signOut,
  getUserProfile,
  loadAppData,
  loadPupilPortfolio,
  createSchoolEntity,
  updateSchoolEntity,
  createInvite,
  updateUserProfile,
  updateStaffRoles,
  rolesFromLegacy,
  createEmailChangeRequest,
  approveEmailChangeRequest,
  beginApprovedEmailChange,
  createTransferRequest,
  decideTransferRequest,
  completeTransfer,
  writeAuditLog,
  resetDemoData
} from "./firebase-service.js";
import { gradeChartSvg, miniBarSvg, gradeValue, gradeFromPercentage, GRADE_LABELS } from "./charts.js";
import { downloadPortfolioJson, downloadPortfolioCsv, printPortfolioReport } from "./export.js";

const app = document.querySelector("#app");

const state = {
  authUser: null,
  profile: null,
  data: null,
  route: "overview",
  area: null,
  authTab: "signin",
  selectedSubjectId: null,
  selectedClassId: null,
  selectedPupilId: null,
  modal: null,
  loading: true,
  feedbackUnsubscribe: null,
  improvementStatusFilter: "all",
  improvementTopicFilter: "all",
  improvementSearch: ""
};

const autosave = { timer: null, saving: false, queued: false, inFlight: Promise.resolve() };
let lastRichSelection = null;

const roleLabels = {
  schoolAdmin: "School administrator",
  departmentHead: "Department head",
  teacher: "Teacher",
  pupil: "Pupil"
};

const routeConfig = {
  schoolAdmin: [
    ["overview", "▦", "School overview"],
    ["setup", "⚙", "School setup"],
    ["people", "♟", "Staff roles & codes"],
    ["requests", "⇄", "Migration & approvals"],
    ["audit", "◷", "Licences & audit"]
  ],
  departmentHead: [
    ["overview", "▦", "Department overview"],
    ["classes", "▤", "Classes"],
    ["at-risk", "⚑", "At-risk pupils"],
    ["pupils", "♟", "Pupil dashboards"]
  ],
  teacher: [
    ["overview", "▦", "Teaching overview"],
    ["classes", "▤", "My classes"],
    ["feedback", "✎", "Live feedback"],
    ["pupils", "♟", "Pupil dashboards"]
  ],
  pupil: [
    ["overview", "▦", "My progress"],
    ["feedback", "✓", "My feedback loops"],
    ["improvements", "◎", "Mistake & improvement bank"],
    ["portfolio", "▤", "My learning record"],
    ["transfer", "⇄", "Account & transfer"]
  ]
};

const areaLabels = {
  teacher: "My classes",
  departmentHead: "Department overview",
  schoolAdmin: "School administration",
  pupil: "Pupil account"
};

function accessRoles(value = state.profile) {
  return rolesFromLegacy(value?.role, value?.roles);
}

function hasRole(role, value = state.profile) {
  return accessRoles(value)[role] === true;
}

function isPupil(value = state.profile) {
  return hasRole("pupil", value);
}

function isStaff(value = state.profile) {
  const roles = accessRoles(value);
  return roles.schoolAdmin || roles.departmentHead || roles.teacher;
}

function headDepartmentIds(value = state.profile) {
  return value?.departmentHeadDepartmentIds || (hasRole("departmentHead", value) ? value?.departmentIds || [] : []);
}

function availableAreas(value = state.profile) {
  if (isPupil(value)) return ["pupil"];
  const roles = accessRoles(value);
  const areas = [];
  if (roles.teacher) areas.push("teacher");
  if (roles.departmentHead) areas.push("departmentHead");
  if (roles.schoolAdmin) areas.push("schoolAdmin");
  return areas.length ? areas : ["teacher"];
}

function ensureArea() {
  const areas = availableAreas();
  if (!areas.includes(state.area)) state.area = areas[0];
  return state.area;
}

function roleSummary(value) {
  if (isPupil(value)) return "Pupil";
  const labels = [];
  if (hasRole("schoolAdmin", value)) labels.push("School administrator");
  if (hasRole("departmentHead", value)) labels.push("Department head");
  if (hasRole("teacher", value)) labels.push("Teacher");
  return labels.join(" · ") || roleLabels[value?.role] || "Staff";
}

function workspaceStatus() {
  const school = currentSchool();
  if (school.workspaceStatus) return school.workspaceStatus;
  return school.active === false ? "paused" : "active";
}

function workspaceIsReadOnly() {
  if (isDemoMode) return false;
  const status = workspaceStatus();
  if (status === "paused") return true;
  const endsAt = currentSchool().licence?.trialEndsAt;
  return status === "trial" && endsAt && new Date(endsAt).getTime() < Date.now();
}

const workspaceMutationActions = new Set([
  "toggle-invite", "approve-class-migration", "decline-class-migration", "complete-class-migration",
  "add-department", "add-subject", "add-class", "create-invite", "class-invite", "co-teacher-code",
  "assign-teacher", "manage-staff-roles", "add-assessment", "add-feedback", "pupil-add-feedback",
  "start-feedback-session", "update-feedback-session", "close-feedback-session", "reopen-feedback-session", "archive-feedback-session",
  "continue-feedback-draft", "save-feedback-draft", "edit-pupil-feedback", "edit-feedback-result",
  "manage-improvement", "toggle-improvement-pin", "review-risk",
  "acknowledge-feedback-edit", "reflect", "review-action", "set-target", "add-intervention",
  "request-email-change", "request-transfer", "approve-email", "decline-email", "accept-transfer",
  "decline-transfer", "complete-transfer", "move-class-to-school"
]);

const nonWorkspaceForms = new Set(["signin", "register", "independent-teacher", "school-activation", "print-portfolio"]);

function blockReadOnlyChange() {
  if (!state.profile || !workspaceIsReadOnly()) return false;
  toast("This workspace is paused or its trial has ended. Records remain visible, but changes are disabled.", "error");
  return true;
}


const feedbackTypes = {
  "Verbal": { result: "none", titleLabel: "What was the verbal feedback about?", titlePlaceholder: "For example: explaining evaluation answers", titleRequired: true, extra: false },
  "Prelim": { result: "required", titleLabel: "Prelim name", titlePlaceholder: "For example: National 5 Computing prelim", titleRequired: true, extra: true },
  "Class Test": { result: "required", titleLabel: "Test name", titlePlaceholder: "For example: Database class test", titleRequired: true, extra: false },
  "Unit Assessment": { result: "required", titleLabel: "Assessment name", titlePlaceholder: "For example: Software Design and Development assessment", titleRequired: true, extra: false },
  "Exam Question Practice": { result: "optional", titleLabel: "Question or activity name", titlePlaceholder: "For example: 2019 Section 2 question", titleRequired: true, extra: false },
  "Homework": { result: "optional", titleLabel: "Homework name", titlePlaceholder: "For example: SQL homework", titleRequired: true, extra: false },
  "Coursework": { result: "optional", titleLabel: "Coursework task", titlePlaceholder: "For example: Implementation checkpoint", titleRequired: true, extra: false },
  "Practical Work": { result: "optional", titleLabel: "Practical activity", titlePlaceholder: "For example: Python input validation task", titleRequired: true, extra: false },
  "Written Feedback": { result: "none", titleLabel: "What work was this feedback about?", titlePlaceholder: "For example: evaluation paragraph", titleRequired: true, extra: false },
  "Other": { result: "optional", titleLabel: "Feedback title", titlePlaceholder: "Give this feedback record a clear name", titleRequired: true, extra: false }
};

const feedbackTypeOptions = (selected = "Prelim") => Object.keys(feedbackTypes)
  .map((label) => `<option value="${e(label)}" ${label === selected ? "selected" : ""}>${e(label)}</option>`)
  .join("");

const highlightColours = new Set([
  "rgb(255, 243, 163)", "rgb(211, 245, 213)", "rgb(255, 214, 232)", "rgb(207, 229, 255)",
  "#fff3a3", "#d3f5d5", "#ffd6e8", "#cfe5ff"
]);

function sanitiseRichHtml(value = "") {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${String(value || "")}</div>`, "text/html");
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
      const rawBackground = child.tagName === "SPAN" ? (child.style?.backgroundColor || "") : "";
      for (const attribute of [...child.attributes]) child.removeAttribute(attribute.name);
      if (child.tagName === "SPAN" && highlightColours.has(rawBackground.toLowerCase())) {
        child.style.backgroundColor = rawBackground;
      }
      clean(child);
    }
  };
  clean(root);
  return root.innerHTML;
}

function richText(html, plain = "") {
  const safe = sanitiseRichHtml(html || "");
  return safe || `<p>${e(plain)}</p>`;
}

function plainTextFromHtml(html = "") {
  const temp = document.createElement("div");
  temp.innerHTML = sanitiseRichHtml(html);
  return temp.textContent.trim();
}

const e = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const dateFmt = (value, options = { day: "2-digit", month: "short", year: "numeric" }) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? e(value) : date.toLocaleDateString("en-GB", options);
};

const formatPercent = (value) => Number.isFinite(Number(value)) ? `${Math.round(Number(value))}%` : "—";
const initials = (name) => String(name || "U").split(/\s+/).slice(0, 2).map((x) => x[0]).join("").toUpperCase();
const byId = (items, id) => items?.find((item) => item.id === id);
const sortByDateDesc = (items, key = "date") => [...(items || [])].sort((a, b) => new Date(b[key] || 0) - new Date(a[key] || 0));
const unique = (items) => [...new Set(items.filter(Boolean))];
const todayInput = () => new Date().toISOString().slice(0, 10);
const officialAssessment = (assessment) => !["pending", "returned"].includes(assessment?.verificationStatus);
const gradeOptions = (selected = "") => GRADE_LABELS.map((grade) => `<option value="${e(grade)}" ${grade === selected ? "selected" : ""}>${e(grade)}</option>`).join("");
const percentageAndGrade = (score, maxScore) => {
  const scoreNumber = Number(score);
  const maximumNumber = Number(maxScore);
  if (!Number.isFinite(scoreNumber) || !Number.isFinite(maximumNumber) || maximumNumber <= 0 || scoreNumber < 0 || scoreNumber > maximumNumber) {
    throw new Error("Enter a valid score and maximum mark.");
  }
  const percentage = Math.round((scoreNumber / maximumNumber) * 100);
  return { score: scoreNumber, maxScore: maximumNumber, percentage, grade: gradeFromPercentage(percentage) };
};


const targetPercentageForGrade = (grade) => ({
  A1: 85,
  A2: 70,
  B3: 65,
  B4: 60,
  C5: 55,
  C6: 50,
  D7: 45,
  D8: 40,
  "NO AWARD": 0
})[String(grade || "").trim().toUpperCase()] ?? null;

const clampPercentage = (value) => Math.max(0, Math.min(100, Number(value) || 0));

function gaugePoint(percent, radius = 112, centreX = 180, centreY = 162) {
  const angle = (180 + clampPercentage(percent) * 1.8) * Math.PI / 180;
  return {
    x: centreX + radius * Math.cos(angle),
    y: centreY + radius * Math.sin(angle)
  };
}

function gaugeArc(startPercent, endPercent) {
  const start = gaugePoint(startPercent);
  const end = gaugePoint(endPercent);
  const largeArc = Math.abs(endPercent - startPercent) > 50 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A 112 112 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function averageGaugeSvg(assessments, targetGrade) {
  const values = (assessments || [])
    .map((assessment) => Number(assessment.percentage))
    .filter((value) => Number.isFinite(value));
  const average = values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
  const displayAverage = average === null ? "—" : `${average.toFixed(1)}%`;
  const averageGrade = average === null ? "No results yet" : gradeFromPercentage(average);
  const needle = average === null ? null : gaugePoint(average, 92);
  const targetPercent = targetPercentageForGrade(targetGrade);
  const targetOuter = targetPercent === null ? null : gaugePoint(targetPercent, 124);
  const targetInner = targetPercent === null ? null : gaugePoint(targetPercent, 99);

  return `<div class="average-gauge-wrap">
    <svg class="average-gauge" viewBox="0 0 360 245" role="img" aria-label="Average result ${e(displayAverage)}, ${e(averageGrade)}">
      <path d="${gaugeArc(0, 100)}" class="gauge-track"></path>
      <path d="${gaugeArc(0, 40)}" class="gauge-zone gauge-zone-red"></path>
      <path d="${gaugeArc(40, 70)}" class="gauge-zone gauge-zone-amber"></path>
      <path d="${gaugeArc(70, 100)}" class="gauge-zone gauge-zone-green"></path>
      <line x1="68" y1="174" x2="68" y2="184" class="gauge-end-tick"></line>
      <line x1="292" y1="174" x2="292" y2="184" class="gauge-end-tick"></line>
      ${targetOuter && targetInner ? `<line x1="${targetInner.x.toFixed(2)}" y1="${targetInner.y.toFixed(2)}" x2="${targetOuter.x.toFixed(2)}" y2="${targetOuter.y.toFixed(2)}" class="gauge-target-tick"><title>Target ${e(targetGrade)}</title></line>` : ""}
      ${needle ? `<line x1="180" y1="162" x2="${needle.x.toFixed(2)}" y2="${needle.y.toFixed(2)}" class="gauge-needle"></line><circle cx="180" cy="162" r="12" class="gauge-hub"></circle>` : `<circle cx="180" cy="162" r="8" class="gauge-hub gauge-hub-empty"></circle>`}
      <text x="55" y="204" class="gauge-scale-label">0%</text>
      <text x="305" y="204" text-anchor="end" class="gauge-scale-label">100%</text>
      <text x="180" y="208" text-anchor="middle" class="gauge-value">${e(displayAverage)}</text>
      <text x="180" y="232" text-anchor="middle" class="gauge-grade">${e(averageGrade)}</text>
    </svg>
    <div class="gauge-summary"><strong>${values.length}</strong> result${values.length === 1 ? "" : "s"} included${targetGrade ? ` · target marker ${e(targetGrade)}` : ""}</div>
  </div>`;
}

function ragSummary(feedback) {
  const counts = { Green: 0, Amber: 0, Red: 0 };
  (feedback || []).forEach((record) => {
    const value = String(record.trafficLight || "").trim().toLowerCase();
    if (value.includes("green")) counts.Green += 1;
    else if (value.includes("red")) counts.Red += 1;
    else if (value.includes("amber") || value.includes("yellow")) counts.Amber += 1;
  });
  return counts;
}

function ragDonutSvg(feedback) {
  const counts = ragSummary(feedback);
  const total = counts.Green + counts.Amber + counts.Red;
  const segments = [
    { label: "Green", count: counts.Green, className: "rag-green" },
    { label: "Amber", count: counts.Amber, className: "rag-amber" },
    { label: "Red", count: counts.Red, className: "rag-red" }
  ];
  let offset = 0;
  const circles = total ? segments.map((segment) => {
    const percentage = segment.count / total * 100;
    const circle = percentage > 0 ? `<circle cx="110" cy="110" r="74" pathLength="100" class="rag-segment ${segment.className}" stroke-dasharray="${percentage.toFixed(4)} ${(100 - percentage).toFixed(4)}" stroke-dashoffset="-${offset.toFixed(4)}"></circle>` : "";
    offset += percentage;
    return circle;
  }).join("") : `<circle cx="110" cy="110" r="74" pathLength="100" class="rag-segment rag-empty"></circle>`;

  const legend = segments.map((segment) => {
    const percentage = total ? Math.round(segment.count / total * 100) : 0;
    return `<div class="rag-legend-row"><span class="rag-key ${segment.className}"></span><span>${segment.label}</span><strong>${segment.count}</strong><small>${percentage}%</small></div>`;
  }).join("");

  return `<div class="rag-chart-layout">
    <svg class="rag-donut" viewBox="0 0 220 220" role="img" aria-label="${counts.Green} green, ${counts.Amber} amber and ${counts.Red} red feedback records">
      <circle cx="110" cy="110" r="74" class="rag-ring"></circle>
      ${circles}
      <text x="110" y="103" text-anchor="middle" class="rag-total">${total}</text>
      <text x="110" y="126" text-anchor="middle" class="rag-total-label">feedback record${total === 1 ? "" : "s"}</text>
    </svg>
    <div class="rag-legend">${legend}</div>
  </div>`;
}

function toast(message, type = "success") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const item = document.createElement("div");
  item.className = `toast ${type}`;
  item.textContent = message;
  stack.appendChild(item);
  setTimeout(() => item.remove(), 4200);
}

function setLoading(message = "Loading your dashboard…") {
  app.innerHTML = `<div class="loading"><div><div class="spinner"></div><strong>${e(message)}</strong></div></div>`;
}

function roleRoutes() {
  const area = ensureArea();
  return routeConfig[area] || [];
}

function getSubjectName(id) {
  return byId(state.data?.subjects, id)?.name || "Subject";
}
function getClassName(id) {
  return byId(state.data?.classes, id)?.name || "Class";
}
function getUserName(id) {
  return byId(state.data?.users, id)?.displayName || "Pupil";
}
function currentSchool() {
  return state.data?.school || { name: "School" };
}

function classesVisibleToProfile() {
  const all = state.data?.classes || [];
  const p = state.profile;
  if (!p) return [];
  const area = ensureArea();
  if (area === "schoolAdmin") return all;
  if (area === "departmentHead") return all.filter((c) => headDepartmentIds(p).includes(c.departmentId));
  if (area === "teacher") return all.filter((c) => (c.teacherIds || []).includes(p.id));
  const classIds = (state.data?.memberships || []).filter((m) => m.userId === p.id && m.active !== false).map((m) => m.classId);
  return all.filter((c) => classIds.includes(c.id));
}

function pupilsForClass(classId) {
  const pupilIds = (state.data?.memberships || []).filter((m) => m.classId === classId && m.active !== false).map((m) => m.userId);
  return (state.data?.users || []).filter((u) => pupilIds.includes(u.id) && isPupil(u));
}

function pupilMembership(pupilId, subjectId = null) {
  return (state.data?.memberships || []).find((m) => m.userId === pupilId && (!subjectId || m.subjectId === subjectId));
}

function latestAssessment(pupilId, subjectId = null) {
  return sortByDateDesc((state.data?.assessments || []).filter((a) => a.pupilId === pupilId && (!subjectId || a.subjectId === subjectId) && officialAssessment(a)))[0] || null;
}

function assessmentAverage(pupilId, { subjectId = null, classId = null } = {}) {
  const items = (state.data?.assessments || []).filter((assessment) => {
    const percentage = Number(assessment.percentage);
    return assessment.pupilId === pupilId
      && (!subjectId || assessment.subjectId === subjectId)
      && (!classId || assessment.classId === classId)
      && officialAssessment(assessment)
      && Number.isFinite(percentage);
  });
  if (!items.length) return { items, count: 0, percentage: null, grade: "—" };
  const percentage = items.reduce((total, assessment) => total + Number(assessment.percentage), 0) / items.length;
  return { items, count: items.length, percentage, grade: gradeFromPercentage(percentage) };
}

function targetProgressText(average, targetGrade) {
  if (!average?.count || !targetGrade) return "Add more results to compare with the target";
  const gap = gradeValue(targetGrade) - gradeValue(average.grade);
  if (gap <= 0) return "On or above target";
  if (gap === 1) return "Close to target — one grade band away";
  return `${gap} grade bands below target`;
}

function openFeedbackCount(pupilId, subjectId = null) {
  return (state.data?.feedbackRecords || []).filter((f) => f.pupilId === pupilId && (!subjectId || f.subjectId === subjectId) && f.status !== "closed" && f.status !== "draft").length;
}

function closedFeedbackCount(pupilId, subjectId = null) {
  return (state.data?.feedbackRecords || []).filter((f) => f.pupilId === pupilId && (!subjectId || f.subjectId === subjectId) && f.status === "closed").length;
}

function actionForFeedback(feedbackId) {
  return (state.data?.feedbackActions || []).find((a) => a.feedbackId === feedbackId);
}

function riskLevelFromScore(score) {
  return score >= 5 ? "High" : score >= 2 ? "Medium" : "Low";
}

function latestRiskOverride(pupilId, classId = null) {
  const active = (state.data?.riskOverrides || []).filter((item) => item.pupilId === pupilId && item.active !== false);
  if (classId) {
    const exact = sortByDateDesc(active.filter((item) => item.classId === classId), "createdAt")[0];
    if (exact) return exact;
  }
  return sortByDateDesc(active.filter((item) => !item.classId), "createdAt")[0] || null;
}

function atRiskInfo(pupilId, classId = null) {
  const memberships = (state.data?.memberships || []).filter((membership) => membership.userId === pupilId
    && membership.active !== false
    && (!classId || membership.classId === classId));
  const assessments = sortByDateDesc((state.data?.assessments || []).filter((assessment) => assessment.pupilId === pupilId
    && (!classId || assessment.classId === classId)
    && officialAssessment(assessment)));
  const feedback = (state.data?.feedbackRecords || []).filter((record) => record.pupilId === pupilId
    && (!classId || record.classId === classId)
    && record.status !== "draft");
  const interventions = (state.data?.interventions || []).filter((intervention) => intervention.pupilId === pupilId
    && (!classId || !intervention.classId || intervention.classId === classId)
    && intervention.status !== "Closed");
  let score = 0;
  const contributions = [];

  const addContribution = (label, points, detail = "") => {
    score += points;
    contributions.push({ label, points, detail });
  };

  const performanceOptions = memberships.map((membership) => {
    const average = assessmentAverage(pupilId, { classId: membership.classId, subjectId: membership.subjectId });
    const targetGrade = membership.targetGrade || "";
    const gap = average.count && targetGrade ? Math.max(0, gradeValue(targetGrade) - gradeValue(average.grade)) : 0;
    return { membership, average, targetGrade, gap };
  }).sort((a, b) => b.gap - a.gap || b.average.count - a.average.count);

  const performance = performanceOptions[0] || {
    membership: memberships[0] || {},
    average: assessmentAverage(pupilId),
    targetGrade: memberships[0]?.targetGrade || "",
    gap: 0
  };

  const belowTarget = performance.gap >= 2;
  if (belowTarget) {
    addContribution(
      `${performance.gap} grade bands below target on average`,
      performance.gap >= 4 ? 4 : 2,
      `Average ${performance.average.grade || "—"}; target ${performance.targetGrade || "—"}`
    );
  }

  if (assessments.length >= 3) {
    const recent = assessments.slice(0, 3).map((assessment) => Number(assessment.percentage));
    if (recent.every(Number.isFinite) && recent[0] < recent[1] && recent[1] <= recent[2]) {
      addContribution("Recent results are declining", 2, `${recent[2]}% → ${recent[1]}% → ${recent[0]}%`);
    }
  }
  const unresolved = feedback.filter((record) => record.status !== "closed").length;
  const red = feedback.filter((record) => String(record.trafficLight).toLowerCase() === "red").length;
  if (unresolved >= 2) addContribution(`${unresolved} open feedback loops`, 1, "Two or more feedback actions remain unresolved");
  if (red >= 2) addContribution("Repeated red confidence ratings", 2, `${red} completed feedback records are red`);
  if (interventions.length) addContribution("Active intervention", 2, `${interventions.length} support plan${interventions.length === 1 ? "" : "s"} in progress`);

  const calculatedLevel = riskLevelFromScore(score);
  const override = latestRiskOverride(pupilId, classId);
  const selectedLevel = override?.selectedLevel || calculatedLevel;

  return {
    score,
    calculatedLevel,
    level: selectedLevel,
    reviewedLevel: selectedLevel,
    override,
    contributions,
    reasons: contributions.map((item) => item.label),
    belowTarget,
    gradeGap: performance.gap,
    averageGrade: performance.average.grade || "—",
    averagePercentage: performance.average.percentage,
    latestGrade: performance.average.grade || "—",
    targetGrade: performance.targetGrade || "—",
    subjectId: performance.membership?.subjectId || null
  };
}

function badge(value) {
  const text = String(value || "—");
  const key = text.toLowerCase();
  const cls = key.includes("high") || key.includes("red") || key.includes("overdue") || key.includes("declined") ? "red"
    : key.includes("medium") || key.includes("amber") || key.includes("requested") || key.includes("open") || key.includes("submitted") || key.includes("awaiting") ? "amber"
      : key.includes("low") || key.includes("green") || key.includes("closed") || key.includes("approved") || key.includes("completed") || key.includes("accepted") ? "green" : "grey";
  return `<span class="badge badge-${cls}">${e(text)}</span>`;
}

function riskExplanationHtml(risk, { compact = false } = {}) {
  const rows = (risk.contributions || []).map((item) => `<li><span>${e(item.label)}${item.detail ? `<small>${e(item.detail)}</small>` : ""}</span><strong>+${e(item.points)}</strong></li>`).join("");
  const override = risk.override ? `<div class="risk-override-note"><strong>Teacher-reviewed level: ${e(risk.level)}</strong><p>${e(risk.override.reason || "Professional judgement recorded.")}</p>${risk.override.reviewDate ? `<small>Review ${dateFmt(risk.override.reviewDate)}</small>` : ""}</div>` : "";
  if (compact) return `<div class="small muted">Calculated ${e(risk.calculatedLevel)}${risk.override ? ` · reviewed ${e(risk.level)}` : ""}</div>`;
  return `<div class="risk-explanation"><div class="risk-score-head"><span>Calculated score</span><strong>${e(risk.score)} · ${e(risk.calculatedLevel)}</strong></div>${rows ? `<ul>${rows}</ul>` : `<p class="muted">No current automatic concern indicators.</p>`}${override}</div>`;
}

function kpi(icon, label, value, note = "") {
  return `<div class="card kpi"><div class="kpi-top"><span>${e(label)}</span><div class="kpi-icon">${icon}</div></div><strong>${e(value)}</strong>${note ? `<small>${e(note)}</small>` : ""}</div>`;
}

function selectOptions(items, selected, label = "name") {
  return items.map((item) => `<option value="${e(item.id)}" ${item.id === selected ? "selected" : ""}>${e(item[label])}</option>`).join("");
}

function renderAuth() {
  state.loading = false;
  const tab = state.authTab;
  const signin = tab === "signin";
  const join = tab === "register";
  const teacher = tab === "teacher";
  const school = tab === "school";
  const title = signin ? "Welcome back" : join ? "Join with a class or staff code" : teacher ? "Activate an independent teacher workspace" : "Activate a school workspace";
  const intro = signin
    ? "Sign in to open your personalised dashboard."
    : join
      ? "Pupils use a class code. Staff use a school-generated internal code. One login can hold several staff permissions."
      : "V6.3 pilot workspaces are invitation-only and require an activation code.";
  app.innerHTML = `<div class="auth-shell">
    <section class="auth-art">
      <div class="brand-mark">FL</div>
      <h1>Feedback<br>that moves<br>learning on.</h1>
      <p>Track progress against targets, close feedback loops, revisit recurring mistakes and give teachers a clear picture of where support is needed.</p>
      <div class="auth-points">
        <div class="auth-point"><span>✓</span><div><strong>Multi-role staff accounts</strong><br><span>Switch between classes, department leadership and school administration.</span></div></div>
        <div class="auth-point"><span>⌁</span><div><strong>Invitation-only pilot</strong><br><span>Independent teachers and schools activate only with an issued code.</span></div></div>
        <div class="auth-point"><span>⇄</span><div><strong>Continuing histories</strong><br><span>Class moves resume safely and reconnect existing pupils automatically.</span></div></div>
      </div>
    </section>
    <section class="auth-panel"><div class="auth-card">
      <h2>${title}</h2><p>${intro}</p>
      <div class="auth-tabs auth-tabs-four">
        <button class="auth-tab ${signin ? "active" : ""}" data-auth-tab="signin">Sign in</button>
        <button class="auth-tab ${join ? "active" : ""}" data-auth-tab="register">Join with code</button>
        <button class="auth-tab ${teacher ? "active" : ""}" data-auth-tab="teacher">Teacher pilot</button>
        <button class="auth-tab ${school ? "active" : ""}" data-auth-tab="school">School pilot</button>
      </div>
      ${signin ? `
        <form data-form="signin"><div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div><div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div><button class="btn btn-primary" type="submit">Sign in</button><div class="auth-divider"><span>or</span></div><button class="btn btn-ghost" type="button" data-action="google-signin">Continue with Google</button></form>
        <div class="auth-links"><button class="link-btn" data-action="forgot-password">Forgot password?</button><span class="muted">For any email-and-password account</span></div>` : join ? `
        <form data-form="register"><div class="field"><label>Real full name</label><input name="displayName" autocomplete="name" required></div><div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div><div class="field"><label>Password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div><div class="field"><label>Class or internal staff code</label><input name="inviteCode" placeholder="workspace-id~CODE" required><span class="field-help">Existing department-head codes automatically include teacher access in V6.3.</span></div><button class="btn btn-primary" type="submit">Create account</button><div class="auth-divider"><span>or</span></div><button class="btn btn-ghost" type="button" data-action="google-register-invite">Join using Google</button></form>` : teacher ? `
        <form data-form="independent-teacher"><div class="field"><label>Your real full name</label><input name="displayName" autocomplete="name" required></div><div class="field"><label>Workspace name</label><input name="workspaceName" placeholder="For example: Mrs Miller's Computing Classes" required></div><div class="field"><label>Pilot activation code</label><input name="activationCode" required autocomplete="off"></div><div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div><div class="field"><label>Password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div><button class="btn btn-primary" type="submit">Activate teacher workspace</button><div class="auth-divider"><span>or</span></div><button class="btn btn-ghost" type="button" data-action="google-register-teacher">Activate using Google</button></form>` : `
        <form data-form="school-activation"><div class="field"><label>Your real full name</label><input name="displayName" autocomplete="name" required></div><div class="field"><label>School name</label><input name="schoolName" required></div><div class="field"><label>School activation code</label><input name="activationCode" required autocomplete="off"></div><label class="check-card"><input type="checkbox" name="assignTeacher" checked><span><strong>Also give me teacher access</strong><small>You can create and teach classes while remaining school administrator.</small></span></label><div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div><div class="field"><label>Password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div><button class="btn btn-primary" type="submit">Activate school</button><div class="auth-divider"><span>or</span></div><button class="btn btn-ghost" type="button" data-action="google-register-school">Activate using Google</button></form>`}
      ${isDemoMode ? `<div class="demo-box"><strong>Preview V6.3</strong><div class="small muted">Demo changes stay in this browser.</div><div class="demo-roles"><button class="btn btn-secondary btn-sm" data-demo-role="pupil">Pupil view</button><button class="btn btn-secondary btn-sm" data-demo-role="teacher">Teacher view</button><button class="btn btn-secondary btn-sm" data-demo-role="departmentHead">Multi-role head</button><button class="btn btn-secondary btn-sm" data-demo-role="schoolAdmin">Multi-role admin</button></div></div>` : ""}
    </div></section></div>`;
}

function renderShell() {
  const profile = state.profile;
  const area = ensureArea();
  const routes = roleRoutes();
  if (!routes.some((r) => r[0] === state.route)) state.route = routes[0]?.[0] || "overview";
  const content = renderRoute();
  const areas = availableAreas();
  const status = workspaceStatus();
  const licence = currentSchool().licence || {};
  const accessBanner = status === "paused" || workspaceIsReadOnly()
    ? `<div class="workspace-banner workspace-banner-paused"><strong>Workspace paused.</strong> Records remain visible, but changes are disabled until access is restored.</div>`
    : status === "trial"
      ? `<div class="workspace-banner"><strong>Trial workspace</strong>${licence.trialEndsAt ? ` · ends ${dateFmt(licence.trialEndsAt)}` : ""}</div>`
      : licence.type === "complimentaryPilot" ? `<div class="workspace-banner"><strong>Complimentary pilot access</strong></div>` : "";
  app.innerHTML = `${isDemoMode ? `<div class="demo-banner">Demo mode: changes are saved only in this browser.</div>` : ""}${accessBanner}
    <div class="shell"><header class="topbar"><div class="brand"><div class="brand-mark">FL</div><div class="brand-copy"><strong>FeedbackLoop</strong><span>${e(currentSchool().name)}</span></div></div><div class="top-actions">
      ${isDemoMode ? `<select class="btn btn-ghost btn-sm" data-demo-switch aria-label="Switch demo account"><option value="pupil" ${isPupil(profile) ? "selected" : ""}>Pupil demo</option><option value="teacher">Teacher demo</option><option value="departmentHead">Head demo</option><option value="schoolAdmin">Admin demo</option></select>` : ""}
      ${(state.data?.workspaces || []).length > 1 ? `<select class="btn btn-ghost btn-sm workspace-switcher" data-workspace-select aria-label="Switch workspace">${(state.data.workspaces || []).map((workspace) => `<option value="${e(workspace.id)}" ${workspace.id === profile.schoolId ? "selected" : ""}>${e(workspace.name)}</option>`).join("")}</select>` : ""}
      <div class="user-chip"><div class="avatar">${e(initials(profile.displayName))}</div><div class="user-details"><strong>${e(profile.displayName)}</strong><div class="small muted">${e(roleSummary(profile))}</div></div></div><button class="icon-btn" data-action="signout" title="Sign out">↪</button>
    </div></header>
    ${areas.length > 1 ? `<div class="area-switcher" role="navigation" aria-label="Account area">${areas.map((id) => `<button class="area-switch ${area === id ? "active" : ""}" data-area="${id}">${e(areaLabels[id])}</button>`).join("")}</div>` : ""}
    <div class="layout"><aside class="sidebar"><div class="nav-label">${e(areaLabels[area] || "Dashboard")}</div>${routes.map(([id, icon, label]) => `<button class="nav-btn ${state.route === id ? "active" : ""}" data-route="${id}"><span class="nav-icon">${icon}</span>${e(label)}</button>`).join("")}<div class="sidebar-card"><strong>${isPupil(profile) ? "Keep closing the loop" : "Feedback becomes useful when it leads to action."}</strong><p>${isPupil(profile) ? "Revisit old mistakes before they appear again in an exam." : "Use patterns across feedback, not one mark alone, to decide who needs support."}</p></div></aside><main class="main">${content}</main></div></div>${state.modal ? renderModal() : ""}`;
}

function renderRoute() {
  const area = ensureArea();
  if (area === "pupil") return renderPupilRoute();
  if (area === "teacher") return renderTeacherRoute();
  if (area === "departmentHead") return renderHeadRoute();
  return renderAdminRoute();
}

function pupilSubjects() {
  const subjectIds = unique((state.data.memberships || []).filter((m) => m.userId === state.profile.id && m.active !== false).map((m) => m.subjectId));
  return state.data.subjects.filter((s) => subjectIds.includes(s.id));
}

function ensureSelectedSubject() {
  const subjects = pupilSubjects();
  if (!subjects.some((s) => s.id === state.selectedSubjectId)) state.selectedSubjectId = subjects[0]?.id || null;
  return subjects;
}

function pupilPageHead(title, description, extraActions = "") {
  const subjects = ensureSelectedSubject();
  return `<div class="page-head"><div><h1>${e(title)}</h1><p>${e(description)}</p></div><div class="page-actions">${subjects.length ? `<select class="btn btn-ghost" data-subject-select>${selectOptions(subjects, state.selectedSubjectId)}</select>` : ""}<button class="btn btn-ghost" data-action="join-another-class">+ Join another class</button>${extraActions}</div></div>`;
}

function renderPupilRoute() {
  if (state.route === "feedback") return renderPupilFeedback();
  if (state.route === "improvements") return renderImprovementBank();
  if (state.route === "portfolio") return renderPupilPortfolio();
  if (state.route === "transfer") return renderPupilTransfer();
  return renderPupilOverview();
}

function renderPupilOverview() {
  const subjects = ensureSelectedSubject();
  if (!subjects.length) return `${pupilPageHead("My progress", "Your subjects will appear after a teacher adds you to a class.")}<div class="card empty">You are not linked to a class yet.</div>`;
  const subjectId = state.selectedSubjectId;
  const assessments = (state.data.assessments || []).filter((a) => a.pupilId === state.profile.id && a.subjectId === subjectId && officialAssessment(a));
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.subjectId === subjectId && f.status !== "draft"));
  const membership = pupilMembership(state.profile.id, subjectId) || {};
  const average = assessmentAverage(state.profile.id, { subjectId });
  const open = feedback.filter((f) => f.status !== "closed");
  const closed = feedback.filter((f) => f.status === "closed");
  const subject = getSubjectName(subjectId);

  return `${pupilPageHead("My progress", "See how your results are moving, then turn feedback into a clear next action.")}
    <section class="hero"><div><h2>${open.length ? `You have ${open.length} feedback loop${open.length === 1 ? "" : "s"} ready to close.` : "Every feedback loop is closed."}</h2><p>${open.length ? `Start with the oldest open action in ${subject}. A small correction now can prevent the same mistake appearing in your next assessment.` : `Your improvement record in ${subject} is up to date. Revisit the mistake bank before your next assessment.`}</p></div><div class="hero-stat"><strong>${average.grade}</strong><span>Average grade · Target ${membership.targetGrade || "not set"}</span></div></section>
    <div class="grid grid-4">
      ${kpi("↗", "Average result", average.count ? formatPercent(average.percentage) : "—", average.count ? `${average.count} completed assessment${average.count === 1 ? "" : "s"}` : "No assessment yet")}
      ${kpi("◎", "Target grade", membership.targetGrade || "—", targetProgressText(average, membership.targetGrade))}
      ${kpi("✓", "Loops closed", closed.length, "Improvements kept in your record")}
      ${kpi("✎", "Still to act on", open.length, open.length ? "Choose one next step today" : "All caught up")}
    </div>
    <div class="grid grid-2 pupil-insight-grid" style="margin-top:18px">
      <section class="card insight-card"><div class="card-head"><div><h3>Average result so far</h3><p>Your mean percentage across completed ${e(subject)} assessments.</p></div>${badge(assessments.length ? gradeFromPercentage(assessments.reduce((sum, item) => sum + Number(item.percentage || 0), 0) / assessments.length) : "No results")}</div><div class="card-body">${averageGaugeSvg(assessments, membership.targetGrade)}</div></section>
      <section class="card insight-card"><div class="card-head"><div><h3>My feedback colours</h3><p>How often you have selected green, amber or red in completed feedback.</p></div>${badge(`${feedback.length} record${feedback.length === 1 ? "" : "s"}`)}</div><div class="card-body">${ragDonutSvg(feedback)}</div></section>
    </div>
    <div class="grid grid-3" style="margin-top:18px">
      <section class="card span-2"><div class="card-head"><div><h3>Grade progress</h3><p>Your grades compared with your target over time.</p></div>${badge(`Target ${membership.targetGrade || "—"}`)}</div><div class="card-body chart-wrap">${gradeChartSvg(assessments, membership.targetGrade)}</div></section>
      <section class="card"><div class="card-head"><div><h3>Next best actions</h3><p>Work from specific feedback, not vague revision.</p></div></div><div class="card-body">
        ${open.length ? open.slice(0, 3).map((f) => `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><h4>${e(f.skill)}</h4><p>${e(f.nextStep)}</p><button class="btn btn-secondary btn-sm" data-action="reflect" data-id="${f.id}">${actionForFeedback(f.id) ? "Update action" : "Close this loop"}</button></div></div>`).join("") : `<div class="alert alert-success">✓ Your open feedback list is clear.</div>`}
      </div></section>
    </div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Recent feedback</h3><p>The important part is what you do next.</p></div><button class="btn btn-ghost btn-sm" data-route="feedback">View all</button></div><div class="card-body timeline">
      ${feedback.length ? feedback.slice(0, 4).map(feedbackTimelineItem).join("") : `<div class="empty">No feedback has been added yet.</div>`}
    </div></section>`;
}

function feedbackTimelineItem(f) {
  const action = actionForFeedback(f.id);
  const result = f.percentage !== null && f.percentage !== undefined ? `${badge(f.grade || "No Award")} ${formatPercent(f.percentage)}` : "";
  return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><div class="timeline-meta">${badge(f.feedbackType || "Feedback")} ${badge(f.trafficLight)} ${badge(f.status)} ${result}</div><h4>${e(f.assessmentName || f.skill)}</h4><div class="feedback-section"><strong>What went well</strong><div class="rich-output">${richText(f.strengthHtml, f.strength)}</div></div><div class="feedback-section"><strong>Next step</strong><div class="rich-output">${richText(f.nextStepHtml, f.nextStep)}</div></div>${action ? `<p><strong>Your action:</strong> ${e(action.actionTaken)}</p>` : ""}<div class="small muted">${dateFmt(f.date)} · ${e(f.skill)}</div></div></div>`;
}

function feedbackSessionsForPupil(pupilId = state.profile?.id) {
  const classIds = new Set((state.data?.memberships || []).filter((membership) => membership.userId === pupilId && membership.active !== false).map((membership) => membership.classId));
  return sortByDateDesc((state.data?.feedbackSessions || []).filter((session) => classIds.has(session.classId) && session.status === "open"), "createdAt");
}

function feedbackSessionsVisibleToTeacher() {
  const classIds = new Set(classesVisibleToProfile().map((item) => item.id));
  return sortByDateDesc((state.data?.feedbackSessions || []).filter((session) => classIds.has(session.classId) && session.status !== "archived"), "createdAt");
}

function feedbackSessionStats(session) {
  const pupils = pupilsForClass(session.classId);
  const records = (state.data?.feedbackRecords || []).filter((record) => record.sessionId === session.id);
  const drafts = records.filter((record) => record.status === "draft");
  const submitted = records.filter((record) => record.status !== "draft");
  const activeCutoff = Date.now() - 5 * 60 * 1000;
  const activeNow = drafts.filter((record) => new Date(record.autosavedAt || record.updatedAt || 0).getTime() >= activeCutoff);
  const participants = new Set(records.map((record) => record.pupilId));
  const notStarted = pupils.filter((pupil) => !participants.has(pupil.id));
  return {
    pupils,
    records,
    drafts,
    submitted,
    activeNow,
    notStarted,
    red: submitted.filter((record) => String(record.trafficLight).toLowerCase() === "red")
  };
}

function normaliseTopic(value = "") {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function improvementItemsForPupil(pupilId = state.profile?.id) {
  const records = (state.data?.feedbackRecords || []).filter((record) => record.pupilId === pupilId && record.status !== "draft");
  const stored = (state.data?.improvementBank || []).filter((item) => item.pupilId === pupilId);
  const byFeedback = new Map(stored.filter((item) => item.feedbackId).map((item) => [item.feedbackId, item]));
  const topicCounts = new Map();
  records.forEach((record) => {
    const key = `${record.subjectId || ""}:${normaliseTopic(record.skill || record.assessmentName)}`;
    topicCounts.set(key, (topicCounts.get(key) || 0) + 1);
  });
  const items = records.map((record) => {
    const existing = byFeedback.get(record.id);
    const key = `${record.subjectId || ""}:${normaliseTopic(record.skill || record.assessmentName)}`;
    return {
      id: existing?.id || `virtual-${record.id}`,
      feedbackId: record.id,
      pupilId,
      classId: record.classId,
      subjectId: record.subjectId,
      title: existing?.title || record.assessmentName || record.skill || "Feedback item",
      topic: existing?.topic || record.skill || "Other",
      mistake: existing?.mistake || record.nextStep || "",
      mistakeHtml: existing?.mistakeHtml || record.nextStepHtml || "",
      improvementPlan: existing?.improvementPlan || record.nextStep || "",
      status: existing?.status || (record.status === "closed" ? "Improved" : "New"),
      confidence: existing?.confidence || record.trafficLight || "Amber",
      pinned: existing?.pinned === true,
      evidence: existing?.evidence || "",
      dateIdentified: existing?.dateIdentified || record.date,
      occurrenceCount: topicCounts.get(key) || 1,
      stored: Boolean(existing)
    };
  });
  for (const item of stored) {
    if (!item.feedbackId || !records.some((record) => record.id === item.feedbackId)) items.push({ ...item, occurrenceCount: item.occurrenceCount || 1, stored: true });
  }
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned) || new Date(b.dateIdentified || 0) - new Date(a.dateIdentified || 0));
}

function renderImprovementBank() {
  const all = improvementItemsForPupil();
  const topics = unique(all.map((item) => item.topic)).sort((a, b) => a.localeCompare(b));
  const search = state.improvementSearch.trim().toLowerCase();
  const filtered = all.filter((item) => {
    const statusMatch = state.improvementStatusFilter === "all" || item.status === state.improvementStatusFilter;
    const topicMatch = state.improvementTopicFilter === "all" || item.topic === state.improvementTopicFilter;
    const searchMatch = !search || [item.title, item.topic, item.mistake, item.improvementPlan, item.evidence].some((value) => String(value || "").toLowerCase().includes(search));
    return statusMatch && topicMatch && searchMatch;
  });
  const statusOptions = ["all", "New", "Practising", "Improved", "Secure", "Needs revisiting"];
  return `<div class="page-head"><div><h1>Mistake and improvement bank</h1><p>Keep the exact mistakes you do not want to repeat, record what you will do instead and add evidence when you improve.</p></div><div class="page-actions"><button class="btn btn-ghost" data-action="print-report">Save learning record as PDF</button></div></div>
    <div class="grid grid-4">${kpi("◎", "Bank items", all.length)}${kpi("⚑", "Pinned", all.filter((item) => item.pinned).length)}${kpi("↻", "Repeated themes", all.filter((item) => item.occurrenceCount > 1).length)}${kpi("✓", "Secure", all.filter((item) => item.status === "Secure").length)}</div>
    <section class="card card-pad improvement-filters" style="margin-top:18px"><div class="filter-row"><div class="field"><label>Status</label><select data-improvement-status-filter>${statusOptions.map((status) => `<option value="${e(status)}" ${state.improvementStatusFilter === status ? "selected" : ""}>${status === "all" ? "All statuses" : e(status)}</option>`).join("")}</select></div><div class="field"><label>Topic</label><select data-improvement-topic-filter><option value="all">All topics</option>${topics.map((topic) => `<option value="${e(topic)}" ${state.improvementTopicFilter === topic ? "selected" : ""}>${e(topic)}</option>`).join("")}</select></div><div class="field grow"><label>Search</label><input data-improvement-search value="${e(state.improvementSearch)}" placeholder="Search mistakes, topics or evidence"></div></div></section>
    <div class="improvement-grid" style="margin-top:18px">${filtered.map((item) => `<article class="card improvement-card ${item.pinned ? "pinned" : ""}"><div class="card-head"><div><div class="timeline-meta">${badge(item.status)} ${badge(item.confidence)} ${item.occurrenceCount > 1 ? badge(`${item.occurrenceCount} related records`) : ""}</div><h3>${e(item.title)}</h3><p>${e(getSubjectName(item.subjectId))} · ${e(item.topic)} · ${dateFmt(item.dateIdentified)}</p></div><button class="pin-button ${item.pinned ? "active" : ""}" data-action="toggle-improvement-pin" data-id="${e(item.id)}" data-feedback-id="${e(item.feedbackId || "")}" aria-label="${item.pinned ? "Unpin" : "Pin"} improvement">★</button></div><div class="feedback-section"><strong>Mistake or next step</strong><div class="rich-output">${richText(item.mistakeHtml, item.mistake)}</div></div><div class="feedback-section"><strong>What I will do instead</strong><p>${e(item.improvementPlan || "Add a clear improvement plan.")}</p></div>${item.evidence ? `<div class="feedback-section"><strong>Evidence of improvement</strong><p>${e(item.evidence)}</p></div>` : ""}<div class="form-actions"><button class="btn btn-primary btn-sm" data-action="manage-improvement" data-id="${e(item.id)}" data-feedback-id="${e(item.feedbackId || "")}">Update item</button></div></article>`).join("") || `<div class="card empty">No improvement items match these filters.</div>`}</div>`;
}

function renderPupilFeedback() {
  ensureSelectedSubject();
  const subjectId = state.selectedSubjectId;
  const all = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.subjectId === subjectId), "updatedAt");
  const drafts = all.filter((f) => f.status === "draft");
  const feedback = all.filter((f) => f.status !== "draft");
  const sessions = feedbackSessionsForPupil().filter((session) => !all.some((record) => record.sessionId === session.id && record.status !== "draft"));
  return `${pupilPageHead("My feedback record", "Enter feedback yourself while it is fresh, then use it to avoid repeating the same mistakes.", `<button class="btn btn-primary" data-action="pupil-add-feedback">New feedback record</button>`)}
    <div class="alert alert-info" style="margin-bottom:18px">Choose the feedback type first. Verbal feedback needs no test result; prelims and formal tests calculate your percentage and detailed grade automatically. Everything autosaves as you type.</div>
    ${sessions.length ? `<section class="card live-session-pupil" style="margin-bottom:18px"><div class="card-head"><div><h3>Teacher-led feedback sessions</h3><p>Your teacher has prepared these activities, so the class, title and topic are already filled in.</p></div>${badge(`${sessions.length} open`)}</div><div class="card-body session-grid">${sessions.map((session) => `<article class="session-card"><div><div class="timeline-meta">${badge(session.feedbackType || "Feedback session")} ${badge("Open")}</div><h4>${e(session.title)}</h4><p>${e(getClassName(session.classId))} · ${e(session.skill)}</p>${session.instructions ? `<small>${e(session.instructions)}</small>` : ""}</div><button class="btn btn-primary btn-sm" data-action="open-feedback-session" data-id="${e(session.id)}">Start session</button></article>`).join("")}</div></section>` : ""}
    ${drafts.length ? `<section class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>Continue a draft</h3><p>These records were autosaved and can be finished today or another day.</p></div>${badge(`${drafts.length} draft${drafts.length === 1 ? "" : "s"}`)}</div><div class="card-body draft-grid">${drafts.map((f) => `<article class="draft-card"><div><div class="timeline-meta">${badge(f.feedbackType || "Draft")} ${badge("Autosaved draft")}</div><h4>${e(f.assessmentName || "Untitled feedback")}</h4><p>${e(f.skill || "Add a topic or skill")}</p><small>Last saved ${dateFmt(f.autosavedAt || f.updatedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div><button class="btn btn-secondary btn-sm" data-action="continue-feedback-draft" data-id="${f.id}">Continue</button></article>`).join("")}</div></section>` : ""}
    <div class="grid grid-2">
      ${feedback.length ? feedback.map((f) => {
        const action = actionForFeedback(f.id);
        const result = f.percentage !== null && f.percentage !== undefined ? `<div class="result-summary"><strong>${e(f.score)} / ${e(f.maxScore)}</strong><span>${formatPercent(f.percentage)} · ${e(f.grade)}</span></div>` : "";
        return `<article class="card feedback-card ${String(f.trafficLight).toLowerCase()}"><div class="timeline-meta">${badge(f.feedbackType || "Feedback")} ${badge(f.trafficLight)} ${badge(f.status)}</div><h4>${e(f.assessmentName || f.skill)}</h4><div class="small muted">${dateFmt(f.date)} · ${e(f.skill)}</div>${result}<div class="feedback-section"><strong>What went well</strong><div class="rich-output">${richText(f.strengthHtml, f.strength)}</div></div><div class="feedback-section"><strong>My next step</strong><div class="rich-output">${richText(f.nextStepHtml, f.nextStep)}</div></div>${action ? `<div class="feedback-section"><strong>My reflection</strong><p>${e(action.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action.actionTaken)}</p></div>${action.teacherReview ? `<div class="alert alert-success" style="margin-top:13px">Teacher check: ${e(action.teacherReview)}</div>` : ""}` : ""}<div class="form-actions">${f.entrySource === "pupil" ? `<button class="btn btn-ghost btn-sm" data-action="edit-pupil-feedback" data-id="${f.id}">Edit my written feedback</button>` : ""}<button class="btn ${f.status === "closed" ? "btn-ghost" : "btn-primary"} btn-sm" data-action="reflect" data-id="${f.id}">${action ? "Review my action" : "Add reflection and action"}</button></div></article>`;
      }).join("") : `<div class="card empty span-2">No completed feedback records for this subject yet.</div>`}
    </div>`;
}

function renderPupilPortfolio() {
  const assessments = sortByDateDesc((state.data.assessments || []).filter((a) => a.pupilId === state.profile.id));
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.status !== "draft"));
  return `<div class="page-head"><div><h1>My learning record</h1><p>This belongs to your continuing learner profile. Download a copy before leaving a school or use it to prepare for exams.</p></div><div class="page-actions"><button class="btn btn-ghost" data-action="export-csv">Download spreadsheet</button><button class="btn btn-ghost" data-action="export-json">Download data</button><button class="btn btn-primary" data-action="print-report">Save as PDF</button></div></div>
    <div class="grid grid-3">
      ${kpi("▤", "Assessments", assessments.length, "Across all linked subjects")}
      ${kpi("✎", "Feedback records", feedback.length, "Strengths and next steps preserved")}
      ${kpi("✓", "Closed loops", feedback.filter((f) => f.status === "closed").length, "Evidence of improvement")}
    </div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Assessment history</h3><p>Your current-school record. The full export also includes available previous-school history.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Assessment</th><th>Score</th><th>Grade</th></tr></thead><tbody>${assessments.map((a) => `<tr><td>${dateFmt(a.date)}</td><td>${e(getSubjectName(a.subjectId))}</td><td>${e(a.name)}</td><td>${e(a.score)}/${e(a.maxScore)} · ${formatPercent(a.percentage)}</td><td>${badge(a.grade)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No assessments yet.</td></tr>`}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Recent feedback and improvement</h3><p>The structured bank now has its own page, with statuses, pinned items and evidence of improvement.</p></div><button class="btn btn-primary btn-sm" data-route="improvements">Open improvement bank</button></div><div class="card-body timeline">${feedback.slice(0, 5).map(feedbackTimelineItem).join("") || `<div class="empty">No feedback records yet.</div>`}</div></section>`;
}

function renderPupilTransfer() {
  const requests = (state.data.transferRequests || []).filter((r) => r.pupilId === state.profile.id);
  const emailRequests = sortByDateDesc((state.data.emailChangeRequests || []).filter((r) => r.pupilId === state.profile.id), "requestedAt");
  const latestEmail = emailRequests[0];
  return `<div class="page-head"><div><h1>Account and school transfer</h1><p>Your permanent learner ID remains the same even when your school email or school changes.</p></div></div>
    <div class="grid grid-2">
      <section class="card card-pad"><h3>Permanent learner profile</h3><p class="muted">This ID, not your email address, connects your long-term learning record.</p><div class="alert alert-info" style="margin-top:16px"><strong>Learner ID:</strong>&nbsp; ${e(state.profile.learnerId || "Not assigned")}</div><p><strong>Current school:</strong> ${e(currentSchool().name)}</p><p><strong>Current login email:</strong> ${e(state.profile.email)}</p></section>
      <section class="card card-pad"><h3>Change a leaving-school email</h3><p class="muted">Ask your current school to approve a personal or new-school email before the old account is disabled.</p>${latestEmail ? `<div class="alert ${latestEmail.status === "approved" ? "alert-success" : latestEmail.status === "declined" ? "alert-danger" : "alert-warning"}">${badge(latestEmail.status)} <span>${e(latestEmail.newEmail)}</span></div>${latestEmail.status === "approved" ? `<button class="btn btn-primary" style="margin-top:12px" data-action="begin-email-change" data-id="${latestEmail.id}">Send verification to new email</button>` : ""}` : `<button class="btn btn-primary" data-action="request-email-change">Request email change</button>`}</section>
    </div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Move to another school</h3><p>Enter the transfer code supplied by the new school. The new school must accept before anything moves.</p></div><button class="btn btn-primary" data-action="request-transfer">Request transfer</button></div><div class="table-wrap"><table><thead><tr><th>Requested</th><th>From</th><th>Destination</th><th>Sharing</th><th>Status</th><th></th></tr></thead><tbody>${requests.map((r) => `<tr><td>${dateFmt(r.requestedAt)}</td><td>${e(r.fromSchoolId)}</td><td>${e(r.toSchoolId)}</td><td>${e(r.shareLevel)}</td><td>${badge(r.status)}</td><td>${r.status === "accepted" ? `<button class="btn btn-primary btn-sm" data-action="complete-transfer" data-id="${r.id}">Complete transfer</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No transfer requests.</td></tr>`}</tbody></table></div></section>
    <div class="alert alert-info" style="margin-top:18px">Confidential teacher-only notes are never included in pupil downloads or automatic transfers.</div>`;
}

function renderTeacherRoute() {
  if (state.route === "classes") return renderTeacherClasses();
  if (state.route === "feedback") return renderTeacherFeedback();
  if (state.route === "pupils") return renderPupilDirectory();
  return renderTeacherOverview();
}

function teacherSelectedClass() {
  const classes = classesVisibleToProfile();
  if (!classes.some((c) => c.id === state.selectedClassId)) state.selectedClassId = classes[0]?.id || null;
  return byId(classes, state.selectedClassId);
}

function classAverage(classId) {
  const items = (state.data.assessments || []).filter((a) => a.classId === classId);
  return items.length ? Math.round(items.reduce((sum, a) => sum + Number(a.percentage || 0), 0) / items.length) : 0;
}

function classSnapshotTable(cls) {
  const pupils = pupilsForClass(cls.id);
  return `<div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Average</th><th>Target</th><th>Open loops</th><th>Risk</th><th></th></tr></thead><tbody>${pupils.map((pupil) => {
    const membership = pupilMembership(pupil.id, cls.subjectId) || {};
    const average = assessmentAverage(pupil.id, { classId: cls.id, subjectId: cls.subjectId });
    const risk = atRiskInfo(pupil.id, cls.id);
    return `<tr><td><button class="table-link" data-action="open-pupil" data-id="${pupil.id}">${e(pupil.displayName)}</button><div class="small muted">${e(pupil.email)}</div></td><td>${average.count ? `${badge(average.grade)} ${formatPercent(average.percentage)}` : "—"}</td><td>${badge(membership.targetGrade || "Not set")}</td><td>${openFeedbackCount(pupil.id, cls.subjectId)}</td><td>${badge(risk.level)}${riskExplanationHtml(risk, { compact: true })}</td><td><div class="table-actions"><button class="btn btn-ghost btn-sm" data-action="open-pupil" data-id="${pupil.id}">Dashboard</button><button class="btn btn-primary btn-sm" data-action="review-risk" data-id="${pupil.id}" data-class-id="${cls.id}">Review</button></div></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No pupils linked to this class.</td></tr>`}</tbody></table></div>`;
}

function renderTeacherOverview() {
  const classes = classesVisibleToProfile();
  const cls = teacherSelectedClass();
  const pupilIds = unique(classes.flatMap((c) => pupilsForClass(c.id).map((p) => p.id)));
  const atRisk = pupilIds.filter((id) => atRiskInfo(id).level !== "Low");
  const open = (state.data.feedbackRecords || []).filter((f) => pupilIds.includes(f.pupilId) && f.status !== "closed" && f.status !== "draft").length;
  return `<div class="page-head"><div><h1>Teaching overview</h1><p>See pupil-entered feedback arriving live, then open an individual dashboard when you need the detail behind it.</p></div><div class="page-actions">${badge("Live updates on")}</div></div>
    <div class="grid grid-4">${kpi("▤", "My classes", classes.length)}${kpi("♟", "Pupils", pupilIds.length)}${kpi("✎", "Open feedback loops", open)}${kpi("⚑", "Pupils to review", atRisk.length, "Based on several indicators")}</div>
    ${cls ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>${e(cls.name)}</h3><p>${e(getSubjectName(cls.subjectId))} · ${pupilsForClass(cls.id).length} pupils · ${classAverage(cls.id)}% average</p></div><select class="btn btn-ghost" data-class-select>${selectOptions(classes, cls.id)}</select></div>${classSnapshotTable(cls)}</section>` : `<div class="card empty" style="margin-top:18px">Create or join a class to begin.</div>`}
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Common feedback themes</h3><p>Skills appearing most often in current feedback.</p></div></div><div class="card-body">${miniBarSvg(skillCountsForClasses(classes), "count", "skill")}</div></section><section class="card"><div class="card-head"><div><h3>Interventions to review</h3><p>Active support should always have a follow-up point.</p></div></div><div class="card-body timeline">${(state.data.interventions || []).filter((i) => pupilIds.includes(i.pupilId) && i.status !== "Closed").slice(0,5).map((i) => `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><h4>${e(getUserName(i.pupilId))}</h4><p>${e(i.action)}</p><div class="small muted">Review ${dateFmt(i.reviewDate)} · ${e(i.status)}</div></div></div>`).join("") || `<div class="empty">No active interventions.</div>`}</div></section></div>`;
}

function skillCountsForClasses(classes) {
  const classIds = classes.map((c) => c.id);
  const counts = {};
  for (const f of state.data.feedbackRecords || []) {
    if (classIds.includes(f.classId) && f.status !== "draft") counts[f.skill || "Other"] = (counts[f.skill || "Other"] || 0) + 1;
  }
  return Object.entries(counts).map(([skill, count]) => ({ skill, count })).sort((a,b) => b.count-a.count).slice(0,8);
}

function renderTeacherClasses() {
  const classes = classesVisibleToProfile();
  const personalWorkspace = currentSchool().workspaceType === "individualTeacher";
  const linkedSchoolCount = (state.data.workspaces || []).filter((workspace) => workspace.id !== state.profile.schoolId && workspace.workspaceType !== "individualTeacher").length;
  const migrationRequests = (state.data.classMigrationRequests || []).filter((request) => request.createdBy === state.profile.id);
  return `<div class="page-head"><div><h1>My classes</h1><p>Create classes, check membership and use a pupil invitation code for straightforward enrolment.</p></div><div class="page-actions">${personalWorkspace ? `<button class="btn btn-ghost" data-action="add-department">Add department</button><button class="btn btn-ghost" data-action="add-subject">Add subject</button><button class="btn btn-secondary" data-action="join-school-workspace">Link to a school</button>` : ""}<button class="btn btn-primary" data-action="add-class">Add class</button></div></div>
    ${personalWorkspace ? `<div class="alert alert-info" style="margin-bottom:18px"><strong>Individual teacher workspace.</strong> You have full classroom access here. A co-teacher can join a shared class using a co-teacher code. When a school adopts FeedbackLoop, link your account first and then request to move each class with its complete feedback history.</div>` : ""}
    <div class="grid grid-3">${classes.map((cls) => `<section class="card card-pad"><div class="timeline-meta">${badge(cls.targetQualification || "Course")}</div><h3>${e(cls.name)}</h3><p class="muted">${e(getSubjectName(cls.subjectId))} · ${e(cls.academicYear || "")}</p><p class="small"><strong>Teachers:</strong> ${e((cls.teacherIds || []).map(getUserName).join(", ") || "Not assigned")}</p><div class="grid grid-2"><div><strong>${pupilsForClass(cls.id).length}</strong><div class="small muted">Pupils</div></div><div><strong>${classAverage(cls.id)}%</strong><div class="small muted">Average</div></div></div><div class="form-actions"><button class="btn btn-ghost btn-sm" data-action="select-class" data-id="${cls.id}">Open class</button><button class="btn btn-secondary btn-sm" data-action="class-invite" data-id="${cls.id}">Pupil code</button>${personalWorkspace ? `<button class="btn btn-ghost btn-sm" data-action="assign-teacher" data-id="${cls.id}">Manage teachers</button><button class="btn btn-ghost btn-sm" data-action="co-teacher-code" data-id="${cls.id}">Co-teacher code</button>${linkedSchoolCount ? `<button class="btn btn-primary btn-sm" data-action="move-class-to-school" data-id="${cls.id}">Move to school</button>` : ""}` : ""}</div></section>`).join("") || `<div class="card empty span-3">No classes yet.</div>`}</div>
    ${teacherSelectedClass() ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>${e(teacherSelectedClass().name)} pupil list</h3></div></div>${classSnapshotTable(teacherSelectedClass())}</section>` : ""}
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Pupil class codes</h3><p>Each code adds pupils only to its named class. Existing pupils use the same code through “Join another class”.</p></div></div>${inviteCodeTable((state.data.invites || []).filter((invite) => invite.role === "pupil"))}</section>
    ${migrationRequests.length ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Class moves</h3><p>Approved moves are completed from the destination school workspace. Original data remains as a historical backup.</p></div></div>${migrationRequestsTable(migrationRequests, "teacher")}</section>` : ""}`;
}

function renderTeacherFeedback() {
  const classes = classesVisibleToProfile();
  const classIds = classes.map((c) => c.id);
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => classIds.includes(f.classId)), "updatedAt");
  const drafts = feedback.filter((f) => f.status === "draft");
  const submitted = feedback.filter((f) => f.status !== "draft");
  const results = submitted.filter((f) => f.percentage !== null && f.percentage !== undefined);
  const sessions = feedbackSessionsVisibleToTeacher();
  const openSessions = sessions.filter((session) => session.status === "open");
  return `<div class="page-head"><div><h1>Live feedback sessions</h1><p>Prepare one class activity, watch drafts autosave and see exactly who has submitted, who is still writing and who has not started.</p></div><div class="page-actions"><span class="live-indicator"><span></span>Listening live</span><button class="btn btn-primary" data-action="start-feedback-session">Start feedback session</button></div></div>
    <div class="grid grid-4">${kpi("◉", "Open sessions", openSessions.length, "Teacher-led class activities")}${kpi("✎", "Submitted records", submitted.length)}${kpi("▤", "Results entered", results.length)}${kpi("✓", "Closed loops", submitted.filter((f) => f.status === "closed").length)}</div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Class feedback sessions</h3><p>Close a session to stop new pupils starting it. Existing autosaved drafts remain available.</p></div></div><div class="card-body teacher-session-list">${sessions.length ? sessions.map((session) => { const stats = feedbackSessionStats(session); return `<article class="teacher-session-card"><div class="session-main"><div class="timeline-meta">${badge(session.status)} ${badge(session.feedbackType || "Feedback")}</div><h4>${e(session.title)}</h4><p>${e(getClassName(session.classId))} · ${e(session.skill)}</p>${session.instructions ? `<small>${e(session.instructions)}</small>` : ""}</div><div class="session-stat-grid"><div><strong>${stats.submitted.length}</strong><span>Submitted</span></div><div><strong>${stats.activeNow.length}</strong><span>Active now</span></div><div><strong>${stats.drafts.length}</strong><span>Drafts</span></div><div><strong>${stats.notStarted.length}</strong><span>Not started</span></div><div><strong>${stats.red.length}</strong><span>Red</span></div></div><div class="session-actions"><button class="btn btn-ghost btn-sm" data-action="view-feedback-session" data-id="${e(session.id)}">Open session</button>${session.status === "open" ? `<button class="btn btn-secondary btn-sm" data-action="close-feedback-session" data-id="${e(session.id)}">Close session</button>` : `<button class="btn btn-secondary btn-sm" data-action="reopen-feedback-session" data-id="${e(session.id)}">Reopen</button>`}<button class="btn btn-ghost btn-sm" data-action="copy-incomplete-session" data-id="${e(session.id)}">Copy incomplete list</button><button class="btn btn-ghost btn-sm" data-action="archive-feedback-session" data-id="${e(session.id)}">Archive</button></div></article>`; }).join("") : `<div class="empty">No feedback sessions yet. Start one before returning marked work to a class.</div>`}</div></section>
    <section class="card live-monitor" style="margin-top:18px"><div class="card-head"><div><h3>Incoming drafts</h3><p>This section updates automatically while pupils type on another device.</p></div><span class="live-indicator"><span></span>Live</span></div><div class="card-body live-draft-list">${drafts.length ? drafts.map((f) => `<article class="live-draft"><div class="live-draft-main"><div class="timeline-meta">${badge(f.feedbackType || "Draft")} ${f.sessionId ? badge("Session") : ""} ${f.grade ? badge(f.grade) : ""}</div><h4>${e(getUserName(f.pupilId))} — ${e(f.assessmentName || "Untitled feedback")}</h4><p>${e(getClassName(f.classId))} · ${e(f.skill || "Topic not entered yet")}</p>${f.percentage !== null && f.percentage !== undefined ? `<strong>${e(f.score)} / ${e(f.maxScore)} · ${formatPercent(f.percentage)}</strong>` : ""}</div><div class="live-draft-side"><small>Saved ${dateFmt(f.autosavedAt || f.updatedAt, { hour: "2-digit", minute: "2-digit" })}</small><button class="btn btn-ghost btn-sm" data-action="view-feedback" data-id="${f.id}">View draft</button></div></article>`).join("") : `<div class="empty">No pupil is currently working on a draft.</div>`}</div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Completed feedback records</h3><p>Marks, grades and pupil-written next steps are shown together.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Pupil</th><th>Type</th><th>Activity</th><th>Result</th><th>Next step</th><th></th></tr></thead><tbody>${submitted.map((f) => `<tr><td>${dateFmt(f.date)}</td><td><button class="table-link" data-action="open-pupil" data-id="${f.pupilId}">${e(getUserName(f.pupilId))}</button><div class="small muted">${e(getClassName(f.classId))}</div></td><td>${badge(f.feedbackType || "Feedback")}${f.sessionId ? `<div>${badge("Session")}</div>` : ""}</td><td><strong>${e(f.assessmentName || f.skill)}</strong>${f.needsTeacherReview ? `<div>${badge("Pupil edit to review")}</div>` : ""}<div class="small muted">${e(f.skill)}</div></td><td>${f.percentage !== null && f.percentage !== undefined ? `${badge(f.grade)} ${formatPercent(f.percentage)}` : "No mark"}</td><td><div class="table-rich">${richText(f.nextStepHtml, f.nextStep)}</div></td><td><button class="btn btn-ghost btn-sm" data-action="view-feedback" data-id="${f.id}">View</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No completed feedback records yet.</td></tr>`}</tbody></table></div></section>`;
}

function renderPupilDirectory() {
  const classes = classesVisibleToProfile();
  const pupilIds = unique(classes.flatMap((c) => pupilsForClass(c.id).map((p) => p.id)));
  const pupils = state.data.users.filter((u) => pupilIds.includes(u.id));
  return `<div class="page-head"><div><h1>Pupil dashboards</h1><p>Open one pupil to see average attainment, grade progress, feedback history, recurring misconceptions and active support.</p></div></div><section class="card"><div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Classes</th><th>Average grade</th><th>Open loops</th><th>Risk</th><th></th></tr></thead><tbody>${pupils.map((p) => {
    const pupilClasses = classes.filter((c) => pupilsForClass(c.id).some((x) => x.id === p.id));
    const risk = atRiskInfo(p.id);
    const average = assessmentAverage(p.id);
    return `<tr><td><strong>${e(p.displayName)}</strong><div class="small muted">${e(p.email)}</div></td><td>${e(pupilClasses.map((c) => c.name).join(", "))}</td><td>${average.count ? `${badge(average.grade)} ${formatPercent(average.percentage)}` : "—"}</td><td>${openFeedbackCount(p.id)}</td><td>${badge(risk.level)}${riskExplanationHtml(risk, { compact: true })}</td><td><div class="table-actions"><button class="btn btn-ghost btn-sm" data-action="open-pupil" data-id="${p.id}">Dashboard</button><button class="btn btn-primary btn-sm" data-action="review-risk" data-id="${p.id}">Review</button></div></td></tr>`;
  }).join("") || `<tr><td colspan="6" class="empty">No pupils in your linked classes.</td></tr>`}</tbody></table></div></section>`;
}

function renderHeadRoute() {
  if (state.route === "classes") return renderHeadClasses();
  if (state.route === "at-risk") return renderAtRisk();
  if (state.route === "pupils") return renderPupilDirectory();
  return renderHeadOverview();
}

function headClasses() {
  return classesVisibleToProfile();
}

function renderHeadOverview() {
  const classes = headClasses();
  const pupilIds = unique(classes.flatMap((c) => pupilsForClass(c.id).map((p) => p.id)));
  const risks = pupilIds.map((id) => ({ pupil: byId(state.data.users, id), ...atRiskInfo(id) }));
  const high = risks.filter((r) => r.level === "High");
  const open = (state.data.feedbackRecords || []).filter((f) => pupilIds.includes(f.pupilId) && f.status !== "closed" && f.status !== "draft").length;
  return `<div class="page-head"><div><h1>Department overview</h1><p>Compare classes, identify recurring weaknesses and make sure intervention is based on more than a single low mark.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Teacher department code</button></div></div>
    <div class="grid grid-4">${kpi("▤", "Linked classes", classes.length)}${kpi("♟", "Pupils", pupilIds.length)}${kpi("✎", "Open feedback loops", open)}${kpi("⚑", "High-risk pupils", high.length)}</div>
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Class tracking</h3><p>Average attainment and pupils below target.</p></div></div><div class="card-body">${classes.map((c) => { const pupils=pupilsForClass(c.id); const below=pupils.filter(p=>atRiskInfo(p.id,c.id).belowTarget).length; return `<div class="progress-row"><span>${e(c.name)}</span><div class="progress-track"><div class="progress-bar" style="width:${classAverage(c.id)}%"></div></div><strong>${classAverage(c.id)}%</strong><div class="small muted" style="grid-column:2/4">${below} below target · ${pupils.length} pupils</div></div>`; }).join("") || `<div class="empty">No linked classes.</div>`}</div></section><section class="card"><div class="card-head"><div><h3>Common misconceptions</h3><p>Feedback themes across the department.</p></div></div><div class="card-body">${miniBarSvg(skillCountsForClasses(classes), "count", "skill")}</div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Teacher department codes</h3><p>Share a department code with teachers joining your department. It can be reused until you disable it.</p></div><button class="btn btn-primary btn-sm" data-action="create-invite">Create code</button></div>${inviteCodeTable((state.data.invites || []).filter((i) => i.role === "teacher"))}</section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Pupils requiring review</h3><p>High and medium indicators are surfaced for professional judgement.</p></div><button class="btn btn-ghost btn-sm" data-route="at-risk">View full list</button></div>${riskTable(risks.filter((r) => r.level !== "Low").slice(0,8))}</section>`;
}

function riskTable(risks) {
  return `<div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Average</th><th>Target</th><th>Transparent reasons</th><th>Concern</th><th></th></tr></thead><tbody>${risks.map((risk) => `<tr><td><strong>${e(risk.pupil?.displayName)}</strong></td><td>${badge(risk.averageGrade)}${risk.averagePercentage !== null && risk.averagePercentage !== undefined ? ` <span class="small muted">${formatPercent(risk.averagePercentage)}</span>` : ""}</td><td>${badge(risk.targetGrade)}</td><td>${(risk.contributions || []).length ? `<ul class="risk-reason-list">${risk.contributions.map((item) => `<li>${e(item.label)} <strong>+${e(item.points)}</strong></li>`).join("")}</ul>` : `<span class="muted">No current automatic concern</span>`}</td><td>${badge(risk.level)}${riskExplanationHtml(risk, { compact: true })}</td><td><div class="table-actions"><button class="btn btn-ghost btn-sm" data-action="open-pupil" data-id="${risk.pupil?.id}">Dashboard</button><button class="btn btn-primary btn-sm" data-action="review-risk" data-id="${risk.pupil?.id}">Review</button></div></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No pupils currently flagged.</td></tr>`}</tbody></table></div>`;
}

function renderHeadClasses() {
  const classes = headClasses();
  const migrations = (state.data.classMigrationRequests || []).filter((request) => request.destinationSchoolId === state.profile.schoolId && headDepartmentIds().includes(request.destinationDepartmentId));
  return `<div class="page-head"><div><h1>Department classes</h1><p>Assign several teachers to shared classes, compare class patterns and approve classes moving in from individual teacher workspaces.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="add-class">Add class</button></div></div><div class="grid grid-3">${classes.map((c) => `<section class="card card-pad"><h3>${e(c.name)}</h3><p class="muted">${e(getSubjectName(c.subjectId))} · ${pupilsForClass(c.id).length} pupils</p><p class="small"><strong>Teachers:</strong> ${e((c.teacherIds || []).map(getUserName).join(", ") || "Not assigned")}</p><div class="progress-row"><span>Average</span><div class="progress-track"><div class="progress-bar" style="width:${classAverage(c.id)}%"></div></div><strong>${classAverage(c.id)}%</strong></div><p>${badge(`${pupilsForClass(c.id).filter(p=>atRiskInfo(p.id,c.id).level!=="Low").length} to review`)}</p><div class="form-actions"><button class="btn btn-ghost btn-sm" data-action="select-class" data-id="${c.id}">Open class</button><button class="btn btn-secondary btn-sm" data-action="assign-teacher" data-id="${c.id}">Manage teachers</button></div></section>`).join("")}</div>${teacherSelectedClass() ? `<section class="card" style="margin-top:18px"><div class="card-head"><h3>${e(teacherSelectedClass().name)}</h3><select class="btn btn-ghost" data-class-select>${selectOptions(classes, teacherSelectedClass().id)}</select></div>${classSnapshotTable(teacherSelectedClass())}</section>` : ""}${migrations.length ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Classes requesting to join this department</h3><p>Approve the destination first. The requesting teacher then starts or resumes the automatic browser migration from the school workspace.</p></div></div>${migrationRequestsTable(migrations, "head")}</section>` : ""}`;
}

function renderAtRisk() {
  const classes = headClasses();
  const pupilIds = unique(classes.flatMap((c) => pupilsForClass(c.id).map((p) => p.id)));
  const risks = pupilIds.map((id) => ({ pupil: byId(state.data.users, id), ...atRiskInfo(id) })).sort((a,b)=>b.score-a.score);
  return `<div class="page-head"><div><h1>At-risk pupils</h1><p>The app compares each pupil’s average grade with their target, while also considering declining results, unresolved feedback, repeated red feedback and active interventions.</p></div></div><div class="alert alert-info" style="margin-bottom:18px">A pupil is not flagged for being only one grade band below target. A gap of two or more grade bands contributes to the indicator, alongside other evidence. Teacher judgement remains essential.</div><section class="card">${riskTable(risks)}</section>`;
}

function renderAdminRoute() {
  if (state.route === "setup") return renderAdminSetup();
  if (state.route === "people") return renderAdminPeople();
  if (state.route === "requests") return renderAdminRequests();
  if (state.route === "audit") return renderAdminAudit();
  return renderAdminOverview();
}

function renderAdminOverview() {
  const pupils = state.data.users.filter((u) => isPupil(u));
  const staff = state.data.users.filter((u) => isStaff(u));
  const risks = pupils.map((p) => ({ pupil:p, ...atRiskInfo(p.id) })).filter((r)=>r.level!=="Low");
  const pendingMigrations = (state.data.classMigrationRequests || []).filter((request) => request.destinationSchoolId === state.profile.schoolId && ["requested", "accepted", "migrating"].includes(request.status));
  return `<div class="page-head"><div><h1>School administration</h1><p>Manage structure, permissions, access and safe migration without creating separate staff accounts.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Create internal staff code</button></div></div>
    <div class="grid grid-4">${kpi("♟", "Pupils", pupils.length)}${kpi("◎", "Staff", staff.length)}${kpi("▤", "Classes", state.data.classes.length)}${kpi("⇄", "Migration actions", pendingMigrations.length)}</div>
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Workspace access</h3><p>Access is controlled by the pilot licence, not by deleting school data.</p></div></div><div class="card-body"><p>${badge(workspaceStatus())} ${badge(currentSchool().licence?.type || "pilot")}</p>${currentSchool().licence?.trialEndsAt ? `<p><strong>Trial end:</strong> ${dateFmt(currentSchool().licence.trialEndsAt)}</p>` : ""}${currentSchool().licence?.sponsorName ? `<p><strong>Funded by:</strong> ${e(currentSchool().licence.sponsorName)}</p>` : ""}</div></section><section class="card"><div class="card-head"><div><h3>Leadership safety</h3></div></div><div class="card-body"><p><strong>${staff.filter((u)=>hasRole("schoolAdmin",u)).length}</strong> school administrator(s)</p><p><strong>${staff.filter((u)=>hasRole("departmentHead",u)).length}</strong> department head(s)</p><p><strong>${staff.filter((u)=>hasRole("teacher",u)).length}</strong> teacher(s)</p><p class="small muted">The final administrator and teachers with assigned classes cannot be removed accidentally.</p></div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Current concerns</h3><p>School-level visibility without exposing confidential notes to pupils.</p></div></div>${riskTable(risks.slice(0,10))}</section>`;
}

function renderAdminSetup() {
  return `<div class="page-head"><div><h1>School setup</h1><p>Create departments, subjects and classes. Administrators can temporarily lead departments during initial setup.</p></div><div class="page-actions"><button class="btn btn-ghost" data-action="add-department">Add department</button><button class="btn btn-ghost" data-action="add-subject">Add subject</button><button class="btn btn-primary" data-action="add-class">Add class</button></div></div>
    <div class="alert alert-info" style="margin-bottom:18px"><strong>School transfer code:</strong>&nbsp; <code>${e(currentSchool().transferCode || "Not configured")}</code></div>
    <div class="grid grid-2"><section class="card"><div class="card-head"><div><h3>Departments and leadership</h3></div></div><div class="table-wrap"><table><thead><tr><th>Department</th><th>Department head(s)</th></tr></thead><tbody>${state.data.departments.map((d)=>{const heads=state.data.users.filter((u)=>hasRole("departmentHead",u)&&headDepartmentIds(u).includes(d.id));return `<tr><td>${e(d.name)}</td><td>${e(heads.map((u)=>u.displayName).join(", ")||"School administrator emergency access")}</td></tr>`}).join("")||`<tr><td colspan="2" class="empty">No departments.</td></tr>`}</tbody></table></div></section>
    <section class="card"><div class="card-head"><div><h3>Subjects</h3></div></div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Department</th><th>Scale</th></tr></thead><tbody>${state.data.subjects.map((s)=>`<tr><td>${e(s.name)}</td><td>${e(byId(state.data.departments,s.departmentId)?.name||"")}</td><td>${e(s.gradeScale||"A-D")}</td></tr>`).join("")||`<tr><td colspan="3" class="empty">No subjects.</td></tr>`}</tbody></table></div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Classes</h3><p>Changing leadership never deletes classes, pupils or feedback.</p></div></div><div class="table-wrap"><table><thead><tr><th>Class</th><th>Subject</th><th>Teachers</th><th>Pupils</th><th></th></tr></thead><tbody>${state.data.classes.map((c)=>`<tr><td>${e(c.name)}</td><td>${e(getSubjectName(c.subjectId))}</td><td>${e((c.teacherIds||[]).map(getUserName).join(", ")||"Not assigned")}</td><td>${pupilsForClass(c.id).length}</td><td><button class="btn btn-ghost btn-sm" data-action="assign-teacher" data-id="${c.id}">Manage teachers</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

function renderAdminPeople() {
  const users = [...state.data.users].sort((a,b)=>a.displayName.localeCompare(b.displayName));
  const staff = users.filter((u) => isStaff(u));
  return `<div class="page-head"><div><h1>Staff roles and internal codes</h1><p>One login can hold teacher, department-head and school-administrator permissions in this school.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Create internal staff code</button></div></div>
    <section class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Permissions</th><th>Departments led</th><th>Assigned classes</th><th></th></tr></thead><tbody>${staff.map((u)=>{const classes=state.data.classes.filter(c=>(c.teacherIds||[]).includes(u.id));const led=headDepartmentIds(u).map((id)=>byId(state.data.departments,id)?.name).filter(Boolean);return `<tr><td><strong>${e(u.displayName)}</strong><div class="small muted">${e(u.email)}</div></td><td>${e(roleSummary(u))}</td><td>${e(led.join(", ")||"—")}</td><td>${e(classes.map(c=>c.name).join(", ")||"—")}</td><td><button class="btn btn-ghost btn-sm" data-action="manage-staff-roles" data-id="${u.id}">Manage roles</button></td></tr>`}).join("")||`<tr><td colspan="5" class="empty">No staff accounts.</td></tr>`}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Internal staff codes</h3><p>Codes can grant teacher access, department-head access, or both. Department heads always receive teacher permission.</p></div><button class="btn btn-primary btn-sm" data-action="create-invite">Create code</button></div>${inviteCodeTable((state.data.invites||[]).filter((i)=>i.role!=="pupil"))}</section>`;
}

function renderAdminRequests() {
  const emailRequests = sortByDateDesc(state.data.emailChangeRequests || [], "requestedAt");
  const transfers = sortByDateDesc(state.data.transferRequests || [], "requestedAt");
  const migrations = (state.data.classMigrationRequests || []).filter((request) => request.destinationSchoolId === state.profile.schoolId);
  return `<div class="page-head"><div><h1>Migration and approvals</h1><p>Approve class migration, pupil transfers and identity changes while preserving the original records.</p></div></div>
    <section class="card"><div class="card-head"><div><h3>Individual classes joining the school</h3><p>Approved migrations run as resumable browser phases and reconnect existing pupil accounts automatically.</p></div></div>${migrationRequestsTable(migrations, "admin")}</section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Email change requests</h3></div></div><div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Old email</th><th>Requested email</th><th>Status</th><th></th></tr></thead><tbody>${emailRequests.map((r)=>`<tr><td>${e(getUserName(r.pupilId))}</td><td>${e(r.oldEmail)}</td><td>${e(r.newEmail)}</td><td>${badge(r.status)}</td><td>${r.status==="requested"?`<button class="btn btn-primary btn-sm" data-action="approve-email" data-id="${r.id}">Approve</button> <button class="btn btn-danger btn-sm" data-action="decline-email" data-id="${r.id}">Decline</button>`:""}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">No email change requests.</td></tr>`}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>School transfer requests</h3></div></div><div class="table-wrap"><table><thead><tr><th>Pupil</th><th>From</th><th>To</th><th>Sharing</th><th>Status</th><th></th></tr></thead><tbody>${transfers.map((r)=>`<tr><td>${e(r.pupilName||getUserName(r.pupilId))}</td><td>${e(r.fromSchoolId)}</td><td>${e(r.toSchoolId)}</td><td>${e(r.shareLevel)}</td><td>${badge(r.status)}</td><td>${r.toSchoolId===state.profile.schoolId&&r.status==="requested"?`<button class="btn btn-primary btn-sm" data-action="accept-transfer" data-id="${r.id}">Accept</button> <button class="btn btn-danger btn-sm" data-action="decline-transfer" data-id="${r.id}">Decline</button>`:""}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">No transfer requests.</td></tr>`}</tbody></table></div></section>`;
}

function renderAdminAudit() {
  const logs = sortByDateDesc(state.data.auditLogs || [], "createdAt");
  const licence = currentSchool().licence || {};
  return `<div class="page-head"><div><h1>Licences and audit</h1><p>Workspace status is retained separately from school data. Audit records are append-only.</p></div></div>
    <div class="grid grid-3">${kpi("◎", "Workspace status", workspaceStatus())}${kpi("✓", "Licence", licence.type || "Pilot")}${kpi("◷", "Audit records", logs.length)}</div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Access details</h3></div></div><div class="card-body"><p><strong>Status:</strong> ${e(workspaceStatus())}</p><p><strong>Licence type:</strong> ${e(licence.type || "Not recorded")}</p>${licence.trialEndsAt ? `<p><strong>Trial ends:</strong> ${dateFmt(licence.trialEndsAt)}</p>` : ""}${licence.sponsorName ? `<p><strong>Access funded by:</strong> ${e(licence.sponsorName)}</p>` : ""}</div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Audit record</h3><p>Role changes, staff joins and completed migrations appear here.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Action</th><th>Performed by</th><th>Details</th></tr></thead><tbody>${logs.map((log)=>`<tr><td>${dateFmt(log.createdAt,{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"})}</td><td>${e(log.action||"")}</td><td>${e(log.userName||getUserName(log.userId)||"")}</td><td>${e(log.targetUserName||log.sourceClassId||log.migrationRequestId||"")}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">No audit records yet.</td></tr>`}</tbody></table></div></section>`;
}

function renderModal() {
  return `<div class="modal-backdrop" data-modal-backdrop><section class="modal" role="dialog" aria-modal="true" aria-label="${e(state.modal.title)}"><div class="modal-head"><h3>${e(state.modal.title)}</h3><button class="icon-btn" data-action="close-modal" type="button">×</button></div><div class="modal-body">${state.modal.body}</div></section></div>`;
}

function openModal(title, body) {
  state.modal = { title, body };
  renderShell();
}
function closeModal() {
  if (autosave.timer) clearTimeout(autosave.timer);
  autosave.timer = null;
  state.modal = null;
  renderShell();
}

function modalAddDepartment() {
  openModal("Add department", `<form data-form="add-department"><div class="field"><label>Department name</label><input name="name" required placeholder="Computing & Business"></div><div class="form-actions"><button class="btn btn-primary">Add department</button></div></form>`);
}

function modalAddSubject() {
  openModal("Add subject", `<form data-form="add-subject" class="form-grid"><div class="field"><label>Subject name</label><input name="name" required></div><div class="field"><label>Department</label><select name="departmentId" required>${selectOptions(state.data.departments, "")}</select></div><div class="field"><label>Grade scale</label><select name="gradeScale"><option>A1–D8</option><option>Percentage</option><option>Pass/Fail</option></select></div><div class="form-actions full"><button class="btn btn-primary">Add subject</button></div></form>`);
}

function modalJoinAnotherClass() {
  openModal("Join another class", `<form data-form="preview-class-join"><div class="field"><label>Class code</label><input name="inviteCode" placeholder="workspace-id~CODE" required><span class="field-help">Use the code supplied by the teacher for the additional class. Keep using this same pupil account.</span></div><div class="form-actions"><button class="btn btn-primary">Check class</button></div></form>`);
}

async function modalConfirmClassJoin(inviteCode) {
  const preview = await previewPupilClassInvite(inviteCode);
  openModal("Confirm class", `<div class="alert alert-info"><strong>${e(preview.className)}</strong><p>${e(preview.subjectName)} · ${e(preview.workspaceName)}</p></div><p>This class will be added to your existing learner profile. Your current classes and feedback will remain available.</p><form data-form="join-pupil-class"><input type="hidden" name="inviteCode" value="${e(preview.inviteCode)}"><div class="form-actions"><button class="btn btn-primary">Join class</button><button class="btn btn-ghost" type="button" data-action="close-modal">Cancel</button></div></form>`);
}

function migrationStatusBadge(request) {
  const label = request.status === "completed" ? "Moved"
    : request.status === "migrating" ? `Migrating · ${String(request.migrationPhase || "class").replaceAll("Records", " records").replaceAll("Reconnection", " reconnection")}`
      : request.status === "accepted" ? "Approved"
        : request.status === "declined" ? "Declined" : "Awaiting approval";
  return badge(label);
}

function migrationRequestsTable(requests, context = "teacher") {
  return `<div class="table-wrap"><table><thead><tr><th>Class</th><th>From</th><th>Destination</th><th>Status</th><th></th></tr></thead><tbody>${requests.map((request) => {
    let actions = "";
    if ((context === "admin" || context === "head") && request.destinationSchoolId === state.profile.schoolId && request.status === "requested") {
      actions = `<button class="btn btn-primary btn-sm" data-action="approve-class-migration" data-id="${e(request.id)}">Approve</button> <button class="btn btn-danger btn-sm" data-action="decline-class-migration" data-id="${e(request.id)}">Decline</button>`;
    } else if (context === "teacher" && request.createdBy === state.profile.id && request.destinationSchoolId === state.profile.schoolId && ["accepted", "migrating"].includes(request.status)) {
      actions = `<button class="btn btn-primary btn-sm" data-action="complete-class-migration" data-id="${e(request.id)}">${request.status === "migrating" ? "Resume migration" : "Start migration"}</button>`;
    } else if (request.status === "completed" && request.destinationClassId) {
      actions = `<span class="small muted">Class and pupils connected</span>`;
    }
    const progress = request.status === "migrating" ? `<div class="small muted">Safe to close the browser and resume later.</div>` : "";
    return `<tr><td><strong>${e(request.sourceClassName || "Class")}</strong><div class="small muted">Requested by ${e(request.createdByName || "teacher")}</div></td><td>${e(request.sourceWorkspaceName || request.sourceWorkspaceId || "")}</td><td>${e(request.destinationSchoolName || request.destinationSchoolId || "")}</td><td>${migrationStatusBadge(request)}${progress}</td><td>${actions}</td></tr>`;
  }).join("") || `<tr><td colspan="5" class="empty">No class moves.</td></tr>`}</tbody></table></div>`;
}

async function modalMoveClassToSchool(classId) {
  const cls = byId(state.data.classes, classId);
  if (!cls) return toast("Class not found.", "error");
  const destinations = (state.data.workspaces || []).filter((workspace) => workspace.id !== state.profile.schoolId && workspace.workspaceType !== "individualTeacher");
  if (!destinations.length) return toast("Join the school using its teacher department code first.", "error");
  const structures = [];
  for (const workspace of destinations) {
    try {
      const structure = await loadWorkspaceStructure(state.profile, workspace.id);
      const departmentIds = structure.membership.departmentIds || [];
      const departments = structure.departments.filter((department) => !departmentIds.length || departmentIds.includes(department.id));
      const subjects = structure.subjects.filter((subject) => departments.some((department) => department.id === subject.departmentId));
      if (departments.length && subjects.length) structures.push({ workspace, ...structure, departments, subjects });
    } catch (error) {
      console.warn("Could not load destination workspace", workspace.id, error);
    }
  }
  if (!structures.length) return toast("The linked school has no available department and subject for this teacher yet.", "error");
  const first = structures[0];
  const structureJson = e(JSON.stringify(structures.map((item) => ({
    schoolId: item.workspace.id,
    schoolName: item.workspace.name,
    departments: item.departments.map((department) => ({ id: department.id, name: department.name })),
    subjects: item.subjects.map((subject) => ({ id: subject.id, name: subject.name, departmentId: subject.departmentId }))
  }))));
  openModal("Move class into a school workspace", `<div class="alert alert-info"><strong>No feedback will be lost.</strong><p>FeedbackLoop copies the class, memberships, results, feedback and actions into the school workspace. The original individual copy remains available as a historical backup.</p></div><form data-form="request-class-migration" class="form-grid" data-migration-structures="${structureJson}"><input type="hidden" name="sourceClassId" value="${e(cls.id)}"><div class="field full"><label>Class</label><input value="${e(cls.name)}" disabled></div><div class="field"><label>School workspace</label><select name="destinationSchoolId" data-migration-school required>${structures.map((item) => `<option value="${e(item.workspace.id)}">${e(item.workspace.name)}</option>`).join("")}</select></div><div class="field"><label>Department</label><select name="destinationDepartmentId" data-migration-department required>${first.departments.map((department) => `<option value="${e(department.id)}">${e(department.name)}</option>`).join("")}</select></div><div class="field full"><label>Subject</label><select name="destinationSubjectId" data-migration-subject required>${first.subjects.filter((subject) => subject.departmentId === first.departments[0].id).map((subject) => `<option value="${e(subject.id)}">${e(subject.name)}</option>`).join("")}</select></div><div class="form-actions full"><button class="btn btn-primary">Request class move</button></div></form>`);
}

function modalJoinSchoolWorkspace() {
  openModal("Add another staff workspace", `<form data-form="join-school-workspace"><div class="field"><label>Internal staff, teacher-department or co-teacher code</label><input name="inviteCode" placeholder="workspace-id~CODE" required><span class="field-help">Your existing workspaces and roles remain available. Any new permissions are merged into this same login.</span></div><div class="form-actions"><button class="btn btn-primary">Add workspace</button></div></form>`);
}

function modalAddClass() {
  const area = ensureArea();
  const departmentIds = area === "schoolAdmin" || currentSchool().workspaceType === "individualTeacher"
    ? state.data.departments.map((department) => department.id)
    : area === "departmentHead" ? headDepartmentIds() : unique(classesVisibleToProfile().map((item) => item.departmentId));
  const subjects = state.data.subjects.filter((subject) => departmentIds.includes(subject.departmentId));
  const personalWorkspace = currentSchool().workspaceType === "individualTeacher";
  const teachers = state.data.users.filter((user) => hasRole("teacher", user) && (personalWorkspace || isStaff(user)));
  if (!subjects.length) return toast("Create or join a department with at least one subject first.", "error");
  openModal("Add class", `<form data-form="add-class" class="form-grid"><div class="field"><label>Class name</label><input name="name" required placeholder="4A Computing"></div><div class="field"><label>Subject</label><select name="subjectId" required>${selectOptions(subjects, "")}</select></div><div class="field"><label>Lead teacher</label><select name="teacherId"><option value="">Not assigned</option>${selectOptions(teachers, hasRole("teacher") ? state.profile.id : "", "displayName")}</select></div><div class="field"><label>Academic year</label><input name="academicYear" value="2026/27"></div><div class="field"><label>Qualification</label><input name="targetQualification" placeholder="National 5"></div><div class="form-actions full"><button class="btn btn-primary">Create class</button></div></form>`);
}

function inviteCodeTable(invites) {
  return `<div class="table-wrap"><table><thead><tr><th>Label</th><th>For</th><th>Code</th><th>Status</th><th></th></tr></thead><tbody>${invites.map((i) => `<tr><td>${e(i.label || "")}</td><td>${e(i.scopeLabel || roleLabels[i.role] || i.role)}</td><td><code>${e(i.id)}</code></td><td>${badge(i.active ? "Active" : "Disabled")}</td><td><button class="btn btn-ghost btn-sm" data-action="copy-code" data-code="${e(i.id)}">Copy</button> <button class="btn btn-ghost btn-sm" data-action="toggle-invite" data-id="${e(i.id)}" data-active="${i.active ? "true" : "false"}">${i.active ? "Disable" : "Enable"}</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No codes have been created yet.</td></tr>`}</tbody></table></div>`;
}


function modalAssignTeacher(classId) {
  const cls = byId(state.data.classes, classId);
  if (!cls) return toast("Class not found.", "error");
  const personalWorkspace = currentSchool().workspaceType === "individualTeacher";
  const teachers = state.data.users.filter((user) => hasRole("teacher", user) && (personalWorkspace || isStaff(user)));
  if (!teachers.length) return toast("No teacher has joined this workspace yet.", "error");
  const options = teachers.map((teacher) => `<label class="check-card"><input type="checkbox" name="teacherIds" value="${e(teacher.id)}" ${(cls.teacherIds || []).includes(teacher.id) ? "checked" : ""}><span><strong>${e(teacher.displayName)}</strong><small>${e(roleSummary(teacher))} · ${e(teacher.email || "")}</small></span></label>`).join("");
  openModal("Manage class teachers", `<form data-form="assign-teacher" class="form-grid"><input type="hidden" name="classId" value="${e(cls.id)}"><div class="field full"><label>Class</label><input value="${e(cls.name)}" disabled></div><div class="field full"><label>Teachers sharing this class</label><div class="check-card-list">${options}</div><span class="field-help">A teacher role cannot later be removed until these class assignments have been reassigned.</span></div><div class="form-actions full"><button class="btn btn-primary">Save teachers</button></div></form>`);
}

function modalCreateCoTeacherInvite(classId) {
  const cls = byId(classesVisibleToProfile(), classId);
  if (!cls || currentSchool().workspaceType !== "individualTeacher" || currentSchool().ownerId !== state.profile.id) return toast("Only the individual workspace owner can create a co-teacher code.", "error");
  openModal("Create co-teacher code", `<div class="alert alert-info">This code lets another teacher add this individual workspace to their existing account and automatically assigns them to <strong>${e(cls.name)}</strong>.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="classTeacher"><input type="hidden" name="classId" value="${e(cls.id)}"><div class="field full"><label>Label</label><input name="label" required value="${e(cls.name)} co-teacher code"></div><div class="form-actions full"><button class="btn btn-primary">Generate reusable co-teacher code</button></div></form>`);
}

function modalCreateInvite(prefill = {}) {
  const area = ensureArea();
  if (area === "teacher") {
    const classes = classesVisibleToProfile();
    const selected = byId(classes, prefill.classId) || classes[0];
    if (!selected) return toast("You must be assigned to a class before creating a pupil code.", "error");
    openModal("Create pupil class code", `<div class="alert alert-info">Every pupil who uses this code joins only the selected class.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="classPupil"><div class="field full"><label>Class</label><select name="classId" required>${selectOptions(classes, selected.id)}</select></div><div class="field full"><label>Label</label><input name="label" required value="${e(selected.name)} pupil class code"></div><div class="form-actions full"><button class="btn btn-primary">Generate class code</button></div></form>`);
    return;
  }
  const departments = area === "departmentHead"
    ? state.data.departments.filter((department) => headDepartmentIds().includes(department.id))
    : state.data.departments;
  const selected = byId(departments, prefill.departmentId) || departments[0];
  if (!selected) return toast("Create a department before creating this code.", "error");
  if (area === "departmentHead") {
    openModal("Create teacher department code", `<div class="alert alert-info">This code adds teacher permission in the selected department. Class access still depends on teacher assignment.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="departmentTeacher"><div class="field full"><label>Department</label><select name="departmentId" required>${selectOptions(departments, selected.id)}</select></div><div class="field full"><label>Label</label><input name="label" required value="${e(selected.name)} teacher code"></div><div class="form-actions full"><button class="btn btn-primary">Generate teacher code</button></div></form>`);
    return;
  }
  openModal("Create internal staff code", `<div class="alert alert-info">Choose the permissions this code grants. Department-head access automatically includes teacher access.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="internalStaff"><div class="field full"><label>Department</label><select name="departmentId" required>${selectOptions(departments, selected.id)}</select></div><div class="field full"><label>Permissions</label><div class="check-card-list"><label class="check-card"><input type="checkbox" name="grantTeacher" checked><span><strong>Teacher</strong><small>Can see only classes they are assigned to.</small></span></label><label class="check-card"><input type="checkbox" name="grantDepartmentHead"><span><strong>Department head</strong><small>Can see every class and pupil in the selected department; teacher access is included.</small></span></label><label class="check-card"><input type="checkbox" name="grantSchoolAdmin"><span><strong>School administrator</strong><small>Can manage setup, roles, licences, approvals and audit records.</small></span></label></div></div><div class="field full"><label>Label</label><input name="label" required value="${e(selected.name)} internal staff code"></div><div class="form-actions full"><button class="btn btn-primary">Generate internal code</button></div></form>`);
}

function modalManageStaffRoles(userId) {
  const user = byId(state.data.users, userId);
  if (!user || !isStaff(user)) return toast("Staff account not found.", "error");
  const roles = accessRoles(user);
  const departments = state.data.departments;
  openModal(`Manage roles — ${user.displayName}`, `<div class="alert alert-info">Changing permissions never deletes classes, pupils, results or feedback. The final administrator is protected, and teacher access cannot be removed while classes are still assigned.</div><form data-form="manage-staff-roles" class="form-grid"><input type="hidden" name="userId" value="${e(user.id)}"><div class="field full"><label>Permissions</label><div class="check-card-list"><label class="check-card"><input type="checkbox" name="schoolAdmin" ${roles.schoolAdmin ? "checked" : ""}><span><strong>School administrator</strong><small>School setup, roles, licences, migration approvals and audit.</small></span></label><label class="check-card"><input type="checkbox" name="departmentHead" ${roles.departmentHead ? "checked" : ""}><span><strong>Department head</strong><small>Automatically includes teacher access.</small></span></label><label class="check-card"><input type="checkbox" name="teacher" ${roles.teacher ? "checked" : ""}><span><strong>Teacher</strong><small>My classes contains only assigned classes.</small></span></label></div></div><div class="field full"><label>Departments led</label><div class="check-card-list">${departments.map((department)=>`<label class="check-card"><input type="checkbox" name="headDepartmentIds" value="${e(department.id)}" ${headDepartmentIds(user).includes(department.id) ? "checked" : ""}><span><strong>${e(department.name)}</strong><small>Department overview access.</small></span></label>`).join("")}</div></div><div class="form-actions full"><button class="btn btn-primary">Save permissions</button></div></form>`);
}

function classPupilOptions(classId) {
  return pupilsForClass(classId).map((p)=>`<option value="${e(p.id)}">${e(p.displayName)}</option>`).join("");
}

function modalAddAssessment() {
  const classes = classesVisibleToProfile();
  const cls = byId(classes,state.selectedClassId)||classes[0];
  openModal("Add assessment result", `<form data-form="add-assessment" class="form-grid" data-grade-calculator><div class="field"><label>Class</label><select name="classId" required data-form-class>${selectOptions(classes,cls?.id)}</select></div><div class="field"><label>Pupil</label><select name="pupilId" required data-form-pupil>${classPupilOptions(cls?.id)}</select></div><div class="field full"><label>Assessment name</label><input name="name" required placeholder="National 5 prelim"></div><div class="field"><label>Topic or skill</label><input name="topic" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${todayInput()}" required></div><div class="field"><label>Score</label><input type="number" step="0.5" min="0" name="score" required data-score></div><div class="field"><label>Maximum score</label><input type="number" step="0.5" min="0.5" name="maxScore" required data-max-score></div><div class="field full"><div class="alert alert-info" data-grade-preview>Enter the mark and total. The percentage and grade will be calculated automatically.</div><span class="field-help">A1 85%+ · A2 70–84% · B3 65–69% · B4 60–64% · C5 55–59% · C6 50–54% · D7 45–49% · D8 40–44% · 39% and below No Award.</span></div><div class="form-actions full"><button class="btn btn-primary">Save result</button></div></form>`);
}

function modalStartFeedbackSession() {
  const classes = classesVisibleToProfile();
  const cls = byId(classes, state.selectedClassId) || classes[0];
  if (!cls) return toast("Create or join a class before starting a feedback session.", "error");
  openModal("Start live feedback session", `<form data-form="start-feedback-session" class="form-grid"><div class="field full"><label>Class</label><select name="classId" required>${selectOptions(classes, cls.id)}</select></div><div class="field"><label>Feedback type</label><select name="feedbackType" required>${feedbackTypeOptions("Prelim")}</select></div><div class="field"><label>Date</label><input type="date" name="date" value="${todayInput()}" required></div><div class="field full"><label>Assessment or activity title</label><input name="title" required placeholder="For example: Programming prelim feedback"></div><div class="field"><label>Topic or skill</label><input name="skill" required placeholder="For example: Programming"></div><div class="field"><label>Paper, section or component <span class="muted">(optional)</span></label><input name="assessmentComponent" placeholder="For example: Paper 1"></div><div class="field full"><label>Instructions for pupils <span class="muted">(optional)</span></label><textarea name="instructions" placeholder="For example: Use your marked paper and record one precise mistake."></textarea></div><div class="full alert alert-info">Pupils in this class will see the session with the class, title, topic and feedback type already completed. Their drafts will appear live as they autosave.</div><div class="form-actions full"><button class="btn btn-primary">Start session</button></div></form>`);
}

function modalViewFeedbackSession(sessionId) {
  const session = byId(state.data.feedbackSessions, sessionId);
  if (!session) return toast("Feedback session not found.", "error");
  const stats = feedbackSessionStats(session);
  const rows = stats.pupils.map((pupil) => {
    const record = sortByDateDesc(stats.records.filter((item) => item.pupilId === pupil.id), "updatedAt")[0];
    const active = record?.status === "draft" && new Date(record.autosavedAt || record.updatedAt || 0).getTime() >= Date.now() - 5 * 60 * 1000;
    const status = !record ? "Not started" : record.status === "draft" ? (active ? "Active now" : "Draft saved") : "Submitted";
    return `<tr><td><strong>${e(pupil.displayName)}</strong></td><td>${badge(status)}</td><td>${record ? dateFmt(record.autosavedAt || record.updatedAt || record.submittedAt, { hour: "2-digit", minute: "2-digit" }) : "—"}</td><td>${record ? badge(record.trafficLight || "Amber") : "—"}</td><td>${record ? `<button class="btn btn-ghost btn-sm" data-action="view-feedback" data-id="${e(record.id)}">View</button>` : ""}</td></tr>`;
  }).join("");
  openModal(session.title, `<div class="timeline-meta">${badge(session.status)} ${badge(session.feedbackType)}</div><p>${e(getClassName(session.classId))} · ${e(session.skill)} · ${dateFmt(session.date)}</p>${session.instructions ? `<div class="alert alert-info">${e(session.instructions)}</div>` : ""}<div class="grid grid-4" style="margin-top:16px">${kpi("✓", "Submitted", stats.submitted.length)}${kpi("◉", "Active now", stats.activeNow.length)}${kpi("✎", "Drafts", stats.drafts.length)}${kpi("—", "Not started", stats.notStarted.length)}</div><div class="table-wrap" style="margin-top:18px"><table><thead><tr><th>Pupil</th><th>Status</th><th>Last activity</th><th>Confidence</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="5" class="empty">No pupils are linked to this class.</td></tr>`}</tbody></table></div><div class="form-actions"><button class="btn btn-ghost" data-action="copy-incomplete-session" data-id="${e(session.id)}">Copy incomplete list</button>${session.status === "open" ? `<button class="btn btn-secondary" data-action="close-feedback-session" data-id="${e(session.id)}">Close session</button>` : `<button class="btn btn-secondary" data-action="reopen-feedback-session" data-id="${e(session.id)}">Reopen session</button>`}</div>`);
}

function findImprovementItem(itemId, feedbackId = "") {
  const stored = byId(state.data.improvementBank || [], itemId) || (state.data.improvementBank || []).find((item) => feedbackId && item.feedbackId === feedbackId);
  if (stored) return { ...stored, stored: true };
  return improvementItemsForPupil().find((item) => item.id === itemId || (feedbackId && item.feedbackId === feedbackId)) || null;
}

function modalManageImprovement(itemId, feedbackId = "") {
  const item = findImprovementItem(itemId, feedbackId);
  if (!item) return toast("Improvement item not found.", "error");
  openModal("Update improvement item", `<form data-form="manage-improvement" class="form-grid"><input type="hidden" name="itemId" value="${e(item.stored ? item.id : "")}"><input type="hidden" name="feedbackId" value="${e(item.feedbackId || feedbackId)}"><div class="field full"><label>Topic</label><input name="topic" value="${e(item.topic || "")}" required></div><div class="field full"><label>Mistake or issue to remember</label><textarea name="mistake" required>${e(item.mistake || "")}</textarea></div><div class="field full"><label>What I will do instead</label><textarea name="improvementPlan" required>${e(item.improvementPlan || "")}</textarea></div><div class="field"><label>Status</label><select name="status"><option ${item.status === "New" ? "selected" : ""}>New</option><option ${item.status === "Practising" ? "selected" : ""}>Practising</option><option ${item.status === "Improved" ? "selected" : ""}>Improved</option><option ${item.status === "Secure" ? "selected" : ""}>Secure</option><option ${item.status === "Needs revisiting" ? "selected" : ""}>Needs revisiting</option></select></div><div class="field"><label>Confidence</label><select name="confidence"><option ${item.confidence === "Green" ? "selected" : ""}>Green</option><option ${item.confidence === "Amber" ? "selected" : ""}>Amber</option><option ${item.confidence === "Red" ? "selected" : ""}>Red</option></select></div><div class="field full"><label>Evidence of improvement <span class="muted">(optional)</span></label><textarea name="evidence" placeholder="For example: corrected the answer and completed two similar questions.">${e(item.evidence || "")}</textarea></div><div class="field full checkbox-row"><label><input type="checkbox" name="pinned" ${item.pinned ? "checked" : ""}> Pin this item near the top of my bank</label></div><div class="form-actions full"><button class="btn btn-primary">Save improvement</button></div></form>`);
}

function modalRiskReview(pupilId, classId = "") {
  const pupil = byId(state.data.users, pupilId);
  if (!pupil) return toast("Pupil not found.", "error");
  const risk = atRiskInfo(pupilId, classId || null);
  openModal(`Review support indicator — ${pupil.displayName}`, `<form data-form="review-risk" class="form-grid"><input type="hidden" name="pupilId" value="${e(pupilId)}"><input type="hidden" name="classId" value="${e(classId)}"><input type="hidden" name="calculatedLevel" value="${e(risk.calculatedLevel)}"><div class="field full">${riskExplanationHtml(risk)}</div><div class="field full"><label>Teacher-reviewed concern level</label><select name="selectedLevel" required><option value="Low" ${risk.level === "Low" ? "selected" : ""}>Low</option><option value="Medium" ${risk.level === "Medium" ? "selected" : ""}>Medium</option><option value="High" ${risk.level === "High" ? "selected" : ""}>High</option></select><span class="field-help">The calculated level remains visible. This records professional context rather than changing the algorithm.</span></div><div class="field full"><label>Reason for the decision</label><textarea name="reason" required placeholder="For example: recent absence explains the missing work; review after catch-up week.">${e(risk.override?.reason || "")}</textarea></div><div class="field"><label>Review date</label><input type="date" name="reviewDate" value="${e(risk.override?.reviewDate || "")}" required></div><div class="field"><label>Decision type</label><select name="decision"><option value="confirm">Confirm calculated concern</option><option value="reduce" ${risk.override?.decision === "reduce" ? "selected" : ""}>Reduce concern</option><option value="increase" ${risk.override?.decision === "increase" ? "selected" : ""}>Increase concern</option><option value="dismiss" ${risk.override?.decision === "dismiss" ? "selected" : ""}>Temporarily dismiss</option><option value="reviewed" ${risk.override?.decision === "reviewed" ? "selected" : ""}>Mark reviewed</option></select></div><div class="form-actions full"><button class="btn btn-primary">Save professional review</button></div></form>`);
}

function modalAddFeedback() {
  const classes = classesVisibleToProfile();
  const cls = byId(classes,state.selectedClassId)||classes[0];
  openModal("Add pupil feedback", `<form data-form="add-feedback" class="form-grid"><div class="field"><label>Class</label><select name="classId" required data-form-class>${selectOptions(classes,cls?.id)}</select></div><div class="field"><label>Pupil</label><select name="pupilId" required data-form-pupil>${classPupilOptions(cls?.id)}</select></div><div class="field"><label>Assessment or activity</label><input name="assessmentName" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${todayInput()}" required></div><div class="field"><label>Skill or topic</label><input name="skill" required></div><div class="field"><label>Feedback type</label><select name="feedbackType"><option>Exam</option><option>Written</option><option>Progress Check</option><option>Timed Question</option><option>Homework</option><option>Coursework</option><option>Verbal</option><option>Practical Work</option></select></div><div class="field full"><label>Strength</label><textarea name="strength" required placeholder="Be specific about what the pupil did well."></textarea></div><div class="field full"><label>Next step</label><textarea name="nextStep" required placeholder="Give one precise action that can be completed and checked."></textarea></div><div class="field"><label>Traffic light</label><select name="trafficLight"><option>Green</option><option selected>Amber</option><option>Red</option></select></div><div class="field"><label>Private teacher note (optional)</label><input name="teacherNotes"></div><div class="form-actions full"><button class="btn btn-primary">Save feedback</button></div></form>`);
}

function richEditor(field, label, value = "", placeholder = "") {
  return `<div class="field full rich-editor-field">
    <label>${e(label)}</label>
    <div class="rich-editor-shell">
      <div class="rich-toolbar" role="toolbar" aria-label="Text formatting">
        <button type="button" class="format-button" data-editor-command="bold" title="Bold selected text"><strong>B</strong></button>
        <button type="button" class="format-button list-format" data-editor-command="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">• List</button>
        <button type="button" class="format-button list-format" data-editor-command="insertOrderedList" title="Numbered list" aria-label="Numbered list">1. List</button>
        <span class="toolbar-label">Highlight</span>
        <button type="button" class="highlight-button highlight-yellow" data-editor-command="highlight" data-colour="#fff3a3" aria-label="Yellow highlight"></button>
        <button type="button" class="highlight-button highlight-green" data-editor-command="highlight" data-colour="#d3f5d5" aria-label="Green highlight"></button>
        <button type="button" class="highlight-button highlight-pink" data-editor-command="highlight" data-colour="#ffd6e8" aria-label="Pink highlight"></button>
        <button type="button" class="highlight-button highlight-blue" data-editor-command="highlight" data-colour="#cfe5ff" aria-label="Blue highlight"></button>
        <button type="button" class="format-button clear-format" data-editor-command="removeFormat">Clear formatting</button>
      </div>
      <div class="rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-rich-field="${e(field)}" data-placeholder="${e(placeholder)}">${sanitiseRichHtml(value)}</div>
    </div>
  </div>`;
}

function modalPupilAddFeedback(recordId = null, sessionId = null) {
  const memberships = (state.data.memberships || []).filter((membership) => membership.userId === state.profile.id && membership.active !== false && (!state.selectedSubjectId || membership.subjectId === state.selectedSubjectId));
  const classes = memberships.map((membership) => byId(state.data.classes, membership.classId)).filter(Boolean);
  const draft = recordId ? byId(state.data.feedbackRecords, recordId) : null;
  const session = sessionId ? byId(state.data.feedbackSessions, sessionId) : (draft?.sessionId ? byId(state.data.feedbackSessions, draft.sessionId) : null);
  const cls = byId(classes, draft?.classId || session?.classId) || classes[0];
  if (!cls) {
    toast("You need to be linked to a class before adding feedback.", "error");
    return;
  }

  const selectedType = feedbackTypes[draft?.feedbackType || session?.feedbackType] ? (draft?.feedbackType || session?.feedbackType) : "Prelim";
  const savedLabel = draft?.autosavedAt || draft?.updatedAt ? `Saved ${dateFmt(draft.autosavedAt || draft.updatedAt, { hour: "2-digit", minute: "2-digit" })}` : "Not saved yet";
  openModal(draft ? "Continue feedback draft" : session ? session.title : "New feedback record", `<form data-form="pupil-feedback-editor" data-feedback-editor class="form-grid" novalidate>
    <input type="hidden" name="recordId" value="${e(draft?.id || "")}">
    <input type="hidden" name="sessionId" value="${e(session?.id || draft?.sessionId || "")}">
    <input type="hidden" name="sessionFeedbackType" value="${e(session?.feedbackType || draft?.feedbackType || "")}">
    <input type="hidden" name="lockedClassId" value="${e(draft?.classId || session?.classId || "")}">
    <div class="full autosave-status" data-autosave-status data-state="${draft ? "saved" : "idle"}">
      <span class="autosave-dot"></span><div><strong>${e(savedLabel)}</strong><small>Your draft saves automatically and can be continued another day.</small></div>
    </div>
    ${session?.instructions ? `<div class="full alert alert-info"><strong>Teacher instructions</strong><p>${e(session.instructions)}</p></div>` : ""}
    <div class="field full"><label>Class and subject</label><select name="classId" required data-feedback-class ${draft || session ? "disabled" : ""}>${selectOptions(classes, cls.id)}</select></div>
    <div class="field"><label>Type of feedback</label><select name="feedbackType" required data-feedback-type ${session ? "disabled" : ""}>${feedbackTypeOptions(selectedType)}</select></div>
    <div class="field"><label>Date feedback was received</label><input type="date" name="date" value="${e(draft?.date || session?.date || todayInput())}" required ${session ? "readonly" : ""}></div>
    <div class="field full"><label data-feedback-title-label>Feedback title</label><input name="assessmentName" value="${e(draft?.assessmentName || session?.title || "")}" data-feedback-title placeholder="" ${session ? "readonly" : ""}></div>
    <div class="field full"><label>Topic, skill or area</label><input name="skill" value="${e(draft?.skill || session?.skill || "")}" required placeholder="For example: SQL, evaluation or explaining answers precisely" ${session ? "readonly" : ""}></div>
    <div class="field full" data-prelim-extra>
      <label>Paper, section or component <span class="muted">(optional)</span></label>
      <input name="assessmentComponent" value="${e(draft?.assessmentComponent || session?.assessmentComponent || "")}" placeholder="For example: Paper 1, Section 2 or practical task" ${session ? "readonly" : ""}>
    </div>
    <div class="field full" data-result-fields>
      <div class="result-grid">
        <div class="field"><label>My mark</label><input type="number" step="0.5" min="0" name="score" value="${e(draft?.score ?? "")}" data-score></div>
        <div class="field"><label>What it was out of</label><input type="number" step="0.5" min="0.5" name="maxScore" value="${e(draft?.maxScore ?? "")}" data-max-score></div>
      </div>
      <div class="grade-preview" data-grade-preview>Enter both marks to calculate the percentage and grade.</div>
      <span class="field-help">A1 85%+ · A2 70–84% · B3 65–69% · B4 60–64% · C5 55–59% · C6 50–54% · D7 45–49% · D8 40–44% · 39% and below No Award.</span>
    </div>
    ${richEditor("strengthHtml", "What went well or what should I remember?", draft?.strengthHtml || (draft?.strength ? `<p>${e(draft.strength)}</p>` : ""), "Write your own notes about what went well or what the feedback helped you understand.")}
    ${richEditor("nextStepHtml", "My next steps — what must I watch out for next time?", draft?.nextStepHtml || (draft?.nextStep ? `<p>${e(draft.nextStep)}</p>` : ""), "Be specific. Record the mistake, misunderstanding or habit you do not want to repeat.")}
    <div class="field"><label>How confident do I feel now?</label><select name="trafficLight"><option ${draft?.trafficLight === "Green" ? "selected" : ""}>Green</option><option ${!draft?.trafficLight || draft?.trafficLight === "Amber" ? "selected" : ""}>Amber</option><option ${draft?.trafficLight === "Red" ? "selected" : ""}>Red</option></select></div>
    <div class="field"><label>Anything else to remember? <span class="muted">(optional)</span></label><input name="pupilNote" value="${e(draft?.pupilNote || "")}" placeholder="For example: ask for help with question 4"></div>
    <div class="full alert alert-info">Your teacher can see this draft appearing live as it autosaves. You do not need to wait for the teacher to enter or approve the result.</div>
    <div class="form-actions full feedback-editor-actions"><button type="button" class="btn btn-ghost" data-action="save-feedback-draft">Save draft now</button><button type="submit" class="btn btn-primary">Finish and add to my record</button></div>
  </form>`);
  queueMicrotask(() => {
    const form = document.querySelector('form[data-form="pupil-feedback-editor"]');
    if (form) {
      updateFeedbackEditorFields(form);
      updateGradePreview(form);
    }
  });
}

function updateFeedbackEditorFields(form) {
  const type = form.elements.feedbackType?.value || "Other";
  const config = feedbackTypes[type] || feedbackTypes.Other;
  const title = form.querySelector("[data-feedback-title]");
  const titleLabel = form.querySelector("[data-feedback-title-label]");
  const resultFields = form.querySelector("[data-result-fields]");
  const prelimExtra = form.querySelector("[data-prelim-extra]");
  if (title) {
    title.placeholder = config.titlePlaceholder;
    title.required = config.titleRequired;
  }
  if (titleLabel) titleLabel.textContent = config.titleLabel;
  resultFields?.classList.toggle("hidden", config.result === "none");
  prelimExtra?.classList.toggle("hidden", !config.extra);
  const score = form.elements.score;
  const maxScore = form.elements.maxScore;
  if (score && maxScore) {
    score.required = config.result === "required";
    maxScore.required = config.result === "required";
    if (config.result === "none") { score.value = ""; maxScore.value = ""; }
  }
}

function updateGradePreview(form) {
  const preview = form.querySelector("[data-grade-preview]");
  if (!preview) return;
  const type = form.elements.feedbackType?.value;
  const config = feedbackTypes[type] || feedbackTypes.Other;
  if (config.result === "none") {
    preview.innerHTML = `<strong>No test result needed.</strong> This feedback type records the discussion and your next step.`;
    return;
  }
  const score = form.elements.score?.value;
  const maxScore = form.elements.maxScore?.value;
  if (score === "" || maxScore === "") {
    preview.textContent = config.result === "required" ? "Enter both marks. This feedback type requires a result." : "Add both marks if this work was marked, or leave them blank.";
    return;
  }
  try {
    const result = percentageAndGrade(score, maxScore);
    preview.innerHTML = `<strong>${result.score} / ${result.maxScore} = ${result.percentage}% · ${e(result.grade)}</strong>`;
  } catch (error) {
    preview.textContent = error.message;
  }
}

function setAutosaveStatus(form, status, title, detail = "") {
  const box = form?.querySelector("[data-autosave-status]");
  if (!box) return;
  box.dataset.state = status;
  box.innerHTML = `<span class="autosave-dot"></span><div><strong>${e(title)}</strong><small>${e(detail || "Your draft saves automatically and can be continued another day.")}</small></div>`;
}

function readFeedbackEditor(form, final = false) {
  const data = Object.fromEntries(new FormData(form).entries());
  const selectedClassId = data.lockedClassId || data.classId;
  const cls = byId(state.data.classes, selectedClassId);
  if (!cls) throw new Error("Choose a valid class and subject.");
  const selectedFeedbackType = data.feedbackType || data.sessionFeedbackType || "Other";
  const config = feedbackTypes[selectedFeedbackType] || feedbackTypes.Other;
  const strengthHtml = sanitiseRichHtml(form.querySelector('[data-rich-field="strengthHtml"]')?.innerHTML || "");
  const nextStepHtml = sanitiseRichHtml(form.querySelector('[data-rich-field="nextStepHtml"]')?.innerHTML || "");
  const strength = plainTextFromHtml(strengthHtml);
  const nextStep = plainTextFromHtml(nextStepHtml);
  const hasScore = data.score !== "";
  const hasMaximum = data.maxScore !== "";
  let result = {
    score: hasScore && Number.isFinite(Number(data.score)) ? Number(data.score) : null,
    maxScore: hasMaximum && Number.isFinite(Number(data.maxScore)) ? Number(data.maxScore) : null
  };
  if (hasScore && hasMaximum) result = percentageAndGrade(data.score, data.maxScore);
  if (final && (config.result === "required" || hasScore || hasMaximum) && !(hasScore && hasMaximum)) {
    throw new Error("Enter both your mark and what it was out of.");
  }
  if (final) {
    if (!data.assessmentName?.trim()) throw new Error("Give the feedback record a clear title.");
    if (!data.skill?.trim()) throw new Error("Enter the topic, skill or area.");
    if (!nextStep) throw new Error("Add what you need to watch out for next time.");
  }
  return {
    pupilId: state.profile.id,
    classId: selectedClassId,
    subjectId: cls.subjectId,
    teacherId: (data.sessionId ? byId(state.data.feedbackSessions, data.sessionId)?.createdBy : "") || cls.teacherIds?.[0] || "",
    sessionId: data.sessionId || "",
    feedbackType: selectedFeedbackType,
    assessmentName: data.assessmentName?.trim() || "Untitled feedback",
    assessmentComponent: data.assessmentComponent?.trim() || "",
    date: data.date || todayInput(),
    skill: data.skill?.trim() || "Draft",
    score: result.score ?? null,
    maxScore: result.maxScore ?? null,
    percentage: result.percentage ?? null,
    grade: result.grade ?? "",
    strength,
    strengthHtml,
    nextStep,
    nextStepHtml,
    trafficLight: data.trafficLight || "Amber",
    pupilNote: data.pupilNote?.trim() || "",
    entrySource: "pupil",
    verificationStatus: "selfEntered",
    status: final ? "open" : "draft",
    submissionStatus: final ? "submitted" : "draft",
    autosavedAt: new Date().toISOString(),
    submittedAt: final ? new Date().toISOString() : null
  };
}

async function syncImprovementBankItem(recordId, payload, { preserveProgress = true } = {}) {
  if (!recordId || !payload?.pupilId || !payload?.nextStep) return null;
  const existing = (state.data?.improvementBank || []).find((item) => item.feedbackId === recordId);
  const base = {
    feedbackId: recordId,
    pupilId: payload.pupilId,
    classId: payload.classId,
    subjectId: payload.subjectId,
    title: payload.assessmentName || payload.skill || "Feedback item",
    topic: payload.skill || "Other",
    mistake: payload.nextStep,
    mistakeHtml: payload.nextStepHtml || "",
    confidence: payload.trafficLight || "Amber",
    dateIdentified: payload.date || todayInput()
  };
  if (existing) {
    const changes = preserveProgress ? base : { ...base, improvementPlan: payload.nextStep, status: "New", pinned: false, evidence: "" };
    await updateSchoolEntity(state.profile.schoolId, "improvementBank", existing.id, changes);
    Object.assign(existing, changes, { updatedAt: new Date().toISOString() });
    return existing;
  }
  const created = await createSchoolEntity(state.profile.schoolId, "improvementBank", {
    ...base,
    improvementPlan: payload.nextStep,
    status: payload.status === "closed" ? "Improved" : "New",
    pinned: false,
    evidence: ""
  });
  state.data.improvementBank = state.data.improvementBank || [];
  state.data.improvementBank.push(created);
  return created;
}

async function persistPupilFeedback(form, final = false) {
  const payload = readFeedbackEditor(form, final);
  let recordId = form.elements.recordId.value;
  if (recordId) {
    await updateSchoolEntity(state.profile.schoolId, "feedbackRecords", recordId, payload);
    const local = byId(state.data.feedbackRecords, recordId);
    if (local) Object.assign(local, payload, { updatedAt: new Date().toISOString() });
  } else {
    const created = await createSchoolEntity(state.profile.schoolId, "feedbackRecords", payload);
    recordId = created.id;
    form.elements.recordId.value = recordId;
    form.elements.lockedClassId.value = payload.classId;
    form.elements.classId.disabled = true;
    if (!byId(state.data.feedbackRecords, created.id)) state.data.feedbackRecords.push(created);
  }

  if (final && payload.score !== null && payload.maxScore !== null) {
    const existing = byId(state.data.feedbackRecords, recordId);
    let assessmentId = existing?.assessmentId || "";
    const assessmentPayload = {
      pupilId: state.profile.id,
      classId: payload.classId,
      subjectId: payload.subjectId,
      name: payload.assessmentName,
      topic: payload.skill,
      date: payload.date,
      score: payload.score,
      maxScore: payload.maxScore,
      percentage: payload.percentage,
      grade: payload.grade,
      entrySource: "pupil",
      verificationStatus: "selfEntered",
      feedbackRecordId: recordId
    };
    if (assessmentId) {
      await updateSchoolEntity(state.profile.schoolId, "assessments", assessmentId, assessmentPayload);
    } else {
      const assessment = await createSchoolEntity(state.profile.schoolId, "assessments", assessmentPayload);
      assessmentId = assessment.id;
      await updateSchoolEntity(state.profile.schoolId, "feedbackRecords", recordId, { assessmentId });
    }
  }
  if (final) await syncImprovementBankItem(recordId, payload);
  return recordId;
}

function queueFeedbackSave(form, final = false) {
  autosave.inFlight = autosave.inFlight
    .catch(() => {})
    .then(() => persistPupilFeedback(form, final));
  return autosave.inFlight;
}

function scheduleFeedbackAutosave(form) {
  if (!form?.isConnected) return;
  if (autosave.timer) clearTimeout(autosave.timer);
  setAutosaveStatus(form, "unsaved", "Unsaved changes", "Keep typing — autosave will run in a moment.");
  autosave.timer = setTimeout(async () => {
    autosave.timer = null;
    if (!form.isConnected) return;
    setAutosaveStatus(form, "saving", "Saving…", "Do not close this page yet.");
    try {
      await queueFeedbackSave(form, false);
      const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      setAutosaveStatus(form, "saved", `Saved at ${time}`, "This draft is safe and will reopen next time.");
    } catch (error) {
      console.error(error);
      setAutosaveStatus(form, "error", "Couldn’t save", "Keep this page open and check your internet connection.");
    }
  }, 850);
}


function modalPupilEditFeedback(feedbackId) {
  const f = byId(state.data.feedbackRecords, feedbackId);
  if (!f || f.pupilId !== state.profile.id || f.entrySource !== "pupil" || f.status === "draft") {
    toast("That submitted feedback record is not available to edit.", "error");
    return;
  }
  const result = f.percentage !== null && f.percentage !== undefined
    ? `<div class="result-summary"><strong>${e(f.score)} / ${e(f.maxScore)}</strong><span>${formatPercent(f.percentage)} · ${e(f.grade)}</span></div>`
    : `<div class="alert alert-info">This feedback record has no mark attached.</div>`;
  openModal("Edit my written feedback", `<div class="small muted">${e(f.assessmentName || f.skill)} · ${dateFmt(f.date)} · ${e(getClassName(f.classId))}</div>${result}<form data-form="edit-pupil-feedback" class="form-grid" style="margin-top:16px"><input type="hidden" name="feedbackId" value="${e(f.id)}">${richEditor("strengthHtml", "What went well or what should I remember?", f.strengthHtml || (f.strength ? `<p>${e(f.strength)}</p>` : ""), "Correct or improve your written notes.")}${richEditor("nextStepHtml", "My next steps — what must I watch out for next time?", f.nextStepHtml || (f.nextStep ? `<p>${e(f.nextStep)}</p>` : ""), "Correct or improve your next step.")}<div class="field"><label>How confident do I feel now?</label><select name="trafficLight"><option ${f.trafficLight === "Green" ? "selected" : ""}>Green</option><option ${f.trafficLight === "Amber" ? "selected" : ""}>Amber</option><option ${f.trafficLight === "Red" ? "selected" : ""}>Red</option></select></div><div class="field"><label>Anything else to remember? <span class="muted">(optional)</span></label><input name="pupilNote" value="${e(f.pupilNote || "")}"></div><div class="full alert alert-info"><strong>Your result is protected.</strong><p>You can correct your own written feedback, confidence colour and reminder. Only a teacher can change the mark, total, percentage or grade.</p></div><div class="form-actions full"><button class="btn btn-primary">Save my corrections</button></div></form>`);
}

function modalEditFeedbackResult(feedbackId) {
  const f = byId(state.data.feedbackRecords, feedbackId);
  if (!f || isPupil()) {
    toast("Only teaching staff can edit a result.", "error");
    return;
  }
  openModal("Edit assessment result", `<div class="small muted">${e(getUserName(f.pupilId))} · ${e(f.assessmentName || f.skill)} · ${e(getClassName(f.classId))}</div><form data-form="edit-feedback-result" class="form-grid" data-grade-calculator style="margin-top:16px"><input type="hidden" name="feedbackId" value="${e(f.id)}"><div class="field"><label>Mark</label><input type="number" step="0.5" min="0" name="score" value="${e(f.score ?? "")}" required data-score></div><div class="field"><label>Maximum mark</label><input type="number" step="0.5" min="0.5" name="maxScore" value="${e(f.maxScore ?? "")}" required data-max-score></div><div class="field full"><div class="alert alert-info" data-grade-preview></div><span class="field-help">The percentage and detailed grade are recalculated automatically.</span></div><div class="form-actions full"><button class="btn btn-primary">Save corrected result</button></div></form>`);
  queueMicrotask(() => {
    const form = document.querySelector('form[data-form="edit-feedback-result"]');
    if (form) updateGradePreview(form);
  });
}

function modalReflection(feedbackId) {
  const f = byId(state.data.feedbackRecords, feedbackId);
  const action = actionForFeedback(feedbackId);
  openModal("Reflect and close the loop", `<div class="alert alert-info"><div><strong>Next step</strong><div class="rich-output">${richText(f.nextStepHtml, f.nextStep)}</div></div></div><form data-form="reflection" class="form-grid" style="margin-top:16px"><input type="hidden" name="feedbackId" value="${e(f.id)}"><div class="field full"><label>What does the feedback mean?</label><textarea name="reflection" required>${e(action?.reflection||"")}</textarea></div><div class="field full"><label>What have you done differently?</label><textarea name="actionTaken" required>${e(action?.actionTaken||"")}</textarea></div><div class="field"><label>Confidence before</label><select name="confidenceBefore">${[1,2,3,4,5].map(n=>`<option ${Number(action?.confidenceBefore)===n?"selected":""}>${n}</option>`).join("")}</select></div><div class="field"><label>Confidence now</label><select name="confidenceAfter">${[1,2,3,4,5].map(n=>`<option ${Number(action?.confidenceAfter)===n?"selected":""}>${n}</option>`).join("")}</select></div><div class="form-actions full"><button class="btn btn-primary">Submit for teacher check</button></div></form>`);
}

function modalReviewAction(feedbackId) {
  const f = byId(state.data.feedbackRecords,feedbackId);
  const action = actionForFeedback(feedbackId);
  openModal("Review pupil action", `<div class="feedback-section"><strong>Feedback</strong><p>${e(f.nextStep)}</p></div><div class="feedback-section"><strong>Pupil reflection</strong><p>${e(action?.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action?.actionTaken)}</p></div><form data-form="review-action" style="margin-top:16px"><input type="hidden" name="feedbackId" value="${e(feedbackId)}"><input type="hidden" name="actionId" value="${e(action?.id)}"><div class="field"><label>Teacher review</label><textarea name="teacherReview" required></textarea></div><div class="field"><label>Decision</label><select name="decision"><option value="approved">Approve and close loop</option><option value="returned">Return for more work</option></select></div><div class="form-actions"><button class="btn btn-primary">Save review</button></div></form>`);
}

function modalViewFeedback(feedbackId) {
  const f = byId(state.data.feedbackRecords, feedbackId);
  const action = actionForFeedback(feedbackId);
  const staffActions = isStaff() && f.status !== "draft"
    ? `<div class="form-actions"><button class="btn btn-ghost" data-action="edit-feedback-result" data-id="${e(f.id)}">${f.percentage !== null && f.percentage !== undefined ? "Edit result" : "Add result"}</button>${f.needsTeacherReview ? `<button class="btn btn-secondary" data-action="acknowledge-feedback-edit" data-id="${e(f.id)}">Mark pupil edit reviewed</button>` : ""}</div>`
    : "";
  openModal(f.status === "draft" ? "Live feedback draft" : "Feedback record", `<div class="timeline-meta">${badge(f.feedbackType || "Feedback")} ${badge(f.trafficLight)} ${badge(f.status)} ${f.pupilEditedAt ? badge("Pupil edited") : ""}</div><h3>${e(f.assessmentName || f.skill)}</h3><div class="small muted">${dateFmt(f.date)} · ${e(getUserName(f.pupilId))} · ${e(getClassName(f.classId))}</div>${f.percentage !== null && f.percentage !== undefined ? `<div class="result-summary"><strong>${e(f.score)} / ${e(f.maxScore)}</strong><span>${formatPercent(f.percentage)} · ${e(f.grade)}</span></div>` : ""}${f.needsTeacherReview ? `<div class="alert alert-warning" style="margin-top:16px"><strong>Edited after submission</strong><p>The pupil corrected their written feedback. The result itself has not changed.</p></div>` : ""}<div class="feedback-section"><strong>What went well</strong><div class="rich-output">${richText(f.strengthHtml, f.strength)}</div></div><div class="feedback-section"><strong>Next step</strong><div class="rich-output">${richText(f.nextStepHtml, f.nextStep)}</div></div>${f.status === "draft" ? `<div class="autosave-status" data-state="saved"><span class="autosave-dot"></span><div><strong>Autosaved pupil draft</strong><small>Last saved ${dateFmt(f.autosavedAt || f.updatedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div></div>` : action ? `<div class="feedback-section"><strong>Pupil reflection</strong><p>${e(action.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action.actionTaken)}</p></div>` : `<div class="alert alert-warning" style="margin-top:16px">The pupil has not submitted an action yet.</div>`}${staffActions}`);
}

function modalPupilDashboard(pupilId) {
  const pupil = byId(state.data.users, pupilId);
  const memberships = state.data.memberships.filter((membership) => membership.userId === pupilId && membership.active !== false);
  const subjectIds = unique(memberships.map((membership) => membership.subjectId));
  const assessments = sortByDateDesc(state.data.assessments.filter((assessment) => assessment.pupilId === pupilId && officialAssessment(assessment)));
  const feedback = sortByDateDesc(state.data.feedbackRecords.filter((record) => record.pupilId === pupilId));
  const risk = atRiskInfo(pupilId);
  const recurring = skillCountsForPupil(pupilId).filter((item) => item.count > 1);
  const overallAverage = assessmentAverage(pupilId);
  const improvementItems = improvementItemsForPupil(pupilId);
  openModal(`${pupil.displayName} — pupil dashboard`, `<div class="grid grid-4">${kpi("↗", "Average", overallAverage.grade, overallAverage.count ? formatPercent(overallAverage.percentage) : "No results")}${kpi("◎", "Target", risk.targetGrade || memberships[0]?.targetGrade || "—")}${kpi("✎", "Open loops", openFeedbackCount(pupilId))}${kpi("⚑", "Support indicator", risk.level, `Calculated ${risk.calculatedLevel}`)}</div><div class="alert ${risk.level === "High" ? "alert-danger" : risk.level === "Medium" ? "alert-warning" : "alert-success"}" style="margin-top:16px">${riskExplanationHtml(risk)}</div>${subjectIds.map((subjectId) => {
    const membership = memberships.find((item) => item.subjectId === subjectId) || {};
    const list = state.data.assessments.filter((assessment) => assessment.pupilId === pupilId && assessment.subjectId === subjectId && officialAssessment(assessment));
    const average = assessmentAverage(pupilId, { subjectId });
    return `<section style="margin-top:20px"><div class="card-head"><div><h3>${e(getSubjectName(subjectId))}</h3><p>Average ${average.count ? `${formatPercent(average.percentage)} · ${e(average.grade)}` : "not yet available"}</p></div>${badge(`Target ${membership.targetGrade || "—"}`)}</div><div class="chart-wrap">${gradeChartSvg(list, membership.targetGrade)}</div></section>`;
  }).join("")}<div class="grid grid-2"><section><h3>Recurring themes</h3>${recurring.length ? miniBarSvg(recurring, "count", "skill") : `<p class="muted">No repeated feedback theme yet.</p>`}</section><section><h3>Current feedback</h3><div class="timeline">${feedback.slice(0, 5).map(feedbackTimelineItem).join("")}</div></section></div><section style="margin-top:20px"><div class="card-head"><div><h3>Improvement bank</h3><p>Structured mistakes, plans and evidence recorded by the pupil.</p></div>${badge(`${improvementItems.length} item${improvementItems.length === 1 ? "" : "s"}`)}</div><div class="compact-improvement-list">${improvementItems.slice(0, 5).map((item) => `<div><strong>${e(item.topic)}</strong><span>${badge(item.status)} ${item.pinned ? badge("Pinned") : ""}</span><p>${e(item.improvementPlan || item.mistake)}</p></div>`).join("") || `<p class="muted">No improvement-bank items yet.</p>`}</div></section><div class="form-actions"><button class="btn btn-primary" data-action="review-risk" data-id="${pupilId}">Review support indicator</button><button class="btn btn-ghost" data-action="set-target" data-id="${pupilId}">Set target grade</button><button class="btn btn-secondary" data-action="add-intervention" data-id="${pupilId}">Add intervention</button>${pupil.authProvider === "google" ? `<span class="badge badge-blue">Uses Google sign-in</span>` : `<button class="btn btn-ghost" data-action="reset-pupil-password" data-id="${pupilId}" data-email="${e(pupil.email)}">Send password reset</button>`}</div>`);
}

function skillCountsForPupil(pupilId) {
  const counts={};
  state.data.feedbackRecords.filter(f=>f.pupilId===pupilId && f.status!=="draft").forEach(f=>counts[f.skill]=(counts[f.skill]||0)+1);
  return Object.entries(counts).map(([skill,count])=>({skill,count})).sort((a,b)=>b.count-a.count);
}


function modalSetTarget(pupilId) {
  const memberships = (state.data.memberships || []).filter((membership) => membership.userId === pupilId && membership.active !== false);
  if (!memberships.length) {
    toast("This pupil is not linked to an active class.", "error");
    return;
  }
  const options = memberships.map((membership) => `<option value="${e(membership.id)}">${e(getClassName(membership.classId))} · ${e(getSubjectName(membership.subjectId))} · current target ${e(membership.targetGrade || "not set")}</option>`).join("");
  openModal("Set target grade", `<form data-form="set-target" class="form-grid"><input type="hidden" name="pupilId" value="${e(pupilId)}"><div class="field full"><label>Class and subject</label><select name="membershipId" required>${options}</select></div><div class="field full"><label>Target grade</label><select name="targetGrade" required>${gradeOptions(memberships[0]?.targetGrade || "A2")}</select><span class="field-help">Use the detailed A1–D8 grade rather than only A, B, C or D.</span></div><div class="form-actions full"><button class="btn btn-primary">Save target</button></div></form>`);
}

function modalIntervention(pupilId) {
  openModal("Add intervention", `<form data-form="add-intervention" class="form-grid"><input type="hidden" name="pupilId" value="${e(pupilId)}"><div class="field"><label>Concern area</label><input name="concernArea" required></div><div class="field"><label>Concern level</label><select name="concernLevel"><option>Medium</option><option>High</option><option>Low</option></select></div><div class="field full"><label>Action</label><textarea name="action" required></textarea></div><div class="field"><label>Review date</label><input type="date" name="reviewDate" required></div><div class="form-actions full"><button class="btn btn-primary">Create intervention</button></div></form>`);
}

function modalPdfOptions() {
  const subjects = pupilSubjects();
  openModal("Save learning record as PDF", `<form data-form="print-portfolio" class="form-grid"><div class="field full"><label>What should the PDF contain?</label><select name="mode"><option value="complete">Complete learning record</option><option value="feedback">Feedback and actions only</option><option value="improvements">Mistake and improvement bank only</option><option value="assessments">Assessment history only</option></select></div><div class="field full"><label>Subject</label><select name="subjectId"><option value="all">All subjects</option>${subjects.map((subject) => `<option value="${e(subject.id)}">${e(subject.name)}</option>`).join("")}</select></div><div class="field"><label>From date <span class="muted">(optional)</span></label><input type="date" name="dateFrom"></div><div class="field"><label>To date <span class="muted">(optional)</span></label><input type="date" name="dateTo"></div><div class="full alert alert-info">Bold text, highlights, bullet points, numbered lists and paragraph spacing will be kept. Confidential teacher-only notes are excluded.</div><div class="form-actions full"><button class="btn btn-primary">Open PDF preview</button></div></form>`);
}

function modalEmailChange() {
  openModal("Request a new login email", `<form data-form="email-change"><div class="field"><label>New personal or new-school email</label><input type="email" name="newEmail" required></div><div class="alert alert-info" style="margin-top:12px">Your current school must approve this before a verification email is sent.</div><div class="form-actions"><button class="btn btn-primary">Send request</button></div></form>`);
}

function modalTransfer() {
  const summary = buildTransferSummary();
  openModal("Request transfer to a new school", `<form data-form="transfer" class="form-grid"><div class="field full"><label>Destination school transfer code</label><input name="destinationCode" placeholder="new-school-id~CODE" required></div><div class="field full"><label>What should be shared?</label><select name="shareLevel"><option value="summary">Summary transfer</option><option value="fresh">Start fresh (keep old history private)</option></select></div><div class="field full"><label>Transfer summary</label><textarea name="summary">${e(summary)}</textarea><span class="field-help">Confidential teacher-only notes are excluded.</span></div><div class="form-actions full"><button class="btn btn-primary">Send transfer request</button></div></form>`);
}

function buildTransferSummary() {
  const subjects=pupilSubjects();
  return subjects.map((subject) => { const membership = pupilMembership(state.profile.id, subject.id) || {}; const average = assessmentAverage(state.profile.id, { subjectId: subject.id }); return `${subject.name}: average ${average.count ? `${average.grade} (${average.percentage.toFixed(1)}%)` : "not recorded"}, target ${membership.targetGrade || "not set"}, ${openFeedbackCount(state.profile.id, subject.id)} open feedback loop(s).`; }).join("\n");
}

function attachFeedbackListener() {
  state.feedbackUnsubscribe?.();
  state.feedbackUnsubscribe = observeSchoolFeedback(state.profile, (records) => {
    if (!state.data) return;
    state.data.feedbackRecords = records;
    if (!state.modal) renderShell();
  }, (error) => {
    console.error("Live feedback listener failed", error);
    toast("Live feedback updates paused. Refresh the page to reconnect.", "error");
  });
}

async function refresh(message = "Refreshing…") {
  setLoading(message);
  state.profile = await getUserProfile(state.authUser);
  state.data = await loadAppData(state.profile);
  state.loading = false;
  attachFeedbackListener();
  renderShell();
}

async function withBusy(control, task) {
  const isSelect = control?.tagName === "SELECT";
  const oldText = isSelect ? null : control?.textContent;
  if (control) {
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
    if (!isSelect) control.textContent = "Working…";
  }
  try { await task(); }
  catch (error) { console.error(error); toast(error.message || "Something went wrong.", "error"); }
  finally {
    if (control) {
      control.disabled = false;
      control.removeAttribute("aria-busy");
      if (!isSelect) control.textContent = oldText;
    }
  }
}

// Rich-text formatting is handled with the Selection and Range APIs rather
// than document.execCommand. This keeps formatting reliable in current Chrome
// and also lets the toolbar act on the pupil's most recently selected words.
function richEditorForRange(range) {
  if (!range) return null;
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;
  return container?.closest?.('.rich-editor[contenteditable="true"]') || null;
}

function rememberRichSelection() {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  const editor = richEditorForRange(range);
  if (!editor) return;
  const saved = range.cloneRange();
  editor.__feedbackLoopSelection = saved;
  lastRichSelection = { editor, range: saved };
}

function removeFormattingFromFragment(fragment) {
  for (const element of [...fragment.querySelectorAll('b, strong, span')].reverse()) {
    element.replaceWith(...element.childNodes);
  }
}

function selectInsertedContent(selection, wrapper, insertedNodes = []) {
  const nextRange = document.createRange();
  if (wrapper) {
    nextRange.selectNodeContents(wrapper);
  } else if (insertedNodes.length) {
    nextRange.setStartBefore(insertedNodes[0]);
    nextRange.setEndAfter(insertedNodes[insertedNodes.length - 1]);
  } else {
    return null;
  }
  selection.removeAllRanges();
  selection.addRange(nextRange);
  return nextRange;
}

function applyRichFormatting(formatButton) {
  const shellEditor = formatButton.closest('.rich-editor-shell')?.querySelector('.rich-editor[contenteditable="true"]');
  const currentSelection = window.getSelection();
  let editor = null;
  let range = null;

  if (currentSelection?.rangeCount) {
    const currentRange = currentSelection.getRangeAt(0);
    const currentEditor = richEditorForRange(currentRange);
    if (currentEditor) {
      editor = currentEditor;
      range = currentRange.cloneRange();
    }
  }

  if (!range && lastRichSelection?.editor?.isConnected) {
    editor = lastRichSelection.editor;
    range = lastRichSelection.range.cloneRange();
  }

  if (!range && shellEditor?.__feedbackLoopSelection) {
    editor = shellEditor;
    range = shellEditor.__feedbackLoopSelection.cloneRange();
  }

  if (!editor || !range || !editor.contains(range.commonAncestorContainer)) {
    toast('Place the cursor in the feedback box first.', 'error');
    return;
  }

  editor.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const command = formatButton.dataset.editorCommand;
  const listCommand = command === 'insertUnorderedList' || command === 'insertOrderedList';
  let selectedRange = null;

  if (listCommand) {
    // Browser list insertion is used only for block-list creation. The saved
    // HTML is still passed through FeedbackLoop's strict allow-list sanitizer.
    document.execCommand(command, false);
    rememberRichSelection();
  } else {
    if (range.collapsed) {
      toast('Select the words you want to format first.', 'error');
      return;
    }
    if (command === 'removeFormat') {
      const fragment = range.extractContents();
      removeFormattingFromFragment(fragment);
      const insertedNodes = [...fragment.childNodes];
      range.insertNode(fragment);
      selectedRange = selectInsertedContent(selection, null, insertedNodes);
    } else {
      const wrapper = command === 'bold'
        ? document.createElement('strong')
        : document.createElement('span');
      if (command === 'highlight') wrapper.style.backgroundColor = formatButton.dataset.colour || '#fff3a3';
      wrapper.append(range.extractContents());
      range.insertNode(wrapper);
      selectedRange = selectInsertedContent(selection, wrapper);
    }

    if (selectedRange) {
      const saved = selectedRange.cloneRange();
      editor.__feedbackLoopSelection = saved;
      lastRichSelection = { editor, range: saved };
    }
  }

  editor.normalize();
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: listCommand ? 'insertList' : 'formatBold' }));
  const form = editor.closest('form[data-feedback-editor]');
  if (form) scheduleFeedbackAutosave(form);
}

document.addEventListener('selectionchange', rememberRichSelection);

// Apply formatting on pointerdown, before a toolbar button can remove the
// selection. The click handler below covers keyboard activation as well.
app.addEventListener('pointerdown', (event) => {
  const formatButton = event.target.closest('[data-editor-command]');
  if (!formatButton) return;
  event.preventDefault();
  rememberRichSelection();
  applyRichFormatting(formatButton);
  formatButton.__feedbackLoopPointerHandled = true;
});

app.addEventListener("click", async (event) => {
  const modalBackdrop = event.target.closest("[data-modal-backdrop]");
  if (modalBackdrop && event.target === modalBackdrop) { closeModal(); return; }

  const authTab = event.target.closest("[data-auth-tab]");
  if (authTab) { state.authTab = authTab.dataset.authTab; renderAuth(); return; }
  const demo = event.target.closest("[data-demo-role]");
  if (demo) { state.authUser = await demoSignInAs(demo.dataset.demoRole); await initialiseUser(state.authUser); return; }
  const areaSwitch = event.target.closest("[data-area]");
  if (areaSwitch) { state.area = areaSwitch.dataset.area; state.route = "overview"; state.modal = null; renderShell(); return; }
  const route = event.target.closest("[data-route]");
  if (route) { state.route = route.dataset.route; state.modal = null; renderShell(); return; }

  const formatButton = event.target.closest('[data-editor-command]');
  if (formatButton) {
    event.preventDefault();
    if (formatButton.__feedbackLoopPointerHandled) {
      formatButton.__feedbackLoopPointerHandled = false;
      return;
    }
    rememberRichSelection();
    applyRichFormatting(formatButton);
    return;
  }

  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  if (workspaceMutationActions.has(action) && blockReadOnlyChange()) return;
  if (action === "close-modal") { closeModal(); return; }
  if (action === "copy-code") {
    const code = actionEl.dataset.code || "";
    try { await navigator.clipboard.writeText(code); toast("Code copied."); }
    catch { prompt("Copy this code:", code); }
    return;
  }
  if (action === "toggle-invite") {
    const nextActive = actionEl.dataset.active !== "true";
    await withBusy(actionEl, async () => {
      await updateSchoolEntity(state.profile.schoolId, "invites", id, { active: nextActive });
      await refresh();
      toast(nextActive ? "Code enabled." : "Code disabled.");
    });
    return;
  }
  if (action === "signout") { state.feedbackUnsubscribe?.(); state.feedbackUnsubscribe=null; await signOut(); state.authUser=null;state.profile=null;state.data=null;renderAuth(); return; }
  if (action === "google-signin") { await withBusy(actionEl, async()=>{const user=await signInWithGoogle();await initialiseUser(user);}); return; }
  if (action === "google-register-invite") {
    const form = actionEl.closest("form[data-form=register]");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.displayName || !data.inviteCode) return toast("Enter the real full name and invitation code first.", "error");
    await withBusy(actionEl, async()=>{const user=await registerWithInviteGoogle(data);await initialiseUser(user);toast("Account created using Google.");}); return;
  }
  if (action === "google-register-teacher") {
    const form = actionEl.closest("form[data-form=independent-teacher]");
    const data = Object.fromEntries(new FormData(form).entries());
    if (!data.workspaceName || !data.activationCode) return toast("Enter the workspace name and pilot activation code first.", "error");
    await withBusy(actionEl, async()=>{const user=await registerIndependentTeacherGoogle(data);await initialiseUser(user);toast("Teacher workspace activated.");}); return;
  }
  if (action === "google-register-school") {
    const form = actionEl.closest("form[data-form=school-activation]");
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    data.assignTeacher = formData.has("assignTeacher");
    if (!data.schoolName || !data.activationCode) return toast("Enter the school name and school activation code first.", "error");
    await withBusy(actionEl, async()=>{const user=await registerSchoolWithActivationGoogle(data);await initialiseUser(user);toast("School workspace activated.");}); return;
  }
  if (action === "forgot-password") {
    const email = prompt("Enter the email address for the account:");
    if (email) await withBusy(actionEl, async()=>{await resetPassword(email);toast("Password reset email sent.");});
    return;
  }
  if (action === "join-another-class") return modalJoinAnotherClass();
  if (action === "join-school-workspace") return modalJoinSchoolWorkspace();
  if (action === "move-class-to-school") { await withBusy(actionEl, async()=>{ await modalMoveClassToSchool(id); }); return; }
  if (action === "co-teacher-code") return modalCreateCoTeacherInvite(id);
  if (action === "approve-class-migration" || action === "decline-class-migration") {
    await withBusy(actionEl, async()=>{await decideClassMigrationRequest(id, action === "approve-class-migration");await refresh();toast(action === "approve-class-migration" ? "Class move approved." : "Class move declined.");}); return;
  }
  if (action === "complete-class-migration") {
    const ok = confirm("Start or resume the automatic migration? Each completed phase is saved, so the browser can safely resume after an interruption.");
    if (!ok) return;
    await withBusy(actionEl, async()=>{const result = await completeClassMigration(state.profile, id);await refresh();toast(`Migration completed. The class history was copied and existing pupil accounts were reconnected automatically.`);state.selectedClassId = result.destinationClassId;}); return;
  }
  if (action === "reset-pupil-password") {
    const pupil = byId(state.data.users, id);
    if (!pupil) return toast("Pupil account not found.", "error");
    if (pupil.authProvider === "google") return toast("This pupil signs in through Google and does not have a FeedbackLoop password.", "error");
    const ok = confirm(`Send a secure password-reset email to ${pupil.displayName} at ${pupil.email}?`);
    if (!ok) return;
    await withBusy(actionEl, async()=>{await sendPupilPasswordReset(pupil.email);toast("Password-reset email sent to the pupil.");}); return;
  }
  if (action === "add-department") return modalAddDepartment();
  if (action === "add-subject") return modalAddSubject();
  if (action === "add-class") return modalAddClass();
  if (action === "create-invite") return modalCreateInvite();
  if (action === "class-invite") return modalCreateInvite({role:"pupil",classId:id});
  if (action === "manage-staff-roles") return modalManageStaffRoles(id);
  if (action === "assign-teacher") return modalAssignTeacher(id);
  if (action === "start-feedback-session") return modalStartFeedbackSession();
  if (action === "open-feedback-session") return modalPupilAddFeedback(null, id);
  if (action === "view-feedback-session") return modalViewFeedbackSession(id);
  if (["close-feedback-session", "reopen-feedback-session", "archive-feedback-session"].includes(action)) {
    const status = action === "close-feedback-session" ? "closed" : action === "reopen-feedback-session" ? "open" : "archived";
    await withBusy(actionEl, async()=>{await updateSchoolEntity(state.profile.schoolId, "feedbackSessions", id, { status, statusChangedAt: new Date().toISOString(), statusChangedBy: state.profile.id });closeModal();await refresh();toast(status === "open" ? "Feedback session reopened." : status === "closed" ? "Feedback session closed to new starters." : "Feedback session archived.");}); return;
  }
  if (action === "copy-incomplete-session") {
    const session = byId(state.data.feedbackSessions, id);
    if (!session) return toast("Feedback session not found.", "error");
    const names = feedbackSessionStats(session).notStarted.map((pupil) => pupil.displayName);
    const text = names.length ? `${session.title} — not started:\n${names.join("\n")}` : `${session.title} — everyone has started.`;
    try { await navigator.clipboard.writeText(text); toast(names.length ? "Incomplete pupil list copied." : "Everyone has started this session."); } catch { prompt("Copy this list:", text); }
    return;
  }
  if (action === "manage-improvement") return modalManageImprovement(id, actionEl.dataset.feedbackId || "");
  if (action === "toggle-improvement-pin") {
    const item = findImprovementItem(id, actionEl.dataset.feedbackId || "");
    if (!item) return toast("Improvement item not found.", "error");
    const nextPinned = !item.pinned;
    if (item.stored) await updateSchoolEntity(state.profile.schoolId, "improvementBank", item.id, { pinned: nextPinned });
    else {
      const feedback = byId(state.data.feedbackRecords, item.feedbackId);
      await createSchoolEntity(state.profile.schoolId, "improvementBank", { pupilId: state.profile.id, feedbackId: item.feedbackId, classId: item.classId, subjectId: item.subjectId, title: item.title, topic: item.topic, mistake: item.mistake, mistakeHtml: item.mistakeHtml, improvementPlan: item.improvementPlan, status: item.status, confidence: item.confidence, evidence: item.evidence || "", pinned: nextPinned, dateIdentified: item.dateIdentified || feedback?.date || todayInput() });
    }
    await refresh(); state.route = "improvements"; renderShell(); return;
  }
  if (action === "review-risk") return modalRiskReview(id, actionEl.dataset.classId || "");
  if (action === "add-assessment") return modalAddAssessment();
  if (action === "add-feedback") return modalAddFeedback();
  if (action === "pupil-add-feedback") return modalPupilAddFeedback();
  if (action === "continue-feedback-draft") return modalPupilAddFeedback(id);
  if (action === "save-feedback-draft") {
    const form = actionEl.closest("form[data-feedback-editor]");
    if (!form) return;
    if (autosave.timer) clearTimeout(autosave.timer);
    autosave.timer = null;
    await withBusy(actionEl, async () => {
      setAutosaveStatus(form, "saving", "Saving…", "Do not close this page yet.");
      await queueFeedbackSave(form, false);
      const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      setAutosaveStatus(form, "saved", `Saved at ${time}`, "This draft is safe and can be continued another day.");
    });
    return;
  }
  if (action === "edit-pupil-feedback") return modalPupilEditFeedback(id);
  if (action === "edit-feedback-result") return modalEditFeedbackResult(id);
  if (action === "acknowledge-feedback-edit") {
    await withBusy(actionEl, async()=>{await updateSchoolEntity(state.profile.schoolId, "feedbackRecords", id, { needsTeacherReview: false, editReviewedAt: new Date().toISOString(), editReviewedBy: state.profile.id });await refresh();toast("Pupil correction marked as reviewed.");}); return;
  }
  if (action === "reflect") return modalReflection(id);
  if (action === "review-action") return modalReviewAction(id);
  if (action === "view-feedback") return modalViewFeedback(id);
  if (action === "open-pupil") return modalPupilDashboard(id);
  if (action === "set-target") return modalSetTarget(id);
  if (action === "add-intervention") return modalIntervention(id);
  if (action === "request-email-change") return modalEmailChange();
  if (action === "request-transfer") return modalTransfer();
  if (action === "begin-email-change") {
    const request=byId(state.data.emailChangeRequests,id);
    await withBusy(actionEl,async()=>{await beginApprovedEmailChange(request);toast(isDemoMode?"Demo email changed.":"Verification sent to the new email address.");await refresh();}); return;
  }
  if (action === "approve-email" || action === "decline-email") {
    await withBusy(actionEl,async()=>{await approveEmailChangeRequest(id,action==="approve-email");toast(`Email change ${action==="approve-email"?"approved":"declined"}.`);await refresh();}); return;
  }
  if (action === "accept-transfer" || action === "decline-transfer") {
    await withBusy(actionEl,async()=>{await decideTransferRequest(id,action==="accept-transfer",[]);toast(`Transfer ${action==="accept-transfer"?"accepted":"declined"}.`);await refresh();}); return;
  }
  if (action === "complete-transfer") {
    const req=byId(state.data.transferRequests,id);
    await withBusy(actionEl,async()=>{await completeTransfer(state.profile,req);toast("School transfer completed.");await refresh();}); return;
  }
  if (action === "select-class") { state.selectedClassId=id; state.route="overview"; renderShell(); return; }
  if (action === "print-report") return modalPdfOptions();
  if (["export-json","export-csv"].includes(action)) {
    await withBusy(actionEl,async()=>{const portfolio=await loadPupilPortfolio(state.profile);if(action==="export-json")downloadPortfolioJson(state.profile,portfolio);if(action==="export-csv")downloadPortfolioCsv(state.profile,portfolio);}); return;
  }
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-improvement-search]")) { state.improvementSearch = event.target.value; renderShell(); const input = document.querySelector("[data-improvement-search]"); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } return; }
  const form = event.target.closest("form[data-feedback-editor]");
  if (form) {
    if (event.target.matches("[data-score], [data-max-score]")) updateGradePreview(form);
    scheduleFeedbackAutosave(form);
    return;
  }
  const calculator = event.target.closest("form[data-grade-calculator]");
  if (calculator && event.target.matches("[data-score], [data-max-score]")) updateGradePreview(calculator);
});

app.addEventListener("change", async (event) => {
  if (event.target.matches("[data-demo-switch]")) {
    const user=await demoSignInAs(event.target.value); await initialiseUser(user); return;
  }
  if (event.target.matches("[data-workspace-select]")) {
    const select = event.target;
    const targetWorkspaceId = select.value;
    if (!targetWorkspaceId) {
      toast("Please choose a workspace.", "error");
      return;
    }
    await withBusy(select, async()=>{
      await switchWorkspace(state.profile, targetWorkspaceId);
      await initialiseUser(state.authUser);
      toast("Workspace changed.");
    });
    return;
  }
  if (event.target.matches("[data-improvement-status-filter]")) { state.improvementStatusFilter = event.target.value; renderShell(); return; }
  if (event.target.matches("[data-improvement-topic-filter]")) { state.improvementTopicFilter = event.target.value; renderShell(); return; }
  if (event.target.matches("[data-subject-select]")) { state.selectedSubjectId=event.target.value; renderShell(); return; }
  if (event.target.matches("[data-class-select]")) { state.selectedClassId=event.target.value; renderShell(); return; }
  if (event.target.matches("[data-migration-school], [data-migration-department]")) {
    const form = event.target.closest("form[data-form=request-class-migration]");
    if (!form) return;
    let structures = [];
    try { structures = JSON.parse(form.dataset.migrationStructures || "[]"); } catch { structures = []; }
    const schoolSelect = form.querySelector("[data-migration-school]");
    const departmentSelect = form.querySelector("[data-migration-department]");
    const subjectSelect = form.querySelector("[data-migration-subject]");
    const structure = structures.find((item) => item.schoolId === schoolSelect.value) || structures[0];
    if (!structure) return;
    if (event.target.matches("[data-migration-school]")) {
      departmentSelect.innerHTML = structure.departments.map((item) => `<option value="${e(item.id)}">${e(item.name)}</option>`).join("");
    }
    const departmentId = departmentSelect.value;
    subjectSelect.innerHTML = structure.subjects.filter((item) => item.departmentId === departmentId).map((item) => `<option value="${e(item.id)}">${e(item.name)}</option>`).join("");
    return;
  }
  if (event.target.matches("[data-form-class]")) {
    const pupilSelect=event.target.form.querySelector("[data-form-pupil]");
    if(pupilSelect)pupilSelect.innerHTML=classPupilOptions(event.target.value);
  }
  const editorForm = event.target.closest("form[data-feedback-editor]");
  if (editorForm) {
    if (event.target.matches("[data-feedback-type]")) updateFeedbackEditorFields(editorForm);
    if (event.target.matches("[data-score], [data-max-score], [data-feedback-type]")) updateGradePreview(editorForm);
    scheduleFeedbackAutosave(editorForm);
  }
});

app.addEventListener("submit", async (event) => {
  const form=event.target.closest("form[data-form]");
  if(!form)return;
  event.preventDefault();
  const formData = new FormData(form);
  const data=Object.fromEntries(formData.entries());
  const submit=form.querySelector("button[type=submit],button:not([type])");
  if (!nonWorkspaceForms.has(form.dataset.form) && blockReadOnlyChange()) return;
  await withBusy(submit,async()=>{
    switch(form.dataset.form){
      case "pupil-feedback-editor": {
        if (autosave.timer) clearTimeout(autosave.timer);
        autosave.timer = null;
        setAutosaveStatus(form, "saving", "Saving final record…", "Do not close this page yet.");
        await queueFeedbackSave(form, true);
        closeModal();
        await refresh();
        toast("Feedback added to your learning record.");
        break;
      }
      case "print-portfolio": { const portfolio = await loadPupilPortfolio(state.profile); printPortfolioReport(state.profile, portfolio, data); closeModal(); break; }
      case "signin": { const user=await signIn(data.email,data.password); await initialiseUser(user); break; }
      case "register": { const user=await registerWithInvite(data); await initialiseUser(user); toast("Account created. Check your email for a verification link if requested."); break; }
      case "independent-teacher": { const user=await registerIndependentTeacher(data); await initialiseUser(user); toast("Individual teacher workspace activated."); break; }
      case "school-activation": { data.assignTeacher = formData.has("assignTeacher"); const user=await registerSchoolWithActivation(data); await initialiseUser(user); toast("School workspace activated."); break; }
      case "preview-class-join": { await modalConfirmClassJoin(data.inviteCode); break; }
      case "join-pupil-class": { await joinPupilClass(state.profile, data.inviteCode); closeModal(); await initialiseUser(state.authUser); toast("Class added to your existing pupil account."); break; }
      case "join-school-workspace": { await joinTeacherWorkspace(state.profile, data.inviteCode); closeModal(); await initialiseUser(state.authUser); toast("School department added to your account."); break; }
      case "request-class-migration": { await createClassMigrationRequest(state.profile, data); closeModal(); await refresh(); toast("Class move requested. The destination school or department can now approve it."); break; }
      case "add-department": await createSchoolEntity(state.profile.schoolId,"departments",{name:data.name,headIds:[]}); closeModal(); await refresh(); toast("Department added."); break;
      case "add-subject": await createSchoolEntity(state.profile.schoolId,"subjects",{name:data.name,departmentId:data.departmentId,gradeScale:data.gradeScale}); closeModal(); await refresh(); toast("Subject added."); break;
      case "add-class": {
        const subject=byId(state.data.subjects,data.subjectId);
        await createSchoolEntity(state.profile.schoolId,"classes",{name:data.name,subjectId:data.subjectId,departmentId:subject?.departmentId||"",teacherIds:data.teacherId?[data.teacherId]:[],academicYear:data.academicYear,targetQualification:data.targetQualification,active:true});
        closeModal(); await refresh(); toast("Class created."); break;
      }
      case "assign-teacher": {
        const cls = byId(state.data.classes, data.classId);
        if (!cls) throw new Error("Choose a valid class.");
        const teacherIds = unique(formData.getAll("teacherIds").map(String));
        if (!teacherIds.length) throw new Error("Select at least one teacher for the class.");
        const personalWorkspace = currentSchool().workspaceType === "individualTeacher";
        for (const teacherId of teacherIds) {
          const teacher = byId(state.data.users, teacherId);
          if (!teacher || !hasRole("teacher", teacher)) throw new Error("Choose valid teaching staff.");
          if (!personalWorkspace && !(teacher.departmentIds || []).includes(cls.departmentId) && !hasRole("schoolAdmin", teacher)) throw new Error(`${teacher.displayName} has not joined this class department.`);
        }
        await updateSchoolEntity(state.profile.schoolId, "classes", cls.id, { teacherIds });
        closeModal(); await refresh(); toast("Class teachers updated."); break;
      }
      case "create-invite": {
        let payload;
        if (data.scope === "classPupil") {
          const cls = byId(classesVisibleToProfile(), data.classId);
          if (!cls) throw new Error("Choose one of your own classes.");
          payload = { label: data.label, role: "pupil", scopeType: "class", scopeLabel: cls.name, classIds: [cls.id], subjectId: cls.subjectId || "", departmentIds: cls.departmentId ? [cls.departmentId] : [], createdBy: state.profile.id };
        } else if (data.scope === "classTeacher") {
          const cls = byId(classesVisibleToProfile(), data.classId);
          if (!cls || currentSchool().workspaceType !== "individualTeacher" || currentSchool().ownerId !== state.profile.id) throw new Error("Only the individual workspace owner can create this co-teacher code.");
          payload = { label: data.label, role: "teacher", scopeType: "classTeacher", scopeLabel: cls.name, classIds: [cls.id], subjectId: cls.subjectId || "", departmentIds: cls.departmentId ? [cls.departmentId] : [], createdBy: state.profile.id };
        } else if (data.scope === "departmentTeacher") {
          const department = byId(state.data.departments, data.departmentId);
          if (!department || !headDepartmentIds().includes(department.id)) throw new Error("Choose a department you lead.");
          payload = { label: data.label, role: "teacher", roles: { schoolAdmin: false, departmentHead: false, teacher: true, pupil: false }, roleSchemaVersion: 2, scopeType: "department", scopeLabel: department.name, classIds: [], subjectId: "", departmentIds: [department.id], departmentHeadDepartmentIds: [], createdBy: state.profile.id };
        } else if (data.scope === "internalStaff") {
          if (!hasRole("schoolAdmin")) throw new Error("Only a school administrator can create an internal staff code.");
          const department = byId(state.data.departments, data.departmentId);
          if (!department) throw new Error("Choose a valid department.");
          const roles = { schoolAdmin: formData.has("grantSchoolAdmin"), departmentHead: formData.has("grantDepartmentHead"), teacher: formData.has("grantTeacher") || formData.has("grantDepartmentHead"), pupil: false };
          if (!roles.schoolAdmin && !roles.departmentHead && !roles.teacher) throw new Error("Choose at least one staff permission.");
          payload = { label: data.label, role: "staff", roles, roleSchemaVersion: 2, scopeType: "internalStaff", scopeLabel: department.name, classIds: [], subjectId: "", departmentIds: [department.id], departmentHeadDepartmentIds: roles.departmentHead ? [department.id] : [], createdBy: state.profile.id };
        } else {
          throw new Error("The invitation type was not recognised.");
        }
        const invite = await createInvite(state.profile.schoolId, payload);
        await refresh();
        openModal("Code ready", `<div class="alert alert-success"><strong>${e(payload.label)}</strong><p>This code can be reused until it is disabled.</p></div><div class="code-display"><code>${e(invite.id)}</code></div><div class="form-actions"><button class="btn btn-primary" data-action="copy-code" data-code="${e(invite.id)}">Copy code</button><button class="btn btn-ghost" data-action="close-modal">Done</button></div>`);
        try { await navigator.clipboard.writeText(invite.id); toast("Code created and copied."); } catch { toast("Code created. Use Copy code to copy it."); }
        break;
      }
      case "manage-staff-roles": {
        const roles = { schoolAdmin: formData.has("schoolAdmin"), departmentHead: formData.has("departmentHead"), teacher: formData.has("teacher") || formData.has("departmentHead"), pupil: false };
        const departmentHeadDepartmentIds = roles.departmentHead ? unique(formData.getAll("headDepartmentIds").map(String)) : [];
        if (roles.departmentHead && !departmentHeadDepartmentIds.length) throw new Error("Choose at least one department for department-head access.");
        await updateStaffRoles(state.profile, data.userId, { roles, departmentHeadDepartmentIds });
        closeModal();
        await initialiseUser(state.authUser);
        toast("Staff permissions updated safely.");
        break;
      }
      case "add-assessment": {
        const cls=byId(state.data.classes,data.classId); const score=Number(data.score); const maxScore=Number(data.maxScore);
        await createSchoolEntity(state.profile.schoolId,"assessments",{pupilId:data.pupilId,classId:data.classId,subjectId:cls.subjectId,name:data.name,topic:data.topic,date:data.date,score,maxScore,percentage:maxScore?Math.round(score/maxScore*100):0,grade:data.grade,teacherId:state.profile.id});
        const membership=state.data.memberships.find(m=>m.userId===data.pupilId&&m.classId===data.classId); if(membership)await updateSchoolEntity(state.profile.schoolId,"memberships",membership.id,{currentGrade:data.grade});
        closeModal();await refresh();toast("Assessment result saved.");break;
      }
      case "start-feedback-session": {
        const cls = byId(classesVisibleToProfile(), data.classId);
        if (!cls) throw new Error("Choose one of your classes.");
        await createSchoolEntity(state.profile.schoolId, "feedbackSessions", { classId: cls.id, subjectId: cls.subjectId, pupilIds: pupilsForClass(cls.id).map((pupil) => pupil.id), title: data.title.trim(), skill: data.skill.trim(), feedbackType: data.feedbackType, assessmentComponent: data.assessmentComponent?.trim() || "", instructions: data.instructions?.trim() || "", date: data.date || todayInput(), status: "open", createdBy: state.profile.id, createdByName: state.profile.displayName });
        closeModal(); await refresh(); toast("Live feedback session started."); break;
      }
      case "manage-improvement": {
        if (!isPupil()) throw new Error("Only the pupil can update their improvement bank.");
        const feedback = byId(state.data.feedbackRecords, data.feedbackId);
        const existing = data.itemId ? byId(state.data.improvementBank, data.itemId) : (state.data.improvementBank || []).find((item) => item.feedbackId === data.feedbackId);
        const payload = { pupilId: state.profile.id, feedbackId: data.feedbackId || "", classId: feedback?.classId || existing?.classId || "", subjectId: feedback?.subjectId || existing?.subjectId || "", title: feedback?.assessmentName || existing?.title || data.topic, topic: data.topic.trim(), mistake: data.mistake.trim(), mistakeHtml: `<p>${e(data.mistake.trim())}</p>`, improvementPlan: data.improvementPlan.trim(), status: data.status, confidence: data.confidence, evidence: data.evidence?.trim() || "", pinned: formData.has("pinned"), dateIdentified: existing?.dateIdentified || feedback?.date || todayInput() };
        if (existing) await updateSchoolEntity(state.profile.schoolId, "improvementBank", existing.id, payload);
        else await createSchoolEntity(state.profile.schoolId, "improvementBank", payload);
        closeModal(); await refresh(); state.route = "improvements"; toast("Improvement bank updated."); break;
      }
      case "review-risk": {
        if (!isStaff()) throw new Error("Only teaching staff can review support indicators.");
        const selectedLevel = data.decision === "confirm" ? data.calculatedLevel : data.decision === "dismiss" ? "Low" : data.selectedLevel;
        const existing = (state.data.riskOverrides || []).filter((item) => item.pupilId === data.pupilId && (item.classId || "") === (data.classId || "") && item.active !== false);
        for (const item of existing) await updateSchoolEntity(state.profile.schoolId, "riskOverrides", item.id, { active: false, supersededAt: new Date().toISOString(), supersededBy: state.profile.id });
        await createSchoolEntity(state.profile.schoolId, "riskOverrides", { pupilId: data.pupilId, classId: data.classId || "", calculatedLevel: data.calculatedLevel, selectedLevel, decision: data.decision, reason: data.reason.trim(), reviewDate: data.reviewDate, active: true, createdBy: state.profile.id, createdByName: state.profile.displayName });
        await writeAuditLog(state.profile.schoolId, { action: "riskIndicatorReviewed", userId: state.profile.id, userName: state.profile.displayName, pupilId: data.pupilId, calculatedLevel: data.calculatedLevel, selectedLevel, reason: data.reason.trim(), reviewDate: data.reviewDate });
        closeModal(); await refresh(); toast("Professional risk review recorded."); break;
      }
      case "add-feedback": {
        const cls=byId(state.data.classes,data.classId);
        await createSchoolEntity(state.profile.schoolId,"feedbackRecords",{pupilId:data.pupilId,classId:data.classId,subjectId:cls.subjectId,assessmentName:data.assessmentName,date:data.date,skill:data.skill,feedbackType:data.feedbackType,strength:data.strength,nextStep:data.nextStep,trafficLight:data.trafficLight,status:"open",teacherId:state.profile.id,teacherNotes:data.teacherNotes||""});
        closeModal();await refresh();toast("Feedback added.");break;
      }
      case "edit-pupil-feedback": {
        const record = byId(state.data.feedbackRecords, data.feedbackId);
        if (!record || record.pupilId !== state.profile.id || record.entrySource !== "pupil" || record.status === "draft") throw new Error("That feedback record cannot be edited.");
        const strengthHtml = sanitiseRichHtml(form.querySelector('[data-rich-field="strengthHtml"]')?.innerHTML || "");
        const nextStepHtml = sanitiseRichHtml(form.querySelector('[data-rich-field="nextStepHtml"]')?.innerHTML || "");
        const strength = plainTextFromHtml(strengthHtml);
        const nextStep = plainTextFromHtml(nextStepHtml);
        if (!nextStep) throw new Error("Add what you need to watch out for next time.");
        const editedPayload = {
          ...record, strength, strengthHtml, nextStep, nextStepHtml,
          trafficLight: data.trafficLight || record.trafficLight || "Amber",
          pupilNote: data.pupilNote?.trim() || ""
        };
        await updateSchoolEntity(state.profile.schoolId, "feedbackRecords", record.id, {
          strength, strengthHtml, nextStep, nextStepHtml,
          trafficLight: editedPayload.trafficLight,
          pupilNote: editedPayload.pupilNote,
          pupilEditedAt: new Date().toISOString(),
          pupilEditCount: Number(record.pupilEditCount || 0) + 1,
          needsTeacherReview: true
        });
        await syncImprovementBankItem(record.id, editedPayload);
        closeModal(); await refresh(); toast("Your written feedback was updated. The mark and grade were not changed."); break;
      }
      case "edit-feedback-result": {
        if (!isStaff()) throw new Error("Only teaching staff can edit a result.");
        const record = byId(state.data.feedbackRecords, data.feedbackId);
        if (!record) throw new Error("Feedback record not found.");
        const result = percentageAndGrade(data.score, data.maxScore);
        const resultChanges = { score: result.score, maxScore: result.maxScore, percentage: result.percentage, grade: result.grade, resultEditedAt: new Date().toISOString(), resultEditedBy: state.profile.id };
        await updateSchoolEntity(state.profile.schoolId, "feedbackRecords", record.id, resultChanges);
        let assessmentId = record.assessmentId || "";
        const assessmentPayload = { pupilId: record.pupilId, classId: record.classId, subjectId: record.subjectId, name: record.assessmentName, topic: record.skill, date: record.date, ...resultChanges, entrySource: record.entrySource || "pupil", verificationStatus: "teacherCorrected", feedbackRecordId: record.id };
        if (assessmentId) {
          await updateSchoolEntity(state.profile.schoolId, "assessments", assessmentId, assessmentPayload);
        } else {
          const assessment = await createSchoolEntity(state.profile.schoolId, "assessments", assessmentPayload);
          assessmentId = assessment.id;
          await updateSchoolEntity(state.profile.schoolId, "feedbackRecords", record.id, { assessmentId });
        }
        closeModal(); await refresh(); toast(`Result corrected to ${result.percentage}% · ${result.grade}.`); break;
      }
      case "reflection": {
        const existing=actionForFeedback(data.feedbackId);
        const payload={feedbackId:data.feedbackId,pupilId:state.profile.id,reflection:data.reflection,actionTaken:data.actionTaken,confidenceBefore:Number(data.confidenceBefore),confidenceAfter:Number(data.confidenceAfter),status:"submitted",teacherReview:"",submittedAt:new Date().toISOString()};
        if(existing)await updateSchoolEntity(state.profile.schoolId,"feedbackActions",existing.id,payload);else await createSchoolEntity(state.profile.schoolId,"feedbackActions",payload);
        await updateSchoolEntity(state.profile.schoolId,"feedbackRecords",data.feedbackId,{status:"awaitingReview"});
        closeModal();await refresh();toast("Action submitted to your teacher.");break;
      }
      case "review-action": {
        const approved=data.decision==="approved";
        await updateSchoolEntity(state.profile.schoolId,"feedbackActions",data.actionId,{teacherReview:data.teacherReview,status:data.decision,reviewedAt:new Date().toISOString(),reviewedBy:state.profile.id});
        await updateSchoolEntity(state.profile.schoolId,"feedbackRecords",data.feedbackId,{status:approved?"closed":"open"});
        closeModal();await refresh();toast(approved?"Feedback loop closed.":"Action returned for more work.");break;
      }
      case "set-target": {
        await updateSchoolEntity(state.profile.schoolId, "memberships", data.membershipId, { targetGrade: data.targetGrade });
        closeModal(); await refresh(); toast("Target grade updated."); break;
      }
      case "add-intervention": {
        const pupilClasses=state.data.memberships.filter(m=>m.userId===data.pupilId);await createSchoolEntity(state.profile.schoolId,"interventions",{pupilId:data.pupilId,classId:pupilClasses[0]?.classId||"",concernArea:data.concernArea,concernLevel:data.concernLevel,action:data.action,ownerId:state.profile.id,openedAt:new Date().toISOString(),reviewDate:data.reviewDate,impact:"",status:"In progress"});closeModal();await refresh();toast("Intervention added.");break;
      }
      case "email-change": await createEmailChangeRequest(state.profile,data.newEmail);closeModal();await refresh();toast("Email change request sent to the school.");break;
      case "transfer": await createTransferRequest(state.profile,data.destinationCode,data.shareLevel,data.summary);closeModal();await refresh();toast("Transfer request sent to the destination school.");break;
    }
  });
});

async function initialiseUser(user) {
  state.authUser=user;
  setLoading();
  try {
    const profile=await getUserProfile(user);
    if(!profile){
      state.profile=null;state.data=null;
      app.innerHTML=`<div class="loading"><div class="card card-pad" style="max-width:650px"><h2>Finish setting up your FeedbackLoop account</h2><p>This Google or email login exists, but it has not yet been connected to a FeedbackLoop workspace.</p><p>Sign out, then choose <strong>Join with code</strong> for a pupil or school staff account, or use an issued <strong>teacher or school pilot activation code</strong>.</p><button class="btn btn-primary" data-action="signout">Sign out and choose setup</button></div></div>`;
      return;
    }
    state.profile=profile;
    state.area=null;
    state.data=await loadAppData(profile);
    attachFeedbackListener();
    state.route="overview";
    state.selectedSubjectId=null;
    state.selectedClassId=null;
    renderShell();
  } catch(error){console.error(error);toast(error.message||"Could not load your profile.","error");renderAuth();}
}

setLoading("Starting FeedbackLoop…");
observeAuth(async (user)=>{
  if(user) await initialiseUser(user);
  else {
    state.feedbackUnsubscribe?.();
    state.feedbackUnsubscribe = null;
    renderAuth();
  }
});
