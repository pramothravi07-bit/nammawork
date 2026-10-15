import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import Chart from "https://cdn.jsdelivr.net/npm/chart.js@4.4.9/auto/+esm";
import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  isSupabaseConfigured
} from "./supabase-config.js";

const TABLES = {
  households: "households",
  shifts: "work_shifts",
  agreements: "work_agreements",
  disputes: "disputes"
};
const DEMO_KEY = "nammawork-demo-v1";
const THEME_KEY = "nammawork-theme";
const state = {
  mode: "signed-out",
  user: null,
  profile: null,
  households: [],
  shifts: [],
  agreements: [],
  disputes: [],
  editing: null,
  globalQuery: "",
  charts: {},
  authMode: "signin"
};
const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;

const $ = (id) => document.getElementById(id);
const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function notify(message, type = "success") {
  const container = $("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.textContent = message;
  container.append(toast);
  window.setTimeout(() => toast.remove(), 4500);
}

function showAuthMessage(message, type = "status") {
  const target = $("authMessage");
  target.textContent = message;
  target.dataset.kind = type;
}

function showApplication(visible) {
  $("authScreen").classList.toggle("hidden", visible);
  $("app").classList.toggle("hidden", !visible);
}

function setBusy(form, busy) {
  const submit = form.querySelector('[type="submit"]');
  if (!submit) return;
  if (busy) {
    submit.dataset.originalText = submit.textContent;
    submit.disabled = true;
    submit.textContent = "Please wait…";
  } else {
    submit.disabled = false;
    submit.textContent = submit.dataset.originalText || submit.textContent;
  }
}

function getDemoData() {
  try {
    const saved = JSON.parse(localStorage.getItem(DEMO_KEY) || "{}");
    return {
      profile: saved.profile || {
        full_name: "Demo Worker",
        phone: "",
        email: "",
        city: "",
        hourly_rate: 150,
        overtime_threshold: 48
      },
      households: Array.isArray(saved.households) ? saved.households : [],
      shifts: Array.isArray(saved.shifts) ? saved.shifts : [],
      agreements: Array.isArray(saved.agreements) ? saved.agreements : [],
      disputes: Array.isArray(saved.disputes) ? saved.disputes : []
    };
  } catch (error) {
    console.error("Could not read demo data.", error);
    throw new Error("Demo data could not be read from this browser.");
  }
}

function saveDemoData() {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify({
      profile: state.profile,
      households: state.households,
      shifts: state.shifts,
      agreements: state.agreements,
      disputes: state.disputes
    }));
  } catch (error) {
    console.error("Could not save demo data.", error);
    throw new Error("Demo data could not be saved in this browser.");
  }
}

function setAuthMode(mode) {
  state.authMode = mode;
  const recovery = mode === "recovery";
  const signup = mode === "signup";
  $("nameField").classList.toggle("hidden", !signup);
  $("authName").required = signup;
  $("authTitle").textContent = recovery
    ? "Choose a new password"
    : signup ? "Create your account" : "Welcome back!";
  $("authDescription").textContent = recovery
    ? "Use a new password to secure your account."
    : signup
      ? "Start keeping your work records in one safe place."
      : "Your work matters. Let's keep it protected.";
  $("authSubmit").textContent = recovery
    ? "Update password"
    : signup ? "Create account" : "Sign in";
  $("authSwitchText").textContent = signup ? "Already have an account?" : "New to NammaWork?";
  $("authSwitch").textContent = signup ? "Sign in" : "Create account";
  $("authSwitch").classList.toggle("hidden", recovery);
  $("passwordReset").classList.toggle("hidden", recovery || signup);
  $("demoAccess").classList.toggle("hidden", recovery);
}

function friendlyError(error) {
  return error?.message || "Something went wrong. Please try again.";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!supabase) {
    showAuthMessage("Add your Supabase project URL and publishable key in supabase-config.js first.", "error");
    return;
  }
  setBusy(form, true);
  showAuthMessage("");
  const email = $("authEmail").value.trim().toLowerCase();
  const password = $("authPassword").value;
  try {
    if (state.authMode === "signup") {
      const fullName = $("authName").value.trim();
      if (!fullName) throw new Error("Enter your full name.");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });
      if (error) throw error;
      if (data.session) {
        await enterAccount(data.session);
        notify("Your account was created.");
      } else {
        showAuthMessage("Account created. Check your email to confirm it, then sign in.");
      }
      return;
    }
    if (state.authMode === "recovery") {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setAuthMode("signin");
      $("authPassword").value = "";
      showAuthMessage("Password updated. Sign in with your new password.");
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await enterAccount(data.session);
    notify("Welcome back.");
  } catch (error) {
    console.error("Authentication failed.", error);
    showAuthMessage(friendlyError(error), "error");
  } finally {
    setBusy(form, false);
  }
}

async function sendPasswordReset() {
  if (!supabase) {
    showAuthMessage("Add your Supabase project URL and publishable key in supabase-config.js first.", "error");
    return;
  }
  const email = $("authEmail").value.trim().toLowerCase();
  if (!email) {
    $("authEmail").focus();
    showAuthMessage("Enter your email address first.", "error");
    return;
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.href.split("#")[0]
  });
  if (error) {
    showAuthMessage(friendlyError(error), "error");
    return;
  }
  showAuthMessage("Password reset link sent. Check your email.");
}

async function enterDemo(announce = false) {
  state.mode = "demo";
  state.user = null;
  const data = getDemoData();
  Object.assign(state, data);
  showApplication(true);
  $("storageNotice").textContent = "Demo records stay in this browser and are not sent to Supabase.";
  $("resetData").classList.remove("hidden");
  $("accountAccessRow").classList.toggle("hidden", !supabase);
  $("logoutButton").textContent = "Return to dashboard";
  await refreshApplication();
  if (announce) notify("Demo mode is active. Do not enter sensitive information.");
}

