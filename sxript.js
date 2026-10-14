"use strict";

/* =========================================================
   1. STORAGE AND HELPERS
========================================================= */
const STORAGE_KEYS = {
  workouts: "fittrack_workout_logs_v2",
  food: "fittrack_food_entries_v2",
  water: "fittrack_water_entries_v2",
  weight: "fittrack_body_weights_v2",
  drafts: "fittrack_workout_drafts_v1"
};

function readStorage(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.warn(`Could not read ${key} from localStorage.`, error);
    return [];
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not save ${key} to localStorage.`, error);
    return false;
  }
}

function readDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.drafts));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function todayString() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function formatDate(dateString) {
  if (!dateString) return "Unknown date";
  const date = new Date(`${dateString}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character]);
}

function numberValue(value) {
  if (value === "" || value === null || value === undefined) return 0;
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatDecimal(value, places = 1) {
  return Number(value).toFixed(places).replace(/\.0$/, "");
}

let workoutLogs = readStorage(STORAGE_KEYS.workouts);
let foodEntries = readStorage(STORAGE_KEYS.food);
let waterEntries = readStorage(STORAGE_KEYS.water);
let bodyWeights = readStorage(STORAGE_KEYS.weight);
let workoutDrafts = readDrafts();
let currentProgramId = null;
let currentDayNumber = null;
let restTimerInterval = null;
let restTimerEndsAt = 0;
let restTimerRemaining = 90;

/* =========================================================
   2. WORKOUT PROGRAMS
========================================================= */
const muscleBuildingDays = [
  {
    day: 1, title: "Chest + Triceps", subtitle: "Chest + Triceps Workout",
    description: "Build chest strength and size while developing strong, balanced triceps.",
    exercises: [
      { name: "Barbell Bench Press", sets: 4, reps: "6–8", rest: "2–3 min", description: "Main chest pressing movement." },
      { name: "Incline Dumbbell Press", sets: 3, reps: "8–10", rest: "2 min", description: "Focus on the upper chest." },
      { name: "Cable Fly", sets: 3, reps: "12–15", rest: "90 sec", description: "Controlled chest isolation." },
      { name: "Triceps Pushdown", sets: 3, reps: "10–12", rest: "90 sec", description: "Controlled triceps isolation." },
      { name: "Overhead Triceps Extension", sets: 3, reps: "10–15", rest: "90 sec", description: "Focus on the long head of the triceps." }
    ]
  },
  {
    day: 2, title: "Back + Biceps", subtitle: "Back + Biceps Workout",
    description: "Build back width, thickness and strong arms with controlled pulling movements.",
    exercises: [
      { name: "Lat Pulldown", sets: 4, reps: "8–12", rest: "2 min", description: "Focus on back width and controlled pulling." },
      { name: "Barbell Row", sets: 3, reps: "6–10", rest: "2–3 min", description: "Build overall back thickness." },
      { name: "Seated Cable Row", sets: 3, reps: "8–12", rest: "2 min", description: "Controlled horizontal pulling movement." },
      { name: "Barbell Curl", sets: 3, reps: "8–12", rest: "90 sec", description: "Heavy biceps-focused movement." },
      { name: "Hammer Curl", sets: 3, reps: "10–15", rest: "90 sec", description: "Develop the biceps and brachialis." }
    ]
  },
  {
    day: 3, title: "Legs", subtitle: "Legs Workout",
    description: "Build strong, balanced legs with focused quad, hamstring, glute and calf training.",
    exercises: [
      { name: "Barbell Squat", sets: 4, reps: "6–8", rest: "2–3 min", description: "Main compound movement for overall leg strength." },
      { name: "Romanian Deadlift", sets: 3, reps: "8–10", rest: "2 min", description: "Develop the hamstrings and glutes." },
      { name: "Leg Press", sets: 3, reps: "10–12", rest: "2 min", description: "Controlled quad-focused volume." },
      { name: "Leg Curl", sets: 3, reps: "10–15", rest: "90 sec", description: "Direct hamstring isolation." },
      { name: "Standing Calf Raise", sets: 4, reps: "10–15", rest: "90 sec", description: "Build stronger and fuller calves." }
    ]
  },
  {
    day: 4, title: "Shoulders + Arms", subtitle: "Delt + Arms Specialization",
    description: "Build wider delts, thicker arms and better upper-body proportions.",
    exercises: [
      { name: "Cable Lateral Raise", sets: 4, reps: "12–20", rest: "60–75 sec", description: "Lead with your elbow. Don't swing. Let the delt stretch and control the eccentric." },
      { name: "Machine Shoulder Press", sets: 3, reps: "6–10", rest: "2–3 min", description: "Heavy delt movement. Avoid ego lifting." },
      { name: "Reverse Pec Deck", sets: 4, reps: "12–20", rest: "60–90 sec", description: "Focus on the rear delt." },
      { name: "Machine / Cable Lateral Raise", sets: 3, reps: "10–15", rest: "60 sec", description: "Second lateral-delt stimulus." },
      { name: "Cable Overhead Triceps Extension", sets: 3, reps: "8–12", rest: "90 sec", description: "Prioritize the long head for upper-arm size." },
      { name: "Rope Pressdown", sets: 3, reps: "10–15", rest: "60–90 sec", description: "Hard lockout with controlled return." },
      { name: "Single-Arm Cable Pressdown", sets: 2, reps: "12–15 per arm", rest: "60 sec", description: "Focus on clean technique and symmetry." },
      { name: "EZ-Bar Curl", sets: 3, reps: "6–10", rest: "90–120 sec", description: "Controlled heavy curling without hip drive." },
      { name: "Preacher Curl", sets: 3, reps: "8–12", rest: "75–90 sec", description: "Control the bottom position." },
      { name: "Hammer Curl", sets: 2, reps: "10–15", rest: "60–90 sec", description: "Build brachialis and brachioradialis." },
      { name: "Delt + Triceps Finisher", sets: 2, reps: "15–25 + 15–20", rest: "Minimal rest", description: "Perform cable lateral raises immediately followed by rope pressdowns. Complete both movements in each round." }
    ]
  },
  {
    day: 5, title: "Upper Body", subtitle: "Upper Body Workout",
    description: "Build balanced upper-body development while giving additional attention to weak points.",
    exercises: [
      { name: "Incline Bench Press", sets: 3, reps: "8–10", rest: "2 min", description: "Upper-chest focused pressing movement." },
      { name: "Lat Pulldown", sets: 3, reps: "8–12", rest: "2 min", description: "Build back width with controlled pulling." },
      { name: "Seated Cable Row", sets: 3, reps: "8–12", rest: "2 min", description: "Add back thickness and upper-back volume." },
      { name: "Machine Shoulder Press", sets: 3, reps: "8–10", rest: "2 min", description: "Additional controlled shoulder volume." },
      { name: "Cable Lateral Raise", sets: 3, reps: "12–20", rest: "60 sec", description: "Extra lateral-delt volume." },
      { name: "EZ-Bar Curl", sets: 2, reps: "8–12", rest: "90 sec", description: "Additional controlled biceps work." },
      { name: "Rope Pressdown", sets: 2, reps: "10–15", rest: "60–90 sec", description: "Additional triceps volume." }
    ]
  }
];

const fatLossDays = [
  { day: 1, title: "Upper Body", exercises: [
    { name: "Machine Chest Press", sets: 3, reps: "10–12", rest: "90 sec", description: "Controlled chest pressing." },
    { name: "Lat Pulldown", sets: 3, reps: "10–12", rest: "90 sec", description: "Controlled back pulling." },
    { name: "Seated Cable Row", sets: 3, reps: "10–12", rest: "90 sec", description: "Build upper-back strength." },
    { name: "Machine Shoulder Press", sets: 2, reps: "10–12", rest: "90 sec", description: "Controlled shoulder work." },
    { name: "Cable Curl", sets: 2, reps: "12–15", rest: "60 sec", description: "Biceps isolation." }
  ] },
  { day: 2, title: "Lower Body", exercises: [
    { name: "Leg Press", sets: 3, reps: "10–12", rest: "2 min", description: "Controlled lower-body work." },
    { name: "Romanian Deadlift", sets: 3, reps: "10–12", rest: "2 min", description: "Train hamstrings and glutes." },
    { name: "Leg Curl", sets: 3, reps: "12–15", rest: "60–90 sec", description: "Hamstring isolation." },
    { name: "Standing Calf Raise", sets: 3, reps: "12–15", rest: "60 sec", description: "Calf training." }
  ] },
  { day: 3, title: "Cardio + Core", exercises: [
    { name: "Incline Treadmill Walk", sets: 1, reps: "15–25 min", rest: "As needed", description: "Choose a sustainable pace." },
    { name: "Plank", sets: 3, reps: "30–60 sec", rest: "60 sec", description: "Maintain a braced torso." },
    { name: "Dead Bug", sets: 3, reps: "10 per side", rest: "60 sec", description: "Move slowly with control." }
  ] },
  { day: 4, title: "Full Body", exercises: [
    { name: "Goblet Squat", sets: 3, reps: "10–12", rest: "90 sec", description: "Controlled squat movement." },
    { name: "Machine Chest Press", sets: 3, reps: "10–12", rest: "90 sec", description: "Chest training." },
    { name: "Lat Pulldown", sets: 3, reps: "10–12", rest: "90 sec", description: "Back training." },
    { name: "Cable Row", sets: 2, reps: "12–15", rest: "60–90 sec", description: "Controlled rowing." }
  ] },
  { day: 5, title: "Cardio + Mobility", exercises: [
    { name: "Steady-State Cardio", sets: 1, reps: "20–30 min", rest: "As needed", description: "Choose walking, cycling or another comfortable option." },
    { name: "Hip and Shoulder Mobility", sets: 2, reps: "5–10 min", rest: "As needed", description: "Move gently through comfortable ranges." }
  ] }
];

const strengthDays = [
  { day: 1, title: "Squat Focus", exercises: [
    { name: "Barbell Squat", sets: 4, reps: "3–5", rest: "3 min", description: "Use controlled technique." },
    { name: "Romanian Deadlift", sets: 3, reps: "6–8", rest: "2–3 min", description: "Train posterior-chain strength." },
    { name: "Leg Press", sets: 3, reps: "8–10", rest: "2 min", description: "Additional leg volume." }
  ] },
  { day: 2, title: "Bench Focus", exercises: [
    { name: "Barbell Bench Press", sets: 4, reps: "3–5", rest: "3 min", description: "Use a stable setup and controlled reps." },
    { name: "Incline Dumbbell Press", sets: 3, reps: "6–8", rest: "2 min", description: "Upper-chest assistance." },
    { name: "Triceps Pushdown", sets: 3, reps: "8–12", rest: "90 sec", description: "Triceps assistance." }
  ] },
  { day: 3, title: "Deadlift + Back", exercises: [
    { name: "Deadlift", sets: 3, reps: "3–5", rest: "3 min", description: "Maintain a braced position." },
    { name: "Lat Pulldown", sets: 3, reps: "6–10", rest: "2 min", description: "Back assistance." },
    { name: "Seated Cable Row", sets: 3, reps: "8–10", rest: "2 min", description: "Controlled back work." }
  ] },
  { day: 4, title: "Overhead + Upper Back", exercises: [
    { name: "Machine Shoulder Press", sets: 4, reps: "5–8", rest: "2–3 min", description: "Press with control." },
    { name: "Reverse Pec Deck", sets: 3, reps: "12–15", rest: "60–90 sec", description: "Rear-delt work." },
    { name: "Barbell Row", sets: 3, reps: "5–8", rest: "2–3 min", description: "Build back strength." }
  ] },
  { day: 5, title: "Technique + Accessories", exercises: [
    { name: "Paused Bench Press", sets: 3, reps: "4–6", rest: "2–3 min", description: "Use a controlled pause." },
    { name: "Goblet Squat", sets: 3, reps: "8–10", rest: "90 sec", description: "Practice consistent squat technique." },
    { name: "Hammer Curl", sets: 3, reps: "8–12", rest: "90 sec", description: "Arm accessory work." }
  ] }
];

const programs = [
  { id: "muscle", name: "Muscle Building", category: "HYPERTROPHY", duration: "5 days", number: "01", description: "Build muscle size, strength and balanced proportions.", days: muscleBuildingDays },
  { id: "fatloss", name: "Fat Loss", category: "CONDITIONING", duration: "5 days", number: "02", description: "Combine resistance training, cardio and recovery.", days: fatLossDays },
  { id: "strength", name: "Strength Training", category: "PERFORMANCE", duration: "5 days", number: "03", description: "Focus on compound lifts, technique and strength.", days: strengthDays }
];

/* =========================================================
   3. PAGE NAVIGATION
========================================================= */
const pageNames = { dashboard: "Dashboard", workouts: "Workouts", food: "Food diary", weight: "Body weight", progress: "Progress" };

function showPage(pageId) {
  if (!pageNames[pageId]) return;
  document.querySelectorAll(".page-section").forEach(section => section.classList.toggle("active-page", section.id === pageId));
  document.querySelectorAll(".nav-link").forEach(button => button.classList.toggle("active", button.dataset.page === pageId));
  document.getElementById("pageTitle").textContent = pageNames[pageId];
  document.getElementById("sidebar").classList.remove("sidebar-open");
  document.getElementById("menuButton").setAttribute("aria-expanded", "false");
  if (pageId === "dashboard") renderDashboard();
  if (pageId === "food") renderFood();
  if (pageId === "weight") renderWeight();
  if (pageId === "progress") renderProgress();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll(".nav-link").forEach(button => button.addEventListener("click", () => showPage(button.dataset.page)));
document.querySelectorAll("[data-go]").forEach(button => button.addEventListener("click", event => {
  event.preventDefault();
  showPage(button.dataset.go);
}));
document.getElementById("menuButton").addEventListener("click", () => {
  const sidebar = document.getElementById("sidebar");
  sidebar.classList.toggle("sidebar-open");
  document.getElementById("menuButton").setAttribute("aria-expanded", String(sidebar.classList.contains("sidebar-open")));
});
document.getElementById("todayLabel").textContent = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

/* =========================================================
   4. PROGRAM AND DAY NAVIGATION
========================================================= */
function renderPrograms() {
  const container = document.getElementById("programGrid");
  container.innerHTML = programs.map(program => `
    <button class="program-card" type="button" data-program="${escapeHTML(program.id)}">
      <span class="program-number">${escapeHTML(program.number)}</span><span class="eyebrow">${escapeHTML(program.category)}</span>
      <h3>${escapeHTML(program.name)}</h3><p>${escapeHTML(program.description)}</p>
      <span class="program-card-footer"><span>${escapeHTML(program.duration)} / week</span><span>View plan ↗</span></span>
    </button>`).join("");
  container.querySelectorAll("[data-program]").forEach(button => button.addEventListener("click", () => openProgram(button.dataset.program)));
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
      <span class="day-card-copy"><h3>Day ${day.day} · ${escapeHTML(day.title)}</h3><p>${day.exercises.length} exercises · View workout</p></span><span class="day-arrow">→</span>
    </button>`).join("");
  dayGrid.querySelectorAll("[data-day]").forEach(button => button.addEventListener("click", () => openWorkout(Number(button.dataset.day))));
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

function draftKey() { return `${currentProgramId}:${currentDayNumber}`; }

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
  document.getElementById("exerciseCount").textContent = `${day.exercises.length} exercises`;
  document.getElementById("recoveryContent").textContent = "Use controlled technique, follow the listed rest periods and stop if you experience sharp pain. Prioritize sleep, adequate food and recovery between sessions.";
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

let expandedExerciseIndex = 0;

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
  container.innerHTML = day.exercises.map((exercise, index) => {
    const isExpanded = index === expandedExerciseIndex;
    const previous = previousSetPerformance(exercise.name, 0);
    const draft = workoutDrafts[draftKey()];
    const setDrafts = draft?.sets || {};
    const doneCount = Array.from({ length: exercise.sets }, (_, setIndex) => setDrafts[`${index}-${setIndex}`]?.completed ? 1 : 0).reduce((a,b)=>a+b,0);
    return `
      <article class="exercise-card ${isExpanded ? "is-expanded" : ""} ${doneCount === exercise.sets ? "is-complete" : ""}" data-exercise-card="${index}">
        <button type="button" class="exercise-card-toggle" data-exercise-toggle="${index}" aria-expanded="${isExpanded}">
          <span class="exercise-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="exercise-title-block"><h3>${escapeHTML(exercise.name)}</h3><p>${escapeHTML(exercise.description)}</p></span>
          <span class="exercise-tags"><span class="tag">${exercise.sets} Sets</span><span class="tag">${escapeHTML(exercise.reps)} Reps</span><span class="tag rest">◴ ${escapeHTML(exercise.rest)} Rest</span></span>
          <span class="exercise-chevron" aria-hidden="true">${isExpanded ? "⌃" : "⌄"}</span>
        </button>
        <div class="exercise-card-summary"><span class="summary-check">${doneCount === exercise.sets ? "✓" : "•"}</span><span data-card-summary="${index}">${doneCount === exercise.sets ? "Completed" : `${doneCount} / ${exercise.sets} sets complete`}</span><span class="summary-best">${previous ? `Previous best: ${formatDecimal(previous.weight)} kg × ${formatDecimal(previous.reps)}` : ""}</span></div>
        <div class="exercise-card-body" data-exercise-body="${index}" ${isExpanded ? "" : "hidden"}><div class="exercise-log-slot" data-log-slot="${index}"></div></div>
      </article>`;
  }).join("");
}
/* =========================================================
   5. SET-BY-SET LOGGING, DRAFT SAVING AND SESSION PROGRESS
========================================================= */
function restSecondsFromText(restText) {
  const text = String(restText || "").toLowerCase();
  const minuteMatch = text.match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*min/);
  if (minuteMatch) return Math.max(15, Number(minuteMatch[1]) * 60);
  const secondMatch = text.match(/(\d+)\s*(?:-|–|to)?\s*(\d+)?\s*sec/);
  if (secondMatch) return Math.max(15, Number(secondMatch[1]));
  if (text.includes("minimal")) return 15;
  return 60;
}

function renderWorkoutLogger(day) {
  const container = document.getElementById("workoutLogInputs");
  container.innerHTML = day.exercises.map((exercise, exerciseIndex) => {
    const isFinisher = exercise.name === "Delt + Triceps Finisher";
    return `
      <div class="exercise-log-block" data-log-exercise="${exerciseIndex}">
        <div class="exercise-log-heading"><div><h3>${String(exerciseIndex + 1).padStart(2, "0")} · ${escapeHTML(exercise.name)}</h3><p>Target: ${exercise.sets} sets · ${escapeHTML(exercise.reps)} reps</p></div><span class="exercise-count" data-exercise-progress="${exerciseIndex}">0 / ${exercise.sets}</span></div>
        ${Array.from({ length: exercise.sets }, (_, setIndex) => `
          <div class="set-row" data-set-row="${exerciseIndex}-${setIndex}">
            <span class="set-label">Set ${setIndex + 1}</span>
            <div><label class="field-label" for="weight-${exerciseIndex}-${setIndex}">Weight (kg)</label><input id="weight-${exerciseIndex}-${setIndex}" name="weight-${exerciseIndex}-${setIndex}" type="number" min="0" max="2000" step="0.25" value="" placeholder="e.g. 40" inputmode="decimal" aria-label="${escapeHTML(exercise.name)} set ${setIndex + 1} weight in kilograms"></div>
            <div><label class="field-label" for="reps-${exerciseIndex}-${setIndex}">${isFinisher ? "Reps / side" : "Reps / duration"}</label><input id="reps-${exerciseIndex}-${setIndex}" name="reps-${exerciseIndex}-${setIndex}" type="number" min="0" max="1000" step="1" inputmode="numeric" placeholder="Completed" aria-label="${escapeHTML(exercise.name)} set ${setIndex + 1} completed reps or duration"></div>
            <button type="button" class="set-rest-button" data-start-rest="${restSecondsFromText(exercise.rest)}" aria-label="Start ${escapeHTML(exercise.rest)} rest for ${escapeHTML(exercise.name)}">Rest ${restSecondsFromText(exercise.rest)}s</button>
            <label class="set-check-label" for="done-${exerciseIndex}-${setIndex}"><input id="done-${exerciseIndex}-${setIndex}" name="done-${exerciseIndex}-${setIndex}" type="checkbox" aria-label="Mark ${escapeHTML(exercise.name)} set ${setIndex + 1} complete"><span>Done</span></label>
          </div>`).join("")}
      </div>`;
  }).join("");
  // Associate the generated controls with the workout form, even after their cards are mounted elsewhere.
  container.querySelectorAll("input").forEach(input => input.setAttribute("form", "workoutLogForm"));
  container.querySelectorAll("[data-log-exercise]").forEach(block => {
    const exerciseIndex = Number(block.dataset.logExercise);
    const exercise = day.exercises[exerciseIndex];
    block.querySelectorAll(".set-row").forEach((row, setIndex) => {
      const previous = previousSetPerformance(exercise.name, setIndex);
      const label = document.createElement("span");
      label.className = "previous-set-value";
      label.innerHTML = `<small>PREV</small><strong>${previous ? `${formatDecimal(previous.weight)}kg × ${formatDecimal(previous.reps)}` : "—"}</strong>`;
      const weightWrap = row.querySelector('input[name^="weight-"]')?.parentElement;
      if (weightWrap) row.insertBefore(label, weightWrap);
    });
    const slot = document.querySelector(`[data-log-slot="${exerciseIndex}"]`);
    if (slot) slot.appendChild(block);
  });
  const exerciseList = document.getElementById("exerciseList");
  exerciseList.oninput = handleWorkoutDraftChange;
  exerciseList.onchange = handleWorkoutDraftChange;
  exerciseList.onclick = event => {
    const timerButton = event.target.closest("[data-start-rest]");
    if (timerButton) {
      startRestTimer(Number(timerButton.dataset.startRest));
      return;
    }
    const toggle = event.target.closest("[data-exercise-toggle]");
    if (!toggle) return;
    const index = Number(toggle.dataset.exerciseToggle);
    expandedExerciseIndex = index;
    exerciseList.querySelectorAll("[data-exercise-card]").forEach(card => {
      const expanded = Number(card.dataset.exerciseCard) === index;
      card.classList.toggle("is-expanded", expanded);
      const button = card.querySelector("[data-exercise-toggle]");
      const body = card.querySelector("[data-exercise-body]");
      if (button) {
        button.setAttribute("aria-expanded", String(expanded));
        const chevron = button.querySelector(".exercise-chevron");
        if (chevron) chevron.textContent = expanded ? "⌃" : "⌄";
      }
      if (body) body.hidden = !expanded;
    });
  };
}

function handleWorkoutDraftChange(event) {
  if (event.target.matches("input")) {
    const row = event.target.closest(".set-row");
    if (row) row.classList.toggle("set-complete", Boolean(row.querySelector('input[type="checkbox"]').checked));
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
      if (done) done.checked = Boolean(values.completed);
      const row = done?.closest(".set-row");
      if (row) row.classList.toggle("set-complete", Boolean(done.checked));
    }
  });
}

function saveWorkoutDraft() {
  if (!currentProgramId || currentDayNumber === null) return;
  const form = document.getElementById("workoutLogForm");
  const draft = { notes: document.getElementById("workoutNotes").value, sets: {} };
  document.querySelectorAll("#exerciseList .set-row").forEach(row => {
    const weight = row.querySelector('input[name^="weight-"]');
    const reps = row.querySelector('input[name^="reps-"]');
    const done = row.querySelector('input[type="checkbox"]');
    const key = weight?.name.replace("weight-", "");
    if (key) draft.sets[key] = { weight: weight.value, reps: reps.value, completed: done.checked };
  });
  workoutDrafts[draftKey()] = draft;
  if (writeStorage(STORAGE_KEYS.drafts, workoutDrafts)) {
    document.getElementById("workoutSaveHint").textContent = "Draft saved on this device";
  } else {
    document.getElementById("workoutSaveHint").textContent = "Browser storage is unavailable";
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
  document.getElementById("workoutProgressHint").textContent = completed === total && total > 0
    ? "Every planned set is marked complete. Review your entries before saving."
    : `${percent}% complete · Tick a set after finishing it. Your draft is saved on this device.`;
  document.querySelectorAll("#exerciseList [data-log-exercise]").forEach(block => {
    const exerciseRows = [...block.querySelectorAll(".set-row")];
    const doneCount = exerciseRows.filter(row => row.querySelector('input[type="checkbox"]').checked).length;
    const progress = block.querySelector("[data-exercise-progress]");
    progress.textContent = `${doneCount} / ${exerciseRows.length}`;
    progress.style.color = doneCount === exerciseRows.length ? "var(--accent)" : "var(--muted)";
    const card = block.closest("[data-exercise-card]");
    if (card) {
      card.classList.toggle("is-complete", doneCount === exerciseRows.length);
      const summary = card.querySelector(`[data-card-summary="${block.dataset.logExercise}"]`);
      const check = card.querySelector(".summary-check");
      if (summary) summary.textContent = doneCount === exerciseRows.length ? "Completed" : `${doneCount} / ${exerciseRows.length} sets complete`;
      if (check) check.textContent = doneCount === exerciseRows.length ? "✓" : "•";
    }
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
    message.textContent = "Mark at least one completed set before saving this workout.";
    message.style.color = "var(--danger)";
    return;
  }
  const missingWeight = exercises.some((exercise, exerciseIndex) => exercise.sets.some((set, setIndex) => {
    const weightInput = form.elements.namedItem(`weight-${exerciseIndex}-${setIndex}`);
    return set.completed && weightInput && weightInput.value.trim() === "";
  }));
  if (missingWeight) {
    message.textContent = "Enter the weight for every set marked Done. Use 0 for bodyweight exercises.";
    message.style.color = "var(--danger)";
    return;
  }
  const invalidSet = completedSets.find(set => set.reps <= 0);
  if (invalidSet) {
    message.textContent = "Enter reps or duration greater than zero for every set marked Done.";
    message.style.color = "var(--danger)";
    return;
  }
  const log = {
    id: makeId(), date: todayString(), programId: program.id, programName: program.name,
    day: day.day, dayTitle: day.title, exercises,
    completedSetCount: completedSets.length,
    totalSetCount: exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0),
    notes: document.getElementById("workoutNotes").value.trim()
  };
  workoutLogs.push(log);
  const saved = writeStorage(STORAGE_KEYS.workouts, workoutLogs);
  if (!saved) {
    workoutLogs.pop();
    message.textContent = "Could not save the workout. Check that browser storage is enabled.";
    message.style.color = "var(--danger)";
    return;
  }
  delete workoutDrafts[draftKey()];
  writeStorage(STORAGE_KEYS.drafts, workoutDrafts);
  message.textContent = `Workout saved: ${completedSets.length} completed set${completedSets.length === 1 ? "" : "s"}. Progress is updated.`;
  message.style.color = "var(--accent)";
  document.querySelectorAll("#exerciseList .set-row").forEach(row => {
    row.querySelector('input[name^="weight-"]').value = "";
    row.querySelector('input[name^="reps-"]').value = "";
    row.querySelector('input[type="checkbox"]').checked = false;
    row.classList.remove("set-complete");
  });
  document.getElementById("workoutNotes").value = "";
  // Rebuild cards so the just-saved performance becomes the visible “previous” set.
  renderExercises(day);
  renderWorkoutLogger(day);
  restoreWorkoutDraft(day);
  updateWorkoutProgress();
  renderDashboard();
  renderProgress();
});

/* =========================================================
   6. REST TIMER
========================================================= */
function secondsLabel(seconds) {
  const mins = Math.floor(Math.max(0, seconds) / 60);
  const secs = Math.max(0, seconds) % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function updateRestTimerDisplay() {
  const display = document.getElementById("restTimerDisplay");
  display.textContent = secondsLabel(restTimerRemaining);
  display.classList.toggle("timer-running", Boolean(restTimerInterval));
}

function startRestTimer(seconds = 90) {
  const requestedSeconds = Math.max(1, Math.round(numberValue(seconds) || 90));
  clearInterval(restTimerInterval);
  restTimerRemaining = requestedSeconds;
  restTimerEndsAt = Date.now() + requestedSeconds * 1000;
  document.getElementById("restTimerStatus").textContent = "Rest timer running. Breathe and get ready for your next set.";
  updateRestTimerDisplay();
  restTimerInterval = window.setInterval(() => {
    restTimerRemaining = Math.max(0, Math.ceil((restTimerEndsAt - Date.now()) / 1000));
    updateRestTimerDisplay();
    if (restTimerRemaining <= 0) {
      clearInterval(restTimerInterval);
      restTimerInterval = null;
      restTimerEndsAt = 0;
      document.getElementById("restTimerStatus").textContent = "Rest complete — get ready for the next set.";
      updateRestTimerDisplay();
    }
  }, 250);
}

function stopRestTimer(showStatus = true) {
  clearInterval(restTimerInterval);
  restTimerInterval = null;
  restTimerEndsAt = 0;
  if (showStatus) document.getElementById("restTimerStatus").textContent = "Timer skipped. Start another rest when needed.";
  document.getElementById("restTimerDisplay").classList.remove("timer-running");
}

document.getElementById("startRestButton").addEventListener("click", () => startRestTimer(restTimerRemaining > 0 ? restTimerRemaining : 90));
document.getElementById("addRestButton").addEventListener("click", () => {
  if (restTimerInterval) {
    restTimerEndsAt += 15000;
    restTimerRemaining = Math.max(0, Math.ceil((restTimerEndsAt - Date.now()) / 1000));
    updateRestTimerDisplay();
  } else {
    restTimerRemaining = Math.min(600, Math.max(15, restTimerRemaining + 15));
    updateRestTimerDisplay();
    document.getElementById("restTimerStatus").textContent = "15 seconds added. Start the timer when ready.";
  }
});
document.getElementById("skipRestButton").addEventListener("click", () => {
  stopRestTimer(true);
  restTimerRemaining = 0;
  updateRestTimerDisplay();
});

/* Built-in generic food composition starter list. Values are approximate per 100 g edible portion. */
const FOOD_DATABASE = [
  {id:"oats-dry",name:"Oats, dry",category:"Grains",aliases:"rolled oats porridge breakfast",kcal:389,protein:16.9,carbs:66.3,fat:6.9,fiber:10.6,note:"Dry weight"},
  {id:"rice-white-cooked",name:"White rice, cooked",category:"Grains",aliases:"steamed rice chawal",kcal:130,protein:2.7,carbs:28.2,fat:0.3,fiber:0.4,note:"Cooked without oil"},
  {id:"rice-raw",name:"White rice, raw",category:"Grains",aliases:"uncooked chawal",kcal:365,protein:7.1,carbs:80,fat:0.7,fiber:1.3,note:"Dry weight"},
  {id:"brown-rice-cooked",name:"Brown rice, cooked",category:"Grains",aliases:"whole grain rice",kcal:123,protein:2.7,carbs:25.6,fat:1,fiber:1.6,note:"Cooked without oil"},
  {id:"atta",name:"Whole wheat flour (atta)",category:"Grains",aliases:"gehu wheat flour",kcal:340,protein:12,carbs:72,fat:1.7,fiber:10.7,note:"Dry flour"},
  {id:"poha-dry",name:"Poha, dry",category:"Grains",aliases:"flattened rice aval",kcal:350,protein:7,carbs:77,fat:1,fiber:3,note:"Before cooking; oil not included"},
  {id:"whole-egg-boiled",name:"Whole egg, boiled",category:"Protein",aliases:"egg anda boiled egg",kcal:148,protein:13.4,carbs:1.1,fat:10.5,fiber:0,note:"Edible portion, shell removed"},
  {id:"egg-white-boiled",name:"Egg white, boiled",category:"Protein",aliases:"egg whites anda white",kcal:52,protein:10.9,carbs:0.7,fat:0.2,fiber:0,note:"Cooked white only"},
  {id:"chicken-breast-raw",name:"Chicken breast, skinless raw",category:"Protein",aliases:"chicken breast non veg",kcal:168,protein:21.8,carbs:0,fat:9,fiber:0,note:"Raw weight; use raw weight consistently"},
  {id:"chicken-breast-cooked",name:"Chicken breast, cooked",category:"Protein",aliases:"grilled boiled chicken",kcal:165,protein:31,carbs:0,fat:3.6,fiber:0,note:"Cooked, skinless, no added oil; estimate"},
  {id:"paneer",name:"Paneer, regular",category:"Dairy",aliases:"cottage cheese paneer",kcal:305,protein:18.9,carbs:2.4,fat:24.8,fiber:0,note:"Generic regular paneer; brands differ"},
  {id:"milk-cow",name:"Cow milk, whole",category:"Dairy",aliases:"milk full fat",kcal:73,protein:3.3,carbs:4.9,fat:4.5,fiber:0,note:"Generic whole cow milk"},
  {id:"milk-toned",name:"Toned cow milk",category:"Dairy",aliases:"toned milk low fat",kcal:58,protein:3.1,carbs:4.8,fat:3,fiber:0,note:"Estimate; check your pack label"},
  {id:"milk-buffalo",name:"Buffalo milk, whole",category:"Dairy",aliases:"buffalo doodh",kcal:107,protein:3.7,carbs:8.4,fat:6.6,fiber:0,note:"Generic whole buffalo milk"},
  {id:"curd",name:"Plain curd (dahi)",category:"Dairy",aliases:"yogurt yoghurt dahi",kcal:61,protein:3.5,carbs:4.7,fat:3.3,fiber:0,note:"Plain full-fat curd; varies by milk"},
  {id:"tofu",name:"Tofu, firm",category:"Protein",aliases:"soy paneer tofu",kcal:76,protein:8,carbs:1.9,fat:4.8,fiber:0.3,note:"Generic firm tofu"},
  {id:"soya-chunks-dry",name:"Soya chunks, dry",category:"Protein",aliases:"soy nuggets soya nuggets",kcal:345,protein:52,carbs:33,fat:0.5,fiber:13,note:"Dry weight before soaking"},
  {id:"whey-powder",name:"Whey protein powder, generic",category:"Other",aliases:"whey protein supplement protein powder",kcal:400,protein:80,carbs:8,fat:6,fiber:1,note:"Generic estimate only; use brand label for accuracy"},
  {id:"moong-dal-cooked",name:"Moong dal, cooked",category:"Pulses",aliases:"green gram yellow dal",kcal:105,protein:7,carbs:19,fat:0.4,fiber:7,note:"Cooked plain; tadka/oil not included"},
  {id:"toor-dal-cooked",name:"Toor dal, cooked",category:"Pulses",aliases:"arhar dal pigeon pea",kcal:120,protein:7,carbs:20,fat:1.5,fiber:6,note:"Cooked plain; tadka/oil not included"},
  {id:"chickpeas-cooked",name:"Chickpeas, cooked",category:"Pulses",aliases:"chana chole kabuli chana",kcal:164,protein:8.9,carbs:27.4,fat:2.6,fiber:7.6,note:"Boiled and drained"},
  {id:"rajma-cooked",name:"Rajma, cooked",category:"Pulses",aliases:"kidney beans",kcal:127,protein:8.7,carbs:22.8,fat:0.5,fiber:6.4,note:"Boiled beans; gravy/oil not included"},
  {id:"besan",name:"Besan (gram flour), dry",category:"Pulses",aliases:"chickpea flour",kcal:387,protein:22,carbs:58,fat:6.7,fiber:10,note:"Dry flour before cooking"},
  {id:"banana",name:"Banana",category:"Fruit",aliases:"kela",kcal:89,protein:1.1,carbs:22.8,fat:0.3,fiber:2.6,note:"Edible portion, peel removed"},
  {id:"apple",name:"Apple",category:"Fruit",aliases:"seb",kcal:52,protein:0.3,carbs:13.8,fat:0.2,fiber:2.4,note:"Raw edible portion"},
  {id:"orange",name:"Orange",category:"Fruit",aliases:"santra",kcal:47,protein:0.9,carbs:11.8,fat:0.1,fiber:2.4,note:"Edible portion, peel removed"},
  {id:"potato-boiled",name:"Potato, boiled",category:"Vegetables",aliases:"aloo",kcal:87,protein:1.9,carbs:20.1,fat:0.1,fiber:1.8,note:"Boiled without butter/oil"},
  {id:"sweet-potato-boiled",name:"Sweet potato, boiled",category:"Vegetables",aliases:"shakarkandi",kcal:76,protein:1.4,carbs:17.7,fat:0.1,fiber:2.5,note:"Boiled without added fat"},
  {id:"spinach-cooked",name:"Spinach, cooked",category:"Vegetables",aliases:"palak",kcal:23,protein:3,carbs:3.8,fat:0.3,fiber:2.4,note:"Cooked without oil"},
  {id:"peanuts",name:"Peanuts, roasted",category:"Nuts & Seeds",aliases:"groundnuts moongphali",kcal:585,protein:24.4,carbs:21.3,fat:49.7,fiber:8.4,note:"Roasted; salted brands may differ"},
  {id:"almonds",name:"Almonds",category:"Nuts & Seeds",aliases:"badam",kcal:579,protein:21.2,carbs:21.6,fat:49.9,fiber:12.5,note:"Raw, unsalted"},
  {id:"walnuts",name:"Walnuts",category:"Nuts & Seeds",aliases:"akhrot",kcal:654,protein:15.2,carbs:13.7,fat:65.2,fiber:6.7,note:"Raw kernels"},
  {id:"ghee",name:"Ghee",category:"Other",aliases:"clarified butter",kcal:900,protein:0,carbs:0,fat:100,fiber:0,note:"Pure ghee; measure carefully"},
  {id:"cooking-oil",name:"Cooking oil",category:"Other",aliases:"oil sunflower groundnut olive",kcal:900,protein:0,carbs:0,fat:100,fiber:0,note:"Generic oil; all oil added to cooking counts"},
  {id:"sugar",name:"Sugar",category:"Other",aliases:"white sugar",kcal:387,protein:0,carbs:100,fat:0,fiber:0,note:"Dry sugar"}
];
let selectedFoodId = null;

function foodForId(id) { return FOOD_DATABASE.find(food => food.id === id) || null; }
function getFoodMacros(food, grams) {
  const factor = Math.max(0, numberValue(grams)) / 100;
  return { calories: food.kcal * factor, protein: food.protein * factor, carbs: food.carbs * factor, fat: food.fat * factor, fiber: food.fiber * factor };
}
function renderFoodDatabase() {
  const search = document.getElementById("foodSearch").value.trim().toLowerCase();
  const category = document.getElementById("foodCategory").value;
  const foods = FOOD_DATABASE.filter(food => (category === "all" || food.category === category) && `${food.name} ${food.aliases} ${food.category}`.toLowerCase().includes(search));
  const grid = document.getElementById("foodDatabaseGrid");
  document.getElementById("foodResultCount").textContent = `${foods.length} food${foods.length === 1 ? "" : "s"}`;
  document.getElementById("foodNoResults").classList.toggle("hidden", foods.length > 0);
  grid.innerHTML = foods.map(food => `<button type="button" class="food-option ${food.id === selectedFoodId ? "selected" : ""}" data-select-food="${escapeHTML(food.id)}" aria-pressed="${food.id === selectedFoodId}">
    <span class="food-option-top"><span><strong>${escapeHTML(food.name)}</strong><span class="food-category">${escapeHTML(food.category)} · per 100 g</span></span><span class="food-kcal">${Math.round(food.kcal)} kcal</span></span>
    <span class="food-macros"><span>P <b>${formatDecimal(food.protein)}</b></span><span>C <b>${formatDecimal(food.carbs)}</b></span><span>F <b>${formatDecimal(food.fat)}</b></span></span></button>`).join("");
  grid.querySelectorAll("[data-select-food]").forEach(button => button.addEventListener("click", () => selectFood(button.dataset.selectFood)));
}
function selectFood(foodId) {
  const food = foodForId(foodId);
  if (!food) return;
  selectedFoodId = foodId;
  document.getElementById("selectedFoodPanel").classList.remove("hidden");
  document.getElementById("selectedFoodName").textContent = food.name;
  document.getElementById("selectedFoodServing").textContent = `${food.note} · nutrition values per 100 g`;
  document.getElementById("foodAmount").value = "100";
  renderFoodDatabase(); updateSelectedFoodPreview();
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
  document.getElementById("foodCalculationHint").textContent = `Calculated for ${grams} g. ${food.note}.`;
}
function addSelectedFoodToDiary() {
  const food = foodForId(selectedFoodId);
  const grams = numberValue(document.getElementById("foodAmount").value);
  if (!food || grams <= 0 || grams > 5000) return;
  const macros = getFoodMacros(food, grams);
  const entry = { id: makeId(), date: todayString(), foodId: food.id, name: food.name, meal: document.getElementById("foodMealType").value, amount: grams,
    calories: Math.round(macros.calories), protein: roundMacro(macros.protein), carbs: roundMacro(macros.carbs), fat: roundMacro(macros.fat), fiber: roundMacro(macros.fiber), source: "database" };
  foodEntries.push(entry);
  if (!writeStorage(STORAGE_KEYS.food, foodEntries)) { foodEntries.pop(); return; }
  renderFood(); renderDashboard();
  document.getElementById("selectedFoodPanel").classList.add("hidden");
  document.getElementById("foodSearch").focus();
}
function roundMacro(value) { return Math.round(value * 10) / 10; }
document.getElementById("foodSearch").addEventListener("input", renderFoodDatabase);
document.getElementById("foodCategory").addEventListener("change", renderFoodDatabase);
document.getElementById("foodAmount").addEventListener("input", updateSelectedFoodPreview);
document.getElementById("closeSelectedFood").addEventListener("click", () => document.getElementById("selectedFoodPanel").classList.add("hidden"));
document.getElementById("addSelectedFood").addEventListener("click", addSelectedFoodToDiary);

/* =========================================================
   7. FOOD DIARY
========================================================= */
document.getElementById("foodForm").addEventListener("submit", event => {
  event.preventDefault();
  const entry = {
    id: makeId(), date: todayString(), name: document.getElementById("foodName").value.trim(),
    meal: document.getElementById("customFoodMeal").value,
    calories: numberValue(document.getElementById("foodCalories").value),
    protein: numberValue(document.getElementById("foodProtein").value),
    carbs: numberValue(document.getElementById("foodCarbs").value),
    fat: numberValue(document.getElementById("foodFat").value),
    fiber: numberValue(document.getElementById("foodFiber").value), source: "custom"
  };
  if (!entry.name) return;
  foodEntries.push(entry);
  if (!writeStorage(STORAGE_KEYS.food, foodEntries)) { foodEntries.pop(); return; }
  event.currentTarget.reset();
  renderFood(); renderDashboard();
});

function renderFood() {
  const today = todayString();
  const entries = foodEntries.filter(entry => entry.date === today);
  const sum = field => entries.reduce((total, entry) => total + numberValue(entry[field]), 0);
  const totals = { calories: sum("calories"), protein: sum("protein"), carbs: sum("carbs"), fat: sum("fat"), fiber: sum("fiber") };
  document.getElementById("foodCaloriesTotal").textContent = Math.round(totals.calories).toLocaleString("en-IN");
  document.getElementById("foodProteinTotal").textContent = formatDecimal(totals.protein);
  document.getElementById("foodCarbsTotal").textContent = formatDecimal(totals.carbs);
  document.getElementById("foodFatTotal").textContent = formatDecimal(totals.fat);
  document.getElementById("foodFiberTotal").textContent = formatDecimal(totals.fiber);
  document.getElementById("foodWaterTotal").textContent = waterEntries.filter(entry => entry.date === today).reduce((total, entry) => total + numberValue(entry.amount), 0);
  document.getElementById("foodDateLabel").textContent = formatDate(today);
  // Small progress bars are visual summaries, not dietary targets.
  const barConfig = [["foodCaloriesTrack",totals.calories,2500],["foodProteinTrack",totals.protein,120],["foodCarbsTrack",totals.carbs,300],["foodFatTrack",totals.fat,80],["foodFiberTrack",totals.fiber,30]];
  barConfig.forEach(([id,value,max]) => { const el=document.getElementById(id); if(el) el.style.width=`${Math.min(100,Math.max(0,value/max*100))}%`; });
  const list = document.getElementById("foodList");
  if (!entries.length) {
    list.innerHTML = `<div class="empty-state">No meals logged today. Search the built-in food list above to add your first entry.</div>`;
    return;
  }
  const mealOrder = ["Breakfast","Lunch","Snacks","Post-workout","Dinner"];
  const sortedEntries = entries.slice().reverse();
  list.innerHTML = sortedEntries.map(entry => {
    const portion = entry.amount ? `${numberValue(entry.amount)} g` : "Custom serving";
    return `<div class="entry-row food-entry-row"><div class="entry-copy food-entry-copy">
      <div class="food-entry-top"><div><div class="food-entry-title"><strong>${escapeHTML(entry.name)}</strong><span class="meal-badge">${escapeHTML(entry.meal || "Meal")}</span></div><span class="food-entry-amount">${portion}${entry.source === "database" ? " · calculated from food database" : " · custom entry"}</span></div></div>
      <div class="food-entry-macros"><span>${Math.round(numberValue(entry.calories))} kcal</span><span>P ${formatDecimal(numberValue(entry.protein))} g</span><span>C ${formatDecimal(numberValue(entry.carbs))} g</span><span>F ${formatDecimal(numberValue(entry.fat))} g</span><span>Fibre ${formatDecimal(numberValue(entry.fiber))} g</span></div>
    </div><button class="delete-button" data-delete-food="${escapeHTML(entry.id)}">Delete</button></div>`;
  }).join("");
  list.querySelectorAll("[data-delete-food]").forEach(button => button.addEventListener("click", () => {
    foodEntries = foodEntries.filter(entry => entry.id !== button.dataset.deleteFood);
    writeStorage(STORAGE_KEYS.food, foodEntries);
    renderFood(); renderDashboard();
  }));
}

/* =========================================================
   8. WATER TRACKER
========================================================= */
function addWater() {
  waterEntries.push({ id: makeId(), date: todayString(), amount: 250 });
  if (!writeStorage(STORAGE_KEYS.water, waterEntries)) {
    waterEntries.pop();
    return;
  }
  renderFood(); renderDashboard();
}
document.getElementById("addWaterButton").addEventListener("click", addWater);
document.getElementById("dashboardWaterButton").addEventListener("click", addWater);

/* =========================================================
   9. BODY WEIGHT TRACKER
========================================================= */
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
  renderWeight(); renderDashboard();
});

function renderWeight() {
  const container = document.getElementById("weightHistory");
  const sorted = bodyWeights.slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!sorted.length) {
    container.innerHTML = `<div class="empty-state">No body-weight measurements yet. Add your first entry above.</div>`;
    return;
  }
  container.innerHTML = sorted.map(entry => `
    <div class="entry-row"><div class="entry-copy"><strong>${formatDate(entry.date)}</strong><span>Body-weight measurement</span></div><div class="entry-value">${numberValue(entry.weight).toFixed(1)} kg</div><button class="delete-button" data-delete-weight="${escapeHTML(entry.id)}">Delete</button></div>`).join("");
  container.querySelectorAll("[data-delete-weight]").forEach(button => button.addEventListener("click", () => {
    bodyWeights = bodyWeights.filter(entry => entry.id !== button.dataset.deleteWeight);
    writeStorage(STORAGE_KEYS.weight, bodyWeights);
    renderWeight(); renderDashboard();
  }));
}

/* =========================================================
   10. PROGRESS CHART
========================================================= */
function getLoggedExerciseNames() {
  const names = new Set();
  workoutLogs.forEach(log => (log.exercises || []).forEach(exercise => names.add(exercise.name)));
  return [...names].sort((a, b) => a.localeCompare(b));
}

function isCompletedSet(set) {
  // Logs created by the older version do not have `completed`; retain those entries.
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

document.getElementById("progressExercise").addEventListener("change", () => drawProgressChart(document.getElementById("progressExercise").value, document.getElementById("progressMetric").value));
document.getElementById("progressMetric").addEventListener("change", () => drawProgressChart(document.getElementById("progressExercise").value, document.getElementById("progressMetric").value));

function drawProgressChart(exerciseName, metric) {
  const chart = document.getElementById("progressChart");
  const summary = document.getElementById("progressSummary");
  if (!exerciseName) {
    summary.textContent = "Your chart will appear after you save a workout.";
    chart.innerHTML = `<div class="chart-empty">No workout data yet. Open a workout and log your sets.</div>`;
    renderProgressHistory();
    return;
  }
  const sessions = workoutLogs.filter(log => (log.exercises || []).some(exercise => exercise.name === exerciseName)).map(log => {
    const exercise = log.exercises.find(item => item.name === exerciseName);
    const validSets = (exercise?.sets || []).filter(isCompletedSet);
    const value = metric === "weight"
      ? Math.max(0, ...validSets.map(set => numberValue(set.weight)))
      : Math.max(0, ...validSets.map(set => numberValue(set.reps)));
    return { date: log.date, value, label: log.dayTitle || "Workout" };
  }).filter(session => session.value > 0).sort((a, b) => a.date.localeCompare(b.date));

  if (!sessions.length) {
    summary.textContent = `No completed set data for ${exerciseName} yet.`;
    chart.innerHTML = `<div class="chart-empty">Tick completed sets and save the workout to track this exercise.</div>`;
    renderProgressHistory();
    return;
  }
  const best = Math.max(...sessions.map(session => session.value));
  const first = sessions[0].value;
  const latest = sessions[sessions.length - 1].value;
  const unit = metric === "weight" ? "kg" : "reps";
  const change = latest - first;
  summary.textContent = `Best: ${formatDecimal(best)} ${unit} · Latest: ${formatDecimal(latest)} ${unit} · Change from first logged session: ${change > 0 ? "+" : ""}${formatDecimal(change)} ${unit}`;

  const width = 720, height = 245, paddingLeft = 42, paddingRight = 22, paddingTop = 24, paddingBottom = 42;
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
    return `<line x1="${paddingLeft}" y1="${y}" x2="${width - paddingRight}" y2="${y}" stroke="#30363d" stroke-dasharray="4 5"/><text x="${paddingLeft - 8}" y="${y + 4}" text-anchor="end" fill="#a2ada0" font-size="10">${value.toFixed(0)}</text>`;
  }).join("");
  const linePoints = points.map(point => `${point.x},${point.y}`).join(" ");
  const dots = points.map(point => `<circle cx="${point.x}" cy="${point.y}" r="4.5" fill="#00DDF5" stroke="#091216" stroke-width="2"><title>${escapeHTML(formatDate(point.date))}: ${formatDecimal(point.value)} ${unit}</title></circle>`).join("");
  const labels = points.map((point, index) => {
    if (points.length > 7 && index % 2 !== 0 && index !== points.length - 1) return "";
    return `<text x="${point.x}" y="${height - 15}" text-anchor="middle" fill="#a2ada0" font-size="10">${escapeHTML(point.date.slice(5))}</text>`;
  }).join("");
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Progress chart for ${escapeHTML(exerciseName)}">${grid}<polyline points="${linePoints}" fill="none" stroke="#00DDF5" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>${dots}${labels}</svg>`;
  renderProgressHistory();
}

/* =========================================================
   11. WORKOUT HISTORY
========================================================= */
function renderProgressHistory() {
  const container = document.getElementById("progressHistory");
  const selectedExercise = document.getElementById("progressExercise").value;
  const matchingLogs = workoutLogs.filter(log => !selectedExercise || (log.exercises || []).some(exercise => exercise.name === selectedExercise)).slice().sort((a, b) => b.date.localeCompare(a.date));
  if (!matchingLogs.length) {
    container.innerHTML = `<div class="empty-state">Saved workout sessions will appear here.</div>`;
    return;
  }
  container.innerHTML = matchingLogs.map(log => {
    const exercises = (log.exercises || []).filter(exercise => !selectedExercise || exercise.name === selectedExercise);
    const summary = exercises.map(exercise => {
      const valid = (exercise.sets || []).filter(isCompletedSet);
      if (!valid.length) return `${exercise.name}: no completed sets`;
      const maxWeight = Math.max(0, ...valid.map(set => numberValue(set.weight)));
      const maxReps = Math.max(0, ...valid.map(set => numberValue(set.reps)));
      const count = valid.length;
      return `${exercise.name}: ${maxWeight} kg × ${maxReps} reps (${count} completed)`;
    }).join(" · ");
    const completeCount = log.completedSetCount ?? (log.exercises || []).flatMap(exercise => exercise.sets || []).filter(isCompletedSet).length;
    return `<div class="entry-row"><div class="entry-copy"><strong>${escapeHTML(log.dayTitle || "Workout")} · ${formatDate(log.date)}</strong><span>${escapeHTML(log.programName || "Training")} · ${completeCount} completed sets</span><span>${escapeHTML(summary)}</span>${log.notes ? `<span>Notes: ${escapeHTML(log.notes)}</span>` : ""}</div><button class="delete-button" data-delete-workout="${escapeHTML(log.id)}">Delete</button></div>`;
  }).join("");
  container.querySelectorAll("[data-delete-workout]").forEach(button => button.addEventListener("click", () => {
    workoutLogs = workoutLogs.filter(log => log.id !== button.dataset.deleteWorkout);
    writeStorage(STORAGE_KEYS.workouts, workoutLogs);
    renderDashboard();
    renderProgress();
  }));
}

/* =========================================================
   12. DASHBOARD
========================================================= */
function renderDashboard() {
  const today = todayString();
  const todayFoods = foodEntries.filter(entry => entry.date === today);
  const calories = todayFoods.reduce((sum, entry) => sum + numberValue(entry.calories), 0);
  const protein = todayFoods.reduce((sum, entry) => sum + numberValue(entry.protein), 0);
  const water = waterEntries.filter(entry => entry.date === today).reduce((sum, entry) => sum + numberValue(entry.amount), 0);
  const latestWeight = bodyWeights.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
  document.getElementById("dashboardCalories").textContent = Math.round(calories);
  document.getElementById("dashboardProtein").textContent = formatDecimal(protein);
  document.getElementById("dashboardWater").textContent = water;
  document.getElementById("dashboardWeight").textContent = latestWeight ? numberValue(latestWeight.weight).toFixed(1) : "—";
  const recent = document.getElementById("recentWorkoutLogs");
  const logs = workoutLogs.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  if (!logs.length) {
    recent.innerHTML = `<div class="empty-state">No workouts logged yet. Choose a program and save your first session.</div>`;
    return;
  }
  recent.innerHTML = logs.map(log => `<div class="entry-row"><div class="entry-copy"><strong>${escapeHTML(log.dayTitle || "Workout")}</strong><span>${escapeHTML(log.programName || "Training")} · ${formatDate(log.date)}</span><span>${log.completedSetCount ?? (log.exercises || []).flatMap(exercise => exercise.sets || []).filter(isCompletedSet).length} completed sets</span></div><div class="entry-value">${(log.exercises || []).length}<small>exercises</small></div></div>`).join("");
}

/* =========================================================
   13. INITIALIZE APP
========================================================= */
function initializeApp() {
  renderPrograms();
  renderDashboard();
  renderFoodDatabase();
  renderFood();
  renderWeight();
  renderProgress();
  document.getElementById("weightDate").value = todayString();
}

initializeApp();
