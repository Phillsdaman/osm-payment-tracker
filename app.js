// OSM Payment Tracker — single-file app
// Firebase v10 modular SDK via CDN

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
  writeBatch,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ───────── Firebase config ─────────
const firebaseConfig = {
  apiKey: "AIzaSyAMtnvnUndP4Et3eh4Sa5Ncoubj1znXb7M",
  authDomain: "osm-tracker-dea30.firebaseapp.com",
  projectId: "osm-tracker-dea30",
  storageBucket: "osm-tracker-dea30.firebasestorage.app",
  messagingSenderId: "795104182335",
  appId: "1:795104182335:web:6a2094cdc9cfdb834d788a",
};

// Allowlist — only these emails can read/write. Mirror this in Firestore rules.
const ALLOWED_EMAILS = [
  "philip.owens@hotmail.co.uk",
  "j.jade.owens@gmail.com",
];

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// ───────── State ─────────
const state = {
  user: null,
  members: [],
  activities: [],
  payments: [],
  currentTab: "dashboard",
  unsubs: [],
};

// ───────── Helpers ─────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmtMoney = (n) => "£" + (Number(n) || 0).toFixed(2);
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const todayISO = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function toast(msg, kind = "info") {
  const t = $("#toast");
  t.textContent = msg;
  t.className =
    "fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-sm z-30 " +
    (kind === "error" ? "bg-red-600 text-white" : kind === "success" ? "bg-emerald-600 text-white" : "bg-slate-900 text-white");
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2400);
}

function openModal(title, bodyHTML) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHTML;
  $("#modal").classList.remove("hidden");
}
function closeModal() {
  $("#modal").classList.add("hidden");
  $("#modal-body").innerHTML = "";
}
$("#modal-close").addEventListener("click", closeModal);
$("#modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") closeModal();
});

// ───────── Auth ─────────
$("#signin-btn").addEventListener("click", async () => {
  $("#login-error").classList.add("hidden");
  try {
    const res = await signInWithPopup(auth, provider);
    const email = (res.user.email || "").toLowerCase();
    if (!ALLOWED_EMAILS.map((e) => e.toLowerCase()).includes(email)) {
      await signOut(auth);
      $("#login-error").textContent = `${email} is not authorised. Ask Philip to add you.`;
      $("#login-error").classList.remove("hidden");
    }
  } catch (err) {
    $("#login-error").textContent = err.message || "Sign-in failed";
    $("#login-error").classList.remove("hidden");
  }
});

$("#signout-btn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  // Tear down any existing listeners
  state.unsubs.forEach((u) => u());
  state.unsubs = [];

  const email = (user?.email || "").toLowerCase();
  if (user && ALLOWED_EMAILS.map((e) => e.toLowerCase()).includes(email)) {
    state.user = user;
    $("#login-view").classList.add("hidden");
    $("#app-view").classList.remove("hidden");
    $("#user-email").textContent = user.email;
    initSubscriptions();
    seedIfEmpty();
    showTab("dashboard");
  } else {
    state.user = null;
    $("#app-view").classList.add("hidden");
    $("#login-view").classList.remove("hidden");
  }
});

// ───────── Firestore subscriptions ─────────
function initSubscriptions() {
  const colMembers = collection(db, "members");
  const colActivities = collection(db, "activities");
  const colPayments = collection(db, "payments");

  state.unsubs.push(
    onSnapshot(query(colMembers, orderBy("name")), (snap) => {
      state.members = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    })
  );
  state.unsubs.push(
    onSnapshot(query(colActivities, orderBy("startDate")), (snap) => {
      state.activities = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    })
  );
  state.unsubs.push(
    onSnapshot(colPayments, (snap) => {
      state.payments = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    })
  );
}

