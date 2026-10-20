"use strict";

/* ==========================================================================
   FITTRACK PRO MAX - JAVASCRIPT CORE ENGINE
   UI/UX Pro Max Architecture: Clean, Section-Wise, Maintainable Code
   ========================================================================== */

/* ==========================================================================
   SECTION 1: PERSISTENCE LAYER & UTILITY HELPERS
   ========================================================================== */
const STORAGE_KEYS = {
  workouts: "fittrack_workout_logs_v2",
  food: "fittrack_food_entries_v2",
  water: "fittrack_water_entries_v2",
  weight: "fittrack_body_weights_v2",
  drafts: "fittrack_workout_drafts_v1"
};

/**
 * Safely reads and parses JSON array data from localStorage.
 */
function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.warn(`[FitTrack Storage] Could not read ${key} from localStorage:`, error);
    return [];
  }
}

/**
 * Safely writes serializable JSON data to localStorage.
 */
function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    try { window.FitCloud?.onWrite(key, value); window.FitScene?.pulse(); } catch (hookError) { console.warn("[FitTrack] sync hook failed:", hookError); }
    return true;
  } catch (error) {
    console.error(`[FitTrack Storage] Could not write ${key} to localStorage:`, error);
    return false;
  }
}

/**
 * Reads in-progress workout draft inputs from localStorage.
 */
function readDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.drafts));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * Returns today's ISO date string (YYYY-MM-DD) based on local client timezone.
 */
function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/**
 * Formats a YYYY-MM-DD date string to a human-readable label.
 */
function formatDate(dateString) {
  if (!dateString) return "Unknown date";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * Escapes raw strings for safe dynamic HTML insertion to prevent XSS.
 */
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

/**
 * Coerces arbitrary input into a finite numeric value.
 */
function numberValue(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Generates unique random IDs for log entries.
 */
function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Formats float numbers with clean decimal precision.
 */
function formatDecimal(value, places = 1) {
  return Number(value).toFixed(places).replace(/\.0$/, "");
}

// Global Application Reactive State
let workoutLogs = readStorage(STORAGE_KEYS.workouts);
let foodEntries = readStorage(STORAGE_KEYS.food);
let waterEntries = readStorage(STORAGE_KEYS.water);
let bodyWeights = readStorage(STORAGE_KEYS.weight);
let workoutDrafts = readDrafts();
const DEFAULT_PREFS = { displayName: "", calorieGoal: 2200, proteinGoal: 150, waterGoal: 2500, fitnessGoal: "" };
function readPrefs() {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem("fittrack_prefs_v1")) || {}) }; }
  catch { return { ...DEFAULT_PREFS }; }
}
let userPrefs = readPrefs();

let currentProgramId = null;
let currentDayNumber = null;
let restTimerInterval = null;
let restTimerEndsAt = 0;
let restTimerRemaining = 90;
let expandedExerciseIndex = 0;


/* ==========================================================================
   SECTION 2: WORKOUT PROGRAMS & EXERCISE DATABASE
   ========================================================================== */
const muscleBuildingDays = [
  {
    day: 1, title: "Chest + Triceps", subtitle: "Chest + Triceps Hypertrophy",
    description: "Build upper-body pressing strength and target the chest and triceps.",
    exercises: [
      { name: "Barbell Bench Press", sets: 4, reps: "6–8", rest: "2–3 min", description: "Main compound chest press." },
      { name: "Incline Dumbbell Press", sets: 3, reps: "8–10", rest: "2 min", description: "Upper pectoral focus." },
      { name: "Cable Fly", sets: 3, reps: "12–15", rest: "90 sec", description: "Controlled chest isolation." },
      { name: "Triceps Pushdown", sets: 3, reps: "10–12", rest: "90 sec", description: "Lateral and medial tricep head." },
      { name: "Overhead Triceps Extension", sets: 3, reps: "10–15", rest: "90 sec", description: "Focus on the long head of the triceps." }
    ]
  },
  {
    day: 2, title: "Back + Biceps", subtitle: "Back Width & Biceps",
    description: "Build back thickness and strong arms with controlled pulling movements.",
    exercises: [
      { name: "Lat Pulldown", sets: 4, reps: "8–12", rest: "2 min", description: "Vertical pulling for lat width." },
      { name: "Barbell Row", sets: 3, reps: "6–10", rest: "2–3 min", description: "Heavy horizontal pull for mid-back." },
      { name: "Seated Cable Row", sets: 3, reps: "8–12", rest: "2 min", description: "Controlled horizontal rowing." },
      { name: "Barbell Curl", sets: 3, reps: "8–12", rest: "90 sec", description: "Heavy bicep mass builder." },
      { name: "Hammer Curl", sets: 3, reps: "10–15", rest: "90 sec", description: "Brachialis and forearm development." }
    ]
  },
  {
    day: 3, title: "Legs", subtitle: "Lower Body Strength",
    description: "Develop quad, hamstring, glute and calf strength with compound mechanics.",
    exercises: [
      { name: "Barbell Squat", sets: 4, reps: "6–8", rest: "2–3 min", description: "Primary lower-body compound movement." },
      { name: "Romanian Deadlift", sets: 3, reps: "8–10", rest: "2 min", description: "Hamstring and glute posterior chain." },
      { name: "Leg Press", sets: 3, reps: "10–12", rest: "2 min", description: "Controlled quad hypertrophy volume." },
      { name: "Leg Curl", sets: 3, reps: "10–15", rest: "90 sec", description: "Knee flexion hamstring isolation." },
      { name: "Standing Calf Raise", sets: 4, reps: "10–15", rest: "90 sec", description: "Gastrocnemius calf development." }
    ]
  },
  {
    day: 4, title: "Shoulders + Arms", subtitle: "Delts & Arm Specialization",
    description: "Build wider shoulders and arm proportions with high-intensity isolation.",
    exercises: [
      { name: "Cable Lateral Raise", sets: 4, reps: "12–20", rest: "60–75 sec", description: "Side deltoid width." },
      { name: "Machine Shoulder Press", sets: 3, reps: "6–10", rest: "2–3 min", description: "Heavy overhead pressing." },
      { name: "Reverse Pec Deck", sets: 4, reps: "12–20", rest: "60–90 sec", description: "Rear deltoid isolation." },
      { name: "Rope Pressdown", sets: 3, reps: "10–15", rest: "60–90 sec", description: "Tricep peak contraction." },
      { name: "EZ-Bar Curl", sets: 3, reps: "6–10", rest: "90–120 sec", description: "Controlled heavy bicep curls." }
    ]
  },
  {
    day: 5, title: "Upper Body", subtitle: "Upper Body Hypertrophy",
    description: "Balanced upper-body hypertrophy focusing on weak-point development.",
    exercises: [
      { name: "Incline Bench Press", sets: 3, reps: "8–10", rest: "2 min", description: "Upper pectoral development." },
      { name: "Lat Pulldown", sets: 3, reps: "8–12", rest: "2 min", description: "Back width stimulus." },
      { name: "Seated Cable Row", sets: 3, reps: "8–12", rest: "2 min", description: "Horizontal rowing volume." },
      { name: "Machine Shoulder Press", sets: 3, reps: "8–10", rest: "2 min", description: "Shoulder pressing volume." },
      { name: "Cable Lateral Raise", sets: 3, reps: "12–20", rest: "60 sec", description: "Lateral delt isolation." }
    ]
  }
];

const fatLossDays = [
  { day: 1, title: "Upper Body", exercises: [
    { name: "Machine Chest Press", sets: 3, reps: "10–12", rest: "90 sec", description: "Controlled chest pressing." },
    { name: "Lat Pulldown", sets: 3, reps: "10–12", rest: "90 sec", description: "Controlled back pulling." },
    { name: "Seated Cable Row", sets: 3, reps: "10–12", rest: "90 sec", description: "Mid-back volume." }
  ] },
  { day: 2, title: "Lower Body", exercises: [
    { name: "Leg Press", sets: 3, reps: "10–12", rest: "2 min", description: "Lower-body compound." },
    { name: "Romanian Deadlift", sets: 3, reps: "10–12", rest: "2 min", description: "Posterior-chain stimulus." },
    { name: "Standing Calf Raise", sets: 3, reps: "12–15", rest: "60 sec", description: "Calf training." }
  ] },
  { day: 3, title: "Cardio + Core", exercises: [
    { name: "Incline Treadmill Walk", sets: 1, reps: "20 min", rest: "As needed", description: "Zone 2 aerobic conditioning." },
    { name: "Plank", sets: 3, reps: "45–60 sec", rest: "60 sec", description: "Core isometric bracing." }
  ] },
  { day: 4, title: "Full Body", exercises: [
    { name: "Goblet Squat", sets: 3, reps: "10–12", rest: "90 sec", description: "Full-body compound movement." },
    { name: "Machine Chest Press", sets: 3, reps: "10–12", rest: "90 sec", description: "Chest pressing volume." }
  ] },
  { day: 5, title: "Cardio + Recovery", exercises: [
    { name: "Steady-State Cycling", sets: 1, reps: "25 min", rest: "As needed", description: "Cardio recovery session." },
    { name: "Mobility Flow", sets: 2, reps: "10 min", rest: "As needed", description: "Full-body joint mobility." }
  ] }
];