async function enterAccount(session) {
  if (!session?.user) {
    showApplication(false);
    return;
  }
  state.mode = "account";
  state.user = session.user;
  $("storageNotice").textContent = "Your cloud records are protected by Supabase Row Level Security.";
  $("resetData").classList.add("hidden");
  $("accountAccessRow").classList.add("hidden");
  $("logoutButton").textContent = "Sign out";
  showApplication(true);
  await loadAccountData();
  await refreshApplication();
}

async function loadAccountData() {
  const userId = state.user.id;
  const queries = [
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from(TABLES.households).select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
    supabase.from(TABLES.shifts).select("*").eq("owner_id", userId).order("shift_date", { ascending: false }),
    supabase.from(TABLES.agreements).select("*").eq("owner_id", userId).order("start_date", { ascending: false }),
    supabase.from(TABLES.disputes).select("*").eq("owner_id", userId).order("date_reported", { ascending: false })
  ];
  const [profileResult, householdResult, shiftResult, agreementResult, disputeResult] = await Promise.all(queries);
  for (const result of [profileResult, householdResult, shiftResult, agreementResult, disputeResult]) {
    if (result.error) throw result.error;
  }
  const profile = profileResult.data || {
    id: userId,
    full_name: state.user.user_metadata?.full_name || "",
    email: state.user.email || "",
    phone: "",
    city: "",
    hourly_rate: 150,
    overtime_threshold: 48
  };
  state.profile = profile;
  state.households = householdResult.data || [];
  state.shifts = shiftResult.data || [];
  state.agreements = agreementResult.data || [];
  state.disputes = disputeResult.data || [];
  if (!profileResult.data) {
    const { error } = await supabase.from("profiles").upsert(profile);
    if (error) throw error;
  }
}

async function refreshApplication() {
  updateIdentity();
  fillHouseholdSelects();
  renderHouseholds();
  renderShifts();
  renderAgreements();
  renderDisputes();
  renderDashboard();
  renderReports();
  updateCharts();
  applyGlobalFilter();
}

function updateIdentity() {
  const name = state.profile?.full_name?.trim() || (state.mode === "demo" ? "Demo Worker" : "Worker");
  const firstName = name.split(/\s+/)[0];
  $("heroUserName").textContent = firstName;
  $("sidebarUserName").textContent = name;
  $("topUserName").textContent = name;
  $("topAvatar").textContent = firstName.charAt(0).toUpperCase() || "W";
  $("sidebarProfile").querySelector(".avatar").textContent = firstName.charAt(0).toUpperCase() || "W";
  $("todayDate").textContent = new Intl.DateTimeFormat("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric"
  }).format(new Date());
  $("profileName").value = state.profile?.full_name || "";
  $("profilePhone").value = state.profile?.phone || "";
  $("profileEmail").value = state.profile?.email || state.user?.email || "";
  $("profileEmail").readOnly = state.mode === "account";
  $("profileArea").value = state.profile?.city || "";
  $("defaultHourlyRate").value = state.profile?.hourly_rate ?? 150;
  $("overtimeThreshold").value = state.profile?.overtime_threshold ?? 48;
}

function householdName(id) {
  return state.households.find((household) => household.id === id)?.employer_name || "Household";
}

function fillHouseholdSelects() {
  for (const id of ["shiftHousehold", "agreementHousehold", "disputeHousehold"]) {
    const select = $(id);
    const selected = select.value;
    select.innerHTML = '<option value="">Choose household</option>' +
      state.households.map((household) =>
        `<option value="${escapeHtml(household.id)}">${escapeHtml(household.employer_name)}</option>`
      ).join("");
    if (state.households.some((household) => household.id === selected)) select.value = selected;
  }
}

function cardActions(type, record) {
  return `<div class="record-actions">
    <button type="button" data-action="edit" data-type="${type}" data-id="${escapeHtml(record.id)}">Edit</button>
    <button type="button" data-action="delete" data-type="${type}" data-id="${escapeHtml(record.id)}">Delete</button>
  </div>`;
}

function renderHouseholds() {
  const target = $("householdList");
  const records = filterRecords(state.households, (row) =>
    `${row.employer_name} ${row.location} ${row.work_type} ${row.notes}`);
  target.innerHTML = records.length ? records.map((household) => `
    <article class="record-card">
      <span class="eyebrow">${escapeHtml(household.work_type)}</span>
      <h3>${escapeHtml(household.employer_name)}</h3>
      <p>${escapeHtml(household.location)}</p>
      <p class="record-meta">${money(household.hourly_rate)} / hour</p>
      ${household.notes ? `<p>${escapeHtml(household.notes)}</p>` : ""}
      ${cardActions("households", household)}
    </article>`).join("") : emptyCard(state.households.length
      ? "No households match your search."
      : "No households yet. Add a household to begin.");
}

function renderShifts() {
  const target = $("shiftTableBody");
  const query = $("shiftSearch").value.trim().toLowerCase();
  const records = [...state.shifts]
    .sort((a, b) => b.shift_date.localeCompare(a.shift_date))
    .filter((shift) => {
      const text = `${shift.shift_date} ${householdName(shift.household_id)} ${shift.shift_number || ""} ${shift.notes}`.toLowerCase();
      return !query || text.includes(query);
    });
  target.innerHTML = records.length ? records.map((shift) => `
    <tr>
      <td>${escapeHtml(formatDate(shift.shift_date))}</td>
      <td>${escapeHtml(householdName(shift.household_id))}</td>
      <td>${escapeHtml(shift.shift_number || "—")}</td>
      <td>${escapeHtml(shift.start_time.slice(0, 5))}</td>
      <td>${escapeHtml(shift.end_time.slice(0, 5))}</td>
      <td>${Number(shift.break_minutes)} min</td>
      <td>${Number(shift.total_hours).toFixed(2)} hrs</td>
      <td>${money(shift.expected_wages)}</td>
      <td><span class="status-pill ${escapeHtml(shift.payment_status)}">${escapeHtml(shift.payment_status)}</span>
        <br><small>${money(shift.amount_received)} received</small></td>
      <td class="record-actions">
        <button type="button" data-action="edit" data-type="shifts" data-id="${escapeHtml(shift.id)}">Edit</button>
        ${shift.payment_status !== "paid" ? `<button type="button" data-action="mark-paid" data-id="${escapeHtml(shift.id)}">Mark paid</button>` : ""}
        <button type="button" data-action="delete" data-type="shifts" data-id="${escapeHtml(shift.id)}">Delete</button>
      </td>
  </tr>`).join("") : `<tr><td colspan="10">${emptyMessage(state.shifts.length ? "No shifts match your search." : "No shifts recorded yet.")}</td></tr>`;
}