// ───────── Seed default members on first run ─────────
async function seedIfEmpty() {
  const snap = await getDocs(collection(db, "members"));
  if (!snap.empty) return;
  const seed = [
    { name: "Philip Owens", role: "leader", email: "philip.owens@hotmail.co.uk", trackPayments: false },
    { name: "Jade Owens", role: "leader", email: "j.jade.owens@gmail.com", trackPayments: false },
    { name: "Leo Owens", role: "child", trackPayments: true },
    { name: "Max Owens", role: "child", trackPayments: true },
    { name: "Lisa Clarke", role: "child", trackPayments: true },
    { name: "Aaron Clarke", role: "child", trackPayments: false },
  ];
  const batch = writeBatch(db);
  seed.forEach((m) => {
    const ref = doc(collection(db, "members"));
    batch.set(ref, { ...m, createdAt: serverTimestamp() });
  });
  await batch.commit();
  toast("Welcome! Family members added.", "success");
}

// ───────── Tab switching ─────────
function showTab(name) {
  state.currentTab = name;
  $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${name}`).classList.remove("hidden");
  $$(".tab-btn").forEach((b) => {
    b.classList.toggle("bg-slate-900", b.dataset.tab === name);
    b.classList.toggle("text-white", b.dataset.tab === name);
  });
  renderAll();
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (btn) showTab(btn.dataset.tab);
});

// ───────── Render: Dashboard ─────────
function renderDashboard() {
  const upcoming = state.activities
    .filter((a) => a.startDate && a.startDate >= todayISO())
    .slice(0, 5);
  const outstanding = state.payments.filter((p) => p.status !== "paid");
  const overdue = outstanding.filter((p) => p.dueDate && p.dueDate < todayISO());
  const totalOutstanding = outstanding.reduce((s, p) => s + (Number(p.amountDue) || 0) - (Number(p.amountPaid) || 0), 0);
  const totalPaidYTD = state.payments
    .filter((p) => p.paidDate && new Date(p.paidDate).getFullYear() === new Date().getFullYear())
    .reduce((s, p) => s + (Number(p.amountPaid) || 0), 0);

  $("#stat-outstanding").textContent = fmtMoney(totalOutstanding);
  $("#stat-paid").textContent = fmtMoney(totalPaidYTD);
  $("#stat-upcoming").textContent = state.activities.filter((a) => a.startDate && a.startDate >= todayISO()).length;
  $("#stat-overdue").textContent = overdue.length;

  $("#dashboard-upcoming").innerHTML = upcoming.length
    ? upcoming
        .map((a) => {
          const names = (a.attendeeIds || []).map((id) => state.members.find((m) => m.id === id)?.name).filter(Boolean);
          return `<div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
          <div>
            <div class="font-medium">${escapeHtml(a.name)}</div>
            <div class="text-xs text-slate-500">${fmtDate(a.startDate)}${a.endDate && a.endDate !== a.startDate ? " – " + fmtDate(a.endDate) : ""}${a.location ? " · " + escapeHtml(a.location) : ""}</div>
            <div class="text-xs text-slate-500">${names.length ? "Going: " + names.map(escapeHtml).join(", ") : '<span class="italic text-slate-400">No attendees yet</span>'}</div>
          </div>
        </div>`;
        })
        .join("")
    : '<div class="text-slate-400 italic text-sm">No upcoming activities.</div>';

  $("#dashboard-outstanding").innerHTML = outstanding.length
    ? outstanding
        .slice(0, 6)
        .map((p) => {
          const m = state.members.find((x) => x.id === p.memberId);
          const a = state.activities.find((x) => x.id === p.activityId);
          const left = (Number(p.amountDue) || 0) - (Number(p.amountPaid) || 0);
          const isOverdue = p.dueDate && p.dueDate < todayISO();
          return `<div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
          <div>
            <div class="font-medium">${escapeHtml(m?.name || "?")} <span class="text-slate-400">·</span> ${escapeHtml(a?.name || "?")}</div>
            <div class="text-xs ${isOverdue ? "text-red-600" : "text-slate-500"}">Due ${fmtDate(p.dueDate)}${isOverdue ? " (overdue)" : ""}</div>
          </div>
          <div class="text-right font-semibold">${fmtMoney(left)}</div>
        </div>`;
        })
        .join("")
    : '<div class="text-slate-400 italic text-sm">All caught up. 🎉</div>';
}

// ───────── Render: Activities ─────────
function renderActivities() {
  const list = $("#activities-list");
  if (!state.activities.length) {
    list.innerHTML = '<div class="bg-white rounded-xl p-8 text-center text-slate-400 italic border border-slate-200">No activities yet. Click "+ New activity" to add one.</div>';
    return;
  }
  list.innerHTML = state.activities
    .slice()
    .sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""))
    .map((a) => {
      const attendees = (a.attendeeIds || []).map((id) => state.members.find((m) => m.id === id)?.name).filter(Boolean);
      const isPast = a.endDate ? a.endDate < todayISO() : a.startDate < todayISO();
      return `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 ${isPast ? "opacity-60" : ""}">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-semibold">${escapeHtml(a.name)}</h3>
              ${isPast ? '<span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Past</span>' : ""}
              ${a.cost ? `<span class="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">${fmtMoney(a.cost)} pp</span>` : ""}
            </div>
            <div class="text-sm text-slate-500 mt-1">${fmtDate(a.startDate)}${a.endDate && a.endDate !== a.startDate ? " – " + fmtDate(a.endDate) : ""}${a.location ? " · " + escapeHtml(a.location) : ""}</div>
            ${attendees.length ? `<div class="text-sm mt-2"><span class="text-slate-500">Attending:</span> ${attendees.map(escapeHtml).join(", ")}</div>` : '<div class="text-sm mt-2 italic text-slate-400">No attendees set</div>'}
            ${a.notes ? `<div class="text-sm mt-2 text-slate-600 whitespace-pre-wrap">${escapeHtml(a.notes)}</div>` : ""}
          </div>
          <div class="flex gap-1 shrink-0">
            <button data-edit-activity="${a.id}" class="text-xs border border-slate-300 hover:bg-slate-100 px-2 py-1 rounded-lg">Edit</button>
            <button data-delete-activity="${a.id}" class="text-xs border border-red-200 text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg">Delete</button>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

// ───────── Render: Payments ─────────
function renderPayments() {
  // populate member filter
  const memberFilter = $("#payment-filter-member");
  const currentVal = memberFilter.value;
  memberFilter.innerHTML =
    '<option value="">All members</option>' +
    state.members.filter((m) => m.trackPayments).map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  memberFilter.value = currentVal;

  const statusFilter = $("#payment-filter-status").value;
  const memberSel = memberFilter.value;
  const tbody = $("#payments-tbody");
  let rows = state.payments.slice();
  if (statusFilter) rows = rows.filter((p) => p.status === statusFilter);
  if (memberSel) rows = rows.filter((p) => p.memberId === memberSel);
  rows.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-slate-400 italic">No payments match.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((p) => {
      const m = state.members.find((x) => x.id === p.memberId);
      const a = state.activities.find((x) => x.id === p.activityId);
      const isOverdue = p.dueDate && p.dueDate < todayISO() && p.status !== "paid";
      const statusPill =
        p.status === "paid"
          ? '<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700">Paid</span>'
          : p.status === "partial"
          ? '<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">Partial</span>'
          : isOverdue
          ? '<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">Overdue</span>'
          : '<span class="inline-block px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700">Unpaid</span>';
      return `<tr class="border-t border-slate-100 hover:bg-slate-50">
        <td class="px-3 py-2">${escapeHtml(m?.name || "?")}</td>
        <td class="px-3 py-2">${escapeHtml(a?.name || "?")}</td>
        <td class="px-3 py-2 text-right">${fmtMoney(p.amountDue)}</td>
        <td class="px-3 py-2 text-right">${fmtMoney(p.amountPaid)}</td>
        <td class="px-3 py-2 ${isOverdue ? "text-red-600" : ""}">${fmtDate(p.dueDate)}</td>
        <td class="px-3 py-2">${statusPill}</td>
        <td class="px-3 py-2 text-right whitespace-nowrap">
          <button data-edit-payment="${p.id}" class="text-xs border border-slate-300 hover:bg-slate-100 px-2 py-1 rounded-lg">Edit</button>
          <button data-delete-payment="${p.id}" class="text-xs border border-red-200 text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg">×</button>
        </td>
      </tr>`;
    })
    .join("");
}
$("#payment-filter-status").addEventListener("change", renderPayments);
$("#payment-filter-member").addEventListener("change", renderPayments);