const strengthDays = [
  { day: 1, title: "Squat Focus", exercises: [
    { name: "Barbell Squat", sets: 4, reps: "3–5", rest: "3 min", description: "Heavy competition squat." },
    { name: "Romanian Deadlift", sets: 3, reps: "6–8", rest: "2–3 min", description: "Hamstring and back support." },
    { name: "Leg Press", sets: 3, reps: "8–10", rest: "2 min", description: "Quad hypertrophy volume." }
  ] },
  { day: 2, title: "Bench Focus", exercises: [
    { name: "Barbell Bench Press", sets: 4, reps: "3–5", rest: "3 min", description: "Heavy competition bench press." },
    { name: "Incline Dumbbell Press", sets: 3, reps: "6–8", rest: "2 min", description: "Upper chest accessory." },
    { name: "Triceps Pushdown", sets: 3, reps: "8–12", rest: "90 sec", description: "Lockout tricep strength." }
  ] },
  { day: 3, title: "Deadlift Focus", exercises: [
    { name: "Deadlift", sets: 3, reps: "3–5", rest: "3 min", description: "Heavy conventional deadlift." },
    { name: "Lat Pulldown", sets: 3, reps: "6–10", rest: "2 min", description: "Lats and upper back accessory." }
  ] },
  { day: 4, title: "Overhead Focus", exercises: [
    { name: "Machine Shoulder Press", sets: 4, reps: "5–8", rest: "2–3 min", description: "Heavy overhead pressing." },
    { name: "Barbell Row", sets: 3, reps: "5–8", rest: "2–3 min", description: "Heavy horizontal pulling." }
  ] },
  { day: 5, title: "Technique + Accessories", exercises: [
    { name: "Paused Bench Press", sets: 3, reps: "4–6", rest: "2–3 min", description: "Pause at chest for control." },
    { name: "Goblet Squat", sets: 3, reps: "8–10", rest: "90 sec", description: "Mobility and quad form." }
  ] }
];

const programs = [
  { id: "muscle", name: "Muscle Building", category: "HYPERTROPHY", duration: "5 days", number: "01", description: "Build muscle size, dense strength, and balanced aesthetic proportions.", days: muscleBuildingDays },
  { id: "fatloss", name: "Fat Loss", category: "CONDITIONING", duration: "5 days", number: "02", description: "Combine hypertrophy training, metabolic conditioning, and recovery.", days: fatLossDays },
  { id: "strength", name: "Strength Training", category: "PERFORMANCE", duration: "5 days", number: "03", description: "Focus on the big compound lifts, technical mastery, and neurological force.", days: strengthDays }
];


/* ==========================================================================
   SECTION 3: APP NAVIGATION, DRAWER & ACTION SHEET (IMAGE 3)
   ========================================================================== */
const pageNames = {
  dashboard: "Dashboard",
  workouts: "Workouts",
  food: "Nutrition",
  weight: "Body weight",
  progress: "Progress"
};

const sidebar = document.getElementById("sidebar");
const backdrop = document.getElementById("sidebarBackdrop");
const menuButton = document.getElementById("menuButton");
const closeButton = document.getElementById("sidebarCloseButton");

const actionSheet = document.getElementById("actionSheet");
const actionSheetBackdrop = document.getElementById("actionSheetBackdrop");
const fabQuickAdd = document.getElementById("fabQuickAdd");
const closeActionSheet = document.getElementById("closeActionSheet");

function openSidebar() {
  sidebar?.classList.add("sidebar-open");
  backdrop?.classList.add("active");
  menuButton?.setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  sidebar?.classList.remove("sidebar-open");
  backdrop?.classList.remove("active");
  menuButton?.setAttribute("aria-expanded", "false");
}

menuButton?.addEventListener("click", () => {
  if (sidebar?.classList.contains("sidebar-open")) closeSidebar();
  else openSidebar();
});
closeButton?.addEventListener("click", closeSidebar);
backdrop?.addEventListener("click", closeSidebar);

// Center Elevated FAB Quick Add Actions
function openActionSheet() {
  actionSheet?.classList.add("active");
  actionSheetBackdrop?.classList.add("active");
}

function closeActionSheetModal() {
  actionSheet?.classList.remove("active");
  actionSheetBackdrop?.classList.remove("active");
}

fabQuickAdd?.addEventListener("click", openActionSheet);
closeActionSheet?.addEventListener("click", closeActionSheetModal);
actionSheetBackdrop?.addEventListener("click", closeActionSheetModal);

// Action Sheet Item Handlers
document.querySelectorAll("[data-action]").forEach(btn => {
  btn.addEventListener("click", () => {
    const action = btn.dataset.action;
    closeActionSheetModal();
    if (action === "quick-meal") {
      showPage("food");
      document.getElementById("foodSearchPanel")?.scrollIntoView({ behavior: "smooth" });
      setTimeout(() => document.getElementById("foodSearch")?.focus(), 400);
    } else if (action === "quick-weight") {
      showPage("weight");
    } else if (action === "quick-workout") {
      showPage("workouts");
    }
  });
});

document.getElementById("quickWaterAction")?.addEventListener("click", () => {
  closeActionSheetModal();
  addWater();
});

function showPage(pageId) {
  if (!pageNames[pageId]) return;
  document.querySelectorAll(".page-section").forEach(section =>
    section.classList.toggle("active-page", section.id === pageId)
  );
  document.querySelectorAll(".nav-link").forEach(button =>
    button.classList.toggle("active", button.dataset.page === pageId)
  );
  document.querySelectorAll(".mobile-tab-btn").forEach(button =>
    button.classList.toggle("active", button.dataset.page === pageId)
  );
  document.getElementById("pageTitle").textContent = pageNames[pageId];
  closeSidebar();

  if (pageId === "dashboard") renderDashboard();
  if (pageId === "food") renderFood();
  if (pageId === "weight") renderWeight();
  if (pageId === "progress") renderProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach(button =>
  button.addEventListener("click", () => showPage(button.dataset.page))
);
document.querySelectorAll(".mobile-tab-btn").forEach(button =>
  button.addEventListener("click", () => showPage(button.dataset.page))
);
document.querySelectorAll("[data-go]").forEach(button =>
  button.addEventListener("click", event => {
    event.preventDefault();
    showPage(button.dataset.go);
  })
);

// Dynamic Header Greeting and Date Labels
function updateHeaderGreeting() {
  const hour = new Date().getHours();
  let greeting = "Good morning!";
  if (hour >= 12 && hour < 17) greeting = "Good afternoon!";
  else if (hour >= 17) greeting = "Good evening!";

  const greetingEl = document.getElementById("dynamicGreeting");
  if (greetingEl) greetingEl.textContent = greeting;

  const dateStr = new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });
  const dateLabel = document.getElementById("dynamicDateLabel");
  if (dateLabel) dateLabel.textContent = dateStr;

  const todayShort = new Date().toLocaleDateString("en-US", {
    weekday: "short", day: "numeric", month: "short"
  });
  const todayLabel = document.getElementById("todayLabel");
  if (todayLabel) todayLabel.textContent = todayShort;
}


/* ==========================================================================
   SECTION 4: ACTIVE WORKOUT TRACKER & SET LOGGING (IMAGE 2)
   ========================================================================== */
function renderPrograms() {
  const container = document.getElementById("programGrid");
  container.innerHTML = programs.map(program => `
    <button class="program-card" type="button" data-program="${escapeHTML(program.id)}">
      <span class="program-number">${escapeHTML(program.number)}</span>
      <span class="eyebrow">${escapeHTML(program.category)}</span>
      <h3>${escapeHTML(program.name)}</h3>
      <p>${escapeHTML(program.description)}</p>
      <span class="program-card-footer">
        <span>${escapeHTML(program.duration)} / week</span>
        <span>View Plan ↗</span>
      </span>
    </button>`).join("");
  container.querySelectorAll("[data-program]").forEach(button =>
    button.addEventListener("click", () => openProgram(button.dataset.program))
  );
}