function renderAgreements() {
  const target = $("agreementList");
  const records = filterRecords(state.agreements, (row) =>
    `${householdName(row.household_id)} ${row.wage_terms} ${row.work_schedule} ${row.responsibilities} ${row.agreement_status}`);
  target.innerHTML = records.length ? records.map((agreement) => `
    <article class="record-card">
      <span class="status-pill ${escapeHtml(agreement.agreement_status)}">${escapeHtml(agreement.agreement_status)}</span>
      <h3>${escapeHtml(householdName(agreement.household_id))}</h3>
      <p>${escapeHtml(formatDate(agreement.start_date))}${agreement.end_date ? ` – ${escapeHtml(formatDate(agreement.end_date))}` : " – ongoing"}</p>
      <p class="record-meta">${money(agreement.agreed_hourly_rate)} / hour</p>
      <p><strong>Schedule:</strong> ${escapeHtml(agreement.work_schedule)}</p>
      <p><strong>Responsibilities:</strong> ${escapeHtml(agreement.responsibilities)}</p>
      <p>${escapeHtml(agreement.wage_terms)}</p>
      <div class="record-actions">
        <button type="button" data-action="edit" data-type="agreements" data-id="${escapeHtml(agreement.id)}">Edit</button>
        <button type="button" data-action="cycle-agreement" data-id="${escapeHtml(agreement.id)}">Update status</button>
        <button type="button" data-action="delete" data-type="agreements" data-id="${escapeHtml(agreement.id)}">Delete</button>
      </div>
    </article>`).join("") : emptyCard(state.agreements.length
      ? "No agreements match your search."
      : "No agreements recorded yet.");
}

function renderDisputes() {
  const target = $("disputeList");
  const records = filterRecords(state.disputes, (row) =>
    `${householdName(row.household_id)} ${row.concern_category} ${row.description} ${row.status}`);
  target.innerHTML = records.length ? records.map((dispute) => `
    <article class="record-card">
      <span class="status-pill ${escapeHtml(dispute.status)}">${escapeHtml(dispute.status.replace("_", " "))}</span>
      <h3>${escapeHtml(dispute.concern_category)}</h3>
      <p>${escapeHtml(householdName(dispute.household_id))} · ${escapeHtml(formatDate(dispute.date_reported))}</p>
      <p>${escapeHtml(dispute.description)}</p>
      ${dispute.amount_involved != null ? `<p class="record-meta">Amount in question: ${money(dispute.amount_involved)}</p>` : ""}
      <div class="record-actions">
        <button type="button" data-action="cycle-dispute" data-id="${escapeHtml(dispute.id)}">Update status</button>
        <button type="button" data-action="delete" data-type="disputes" data-id="${escapeHtml(dispute.id)}">Delete</button>
      </div>
    </article>`).join("") : emptyCard(state.disputes.length
      ? "No concerns match your search."
      : "No concerns reported yet.");
  $("disputeBadge").textContent = state.disputes.filter((item) => !["resolved", "closed"].includes(item.status)).length;
}

function emptyMessage(message) {
  return `<div class="empty-state"><p>${escapeHtml(message)}</p></div>`;
}

function emptyCard(message) {
  return `<article class="panel">${emptyMessage(message)}</article>`;
}

function filterRecords(records, getText) {
  const query = state.globalQuery.toLowerCase();
  return records.filter((record) => !query || getText(record).toLowerCase().includes(query));
}

function dateOnly(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - ((result.getDay() + 6) % 7));
  return result;
}

function isBetween(dateValue, start, end) {
  return dateValue >= dateOnly(start) && dateValue <= dateOnly(end);
}

function shiftsBetween(start, end) {
  return state.shifts.filter((shift) => isBetween(shift.shift_date, start, end));
}