// ───────── Render: Members ─────────
function renderMembers() {
  const list = $("#members-list");
  if (!state.members.length) {
    list.innerHTML = '<div class="col-span-2 bg-white rounded-xl p-8 text-center text-slate-400 italic border border-slate-200">No members yet.</div>';
    return;
  }
  list.innerHTML = state.members
    .map((m) => {
      const paymentCount = state.payments.filter((p) => p.memberId === m.id).length;
      const activityCount = state.activities.filter((a) => (a.attendeeIds || []).includes(m.id)).length;
      return `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="flex items-center gap-2">
            <h3 class="font-semibold">${escapeHtml(m.name)}</h3>
            <span class="text-xs px-2 py-0.5 rounded-full ${m.role === "leader" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}">${m.role || "child"}</span>
            ${m.trackPayments ? '<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Payments</span>' : ""}
          </div>
          ${m.email ? `<div class="text-xs text-slate-500 mt-1">${escapeHtml(m.email)}</div>` : ""}
          <div class="text-xs text-slate-500 mt-1">${activityCount} activities · ${paymentCount} payments</div>
        </div>
        <div class="flex gap-1 shrink-0">
          <button data-edit-member="${m.id}" class="text-xs border border-slate-300 hover:bg-slate-100 px-2 py-1 rounded-lg">Edit</button>
          <button data-delete-member="${m.id}" class="text-xs border border-red-200 text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg">×</button>
        </div>
      </div>
    </div>`;
    })
    .join("");
}