function openProgram(programId) {
  const program = programs.find(item => item.id === programId);
  if (!program) return;
  currentProgramId = programId;
  currentDayNumber = null;
  document.getElementById("programList").classList.add("hidden");
  document.getElementById("dayView").classList.remove("hidden");
  document.getElementById("workoutDetail").classList.add("hidden");
  document.getElementById("selectedProgramTitle").textContent = program.name;
  document.getElementById("selectedProgramDescription").textContent = program.description;

  const dayGrid = document.getElementById("dayGrid");
  dayGrid.innerHTML = program.days.map(day => `
    <button class="day-card" type="button" data-day="${day.day}">
      <span class="day-number">${String(day.day).padStart(2, "0")}</span>
      <span class="day-card-copy">
        <h3>Day ${day.day} · ${escapeHTML(day.title)}</h3>
        <p>${day.exercises.length} exercises · Tap to begin</p>
      </span>
      <span class="day-arrow">→</span>
    </button>`).join("");
  dayGrid.querySelectorAll("[data-day]").forEach(button =>
    button.addEventListener("click", () => openWorkout(Number(button.dataset.day)))
  );
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.getElementById("backToPrograms").addEventListener("click", () => {
  document.getElementById("programList").classList.remove("hidden");
  document.getElementById("dayView").classList.add("hidden");
  document.getElementById("workoutDetail").classList.add("hidden");
});
document.getElementById("backToDays").addEventListener("click", () => {
  document.getElementById("dayView").classList.remove("hidden");
  document.getElementById("workoutDetail").classList.add("hidden");
});

function getCurrentDay() {
  const program = programs.find(item => item.id === currentProgramId);
  return program?.days.find(item => item.day === currentDayNumber) || null;
}

function draftKey() {
  return `${currentProgramId}:${currentDayNumber}`;
}

function openWorkout(dayNumber) {
  const program = programs.find(item => item.id === currentProgramId);
  if (!program) return;
  const day = program.days.find(item => item.day === dayNumber);
  if (!day) return;
  stopRestTimer(false);
  restTimerRemaining = 90;
  currentDayNumber = dayNumber;
  document.getElementById("dayView").classList.add("hidden");
  document.getElementById("workoutDetail").classList.remove("hidden");
  document.getElementById("workoutTitle").textContent = `DAY ${String(day.day).padStart(2, "0")} · ${day.title.toUpperCase()}`;
  document.getElementById("workoutSubtitle").textContent = day.subtitle || `${day.title} Workout`;
  document.getElementById("workoutDescription").textContent = day.description || program.description;
  document.getElementById("exerciseCount").textContent = `${day.exercises.length} Exercises`;
  document.getElementById("workoutSeriesBadge").textContent = `${day.exercises.reduce((a,b)=>a+b.sets, 0)} Total Sets`;

  document.getElementById("workoutLogMessage").textContent = "";
  document.getElementById("restTimerStatus").textContent = "Ready when you are.";
  document.getElementById("restTimerDisplay").textContent = "01:30";
  document.getElementById("restTimerDisplay").classList.remove("timer-running");

  expandedExerciseIndex = 0;
  renderExercises(day);
  renderWorkoutLogger(day);
  restoreWorkoutDraft(day);
  updateWorkoutProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function previousSetPerformance(exerciseName, setIndex) {
  const latestLogs = workoutLogs.slice().reverse();
  for (const log of latestLogs) {
    const exercise = (log.exercises || []).find(item => item.name === exerciseName);
    if (!exercise) continue;
    const set = (exercise.sets || [])[setIndex];
    if (set && isCompletedSet(set)) {
      return { weight: numberValue(set.weight), reps: numberValue(set.reps) };
    }
  }
  return null;
}

function renderExercises(day) {
  const container = document.getElementById("exerciseList");
  const draft = workoutDrafts[draftKey()];
  const setDrafts = draft?.sets || {};

  container.innerHTML = day.exercises.map((exercise, index) => {
    const isExpanded = index === expandedExerciseIndex;
    const previous = previousSetPerformance(exercise.name, 0);
    const doneCount = Array.from({ length: exercise.sets }, (_, setIndex) =>
      setDrafts[`${index}-${setIndex}`]?.completed ? 1 : 0
    ).reduce((a, b) => a + b, 0);

    return `
      <article class="exercise-card ${isExpanded ? "is-expanded" : ""} ${doneCount === exercise.sets ? "is-complete" : ""}" data-exercise-card="${index}">
        <button type="button" class="exercise-card-toggle" data-exercise-toggle="${index}" aria-expanded="${isExpanded}">
          <span class="exercise-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="exercise-title-block">
            <h3>${escapeHTML(exercise.name)}</h3>
            <p>${escapeHTML(exercise.description)}</p>
          </span>
          <span class="exercise-tags">
            <span class="tag">${exercise.sets} Sets</span>
            <span class="tag">${escapeHTML(exercise.reps)} Reps</span>
            <span class="tag rest">⏱ ${escapeHTML(exercise.rest)}</span>
          </span>
          <span class="exercise-chevron" aria-hidden="true">${isExpanded ? "▲" : "▼"}</span>
        </button>
        <div class="exercise-card-summary">
          <span class="summary-check">${doneCount === exercise.sets ? "✓" : "•"}</span>
          <span data-card-summary="${index}">${doneCount === exercise.sets ? "Completed" : `${doneCount} / ${exercise.sets} sets complete`}</span>
          <span class="summary-best">${previous ? `Prev: ${formatDecimal(previous.weight)}kg × ${formatDecimal(previous.reps)}` : ""}</span>
        </div>
        <div class="exercise-card-body" data-exercise-body="${index}" ${isExpanded ? "" : "hidden"}>
          <div class="exercise-log-slot" data-log-slot="${index}"></div>
        </div>
      </article>`;
  }).join("");
}

// Set Logger styled directly like Image 2
function renderWorkoutLogger(day) {
  day.exercises.forEach((exercise, exerciseIndex) => {
    const slot = document.querySelector(`[data-log-slot="${exerciseIndex}"]`);
    if (!slot) return;
    const isFinisher = exercise.name.includes("Finisher");
    const restSecs = restSecondsFromText(exercise.rest);

    const setsHtml = Array.from({ length: exercise.sets }, (_, setIndex) => {
      const prev = previousSetPerformance(exercise.name, setIndex);
      const prevText = prev ? `PREV: ${formatDecimal(prev.weight)}kg × ${formatDecimal(prev.reps)}` : "PREV: —";

      return `
        <div class="set-row" data-set-row="${exerciseIndex}-${setIndex}">
          <div class="set-row-header">
            <span class="set-badge">SET ${setIndex + 1} OF ${exercise.sets}</span>
            <span class="previous-set-value">${prevText}</span>
          </div>

          <!-- 3-Pill Input Group (SETS | REPS | WEIGHT) Image 2 -->
          <div class="set-inputs-row">
            <div class="input-pill-group">
              <span class="input-pill-label">SETS</span>
              <div class="input-pill-box">
                <span class="set-display-static">${setIndex + 1}</span>
              </div>
            </div>

            <div class="input-pill-group">
              <span class="input-pill-label">${isFinisher ? "REPS/SIDE" : "REPS"}</span>
              <div class="input-pill-box">
                <input id="reps-${exerciseIndex}-${setIndex}" name="reps-${exerciseIndex}-${setIndex}" form="workoutLogForm" type="number" min="0" max="1000" step="1" placeholder="Reps" inputmode="numeric" aria-label="Reps">
              </div>
            </div>

            <div class="input-pill-group">
              <span class="input-pill-label">WEIGHT (KG)</span>
              <div class="input-pill-box">
                <input id="weight-${exerciseIndex}-${setIndex}" name="weight-${exerciseIndex}-${setIndex}" form="workoutLogForm" type="number" min="0" max="2000" step="0.25" placeholder="Weight" inputmode="decimal" aria-label="Weight">
              </div>
            </div>
          </div>

          <!-- Hidden checkbox for standard form submission / sync -->
          <input type="checkbox" id="done-${exerciseIndex}-${setIndex}" name="done-${exerciseIndex}-${setIndex}" form="workoutLogForm" class="hidden" aria-hidden="true">

          <!-- Prominent Glowing Cyan "LOG SET" Button (Image 2) -->
          <button type="button" class="log-set-btn" data-log-set-btn="${exerciseIndex}-${setIndex}">
            Log Set
          </button>

          <div class="set-secondary-bar">
            <button type="button" class="quick-rest-link" data-start-rest="${restSecs}">
              ⏱ Start ${restSecs}s Rest
            </button>
          </div>
        </div>`;
    }).join("");

    slot.innerHTML = setsHtml;
  });

  const exerciseList = document.getElementById("exerciseList");
  exerciseList.oninput = handleWorkoutDraftChange;
  exerciseList.onchange = handleWorkoutDraftChange;
  exerciseList.onclick = handleExerciseListClick;
}

function handleExerciseListClick(event) {
  // Handle the high-impact "LOG SET" button from Image 2
  const logBtn = event.target.closest("[data-log-set-btn]");
  if (logBtn) {
    const key = logBtn.dataset.logSetBtn;
    const checkbox = document.getElementById(`done-${key}`);
    const row = logBtn.closest(".set-row");
    if (checkbox) {
      checkbox.checked = !checkbox.checked;
      row?.classList.toggle("set-complete", checkbox.checked);
      logBtn.textContent = checkbox.checked ? "Completed ✓" : "Log Set";
      if (checkbox.checked) {
        // Start rest timer automatically when completing a set
        const restBtn = row?.querySelector("[data-start-rest]");
        if (restBtn) startRestTimer(Number(restBtn.dataset.startRest));
      }
      saveWorkoutDraft();
      updateWorkoutProgress();
    }
    return;
  }

  const timerButton = event.target.closest("[data-start-rest]");
  if (timerButton) {
    startRestTimer(Number(timerButton.dataset.startRest));
    return;
  }

  const toggle = event.target.closest("[data-exercise-toggle]");
  if (!toggle) return;
  const index = Number(toggle.dataset.exerciseToggle);

  expandedExerciseIndex = (expandedExerciseIndex === index) ? -1 : index;

  document.querySelectorAll("#exerciseList [data-exercise-card]").forEach(card => {
    const cardIndex = Number(card.dataset.exerciseCard);
    const shouldExpand = cardIndex === expandedExerciseIndex;
    card.classList.toggle("is-expanded", shouldExpand);
    const btn = card.querySelector("[data-exercise-toggle]");
    const body = card.querySelector("[data-exercise-body]");
    const chevron = card.querySelector(".exercise-chevron");
    if (btn) btn.setAttribute("aria-expanded", String(shouldExpand));
    if (body) body.hidden = !shouldExpand;
    if (chevron) chevron.textContent = shouldExpand ? "▲" : "▼";
  });
}

function handleWorkoutDraftChange(event) {
  if (event.target.matches('input[type="checkbox"]')) {
    const row = event.target.closest(".set-row");
    if (row) row.classList.toggle("set-complete", Boolean(event.target.checked));
  }
  saveWorkoutDraft();
  updateWorkoutProgress();
}

function restoreWorkoutDraft(day) {
  const draft = workoutDrafts[draftKey()];
  if (!draft) {
    document.getElementById("workoutNotes").value = "";
    return;
  }
  const form = document.getElementById("workoutLogForm");
  if (typeof draft.notes === "string") document.getElementById("workoutNotes").value = draft.notes;
  day.exercises.forEach((exercise, exerciseIndex) => {
    for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
      const values = draft.sets?.[`${exerciseIndex}-${setIndex}`];
      if (!values) continue;
      const weight = form.elements.namedItem(`weight-${exerciseIndex}-${setIndex}`);
      const reps = form.elements.namedItem(`reps-${exerciseIndex}-${setIndex}`);
      const done = form.elements.namedItem(`done-${exerciseIndex}-${setIndex}`);
      if (weight && values.weight !== undefined) weight.value = values.weight;
      if (reps && values.reps !== undefined) reps.value = values.reps;
      if (done) {
        done.checked = Boolean(values.completed);
        const row = done.closest(".set-row");
        if (row) {
          row.classList.toggle("set-complete", Boolean(done.checked));
          const btn = row.querySelector(".log-set-btn");
          if (btn) btn.textContent = done.checked ? "Completed ✓" : "Log Set";
        }
      }
    }
  });
}

function saveWorkoutDraft() {
  if (!currentProgramId || currentDayNumber === null) return;
  const draft = { notes: document.getElementById("workoutNotes").value, sets: {} };
  document.querySelectorAll("#exerciseList .set-row").forEach(row => {
    const weight = row.querySelector('input[name^="weight-"]');
    const reps = row.querySelector('input[name^="reps-"]');
    const done = row.querySelector('input[type="checkbox"]');
    const key = weight?.name.replace("weight-", "");
    if (key) {
      draft.sets[key] = {
        weight: weight.value,
        reps: reps.value,
        completed: Boolean(done?.checked)
      };
    }
  });
  workoutDrafts[draftKey()] = draft;
  if (writeStorage(STORAGE_KEYS.drafts, workoutDrafts)) {
    document.getElementById("workoutSaveHint").textContent = "Draft autosaved on device";
  } else {
    document.getElementById("workoutSaveHint").textContent = "Storage limit reached";
  }
}

document.getElementById("workoutNotes").addEventListener("input", saveWorkoutDraft);

function updateWorkoutProgress() {
  const form = document.getElementById("workoutLogForm");
  if (!form) return;
  const rows = [...document.querySelectorAll("#exerciseList .set-row")];
  const completedRows = rows.filter(row => row.querySelector('input[type="checkbox"]').checked);
  const completed = completedRows.length;
  const total = rows.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;

  document.getElementById("workoutProgressText").textContent = `${completed} / ${total} sets`;
  document.getElementById("workoutProgressFill").style.width = `${percent}%`;

  const ring = document.getElementById("workoutProgressRing");
  if (ring) {
    ring.style.setProperty("--progress", `${percent}%`);
    ring.setAttribute("aria-label", `${percent} percent workout complete`);
    document.getElementById("workoutProgressPercent").textContent = `${percent}%`;
  }

  const progressBar = document.getElementById("workoutProgressBar");
  progressBar.setAttribute("aria-valuenow", String(percent));

  document.querySelectorAll("#exerciseList .exercise-card").forEach(card => {
    const index = Number(card.dataset.exerciseCard);
    const cardRows = [...card.querySelectorAll(".set-row")];
    const doneCount = cardRows.filter(row => row.querySelector('input[type="checkbox"]').checked).length;
    card.classList.toggle("is-complete", doneCount === cardRows.length && cardRows.length > 0);
    const summary = card.querySelector(`[data-card-summary="${index}"]`);
    const check = card.querySelector(".summary-check");
    if (summary) {
      summary.textContent = (doneCount === cardRows.length && cardRows.length > 0)
        ? "Completed"
        : `${doneCount} / ${cardRows.length} sets complete`;
    }
    if (check) check.textContent = (doneCount === cardRows.length && cardRows.length > 0) ? "✓" : "•";
  });
}

document.getElementById("workoutLogForm").addEventListener("submit", event => {
  event.preventDefault();
  const program = programs.find(item => item.id === currentProgramId);
  const day = getCurrentDay();
  if (!program || !day) return;
  const form = event.currentTarget;
  const exercises = day.exercises.map((exercise, exerciseIndex) => ({
    name: exercise.name,
    sets: Array.from({ length: exercise.sets }, (_, setIndex) => {
      const weightInput = form.elements.namedItem(`weight-${exerciseIndex}-${setIndex}`);
      const repsInput = form.elements.namedItem(`reps-${exerciseIndex}-${setIndex}`);
      const doneInput = form.elements.namedItem(`done-${exerciseIndex}-${setIndex}`);
      return {
        weight: numberValue(weightInput?.value),
        reps: numberValue(repsInput?.value),
        completed: Boolean(doneInput?.checked)
      };
    })
  }));
  const completedSets = exercises.flatMap(exercise => exercise.sets).filter(set => set.completed);
  const message = document.getElementById("workoutLogMessage");

  if (!completedSets.length) {
    message.textContent = "Log at least one set before finalizing.";
    message.style.color = "var(--danger)";
    return;
  }

  const log = {
    id: makeId(),
    date: todayString(),
    programId: program.id,
    programName: program.name,
    day: day.day,
    dayTitle: day.title,
    exercises,
    completedSetCount: completedSets.length,
    totalSetCount: exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    notes: document.getElementById("workoutNotes").value.trim()
  };
  workoutLogs.push(log);
  const saved = writeStorage(STORAGE_KEYS.workouts, workoutLogs);
  if (!saved) {
    workoutLogs.pop();
    message.textContent = "Storage error. Check local storage permissions.";
    message.style.color = "var(--danger)";
    return;
  }
  delete workoutDrafts[draftKey()];
  writeStorage(STORAGE_KEYS.drafts, workoutDrafts);
  message.textContent = `Session saved: ${completedSets.length} sets completed!`;
  message.style.color = "var(--accent)";

  renderExercises(day);
  renderWorkoutLogger(day);
  restoreWorkoutDraft(day);
  updateWorkoutProgress();
  renderDashboard();
  renderProgress();
});


/* ==========================================================================
   SECTION 5: REST INTERVAL TIMER
   ========================================================================== */
function restSecondsFromText(restText) {
  const text = String(restText || "").toLowerCase();
  const minuteMatch = text.match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*min/);
  if (minuteMatch) return Math.max(15, Number(minuteMatch[1]) * 60);
  const secondMatch = text.match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*sec/);
  if (secondMatch) return Math.max(15, Number(secondMatch[1]));
  return 60;
}

