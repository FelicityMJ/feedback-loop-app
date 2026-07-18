import {
  isDemoMode,
  observeAuth,
  observeSchoolFeedback,
  demoSignInAs,
  signIn,
  signInWithGoogle,
  registerWithInvite,
  resetPassword,
  signOut,
  getUserProfile,
  loadAppData,
  loadPupilPortfolio,
  createSchoolEntity,
  updateSchoolEntity,
  createInvite,
  updateUserProfile,
  createEmailChangeRequest,
  approveEmailChangeRequest,
  beginApprovedEmailChange,
  createTransferRequest,
  decideTransferRequest,
  completeTransfer,
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
  authTab: "signin",
  selectedSubjectId: null,
  selectedClassId: null,
  selectedPupilId: null,
  modal: null,
  loading: true,
  feedbackUnsubscribe: null
};

const autosave = { timer: null, saving: false, queued: false, inFlight: Promise.resolve() };

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
    ["people", "♟", "People & classes"],
    ["requests", "⇄", "Transfers & email"]
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
    ["portfolio", "▤", "My learning record"],
    ["transfer", "⇄", "Account & transfer"]
  ]
};


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
  return routeConfig[state.profile?.role] || [];
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
  if (p.role === "schoolAdmin") return all;
  if (p.role === "departmentHead") return all.filter((c) => (p.departmentIds || []).includes(c.departmentId) || (c.teacherIds || []).includes(p.id));
  if (p.role === "teacher") return all.filter((c) => (c.teacherIds || []).includes(p.id));
  const classIds = (state.data?.memberships || []).filter((m) => m.userId === p.id && m.active !== false).map((m) => m.classId);
  return all.filter((c) => classIds.includes(c.id));
}

function pupilsForClass(classId) {
  const pupilIds = (state.data?.memberships || []).filter((m) => m.classId === classId && m.active !== false).map((m) => m.userId);
  return (state.data?.users || []).filter((u) => pupilIds.includes(u.id) && u.role === "pupil");
}

function pupilMembership(pupilId, subjectId = null) {
  return (state.data?.memberships || []).find((m) => m.userId === pupilId && (!subjectId || m.subjectId === subjectId));
}

