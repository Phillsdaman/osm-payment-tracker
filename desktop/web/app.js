// Front-end for OSM Payment Tracker (talks to local Python API)

const API = "/api";

const state = {
  members: [],
  activities: [],
  payments: [],
  currentTab: "dashboard",
};

// ───── helpers ─────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const fmtMoney = (n) => "£" + (Number(n) || 0).toFixed(2);
const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d)) return s;
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

async function apiFetch(path, opts = {}) {
  const res = await fetch(API + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg;
    try {
      msg = (await res.json()).error;
    } catch {
      msg = res.statusText;
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

// ───── modal ─────
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
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

// ───── tabs ─────
function showTab(name) {
  state.currentTab = name;
  $$(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${name}`).classList.remove("hidden");
  $$(".tab-btn").forEach((b) => {
    b.classList.toggle("bg-slate-900", b.dataset.tab === name);
    b.classList.toggle("text-white", b.dataset.tab === name);
  });
  if (name === "settings") loadSettingsForm();
  renderAll();
}
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (btn) showTab(btn.dataset.tab);
});

// ───── data refresh ─────
async function refreshAll() {
  try {
    const [members, activities, payments] = await Promise.all([
      apiFetch("/members"),
      apiFetch("/activities"),
      apiFetch("/payments"),
    ]);
    state.members = members;
    state.activities = activities;
    state.payments = payments;
    renderAll();
  } catch (e) {
    toast("Failed to load data: " + e.message, "error");
  }
}

// ───── dashboard ─────
function renderDashboard() {
  const upcoming = state.activities.filter((a) => a.start_date && a.start_date >= todayISO()).slice(0, 5);
  const outstanding = state.payments.filter((p) => p.status !== "paid");
  const overdue = outstanding.filter((p) => p.due_date && p.due_date < todayISO());
  const totalOutstanding = outstanding.reduce((s, p) => s + (Number(p.amount_due) || 0) - (Number(p.amount_paid) || 0), 0);
  const yr = new Date().getFullYear();
  const totalPaidYTD = state.payments
    .filter((p) => p.paid_date && new Date(p.paid_date).getFullYear() === yr)
    .reduce((s, p) => s + (Number(p.amount_paid) || 0), 0);

  $("#stat-outstanding").textContent = fmtMoney(totalOutstanding);
  $("#stat-paid").textContent = fmtMoney(totalPaidYTD);
  $("#stat-upcoming").textContent = state.activities.filter((a) => a.start_date && a.start_date >= todayISO()).length;
  $("#stat-overdue").textContent = overdue.length;

  $("#dashboard-upcoming").innerHTML = upcoming.length
    ? upcoming
        .map((a) => {
          const names = (a.attendee_ids || []).map((id) => state.members.find((m) => m.id === id)?.name).filter(Boolean);
          return `<div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
            <div>
              <div class="font-medium">${escapeHtml(a.name)}</div>
              <div class="text-xs text-slate-500">${fmtDate(a.start_date)}${a.end_date && a.end_date !== a.start_date ? " – " + fmtDate(a.end_date) : ""}${a.location ? " · " + escapeHtml(a.location) : ""}</div>
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
          const m = state.members.find((x) => x.id === p.member_id);
          const a = state.activities.find((x) => x.id === p.activity_id);
          const left = (Number(p.amount_due) || 0) - (Number(p.amount_paid) || 0);
          const isOverdue = p.due_date && p.due_date < todayISO();
          return `<div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-2 last:border-0">
            <div>
              <div class="font-medium">${escapeHtml(m?.name || "?")} <span class="text-slate-400">·</span> ${escapeHtml(a?.name || "Ad-hoc")}</div>
              <div class="text-xs ${isOverdue ? "text-red-600" : "text-slate-500"}">Due ${fmtDate(p.due_date)}${isOverdue ? " (overdue)" : ""}</div>
            </div>
            <div class="text-right font-semibold">${fmtMoney(left)}</div>
          </div>`;
        })
        .join("")
    : '<div class="text-slate-400 italic text-sm">All caught up. 🎉</div>';
}

// ───── activities ─────
function renderActivities() {
  const list = $("#activities-list");
  if (!state.activities.length) {
    list.innerHTML = '<div class="bg-white rounded-xl p-8 text-center text-slate-400 italic border border-slate-200">No activities yet. Click "+ New activity" to add one.</div>';
    return;
  }
  list.innerHTML = state.activities
    .slice()
    .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""))
    .map((a) => {
      const attendees = (a.attendee_ids || []).map((id) => state.members.find((m) => m.id === id)?.name).filter(Boolean);
      const isPast = a.end_date ? a.end_date < todayISO() : a.start_date && a.start_date < todayISO();
      return `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4 ${isPast ? "opacity-60" : ""}">
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-semibold">${escapeHtml(a.name)}</h3>
              ${isPast ? '<span class="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">Past</span>' : ""}
              ${a.cost ? `<span class="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">${fmtMoney(a.cost)} pp</span>` : ""}
              ${a.source === "osm" ? '<span class="text-xs bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">🔗 OSM</span>' : ""}
            </div>
            <div class="text-sm text-slate-500 mt-1">${fmtDate(a.start_date)}${a.end_date && a.end_date !== a.start_date ? " – " + fmtDate(a.end_date) : ""}${a.location ? " · " + escapeHtml(a.location) : ""}</div>
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

// ───── payments ─────
function renderPayments() {
  const memberFilter = $("#payment-filter-member");
  const currentVal = memberFilter.value;
  memberFilter.innerHTML =
    '<option value="">All members</option>' +
    state.members.filter((m) => m.track_payments).map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("");
  memberFilter.value = currentVal;

  const statusFilter = $("#payment-filter-status").value;
  const memberSel = memberFilter.value;
  const tbody = $("#payments-tbody");
  let rows = state.payments.slice();
  if (statusFilter) rows = rows.filter((p) => p.status === statusFilter);
  if (memberSel) rows = rows.filter((p) => p.member_id === memberSel);
  rows.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="px-3 py-8 text-center text-slate-400 italic">No payments match.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((p) => {
      const m = state.members.find((x) => x.id === p.member_id);
      const a = state.activities.find((x) => x.id === p.activity_id);
      const isOverdue = p.due_date && p.due_date < todayISO() && p.status !== "paid";
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
        <td class="px-3 py-2">${escapeHtml(a?.name || "Ad-hoc")}${p.source === "osm" ? ' <span class="text-xs text-emerald-600">🔗</span>' : ""}</td>
        <td class="px-3 py-2 text-right">${fmtMoney(p.amount_due)}</td>
        <td class="px-3 py-2 text-right">${fmtMoney(p.amount_paid)}</td>
        <td class="px-3 py-2 ${isOverdue ? "text-red-600" : ""}">${fmtDate(p.due_date)}</td>
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

// ───── members ─────
function renderMembers() {
  const list = $("#members-list");
  if (!state.members.length) {
    list.innerHTML = '<div class="col-span-2 bg-white rounded-xl p-8 text-center text-slate-400 italic border border-slate-200">No members yet.</div>';
    return;
  }
  list.innerHTML = state.members
    .map((m) => {
      const paymentCount = state.payments.filter((p) => p.member_id === m.id).length;
      const activityCount = state.activities.filter((a) => (a.attendee_ids || []).includes(m.id)).length;
      return `<div class="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-semibold">${escapeHtml(m.name)}</h3>
              <span class="text-xs px-2 py-0.5 rounded-full ${m.role === "leader" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"}">${m.role || "child"}</span>
              ${m.track_payments ? '<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Payments</span>' : ""}
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
  renderDashboard();
  renderActivities();
  renderPayments();
  renderMembers();
}

// ───── forms ─────
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
        <input name="track_payments" type="checkbox" ${m.track_payments ? "checked" : ""} class="rounded" />
        <span class="text-sm">Track payments for this member</span>
      </label>
      <fieldset class="border border-slate-200 rounded-lg p-3 space-y-2">
        <legend class="text-xs font-semibold text-slate-500 px-1">OSM sync (optional)</legend>
        <p class="text-xs text-slate-500">Set both to pull this child's payments from OSM. Find them in the URL of the OSM payment page, e.g. <span class="font-mono">section_id=59827&amp;member_id=2058960</span>.</p>
        <div class="grid grid-cols-2 gap-2">
          <label class="block">
            <span class="text-xs font-medium">OSM Section ID</span>
            <input name="osm_section_id" value="${escapeHtml(m.osm_section_id || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm" placeholder="e.g. 59827" />
          </label>
          <label class="block">
            <span class="text-xs font-medium">OSM Member ID</span>
            <input name="osm_member_id" value="${escapeHtml(m.osm_member_id || "")}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 font-mono text-sm" placeholder="e.g. 2058960" />
          </label>
        </div>
      </fieldset>
      <div class="flex justify-end gap-2 pt-2">
        <button type="button" id="form-cancel" class="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm">Cancel</button>
        <button type="submit" class="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">Save</button>
      </div>
    </form>`;
}

function activityForm(existing = {}) {
  const a = existing;
  const attendeeIds = a.attendee_ids || [];
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
          <input name="start_date" type="date" required value="${a.start_date || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">End date</span>
          <input name="end_date" type="date" value="${a.end_date || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
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
        <input name="auto_create_payments" type="checkbox" ${existing.id ? "" : "checked"} class="rounded" />
        <span class="text-sm">Auto-create payment entries for paying attendees</span>
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
    .filter((m) => m.track_payments)
    .map((m) => `<option value="${m.id}" ${p.member_id === m.id ? "selected" : ""}>${escapeHtml(m.name)}</option>`)
    .join("");
  const activityOpts = state.activities
    .map((a) => `<option value="${a.id}" ${p.activity_id === a.id ? "selected" : ""}>${escapeHtml(a.name)}</option>`)
    .join("");
  return `
    <form id="payment-form" class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Member</span>
          <select name="member_id" required class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">— select —</option>${memberOpts}
          </select>
        </label>
        <label class="block">
          <span class="text-sm font-medium">Activity</span>
          <select name="activity_id" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">— ad-hoc —</option>${activityOpts}
          </select>
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Amount due (£)</span>
          <input name="amount_due" type="number" step="0.01" min="0" required value="${p.amount_due ?? ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">Amount paid (£)</span>
          <input name="amount_paid" type="number" step="0.01" min="0" value="${p.amount_paid ?? 0}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Due date</span>
          <input name="due_date" type="date" value="${p.due_date || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
        <label class="block">
          <span class="text-sm font-medium">Paid date</span>
          <input name="paid_date" type="date" value="${p.paid_date || ""}" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2" />
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block">
          <span class="text-sm font-medium">Paid by</span>
          <select name="paid_by" class="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2">
            <option value="">—</option>
            <option ${p.paid_by === "Philip" ? "selected" : ""}>Philip</option>
            <option ${p.paid_by === "Jade" ? "selected" : ""}>Jade</option>
            <option ${p.paid_by === "Other" ? "selected" : ""}>Other</option>
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

// ───── form handlers ─────
$("#add-member-btn").addEventListener("click", () => {
  openModal("New member", memberForm({ track_payments: true, role: "child" }));
  attachMemberFormHandlers();
});

function attachMemberFormHandlers(id = null) {
  $("#form-cancel").addEventListener("click", closeModal);
  $("#member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      id,
      name: fd.get("name").trim(),
      role: fd.get("role"),
      email: fd.get("email").trim() || null,
      track_payments: fd.get("track_payments") === "on",
      osm_section_id: fd.get("osm_section_id").trim() || null,
      osm_member_id: fd.get("osm_member_id").trim() || null,
    };
    try {
      await apiFetch("/members", { method: "POST", body: JSON.stringify(data) });
      await refreshAll();
      closeModal();
      toast("Member saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

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
      id,
      name: fd.get("name").trim(),
      start_date: fd.get("start_date"),
      end_date: fd.get("end_date") || fd.get("start_date"),
      location: fd.get("location").trim() || null,
      cost,
      attendee_ids: attendeeIds,
      notes: fd.get("notes").trim() || null,
      auto_create_payments: fd.get("auto_create_payments") === "on",
    };
    try {
      await apiFetch("/activities", { method: "POST", body: JSON.stringify(data) });
      await refreshAll();
      closeModal();
      toast("Activity saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

$("#add-payment-btn").addEventListener("click", () => {
  if (!state.members.filter((m) => m.track_payments).length) {
    toast("Add a payment-tracked member first", "error");
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
    const data = {
      id,
      member_id: fd.get("member_id"),
      activity_id: fd.get("activity_id") || null,
      amount_due: Number(fd.get("amount_due")) || 0,
      amount_paid: Number(fd.get("amount_paid")) || 0,
      due_date: fd.get("due_date") || null,
      paid_date: fd.get("paid_date") || null,
      paid_by: fd.get("paid_by") || null,
      method: fd.get("method") || null,
      reference: fd.get("reference").trim() || null,
    };
    try {
      await apiFetch("/payments", { method: "POST", body: JSON.stringify(data) });
      await refreshAll();
      closeModal();
      toast("Payment saved", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

// edit / delete dispatch
document.addEventListener("click", async (e) => {
  const editM = e.target.closest("[data-edit-member]");
  if (editM) {
    const m = state.members.find((x) => x.id === editM.dataset.editMember);
    openModal("Edit member", memberForm(m));
    attachMemberFormHandlers(m.id);
    return;
  }
  const delM = e.target.closest("[data-delete-member]");
  if (delM) {
    const m = state.members.find((x) => x.id === delM.dataset.deleteMember);
    if (!confirm(`Delete ${m?.name}? Their existing activities/payments will lose the link.`)) return;
    await apiFetch("/members/" + m.id, { method: "DELETE" });
    await refreshAll();
    toast("Member deleted");
    return;
  }
  const editA = e.target.closest("[data-edit-activity]");
  if (editA) {
    const a = state.activities.find((x) => x.id === editA.dataset.editActivity);
    openModal("Edit activity", activityForm(a));
    attachActivityFormHandlers(a.id);
    return;
  }
  const delA = e.target.closest("[data-delete-activity]");
  if (delA) {
    const a = state.activities.find((x) => x.id === delA.dataset.deleteActivity);
    const linked = state.payments.filter((p) => p.activity_id === a.id);
    const msg = linked.length
      ? `Delete "${a.name}" and its ${linked.length} linked payment(s)?`
      : `Delete "${a.name}"?`;
    if (!confirm(msg)) return;
    await apiFetch("/activities/" + a.id, { method: "DELETE" });
    await refreshAll();
    toast("Activity deleted");
    return;
  }
  const editP = e.target.closest("[data-edit-payment]");
  if (editP) {
    const p = state.payments.find((x) => x.id === editP.dataset.editPayment);
    openModal("Edit payment", paymentForm(p));
    attachPaymentFormHandlers(p.id);
    return;
  }
  const delP = e.target.closest("[data-delete-payment]");
  if (delP) {
    if (!confirm("Delete this payment?")) return;
    await apiFetch("/payments/" + delP.dataset.deletePayment, { method: "DELETE" });
    await refreshAll();
    toast("Payment deleted");
    return;
  }
});

// ───── export / import ─────
$("#export-btn").addEventListener("click", async () => {
  const data = await apiFetch("/export");
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
  if (!confirm("Import will ADD to your data (it won't replace). Continue?")) {
    e.target.value = "";
    return;
  }
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await apiFetch("/import", { method: "POST", body: JSON.stringify(data) });
    await refreshAll();
    toast(`Imported: ${result.imported.members} members, ${result.imported.activities} activities, ${result.imported.payments} payments`, "success");
  } catch (err) {
    toast("Import failed: " + err.message, "error");
  }
  e.target.value = "";
});

// ───── settings ─────
async function loadSettingsForm() {
  try {
    const cookieHeader = await apiFetch("/settings/osm_cookie_header");
    $("#setting-cookie-header").value = cookieHeader.value || "";
  } catch (e) {
    /* fine on first load */
  }
}

async function saveOsmSettings() {
  await apiFetch("/settings/osm_cookie_header", {
    method: "PUT",
    body: JSON.stringify({ value: $("#setting-cookie-header").value.trim() }),
  });
}

$("#save-osm-settings").addEventListener("click", async () => {
  try {
    await saveOsmSettings();
    toast("Saved", "success");
  } catch (e) {
    toast(e.message, "error");
  }
});

async function runOsmSync() {
  const linked = state.members.filter((m) => m.osm_section_id && m.osm_member_id);
  if (!linked.length) {
    toast("Add OSM Section + Member ID to at least one child on the Members page first.", "error");
    showTab("members");
    return null;
  }
  return apiFetch("/osm/sync", { method: "POST", body: JSON.stringify({}) });
}

$("#test-osm-sync").addEventListener("click", async () => {
  const out = $("#osm-test-output");
  out.classList.remove("hidden");
  out.textContent = "Saving + syncing…";
  try {
    await saveOsmSettings();
    const result = await runOsmSync();
    if (!result) {
      out.classList.add("hidden");
      return;
    }
    out.textContent = JSON.stringify(result, null, 2);
  } catch (e) {
    out.textContent = "❌ " + e.message;
  }
});

$("#sync-btn").addEventListener("click", async () => {
  $("#sync-btn").disabled = true;
  $("#sync-btn").classList.add("opacity-60");
  try {
    const result = await runOsmSync();
    if (result) {
      const ts = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      $("#last-sync").textContent = `Last sync: ${ts} · ${result.members_synced} member(s)`;
      $("#last-sync").classList.remove("hidden");
      toast(`OSM sync OK — ${result.members_synced} member(s) fetched`, "success");
      await refreshAll();
    }
  } catch (e) {
    toast("Sync failed: " + e.message, "error");
  } finally {
    $("#sync-btn").disabled = false;
    $("#sync-btn").classList.remove("opacity-60");
  }
});

// ───── boot ─────
showTab("dashboard");
refreshAll();