function secondsLabel(seconds) {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.max(0, seconds) % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function updateRestTimerDisplay() {
  const display = document.getElementById("restTimerDisplay");
  if (display) {
    display.textContent = secondsLabel(restTimerRemaining);
    display.classList.toggle("timer-running", Boolean(restTimerInterval));
  }
}

function startRestTimer(seconds = 90) {
  const requestedSeconds = Math.max(1, Math.round(numberValue(seconds) || 90));
  clearInterval(restTimerInterval);
  restTimerRemaining = requestedSeconds;
  restTimerEndsAt = Date.now() + requestedSeconds * 1000;
  document.getElementById("restTimerStatus").textContent = "Rest running. Breathe and hydrate for your next set.";
  updateRestTimerDisplay();
  restTimerInterval = window.setInterval(() => {
    restTimerRemaining = Math.max(0, Math.ceil((restTimerEndsAt - Date.now()) / 1000));
    updateRestTimerDisplay();
    if (restTimerRemaining <= 0) {
      clearInterval(restTimerInterval);
      restTimerInterval = null;
      restTimerEndsAt = 0;
      document.getElementById("restTimerStatus").textContent = "Rest complete — time to lift!";
      updateRestTimerDisplay();
    }
  }, 250);
}

function stopRestTimer(showStatus = true) {
  clearInterval(restTimerInterval);
  restTimerInterval = null;
  restTimerEndsAt = 0;
  if (showStatus) document.getElementById("restTimerStatus").textContent = "Timer skipped.";
  document.getElementById("restTimerDisplay")?.classList.remove("timer-running");
}

document.getElementById("startRestButton")?.addEventListener("click", () =>
  startRestTimer(restTimerRemaining > 0 ? restTimerRemaining : 90)
);
document.getElementById("addRestButton")?.addEventListener("click", () => {
  if (restTimerInterval) {
    restTimerEndsAt += 15000;
    restTimerRemaining = Math.max(0, Math.ceil((restTimerEndsAt - Date.now()) / 1000));
    updateRestTimerDisplay();
  } else {
    restTimerRemaining = Math.min(600, Math.max(15, restTimerRemaining + 15));
    updateRestTimerDisplay();
    document.getElementById("restTimerStatus").textContent = "+15 seconds added.";
  }
});
document.getElementById("skipRestButton")?.addEventListener("click", () => {
  stopRestTimer(true);
  restTimerRemaining = 0;
  updateRestTimerDisplay();
});


/* ==========================================================================
   SECTION 6: NUTRITION ENGINE, MACRO RINGS & FOOD DATABASE (IMAGE 1)
   ========================================================================== */
const FOOD_DATABASE = [
  {id:"oats-dry",name:"Oats, dry",category:"Grains",aliases:"rolled oats porridge breakfast",kcal:389,protein:16.9,carbs:66.3,fat:6.9,fiber:10.6,note:"Dry weight"},
  {id:"rice-white-cooked",name:"White rice, cooked",category:"Grains",aliases:"steamed rice chawal",kcal:130,protein:2.7,carbs:28.2,fat:0.3,fiber:0.4,note:"Cooked without oil"},
  {id:"rice-raw",name:"White rice, raw",category:"Grains",aliases:"uncooked chawal",kcal:365,protein:7.1,carbs:80,fat:0.7,fiber:1.3,note:"Dry weight"},
  {id:"brown-rice-cooked",name:"Brown rice, cooked",category:"Grains",aliases:"whole grain rice",kcal:123,protein:2.7,carbs:25.6,fat:1,fiber:1.6,note:"Cooked without oil"},
  {id:"atta",name:"Whole wheat flour (atta)",category:"Grains",aliases:"gehu wheat flour",kcal:340,protein:12,carbs:72,fat:1.7,fiber:10.7,note:"Dry flour"},
  {id:"poha-dry",name:"Poha, dry",category:"Grains",aliases:"flattened rice aval",kcal:350,protein:7,carbs:77,fat:1,fiber:3,note:"Before cooking"},
  {id:"whole-egg-boiled",name:"Whole egg, boiled",category:"Protein",aliases:"egg anda boiled egg",kcal:148,protein:13.4,carbs:1.1,fat:10.5,fiber:0,note:"Edible portion"},
  {id:"egg-white-boiled",name:"Egg white, boiled",category:"Protein",aliases:"egg whites anda white",kcal:52,protein:10.9,carbs:0.7,fat:0.2,fiber:0,note:"Cooked white only"},
  {id:"chicken-breast-raw",name:"Chicken breast, skinless raw",category:"Protein",aliases:"chicken breast non veg",kcal:168,protein:21.8,carbs:0,fat:9,fiber:0,note:"Raw weight"},
  {id:"chicken-breast-cooked",name:"Chicken breast, cooked",category:"Protein",aliases:"grilled boiled chicken",kcal:165,protein:31,carbs:0,fat:3.6,fiber:0,note:"Cooked skinless"},
  {id:"paneer",name:"Paneer, regular",category:"Dairy",aliases:"cottage cheese paneer",kcal:305,protein:18.9,carbs:2.4,fat:24.8,fiber:0,note:"Generic paneer"},
  {id:"milk-cow",name:"Cow milk, whole",category:"Dairy",aliases:"milk full fat",kcal:73,protein:3.3,carbs:4.9,fat:4.5,fiber:0,note:"Generic whole cow milk"},
  {id:"milk-toned",name:"Toned cow milk",category:"Dairy",aliases:"toned milk low fat",kcal:58,protein:3.1,carbs:4.8,fat:3,fiber:0,note:"Low fat milk"},
  {id:"curd",name:"Plain curd (dahi)",category:"Dairy",aliases:"yogurt yoghurt dahi",kcal:61,protein:3.5,carbs:4.7,fat:3.3,fiber:0,note:"Plain curd"},
  {id:"tofu",name:"Tofu, firm",category:"Protein",aliases:"soy paneer tofu",kcal:76,protein:8,carbs:1.9,fat:4.8,fiber:0.3,note:"Firm tofu"},
  {id:"soya-chunks-dry",name:"Soya chunks, dry",category:"Protein",aliases:"soy nuggets soya nuggets",kcal:345,protein:52,carbs:33,fat:0.5,fiber:13,note:"Dry weight"},
  {id:"whey-powder",name:"Whey protein powder",category:"Other",aliases:"whey protein supplement protein powder",kcal:400,protein:80,carbs:8,fat:6,fiber:1,note:"Standard scoop"},
  {id:"moong-dal-cooked",name:"Moong dal, cooked",category:"Pulses",aliases:"green gram yellow dal",kcal:105,protein:7,carbs:19,fat:0.4,fiber:7,note:"Cooked plain"},
  {id:"toor-dal-cooked",name:"Toor dal, cooked",category:"Pulses",aliases:"arhar dal pigeon pea",kcal:120,protein:7,carbs:20,fat:1.5,fiber:6,note:"Cooked plain"},
  {id:"chickpeas-cooked",name:"Chickpeas, cooked",category:"Pulses",aliases:"chana chole kabuli chana",kcal:164,protein:8.9,carbs:27.4,fat:2.6,fiber:7.6,note:"Boiled and drained"},
  {id:"rajma-cooked",name:"Rajma, cooked",category:"Pulses",aliases:"kidney beans",kcal:127,protein:8.7,carbs:22.8,fat:0.5,fiber:6.4,note:"Boiled beans"},
  {id:"banana",name:"Banana",category:"Fruit",aliases:"kela",kcal:89,protein:1.1,carbs:22.8,fat:0.3,fiber:2.6,note:"Edible portion"},
  {id:"apple",name:"Apple",category:"Fruit",aliases:"seb",kcal:52,protein:0.3,carbs:13.8,fat:0.2,fiber:2.4,note:"Raw apple"},
  {id:"potato-boiled",name:"Potato, boiled",category:"Vegetables",aliases:"aloo",kcal:87,protein:1.9,carbs:20.1,fat:0.1,fiber:1.8,note:"Boiled plain"},
  {id:"peanuts",name:"Peanuts, roasted",category:"Nuts & Seeds",aliases:"groundnuts moongphali",kcal:585,protein:24.4,carbs:21.3,fat:49.7,fiber:8.4,note:"Roasted"},
  {id:"almonds",name:"Almonds",category:"Nuts & Seeds",aliases:"badam",kcal:579,protein:21.2,carbs:21.6,fat:49.9,fiber:12.5,note:"Raw unsalted"}
];

let selectedFoodId = null;

function foodForId(id) {
  return FOOD_DATABASE.find(food => food.id === id) || null;
}

function getFoodMacros(food, grams) {
  const factor = Math.max(0, numberValue(grams)) / 100;
  return {
    calories: food.kcal * factor,
    protein: food.protein * factor,
    carbs: food.carbs * factor,
    fat: food.fat * factor,
    fiber: food.fiber * factor
  };
}

function renderFoodDatabase() {
  const search = document.getElementById("foodSearch").value.trim().toLowerCase();
  const category = document.getElementById("foodCategory").value;
  const foods = FOOD_DATABASE.filter(food =>
    (category === "all" || food.category === category) &&
    `${food.name} ${food.aliases} ${food.category}`.toLowerCase().includes(search)
  );
  const grid = document.getElementById("foodDatabaseGrid");
  document.getElementById("foodResultCount").textContent = `${foods.length} food${foods.length === 1 ? "" : "s"}`;
  document.getElementById("foodNoResults").classList.toggle("hidden", foods.length > 0);

  grid.innerHTML = foods.map(food => `
    <button type="button" class="food-option ${food.id === selectedFoodId ? "selected" : ""}" data-select-food="${escapeHTML(food.id)}">
      <span class="food-option-top">
        <span>
          <strong>${escapeHTML(food.name)}</strong>
          <span class="food-category">${escapeHTML(food.category)} · 100g</span>
        </span>
        <span class="food-kcal">${Math.round(food.kcal)} kcal</span>
      </span>
      <span class="food-macros">
        <span class="macro-tag p">P <b>${formatDecimal(food.protein)}g</b></span>
        <span class="macro-tag c">C <b>${formatDecimal(food.carbs)}g</b></span>
        <span class="macro-tag f">F <b>${formatDecimal(food.fat)}g</b></span>
      </span>
    </button>`).join("");

  grid.querySelectorAll("[data-select-food]").forEach(button =>
    button.addEventListener("click", () => selectFood(button.dataset.selectFood))
  );
}

function selectFood(foodId) {
  const food = foodForId(foodId);
  if (!food) return;
  selectedFoodId = foodId;
  document.getElementById("selectedFoodPanel").classList.remove("hidden");
  document.getElementById("selectedFoodName").textContent = food.name;
  document.getElementById("selectedFoodServing").textContent = `${food.note} · nutrition per 100g`;
  document.getElementById("foodAmount").value = "100";
  renderFoodDatabase();
  updateSelectedFoodPreview();
  document.getElementById("selectedFoodPanel")?.scrollIntoView({ behavior: "smooth" });
}

function updateSelectedFoodPreview() {
  const food = foodForId(selectedFoodId);
  if (!food) return;
  const grams = Math.max(0, numberValue(document.getElementById("foodAmount").value));
  const m = getFoodMacros(food, grams);
  document.getElementById("previewCalories").textContent = `${Math.round(m.calories)} kcal`;
  document.getElementById("previewProtein").textContent = `${formatDecimal(m.protein)} g`;
  document.getElementById("previewCarbs").textContent = `${formatDecimal(m.carbs)} g`;
  document.getElementById("previewFat").textContent = `${formatDecimal(m.fat)} g`;
  document.getElementById("previewFiber").textContent = `${formatDecimal(m.fiber)} g`;
  document.getElementById("foodCalculationHint").textContent = `Calculated for ${grams}g. ${food.note}.`;
}

function addSelectedFoodToDiary() {
  const food = foodForId(selectedFoodId);
  const grams = numberValue(document.getElementById("foodAmount").value);
  if (!food || grams <= 0 || grams > 5000) return;
  const macros = getFoodMacros(food, grams);
  const entry = {
    id: makeId(),
    date: todayString(),
    foodId: food.id,
    name: food.name,
    meal: document.getElementById("foodMealType").value,
    amount: grams,
    calories: Math.round(macros.calories),
    protein: roundMacro(macros.protein),
    carbs: roundMacro(macros.carbs),
    fat: roundMacro(macros.fat),
    fiber: roundMacro(macros.fiber),
    source: "database"
  };
  foodEntries.push(entry);
  if (!writeStorage(STORAGE_KEYS.food, foodEntries)) {
    foodEntries.pop();
    return;
  }
  renderFood();
  renderDashboard();
  document.getElementById("selectedFoodPanel").classList.add("hidden");
  document.getElementById("foodSearch").focus();
}

function roundMacro(value) {
  return Math.round(value * 10) / 10;
}

document.getElementById("foodSearch").addEventListener("input", renderFoodDatabase);
document.getElementById("foodCategory").addEventListener("change", renderFoodDatabase);
document.getElementById("foodAmount").addEventListener("input", updateSelectedFoodPreview);
document.getElementById("closeSelectedFood").addEventListener("click", () =>
  document.getElementById("selectedFoodPanel").classList.add("hidden")
);
document.getElementById("addSelectedFood").addEventListener("click", addSelectedFoodToDiary);

// Meal Cards "Add" Buttons (Image 1)
document.querySelectorAll("[data-add-meal]").forEach(btn => {
  btn.addEventListener("click", () => {
    const mealType = btn.dataset.addMeal;
    const select = document.getElementById("foodMealType");
    if (select) select.value = mealType;
    document.getElementById("foodSearchPanel")?.scrollIntoView({ behavior: "smooth" });
    document.getElementById("foodSearch")?.focus();
  });
});

// Custom Food Submission
document.getElementById("foodForm").addEventListener("submit", event => {
  event.preventDefault();
  const entry = {
    id: makeId(),
    date: todayString(),
    name: document.getElementById("foodName").value.trim(),
    meal: document.getElementById("customFoodMeal").value,
    calories: numberValue(document.getElementById("foodCalories").value),
    protein: numberValue(document.getElementById("foodProtein").value),
    carbs: numberValue(document.getElementById("foodCarbs").value),
    fat: numberValue(document.getElementById("foodFat").value),
    fiber: 0,
    source: "custom"
  };
  if (!entry.name) return;
  foodEntries.push(entry);
  if (!writeStorage(STORAGE_KEYS.food, foodEntries)) {
    foodEntries.pop();
    return;
  }
  event.currentTarget.reset();
  renderFood();
  renderDashboard();
});

// Render Nutrition Screen & SVG Rings (Image 1)
function renderFood() {
  const today = todayString();
  const entries = foodEntries.filter(entry => entry.date === today);
  const sum = field => entries.reduce((total, entry) => total + numberValue(entry[field]), 0);
  const totals = {
    calories: sum("calories"),
    protein: sum("protein"),
    carbs: sum("carbs"),
    fat: sum("fat")
  };

  // Main Calorie Ring (Radius 85, Circumference 534.07)
  const mainRing = document.getElementById("nutritionMainRingProgress");
  const calTotalEl = document.getElementById("foodCaloriesTotal");
  if (calTotalEl) calTotalEl.textContent = Math.round(totals.calories).toLocaleString("en-US");
  if (mainRing) {
    const circumference = 534.07;
    const progress = Math.min(1, totals.calories / userPrefs.calorieGoal);
    mainRing.style.strokeDashoffset = String(circumference - circumference * progress);
  }

  // 3 Mini Macro Rings (Radius 32, Circumference 201.06) (Image 1)
  const miniCircumference = 201.06;

  // Protein Ring (Cyan)
  document.getElementById("foodProteinTotal").textContent = Math.round(totals.protein);
  const proteinRing = document.getElementById("miniProteinRing");
  if (proteinRing) {
    const pProgress = Math.min(1, totals.protein / 140);
    proteinRing.style.strokeDashoffset = String(miniCircumference - miniCircumference * pProgress);
  }

  // Carbs Ring (Amber)
  document.getElementById("foodCarbsTotal").textContent = Math.round(totals.carbs);
  const carbsRing = document.getElementById("miniCarbsRing");
  if (carbsRing) {
    const cProgress = Math.min(1, totals.carbs / 250);
    carbsRing.style.strokeDashoffset = String(miniCircumference - miniCircumference * cProgress);
  }

  // Fat Ring (Rose)
  document.getElementById("foodFatTotal").textContent = Math.round(totals.fat);
  const fatRing = document.getElementById("miniFatRing");
  if (fatRing) {
    const fProgress = Math.min(1, totals.fat / 70);
    fatRing.style.strokeDashoffset = String(miniCircumference - miniCircumference * fProgress);
  }

  // Update Individual Meal Cards (Breakfast, Lunch, Dinner, Snacks)
  const mealSums = { Breakfast: 0, Lunch: 0, Dinner: 0, Snacks: 0 };
  entries.forEach(entry => {
    const meal = entry.meal || "Snacks";
    if (mealSums[meal] !== undefined) mealSums[meal] += numberValue(entry.calories);
    else mealSums.Snacks += numberValue(entry.calories);
  });

  const bEl = document.getElementById("mealKcalBreakfast");
  const lEl = document.getElementById("mealKcalLunch");
  const dEl = document.getElementById("mealKcalDinner");
  const sEl = document.getElementById("mealKcalSnacks");
  if (bEl) bEl.textContent = Math.round(mealSums.Breakfast);
  if (lEl) lEl.textContent = Math.round(mealSums.Lunch);
  if (dEl) dEl.textContent = Math.round(mealSums.Dinner);
  if (sEl) sEl.textContent = Math.round(mealSums.Snacks);

  // Render Logged Items List
  const list = document.getElementById("foodList");
  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">No foods logged today. Search the verified catalog or tap + Add above.</div>`;
    return;
  }
  const sortedEntries = entries.slice().reverse();
  list.innerHTML = sortedEntries.map(entry => {
    const portion = entry.amount ? `${numberValue(entry.amount)}g` : "Custom portion";
    return `
      <div class="entry-row">
        <div class="entry-copy">
          <strong>${escapeHTML(entry.name)} · <span style="color:var(--accent);">${escapeHTML(entry.meal || "Meal")}</span></strong>
          <span>${portion} · P ${formatDecimal(numberValue(entry.protein))}g · C ${formatDecimal(numberValue(entry.carbs))}g · F ${formatDecimal(numberValue(entry.fat))}g</span>
        </div>
        <div class="entry-value">${Math.round(numberValue(entry.calories))}<small>kcal</small></div>
        <button class="delete-button" data-delete-food="${escapeHTML(entry.id)}" aria-label="Delete entry">✕</button>
      </div>`;
  }).join("");

  list.querySelectorAll("[data-delete-food]").forEach(button =>
    button.addEventListener("click", () => {
      foodEntries = foodEntries.filter(entry => entry.id !== button.dataset.deleteFood);
      writeStorage(STORAGE_KEYS.food, foodEntries);
      renderFood();
      renderDashboard();
    })
  );
}