function renderAll() {
  if (!state.user) return;
  renderDashboard();
  renderActivities();
  renderPayments();
  renderMembers();
}

// ───────── Forms ─────────
function memberForm(existing = {}) {
  const m = existing;
  return `
    <form id="member-form" class="space-y-3">
      <label class="block">
        <span class="text-sm font-medium">Name</span>
        <input name="name" required value="${escapeHtml(m.name || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
      </label>
      <label class="block">
        <span class="text-sm font-medium">Role</span>
        <select name="role" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
          <option value="child" ${m.role === "child" ? "selected" : ""}>Child</option>
          <option value="leader" ${m.role === "leader" ? "selected" : ""}>Leader</option>
        </select>
      </label>
      <label class="block">
        <span class="text-sm font-medium">Email <span class="text-slate-400 font-normal">(optional)</span></span>
        <input name="email" type="email" value="${escapeHtml(m.email || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
      </label>
      <label class="flex items-center gap-2">
        <input name="trackPayments" type="checkbox" ${m.trackPayments ? "checked" : ""} class="rounded" />
        <span class="text-sm">Track payments for this member</span>
      </label>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="form-cancel" class="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm">Cancel</button>
        <button type="submit" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">Save</button>
      </div>
    </form>`;
}

function activityForm(existing = {}) {
  const a = existing;
  const attendeeIds = a.attendeeIds || [];
  const memberCheckboxes = state.members
    .map(
      (m) => `<label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-slate-50">
      <input type="checkbox" name="attendee" value="${m.id}" ${attendeeIds.includes(m.id) ? "checked" : ""} class="rounded" />
      <span class="text-sm">${escapeHtml(m.name)} <span class="text-xs text-slate-400">(${m.role})</span></span>
    </label>`
    )
    .join("");
  return `
    <form id="activity-form" class="space-y-3">
      <label class="block">
        <span class="text-sm font-medium">Activity / camp name</span>
        <input name="name" required value="${escapeHtml(a.name || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" placeholder="e.g. Summer Camp 2026" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Start date</span>
          <input name="startDate" type="date" required value="${a.startDate || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">End date</span>
          <input name="endDate" type="date" value="${a.endDate || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
      </div>
      <label class="block">
        <span class="text-sm font-medium">Location</span>
        <input name="location" value="${escapeHtml(a.location || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
      </label>
      <label class="block">
        <span class="text-sm font-medium">Cost per person (£)</span>
        <input name="cost" type="number" step="0.01" min="0" value="${a.cost ?? ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
      </label>
      <div>
        <span class="text-sm font-medium">Attendees</span>
        <div class="mt-1 border border-slate-300 rounded-lg p-2 max-h-40 overflow-y-auto">${memberCheckboxes || '<span class="text-sm text-slate-400 italic">No members yet</span>'}</div>
      </div>
      <label class="flex items-center gap-2">
        <input name="autoCreatePayments" type="checkbox" ${existing.id ? "" : "checked"} class="rounded" />
        <span class="text-sm">Auto-create payment entries for attendees with payment tracking</span>
      </label>
      <label class="block">
        <span class="text-sm font-medium">Notes</span>
        <textarea name="notes" rows="3" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">${escapeHtml(a.notes || "")}</textarea>
      </label>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="form-cancel" class="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm">Cancel</button>
        <button type="submit" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">Save</button>
      </div>
    </form>`;
}

