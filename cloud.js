"use strict";
/* FitTrack cloud layer: Supabase auth + permanent storage on top of the existing localStorage app.
   - Guests keep working exactly as before (localStorage only).
   - Signed-in users: every change is queued in a persistent outbox and sent to Supabase (RLS-protected).
   - Records are matched by (user_id, client_id), so re-sending or re-importing never duplicates. */
(function (root) {
  const K = { workouts: "fittrack_workout_logs_v2", food: "fittrack_food_entries_v2", water: "fittrack_water_entries_v2", weight: "fittrack_body_weights_v2" };
  const KINDS = Object.keys(K);
  const KIND_BY_KEY = Object.fromEntries(KINDS.map(k => [K[k], k]));
  const LS = { owner: "fittrack_cache_owner_v1", outbox: "fittrack_outbox_v1", backup: "fittrack_guest_backup_v1", prefs: "fittrack_prefs_v1", drafts: "fittrack_workout_drafts_v1" };
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/, EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  /* ---------- record <-> row mapping ---------- */
  const R = {
    food: { table: "food_entries",
      to: (r, u) => ({ user_id: u, client_id: String(r.id), entry_date: r.date, food_id: r.foodId ?? null, name: String(r.name).trim(), meal: r.meal ?? null, amount_g: r.amount == null ? null : num(r.amount), calories: num(r.calories), protein: num(r.protein), carbs: num(r.carbs), fat: num(r.fat), fiber: num(r.fiber), source: r.source === "custom" ? "custom" : "database" }),
      from: x => ({ id: x.client_id, date: x.entry_date, foodId: x.food_id ?? undefined, name: x.name, meal: x.meal, amount: x.amount_g == null ? undefined : Number(x.amount_g), calories: Number(x.calories), protein: Number(x.protein), carbs: Number(x.carbs), fat: Number(x.fat), fiber: Number(x.fiber), source: x.source }) },
    water: { table: "water_entries",
      to: (r, u) => ({ user_id: u, client_id: String(r.id), entry_date: r.date, amount_ml: Math.round(num(r.amount)) }),
      from: x => ({ id: x.client_id, date: x.entry_date, amount: Number(x.amount_ml) }) },
    weight: { table: "weight_entries",
      to: (r, u) => ({ user_id: u, client_id: String(r.id), entry_date: r.date, weight_kg: num(r.weight) }),
      from: x => ({ id: x.client_id, date: x.entry_date, weight: Number(x.weight_kg) }) },
    workouts: { table: "workout_sessions",
      to: r => ({ client_id: String(r.id), entry_date: r.date, program_id: r.programId ?? null, program_name: r.programName ?? null, day_number: r.day ?? null, day_title: r.dayTitle ?? null, completed_set_count: num(r.completedSetCount), total_set_count: num(r.totalSetCount), notes: r.notes || "", exercises: r.exercises || [] }),
      from: x => ({ id: x.client_id, date: x.entry_date, programId: x.program_id ?? undefined, programName: x.program_name, day: x.day_number, dayTitle: x.day_title,
        exercises: (x.exercise_logs || []).slice().sort((a, b) => a.position - b.position).map(e => ({ name: e.exercise_name, sets: e.sets })),
        completedSetCount: x.completed_set_count, totalSetCount: x.total_set_count, notes: x.notes }) }
  };

  function validate(kind, r) {
    if (!r || typeof r !== "object") return "not an object";
    if (r.id == null || r.id === "") return "missing id";
    if (!DATE_RE.test(String(r.date))) return "invalid date";
    if (kind === "water" && !(num(r.amount) > 0 && num(r.amount) <= 10000)) return "invalid amount";
    if (kind === "weight" && !(num(r.weight) > 0 && num(r.weight) <= 700)) return "invalid weight";
    if (kind === "food" && !String(r.name || "").trim()) return "missing name";
    if (kind === "workouts" && !Array.isArray(r.exercises)) return "missing exercises";
    return null;
  }

  /* diff two record lists: prev = Map(id -> json), list = current array */
  function diff(prev, list) {
    const ops = [], next = new Map();
    for (const r of list) { const j = JSON.stringify(r); next.set(String(r.id), j); if (prev.get(String(r.id)) !== j) ops.push({ op: "up", rec: r }); }
    for (const id of prev.keys()) if (!next.has(id)) ops.push({ op: "del", id });
    return { ops, next };
  }
  const mergeById = (a = [], b = []) => { const m = new Map(); [...a, ...b].forEach(r => m.set(String(r.id), r)); return [...m.values()]; };
  const mergeBackup = (a, b) => Object.fromEntries(KINDS.map(k => [k, mergeById(a?.[k], b?.[k])]));
  const countAll = d => KINDS.reduce((n, k) => n + (d?.[k]?.length || 0), 0);

  if (typeof module !== "undefined") module.exports = { R, validate, diff, mergeBackup, countAll };
  if (typeof document === "undefined") return;

  /* ---------- config & client ---------- */
  const cfg = root.FITTRACK_CONFIG || {};
  const jwtRole = k => { try { return JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role; } catch { return null; } };
  const keyIsSecret = k => /^sb_secret_/.test(k) || jwtRole(k) === "service_role";
  const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.supabaseUrl || "") && !!cfg.supabasePublishableKey && !/YOUR_/i.test(cfg.supabasePublishableKey);
  let sb = null, configProblem = "";
  if (configured && keyIsSecret(cfg.supabasePublishableKey)) configProblem = "SECRET KEY DETECTED in config.js. Remove it and use the publishable key.";
  else if (configured && !(root.supabase && root.supabase.createClient)) configProblem = "Supabase library failed to load (network or blocked CDN).";
  else if (configured) sb = root.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  const REDIRECT = cfg.siteUrl || (location.origin + location.pathname);
  const hashInfo = new URLSearchParams(location.hash.replace(/^#/, ""));

  let uid = null, email = "", ready = false, flushing = false, retryDelay = 0, retryTimer = null, snap = {}, dialogView = "", pendingMigration = false;
  const obKey = u => LS.outbox + ":" + u;   // one queue per account, so nobody's unsynced changes are lost or sent as someone else
  const loadOutbox = u => { try { const o = JSON.parse(localStorage.getItem(obKey(u))); return { uid: u, ops: o?.ops || [], failed: o?.failed || [] }; } catch { return { uid: u, ops: [], failed: [] }; } };
  let outbox = { uid: null, ops: [], failed: [] }, activating = null;
  const saveOutbox = () => { if (!outbox.uid) return; try { localStorage.setItem(obKey(outbox.uid), JSON.stringify({ ops: outbox.ops, failed: outbox.failed })); } catch (e) { console.error(e); } };
  const E = s => escapeHTML(s);
  const $ = s => document.querySelector(s);

  /* ---------- small UI helpers ---------- */
  function toast(text, kind = "info") {
    let box = $("#ftToasts"); if (!box) { box = document.createElement("div"); box.id = "ftToasts"; box.setAttribute("aria-live", "polite"); document.body.appendChild(box); }
    const t = document.createElement("div"); t.className = "ft-toast " + kind; t.textContent = text; box.appendChild(t); setTimeout(() => t.remove(), 7000);
  }
  function setStatus(state, detail = "") {
    const label = { local: "Local only", unconfigured: "Cloud not set up", syncing: "Syncing…", synced: "Synced", offline: "Offline · queued", error: "Sync error" }[state];
    document.querySelectorAll(".sync-chip").forEach(c => { c.dataset.state = state; c.textContent = label; c.title = detail || label; });
  }
  function busy(on, text = "Loading your data…") {
    let o = $("#ftBusy"); if (!o) { o = document.createElement("div"); o.id = "ftBusy"; o.innerHTML = '<div class="ft-spin"></div><p></p>'; document.body.appendChild(o); }
    o.querySelector("p").textContent = text; o.hidden = !on;
  }
  const friendly = e => { const m = String(e?.message || e); if (/invalid login/i.test(m)) return "Incorrect email or password."; if (/failed to fetch|network|retryable|timeout/i.test(m)) return "Network problem. Check your connection and try again."; if (/rate limit|too many/i.test(m)) return "Too many attempts. Please wait a few minutes and try again."; if (/already registered/i.test(m)) return "An account with this email already exists. Try signing in."; return m; };
  const dlg = () => $("#ftDialog");
  function msg(text, kind = "err") { const p = dlg()?.querySelector(".ft-msg"); if (p) { p.textContent = text; p.className = "ft-msg " + kind; } }
  const field = (label, name, type = "text", extra = "") => `<label class="ft-field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;

  function show(view, html) {
    let d = dlg(); if (!d) { d = document.createElement("dialog"); d.id = "ftDialog"; d.className = "ft-dialog"; d.addEventListener("close", () => { dialogView = ""; }); d.addEventListener("click", onDialogClick); d.addEventListener("submit", onDialogSubmit); document.body.appendChild(d); }
    dialogView = view; d.innerHTML = `<button class="ft-x" data-act="close" aria-label="Close">✕</button>${html}<p class="ft-msg" role="status" aria-live="polite"></p>`;
    if (!d.open) d.showModal();
  }
  const closeDialog = () => dlg()?.open && dlg().close();

  function renderAuth(tab = "signin") {
    const forms = {
      signin: `<form data-form="signin" novalidate>${field("Email", "email", "email", 'autocomplete="email" required')}${field("Password", "password", "password", 'autocomplete="current-password" required')}<button class="ft-btn" type="submit">Sign in</button><button class="ft-link" type="button" data-tab="forgot">Forgot password?</button></form>`,
      signup: `<form data-form="signup" novalidate>${field("Display name", "name", "text", 'maxlength="60" autocomplete="nickname"')}${field("Email", "email", "email", 'autocomplete="email" required')}${field("Password (8+ characters)", "password", "password", 'autocomplete="new-password" minlength="8" required')}${field("Confirm password", "confirm", "password", 'autocomplete="new-password" required')}<button class="ft-btn" type="submit">Create account</button></form>`,
      forgot: `<form data-form="forgot" novalidate><p class="ft-sub">We'll email you a link to set a new password.</p>${field("Email", "email", "email", 'autocomplete="email" required')}<button class="ft-btn" type="submit">Send reset link</button><button class="ft-link" type="button" data-tab="signin">Back to sign in</button></form>`
    };
    show("auth", `<h2>${tab === "signup" ? "Create your account" : tab === "forgot" ? "Reset password" : "Welcome back"}</h2><div class="ft-tabs"><button data-tab="signin" class="${tab === "signin" ? "on" : ""}">Sign in</button><button data-tab="signup" class="${tab === "signup" ? "on" : ""}">Create account</button></div>${forms[tab]}<p class="ft-sub">Without an account, FitTrack keeps data on this device only.</p>`);
  }

  const goalsForm = (withName) => `<form data-form="profile" novalidate>${withName ? field("Display name", "name", "text", `maxlength="60" value="${E(userPrefs.displayName)}"`) : ""}${field("Daily calorie goal (kcal)", "cal", "number", `min="800" max="10000" step="50" value="${userPrefs.calorieGoal}"`)}${field("Daily protein goal (g)", "pro", "number", `min="0" max="600" value="${userPrefs.proteinGoal}"`)}${field("Daily water goal (ml)", "water", "number", `min="250" max="10000" step="250" value="${userPrefs.waterGoal}"`)}${field("Fitness goal", "goal", "text", `maxlength="200" placeholder="e.g. Add 4 kg of muscle by March" value="${E(userPrefs.fitnessGoal)}"`)}<button class="ft-btn" type="submit">Save profile & goals</button></form>`;
  const readBackup = () => { try { return JSON.parse(localStorage.getItem(LS.backup)); } catch { return null; } };

  function renderAccount() {
    if (!uid) {
      show("local", `<h2>Preferences</h2><p class="ft-sub">${E(configProblem || "Cloud sync is not configured, so everything stays on this device. Add your Supabase details to config.js (see README).")}</p>${goalsForm(false)}`);
      return;
    }
    const bk = readBackup(), nBk = bk && !bk.imported ? countAll(bk) : 0;
    show("account", `<h2>Account</h2><p class="ft-sub">${E(email)}</p>${goalsForm(true)}
      <section><h3>Sync</h3><p class="ft-sub">${outbox.ops.length} change(s) waiting · ${outbox.failed.length} failed.</p><div class="ft-row"><button class="ft-btn ghost" data-act="retry">Retry / refresh from cloud</button>${nBk ? `<button class="ft-btn ghost" data-act="import">Import ${nBk} record(s) saved on this device</button>` : ""}</div></section>
      <section><h3>Change password</h3><form data-form="password" novalidate>${field("New password (8+ characters)", "password", "password", 'autocomplete="new-password" minlength="8"')}<button class="ft-btn ghost" type="submit">Update password</button></form></section>
      <section class="danger"><div class="ft-row"><button class="ft-btn ghost" data-act="signout">Sign out</button></div><h3>Delete account</h3><form data-form="delete" novalidate><p class="ft-sub">Permanently deletes your account and all cloud data. Type DELETE to confirm.</p>${field("Confirmation", "confirm", "text", 'autocomplete="off"')}<button class="ft-btn danger" type="submit">Delete my account</button></form></section>`);
  }

  function renderMigrate(data) {
    show("migrate", `<h2>Import data from this device?</h2><p class="ft-sub">Found records saved here before you signed in: ${data.workouts.length} workouts, ${data.food.length} meals, ${data.water.length} water logs, ${data.weight.length} weights. Matching IDs are merged, so nothing is duplicated, and a backup copy stays on this device.</p><div class="ft-row"><button class="ft-btn" data-act="import">Import into my account</button><button class="ft-btn ghost" data-act="close">Not now</button></div>`);
  }

  /* ---------- dialog events ---------- */
  function onDialogClick(e) {
    const t = e.target.closest("[data-act],[data-tab]"); if (!t) return;
    if (t.dataset.tab) return renderAuth(t.dataset.tab);
    ({ close: closeDialog, signout: signOut, retry: () => { flush().then(() => loadAll()); closeDialog(); }, import: importFromBackup, resend: resendVerification })[t.dataset.act]?.();
  }
  async function onDialogSubmit(e) {
    e.preventDefault(); const f = e.target, kind = f.dataset.form, btn = f.querySelector("[type=submit]"); if (!kind) return;
    btn.disabled = true; msg("");
    try { await ({ signin: doSignin, signup: doSignup, forgot: doForgot, recovery: doRecovery, password: doRecovery, profile: doProfile, delete: doDelete })[kind](f); }
    catch (err) { msg(friendly(err)); }
    finally { btn.disabled = false; }
  }
  const val = (f, n) => f.elements[n]?.value.trim() ?? "";
  const checkPw = (f) => { const p = f.elements.password.value; if (p.length < 8) throw new Error("Password must be at least 8 characters."); if (f.elements.confirm && f.elements.confirm.value !== p) throw new Error("Passwords do not match."); return p; };
  async function doSignin(f) {
    const em = val(f, "email"), pw = f.elements.password.value;
    if (!EMAIL_RE.test(em)) throw new Error("Enter a valid email address."); if (!pw) throw new Error("Enter your password.");
    const { error } = await sb.auth.signInWithPassword({ email: em, password: pw });
    if (error) { if (/not confirmed/i.test(error.message)) { f.dataset.email = em; msg("Please verify your email first. Check your inbox.", "err"); f.insertAdjacentHTML("beforeend", `<button class="ft-link" type="button" data-act="resend" data-email="${E(em)}">Resend verification email</button>`); return; } throw error; }
    closeDialog();
  }
  async function resendVerification() { const em = $("#ftDialog [data-email]")?.dataset.email; if (!em) return; const { error } = await sb.auth.resend({ type: "signup", email: em, options: { emailRedirectTo: REDIRECT } }); msg(error ? friendly(error) : "Verification email sent.", error ? "err" : "ok"); }
  async function doSignup(f) {
    const em = val(f, "email"); if (!EMAIL_RE.test(em)) throw new Error("Enter a valid email address."); const pw = checkPw(f);
    const { data, error } = await sb.auth.signUp({ email: em, password: pw, options: { emailRedirectTo: REDIRECT, data: { display_name: val(f, "name").slice(0, 60) } } });
    if (error) throw error;
    if (data.session) closeDialog(); else { f.reset(); msg("Almost done. We sent a verification link to your email. Open it to activate your account, then sign in.", "ok"); }
  }
  async function doForgot(f) { const em = val(f, "email"); if (!EMAIL_RE.test(em)) throw new Error("Enter a valid email address."); const { error } = await sb.auth.resetPasswordForEmail(em, { redirectTo: REDIRECT }); if (error) throw error; msg("If that email has an account, a reset link is on its way.", "ok"); }
  async function doRecovery(f) { const pw = checkPw(f); const { error } = await sb.auth.updateUser({ password: pw }); if (error) throw error; toast("Password updated.", "ok"); closeDialog(); }
  async function doProfile(f) {
    const n = (name, lo, hi) => { const v = Number(f.elements[name].value); if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`Enter a whole number between ${lo} and ${hi}.`); return v; };
    const next = { displayName: f.elements.name ? val(f, "name").slice(0, 60) : userPrefs.displayName, calorieGoal: n("cal", 800, 10000), proteinGoal: n("pro", 0, 600), waterGoal: n("water", 250, 10000), fitnessGoal: val(f, "goal").slice(0, 200) };
    userPrefs = { ...userPrefs, ...next }; localStorage.setItem(LS.prefs, JSON.stringify(userPrefs));
    renderDashboard(); renderFood(); refreshAvatar();
    if (uid) { outbox.ops = outbox.ops.filter(o => o.kind !== "prefs"); outbox.ops.push({ kind: "prefs", op: "up", rec: userPrefs }); saveOutbox(); flush(); }
    msg(uid ? "Saved. Syncing to your account…" : "Saved on this device.", "ok");
  }
  async function doDelete(f) {
    if (val(f, "confirm") !== "DELETE") throw new Error("Type DELETE (capitals) to confirm.");
    const { error } = await sb.rpc("delete_my_account"); if (error) throw error;
    localStorage.removeItem(obKey(uid)); outbox = { uid: null, ops: [], failed: [] }; await sb.auth.signOut({ scope: "local" }); closeDialog(); toast("Your account and cloud data were deleted.", "ok");
  }
  async function signOut() {
    busy(true, "Signing out…"); try { await Promise.race([flush(), new Promise(r => setTimeout(r, 4000))]); } catch { /* pending ops stay queued for this user */ }
    closeDialog(); await sb.auth.signOut(); busy(false);
  }

  /* ---------- sync engine ---------- */
  const fail = (error, status) => Object.assign(new Error(error.message || String(error)), { status: status ?? error.status ?? 0, code: error.code });
  const transient = e => !e.status || e.status >= 500 || [401, 408, 429].includes(e.status) || /fetch|network|timeout/i.test(e.message);
  const check = r => { if (r.error) throw fail(r.error, r.status); return r; };

  async function sendOp(o) {
    if (o.kind === "prefs") {
      check(await sb.from("profiles").upsert({ id: uid, display_name: o.rec.displayName || "" }));
      return check(await sb.from("preferences").upsert({ user_id: uid, calorie_goal: o.rec.calorieGoal, protein_goal: o.rec.proteinGoal, water_goal_ml: o.rec.waterGoal, fitness_goal: o.rec.fitnessGoal || "" }));
    }
    const m = R[o.kind];
    if (o.op === "del") return check(await sb.from(m.table).delete().eq("client_id", String(o.id)));
    if (o.kind === "workouts") return check(await sb.rpc("save_workout", { p_session: m.to(o.rec) }));
    return check(await sb.from(m.table).upsert(m.to(o.rec, uid), { onConflict: "user_id,client_id" }));
  }

  async function flush() {
    if (!sb || !uid || flushing || outbox.uid !== uid) return;
    if (!outbox.ops.length) { if (ready) setStatus("synced"); return; }
    flushing = true; setStatus("syncing");
    try {
      while (outbox.ops.length) {
        const o = outbox.ops[0];
        try { await sendOp(o); } catch (e) {
          if (transient(e)) throw e;
          outbox.failed.push({ ...o, error: e.message }); toast(`Could not sync one ${o.kind} record (${e.message}). It stays on this device.`, "err");
        }
        outbox.ops.shift(); saveOutbox();
      }
      retryDelay = 0; setStatus(outbox.failed.length ? "error" : "synced", outbox.failed.length ? `${outbox.failed.length} record(s) could not be synced` : "");
    } catch (e) {
      setStatus("offline", friendly(e)); retryDelay = Math.min(60000, (retryDelay || 2000) * 2); clearTimeout(retryTimer); retryTimer = setTimeout(() => flush(), retryDelay);
    } finally { flushing = false; }
  }

  function onWrite(key, value) {
    const kind = KIND_BY_KEY[key]; if (!kind || !uid || !ready) return;
    const { ops, next } = diff(snap[kind] || new Map(), value); snap[kind] = next; if (!ops.length) return;
    for (const o of ops) {
      const id = String(o.op === "up" ? o.rec.id : o.id);
      if (o.op === "up") { const err = validate(kind, o.rec); if (err) { toast(`A ${kind} record was not synced (${err}).`, "err"); continue; } }
      outbox.ops = outbox.ops.filter(q => !(q.kind === kind && String(q.op === "up" ? q.rec.id : q.id) === id));
      outbox.ops.push({ kind, ...o });
    }
    outbox.uid = uid; saveOutbox(); flush();
  }

  /* ---------- load / migrate ---------- */
  const readLocalAll = () => Object.fromEntries(KINDS.map(k => { try { const v = JSON.parse(localStorage.getItem(K[k])); return [k, Array.isArray(v) ? v : []]; } catch { return [k, []]; } }));
  function clearLocal() { Object.values(K).concat(LS.prefs, LS.drafts).forEach(k => localStorage.removeItem(k)); }
  function resetState() { workoutLogs = []; foodEntries = []; waterEntries = []; bodyWeights = []; workoutDrafts = {}; userPrefs = { ...DEFAULT_PREFS }; initializeApp(); showPage("dashboard"); refreshAvatar(); }

  async function fetchAll(table, select) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error, status } = await sb.from(table).select(select).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
      if (error) throw fail(error, status); out.push(...data); if (data.length < 1000) return out;
    }
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Request timed out")), ms))]);

  async function loadAll() {
    if (!sb || !uid) return false;
    busy(true); setStatus("syncing");
    try {
      await flush(); if (outbox.ops.length) throw new Error("Pending changes could not be sent yet");
      const [wk, fd, wa, wt, pr, pf] = await withTimeout(Promise.all([
        fetchAll("workout_sessions", "*, exercise_logs(position,exercise_name,sets)"), fetchAll("food_entries", "*"), fetchAll("water_entries", "*"), fetchAll("weight_entries", "*"),
        sb.from("preferences").select("*").eq("user_id", uid).maybeSingle().then(r => check(r).data), sb.from("profiles").select("display_name").eq("id", uid).maybeSingle().then(r => check(r).data)]), 25000);
      const kept = kind => outbox.failed.filter(o => o.kind === kind && o.op === "up").map(o => o.rec);   // never drop records the cloud rejected
      workoutLogs = mergeById(wk.map(R.workouts.from), kept("workouts")); foodEntries = mergeById(fd.map(R.food.from), kept("food"));
      waterEntries = mergeById(wa.map(R.water.from), kept("water")); bodyWeights = mergeById(wt.map(R.weight.from), kept("weight")).sort((a, b) => a.date.localeCompare(b.date));
      userPrefs = { ...DEFAULT_PREFS, displayName: pf?.display_name || "", ...(pr ? { calorieGoal: pr.calorie_goal, proteinGoal: pr.protein_goal, waterGoal: pr.water_goal_ml, fitnessGoal: pr.fitness_goal } : {}) };
      const lists = { workouts: workoutLogs, food: foodEntries, water: waterEntries, weight: bodyWeights };
      KINDS.forEach(k => { localStorage.setItem(K[k], JSON.stringify(lists[k])); snap[k] = diff(new Map(), lists[k]).next; });
      localStorage.setItem(LS.prefs, JSON.stringify(userPrefs)); localStorage.setItem(LS.owner, uid);
      ready = true; initializeApp(); refreshAvatar(); setStatus(outbox.failed.length ? "error" : "synced"); return true;
    } catch (e) {
      console.warn("[FitTrack] load failed:", e); setStatus("offline", friendly(e)); toast("Could not reach your account data. Showing the copy saved on this device; will retry.", "err");
      clearTimeout(retryTimer); retryTimer = setTimeout(() => loadAll(), Math.min(60000, (retryDelay = Math.max(4000, retryDelay * 2)))); return false;
    } finally { busy(false); }
  }

  async function importFromBackup() {
    const data = readBackup(); if (!data) return;
    busy(true, "Importing…"); const skipped = []; let imported = 0;
    try {
      for (const kind of KINDS) {
        const good = []; for (const r of data[kind] || []) { const err = validate(kind, r); err ? skipped.push(`${kind} ${r?.id ?? "?"}: ${err}`) : good.push(r); }
        if (kind === "workouts") { for (const r of good) { check(await sb.rpc("save_workout", { p_session: R.workouts.to(r) })); imported++; } continue; }
        const rows = [...mergeById(good).map(r => R[kind].to(r, uid))];
        for (let i = 0; i < rows.length; i += 200) { check(await sb.from(R[kind].table).upsert(rows.slice(i, i + 200), { onConflict: "user_id,client_id" })); imported += Math.min(200, rows.length - i); }
      }
      data.imported = new Date().toISOString(); data.skipped = skipped; localStorage.setItem(LS.backup, JSON.stringify(data));
      await loadAll(); closeDialog();
      toast(`Imported ${imported} record(s).${skipped.length ? ` ${skipped.length} invalid record(s) were skipped and kept in the device backup.` : ""}`, skipped.length ? "info" : "ok");
    } catch (e) { toast("Import failed: " + friendly(e) + " Nothing was lost; you can retry from Account.", "err"); }
    finally { busy(false); }
  }

  async function activate(user) {
    if ((ready && uid === user.id) || activating === user.id) return;
    activating = user.id;
    try { await activateInner(user); } finally { activating = null; }
  }
  async function activateInner(user) {
    uid = user.id; email = user.email || ""; ready = false; snap = {}; outbox = loadOutbox(uid);
    const owner = localStorage.getItem(LS.owner), local = readLocalAll(); let migrate = false;
    if (owner && owner !== "guest" && owner !== uid) { clearLocal(); }
    else if ((!owner || owner === "guest") && countAll(local)) { localStorage.setItem(LS.backup, JSON.stringify({ ...mergeBackup(readBackup(), local), savedAt: new Date().toISOString() })); clearLocal(); migrate = true; }
    const ok = await loadAll();
    if (user.email_confirmed_at && hashInfo.get("type") === "signup") toast("Email verified. Welcome to FitTrack!", "ok");
    const bk = readBackup(); if (ok && migrate && bk && countAll(bk) && dialogView !== "recovery") renderMigrate(bk);
  }
  function deactivate() { if (!uid) return; uid = null; email = ""; ready = false; snap = {}; clearLocal(); localStorage.setItem(LS.owner, "guest"); resetState(); setStatus("local"); }

  function refreshAvatar() {
    const src = userPrefs.displayName || email || "FT", ini = src.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join("") || "FT";
    document.querySelectorAll(".avatar-circle").forEach(a => { a.textContent = ini; a.title = uid ? `Account: ${email}` : "Sign in or set preferences"; });
  }

  /* ---------- boot ---------- */
  function openAccount() { if (uid || !sb) renderAccount(); else renderAuth("signin"); }
  function init() {
    document.querySelectorAll(".topbar-actions, .header-action-group").forEach(box => { const c = document.createElement("button"); c.type = "button"; c.className = "sync-chip"; c.addEventListener("click", () => (uid && outbox.ops.length ? flush() : openAccount())); box.prepend(c); });
    document.querySelectorAll(".avatar-circle").forEach(a => { a.setAttribute("role", "button"); a.tabIndex = 0; a.addEventListener("click", openAccount); a.addEventListener("keydown", e => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), openAccount())); });
    refreshAvatar();
    if (hashInfo.get("error_description")) toast(hashInfo.get("error_description").replace(/\+/g, " "), "err");
    if (!sb) { setStatus(configured ? "error" : "unconfigured", configProblem || "Add your Supabase details to config.js"); if (configProblem) toast(configProblem, "err"); return; }
    setStatus("local");
    sb.auth.onAuthStateChange((event, session) => setTimeout(() => {      // defer: never await supabase calls inside this callback
      if (event === "PASSWORD_RECOVERY") { show("recovery", `<h2>Set a new password</h2><form data-form="recovery" novalidate>${field("New password (8+ characters)", "password", "password", 'autocomplete="new-password" required')}${field("Confirm password", "confirm", "password", 'autocomplete="new-password" required')}<button class="ft-btn" type="submit">Update password</button></form>`); }
      if (session?.user && ["INITIAL_SESSION", "SIGNED_IN", "PASSWORD_RECOVERY"].includes(event)) activate(session.user);
      else if (event === "SIGNED_OUT") deactivate();
    }, 0));
    root.addEventListener("online", () => { flush(); if (uid && !ready) loadAll(); });
  }

  root.FitCloud = { onWrite, openAccount, flush, get configured() { return !!sb; } };
  init();
})(typeof window !== "undefined" ? window : globalThis);