/* ==========================================================================
   SECTION 7: HYDRATION & BODY WEIGHT TRACKERS
   ========================================================================== */
function addWater() {
  waterEntries.push({ id: makeId(), date: todayString(), amount: 250 });
  if (!writeStorage(STORAGE_KEYS.water, waterEntries)) {
    waterEntries.pop();
    return;
  }
  renderDashboard();
  renderFood();
}
document.getElementById("dashboardWaterButton")?.addEventListener("click", addWater);

document.getElementById("weightDate").value = todayString();
document.getElementById("weightForm").addEventListener("submit", event => {
  event.preventDefault();
  const date = document.getElementById("weightDate").value;
  const weight = numberValue(document.getElementById("weightValue").value);
  if (!date || weight <= 0) return;
  const entry = { id: makeId(), date, weight };
  bodyWeights.push(entry);
  bodyWeights.sort((a, b) => a.date.localeCompare(b.date));
  if (!writeStorage(STORAGE_KEYS.weight, bodyWeights)) {
    bodyWeights = bodyWeights.filter(item => item.id !== entry.id);
    return;
  }
  document.getElementById("weightValue").value = "";
  renderWeight();
  renderDashboard();
});

function renderWeight() {
  const container = document.getElementById("weightHistory");
  const sorted = bodyWeights.slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    container.innerHTML = `<div class="empty-state">No body-weight measurements yet. Add your morning weight above.</div>`;
    return;
  }
  container.innerHTML = sorted.map(entry => `
    <div class="entry-row">
      <div class="entry-copy">
        <strong>${formatDate(entry.date)}</strong>
        <span>Body Weight Log</span>
      </div>
      <div class="entry-value">${numberValue(entry.weight).toFixed(1)} <small>kg</small></div>
      <button class="delete-button" data-delete-weight="${escapeHTML(entry.id)}" aria-label="Delete entry">✕</button>
    </div>`).join("");

  container.querySelectorAll("[data-delete-weight]").forEach(button =>
    button.addEventListener("click", () => {
      bodyWeights = bodyWeights.filter(entry => entry.id !== button.dataset.deleteWeight);
      writeStorage(STORAGE_KEYS.weight, bodyWeights);
      renderWeight();
      renderDashboard();
    })
  );
}