function paymentForm(existing = {}) {
  const p = existing;
  const memberOpts = state.members
    .filter((m) => m.trackPayments)
    .map((m) => `<option value="${m.id}" ${p.memberId === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");
  const activityOpts = state.activities
    .map((a) => `<option value="${a.id}" ${p.activityId === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`)
    .join("");
  return `
    <form id="payment-form" class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Member</span>
          <select name="memberId" required class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">— select —</option>${memberOpts}
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Activity</span>
          <select name="activityId" required class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">— select —</option>${activityOpts}
          </select>
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Amount due (£)</span>
          <input name="amountDue" type="number" step="0.01" min="0" required value="${p.amountDue ?? ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">Amount paid (£)</span>
          <input name="amountPaid" type="number" step="0.01" min="0" value="${p.amountPaid ?? 0}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Due date</span>
          <input name="dueDate" type="date" value="${p.dueDate || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">Paid date</span>
          <input name="paidDate" type="date" value="${p.paidDate || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Paid by</span>
          <select name="paidBy" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">—</option>
            <option value="Philip" ${p.paidBy === "Philip" ? "selected" : ""}>Philip</option>
            <option value="Jade" ${p.paidBy === "Jade" ? "selected" : ""}>Jade</option>
            <option value="Other" ${p.paidBy === "Other" ? "selected" : ""}>Other</option>
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Method</span>
          <select name="method" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">—</option>
            <option ${p.method === "OSM" ? "selected" : ""}>OSM</option>
            <option ${p.method === "Bank transfer" ? "selected" : ""}>Bank transfer</option>
            <option ${p.method === "Cash" ? "selected" : ""}>Cash</option>
            <option ${p.method === "Card" ? "selected" : ""}>Card</option>
            <option ${p.method === "Other" ? "selected" : ""}>Other</option>
          </select>
        </label>
      </div>
      <label class="block">
        <span class="text-sm font-medium">OSM reference / notes</span>
        <input name="reference" value="${escapeHtml(p.reference || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
      </label>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="form-cancel" class="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm">Cancel</button>
        <button type="submit" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">Save</button>
      </div>
    </form>`;
}

function computeStatus(amountDue, amountPaid) {
  const due = Number(amountDue) || 0;
  const paid = Number(amountPaid) || 0;
  if (paid <= 0) return "unpaid";
  if (paid >= due) return "paid";
  return "partial";
}

// ───────── Member CRUD ─────────
$("#add-member-btn").addEventListener("click", () => {
  openModal("New member", memberForm({ trackPayments: true, role: "child" }));
  attachMemberFormHandlers();
});

function attachMemberFormHandlers(id = null) {
  $("#form-cancel").addEventListener("click", closeModal);
  $("#member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      name: fd.get("name").trim(),
      role: fd.get("role"),
      email: fd.get("email").trim() || null,
      trackPayments: fd.get("trackPayments") === "on",
      updatedAt: serverTimestamp(),
    };
    try {
      if (id) {
        await updateDoc(doc(db, "members", id), data);
      } else {
        await addDoc(collection(db, "members"), { ...data, createdAt: serverTimestamp() });
      }
      closeModal();
      toast("Member saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

document.addEventListener("click", async (e) => {
  const editM = e.target.closest("[data-edit-member]");
  if (editM) {
    const id = editM.dataset.editMember;
    const m = state.members.find((x) => x.id === id);
    openModal("Edit member", memberForm(m));
    attachMemberFormHandlers(id);
    return;
  }
  const delM = e.target.closest("[data-delete-member]");
  if (delM) {
    const id = delM.dataset.deleteMember;
    const m = state.members.find((x) => x.id === id);
    if (!confirm(`Delete ${m?.name}? This won't remove their existing payments/activities.`)) return;
    await deleteDoc(doc(db, "members", id));
    toast("Member deleted");
    return;
  }
});