function latestAssessment(pupilId, subjectId = null) {
  return sortByDateDesc((state.data?.assessments || []).filter((a) => a.pupilId === pupilId && (!subjectId || a.subjectId === subjectId) && officialAssessment(a)))[0] || null;
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

function atRiskInfo(pupilId, classId = null) {
  const memberships = (state.data?.memberships || []).filter((m) => m.userId === pupilId && (!classId || m.classId === classId));
  const assessments = sortByDateDesc((state.data?.assessments || []).filter((a) => a.pupilId === pupilId && (!classId || a.classId === classId)));
  const feedback = (state.data?.feedbackRecords || []).filter((f) => f.pupilId === pupilId && (!classId || f.classId === classId) && f.status !== "draft");
  const interventions = (state.data?.interventions || []).filter((i) => i.pupilId === pupilId && i.status !== "Closed");
  let score = 0;
  const reasons = [];

  const membership = memberships[0];
  const latest = assessments[0];
  if (membership?.targetGrade && latest?.grade && gradeValue(latest.grade) < gradeValue(membership.targetGrade)) {
    score += 2;
    reasons.push("below target");
  }
  if (assessments.length >= 3) {
    const recent = assessments.slice(0, 3).map((a) => gradeValue(a.grade));
    if (recent[0] < recent[1] && recent[1] <= recent[2]) {
      score += 2;
      reasons.push("results declining");
    }
  }
  const unresolved = feedback.filter((f) => f.status !== "closed").length;
  const red = feedback.filter((f) => String(f.trafficLight).toLowerCase() === "red").length;
  if (unresolved >= 2) { score += 1; reasons.push(`${unresolved} open feedback loops`); }
  if (red >= 2) { score += 2; reasons.push("repeated red feedback"); }
  if (interventions.length) { score += 2; reasons.push("active intervention"); }

  return {
    score,
    level: score >= 5 ? "High" : score >= 2 ? "Medium" : "Low",
    reasons,
    latestGrade: latest?.grade || membership?.currentGrade || "—",
    targetGrade: membership?.targetGrade || "—"
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

function kpi(icon, label, value, note = "") {
  return `<div class="card kpi"><div class="kpi-top"><span>${e(label)}</span><div class="kpi-icon">${icon}</div></div><strong>${e(value)}</strong>${note ? `<small>${e(note)}</small>` : ""}</div>`;
}

function selectOptions(items, selected, label = "name") {
  return items.map((item) => `<option value="${e(item.id)}" ${item.id === selected ? "selected" : ""}>${e(item[label])}</option>`).join("");
}

function renderAuth() {
  state.loading = false;
  const register = state.authTab === "register";
  app.innerHTML = `<div class="auth-shell">
    <section class="auth-art">
      <div class="brand-mark">FL</div>
      <h1>Feedback<br>that moves<br>learning on.</h1>
      <p>Track progress against targets, close feedback loops, revisit recurring mistakes and give teachers a clear picture of where support is needed.</p>
      <div class="auth-points">
        <div class="auth-point"><span>✓</span><div><strong>Pupil-owned progress</strong><br><span>Feedback, reflection and action stay connected.</span></div></div>
        <div class="auth-point"><span>⌁</span><div><strong>Whole-class insight</strong><br><span>Teachers and department heads can act before pupils fall behind.</span></div></div>
        <div class="auth-point"><span>⇄</span><div><strong>Portable learner profile</strong><br><span>Download or transfer records when a pupil moves school.</span></div></div>
      </div>
    </section>
    <section class="auth-panel">
      <div class="auth-card">
        <h2>${register ? "Create your account" : "Welcome back"}</h2>
        <p>${register ? "Use the class or department code supplied to you." : "Sign in to open your personalised dashboard."}</p>
        <div class="auth-tabs">
          <button class="auth-tab ${!register ? "active" : ""}" data-auth-tab="signin">Sign in</button>
          <button class="auth-tab ${register ? "active" : ""}" data-auth-tab="register">Join a school</button>
        </div>
        ${register ? `
          <form data-form="register">
            <div class="field"><label>Full name</label><input name="displayName" autocomplete="name" required></div>
            <div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div>
            <div class="field"><label>Password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div>
            <div class="field"><label>Class or department code</label><input name="inviteCode" placeholder="school-id~CODE" required><span class="field-help">Pupils receive a class code from their teacher. Teachers receive a department code from their department head. Department heads receive their code from the school administrator.</span></div>
            <button class="btn btn-primary" type="submit">Create account</button>
          </form>` : `
          <form data-form="signin">
            <div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div>
            <div class="field"><label>Password</label><input type="password" name="password" autocomplete="current-password" required></div>
            <button class="btn btn-primary" type="submit">Sign in</button>
            <button class="btn btn-ghost" type="button" data-action="google-signin">Sign in with Google</button>
          </form>
          <div class="auth-links"><button class="link-btn" data-action="forgot-password">Forgot password?</button><span class="muted">School accounts only</span></div>`}
        ${isDemoMode ? `<div class="demo-box"><strong>Preview the working dashboards</strong><div class="small muted">Firebase is not connected yet, so the app is running safely with example data.</div><div class="demo-roles">
          <button class="btn btn-secondary btn-sm" data-demo-role="pupil">Pupil view</button>
          <button class="btn btn-secondary btn-sm" data-demo-role="teacher">Teacher view</button>
          <button class="btn btn-secondary btn-sm" data-demo-role="departmentHead">Department head</button>
          <button class="btn btn-secondary btn-sm" data-demo-role="schoolAdmin">School admin</button>
        </div></div>` : ""}
      </div>
    </section>
  </div>`;
}

function renderShell() {
  const profile = state.profile;
  const routes = roleRoutes();
  if (!routes.some((r) => r[0] === state.route)) state.route = routes[0]?.[0] || "overview";
  const content = renderRoute();
  app.innerHTML = `${isDemoMode ? `<div class="demo-banner">Demo mode: changes are saved only in this browser. Connect Firebase when you are ready to use real school data.</div>` : ""}
    <div class="shell">
      <header class="topbar">
        <div class="brand"><div class="brand-mark">FL</div><div class="brand-copy"><strong>FeedbackLoop</strong><span>${e(currentSchool().name)}</span></div></div>
        <div class="top-actions">
          ${isDemoMode ? `<select class="btn btn-ghost btn-sm" data-demo-switch aria-label="Switch demo role"><option value="pupil" ${profile.role === "pupil" ? "selected" : ""}>Pupil demo</option><option value="teacher" ${profile.role === "teacher" ? "selected" : ""}>Teacher demo</option><option value="departmentHead" ${profile.role === "departmentHead" ? "selected" : ""}>Department head demo</option><option value="schoolAdmin" ${profile.role === "schoolAdmin" ? "selected" : ""}>School admin demo</option></select>` : ""}
          <div class="user-chip"><div class="avatar">${e(initials(profile.displayName))}</div><div class="user-details"><strong>${e(profile.displayName)}</strong><div class="small muted">${e(roleLabels[profile.role])}</div></div></div>
          <button class="icon-btn" data-action="signout" title="Sign out">↪</button>
        </div>
      </header>
      <div class="layout">
        <aside class="sidebar">
          <div class="nav-label">Dashboard</div>
          ${routes.map(([id, icon, label]) => `<button class="nav-btn ${state.route === id ? "active" : ""}" data-route="${id}"><span class="nav-icon">${icon}</span>${e(label)}</button>`).join("")}
          <div class="sidebar-card"><strong>${profile.role === "pupil" ? "Keep closing the loop" : "Feedback becomes useful when it leads to action."}</strong><p>${profile.role === "pupil" ? "Revisit old mistakes before they appear again in an exam." : "Use patterns across feedback, not one mark alone, to decide who needs support."}</p></div>
        </aside>
        <main class="main">${content}</main>
      </div>
    </div>
    ${state.modal ? renderModal() : ""}`;
}

function renderRoute() {
  const role = state.profile.role;
  if (role === "pupil") return renderPupilRoute();
  if (role === "teacher") return renderTeacherRoute();
  if (role === "departmentHead") return renderHeadRoute();
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
  return `<div class="page-head"><div><h1>${e(title)}</h1><p>${e(description)}</p></div><div class="page-actions">${subjects.length ? `<select class="btn btn-ghost" data-subject-select>${selectOptions(subjects, state.selectedSubjectId)}</select>` : ""}${extraActions}</div></div>`;
}

function renderPupilRoute() {
  if (state.route === "feedback") return renderPupilFeedback();
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
  const latest = sortByDateDesc(assessments)[0];
  const open = feedback.filter((f) => f.status !== "closed");
  const closed = feedback.filter((f) => f.status === "closed");
  const subject = getSubjectName(subjectId);

  return `${pupilPageHead("My progress", "See how your results are moving, then turn feedback into a clear next action.")}
    <section class="hero"><div><h2>${open.length ? `You have ${open.length} feedback loop${open.length === 1 ? "" : "s"} ready to close.` : "Every feedback loop is closed."}</h2><p>${open.length ? `Start with the oldest open action in ${subject}. A small correction now can prevent the same mistake appearing in your next assessment.` : `Your improvement record in ${subject} is up to date. Revisit the mistake bank before your next assessment.`}</p></div><div class="hero-stat"><strong>${latest?.grade || membership.currentGrade || "—"}</strong><span>Current grade · Target ${membership.targetGrade || "not set"}</span></div></section>
    <div class="grid grid-4">
      ${kpi("↗", "Latest result", latest ? formatPercent(latest.percentage) : "—", latest?.name || "No assessment yet")}
      ${kpi("◎", "Target grade", membership.targetGrade || "—", latest?.grade && membership.targetGrade && gradeValue(latest.grade) >= gradeValue(membership.targetGrade) ? "On or above target" : "Keep moving towards it")}
      ${kpi("✓", "Loops closed", closed.length, "Improvements kept in your record")}
      ${kpi("✎", "Still to act on", open.length, open.length ? "Choose one next step today" : "All caught up")}
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

function renderPupilFeedback() {
  ensureSelectedSubject();
  const subjectId = state.selectedSubjectId;
  const all = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.subjectId === subjectId), "updatedAt");
  const drafts = all.filter((f) => f.status === "draft");
  const feedback = all.filter((f) => f.status !== "draft");
  return `${pupilPageHead("My feedback record", "Enter feedback yourself while it is fresh, then use it to avoid repeating the same mistakes.", `<button class="btn btn-primary" data-action="pupil-add-feedback">New feedback record</button>`)}
    <div class="alert alert-info" style="margin-bottom:18px">Choose the feedback type first. Verbal feedback needs no test result; prelims and formal tests calculate your percentage and detailed grade automatically. Everything autosaves as you type.</div>
    ${drafts.length ? `<section class="card" style="margin-bottom:18px"><div class="card-head"><div><h3>Continue a draft</h3><p>These records were autosaved and can be finished today or another day.</p></div>${badge(`${drafts.length} draft${drafts.length === 1 ? "" : "s"}`)}</div><div class="card-body draft-grid">${drafts.map((f) => `<article class="draft-card"><div><div class="timeline-meta">${badge(f.feedbackType || "Draft")} ${badge("Autosaved draft")}</div><h4>${e(f.assessmentName || "Untitled feedback")}</h4><p>${e(f.skill || "Add a topic or skill")}</p><small>Last saved ${dateFmt(f.autosavedAt || f.updatedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div><button class="btn btn-secondary btn-sm" data-action="continue-feedback-draft" data-id="${f.id}">Continue</button></article>`).join("")}</div></section>` : ""}
    <div class="grid grid-2">
      ${feedback.length ? feedback.map((f) => {
        const action = actionForFeedback(f.id);
        const result = f.percentage !== null && f.percentage !== undefined ? `<div class="result-summary"><strong>${e(f.score)} / ${e(f.maxScore)}</strong><span>${formatPercent(f.percentage)} · ${e(f.grade)}</span></div>` : "";
        return `<article class="card feedback-card ${String(f.trafficLight).toLowerCase()}"><div class="timeline-meta">${badge(f.feedbackType || "Feedback")} ${badge(f.trafficLight)} ${badge(f.status)}</div><h4>${e(f.assessmentName || f.skill)}</h4><div class="small muted">${dateFmt(f.date)} · ${e(f.skill)}</div>${result}<div class="feedback-section"><strong>What went well</strong><div class="rich-output">${richText(f.strengthHtml, f.strength)}</div></div><div class="feedback-section"><strong>My next step</strong><div class="rich-output">${richText(f.nextStepHtml, f.nextStep)}</div></div>${action ? `<div class="feedback-section"><strong>My reflection</strong><p>${e(action.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action.actionTaken)}</p></div>${action.teacherReview ? `<div class="alert alert-success" style="margin-top:13px">Teacher check: ${e(action.teacherReview)}</div>` : ""}` : ""}<div class="form-actions"><button class="btn ${f.status === "closed" ? "btn-ghost" : "btn-primary"} btn-sm" data-action="reflect" data-id="${f.id}">${action ? "Review my action" : "Add reflection and action"}</button></div></article>`;
      }).join("") : `<div class="card empty span-2">No completed feedback records for this subject yet.</div>`}
    </div>`;
}

function renderPupilPortfolio() {
  const assessments = sortByDateDesc((state.data.assessments || []).filter((a) => a.pupilId === state.profile.id));
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.status !== "draft"));
  return `<div class="page-head"><div><h1>My learning record</h1><p>This belongs to your continuing learner profile. Download a copy before leaving a school or use it to prepare for exams.</p></div><div class="page-actions"><button class="btn btn-ghost" data-action="export-csv">Download spreadsheet</button><button class="btn btn-ghost" data-action="export-json">Download data</button><button class="btn btn-primary" data-action="print-report">Printable PDF</button></div></div>
    <div class="grid grid-3">
      ${kpi("▤", "Assessments", assessments.length, "Across all linked subjects")}
      ${kpi("✎", "Feedback records", feedback.length, "Strengths and next steps preserved")}
      ${kpi("✓", "Closed loops", feedback.filter((f) => f.status === "closed").length, "Evidence of improvement")}
    </div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Assessment history</h3><p>Your current-school record. The full export also includes available previous-school history.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Subject</th><th>Assessment</th><th>Score</th><th>Grade</th></tr></thead><tbody>${assessments.map((a) => `<tr><td>${dateFmt(a.date)}</td><td>${e(getSubjectName(a.subjectId))}</td><td>${e(a.name)}</td><td>${e(a.score)}/${e(a.maxScore)} · ${formatPercent(a.percentage)}</td><td>${badge(a.grade)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No assessments yet.</td></tr>`}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Mistake and improvement bank</h3><p>Use this before prelims and final exams.</p></div></div><div class="card-body timeline">${feedback.map(feedbackTimelineItem).join("") || `<div class="empty">No feedback records yet.</div>`}</div></section>`;
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
  return `<div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Latest</th><th>Target</th><th>Open loops</th><th>Risk</th><th></th></tr></thead><tbody>${pupils.map((p) => {
    const membership = pupilMembership(p.id, cls.subjectId) || {};
    const latest = latestAssessment(p.id, cls.subjectId);
    const risk = atRiskInfo(p.id, cls.id);
    return `<tr><td><button class="table-link" data-action="open-pupil" data-id="${p.id}">${e(p.displayName)}</button><div class="small muted">${e(p.email)}</div></td><td>${latest ? `${badge(latest.grade)} ${formatPercent(latest.percentage)}` : "—"}</td><td>${badge(membership.targetGrade || "Not set")}</td><td>${openFeedbackCount(p.id, cls.subjectId)}</td><td>${badge(risk.level)}<div class="small muted">${e(risk.reasons.join(", "))}</div></td><td><button class="btn btn-ghost btn-sm" data-action="open-pupil" data-id="${p.id}">Dashboard</button></td></tr>`;
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
  return `<div class="page-head"><div><h1>My classes</h1><p>Create classes, check membership and use a pupil invitation code for straightforward enrolment.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="add-class">Add class</button></div></div>
    <div class="grid grid-3">${classes.map((cls) => `<section class="card card-pad"><div class="timeline-meta">${badge(cls.targetQualification || "Course")}</div><h3>${e(cls.name)}</h3><p class="muted">${e(getSubjectName(cls.subjectId))} · ${e(cls.academicYear || "")}</p><div class="grid grid-2"><div><strong>${pupilsForClass(cls.id).length}</strong><div class="small muted">Pupils</div></div><div><strong>${classAverage(cls.id)}%</strong><div class="small muted">Average</div></div></div><div class="form-actions"><button class="btn btn-ghost btn-sm" data-action="select-class" data-id="${cls.id}">Open class</button><button class="btn btn-secondary btn-sm" data-action="class-invite" data-id="${cls.id}">Pupil code</button></div></section>`).join("") || `<div class="card empty span-3">No classes yet.</div>`}</div>
    ${teacherSelectedClass() ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>${e(teacherSelectedClass().name)} pupil list</h3></div></div>${classSnapshotTable(teacherSelectedClass())}</section>` : ""}
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Pupil class codes</h3><p>Each code adds pupils only to its named class. Copy an existing code or disable it when enrolment is complete.</p></div></div>${inviteCodeTable((state.data.invites || []).filter((invite) => invite.role === "pupil"))}</section>`;
}

function renderTeacherFeedback() {
  const classes = classesVisibleToProfile();
  const classIds = classes.map((c) => c.id);
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => classIds.includes(f.classId)), "updatedAt");
  const drafts = feedback.filter((f) => f.status === "draft");
  const submitted = feedback.filter((f) => f.status !== "draft");
  const results = submitted.filter((f) => f.percentage !== null && f.percentage !== undefined);
  return `<div class="page-head"><div><h1>Live pupil feedback</h1><p>Pupils enter their own records after feedback. Drafts appear here as they autosave, so no teacher data entry is required.</p></div><div class="page-actions">${badge("Listening live")}</div></div>
    <div class="grid grid-4">${kpi("◉", "Open pupil drafts", drafts.length, "Updates appear live")}${kpi("✎", "Submitted records", submitted.length)}${kpi("▤", "Results entered", results.length)}${kpi("✓", "Closed loops", submitted.filter((f) => f.status === "closed").length)}</div>
    <section class="card live-monitor" style="margin-top:18px"><div class="card-head"><div><h3>Incoming drafts</h3><p>This section updates automatically while pupils type on another device.</p></div><span class="live-indicator"><span></span>Live</span></div><div class="card-body live-draft-list">${drafts.length ? drafts.map((f) => `<article class="live-draft"><div class="live-draft-main"><div class="timeline-meta">${badge(f.feedbackType || "Draft")} ${f.grade ? badge(f.grade) : ""}</div><h4>${e(getUserName(f.pupilId))} — ${e(f.assessmentName || "Untitled feedback")}</h4><p>${e(getClassName(f.classId))} · ${e(f.skill || "Topic not entered yet")}</p>${f.percentage !== null && f.percentage !== undefined ? `<strong>${e(f.score)} / ${e(f.maxScore)} · ${formatPercent(f.percentage)}</strong>` : ""}</div><div class="live-draft-side"><small>Saved ${dateFmt(f.autosavedAt || f.updatedAt, { hour: "2-digit", minute: "2-digit" })}</small><button class="btn btn-ghost btn-sm" data-action="view-feedback" data-id="${f.id}">View draft</button></div></article>`).join("") : `<div class="empty">No pupil is currently working on a draft.</div>`}</div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Completed feedback records</h3><p>Marks, grades and pupil-written next steps are shown together.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Pupil</th><th>Type</th><th>Activity</th><th>Result</th><th>Next step</th><th></th></tr></thead><tbody>${submitted.map((f) => `<tr><td>${dateFmt(f.date)}</td><td><button class="table-link" data-action="open-pupil" data-id="${f.pupilId}">${e(getUserName(f.pupilId))}</button><div class="small muted">${e(getClassName(f.classId))}</div></td><td>${badge(f.feedbackType || "Feedback")}</td><td><strong>${e(f.assessmentName || f.skill)}</strong><div class="small muted">${e(f.skill)}</div></td><td>${f.percentage !== null && f.percentage !== undefined ? `${badge(f.grade)} ${formatPercent(f.percentage)}` : "No mark"}</td><td><div class="table-rich">${richText(f.nextStepHtml, f.nextStep)}</div></td><td><button class="btn btn-ghost btn-sm" data-action="view-feedback" data-id="${f.id}">View</button></td></tr>`).join("") || `<tr><td colspan="7" class="empty">No completed feedback records yet.</td></tr>`}</tbody></table></div></section>`;
}

function renderPupilDirectory() {
  const classes = classesVisibleToProfile();
  const pupilIds = unique(classes.flatMap((c) => pupilsForClass(c.id).map((p) => p.id)));
  const pupils = state.data.users.filter((u) => pupilIds.includes(u.id));
  return `<div class="page-head"><div><h1>Pupil dashboards</h1><p>Open one pupil to see grade progress, feedback history, recurring misconceptions and active support.</p></div></div><section class="card"><div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Classes</th><th>Latest grade</th><th>Open loops</th><th>Risk</th><th></th></tr></thead><tbody>${pupils.map((p) => {
    const pupilClasses = classes.filter((c) => pupilsForClass(c.id).some((x) => x.id === p.id));
    const risk = atRiskInfo(p.id);
    return `<tr><td><strong>${e(p.displayName)}</strong><div class="small muted">${e(p.email)}</div></td><td>${e(pupilClasses.map((c) => c.name).join(", "))}</td><td>${badge(latestAssessment(p.id)?.grade || "—")}</td><td>${openFeedbackCount(p.id)}</td><td>${badge(risk.level)}<div class="small muted">${e(risk.reasons.join(", "))}</div></td><td><button class="btn btn-primary btn-sm" data-action="open-pupil" data-id="${p.id}">Open dashboard</button></td></tr>`;
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
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Class tracking</h3><p>Average attainment and pupils below target.</p></div></div><div class="card-body">${classes.map((c) => { const pupils=pupilsForClass(c.id); const below=pupils.filter(p=>atRiskInfo(p.id,c.id).reasons.includes("below target")).length; return `<div class="progress-row"><span>${e(c.name)}</span><div class="progress-track"><div class="progress-bar" style="width:${classAverage(c.id)}%"></div></div><strong>${classAverage(c.id)}%</strong><div class="small muted" style="grid-column:2/4">${below} below target · ${pupils.length} pupils</div></div>`; }).join("") || `<div class="empty">No linked classes.</div>`}</div></section><section class="card"><div class="card-head"><div><h3>Common misconceptions</h3><p>Feedback themes across the department.</p></div></div><div class="card-body">${miniBarSvg(skillCountsForClasses(classes), "count", "skill")}</div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Teacher department codes</h3><p>Share a department code with teachers joining your department. It can be reused until you disable it.</p></div><button class="btn btn-primary btn-sm" data-action="create-invite">Create code</button></div>${inviteCodeTable((state.data.invites || []).filter((i) => i.role === "teacher"))}</section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Pupils requiring review</h3><p>High and medium indicators are surfaced for professional judgement.</p></div><button class="btn btn-ghost btn-sm" data-route="at-risk">View full list</button></div>${riskTable(risks.filter((r) => r.level !== "Low").slice(0,8))}</section>`;
}

function riskTable(risks) {
  return `<div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Latest</th><th>Target</th><th>Indicators</th><th>Risk</th><th></th></tr></thead><tbody>${risks.map((r) => `<tr><td><strong>${e(r.pupil?.displayName)}</strong></td><td>${badge(r.latestGrade)}</td><td>${badge(r.targetGrade)}</td><td>${e(r.reasons.join(", ") || "No current concern")}</td><td>${badge(r.level)}</td><td><button class="btn btn-primary btn-sm" data-action="open-pupil" data-id="${r.pupil?.id}">Dashboard</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No pupils currently flagged.</td></tr>`}</tbody></table></div>`;
}

function renderHeadClasses() {
  const classes = headClasses();
  return `<div class="page-head"><div><h1>Department classes</h1><p>Assign teachers, compare class patterns and plan departmental intervention.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="add-class">Add class</button></div></div><div class="grid grid-3">${classes.map((c) => `<section class="card card-pad"><h3>${e(c.name)}</h3><p class="muted">${e(getSubjectName(c.subjectId))} · ${pupilsForClass(c.id).length} pupils</p><p class="small"><strong>Teachers:</strong> ${e((c.teacherIds || []).map(getUserName).join(", ") || "Not assigned")}</p><div class="progress-row"><span>Average</span><div class="progress-track"><div class="progress-bar" style="width:${classAverage(c.id)}%"></div></div><strong>${classAverage(c.id)}%</strong></div><p>${badge(`${pupilsForClass(c.id).filter(p=>atRiskInfo(p.id,c.id).level!=="Low").length} to review`)}</p><div class="form-actions"><button class="btn btn-ghost btn-sm" data-action="select-class" data-id="${c.id}">Open class</button><button class="btn btn-secondary btn-sm" data-action="assign-teacher" data-id="${c.id}">Assign teacher</button></div></section>`).join("")}</div>${teacherSelectedClass() ? `<section class="card" style="margin-top:18px"><div class="card-head"><h3>${e(teacherSelectedClass().name)}</h3><select class="btn btn-ghost" data-class-select>${selectOptions(classes, teacherSelectedClass().id)}</select></div>${classSnapshotTable(teacherSelectedClass())}</section>` : ""}`;
}

function renderAtRisk() {
  const classes = headClasses();
  const pupilIds = unique(classes.flatMap((c) => pupilsForClass(c.id).map((p) => p.id)));
  const risks = pupilIds.map((id) => ({ pupil: byId(state.data.users, id), ...atRiskInfo(id) })).sort((a,b)=>b.score-a.score);
  return `<div class="page-head"><div><h1>At-risk pupils</h1><p>The app combines below-target performance, declining results, unresolved feedback, repeated red feedback and active interventions.</p></div></div><div class="alert alert-info" style="margin-bottom:18px">The indicator suggests who needs a closer look. It does not automatically label a pupil or replace teacher judgement.</div><section class="card">${riskTable(risks)}</section>`;
}

function renderAdminRoute() {
  if (state.route === "setup") return renderAdminSetup();
  if (state.route === "people") return renderAdminPeople();
  if (state.route === "requests") return renderAdminRequests();
  return renderAdminOverview();
}

function renderAdminOverview() {
  const pupils = state.data.users.filter((u) => u.role === "pupil");
  const staff = state.data.users.filter((u) => u.role !== "pupil");
  const risks = pupils.map((p) => ({ pupil:p, ...atRiskInfo(p.id) })).filter((r)=>r.level!=="Low");
  return `<div class="page-head"><div><h1>School overview</h1><p>Manage the school structure and see whether feedback is turning into pupil action across departments.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Create department-head code</button></div></div>
    <div class="grid grid-4">${kpi("♟", "Pupils", pupils.length)}${kpi("◎", "Staff", staff.length)}${kpi("▤", "Classes", state.data.classes.length)}${kpi("⚑", "Pupils to review", risks.length)}</div>
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Feedback-loop health</h3><p>How many feedback records have reached action and closure.</p></div></div><div class="card-body">${miniBarSvg([
      {label:"Open",value:state.data.feedbackRecords.filter(f=>f.status==="open"||f.status==="overdue").length},
      {label:"Awaiting review",value:state.data.feedbackRecords.filter(f=>f.status==="awaitingReview").length},
      {label:"Closed",value:state.data.feedbackRecords.filter(f=>f.status==="closed").length}
    ],"value","label")}</div></section><section class="card"><div class="card-head"><div><h3>School structure</h3></div></div><div class="card-body"><p><strong>${state.data.departments.length}</strong> departments</p><p><strong>${state.data.subjects.length}</strong> subjects</p><p><strong>${state.data.classes.length}</strong> active classes</p><p><strong>${state.data.invites.filter(i=>i.active).length}</strong> active invitation codes</p></div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Current concerns</h3><p>School-level visibility without exposing confidential notes to pupils.</p></div></div>${riskTable(risks.slice(0,10))}</section>`;
}

function renderAdminSetup() {
  return `<div class="page-head"><div><h1>School setup</h1><p>Create departments and subjects first, then classes and invitation codes.</p></div><div class="page-actions"><button class="btn btn-ghost" data-action="add-department">Add department</button><button class="btn btn-ghost" data-action="add-subject">Add subject</button><button class="btn btn-primary" data-action="add-class">Add class</button></div></div>
    <div class="alert alert-info" style="margin-bottom:18px"><strong>School transfer code:</strong>&nbsp; <code>${e(currentSchool().transferCode || "Add a transferCode field to the school document")}</code><span class="small"> — give this only to a pupil who is moving into your school.</span></div>
    <div class="grid grid-2"><section class="card"><div class="card-head"><div><h3>Departments</h3></div></div><div class="table-wrap"><table><thead><tr><th>Department</th><th>Head IDs</th></tr></thead><tbody>${state.data.departments.map((d)=>{const heads=state.data.users.filter((u)=>u.role==="departmentHead"&&(u.departmentIds||[]).includes(d.id));return `<tr><td>${e(d.name)}</td><td>${e(heads.map((u)=>u.displayName).join(", ")||"Not assigned")}</td></tr>`}).join("")||`<tr><td colspan="2" class="empty">No departments.</td></tr>`}</tbody></table></div></section>
    <section class="card"><div class="card-head"><div><h3>Subjects</h3></div></div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Department</th><th>Scale</th></tr></thead><tbody>${state.data.subjects.map((s)=>`<tr><td>${e(s.name)}</td><td>${e(byId(state.data.departments,s.departmentId)?.name||"")}</td><td>${e(s.gradeScale||"A-D")}</td></tr>`).join("")||`<tr><td colspan="3" class="empty">No subjects.</td></tr>`}</tbody></table></div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Classes</h3></div></div><div class="table-wrap"><table><thead><tr><th>Class</th><th>Subject</th><th>Teachers</th><th>Pupils</th><th>Year</th></tr></thead><tbody>${state.data.classes.map((c)=>`<tr><td>${e(c.name)}</td><td>${e(getSubjectName(c.subjectId))}</td><td>${e((c.teacherIds||[]).map(getUserName).join(", ")||"Not assigned")}</td><td>${pupilsForClass(c.id).length}</td><td>${e(c.academicYear||"")}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Invitation code register</h3><p>The school administrator creates department-head codes. Department heads create teacher codes, and teachers create pupil class codes.</p></div><button class="btn btn-primary btn-sm" data-action="create-invite">Create department-head code</button></div>${inviteCodeTable(state.data.invites || [])}</section>`;
}

function renderAdminPeople() {
  const users = [...state.data.users].sort((a,b)=>a.displayName.localeCompare(b.displayName));
  return `<div class="page-head"><div><h1>People and classes</h1><p>Accounts are linked to a permanent user ID. Email addresses can change without creating a new pupil profile.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Department-head code</button></div></div><section class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Classes</th><th>Status</th><th></th></tr></thead><tbody>${users.map((u)=>{const cls=u.role==="pupil"?state.data.memberships.filter(m=>m.userId===u.id).map(m=>getClassName(m.classId)):state.data.classes.filter(c=>(c.teacherIds||[]).includes(u.id)).map(c=>c.name);return `<tr><td><strong>${e(u.displayName)}</strong><div class="small muted">${e(u.learnerId||u.id)}</div></td><td>${badge(roleLabels[u.role]||u.role)}</td><td>${e(u.email)}</td><td>${e(cls.join(", ")||"—")}</td><td>${badge(u.active===false?"Inactive":"Active")}</td><td>${u.role==="pupil"?`<button class="btn btn-ghost btn-sm" data-action="open-pupil" data-id="${u.id}">Dashboard</button>`:""}</td></tr>`}).join("")}</tbody></table></div></section>`;
}

function renderAdminRequests() {
  const emailRequests = sortByDateDesc(state.data.emailChangeRequests || [], "requestedAt");
  const transfers = sortByDateDesc(state.data.transferRequests || [], "requestedAt");
  return `<div class="page-head"><div><h1>Transfers and email changes</h1><p>Approve identity changes before school accounts close, and control what moves to or from another school.</p></div></div>
    <section class="card"><div class="card-head"><div><h3>Email change requests</h3><p>The pupil must verify the approved new address before Firebase changes the login.</p></div></div><div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Old email</th><th>Requested email</th><th>Status</th><th></th></tr></thead><tbody>${emailRequests.map((r)=>`<tr><td>${e(getUserName(r.pupilId))}</td><td>${e(r.oldEmail)}</td><td>${e(r.newEmail)}</td><td>${badge(r.status)}</td><td>${r.status==="requested"?`<button class="btn btn-primary btn-sm" data-action="approve-email" data-id="${r.id}">Approve</button> <button class="btn btn-danger btn-sm" data-action="decline-email" data-id="${r.id}">Decline</button>`:""}</td></tr>`).join("")||`<tr><td colspan="5" class="empty">No email change requests.</td></tr>`}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>School transfer requests</h3><p>Destination schools accept incoming pupils. The pupil completes the final move.</p></div></div><div class="table-wrap"><table><thead><tr><th>Pupil</th><th>From</th><th>To</th><th>Sharing</th><th>Status</th><th></th></tr></thead><tbody>${transfers.map((r)=>`<tr><td>${e(r.pupilName||getUserName(r.pupilId))}<div class="small muted">${e(r.sharedSummary || "")}</div></td><td>${e(r.fromSchoolId)}</td><td>${e(r.toSchoolId)}</td><td>${e(r.shareLevel)}</td><td>${badge(r.status)}</td><td>${r.toSchoolId===state.profile.schoolId&&r.status==="requested"?`<button class="btn btn-primary btn-sm" data-action="accept-transfer" data-id="${r.id}">Accept</button> <button class="btn btn-danger btn-sm" data-action="decline-transfer" data-id="${r.id}">Decline</button>`:""}</td></tr>`).join("")||`<tr><td colspan="6" class="empty">No transfer requests.</td></tr>`}</tbody></table></div></section>`;
}

function renderModal() {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${e(state.modal.title)}" onclick="event.stopPropagation()"><div class="modal-head"><h3>${e(state.modal.title)}</h3><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-body">${state.modal.body}</div></section></div>`;
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

function modalAddClass() {
  const departmentIds = state.profile.role === "schoolAdmin" ? state.data.departments.map((department) => department.id) : (state.profile.departmentIds || []);
  const subjects = state.data.subjects.filter((subject) => departmentIds.includes(subject.departmentId));
  const teachers = state.data.users.filter((user) => user.role === "teacher" && (user.departmentIds || []).some((id) => departmentIds.includes(id)));
  if (!subjects.length) return toast("Create or join a department with at least one subject first.", "error");
  openModal("Add class", `<form data-form="add-class" class="form-grid"><div class="field"><label>Class name</label><input name="name" required placeholder="4A Computing"></div><div class="field"><label>Subject</label><select name="subjectId" required>${selectOptions(subjects, "")}</select></div><div class="field"><label>Lead teacher</label><select name="teacherId"><option value="">Not assigned</option>${selectOptions(teachers, state.profile.role==="teacher"?state.profile.id:"", "displayName")}</select></div><div class="field"><label>Academic year</label><input name="academicYear" value="2026/27"></div><div class="field"><label>Qualification</label><input name="targetQualification" placeholder="National 5"></div><div class="form-actions full"><button class="btn btn-primary">Create class</button></div></form>`);
}

function inviteCodeTable(invites) {
  return `<div class="table-wrap"><table><thead><tr><th>Label</th><th>For</th><th>Code</th><th>Status</th><th></th></tr></thead><tbody>${invites.map((i) => `<tr><td>${e(i.label || "")}</td><td>${e(i.scopeLabel || roleLabels[i.role] || i.role)}</td><td><code>${e(i.id)}</code></td><td>${badge(i.active ? "Active" : "Disabled")}</td><td><button class="btn btn-ghost btn-sm" data-action="copy-code" data-code="${e(i.id)}">Copy</button> <button class="btn btn-ghost btn-sm" data-action="toggle-invite" data-id="${e(i.id)}" data-active="${i.active ? "true" : "false"}">${i.active ? "Disable" : "Enable"}</button></td></tr>`).join("") || `<tr><td colspan="5" class="empty">No codes have been created yet.</td></tr>`}</tbody></table></div>`;
}


function modalAssignTeacher(classId) {
  const cls = byId(state.data.classes, classId);
  if (!cls) return toast("Class not found.", "error");
  const teachers = state.data.users.filter((user) => user.role === "teacher" && (user.departmentIds || []).includes(cls.departmentId));
  if (!teachers.length) return toast("No teacher has joined this department yet.", "error");
  openModal("Assign teacher to class", `<form data-form="assign-teacher" class="form-grid"><input type="hidden" name="classId" value="${e(cls.id)}"><div class="field full"><label>Class</label><input value="${e(cls.name)}" disabled></div><div class="field full"><label>Teacher</label><select name="teacherId" required>${selectOptions(teachers, "", "displayName")}</select><span class="field-help">The teacher must first join using the department code.</span></div><div class="form-actions full"><button class="btn btn-primary">Assign teacher</button></div></form>`);
}

function modalCreateInvite(prefill = {}) {
  if (state.profile.role === "teacher") {
    const classes = classesVisibleToProfile();
    const selected = byId(classes, prefill.classId) || classes[0];
    if (!selected) return toast("You must be assigned to a class before creating a pupil code.", "error");
    openModal("Create pupil class code", `<div class="alert alert-info">Every pupil who uses this code will join the selected class. The code determines that the account is a pupil account.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="classPupil"><div class="field full"><label>Class</label><select name="classId" required>${selectOptions(classes, selected.id)}</select></div><div class="field full"><label>Label</label><input name="label" required value="${e(selected.name)} pupil class code"></div><div class="form-actions full"><button class="btn btn-primary">Generate reusable class code</button></div></form>`);
    return;
  }

  const departments = state.profile.role === "departmentHead"
    ? state.data.departments.filter((department) => (state.profile.departmentIds || []).includes(department.id))
    : state.data.departments;
  const selected = byId(departments, prefill.departmentId) || departments[0];
  if (!selected) return toast("Create or link a department before creating this code.", "error");

  if (state.profile.role === "departmentHead") {
    openModal("Create teacher department code", `<div class="alert alert-info">Share this reusable code only with teachers joining the selected department. It does not place them into a class; you can assign classes after they join.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="departmentTeacher"><div class="field full"><label>Department</label><select name="departmentId" required>${selectOptions(departments, selected.id)}</select></div><div class="field full"><label>Label</label><input name="label" required value="${e(selected.name)} teacher department code"></div><div class="form-actions full"><button class="btn btn-primary">Generate reusable department code</button></div></form>`);
    return;
  }

  openModal("Create department-head code", `<div class="alert alert-info">Give this code to the department head for the selected department. They will then create teacher codes for their own department.</div><form data-form="create-invite" class="form-grid"><input type="hidden" name="scope" value="departmentHead"><div class="field full"><label>Department</label><select name="departmentId" required>${selectOptions(departments, selected.id)}</select></div><div class="field full"><label>Label</label><input name="label" required value="${e(selected.name)} department-head code"></div><div class="form-actions full"><button class="btn btn-primary">Generate department-head code</button></div></form>`);
}

function classPupilOptions(classId) {
  return pupilsForClass(classId).map((p)=>`<option value="${e(p.id)}">${e(p.displayName)}</option>`).join("");
}

function modalAddAssessment() {
  const classes = classesVisibleToProfile();
  const cls = byId(classes,state.selectedClassId)||classes[0];
  openModal("Add assessment result", `<form data-form="add-assessment" class="form-grid" data-grade-calculator><div class="field"><label>Class</label><select name="classId" required data-form-class>${selectOptions(classes,cls?.id)}</select></div><div class="field"><label>Pupil</label><select name="pupilId" required data-form-pupil>${classPupilOptions(cls?.id)}</select></div><div class="field full"><label>Assessment name</label><input name="name" required placeholder="National 5 prelim"></div><div class="field"><label>Topic or skill</label><input name="topic" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${todayInput()}" required></div><div class="field"><label>Score</label><input type="number" step="0.5" min="0" name="score" required data-score></div><div class="field"><label>Maximum score</label><input type="number" step="0.5" min="0.5" name="maxScore" required data-max-score></div><div class="field full"><div class="alert alert-info" data-grade-preview>Enter the mark and total. The percentage and grade will be calculated automatically.</div><span class="field-help">A1 85%+ · A2 70–84% · B3 65–69% · B4 60–64% · C5 55–59% · C6 50–54% · D7 45–49% · D8 40–44% · 39% and below No Award.</span></div><div class="form-actions full"><button class="btn btn-primary">Save result</button></div></form>`);
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

function modalPupilAddFeedback(recordId = null) {
  const memberships = (state.data.memberships || []).filter((membership) => membership.userId === state.profile.id && membership.active !== false && (!state.selectedSubjectId || membership.subjectId === state.selectedSubjectId));
  const classes = memberships.map((membership) => byId(state.data.classes, membership.classId)).filter(Boolean);
  const draft = recordId ? byId(state.data.feedbackRecords, recordId) : null;
  const cls = byId(classes, draft?.classId) || classes[0];
  if (!cls) {
    toast("You need to be linked to a class before adding feedback.", "error");
    return;
  }

  const selectedType = feedbackTypes[draft?.feedbackType] ? draft.feedbackType : "Prelim";
  const savedLabel = draft?.autosavedAt || draft?.updatedAt ? `Saved ${dateFmt(draft.autosavedAt || draft.updatedAt, { hour: "2-digit", minute: "2-digit" })}` : "Not saved yet";
  openModal(draft ? "Continue feedback draft" : "New feedback record", `<form data-form="pupil-feedback-editor" data-feedback-editor class="form-grid" novalidate>
    <input type="hidden" name="recordId" value="${e(draft?.id || "")}">
    <input type="hidden" name="lockedClassId" value="${e(draft?.classId || "")}">
    <div class="full autosave-status" data-autosave-status data-state="${draft ? "saved" : "idle"}">
      <span class="autosave-dot"></span><div><strong>${e(savedLabel)}</strong><small>Your draft saves automatically and can be continued another day.</small></div>
    </div>
    <div class="field full"><label>Class and subject</label><select name="classId" required data-feedback-class ${draft ? "disabled" : ""}>${selectOptions(classes, cls.id)}</select></div>
    <div class="field"><label>Type of feedback</label><select name="feedbackType" required data-feedback-type>${feedbackTypeOptions(selectedType)}</select></div>
    <div class="field"><label>Date feedback was received</label><input type="date" name="date" value="${e(draft?.date || todayInput())}" required></div>
    <div class="field full"><label data-feedback-title-label>Feedback title</label><input name="assessmentName" value="${e(draft?.assessmentName || "")}" data-feedback-title placeholder=""></div>
    <div class="field full"><label>Topic, skill or area</label><input name="skill" value="${e(draft?.skill || "")}" required placeholder="For example: SQL, evaluation or explaining answers precisely"></div>
    <div class="field full" data-prelim-extra>
      <label>Paper, section or component <span class="muted">(optional)</span></label>
      <input name="assessmentComponent" value="${e(draft?.assessmentComponent || "")}" placeholder="For example: Paper 1, Section 2 or practical task">
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
  const config = feedbackTypes[data.feedbackType] || feedbackTypes.Other;
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
    teacherId: cls.teacherIds?.[0] || "",
    feedbackType: data.feedbackType,
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
  openModal(f.status === "draft" ? "Live feedback draft" : "Feedback record", `<div class="timeline-meta">${badge(f.feedbackType || "Feedback")} ${badge(f.trafficLight)} ${badge(f.status)}</div><h3>${e(f.assessmentName || f.skill)}</h3><div class="small muted">${dateFmt(f.date)} · ${e(getUserName(f.pupilId))} · ${e(getClassName(f.classId))}</div>${f.percentage !== null && f.percentage !== undefined ? `<div class="result-summary"><strong>${e(f.score)} / ${e(f.maxScore)}</strong><span>${formatPercent(f.percentage)} · ${e(f.grade)}</span></div>` : ""}<div class="feedback-section"><strong>What went well</strong><div class="rich-output">${richText(f.strengthHtml, f.strength)}</div></div><div class="feedback-section"><strong>Next step</strong><div class="rich-output">${richText(f.nextStepHtml, f.nextStep)}</div></div>${f.status === "draft" ? `<div class="autosave-status" data-state="saved"><span class="autosave-dot"></span><div><strong>Autosaved pupil draft</strong><small>Last saved ${dateFmt(f.autosavedAt || f.updatedAt, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</small></div></div>` : action ? `<div class="feedback-section"><strong>Pupil reflection</strong><p>${e(action.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action.actionTaken)}</p></div>` : `<div class="alert alert-warning" style="margin-top:16px">The pupil has not submitted an action yet.</div>`}`);
}

function modalPupilDashboard(pupilId) {
  const pupil = byId(state.data.users,pupilId);
  const memberships = state.data.memberships.filter(m=>m.userId===pupilId);
  const subjectIds = unique(memberships.map(m=>m.subjectId));
  const assessments = sortByDateDesc(state.data.assessments.filter(a=>a.pupilId===pupilId));
  const feedback = sortByDateDesc(state.data.feedbackRecords.filter(f=>f.pupilId===pupilId));
  const risk = atRiskInfo(pupilId);
  const recurring = skillCountsForPupil(pupilId).filter(x=>x.count>1);
  openModal(`${pupil.displayName} — pupil dashboard`, `<div class="grid grid-4">${kpi("↗","Latest",assessments[0]?.grade||"—")}${kpi("◎","Target",memberships[0]?.targetGrade||"—")}${kpi("✎","Open loops",openFeedbackCount(pupilId))}${kpi("⚑","Risk",risk.level)}</div><div class="alert ${risk.level==="High"?"alert-danger":risk.level==="Medium"?"alert-warning":"alert-success"}" style="margin-top:16px">${e(risk.reasons.join(", ")||"No current risk indicators.")}</div>${subjectIds.map(subjectId=>{const m=memberships.find(x=>x.subjectId===subjectId)||{};const list=state.data.assessments.filter(a=>a.pupilId===pupilId&&a.subjectId===subjectId);return `<section style="margin-top:20px"><h3>${e(getSubjectName(subjectId))}</h3><div class="chart-wrap">${gradeChartSvg(list,m.targetGrade)}</div></section>`}).join("")}<div class="grid grid-2"><section><h3>Recurring themes</h3>${recurring.length?miniBarSvg(recurring,"count","skill"):`<p class="muted">No repeated feedback theme yet.</p>`}</section><section><h3>Current feedback</h3><div class="timeline">${feedback.slice(0,5).map(feedbackTimelineItem).join("")}</div></section></div><div class="form-actions"><button class="btn btn-ghost" data-action="set-target" data-id="${pupilId}">Set target grade</button><button class="btn btn-secondary" data-action="add-intervention" data-id="${pupilId}">Add intervention</button></div>`);
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

function modalEmailChange() {
  openModal("Request a new login email", `<form data-form="email-change"><div class="field"><label>New personal or new-school email</label><input type="email" name="newEmail" required></div><div class="alert alert-info" style="margin-top:12px">Your current school must approve this before a verification email is sent.</div><div class="form-actions"><button class="btn btn-primary">Send request</button></div></form>`);
}

function modalTransfer() {
  const summary = buildTransferSummary();
  openModal("Request transfer to a new school", `<form data-form="transfer" class="form-grid"><div class="field full"><label>Destination school transfer code</label><input name="destinationCode" placeholder="new-school-id~CODE" required></div><div class="field full"><label>What should be shared?</label><select name="shareLevel"><option value="summary">Summary transfer</option><option value="fresh">Start fresh (keep old history private)</option></select></div><div class="field full"><label>Transfer summary</label><textarea name="summary">${e(summary)}</textarea><span class="field-help">Confidential teacher-only notes are excluded.</span></div><div class="form-actions full"><button class="btn btn-primary">Send transfer request</button></div></form>`);
}

function buildTransferSummary() {
  const subjects=pupilSubjects();
  return subjects.map(s=>{const m=pupilMembership(state.profile.id,s.id)||{};const latest=latestAssessment(state.profile.id,s.id);return `${s.name}: latest ${latest?.grade||"not recorded"}, target ${m.targetGrade||"not set"}, ${openFeedbackCount(state.profile.id,s.id)} open feedback loop(s).`;}).join("\n");
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

async function withBusy(button, task) {
  const old = button?.textContent;
  if (button) { button.disabled = true; button.textContent = "Working…"; }
  try { await task(); }
  catch (error) { console.error(error); toast(error.message || "Something went wrong.", "error"); }
  finally { if (button) { button.disabled = false; button.textContent = old; } }
}

app.addEventListener("click", async (event) => {
  const authTab = event.target.closest("[data-auth-tab]");
  if (authTab) { state.authTab = authTab.dataset.authTab; renderAuth(); return; }
  const demo = event.target.closest("[data-demo-role]");
  if (demo) { state.authUser = await demoSignInAs(demo.dataset.demoRole); await initialiseUser(state.authUser); return; }
  const route = event.target.closest("[data-route]");
  if (route) { state.route = route.dataset.route; state.modal = null; renderShell(); return; }

  const formatButton = event.target.closest("[data-editor-command]");
  if (formatButton) {
    event.preventDefault();
    const shell = formatButton.closest(".rich-editor-shell");
    const editor = shell?.querySelector("[contenteditable]");
    if (!editor) return;
    editor.focus();
    const command = formatButton.dataset.editorCommand;
    if (command === "highlight") {
      const colour = formatButton.dataset.colour;
      const applied = document.execCommand("hiliteColor", false, colour);
      if (!applied) document.execCommand("backColor", false, colour);
    } else {
      document.execCommand(command, false);
    }
    const form = formatButton.closest("form[data-feedback-editor]");
    if (form) scheduleFeedbackAutosave(form);
    return;
  }

  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
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
  if (action === "forgot-password") {
    const email = prompt("Enter the email address for the account:");
    if (email) await withBusy(actionEl, async()=>{await resetPassword(email);toast("Password reset email sent.");});
    return;
  }
  if (action === "add-department") return modalAddDepartment();
  if (action === "add-subject") return modalAddSubject();
  if (action === "add-class") return modalAddClass();
  if (action === "create-invite") return modalCreateInvite();
  if (action === "class-invite") return modalCreateInvite({role:"pupil",classId:id});
  if (action === "assign-teacher") return modalAssignTeacher(id);
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
  if (["export-json","export-csv","print-report"].includes(action)) {
    await withBusy(actionEl,async()=>{const portfolio=await loadPupilPortfolio(state.profile);if(action==="export-json")downloadPortfolioJson(state.profile,portfolio);if(action==="export-csv")downloadPortfolioCsv(state.profile,portfolio);if(action==="print-report")printPortfolioReport(state.profile,portfolio);}); return;
  }
});

app.addEventListener("input", (event) => {
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
  if (event.target.matches("[data-subject-select]")) { state.selectedSubjectId=event.target.value; renderShell(); return; }
  if (event.target.matches("[data-class-select]")) { state.selectedClassId=event.target.value; renderShell(); return; }
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
  const data=Object.fromEntries(new FormData(form).entries());
  const submit=form.querySelector("button[type=submit],button:not([type])");
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
      case "signin": { const user=await signIn(data.email,data.password); await initialiseUser(user); break; }
      case "register": { const user=await registerWithInvite(data); await initialiseUser(user); toast("Account created. Check your email for a verification link."); break; }
      case "add-department": await createSchoolEntity(state.profile.schoolId,"departments",{name:data.name,headIds:[]}); closeModal(); await refresh(); toast("Department added."); break;
      case "add-subject": await createSchoolEntity(state.profile.schoolId,"subjects",{name:data.name,departmentId:data.departmentId,gradeScale:data.gradeScale}); closeModal(); await refresh(); toast("Subject added."); break;
      case "add-class": {
        const subject=byId(state.data.subjects,data.subjectId);
        await createSchoolEntity(state.profile.schoolId,"classes",{name:data.name,subjectId:data.subjectId,departmentId:subject?.departmentId||"",teacherIds:data.teacherId?[data.teacherId]:[],academicYear:data.academicYear,targetQualification:data.targetQualification,active:true});
        closeModal(); await refresh(); toast("Class created."); break;
      }
      case "assign-teacher": {
        const cls = byId(state.data.classes, data.classId);
        const teacher = byId(state.data.users, data.teacherId);
        if (!cls || !teacher || teacher.role !== "teacher") throw new Error("Choose a valid teacher.");
        if (!(teacher.departmentIds || []).includes(cls.departmentId)) throw new Error("That teacher has not joined this class department.");
        await updateSchoolEntity(state.profile.schoolId, "classes", cls.id, { teacherIds: unique([...(cls.teacherIds || []), teacher.id]) });
        closeModal(); await refresh(); toast("Teacher assigned to class."); break;
      }
      case "create-invite": {
        let payload;
        if (data.scope === "classPupil") {
          const cls = byId(classesVisibleToProfile(), data.classId);
          if (!cls) throw new Error("Choose one of your own classes.");
          payload = { label: data.label, role: "pupil", scopeType: "class", scopeLabel: cls.name, classIds: [cls.id], subjectId: cls.subjectId || "", departmentIds: cls.departmentId ? [cls.departmentId] : [], createdBy: state.profile.id };
        } else if (data.scope === "departmentTeacher") {
          const department = byId(state.data.departments, data.departmentId);
          if (!department || !(state.profile.departmentIds || []).includes(department.id)) throw new Error("Choose a department you lead.");
          payload = { label: data.label, role: "teacher", scopeType: "department", scopeLabel: department.name, classIds: [], subjectId: "", departmentIds: [department.id], createdBy: state.profile.id };
        } else if (data.scope === "departmentHead") {
          const department = byId(state.data.departments, data.departmentId);
          if (!department || state.profile.role !== "schoolAdmin") throw new Error("Only a school administrator can create a department-head code.");
          payload = { label: data.label, role: "departmentHead", scopeType: "department", scopeLabel: department.name, classIds: [], subjectId: "", departmentIds: [department.id], createdBy: state.profile.id };
        } else {
          throw new Error("The invitation type was not recognised.");
        }
        const invite = await createInvite(state.profile.schoolId, payload);
        await refresh();
        openModal("Code ready", `<div class="alert alert-success"><strong>${e(payload.label)}</strong><p>This code can be reused until it is disabled.</p></div><div class="code-display"><code>${e(invite.id)}</code></div><div class="form-actions"><button class="btn btn-primary" data-action="copy-code" data-code="${e(invite.id)}">Copy code</button><button class="btn btn-ghost" data-action="close-modal">Done</button></div>`);
        try { await navigator.clipboard.writeText(invite.id); toast("Code created and copied."); } catch { toast("Code created. Use Copy code to copy it."); }
        break;
      }
      case "add-assessment": {
        const cls=byId(state.data.classes,data.classId); const score=Number(data.score); const maxScore=Number(data.maxScore);
        await createSchoolEntity(state.profile.schoolId,"assessments",{pupilId:data.pupilId,classId:data.classId,subjectId:cls.subjectId,name:data.name,topic:data.topic,date:data.date,score,maxScore,percentage:maxScore?Math.round(score/maxScore*100):0,grade:data.grade,teacherId:state.profile.id});
        const membership=state.data.memberships.find(m=>m.userId===data.pupilId&&m.classId===data.classId); if(membership)await updateSchoolEntity(state.profile.schoolId,"memberships",membership.id,{currentGrade:data.grade});
        closeModal();await refresh();toast("Assessment result saved.");break;
      }
      case "add-feedback": {
        const cls=byId(state.data.classes,data.classId);
        await createSchoolEntity(state.profile.schoolId,"feedbackRecords",{pupilId:data.pupilId,classId:data.classId,subjectId:cls.subjectId,assessmentName:data.assessmentName,date:data.date,skill:data.skill,feedbackType:data.feedbackType,strength:data.strength,nextStep:data.nextStep,trafficLight:data.trafficLight,status:"open",teacherId:state.profile.id,teacherNotes:data.teacherNotes||""});
        closeModal();await refresh();toast("Feedback added.");break;
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
      app.innerHTML=`<div class="loading"><div class="card card-pad" style="max-width:600px"><h2>Account needs a school profile</h2><p>Your Firebase sign-in exists, but no FeedbackLoop user document has been created. Sign out and use the class or department code supplied to you, or complete the one-time administrator setup in the supplied guide.</p><button class="btn btn-primary" data-action="signout">Sign out</button></div></div>`;
      return;
    }
    state.profile=profile;
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