function renderDashboard() {
  const today = new Date();
  const monday = startOfWeek(today);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const weekly = shiftsBetween(monday, sunday);
  const expected = state.shifts.reduce((total, shift) => total + Number(shift.expected_wages), 0);
  const pending = state.agreements.filter((item) => item.agreement_status === "pending").length +
    state.disputes.filter((item) => !["resolved", "closed"].includes(item.status)).length;
  $("totalHouseholds").textContent = state.households.length;
  $("totalHours").textContent = round2(weekly.reduce((total, shift) => total + Number(shift.total_hours), 0)).toFixed(2);
  $("totalEarnings").textContent = money(expected);
  $("pendingCount").textContent = pending;

  const recent = [...state.shifts].sort((a, b) =>
    `${b.shift_date}${b.start_time}`.localeCompare(`${a.shift_date}${a.start_time}`)).slice(0, 5);
  $("recentActivity").innerHTML = recent.length ? recent.map((shift) => `
    <div class="activity-item"><strong>${escapeHtml(householdName(shift.household_id))}</strong>
      <p>${escapeHtml(formatDate(shift.shift_date))} · ${Number(shift.total_hours).toFixed(2)} hours · ${money(shift.expected_wages)}</p>
    </div>`).join("") : emptyMessage("Your records will appear here.");

  const alerts = [];
  const threshold = Number(state.profile?.overtime_threshold) || 48;
  const weekHours = weekly.reduce((total, shift) => total + Number(shift.total_hours), 0);
  if (weekHours > threshold) {
    alerts.push({ type: "warning", title: "Weekly hours above your alert", detail: `${weekHours.toFixed(2)} hours recorded; threshold is ${threshold} hours.` });
  }
  const unpaid = state.shifts.filter((shift) => Number(shift.expected_wages) > Number(shift.amount_received));
  if (unpaid.length) {
    const balance = unpaid.reduce((total, shift) => total + Number(shift.expected_wages) - Number(shift.amount_received), 0);
    alerts.push({ type: "danger", title: "Outstanding wages", detail: `${money(balance)} remains unpaid across ${unpaid.length} shift(s).` });
  }
  const activeDisputes = state.disputes.filter((item) => !["resolved", "closed"].includes(item.status)).length;
  if (activeDisputes) alerts.push({ type: "warning", title: "Concerns needing attention", detail: `${activeDisputes} open concern(s) are being tracked.` });
  $("riskAlerts").innerHTML = alerts.length ? alerts.map((alert) => `
    <div class="alert-item ${alert.type}"><strong>${escapeHtml(alert.title)}</strong><p>${escapeHtml(alert.detail)}</p></div>
  `).join("") : emptyMessage("No current alerts.");
  $("alertCount").textContent = `${alerts.length} alert${alerts.length === 1 ? "" : "s"}`;
}