/* ==========================================================================
   SECTION 8: DASHBOARD OVERVIEW & SPARKLINE CHARTS (IMAGE 3)
   ========================================================================== */
function renderDashboard() {
  updateHeaderGreeting();
  const today = todayString();
  const todayFoods = foodEntries.filter(entry => entry.date === today);
  const calories = todayFoods.reduce((sum, entry) => sum + numberValue(entry.calories), 0);
  const protein = todayFoods.reduce((sum, entry) => sum + numberValue(entry.protein), 0);
  const water = waterEntries.filter(entry => entry.date === today).reduce((sum, entry) => sum + numberValue(entry.amount), 0);
  const latestWeight = bodyWeights.slice().sort((a, b) => b.date.localeCompare(a.date))[0];

  const goalLabel = document.getElementById("ringGoalValue");
  if (goalLabel) goalLabel.textContent = `/ ${userPrefs.calorieGoal.toLocaleString("en-US")} cal`;
  window.FitScene?.setProgress(Math.min(1, calories / userPrefs.calorieGoal));

  // Hero Calorie Ring (Radius 85, Circumference 534.07) (Image 3)
  const heroRing = document.getElementById("heroRingProgress");
  const dashCalEl = document.getElementById("dashboardCalories");
  const dashCalSmall = document.getElementById("dashboardCaloriesSmall");
  if (dashCalEl) dashCalEl.textContent = Math.round(calories).toLocaleString("en-US");
  if (dashCalSmall) dashCalSmall.textContent = Math.round(calories);

  if (heroRing) {
    const circumference = 534.07;
    const progress = Math.min(1, calories / userPrefs.calorieGoal);
    heroRing.style.strokeDashoffset = String(circumference - circumference * progress);
  }

  // 3-Metric Summary Strip (Consumed | Protein | Remaining)
  const remaining = Math.max(0, userPrefs.calorieGoal - Math.round(calories));
  const sConsumed = document.getElementById("stripConsumed");
  const sBurned = document.getElementById("stripBurned");
  const sRemaining = document.getElementById("stripRemaining");
  if (sConsumed) sConsumed.textContent = Math.round(calories).toLocaleString("en-US");
  if (sBurned) sBurned.textContent = `${Math.round(protein)}g`;
  if (sRemaining) sRemaining.textContent = remaining.toLocaleString("en-US");

  // Trend Cards
  const dashWeightEl = document.getElementById("dashboardWeight");
  if (dashWeightEl) dashWeightEl.textContent = latestWeight ? numberValue(latestWeight.weight).toFixed(1) : "—";

  // Hydration Strip
  const waterLabel = document.getElementById("dashboardWaterLabel");
  if (waterLabel) waterLabel.textContent = `${water} ml of ${userPrefs.waterGoal.toLocaleString("en-US")} ml`;

  // Mini Sparkline SVG Charts (Image 3)
  renderSparklines();

  // Recent Workouts
  const recent = document.getElementById("recentWorkoutLogs");
  const logs = workoutLogs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  if (!logs.length) {
    recent.innerHTML = `
      <div class="empty-icon-wrap" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 5v14M18 5v14M2 9v6M22 9v6M6 12h12"/></svg>
      </div>
      <p>No workouts logged yet. Complete a training session to see your progress here.</p>`;
    return;
  }
  recent.innerHTML = logs.map(log => `
    <div class="entry-row">
      <div class="entry-copy">
        <strong>${escapeHTML(log.dayTitle || "Workout")}</strong>
        <span>${escapeHTML(log.programName || "Training")} · ${formatDate(log.date)}</span>
      </div>
      <div class="entry-value">${log.completedSetCount || (log.exercises||[]).length} <small>sets done</small></div>
    </div>`).join("");
}

