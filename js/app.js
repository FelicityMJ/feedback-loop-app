import {
  isDemoMode,
  observeAuth,
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
import { gradeChartSvg, miniBarSvg, gradeValue } from "./charts.js";
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
  loading: true
};

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
    ["feedback", "✎", "Assessments & feedback"],
    ["pupils", "♟", "Pupil dashboards"]
  ],
  pupil: [
    ["overview", "▦", "My progress"],
    ["feedback", "✓", "My feedback loops"],
    ["portfolio", "▤", "My learning record"],
    ["transfer", "⇄", "Account & transfer"]
  ]
};

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
  return sortByDateDesc((state.data?.assessments || []).filter((a) => a.pupilId === pupilId && (!subjectId || a.subjectId === subjectId)))[0] || null;
}

function openFeedbackCount(pupilId, subjectId = null) {
  return (state.data?.feedbackRecords || []).filter((f) => f.pupilId === pupilId && (!subjectId || f.subjectId === subjectId) && f.status !== "closed").length;
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
  const feedback = (state.data?.feedbackRecords || []).filter((f) => f.pupilId === pupilId && (!classId || f.classId === classId));
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
        <p>${register ? "Use the invitation code supplied by your school." : "Sign in to open your personalised dashboard."}</p>
        <div class="auth-tabs">
          <button class="auth-tab ${!register ? "active" : ""}" data-auth-tab="signin">Sign in</button>
          <button class="auth-tab ${register ? "active" : ""}" data-auth-tab="register">Join a school</button>
        </div>
        ${register ? `
          <form data-form="register">
            <div class="field"><label>Full name</label><input name="displayName" autocomplete="name" required></div>
            <div class="field"><label>Email address</label><input type="email" name="email" autocomplete="email" required></div>
            <div class="field"><label>Password</label><input type="password" name="password" minlength="8" autocomplete="new-password" required></div>
            <div class="field"><label>School invitation code</label><input name="inviteCode" placeholder="school-id~CODE" required><span class="field-help">Teachers, pupils and department heads receive this from the school administrator.</span></div>
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

function pupilPageHead(title, description) {
  const subjects = ensureSelectedSubject();
  return `<div class="page-head"><div><h1>${e(title)}</h1><p>${e(description)}</p></div><div class="page-actions">${subjects.length ? `<select class="btn btn-ghost" data-subject-select>${selectOptions(subjects, state.selectedSubjectId)}</select>` : ""}</div></div>`;
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
  const assessments = (state.data.assessments || []).filter((a) => a.pupilId === state.profile.id && a.subjectId === subjectId);
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.subjectId === subjectId));
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
  return `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><div class="timeline-meta">${badge(f.trafficLight)} ${badge(f.status)}</div><h4>${e(f.assessmentName || f.skill)}</h4><p><strong>Strength:</strong> ${e(f.strength)}</p><p><strong>Next step:</strong> ${e(f.nextStep)}</p>${action ? `<p><strong>Your action:</strong> ${e(action.actionTaken)}</p>` : ""}<div class="small muted">${dateFmt(f.date)} · ${e(f.skill)}</div></div></div>`;
}

function renderPupilFeedback() {
  ensureSelectedSubject();
  const subjectId = state.selectedSubjectId;
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id && f.subjectId === subjectId));
  return `${pupilPageHead("My feedback loops", "Reflect, take action and ask your teacher to check that the improvement is secure.")}
    <div class="grid grid-2">
      ${feedback.length ? feedback.map((f) => {
        const action = actionForFeedback(f.id);
        return `<article class="card feedback-card ${String(f.trafficLight).toLowerCase()}"><div class="timeline-meta">${badge(f.trafficLight)} ${badge(f.status)}</div><h4>${e(f.assessmentName || f.skill)}</h4><div class="small muted">${dateFmt(f.date)} · ${e(f.skill)}</div><div class="feedback-section"><strong>What went well</strong><p>${e(f.strength)}</p></div><div class="feedback-section"><strong>Next step</strong><p>${e(f.nextStep)}</p></div>${action ? `<div class="feedback-section"><strong>My reflection</strong><p>${e(action.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action.actionTaken)}</p></div>${action.teacherReview ? `<div class="alert alert-success" style="margin-top:13px">Teacher check: ${e(action.teacherReview)}</div>` : ""}` : ""}<div class="form-actions"><button class="btn ${f.status === "closed" ? "btn-ghost" : "btn-primary"} btn-sm" data-action="reflect" data-id="${f.id}">${action ? "Review my action" : "Add reflection and action"}</button></div></article>`;
      }).join("") : `<div class="card empty span-2">No feedback records for this subject yet.</div>`}
    </div>`;
}

function renderPupilPortfolio() {
  const assessments = sortByDateDesc((state.data.assessments || []).filter((a) => a.pupilId === state.profile.id));
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => f.pupilId === state.profile.id));
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
  const open = (state.data.feedbackRecords || []).filter((f) => pupilIds.includes(f.pupilId) && f.status !== "closed").length;
  return `<div class="page-head"><div><h1>Teaching overview</h1><p>See the class picture, then open an individual pupil dashboard when you need the detail behind it.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="add-feedback">Add feedback</button></div></div>
    <div class="grid grid-4">${kpi("▤", "My classes", classes.length)}${kpi("♟", "Pupils", pupilIds.length)}${kpi("✎", "Open feedback loops", open)}${kpi("⚑", "Pupils to review", atRisk.length, "Based on several indicators")}</div>
    ${cls ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>${e(cls.name)}</h3><p>${e(getSubjectName(cls.subjectId))} · ${pupilsForClass(cls.id).length} pupils · ${classAverage(cls.id)}% average</p></div><select class="btn btn-ghost" data-class-select>${selectOptions(classes, cls.id)}</select></div>${classSnapshotTable(cls)}</section>` : `<div class="card empty" style="margin-top:18px">Create or join a class to begin.</div>`}
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Common feedback themes</h3><p>Skills appearing most often in current feedback.</p></div></div><div class="card-body">${miniBarSvg(skillCountsForClasses(classes), "count", "skill")}</div></section><section class="card"><div class="card-head"><div><h3>Interventions to review</h3><p>Active support should always have a follow-up point.</p></div></div><div class="card-body timeline">${(state.data.interventions || []).filter((i) => pupilIds.includes(i.pupilId) && i.status !== "Closed").slice(0,5).map((i) => `<div class="timeline-item"><div class="timeline-dot"></div><div class="timeline-content"><h4>${e(getUserName(i.pupilId))}</h4><p>${e(i.action)}</p><div class="small muted">Review ${dateFmt(i.reviewDate)} · ${e(i.status)}</div></div></div>`).join("") || `<div class="empty">No active interventions.</div>`}</div></section></div>`;
}

function skillCountsForClasses(classes) {
  const classIds = classes.map((c) => c.id);
  const counts = {};
  for (const f of state.data.feedbackRecords || []) {
    if (classIds.includes(f.classId)) counts[f.skill || "Other"] = (counts[f.skill || "Other"] || 0) + 1;
  }
  return Object.entries(counts).map(([skill, count]) => ({ skill, count })).sort((a,b) => b.count-a.count).slice(0,8);
}

function renderTeacherClasses() {
  const classes = classesVisibleToProfile();
  return `<div class="page-head"><div><h1>My classes</h1><p>Create classes, check membership and use a pupil invitation code for straightforward enrolment.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="add-class">Add class</button></div></div>
    <div class="grid grid-3">${classes.map((cls) => `<section class="card card-pad"><div class="timeline-meta">${badge(cls.targetQualification || "Course")}</div><h3>${e(cls.name)}</h3><p class="muted">${e(getSubjectName(cls.subjectId))} · ${e(cls.academicYear || "")}</p><div class="grid grid-2"><div><strong>${pupilsForClass(cls.id).length}</strong><div class="small muted">Pupils</div></div><div><strong>${classAverage(cls.id)}%</strong><div class="small muted">Average</div></div></div><div class="form-actions"><button class="btn btn-ghost btn-sm" data-action="select-class" data-id="${cls.id}">Open class</button><button class="btn btn-secondary btn-sm" data-action="class-invite" data-id="${cls.id}">Pupil code</button></div></section>`).join("") || `<div class="card empty span-3">No classes yet.</div>`}</div>
    ${teacherSelectedClass() ? `<section class="card" style="margin-top:18px"><div class="card-head"><div><h3>${e(teacherSelectedClass().name)} pupil list</h3></div></div>${classSnapshotTable(teacherSelectedClass())}</section>` : ""}`;
}

function renderTeacherFeedback() {
  const classes = classesVisibleToProfile();
  const classIds = classes.map((c) => c.id);
  const feedback = sortByDateDesc((state.data.feedbackRecords || []).filter((f) => classIds.includes(f.classId)));
  const assessments = sortByDateDesc((state.data.assessments || []).filter((a) => classIds.includes(a.classId)));
  return `<div class="page-head"><div><h1>Assessments and feedback</h1><p>Record attainment, strengths and precise next steps. Pupils then reflect and submit evidence of action.</p></div><div class="page-actions"><button class="btn btn-ghost" data-action="add-assessment">Add assessment</button><button class="btn btn-primary" data-action="add-feedback">Add feedback</button></div></div>
    <div class="grid grid-3">${kpi("▤", "Assessment results", assessments.length)}${kpi("✎", "Feedback records", feedback.length)}${kpi("✓", "Closed loops", feedback.filter((f) => f.status === "closed").length)}</div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Recent feedback</h3><p>Open pupil actions appear first.</p></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Pupil</th><th>Class</th><th>Skill</th><th>Traffic</th><th>Status</th><th></th></tr></thead><tbody>${feedback.map((f) => `<tr><td>${dateFmt(f.date)}</td><td><button class="table-link" data-action="open-pupil" data-id="${f.pupilId}">${e(getUserName(f.pupilId))}</button></td><td>${e(getClassName(f.classId))}</td><td>${e(f.skill)}</td><td>${badge(f.trafficLight)}</td><td>${badge(f.status)}</td><td>${actionForFeedback(f.id)?.status === "submitted" ? `<button class="btn btn-primary btn-sm" data-action="review-action" data-id="${f.id}">Review action</button>` : `<button class="btn btn-ghost btn-sm" data-action="view-feedback" data-id="${f.id}">View</button>`}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No feedback records yet.</td></tr>`}</tbody></table></div></section>`;
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
  const open = (state.data.feedbackRecords || []).filter((f) => pupilIds.includes(f.pupilId) && f.status !== "closed").length;
  return `<div class="page-head"><div><h1>Department overview</h1><p>Compare classes, identify recurring weaknesses and make sure intervention is based on more than a single low mark.</p></div></div>
    <div class="grid grid-4">${kpi("▤", "Linked classes", classes.length)}${kpi("♟", "Pupils", pupilIds.length)}${kpi("✎", "Open feedback loops", open)}${kpi("⚑", "High-risk pupils", high.length)}</div>
    <div class="grid grid-2" style="margin-top:18px"><section class="card"><div class="card-head"><div><h3>Class tracking</h3><p>Average attainment and pupils below target.</p></div></div><div class="card-body">${classes.map((c) => { const pupils=pupilsForClass(c.id); const below=pupils.filter(p=>atRiskInfo(p.id,c.id).reasons.includes("below target")).length; return `<div class="progress-row"><span>${e(c.name)}</span><div class="progress-track"><div class="progress-bar" style="width:${classAverage(c.id)}%"></div></div><strong>${classAverage(c.id)}%</strong><div class="small muted" style="grid-column:2/4">${below} below target · ${pupils.length} pupils</div></div>`; }).join("") || `<div class="empty">No linked classes.</div>`}</div></section><section class="card"><div class="card-head"><div><h3>Common misconceptions</h3><p>Feedback themes across the department.</p></div></div><div class="card-body">${miniBarSvg(skillCountsForClasses(classes), "count", "skill")}</div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Pupils requiring review</h3><p>High and medium indicators are surfaced for professional judgement.</p></div><button class="btn btn-ghost btn-sm" data-route="at-risk">View full list</button></div>${riskTable(risks.filter((r) => r.level !== "Low").slice(0,8))}</section>`;
}

function riskTable(risks) {
  return `<div class="table-wrap"><table><thead><tr><th>Pupil</th><th>Latest</th><th>Target</th><th>Indicators</th><th>Risk</th><th></th></tr></thead><tbody>${risks.map((r) => `<tr><td><strong>${e(r.pupil?.displayName)}</strong></td><td>${badge(r.latestGrade)}</td><td>${badge(r.targetGrade)}</td><td>${e(r.reasons.join(", ") || "No current concern")}</td><td>${badge(r.level)}</td><td><button class="btn btn-primary btn-sm" data-action="open-pupil" data-id="${r.pupil?.id}">Dashboard</button></td></tr>`).join("") || `<tr><td colspan="6" class="empty">No pupils currently flagged.</td></tr>`}</tbody></table></div>`;
}

function renderHeadClasses() {
  const classes = headClasses();
  return `<div class="page-head"><div><h1>Department classes</h1><p>Use class-level patterns to support teachers and plan departmental intervention.</p></div></div><div class="grid grid-3">${classes.map((c) => `<section class="card card-pad"><h3>${e(c.name)}</h3><p class="muted">${e(getSubjectName(c.subjectId))} · ${pupilsForClass(c.id).length} pupils</p><div class="progress-row"><span>Average</span><div class="progress-track"><div class="progress-bar" style="width:${classAverage(c.id)}%"></div></div><strong>${classAverage(c.id)}%</strong></div><p>${badge(`${pupilsForClass(c.id).filter(p=>atRiskInfo(p.id,c.id).level!=="Low").length} to review`)}</p><button class="btn btn-ghost btn-sm" data-action="select-class" data-id="${c.id}">Open class</button></section>`).join("")}</div>${teacherSelectedClass() ? `<section class="card" style="margin-top:18px"><div class="card-head"><h3>${e(teacherSelectedClass().name)}</h3><select class="btn btn-ghost" data-class-select>${selectOptions(classes, teacherSelectedClass().id)}</select></div>${classSnapshotTable(teacherSelectedClass())}</section>` : ""}`;
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
  return `<div class="page-head"><div><h1>School overview</h1><p>Manage the school structure and see whether feedback is turning into pupil action across departments.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Create invitation</button></div></div>
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
    <div class="grid grid-2"><section class="card"><div class="card-head"><div><h3>Departments</h3></div></div><div class="table-wrap"><table><thead><tr><th>Department</th><th>Head IDs</th></tr></thead><tbody>${state.data.departments.map((d)=>`<tr><td>${e(d.name)}</td><td>${e((d.headIds||[]).map(getUserName).join(", ")||"Not assigned")}</td></tr>`).join("")||`<tr><td colspan="2" class="empty">No departments.</td></tr>`}</tbody></table></div></section>
    <section class="card"><div class="card-head"><div><h3>Subjects</h3></div></div><div class="table-wrap"><table><thead><tr><th>Subject</th><th>Department</th><th>Scale</th></tr></thead><tbody>${state.data.subjects.map((s)=>`<tr><td>${e(s.name)}</td><td>${e(byId(state.data.departments,s.departmentId)?.name||"")}</td><td>${e(s.gradeScale||"A-D")}</td></tr>`).join("")||`<tr><td colspan="3" class="empty">No subjects.</td></tr>`}</tbody></table></div></section></div>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Classes</h3></div></div><div class="table-wrap"><table><thead><tr><th>Class</th><th>Subject</th><th>Teachers</th><th>Pupils</th><th>Year</th></tr></thead><tbody>${state.data.classes.map((c)=>`<tr><td>${e(c.name)}</td><td>${e(getSubjectName(c.subjectId))}</td><td>${e((c.teacherIds||[]).map(getUserName).join(", ")||"Not assigned")}</td><td>${pupilsForClass(c.id).length}</td><td>${e(c.academicYear||"")}</td></tr>`).join("")}</tbody></table></div></section>
    <section class="card" style="margin-top:18px"><div class="card-head"><div><h3>Invitation codes</h3><p>Codes can be limited to a role, department, class or email address.</p></div><button class="btn btn-primary btn-sm" data-action="create-invite">Create code</button></div><div class="table-wrap"><table><thead><tr><th>Label</th><th>Role</th><th>Code</th><th>Status</th></tr></thead><tbody>${state.data.invites.map((i)=>`<tr><td>${e(i.label||"")}</td><td>${e(roleLabels[i.role]||i.role)}</td><td><code>${e(i.id)}</code></td><td>${badge(i.active?"Active":"Disabled")}</td></tr>`).join("")||`<tr><td colspan="4" class="empty">No invitation codes.</td></tr>`}</tbody></table></div></section>`;
}

function renderAdminPeople() {
  const users = [...state.data.users].sort((a,b)=>a.displayName.localeCompare(b.displayName));
  return `<div class="page-head"><div><h1>People and classes</h1><p>Accounts are linked to a permanent user ID. Email addresses can change without creating a new pupil profile.</p></div><div class="page-actions"><button class="btn btn-primary" data-action="create-invite">Invite user</button></div></div><section class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Classes</th><th>Status</th><th></th></tr></thead><tbody>${users.map((u)=>{const cls=u.role==="pupil"?state.data.memberships.filter(m=>m.userId===u.id).map(m=>getClassName(m.classId)):state.data.classes.filter(c=>(c.teacherIds||[]).includes(u.id)).map(c=>c.name);return `<tr><td><strong>${e(u.displayName)}</strong><div class="small muted">${e(u.learnerId||u.id)}</div></td><td>${badge(roleLabels[u.role]||u.role)}</td><td>${e(u.email)}</td><td>${e(cls.join(", ")||"—")}</td><td>${badge(u.active===false?"Inactive":"Active")}</td><td>${u.role==="pupil"?`<button class="btn btn-ghost btn-sm" data-action="open-pupil" data-id="${u.id}">Dashboard</button>`:""}</td></tr>`}).join("")}</tbody></table></div></section>`;
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
function closeModal() { state.modal = null; renderShell(); }

function modalAddDepartment() {
  openModal("Add department", `<form data-form="add-department"><div class="field"><label>Department name</label><input name="name" required placeholder="Computing & Business"></div><div class="form-actions"><button class="btn btn-primary">Add department</button></div></form>`);
}

function modalAddSubject() {
  openModal("Add subject", `<form data-form="add-subject" class="form-grid"><div class="field"><label>Subject name</label><input name="name" required></div><div class="field"><label>Department</label><select name="departmentId" required>${selectOptions(state.data.departments, "")}</select></div><div class="field"><label>Grade scale</label><select name="gradeScale"><option>A-D</option><option>Percentage</option><option>Pass/Fail</option></select></div><div class="form-actions full"><button class="btn btn-primary">Add subject</button></div></form>`);
}

function modalAddClass() {
  const staff = state.data.users.filter((u)=>["teacher","departmentHead"].includes(u.role));
  openModal("Add class", `<form data-form="add-class" class="form-grid"><div class="field"><label>Class name</label><input name="name" required placeholder="4A Computing"></div><div class="field"><label>Subject</label><select name="subjectId" required>${selectOptions(state.data.subjects, "")}</select></div><div class="field"><label>Lead teacher</label><select name="teacherId"><option value="">Not assigned</option>${selectOptions(staff, state.profile.role==="teacher"?state.profile.id:"", "displayName")}</select></div><div class="field"><label>Academic year</label><input name="academicYear" value="2026/27"></div><div class="field"><label>Qualification</label><input name="targetQualification" placeholder="National 5"></div><div class="form-actions full"><button class="btn btn-primary">Create class</button></div></form>`);
}

function modalCreateInvite(prefill = {}) {
  const classes = state.data.classes;
  openModal("Create invitation code", `<form data-form="create-invite" class="form-grid"><div class="field full"><label>Label</label><input name="label" required placeholder="4A Computing pupil code"></div><div class="field"><label>Role</label><select name="role" required><option value="pupil" ${prefill.role==="pupil"?"selected":""}>Pupil</option><option value="teacher">Teacher</option><option value="departmentHead">Department head</option></select></div><div class="field"><label>Class (optional)</label><select name="classId"><option value="">No class</option>${selectOptions(classes,prefill.classId||"")}</select></div><div class="field"><label>Department (optional)</label><select name="departmentId"><option value="">No department</option>${selectOptions(state.data.departments,"")}</select></div><div class="field"><label>Restrict to email (optional)</label><input type="email" name="emailRestriction"></div><div class="form-actions full"><button class="btn btn-primary">Generate code</button></div></form>`);
}

function classPupilOptions(classId) {
  return pupilsForClass(classId).map((p)=>`<option value="${e(p.id)}">${e(p.displayName)}</option>`).join("");
}

function modalAddAssessment() {
  const classes = classesVisibleToProfile();
  const cls = byId(classes,state.selectedClassId)||classes[0];
  openModal("Add assessment result", `<form data-form="add-assessment" class="form-grid"><div class="field"><label>Class</label><select name="classId" required data-form-class>${selectOptions(classes,cls?.id)}</select></div><div class="field"><label>Pupil</label><select name="pupilId" required data-form-pupil>${classPupilOptions(cls?.id)}</select></div><div class="field full"><label>Assessment name</label><input name="name" required></div><div class="field"><label>Topic or skill</label><input name="topic" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${todayInput()}" required></div><div class="field"><label>Score</label><input type="number" step="0.5" name="score" required></div><div class="field"><label>Maximum score</label><input type="number" step="0.5" name="maxScore" required></div><div class="field"><label>Grade</label><select name="grade"><option>A</option><option>B</option><option>C</option><option>D</option><option>No Award</option></select></div><div class="form-actions full"><button class="btn btn-primary">Save result</button></div></form>`);
}

function modalAddFeedback() {
  const classes = classesVisibleToProfile();
  const cls = byId(classes,state.selectedClassId)||classes[0];
  openModal("Add pupil feedback", `<form data-form="add-feedback" class="form-grid"><div class="field"><label>Class</label><select name="classId" required data-form-class>${selectOptions(classes,cls?.id)}</select></div><div class="field"><label>Pupil</label><select name="pupilId" required data-form-pupil>${classPupilOptions(cls?.id)}</select></div><div class="field"><label>Assessment or activity</label><input name="assessmentName" required></div><div class="field"><label>Date</label><input type="date" name="date" value="${todayInput()}" required></div><div class="field"><label>Skill or topic</label><input name="skill" required></div><div class="field"><label>Feedback type</label><select name="feedbackType"><option>Written</option><option>Progress Check</option><option>Timed Question</option><option>Homework</option><option>Coursework</option><option>Verbal</option><option>Practical Work</option></select></div><div class="field full"><label>Strength</label><textarea name="strength" required placeholder="Be specific about what the pupil did well."></textarea></div><div class="field full"><label>Next step</label><textarea name="nextStep" required placeholder="Give one precise action that can be completed and checked."></textarea></div><div class="field"><label>Traffic light</label><select name="trafficLight"><option>Green</option><option selected>Amber</option><option>Red</option></select></div><div class="field"><label>Private teacher note (optional)</label><input name="teacherNotes"></div><div class="form-actions full"><button class="btn btn-primary">Save feedback</button></div></form>`);
}

function modalReflection(feedbackId) {
  const f = byId(state.data.feedbackRecords, feedbackId);
  const action = actionForFeedback(feedbackId);
  openModal("Reflect and close the loop", `<div class="alert alert-info"><strong>Next step:</strong>&nbsp; ${e(f.nextStep)}</div><form data-form="reflection" class="form-grid" style="margin-top:16px"><input type="hidden" name="feedbackId" value="${e(f.id)}"><div class="field full"><label>What does the feedback mean?</label><textarea name="reflection" required>${e(action?.reflection||"")}</textarea></div><div class="field full"><label>What have you done differently?</label><textarea name="actionTaken" required>${e(action?.actionTaken||"")}</textarea></div><div class="field"><label>Confidence before</label><select name="confidenceBefore">${[1,2,3,4,5].map(n=>`<option ${Number(action?.confidenceBefore)===n?"selected":""}>${n}</option>`).join("")}</select></div><div class="field"><label>Confidence now</label><select name="confidenceAfter">${[1,2,3,4,5].map(n=>`<option ${Number(action?.confidenceAfter)===n?"selected":""}>${n}</option>`).join("")}</select></div><div class="form-actions full"><button class="btn btn-primary">Submit for teacher check</button></div></form>`);
}

function modalReviewAction(feedbackId) {
  const f = byId(state.data.feedbackRecords,feedbackId);
  const action = actionForFeedback(feedbackId);
  openModal("Review pupil action", `<div class="feedback-section"><strong>Feedback</strong><p>${e(f.nextStep)}</p></div><div class="feedback-section"><strong>Pupil reflection</strong><p>${e(action?.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action?.actionTaken)}</p></div><form data-form="review-action" style="margin-top:16px"><input type="hidden" name="feedbackId" value="${e(feedbackId)}"><input type="hidden" name="actionId" value="${e(action?.id)}"><div class="field"><label>Teacher review</label><textarea name="teacherReview" required></textarea></div><div class="field"><label>Decision</label><select name="decision"><option value="approved">Approve and close loop</option><option value="returned">Return for more work</option></select></div><div class="form-actions"><button class="btn btn-primary">Save review</button></div></form>`);
}

function modalViewFeedback(feedbackId) {
  const f = byId(state.data.feedbackRecords, feedbackId);
  const action = actionForFeedback(feedbackId);
  openModal("Feedback record", `<div class="timeline-meta">${badge(f.trafficLight)} ${badge(f.status)}</div><h3>${e(f.assessmentName || f.skill)}</h3><div class="small muted">${dateFmt(f.date)} · ${e(getUserName(f.pupilId))} · ${e(getClassName(f.classId))}</div><div class="feedback-section"><strong>Strength</strong><p>${e(f.strength)}</p></div><div class="feedback-section"><strong>Next step</strong><p>${e(f.nextStep)}</p></div>${action ? `<div class="feedback-section"><strong>Pupil reflection</strong><p>${e(action.reflection)}</p></div><div class="feedback-section"><strong>Action taken</strong><p>${e(action.actionTaken)}</p></div>` : `<div class="alert alert-warning" style="margin-top:16px">The pupil has not submitted an action yet.</div>`}`);
}

function modalPupilDashboard(pupilId) {
  const pupil = byId(state.data.users,pupilId);
  const memberships = state.data.memberships.filter(m=>m.userId===pupilId);
  const subjectIds = unique(memberships.map(m=>m.subjectId));
  const assessments = sortByDateDesc(state.data.assessments.filter(a=>a.pupilId===pupilId));
  const feedback = sortByDateDesc(state.data.feedbackRecords.filter(f=>f.pupilId===pupilId));
  const risk = atRiskInfo(pupilId);
  const recurring = skillCountsForPupil(pupilId).filter(x=>x.count>1);
  openModal(`${pupil.displayName} — pupil dashboard`, `<div class="grid grid-4">${kpi("↗","Latest",assessments[0]?.grade||"—")}${kpi("◎","Target",memberships[0]?.targetGrade||"—")}${kpi("✎","Open loops",openFeedbackCount(pupilId))}${kpi("⚑","Risk",risk.level)}</div><div class="alert ${risk.level==="High"?"alert-danger":risk.level==="Medium"?"alert-warning":"alert-success"}" style="margin-top:16px">${e(risk.reasons.join(", ")||"No current risk indicators.")}</div>${subjectIds.map(subjectId=>{const m=memberships.find(x=>x.subjectId===subjectId)||{};const list=state.data.assessments.filter(a=>a.pupilId===pupilId&&a.subjectId===subjectId);return `<section style="margin-top:20px"><h3>${e(getSubjectName(subjectId))}</h3><div class="chart-wrap">${gradeChartSvg(list,m.targetGrade)}</div></section>`}).join("")}<div class="grid grid-2"><section><h3>Recurring themes</h3>${recurring.length?miniBarSvg(recurring,"count","skill"):`<p class="muted">No repeated feedback theme yet.</p>`}</section><section><h3>Current feedback</h3><div class="timeline">${feedback.slice(0,5).map(feedbackTimelineItem).join("")}</div></section></div><div class="form-actions"><button class="btn btn-secondary" data-action="add-intervention" data-id="${pupilId}">Add intervention</button></div>`);
}

function skillCountsForPupil(pupilId) {
  const counts={};
  state.data.feedbackRecords.filter(f=>f.pupilId===pupilId).forEach(f=>counts[f.skill]=(counts[f.skill]||0)+1);
  return Object.entries(counts).map(([skill,count])=>({skill,count})).sort((a,b)=>b.count-a.count);
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

async function refresh(message = "Refreshing…") {
  setLoading(message);
  state.profile = await getUserProfile(state.authUser);
  state.data = await loadAppData(state.profile);
  state.loading = false;
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
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id;
  if (action === "close-modal") { closeModal(); return; }
  if (action === "signout") { await signOut(); state.authUser=null;state.profile=null;state.data=null;renderAuth(); return; }
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
  if (action === "add-assessment") return modalAddAssessment();
  if (action === "add-feedback") return modalAddFeedback();
  if (action === "reflect") return modalReflection(id);
  if (action === "review-action") return modalReviewAction(id);
  if (action === "view-feedback") return modalViewFeedback(id);
  if (action === "open-pupil") return modalPupilDashboard(id);
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
});

app.addEventListener("submit", async (event) => {
  const form=event.target.closest("form[data-form]");
  if(!form)return;
  event.preventDefault();
  const data=Object.fromEntries(new FormData(form).entries());
  const submit=form.querySelector("button[type=submit],button:not([type])");
  await withBusy(submit,async()=>{
    switch(form.dataset.form){
      case "signin": { const user=await signIn(data.email,data.password); await initialiseUser(user); break; }
      case "register": { const user=await registerWithInvite(data); await initialiseUser(user); toast("Account created. Check your email for a verification link."); break; }
      case "add-department": await createSchoolEntity(state.profile.schoolId,"departments",{name:data.name,headIds:[]}); closeModal(); await refresh(); toast("Department added."); break;
      case "add-subject": await createSchoolEntity(state.profile.schoolId,"subjects",{name:data.name,departmentId:data.departmentId,gradeScale:data.gradeScale}); closeModal(); await refresh(); toast("Subject added."); break;
      case "add-class": {
        const subject=byId(state.data.subjects,data.subjectId);
        await createSchoolEntity(state.profile.schoolId,"classes",{name:data.name,subjectId:data.subjectId,departmentId:subject?.departmentId||"",teacherIds:data.teacherId?[data.teacherId]:[],academicYear:data.academicYear,targetQualification:data.targetQualification,active:true});
        closeModal(); await refresh(); toast("Class created."); break;
      }
      case "create-invite": {
        const cls=byId(state.data.classes,data.classId);
        const invite=await createInvite(state.profile.schoolId,{label:data.label,role:data.role,classIds:data.classId?[data.classId]:[],subjectId:cls?.subjectId||"",departmentIds:data.departmentId?[data.departmentId]:[],emailRestriction:data.emailRestriction||"",createdBy:state.profile.id});
        closeModal(); await refresh(); navigator.clipboard?.writeText(invite.id); toast(`Invitation created and copied: ${invite.id}`); break;
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
      app.innerHTML=`<div class="loading"><div class="card card-pad" style="max-width:600px"><h2>Account needs a school profile</h2><p>Your Firebase sign-in exists, but no FeedbackLoop user document has been created. Sign out and use a school invitation code, or complete the one-time administrator setup in the supplied guide.</p><button class="btn btn-primary" data-action="signout">Sign out</button></div></div>`;
      return;
    }
    state.profile=profile;
    state.data=await loadAppData(profile);
    state.route="overview";
    state.selectedSubjectId=null;
    state.selectedClassId=null;
    renderShell();
  } catch(error){console.error(error);toast(error.message||"Could not load your profile.","error");renderAuth();}
}

setLoading("Starting FeedbackLoop…");
observeAuth(async (user)=>{
  if(user) await initialiseUser(user);
  else renderAuth();
});