function renderReports() {
  const totalHours = state.shifts.reduce((sum, shift) => sum + Number(shift.total_hours), 0);
  const expected = state.shifts.reduce((sum, shift) => sum + Number(shift.expected_wages), 0);
  const received = state.shifts.reduce((sum, shift) => sum + Number(shift.amount_received), 0);
  $("reportTotalHours").textContent = round2(totalHours).toFixed(2);
  $("reportExpectedWages").textContent = money(expected);
  $("reportPaid").textContent = money(received);
  $("reportOutstanding").textContent = money(Math.max(0, expected - received));
  const byHousehold = new Map();
  for (const shift of state.shifts) {
    const current = byHousehold.get(shift.household_id) || { expected: 0, received: 0, hours: 0 };
    current.expected += Number(shift.expected_wages);
    current.received += Number(shift.amount_received);
    current.hours += Number(shift.total_hours);
    byHousehold.set(shift.household_id, current);
  }
  const rows = [...byHousehold.entries()].map(([id, totals]) => `
    <tr><td>${escapeHtml(householdName(id))}</td><td>${round2(totals.hours).toFixed(2)}</td>
    <td>${money(totals.expected)}</td><td>${money(totals.received)}</td>
    <td>${money(Math.max(0, totals.expected - totals.received))}</td></tr>`).join("");
  $("reportSummary").innerHTML = rows
    ? `<div class="table-wrapper"><table><thead><tr><th>Household</th><th>Hours</th><th>Expected</th><th>Received</th><th>Outstanding</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : emptyMessage("Your report will appear here after you record shifts.");
}

function updateCharts() {
  const period = $("hoursPeriod").value;
  const today = new Date();
  const weekStart = startOfWeek(today);
  const labels = [];
  const totals = [];
  if (period === "week") {
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + offset);
      const key = dateOnly(date);
      labels.push(new Intl.DateTimeFormat("en-IN", { weekday: "short" }).format(date));
      totals.push(round2(state.shifts.filter((shift) => shift.shift_date === key)
        .reduce((sum, shift) => sum + Number(shift.total_hours), 0)));
    }
  } else {
    const days = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= days; day += 1) {
      const date = new Date(today.getFullYear(), today.getMonth(), day);
      const key = dateOnly(date);
      labels.push(String(day));
      totals.push(round2(state.shifts.filter((shift) => shift.shift_date === key)
        .reduce((sum, shift) => sum + Number(shift.total_hours), 0)));
    }
  }
  const distribution = state.households.map((household) => ({
    label: household.employer_name,
    hours: round2(state.shifts.filter((shift) => shift.household_id === household.id)
      .reduce((sum, shift) => sum + Number(shift.total_hours), 0)),
    wages: round2(state.shifts.filter((shift) => shift.household_id === household.id)
      .reduce((sum, shift) => sum + Number(shift.expected_wages), 0))
  })).filter((item) => item.hours > 0 || item.wages > 0);
  drawChart("hoursChart", {
    type: "bar",
    data: { labels, datasets: [{ label: "Hours", data: totals, backgroundColor: "#8b72c9", borderRadius: 7 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
  drawChart("distributionChart", {
    type: "doughnut",
    data: {
      labels: distribution.map((item) => item.label),
      datasets: [{ data: distribution.map((item) => item.hours), backgroundColor: ["#174c3d", "#8061bd", "#d98569", "#5c8eb7", "#c9a84f"] }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
  $("distributionLegend").innerHTML = distribution.length
    ? distribution.map((item) => `<span>${escapeHtml(item.label)} · ${item.hours.toFixed(2)} hrs</span>`).join("")
    : "";
  drawChart("earningsChart", {
    type: "bar",
    data: {
      labels: distribution.map((item) => item.label),
      datasets: [{ label: "Expected wages (₹)", data: distribution.map((item) => item.wages), backgroundColor: "#d98569", borderRadius: 7 }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

function drawChart(id, config) {
  if (state.charts[id]) state.charts[id].destroy();
  const canvas = $(id);
  if (canvas) state.charts[id] = new Chart(canvas, config);
}

function formatDate(value) {
  if (!value) return "";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function showPage(name) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.toggle("active", page.id === `page-${name}`);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.page === name);
  });
  $("sidebar").classList.remove("open");
  if (name === "reports") renderReports();
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  fillHouseholdSelects();
  if (id === "shiftModal") {
    $("shiftDate").value ||= dateOnly(new Date());
    $("shiftPayment").value = "unpaid";
    $("shiftPaidAmount").value = "0";
  }
  modal.showModal();
}

function closeModal(modal) {
  if (!modal) return;
  modal.close();
  modal.querySelector("form")?.reset();
  state.editing = null;
  restoreModalHeading(modal);
}

function restoreModalHeading(modal) {
  const title = modal.querySelector(".modal-heading h2");
  const button = modal.querySelector('form [type="submit"]');
  const defaults = {
    householdModal: ["Add household", "Save household"],
    shiftModal: ["Record a shift", "Save shift"],
    agreementModal: ["New agreement", "Save agreement"],
    disputeModal: ["Report a concern", "Save concern"]
  }[modal.id];
  if (defaults) {
    title.textContent = defaults[0];
    button.textContent = defaults[1];
  }
}

function editRecord(type, id) {
  const record = state[type].find((item) => item.id === id);
  if (!record) return;
  const details = {
    households: {
      modal: "householdModal", title: "Edit household", submit: "Update household",
      fields: { householdName: "employer_name", householdArea: "location", householdRate: "hourly_rate", householdWork: "work_type", householdNotes: "notes" }
    },
    shifts: {
      modal: "shiftModal", title: "Edit shift", submit: "Update shift",
      fields: { shiftHousehold: "household_id", shiftNumber: "shift_number", shiftDate: "shift_date", shiftStart: "start_time", shiftEnd: "end_time", shiftBreak: "break_minutes", shiftPayment: "payment_status", shiftPaidAmount: "amount_received", shiftNotes: "notes" }
    },
    agreements: {
      modal: "agreementModal", title: "Edit agreement", submit: "Update agreement",
      fields: { agreementHousehold: "household_id", agreementStart: "start_date", agreementEnd: "end_date", agreementRate: "agreed_hourly_rate", agreementStatus: "agreement_status", agreementSchedule: "work_schedule", agreementResponsibilities: "responsibilities", agreementTerms: "wage_terms" }
    }
  }[type];
  if (!details) return;
  state.editing = { type, id };
  openModal(details.modal);
  for (const [elementId, key] of Object.entries(details.fields)) {
    $(elementId).value = record[key] ?? "";
  }
  const modal = $(details.modal);
  modal.querySelector(".modal-heading h2").textContent = details.title;
  modal.querySelector('form [type="submit"]').textContent = details.submit;
}

async function persistRecord(type, record, id = null) {
  if (state.mode === "demo") {
    const records = state[type];
    if (id) {
      const index = records.findIndex((item) => item.id === id);
      if (index < 0) throw new Error("This record no longer exists.");
      records[index] = { ...records[index], ...record, id };
    } else {
      records.unshift({ ...record, id: crypto.randomUUID(), created_at: new Date().toISOString() });
    }
    saveDemoData();
    return;
  }
  const table = TABLES[type];
  const payload = { ...record, owner_id: state.user.id };
  const request = id
    ? supabase.from(table).update(payload).eq("id", id).eq("owner_id", state.user.id).select().single()
    : supabase.from(table).insert(payload).select().single();
  const { data, error } = await request;
  if (error) throw error;
  const index = state[type].findIndex((item) => item.id === id);
  if (id && index >= 0) state[type][index] = data;
  else state[type].unshift(data);
}

async function removeRecord(type, id) {
  if (state.mode === "demo") {
    state[type] = state[type].filter((item) => item.id !== id);
    if (type === "households") {
      for (const related of ["shifts", "agreements", "disputes"]) {
        state[related] = state[related].filter((item) => item.household_id !== id);
      }
    }
    saveDemoData();
    return;
  }
  const { error } = await supabase.from(TABLES[type]).delete()
    .eq("id", id).eq("owner_id", state.user.id);
  if (error) throw error;
  state[type] = state[type].filter((item) => item.id !== id);
  if (type === "households") {
    for (const related of ["shifts", "agreements", "disputes"]) {
      state[related] = state[related].filter((item) => item.household_id !== id);
    }
  }
}

function numericValue(id, label, minimum = 0) {
  const value = Number($(id).value);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`${label} must be ${minimum === 0 ? "zero or greater" : `at least ${minimum}`}.`);
  return value;
}

async function submitProfile(event) {
  event.preventDefault();
  try {
    const profile = {
      ...(state.mode === "account" ? { id: state.user.id } : {}),
      full_name: $("profileName").value.trim(),
      phone: $("profilePhone").value.trim() || null,
      email: state.mode === "account" ? state.user.email : $("profileEmail").value.trim(),
      city: $("profileArea").value.trim() || null,
      hourly_rate: round2(numericValue("defaultHourlyRate", "Hourly rate")),
      overtime_threshold: Math.floor(numericValue("overtimeThreshold", "Overtime threshold", 1))
    };
    if (!profile.full_name) throw new Error("Full name is required.");
    if (profile.overtime_threshold > 168) throw new Error("Overtime threshold cannot exceed 168 hours.");
    if (state.mode === "account") {
      const { error } = await supabase.from("profiles").upsert(profile);
      if (error) throw error;
    } else {
      state.profile = profile;
      saveDemoData();
    }
    state.profile = profile;
    updateIdentity();
    notify("Profile saved.");
  } catch (error) {
    console.error("Could not save profile.", error);
    notify(friendlyError(error), "error");
  }
}

async function submitHousehold(event) {
  event.preventDefault();
  try {
    const row = {
      employer_name: $("householdName").value.trim(),
      location: $("householdArea").value.trim(),
      hourly_rate: round2(numericValue("householdRate", "Hourly rate")),
      work_type: $("householdWork").value,
      notes: $("householdNotes").value.trim()
    };
    if (!row.employer_name || !row.location) throw new Error("Name and location are required.");
    await persistRecord("households", row, state.editing?.type === "households" ? state.editing.id : null);
    closeModal($("householdModal"));
    await refreshApplication();
    notify("Household saved.");
  } catch (error) {
    console.error("Could not save household.", error);
    notify(friendlyError(error), "error");
  }
}

function calculateShift() {
  const date = $("shiftDate").value;
  const shiftNumber = $("shiftNumber").value;
  const start = $("shiftStart").value;
  const end = $("shiftEnd").value;
  if (!date || !start || !end || !state.households.some((item) => item.id === $("shiftHousehold").value)) {
    throw new Error("Choose a household, date, start time, and end time.");
  }
  if (!["First Shift", "Second Shift", "Third Shift"].includes(shiftNumber)) {
    throw new Error("Choose First Shift, Second Shift, or Third Shift.");
  }
  const validDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(validDate.getTime()) || dateOnly(validDate) !== date) throw new Error("Enter a valid shift date.");
  const toMinutes = (time) => {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  };
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  if (startMinutes === null || endMinutes === null) throw new Error("Enter valid start and end times.");
  if (startMinutes === endMinutes) throw new Error("Start and end times must be different.");
  let durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) durationMinutes += 24 * 60;
  const breakMinutes = Math.floor(numericValue("shiftBreak", "Break duration"));
  if (breakMinutes >= durationMinutes) throw new Error("Break must be shorter than the shift.");
  const paidMinutes = durationMinutes - breakMinutes;
  const hours = Math.round((paidMinutes / 60) * 10000) / 10000;
  if (hours <= 0) throw new Error("The shift must contain working time after the break.");
  const household = state.households.find((item) => item.id === $("shiftHousehold").value);
  const wages = round2((paidMinutes / 60) * Number(household.hourly_rate));
  const paymentStatus = $("shiftPayment").value;
  let amountReceived = round2(numericValue("shiftPaidAmount", "Amount received"));
  if (amountReceived > wages) throw new Error("Amount received cannot exceed expected wages.");
  if (paymentStatus === "paid" && amountReceived === 0) amountReceived = wages;
  if (paymentStatus === "paid" && amountReceived !== wages) throw new Error("For a paid shift, amount received must equal expected wages.");
  if (paymentStatus === "unpaid" && amountReceived !== 0) throw new Error("For an unpaid shift, amount received must be zero.");
  if (paymentStatus === "partial" && (amountReceived <= 0 || amountReceived >= wages)) {
    throw new Error("A partial payment must be greater than zero and less than expected wages.");
  }
  return {
    household_id: household.id,
    shift_number: shiftNumber,
    shift_date: date,
    start_time: `${start}:00`,
    end_time: `${end}:00`,
    break_minutes: breakMinutes,
    total_hours: hours,
    expected_wages: wages,
    payment_status: paymentStatus,
    amount_received: amountReceived,
    notes: $("shiftNotes").value.trim()
  };
}

async function submitShift(event) {
  event.preventDefault();
  try {
    const row = calculateShift();
    await persistRecord("shifts", row, state.editing?.type === "shifts" ? state.editing.id : null);
    closeModal($("shiftModal"));
    await refreshApplication();
    notify("Shift saved.");
  } catch (error) {
    console.error("Could not save shift.", error);
    notify(friendlyError(error), "error");
  }
}

async function submitAgreement(event) {
  event.preventDefault();
  try {
    const startDate = $("agreementStart").value;
    const endDate = $("agreementEnd").value || null;
    if (!startDate || (endDate && endDate < startDate)) throw new Error("End date must be on or after the start date.");
    const row = {
      household_id: $("agreementHousehold").value,
      start_date: startDate,
      end_date: endDate,
      agreed_hourly_rate: round2(numericValue("agreementRate", "Hourly rate")),
      agreement_status: $("agreementStatus").value,
      work_schedule: $("agreementSchedule").value.trim(),
      responsibilities: $("agreementResponsibilities").value.trim(),
      wage_terms: $("agreementTerms").value.trim(),
      notes: ""
    };
    if (!state.households.some((item) => item.id === row.household_id)) throw new Error("Choose a household.");
    if (!row.work_schedule || !row.responsibilities || !row.wage_terms) throw new Error("Schedule, responsibilities, and wage terms are required.");
    await persistRecord("agreements", row, state.editing?.type === "agreements" ? state.editing.id : null);
    closeModal($("agreementModal"));
    await refreshApplication();
    notify("Agreement saved.");
  } catch (error) {
    console.error("Could not save agreement.", error);
    notify(friendlyError(error), "error");
  }
}

async function submitDispute(event) {
  event.preventDefault();
  try {
    const row = {
      household_id: $("disputeHousehold").value,
      concern_category: $("disputeType").value,
      description: $("disputeDescription").value.trim(),
      amount_involved: $("disputeAmount").value === "" ? null : round2(numericValue("disputeAmount", "Amount involved")),
      status: "open",
      date_reported: dateOnly(new Date())
    };
    if (!state.households.some((item) => item.id === row.household_id)) throw new Error("Choose a household.");
    if (!row.description) throw new Error("Describe the concern.");
    await persistRecord("disputes", row);
    closeModal($("disputeModal"));
    await refreshApplication();
    notify("Concern recorded.");
  } catch (error) {
    console.error("Could not save concern.", error);
    notify(friendlyError(error), "error");
  }
}

async function updateRecord(type, id, changes) {
  const record = state[type].find((item) => item.id === id);
  if (!record) throw new Error("This record no longer exists.");
  if (state.mode === "demo") {
    Object.assign(record, changes);
    saveDemoData();
  } else {
    const { data, error } = await supabase.from(TABLES[type]).update(changes)
      .eq("id", id).eq("owner_id", state.user.id).select().single();
    if (error) throw error;
    Object.assign(record, data);
  }
}

async function handleRecordAction(button) {
  const { action, type, id } = button.dataset;
  try {
    if (action === "edit") {
      editRecord(type, id);
      return;
    }
    if (action === "delete") {
      const prompt = type === "households"
        ? "Delete this household and all of its shifts, agreements, and concerns?"
        : "Delete this record?";
      if (!window.confirm(prompt)) return;
      await removeRecord(type, id);
      await refreshApplication();
      notify("Record deleted.");
      return;
    }
    if (action === "mark-paid") {
      const shift = state.shifts.find((item) => item.id === id);
      await updateRecord("shifts", id, {
        payment_status: "paid",
        amount_received: Number(shift.expected_wages)
      });
      await refreshApplication();
      notify("Shift marked as paid.");
      return;
    }
    if (action === "cycle-agreement") {
      const agreement = state.agreements.find((item) => item.id === id);
      const sequence = ["pending", "active", "completed"];
      const next = sequence[(sequence.indexOf(agreement.agreement_status) + 1) % sequence.length];
      await updateRecord("agreements", id, { agreement_status: next });
      await refreshApplication();
      notify(`Agreement status updated to ${next}.`);
      return;
    }
    if (action === "cycle-dispute") {
      const dispute = state.disputes.find((item) => item.id === id);
      const sequence = ["open", "in_progress", "resolved", "closed"];
      const next = sequence[(sequence.indexOf(dispute.status) + 1) % sequence.length];
      await updateRecord("disputes", id, { status: next });
      await refreshApplication();
      notify(`Concern status updated to ${next.replace("_", " ")}.`);
    }
  } catch (error) {
    console.error("Record action failed.", error);
    notify(friendlyError(error), "error");
  }
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const content = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportShifts() {
  downloadCsv("nammawork-shifts.csv",
    ["Date", "Household", "Shift", "Start", "End", "Break minutes", "Hours", "Expected wages", "Amount received", "Balance", "Payment status", "Notes"],
    state.shifts.map((shift) => [
      shift.shift_date, householdName(shift.household_id), shift.shift_number || "", shift.start_time, shift.end_time,
      shift.break_minutes, shift.total_hours, shift.expected_wages, shift.amount_received,
      round2(Number(shift.expected_wages) - Number(shift.amount_received)), shift.payment_status, shift.notes
    ]));
}

function exportReport() {
  const grouped = new Map();
  for (const shift of state.shifts) {
    const summary = grouped.get(shift.household_id) || { hours: 0, wages: 0, received: 0 };
    summary.hours += Number(shift.total_hours);
    summary.wages += Number(shift.expected_wages);
    summary.received += Number(shift.amount_received);
    grouped.set(shift.household_id, summary);
  }
  downloadCsv("nammawork-report.csv",
    ["Household", "Total hours", "Expected wages", "Payments received", "Outstanding balance"],
    [...grouped.entries()].map(([id, summary]) => [
      householdName(id), round2(summary.hours), round2(summary.wages),
      round2(summary.received), round2(Math.max(0, summary.wages - summary.received))
    ]));
}

function exportAllRecords() {
  downloadCsv("nammawork-records.csv",
    ["Record type", "Date", "Household", "Description", "Hours", "Expected wages", "Received", "Status"],
    [
      ...(state.profile ? [["Profile", "", "", state.profile.full_name, "", "", "", ""]] : []),
      ...state.households.map((item) => [
        "Household", item.created_at?.slice(0, 10) || "", item.employer_name,
        `${item.location} · ${item.work_type} · ${item.notes || ""}`, "",
        item.hourly_rate, "", "active"
      ]),
      ...state.shifts.map((shift) => ["Shift", shift.shift_date, householdName(shift.household_id), [shift.shift_number, shift.notes].filter(Boolean).join(" / "), shift.total_hours, shift.expected_wages, shift.amount_received, shift.payment_status]),
      ...state.agreements.map((item) => ["Agreement", item.start_date, householdName(item.household_id), item.wage_terms, "", item.agreed_hourly_rate, "", item.agreement_status]),
      ...state.disputes.map((item) => ["Concern", item.date_reported, householdName(item.household_id), item.description, "", item.amount_involved ?? "", "", item.status])
    ]);
}

function applyGlobalFilter() {
  renderHouseholds();
  renderAgreements();
  renderDisputes();
  renderShifts();
}

function searchAll(query) {
  state.globalQuery = query.trim();
  $("shiftSearch").value = state.globalQuery;
  applyGlobalFilter();
  if (!state.globalQuery) return;
  const normalized = state.globalQuery.toLowerCase();
  const pages = [
    ["households", state.households, (item) => `${item.employer_name} ${item.location} ${item.work_type} ${item.notes}`],
    ["shifts", state.shifts, (item) => `${item.shift_date} ${householdName(item.household_id)} ${item.notes}`],
    ["agreements", state.agreements, (item) => `${householdName(item.household_id)} ${item.wage_terms} ${item.work_schedule} ${item.responsibilities}`],
    ["disputes", state.disputes, (item) => `${householdName(item.household_id)} ${item.concern_category} ${item.description}`]
  ];
  const match = pages.find(([, records, text]) => records.some((item) => text(item).toLowerCase().includes(normalized)));
  if (match) showPage(match[0]);
}

function toggleTheme() {
  const dark = document.body.classList.toggle("dark-theme");
  localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
}

function initializeTheme() {
  document.body.classList.toggle("dark-theme", localStorage.getItem(THEME_KEY) === "dark");
}

function openChat() {
  $("chatPanel").classList.remove("hidden");
  $("chatInput").focus();
}

function addChatMessage(text, sender) {
  const message = document.createElement("div");
  message.className = `chat-message ${sender}-message`;
  message.textContent = text;
  $("chatMessages").append(message);
  $("chatMessages").scrollTop = $("chatMessages").scrollHeight;
}

function answerChat(question) {
  const text = question.toLowerCase();
  if (text.includes("wage") || text.includes("pay")) {
    return "Expected wages are recorded hours after breaks multiplied by that household’s saved hourly rate. The report subtracts amounts you marked as received.";
  }
  if (text.includes("overtime") || text.includes("hour")) {
    return `Your weekly alert uses the threshold in My Profile (${Number(state.profile?.overtime_threshold) || 48} hours). It is a tracking reminder, not legal advice.`;
  }
  if (text.includes("dispute") || text.includes("concern")) {
    return "Open Disputes, choose Report a concern, select the household, and describe the issue. Keep sensitive details to a minimum.";
  }
  if (text.includes("agreement")) {
    return "Open Agreements to record the wage terms, schedule, and responsibilities you and the household discussed.";
  }
  return "I can explain wage calculations, overtime alerts, agreements, and how to record a concern. For urgent help, contact local emergency services or a trusted support organization.";
}

async function signOut() {
  if (state.mode === "account") {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
  await enterDemo();
  notify("You have been signed out. The demo dashboard is open.");
}

function bindEvents() {
  $("authForm").addEventListener("submit", handleAuthSubmit);
  $("authSwitch").addEventListener("click", () => {
    setAuthMode(state.authMode === "signup" ? "signin" : "signup");
    showAuthMessage("");
  });
  $("passwordReset").addEventListener("click", () => {
    sendPasswordReset().catch((error) => showAuthMessage(friendlyError(error), "error"));
  });
  $("demoAccess").addEventListener("click", () => {
    enterDemo(true).catch((error) => notify(friendlyError(error), "error"));
  });
  $("accountAccess").addEventListener("click", () => {
    setAuthMode("signin");
    showApplication(false);
    showAuthMessage("Sign in or create an account to save records securely to Supabase.");
  });
  $("profileForm").addEventListener("submit", submitProfile);
  $("householdForm").addEventListener("submit", submitHousehold);
  $("shiftForm").addEventListener("submit", submitShift);
  $("agreementForm").addEventListener("submit", submitAgreement);
  $("disputeForm").addEventListener("submit", submitDispute);
  $("shiftSearch").addEventListener("input", renderShifts);
  $("hoursPeriod").addEventListener("change", updateCharts);
  $("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
  $("themeToggle").addEventListener("click", toggleTheme);
  $("settingsThemeToggle").addEventListener("click", toggleTheme);
  $("notificationButton").addEventListener("click", () => {
    const pending = state.shifts.filter((shift) => Number(shift.expected_wages) > Number(shift.amount_received)).length;
    const concerns = state.disputes.filter((item) => !["resolved", "closed"].includes(item.status)).length;
    notify(`${pending} shift(s) with unpaid balances · ${concerns} concern(s) need attention.`, "info");
  });
  $("logoutButton").addEventListener("click", () => {
    signOut().catch((error) => notify(friendlyError(error), "error"));
  });
  $("settingsExport").addEventListener("click", exportAllRecords);
  $("exportShifts").addEventListener("click", exportShifts);
  $("exportReport").addEventListener("click", exportReport);
  $("printReport").addEventListener("click", () => window.print());
  $("resetData").addEventListener("click", async () => {
    if (!window.confirm("Remove all demo records stored in this browser?")) return;
    localStorage.removeItem(DEMO_KEY);
    await enterDemo();
    notify("Demo data reset.");
  });
  $("globalSearch").addEventListener("input", (event) => searchAll(event.target.value));
  $("chatLauncher").addEventListener("click", openChat);
  $("chatClose").addEventListener("click", () => $("chatPanel").classList.add("hidden"));
  $("chatForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const question = $("chatInput").value.trim();
    if (!question) return;
    addChatMessage(question, "user");
    addChatMessage(answerChat(question), "bot");
    $("chatInput").value = "";
  });
  $("chatPanel").addEventListener("click", (event) => {
    const button = event.target.closest("[data-chat-prompt]");
    if (!button) return;
    $("chatInput").value = button.dataset.chatPrompt;
    $("chatForm").requestSubmit();
  });
  document.addEventListener("click", (event) => {
    const pageButton = event.target.closest("[data-page]");
    if (pageButton) showPage(pageButton.dataset.page);
    const openButton = event.target.closest("[data-open-modal]");
    if (openButton) openModal(openButton.dataset.openModal);
    const closeButton = event.target.closest("[data-close-modal]");
    if (closeButton) closeModal(closeButton.closest("dialog"));
    const actionButton = event.target.closest("[data-action]");
    if (actionButton) handleRecordAction(actionButton);
  });
  document.querySelectorAll("dialog.app-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
      if (event.target === modal) closeModal(modal);
    });
    modal.addEventListener("close", () => {
      modal.querySelector("form")?.reset();
      state.editing = null;
      restoreModalHeading(modal);
    });
  });
  if (supabase) {
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setAuthMode("recovery");
        showApplication(false);
      } else if (event === "SIGNED_OUT") {
        enterDemo().catch((error) => notify(friendlyError(error), "error"));
      }
    });
  }
}

async function initialize() {
  bindEvents();
  initializeTheme();
  setAuthMode("signin");
  if (!supabase) {
    await enterDemo();
    return;
  }
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session) {
      await enterAccount(data.session);
    } else {
      await enterDemo();
    }
  } catch (error) {
    console.error("Could not restore the Supabase session.", error);
    await enterDemo();
    notify(friendlyError(error), "error");
  }
}

initialize().catch((error) => {
  console.error("NammaWork could not initialize.", error);
  showApplication(false);
  showAuthMessage(friendlyError(error), "error");
  notify(friendlyError(error), "error");
});