// Mini SVG Sparklines for Image 3 Dashboard
function renderSparklines() {
  const weightBox = document.getElementById("weightSparkline");
  const calorieBox = document.getElementById("calorieSparkline");

  if (weightBox) {
    const weights = bodyWeights.slice(-7).map(w => numberValue(w.weight));
    const data = weights.length >= 2 ? weights : [74.5, 74.2, 74.0, 73.8, 73.6];
    const min = Math.min(...data) - 0.5;
    const max = Math.max(...data) + 0.5;
    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * 140 + 4;
      const y = 24 - ((v - min) / (max - min)) * 20;
      return `${x},${y}`;
    }).join(" ");
    weightBox.innerHTML = `
      <svg viewBox="0 0 148 28">
        <polyline points="${points}" fill="none" stroke="#00DDF5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
  }

  if (calorieBox) {
    calorieBox.innerHTML = `
      <svg viewBox="0 0 148 28">
        <rect x="10" y="10" width="10" height="18" rx="3" fill="#242832"/>
        <rect x="34" y="6" width="10" height="22" rx="3" fill="#242832"/>
        <rect x="58" y="14" width="10" height="14" rx="3" fill="#242832"/>
        <rect x="82" y="4" width="10" height="24" rx="3" fill="#00DDF5"/>
        <rect x="106" y="8" width="10" height="20" rx="3" fill="#00DDF5"/>
        <rect x="130" y="12" width="10" height="16" rx="3" fill="#242832"/>
      </svg>`;
  }
}


/* ==========================================================================
   SECTION 9: PROGRESS ANALYTICS & SVG CHARTS
   ========================================================================== */
function getLoggedExerciseNames() {
  const names = new Set();
  workoutLogs.forEach(log => (log.exercises || []).forEach(exercise => names.add(exercise.name)));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function isCompletedSet(set) {
  return set.completed !== false && numberValue(set.reps) > 0;
}

function renderProgress() {
  const exerciseSelect = document.getElementById("progressExercise");
  const metricSelect = document.getElementById("progressMetric");
  const previousSelection = exerciseSelect.value;
  const names = getLoggedExerciseNames();

  exerciseSelect.innerHTML = names.length
    ? names.map(name => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join("")
    : `<option value="">No logged exercises yet</option>`;

  if (names.includes(previousSelection)) exerciseSelect.value = previousSelection;
  exerciseSelect.disabled = names.length === 0;
  drawProgressChart(exerciseSelect.value, metricSelect.value);
}

document.getElementById("progressExercise").addEventListener("change", () =>
  drawProgressChart(document.getElementById("progressExercise").value, document.getElementById("progressMetric").value)
);
document.getElementById("progressMetric").addEventListener("change", () =>
  drawProgressChart(document.getElementById("progressExercise").value, document.getElementById("progressMetric").value)
);

function drawProgressChart(exerciseName, metric) {
  const chart = document.getElementById("progressChart");
  const summary = document.getElementById("progressSummary");
  if (!exerciseName) {
    summary.textContent = "Your performance curve will appear here once you log sets.";
    chart.innerHTML = `<div class="empty-state">No workout data logged yet. Open Workouts and tap Log Set.</div>`;
    renderProgressHistory();
    return;
  }
  const sessions = workoutLogs.filter(log =>
    (log.exercises || []).some(exercise => exercise.name === exerciseName)
  ).map(log => {
    const exercise = log.exercises.find(item => item.name === exerciseName);
    const validSets = (exercise?.sets || []).filter(isCompletedSet);
    const value = metric === "weight"
      ? Math.max(0, ...validSets.map(set => numberValue(set.weight)))
      : Math.max(0, ...validSets.map(set => numberValue(set.reps)));
    return { date: log.date, value, label: log.dayTitle || "Workout" };
  }).filter(session => session.value > 0).sort((a, b) => a.date.localeCompare(b.date));

  if (!sessions.length) {
    summary.textContent = `No verified set records for ${exerciseName} yet.`;
    chart.innerHTML = `<div class="empty-state">Log sets for this exercise and finalize the session to see chart curves.</div>`;
    renderProgressHistory();
    return;
  }
  const best = Math.max(...sessions.map(session => session.value));
  const latest = sessions[sessions.length - 1].value;
  const unit = metric === "weight" ? "kg" : "reps";
  summary.textContent = `All-Time Best: ${formatDecimal(best)} ${unit} · Latest Session: ${formatDecimal(latest)} ${unit}`;

  const width = 720, height = 240, paddingLeft = 40, paddingRight = 20, paddingTop = 24, paddingBottom = 40;
  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom;
  const maxValue = Math.max(...sessions.map(session => session.value), 1);
  const yMax = maxValue * 1.15;

  const points = sessions.map((session, index) => {
    const x = sessions.length === 1 ? paddingLeft + chartWidth / 2 : paddingLeft + (index / (sessions.length - 1)) * chartWidth;
    const y = paddingTop + chartHeight - (session.value / yMax) * chartHeight;
    return { ...session, x, y };
  });

  const grid = Array.from({ length: 5 }, (_, index) => {
    const y = paddingTop + (index / 4) * chartHeight;
    const value = yMax - (index / 4) * yMax;
    return `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 4"/><text x="${paddingLeft - 8}" y="${y + 4}" text-anchor="end" fill="#8492a6" font-size="10" font-family="'JetBrains Mono', monospace">${value.toFixed(0)}</text>`;
  }).join("");

  const linePoints = points.map(point => `${point.x},${point.y}`).join(" ");
  const dots = points.map(point =>
    `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#00DDF5" stroke="#07080a" stroke-width="2.5"></circle>`
  ).join("");
  const labels = points.map((point, index) =>
    `<text x="${point.x}" y="${height - 14}" text-anchor="middle" fill="#8492a6" font-size="10" font-family="'JetBrains Mono', monospace">${escapeHTML(point.date.slice(5))}</text>`
  ).join("");

  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img">${grid}<polyline points="${linePoints}" fill="none" stroke="#00DDF5" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}${labels}</svg>`;
  renderProgressHistory();
}