// ───────── Activity CRUD ─────────
$("#add-activity-btn").addEventListener("click", () => {
  openModal("New activity", activityForm({}));
  attachActivityFormHandlers();
});

function attachActivityFormHandlers(id = null) {
  $("#form-cancel").addEventListener("click", closeModal);
  $("#activity-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const attendeeIds = Array.from(form.querySelectorAll('input[name="attendee"]:checked')).map((i) => i.value);
    const cost = fd.get("cost") === "" ? null : Number(fd.get("cost"));
    const data = {
      name: fd.get("name").trim(),
      startDate: fd.get("startDate"),
      endDate: fd.get("endDate") || fd.get("startDate"),
      location: fd.get("location").trim() || null,
      cost,
      attendeeIds,
      notes: fd.get("notes").trim() || null,
      updatedAt: serverTimestamp(),
    };
    const autoCreate = fd.get("autoCreatePayments") === "on";
    try {
      let activityId = id;
      if (id) {
        await updateDoc(doc(db, "activities", id), data);
      } else {
        const ref = await addDoc(collection(db, "activities"), { ...data, createdAt: serverTimestamp() });
        activityId = ref.id;
      }
      // Auto-create payment entries for paying attendees that don't have one yet
      if (autoCreate && cost && cost > 0) {
        const existingForActivity = new Set(
          state.payments.filter((p) => p.activityId === activityId).map((p) => p.memberId)
        );
        const toCreate = attendeeIds
          .map((mid) => state.members.find((m) => m.id === mid))
          .filter((m) => m && m.trackPayments && !existingForActivity.has(m.id));
        if (toCreate.length) {
          const batch = writeBatch(db);
          toCreate.forEach((m) => {
            const ref = doc(collection(db, "payments"));
            batch.set(ref, {
              memberId: m.id,
              activityId,
              amountDue: cost,
              amountPaid: 0,
              status: "unpaid",
              dueDate: data.startDate,
              createdAt: serverTimestamp(),
            });
          });
          await batch.commit();
        }
      }
      closeModal();
      toast("Activity saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

document.addEventListener("click", async (e) => {
  const editA = e.target.closest("[data-edit-activity]");
  if (editA) {
    const id = editA.dataset.editActivity;
    const a = state.activities.find((x) => x.id === id);
    openModal("Edit activity", activityForm(a));
    attachActivityFormHandlers(id);
    return;
  }
  const delA = e.target.closest("[data-delete-activity]");
  if (delA) {
    const id = delA.dataset.deleteActivity;
    const a = state.activities.find((x) => x.id === id);
    const linkedPayments = state.payments.filter((p) => p.activityId === id);
    const msg = linkedPayments.length
      ? `Delete "${a?.name}" and its ${linkedPayments.length} linked payment(s)?`
      : `Delete "${a?.name}"?`;
    if (!confirm(msg)) return;
    const batch = writeBatch(db);
    linkedPayments.forEach((p) => batch.delete(doc(db, "payments", p.id)));
    batch.delete(doc(db, "activities", id));
    await batch.commit();
    toast("Activity deleted");
    return;
  }
});

// ───────── Payment CRUD ─────────
$("#add-payment-btn").addEventListener("click", () => {
  if (!state.members.filter((m) => m.trackPayments).length) {
    toast("Add a payment-tracked member first", "error");
    return;
  }
  if (!state.activities.length) {
    toast("Add an activity first", "error");
    return;
  }
  openModal("New payment", paymentForm({}));
  attachPaymentFormHandlers();
});

function attachPaymentFormHandlers(id = null) {
  $("#form-cancel").addEventListener("click", closeModal);
  $("#payment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const amountDue = Number(fd.get("amountDue")) || 0;
    const amountPaid = Number(fd.get("amountPaid")) || 0;
    const data = {
      memberId: fd.get("memberId"),
      activityId: fd.get("activityId"),
      amountDue,
      amountPaid,
      status: computeStatus(amountDue, amountPaid),
      dueDate: fd.get("dueDate") || null,
      paidDate: fd.get("paidDate") || null,
      paidBy: fd.get("paidBy") || null,
      method: fd.get("method") || null,
      reference: fd.get("reference").trim() || null,
      updatedAt: serverTimestamp(),
    };
    try {
      if (id) {
        await updateDoc(doc(db, "payments", id), data);
      } else {
        await addDoc(collection(db, "payments"), { ...data, createdAt: serverTimestamp() });
      }
      closeModal();
      toast("Payment saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

document.addEventListener("click", async (e) => {
  const editP = e.target.closest("[data-edit-payment]");
  if (editP) {
    const id = editP.dataset.editPayment;
    const p = state.payments.find((x) => x.id === id);
    openModal("Edit payment", paymentForm(p));
    attachPaymentFormHandlers(id);
    return;
  }
  const delP = e.target.closest("[data-delete-payment]");
  if (delP) {
    const id = delP.dataset.deletePayment;
    if (!confirm("Delete this payment?")) return;
    await deleteDoc(doc(db, "payments", id));
    toast("Payment deleted");
    return;
  }
});

// ───────── Export / Import ─────────
$("#export-btn").addEventListener("click", () => {
  const data = {
    exportedAt: new Date().toISOString(),
    members: state.members,
    activities: state.activities,
    payments: state.payments,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `osm-tracker-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$("#import-btn").addEventListener("click", () => $("#import-file").click());
$("#import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm("Import will ADD to existing data (it won't replace). Continue?")) {
    e.target.value = "";
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const batch = writeBatch(db);
    (data.members || []).forEach((m) => {
      const { id, ...rest } = m;
      batch.set(doc(collection(db, "members")), { ...rest, importedAt: serverTimestamp() });
    });
    (data.activities || []).forEach((a) => {
      const { id, ...rest } = a;
      batch.set(doc(collection(db, "activities")), { ...rest, importedAt: serverTimestamp() });
    });
    (data.payments || []).forEach((p) => {
      const { id, ...rest } = p;
      batch.set(doc(collection(db, "payments")), { ...rest, importedAt: serverTimestamp() });
    });
    await batch.commit();
    toast("Import complete", "success");
  } catch (err) {
    toast("Import failed: " + err.message, "error");
  }
  e.target.value = "";
});