function renderProgressHistory() {
  const container = document.getElementById("progressHistory");
  const selectedExercise = document.getElementById("progressExercise").value;
  const matchingLogs = workoutLogs.filter(log =>
    !selectedExercise || (log.exercises || []).some(exercise => exercise.name === selectedExercise)
  ).slice().sort((a, b) => b.date.localeCompare(a.date));

  if (!matchingLogs.length) {
    container.innerHTML = `<div class="empty-state">Saved training sessions will be archived here.</div>`;
    return;
  }
  container.innerHTML = matchingLogs.map(log => `
    <div class="entry-row">
      <div class="entry-copy">
        <strong>${escapeHTML(log.dayTitle || "Workout")} · ${formatDate(log.date)}</strong>
        <span>${escapeHTML(log.programName || "Training")} · ${log.completedSetCount || (log.exercises||[]).length} sets completed</span>
        ${log.notes ? `<span>Notes: ${escapeHTML(log.notes)}</span>` : ""}
      </div>
      <button class="delete-button" data-delete-workout="${escapeHTML(log.id)}" aria-label="Delete entry">✕</button>
    </div>`).join("");

  container.querySelectorAll("[data-delete-workout]").forEach(button =>
    button.addEventListener("click", () => {
      workoutLogs = workoutLogs.filter(log => log.id !== button.dataset.deleteWorkout);
      writeStorage(STORAGE_KEYS.workouts, workoutLogs);
      renderDashboard();
      renderProgress();
    })
  );
}


/* ==========================================================================
   SECTION 10: APPLICATION INITIALIZATION BOOTSTRAPPER
   ========================================================================== */
function initializeApp() {
  updateHeaderGreeting();
  renderPrograms();
  renderDashboard();
  renderFoodDatabase();
  renderFood();
  renderWeight();
  renderProgress();
}

// Kick off the application
initializeApp();
