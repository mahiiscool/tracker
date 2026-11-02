// Tracker app, bundled into one file.
(function () {
"use strict";
const __m = {};

/* ===== js/db.js ===== */
__m['js/db.js'] = (function () {
// Small IndexedDB wrapper. No library needed.
const DB_NAME = 'fitness-tracker';
const DB_VERSION = 1;

// keyPath defaults to an auto increment "id". indexes lists the fields to look up by.
const STORES = {
  exercises:        { keyPath: 'id', auto: false, indexes: [] },
  planSlots:        { keyPath: 'id', auto: false, indexes: ['day', 'exerciseId'] },
  sessions:         { indexes: ['date', 'day'] },
  sets:             { indexes: ['sessionId', 'exerciseId', 'slotId'] },
  weeklyTargets:    { indexes: ['weekStart', 'slotId', 'exerciseId'] },
  weights:          { indexes: ['date'] },
  waist:            { indexes: ['date'] },
  foodEntries:      { indexes: ['date'] },
  foodPresets:      { indexes: [] },
  nutritionTargets: { indexes: ['effectiveDate'] },
  checkIns:         { indexes: ['date'] },
  photos:           { indexes: ['date'] },
  settings:         { keyPath: 'key', auto: false, indexes: [] },
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, {
          keyPath: cfg.keyPath || 'id',
          autoIncrement: cfg.auto !== false,
        });
        for (const idx of cfg.indexes) store.createIndex(idx, idx, { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function wrap(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

async function get(name, key) { return wrap((await store(name)).get(key)); }
async function getAll(name) { return wrap((await store(name)).getAll()); }
async function count(name) { return wrap((await store(name)).count()); }
async function getAllByIndex(name, index, key) {
  return wrap((await store(name)).index(index).getAll(key));
}
// put() inserts or replaces and resolves with the key.
async function put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); }
async function remove(name, key) { return wrap((await store(name, 'readwrite')).delete(key)); }
async function clear(name) { return wrap((await store(name, 'readwrite')).clear()); }

// Write many records in one transaction.
async function putMany(name, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite');
    const os = tx.objectStore(name);
    const keys = [];
    for (const v of values) {
      const r = os.put(v);
      r.onsuccess = () => keys.push(r.result);
    }
    tx.oncomplete = () => resolve(keys);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function getSetting(key, fallback = null) {
  const row = await get('settings', key);
  return row ? row.value : fallback;
}
function setSetting(key, value) { return put('settings', { key, value }); }

const STORE_NAMES = Object.keys(STORES);

// Date helpers. Everything uses local dates written as YYYY-MM-DD. Weeks run Monday to Sunday.
const pad = (n) => String(n).padStart(2, '0');
function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
function dayKey(d = new Date()) { return DAY_KEYS[d.getDay()]; }
function weekStart(d = new Date()) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const back = (x.getDay() + 6) % 7; // Monday is 0
  x.setDate(x.getDate() - back);
  return dateStr(x);
}

return { openDB, get, getAll, count, getAllByIndex, put, remove, clear, putMany, getSetting, setSetting, STORE_NAMES, dateStr, parseDate, DAY_KEYS, dayKey, weekStart };
})();

/* ===== js/seed.js ===== */
__m['js/seed.js'] = (function () {
// Workout plan, history and nutrition targets. Loaded into IndexedDB on first launch only.
const { getSetting, setSetting, putMany, put, getAll } = __m['js/db.js'];

const PLAN = {
  mon: { title: "Arms and Forearms", subtitle: "plus legs and abs", slots: [
    { ex: "legPress",           name: "Leg press",                         kind: "weighted",   sets: 3, repMin: 8,  repMax: 12, startWeight: null },
    { ex: "dips",               name: "Dips",                              kind: "bodyweight", sets: 3, repMin: 6,  repMax: 10, amrap: true, notes: "Take every set to failure" },
    { ex: "hangingKneeRaise",   name: "Hanging knee raise",                kind: "bodyweight", sets: 2, repMin: 10, repMax: 15 },
    { ex: "chinUp",             name: "Chin up (underhand)",               kind: "bodyweight", sets: 3, repMin: 6,  repMax: 10, amrap: true, notes: "At least 6, go to failure" },
    { ex: "preacherCurl",       name: "Preacher curl",                     kind: "weighted",   sets: 3, repMin: 8,  repMax: 12, startWeight: 50, defaultScheme: true },
    { ex: "cableBarPushdown",   name: "Cable bar pushdown",                kind: "weighted",   sets: 3, repMin: 10, repMax: 15, startWeight: 44 },
    { ex: "hammerCurl",         name: "Hammer curl",                       kind: "weighted",   sets: 3, repMin: 8,  repMax: 12, startWeight: 25, defaultScheme: true },
    { ex: "ohCableTriExt",      name: "Overhead cable triceps extension",  kind: "weighted",   sets: 3, repMin: 10, repMax: 15, startWeight: 33 },
    { ex: "behindBackWristCurl",name: "Behind back wrist curl",            kind: "weighted",   sets: 3, repMin: 12, repMax: 20, startWeight: null, notes: "Flexors" },
    { ex: "wristCurl",          name: "Wrist curl palm down",              kind: "weighted",   sets: 3, repMin: 12, repMax: 20, startWeight: null, defaultScheme: true, notes: "Dumbbell, palm down" },
    { ex: "reverseCurl",        name: "Reverse curl",                      kind: "weighted",   sets: 3, repMin: 12, repMax: 20, startWeight: null },
  ]},
  wed: { title: "Upper A", subtitle: "chest lead, plus legs and abs", slots: [
    { ex: "dbRdl",              name: "Dumbbell Romanian deadlift",        kind: "weighted",   sets: 3, repMin: 8,  repMax: 12, startWeight: null },
    { ex: "chestPressA",        name: "Plate loaded chest press",          kind: "weighted",   sets: 3, repMin: 6,  repMax: 10, startWeight: 90, notes: "Last time two 45 lb plates. Log the total plate weight loaded." },
    { ex: "machineShoulderPress",name:"Machine shoulder press",            kind: "weighted",   sets: 2, repMin: 8,  repMax: 12, startWeight: null },
    { ex: "seatedCableRow",     name: "Seated cable row",                  kind: "weighted",   sets: 3, repMin: 6,  repMax: 10, startWeight: 90 },
    { ex: "lowHighCableFly",    name: "Low to high cable fly",             kind: "weighted",   sets: 3, repMin: 10, repMax: 15, startWeight: null },
    { ex: "latPulldown",        name: "Lat pulldown",                      kind: "weighted",   sets: 3, repMin: 8,  repMax: 12, startWeight: null },
    { ex: "lateralRaise",       name: "Lateral raise",                     kind: "weighted",   sets: 3, repMin: 12, repMax: 20, startWeight: 10, partialsOnLastSet: true, notes: "Last set: half reps after failure" },
    { ex: "wristCurl",          name: "Wrist curl palm down",              kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null, notes: "Dumbbell, palm down" },
    { ex: "cableCurl",          name: "Cable curl",                        kind: "weighted",   sets: 3, repMin: 10, repMax: 15, startWeight: 38.5 },
    { ex: "ropePushdown",       name: "Rope pushdown",                     kind: "weighted",   sets: 3, repMin: 10, repMax: 15, startWeight: 38 },
    { ex: "cableCrunch",        name: "Cable crunch",                      kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null },
    { ex: "behindBackWristCurl",name: "Behind back wrist curl",            kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null, defaultScheme: true, notes: "Flexors" },
    { ex: "reverseCurl",        name: "Reverse curl",                      kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null, defaultScheme: true },
  ]},
  fri: { title: "Upper B", subtitle: "back lead, plus legs and abs (after work)", slots: [
    { ex: "legCurl",            name: "Leg curl",                          kind: "weighted",   sets: 3, repMin: 10, repMax: 15, startWeight: null },
    { ex: "assistedPullUp",     name: "Assisted pull up",                  kind: "assisted",   sets: 3, repMin: 6,  repMax: 10, startWeight: null },
    { ex: "machineChestPress",  name: "Machine chest press",               kind: "weighted",   sets: 3, repMin: 6,  repMax: 10, startWeight: 115 },
    { ex: "cableMachineRow",    name: "Cable row",                         kind: "weighted",   sets: 3, repMin: 8,  repMax: 12, startWeight: null, variants: ["Cable row", "Machine row"] },
    { ex: "cableFly",           name: "Cable fly",                         kind: "weighted",   sets: 2, repMin: 12, repMax: 15, startWeight: null },
    { ex: "lateralRaise",       name: "Dumbbell lateral raise",            kind: "weighted",   sets: 3, repMin: 12, repMax: 20, startWeight: 10, partialsOnLastSet: true, notes: "Last set: half reps after failure" },
    { ex: "reversePecDeck",     name: "Reverse pec deck",                  kind: "weighted",   sets: 3, repMin: 12, repMax: 20, startWeight: null, variants: ["Reverse pec deck", "Face pull"] },
    { ex: "reverseCurl",        name: "Reverse curl",                      kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null },
    { ex: "inclineDbCurl",      name: "Incline dumbbell curl",             kind: "weighted",   sets: 2, repMin: 10, repMax: 15, startWeight: null },
    { ex: "ropePushdown",       name: "Rope pushdown",                     kind: "weighted",   sets: 2, repMin: 10, repMax: 15, startWeight: null },
    { ex: "hangingKneeRaise",   name: "Hanging knee raise",                kind: "bodyweight", sets: 2, repMin: 10, repMax: 15 },
    { ex: "wristCurl",          name: "Wrist curl palm down",              kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null, defaultScheme: true, notes: "Dumbbell, palm down" },
    { ex: "behindBackWristCurl",name: "Behind back wrist curl",            kind: "weighted",   sets: 2, repMin: 12, repMax: 20, startWeight: null, defaultScheme: true, notes: "Flexors" },
  ]},
};

// Existing history to import
const HISTORY = [
  { ex: "ohCableTriExt", date: "2026-10-12", sets: [ { weight: 33, reps: 15 }, { weight: 38, reps: 12 } ], note: "Lost track after set 2" },
  { ex: "machineChestPress", date: null, sets: [ { weight: 115, reps: 6 } ], note: "Date unknown, use as baseline" },
];

// Default progression step in lb. Editable per exercise later.
// Dumbbells and cables 5, selectorized or plate loaded machines 10, assisted pull up 10.
const INCREMENTS = {
  legPress: 10, machineShoulderPress: 10, legCurl: 10, assistedPullUp: 10,
  machineChestPress: 10, reversePecDeck: 10, chestPressA: 10,
};
const DEFAULT_INCREMENT = 5;

const DAY_ORDER = ['mon', 'wed', 'fri'];
// The training days. Mahi's plan by default, or whatever a new person sets up.
async function getDays() {
  const d = await getSetting('days', null);
  if (d && d.length) return d;
  return DAY_ORDER.map((k) => ({ key: k, title: PLAN[k].title, subtitle: PLAN[k].subtitle }));
}

const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

const PRESETS = [
  { name: "Oats in milk with banana", kcal: 500, protein: null, carbs: null, fat: null },
  { name: "PB sandwich",              kcal: null, protein: null, carbs: null, fat: null },
  { name: "Glass of milk",            kcal: null, protein: null, carbs: null, fat: null },
  { name: "Eggs with rice",           kcal: null, protein: null, carbs: null, fat: null },
];

const NUTRITION = { kcal: 2300, protein: 160, fat: 70, carbs: 258 };

// Plan version 2: forearms every session, plate loaded chest press, variants.
const PLAN_VERSION = 2;

function buildPlan() {
  const exercises = new Map();
  const slots = [];
  for (const day of DAY_ORDER) {
    PLAN[day].slots.forEach((s, i) => {
      if (!exercises.has(s.ex)) {
        exercises.set(s.ex, {
          id: s.ex,
          name: s.name,
          kind: s.kind,
          increment: INCREMENTS[s.ex] ?? DEFAULT_INCREMENT,
          weightLadder: null,
          notes: '',
        });
      }
      slots.push({
        id: `${day}_${s.ex}`,
        day,
        order: i,
        exerciseId: s.ex,
        label: s.name,
        sets: s.sets,
        repMin: s.repMin,
        repMax: s.repMax,
        amrap: !!s.amrap,
        partialsOnLastSet: !!s.partialsOnLastSet,
        defaultScheme: !!s.defaultScheme,
        startWeight: s.startWeight ?? null,
        variants: s.variants || null,
        notes: s.notes || '',
      });
    });
  }
  return { exercises: [...exercises.values()], slots };
}

async function seedIfEmpty() {
  if (await getSetting('seeded', false)) return false;

  const { exercises, slots } = buildPlan();
  await putMany('exercises', exercises);
  await putMany('planSlots', slots);

  // Imported history goes in as sessions. A null date is kept as a baseline.
  for (const h of HISTORY) {
    const slot = slots.find((s) => s.exerciseId === h.ex);
    const sessionId = await put('sessions', {
      date: h.date,
      day: slot ? slot.day : null,
      startedAt: null,
      finishedAt: null,
      notes: h.note,
      imported: true,
      baseline: h.date === null,
    });
    await putMany('sets', h.sets.map((st, i) => ({
      sessionId,
      slotId: slot ? slot.id : null,
      exerciseId: h.ex,
      setNumber: i + 1,
      weight: st.weight,
      reps: st.reps,
      partials: null,
      completed: true,
    })));
  }

  await putMany('foodPresets', PRESETS.map((p, i) => ({ ...p, sortOrder: i })));
  const t = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const eff = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  await put('nutritionTargets', { effectiveDate: eff, ...NUTRITION, reason: 'Starting target' });

  await setSetting('restTimerSeconds', 90);
  await setSetting('moveUpRule', 'first');
  await setSetting('planVersion', PLAN_VERSION);
  await setSetting('seeded', true);
  return true;
}

// Brings a Phase 1 install up to the current plan. Runs once.
async function migratePlan() {
  if (!(await getSetting('seeded', false))) return;
  const v = await getSetting('planVersion', 1);
  if (v >= PLAN_VERSION) return;

  const { exercises, slots } = buildPlan();
  const existing = new Map((await getAll('exercises')).map((e) => [e.id, e]));
  await putMany('exercises', exercises.map((e) => {
    const old = existing.get(e.id);
    return old ? { ...old, name: e.name, kind: e.kind, increment: e.increment } : e;
  }));
  await putMany('planSlots', slots);
  if ((await getSetting('moveUpRule', null)) === null) await setSetting('moveUpRule', 'first');
  await setSetting('planVersion', PLAN_VERSION);
}

return { PLAN, HISTORY, DAY_ORDER, getDays, DAY_NAMES, PRESETS, NUTRITION, PLAN_VERSION, buildPlan, seedIfEmpty, migratePlan };
})();

/* ===== js/progression.js ===== */
__m['js/progression.js'] = (function () {
// Progression logic. Pure functions only: no DOM and no database, so it is easy to test.
//
// Mahi's rule ("first set hits the top of the range, move up") is the default.
// The original spec rule ("every set hits the top") is available as rule 'all'.
//
// A "set" here is { weight, reps, setNumber }. Only completed sets with reps are passed in.
// Half reps (partials) are never part of reps.

const EPS = 0.001;
const round = (x) => Math.round(x * 100) / 100;

function sortedLadder(ex) {
  return (ex.weightLadder || []).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
}

// One step in the "harder" or "easier" direction.
// For assisted exercises, harder means LESS assistance (a lower number).
function stepWeight(w, ex, harder) {
  const W = w ?? 0;
  const up = ex.kind === 'assisted' ? !harder : harder;
  const ladder = sortedLadder(ex);
  const inc = ex.increment || 5;
  if (up) {
    const next = ladder.find((x) => x > W + EPS);
    return next !== undefined ? next : round(W + inc);
  }
  const below = ladder.filter((x) => x < W - EPS);
  if (below.length) return below[below.length - 1];
  return Math.max(0, round(W - inc));
}

// Heaviest weight (lowest assist for assisted) with at least one set that reached the bottom of the range.
// If no set reached it (for example a heavy test set, then lighter sets that were still short),
// use the weight he did the most sets at, and break ties by total reps. That is where he really trained.
function workingWeight(sets, repMin, kind) {
  const full = sets.filter((s) => s.reps >= repMin);
  if (full.length) {
    const ws = full.map((s) => s.weight ?? 0);
    return kind === 'assisted' ? Math.min(...ws) : Math.max(...ws);
  }
  const by = new Map();
  for (const s of sets) {
    const w = s.weight ?? 0;
    const g = by.get(w) || { w, n: 0, reps: 0 };
    g.n += 1;
    g.reps += s.reps || 0;
    by.set(w, g);
  }
  const best = [...by.values()].sort((a, b) => b.n - a.n || b.reps - a.reps || (kind === 'assisted' ? a.w - b.w : b.w - a.w))[0];
  return best.w;
}

// Did the sets at the working weight hit the top of the range?
// rule 'first': the first set at that weight reached repMax.
// rule 'all': every set of the slot reached repMax at that weight.
function topHit(atW, n, repMax, rule = 'first') {
  if (!atW.length) return false;
  if (rule === 'all') return atW.length >= n && atW.every((s) => s.reps >= repMax);
  return atW[0].reps >= repMax;
}

// Two sessions in a row where some set at this weight fell below the bottom of the range.
function stalled(lastSets, prevSets, W, repMin) {
  if (!prevSets || !prevSets.length) return false;
  const bad = (sets) => sets.some((s) => (s.weight ?? 0) === W && s.reps < repMin);
  return bad(lastSets) && bad(prevSets);
}

function spreadExtras(base, extra) {
  const out = [...base];
  let i = out.length - 1;
  for (let k = 0; k < extra; k++) {
    out[i] += 1;
    i = i - 1 < 0 ? out.length - 1 : i - 1;
  }
  return out;
}

const total = (arr) => (arr ? arr.reduce((a, b) => a + b, 0) : null);

// Build the next target for a slot.
// slot: { sets, repMin, repMax, amrap }   ex: { kind, increment, weightLadder }
// lastSets: sets from the most recent session of this slot. prevSets: the session before that.
// Returns { targetWeight, targetReps, totalRepGoal, suggestion, note }.
function nextTarget({ slot, ex, lastSets, prevSets = [], rule = 'first' }) {
  const n = slot.sets;
  const { repMin, repMax } = slot;
  const sets = [...lastSets].sort((a, b) => a.setNumber - b.setNumber);
  const result = (targetWeight, targetReps, suggestion = null, note = '') => ({
    targetWeight, targetReps, totalRepGoal: total(targetReps), suggestion, note,
  });

  if (!sets.length) return firstTarget(slot);

  const W = workingWeight(sets, repMin, ex.kind);
  const atW = sets.filter((s) => (s.weight ?? 0) === W);
  const weightOut = ex.kind === 'bodyweight' && W === 0 ? null : W;
  const hit = topHit(atW, n, repMax, rule);

  // Reps per slot position, padding missing sets with the last known set at this weight.
  const lastKnown = atW[atW.length - 1].reps;
  const base = Array.from({ length: n }, (_, i) => (atW[i] ? atW[i].reps : lastKnown));

  // Bodyweight to failure: last total plus 2, filled from the last set backwards.
  if (slot.amrap) {
    const reps = spreadExtras(base, 2);
    const suggestion = hit
      ? { type: 'addWeight', targetWeight: round((W || 0) + (ex.increment || 5)) }
      : null;
    return result(weightOut, reps, suggestion, hit ? 'Top of range, consider adding weight' : '');
  }

  // Bodyweight with a range (hanging knee raise): reps climb, then suggest weight.
  if (ex.kind === 'bodyweight') {
    if (hit) {
      return result(weightOut, Array(n).fill(repMax),
        { type: 'addWeight', targetWeight: round((W || 0) + (ex.increment || 5)) },
        'Top of range, consider adding weight');
    }
    return result(weightOut, base.map((r) => Math.min(r + 1, repMax)));
  }

  if (hit) {
    const W2 = stepWeight(W, ex, true);
    return result(W2, Array(n).fill(repMin), null, 'Move up');
  }

  const reps = base.map((r) => Math.min(r + 1, repMax));
  let suggestion = null;
  if (stalled(sets, prevSets, W, repMin)) {
    suggestion = { type: 'drop', targetWeight: stepWeight(W, ex, false), targetReps: Array(n).fill(repMin) };
  }
  return result(W, reps, suggestion, suggestion ? 'Stalled, consider dropping' : '');
}

// Target when there is nothing logged yet for the slot.
function firstTarget(slot) {
  const n = slot.sets;
  if (slot.startWeight == null) {
    return { targetWeight: null, targetReps: null, totalRepGoal: null, suggestion: null, note: 'Pick a weight' };
  }
  const reps = Array(n).fill(slot.repMin);
  return { targetWeight: slot.startWeight, targetReps: reps, totalRepGoal: total(reps), suggestion: null, note: 'Starting weight' };
}

// Records for the finish summary. today and prior are completed sets of one exercise.
// 1) heaviest weight for at least that many reps  2) most reps at a given weight.
// Lower is better for assisted exercises. No records on the very first time.
function findBests(today, prior, kind) {
  if (!prior.length) return [];
  const better = kind === 'assisted' ? (a, b) => a < b : (a, b) => a > b;
  let weightPR = null;
  let repsPR = null;
  for (const s of today) {
    const w = s.weight ?? 0;
    const pool = prior.filter((p) => p.reps >= s.reps);
    if (pool.length && (w > 0 || kind === 'assisted')) {
      const best = pool.map((p) => p.weight ?? 0).reduce((a, b) => (better(a, b) ? a : b));
      if (better(w, best) && (!weightPR || better(w, weightPR.weight) || (w === weightPR.weight && s.reps > weightPR.reps))) {
        weightPR = { type: 'weight', weight: w, reps: s.reps, prev: best };
      }
    }
    const same = prior.filter((p) => (p.weight ?? 0) === w);
    if (same.length) {
      const prev = Math.max(...same.map((p) => p.reps));
      if (s.reps > prev && (!repsPR || s.reps > repsPR.reps)) {
        repsPR = { type: 'reps', weight: w, reps: s.reps, prev };
      }
    }
  }
  return [weightPR, repsPR].filter(Boolean);
}

// Estimated one rep max (Epley). Used by the charts later.
function epley(w, r) { return w * (1 + r / 30); }

return { sortedLadder, stepWeight, workingWeight, topHit, stalled, nextTarget, firstTarget, findBests, epley };
})();

/* ===== js/ui.js ===== */
__m['js/ui.js'] = (function () {
// Small shared helpers for the screens.
const { parseDate } = __m['js/db.js'];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function fmtW(w) {
  if (w === null || w === undefined || w === '') return '';
  return String(Math.round(Number(w) * 100) / 100);
}

function fmtDate(s) {
  if (!s) return 'baseline';
  return parseDate(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Bottom sheet. Returns { root, close }.
function openSheet(html) {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  return { root: backdrop.querySelector('.sheet'), close };
}

const CHECK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

// Whole days since 1970 for a YYYY-MM-DD string. Used as the x value in charts.
function dayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}
function diffDays(a, b) { return dayNum(b) - dayNum(a); }
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) => Math.round(x * 10) / 10;
function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function fmtLong(s) {
  return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

return { esc, fmtW, fmtDate, addDays, openSheet, CHECK, dayNum, diffDays, mean, r1, nowTime, fmtLong };
})();

/* ===== js/targets.js ===== */
__m['js/targets.js'] = (function () {
// Data access for workouts: history, weekly target snapshots and the baseline week.
const { getAll, getAllByIndex, put, putMany, getSetting, weekStart, parseDate } = __m['js/db.js'];
const { nextTarget, firstTarget } = __m['js/progression.js'];
const { addDays } = __m['js/ui.js'];

const DAY_ORDER = { mon: 0, tue: 1, wed: 2, thu: 3, fri: 4, sat: 5, sun: 6 };

async function loadPlan() {
  const exercises = new Map((await getAll('exercises')).map((e) => [e.id, e]));
  const slots = (await getAll('planSlots')).sort(
    (a, b) => DAY_ORDER[a.day] - DAY_ORDER[b.day] || a.order - b.order
  );
  return { exercises, slots };
}

// Every completed set grouped by session, exercise and slot.
// Entries look like { session, sets } and are sorted oldest first.
async function loadHistory(excludeSessionId = null) {
  const sessions = new Map((await getAll('sessions')).map((s) => [s.id, s]));
  const grouped = new Map();
  for (const s of await getAll('sets')) {
    if (!s.completed || !(s.reps > 0)) continue;
    if (s.sessionId === excludeSessionId) continue;
    if (!sessions.has(s.sessionId)) continue;
    if (!grouped.has(s.sessionId)) grouped.set(s.sessionId, []);
    grouped.get(s.sessionId).push(s);
  }
  const byExercise = new Map();
  const bySlot = new Map();
  const push = (map, key, entry) => {
    if (key === null || key === undefined) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  };
  for (const [sid, sets] of grouped) {
    const session = sessions.get(sid);
    const byEx = new Map();
    const bySl = new Map();
    for (const s of sets) {
      push(byEx, s.exerciseId, s);
      push(bySl, s.slotId, s);
    }
    for (const [k, v] of byEx) push(byExercise, k, { session, sets: v.sort((a, b) => a.setNumber - b.setNumber) });
    for (const [k, v] of bySl) push(bySlot, k, { session, sets: v.sort((a, b) => a.setNumber - b.setNumber) });
  }
  const cmp = (a, b) => (a.session.date || '').localeCompare(b.session.date || '') || a.session.id - b.session.id;
  for (const m of [byExercise, bySlot]) for (const v of m.values()) v.sort(cmp);
  return { sessions, byExercise, bySlot };
}

async function weekTargets(ws) {
  const rows = await getAllByIndex('weeklyTargets', 'weekStart', ws);
  return new Map(rows.map((r) => [r.slotId, r]));
}

// Baseline week: the first week he logs a session in the app. No targets are built for it.
async function isBaselineWeek(ws) {
  const bw = await getSetting('baselineWeek', null);
  return !bw || ws <= bw;
}

async function getRule() { return getSetting('moveUpRule', 'first'); }

// Build this week's snapshot from last week's logged sets. Runs once per week, never rewrites old weeks.
async function ensureWeekTargets(ws = weekStart()) {
  if (await isBaselineWeek(ws)) return;
  const existing = await weekTargets(ws);
  const { exercises, slots } = await loadPlan();
  const missing = slots.filter((s) => !existing.has(s.id));
  if (!missing.length) return;

  const rule = await getRule();
  const { byExercise } = await loadHistory();
  const prevWeek = addDays(ws, -7);
  const allRows = await getAll('weeklyTargets');
  const out = [];

  for (const slot of missing) {
    const ex = exercises.get(slot.exerciseId);
    // History is per exercise, so every day an exercise appears gets the same weight.
    const hist = (byExercise.get(slot.exerciseId) || []).filter((h) => !h.session.imported && h.session.date);
    const lastWeek = hist.filter((h) => weekStart(parseDate(h.session.date)) === prevWeek);
    const last = lastWeek[lastWeek.length - 1];
    const earlier = allRows.filter((r) => r.slotId === slot.id && r.weekStart < ws)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
    // Newest session of this exercise before this week, even if it was more than a week ago.
    const older = hist.filter((h) => weekStart(parseDate(h.session.date)) < ws);
    const newest = older[older.length - 1];
    let t;
    const progress = (entry) => {
      const idx = hist.indexOf(entry);
      const prev = idx > 0 ? hist[idx - 1] : null;
      return nextTarget({ slot, ex, lastSets: entry.sets, prevSets: prev ? prev.sets : [], rule });
    };
    if (last) {
      t = progress(last);
    } else if (earlier) {
      // Missed exercise or missed week: carry the newest earlier target forward unchanged.
      t = { targetWeight: earlier.targetWeight, targetReps: earlier.targetReps, totalRepGoal: earlier.totalRepGoal, suggestion: null, note: 'Carried forward' };
    } else if (newest) {
      // Never had a target (for example a whole week was skipped right after the baseline week):
      // build it from what he actually lifted last time.
      t = progress(newest);
    } else {
      // Never logged this exercise (missed it all through the baseline week): start from the plan.
      t = firstTarget(slot);
    }
    out.push({ weekStart: ws, slotId: slot.id, exerciseId: slot.exerciseId, overridden: false, ...t });
  }
  await putMany('weeklyTargets', out);
}

// Manual override. What he types is what gets saved.
async function siblingSlots(slot) {
  return (await getAll('planSlots')).filter((s) => s.exerciseId === slot.exerciseId && s.id !== slot.id);
}

// After a session, the other days of the same exercise take the weight you actually used.
async function syncWeightToSiblings(exerciseId, weight, ws, exceptSlotId) {
  if (await isBaselineWeek(ws)) return;
  const slots = (await getAll('planSlots')).filter((s) => s.exerciseId === exerciseId && s.id !== exceptSlotId);
  const rows = await weekTargets(ws);
  for (const s of slots) {
    const r = rows.get(s.id);
    if (r && r.targetWeight !== weight) {
      await put('weeklyTargets', { ...r, targetWeight: weight, note: 'Matched to your other day' });
    }
  }
}

async function saveTarget(ws, slot, { targetWeight, targetReps }, applyToOthers = false) {
  const rows = await getAllByIndex('weeklyTargets', 'weekStart', ws);
  const old = rows.find((r) => r.slotId === slot.id);
  const reps = targetReps && targetReps.some((r) => r > 0) ? targetReps : null;
  const row = {
    ...(old || {}),
    weekStart: ws,
    slotId: slot.id,
    exerciseId: slot.exerciseId,
    targetWeight,
    targetReps: reps,
    totalRepGoal: reps ? reps.reduce((a, b) => a + b, 0) : null,
    suggestion: null,
    note: 'Edited by you',
    overridden: true,
  };
  await put('weeklyTargets', row);
  if (applyToOthers) {
    for (const sib of await siblingSlots(slot)) {
      const old2 = rows.find((r) => r.slotId === sib.id);
      const reps2 = reps ? Array.from({ length: sib.sets }, (_, i) => reps[i] ?? reps[reps.length - 1]) : null;
      await put('weeklyTargets', {
        ...(old2 || {}), weekStart: ws, slotId: sib.id, exerciseId: sib.exerciseId,
        targetWeight, targetReps: reps2, totalRepGoal: reps2 ? reps2.reduce((a, b) => a + b, 0) : null,
        suggestion: null, note: 'Edited by you', overridden: true,
      });
    }
  }
  return row;
}

function targetText(row, slot, ex) {
  if (!row) return null;
  const unit = ex.kind === 'assisted' ? 'lb assist' : 'lb';
  if (row.targetWeight == null && ex.kind !== 'bodyweight') return `Pick a weight for ${slot.repMin} to ${slot.repMax} reps`;
  const w = row.targetWeight == null || (ex.kind === 'bodyweight' && !row.targetWeight) ? '' : `${Math.round(row.targetWeight * 100) / 100} ${unit}`;
  const reps = row.targetReps ? row.targetReps.join(' / ') : `${slot.repMin} to ${slot.repMax} reps`;
  return w ? `${w}, ${reps}` : reps;
}

return { loadPlan, loadHistory, weekTargets, isBaselineWeek, getRule, ensureWeekTargets, siblingSlots, syncWeightToSiblings, saveTarget, targetText };
})();

/* ===== js/stats.js ===== */
__m['js/stats.js'] = (function () {
// Numbers shared by Today, Weight, Progress and the check in.
const { getAll, weekStart, parseDate } = __m['js/db.js'];
const { addDays, mean } = __m['js/ui.js'];
const { epley, workingWeight } = __m['js/progression.js'];

/* ---- Body ---- */
async function dailyWeights() {
  const m = new Map();
  for (const r of await getAll('weights')) {
    if (!m.has(r.date)) m.set(r.date, []);
    m.get(r.date).push(r.lb);
  }
  return [...m.entries()].map(([date, a]) => ({ date, lb: mean(a) })).sort((a, b) => a.date.localeCompare(b.date));
}

// Mean of the days with an entry in the 7 day window ending on "end".
function avgWindow(daily, end, days = 7) {
  const start = addDays(end, -(days - 1));
  return mean(daily.filter((d) => d.date >= start && d.date <= end).map((d) => d.lb));
}

function movingAvg(daily) {
  return daily.map((d) => ({ date: d.date, avg: avgWindow(daily, d.date, 7) }));
}

async function waistEntries() {
  return (await getAll('waist')).sort((a, b) => a.date.localeCompare(b.date));
}

/* ---- Food ---- */
async function targetFor(date, rows = null) {
  const all = (rows || await getAll('nutritionTargets')).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id - b.id);
  let cur = all[0];
  for (const r of all) if (r.effectiveDate <= date) cur = r;
  return cur || { kcal: 2300, protein: 160, fat: 70, carbs: 258 };
}

async function foodTotals() {
  const m = new Map();
  for (const e of await getAll('foodEntries')) {
    const t = m.get(e.date) || { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    t.kcal += e.kcal || 0; t.protein += e.protein || 0; t.carbs += e.carbs || 0; t.fat += e.fat || 0;
    m.set(e.date, t);
  }
  return m;
}

/* ---- Lifts ---- */
// Per exercise and week: reps, best weight, best e1RM. Plus weekly goals from the target snapshots.
async function liftData() {
  const sessions = new Map((await getAll('sessions')).map((s) => [s.id, s]));
  const exercises = new Map((await getAll('exercises')).map((e) => [e.id, e]));
  const slots = await getAll('planSlots');
  const repMinOf = new Map();
  for (const s of slots) repMinOf.set(s.exerciseId, Math.min(repMinOf.get(s.exerciseId) ?? 99, s.repMin));

  const byEx = new Map();   // exId -> Map(week -> sets[])
  const sessionsByEx = new Map(); // exId -> Map(sessionId -> sets[])
  for (const s of await getAll('sets')) {
    if (!s.completed || !(s.reps > 0)) continue;
    const ses = sessions.get(s.sessionId);
    if (!ses || !ses.date) continue;
    const wk = weekStart(parseDate(ses.date));
    if (!byEx.has(s.exerciseId)) byEx.set(s.exerciseId, new Map());
    const wm = byEx.get(s.exerciseId);
    if (!wm.has(wk)) wm.set(wk, []);
    wm.get(wk).push(s);
    if (!sessionsByEx.has(s.exerciseId)) sessionsByEx.set(s.exerciseId, new Map());
    const sm = sessionsByEx.get(s.exerciseId);
    if (!sm.has(s.sessionId)) sm.set(s.sessionId, []);
    sm.get(s.sessionId).push(s);
  }

  const weekly = new Map(); // exId -> [{week, reps, weight, e1rm}] sorted
  for (const [exId, wm] of byEx) {
    const ex = exercises.get(exId);
    if (!ex) continue;
    const rows = [];
    for (const [week, sets] of wm) {
      const reps = sets.reduce((a, s) => a + s.reps, 0);
      const weight = workingWeight(sets, repMinOf.get(exId) ?? 1, ex.kind);
      let e1rm = null;
      for (const s of sets) if (s.weight > 0) e1rm = Math.max(e1rm ?? 0, epley(s.weight, s.reps));
      rows.push({ week, reps, weight, e1rm });
    }
    weekly.set(exId, rows.sort((a, b) => a.week.localeCompare(b.week)));
  }

  const slotIds = new Set(slots.map((s) => s.id));
  const goals = new Map(); // exId -> Map(week -> goal)
  for (const r of await getAll('weeklyTargets')) {
    if (!slotIds.has(r.slotId) || !r.totalRepGoal) continue;
    if (!goals.has(r.exerciseId)) goals.set(r.exerciseId, new Map());
    const g = goals.get(r.exerciseId);
    g.set(r.weekStart, (g.get(r.weekStart) || 0) + r.totalRepGoal);
  }

  return { sessions, exercises, slots, byEx, sessionsByEx, weekly, goals };
}

return { dailyWeights, avgWindow, movingAvg, waistEntries, targetFor, foodTotals, liftData };
})();

/* ===== js/autotargets.js ===== */
__m['js/autotargets.js'] = (function () {
// Targets that follow body weight, without touching your goals.
//
// Protein: target = ratio x body weight, where the ratio is your own current target divided by
// your current weight (for example 160 g / 182 lb = 0.88 g per lb). It moves in steps of 5 g, at most
// once a week, and never leaves 0.75 to 1.1 g per lb.
//
// Calories: OFF by default. Your check in already adds or removes calories from the weight and waist
// trend. Scaling calories with weight at the same time would fight it, because the check in adds
// calories exactly when your weight drops.
const { getSetting, setSetting, put, remove, dateStr } = __m['js/db.js'];
const { dailyWeights, targetFor } = __m['js/stats.js'];
const { addDays, diffDays, mean } = __m['js/ui.js'];

const r5 = (x) => Math.round(x / 5) * 5;
const r50 = (x) => Math.round(x / 50) * 50;
const r1 = (x) => Math.round(x * 10) / 10;

const SETTINGS = { autoProtein: true, autoKcal: false };

// Average of the last 7 days, only when there are at least 3 weigh ins in that window.
async function steadyWeight(today = dateStr()) {
  const daily = await dailyWeights();
  const recent = daily.filter((d) => d.date >= addDays(today, -6) && d.date <= today);
  return recent.length >= 3 ? mean(recent.map((d) => d.lb)) : null;
}

// Call after you change a target on purpose. The new numbers become the ratio to follow.
async function rebaseline(today = dateStr()) {
  const w = await steadyWeight(today);
  if (!w) { await remove('settings', 'proteinPerLb'); await remove('settings', 'kcalPerLb'); return; }
  const t = await targetFor(today);
  await setSetting('proteinPerLb', t.protein / w);
  await setSetting('kcalPerLb', t.kcal / w);
  await setSetting('autoLast', today);
}

async function maybeAutoAdjust(today = dateStr()) {
  const autoProtein = await getSetting('autoProtein', SETTINGS.autoProtein);
  const autoKcal = await getSetting('autoKcal', SETTINGS.autoKcal);
  if (!autoProtein && !autoKcal) return null;
  const w = await steadyWeight(today);
  if (!w) return null;
  const t = await targetFor(today);

  const ppl = await getSetting('proteinPerLb', null);
  const kpl = await getSetting('kcalPerLb', null);
  if (ppl === null || kpl === null) { await rebaseline(today); return null; }

  const last = await getSetting('autoLast', null);
  if (last && diffDays(last, today) < 7) return null;
  await setSetting('autoLast', today);

  let protein = t.protein;
  let kcal = t.kcal;
  if (autoProtein) {
    const p = Math.min(Math.max(r5(ppl * w), Math.round(0.75 * w)), Math.round(1.1 * w));
    if (Math.abs(p - t.protein) >= 5) protein = p;
  }
  if (autoKcal) {
    const k = r50(kpl * w);
    if (Math.abs(k - t.kcal) >= 50) kcal = k;
  }
  if (protein === t.protein && kcal === t.kcal) return null;

  const carbs = Math.max(0, Math.round((kcal - protein * 4 - t.fat * 9) / 4));
  await put('nutritionTargets', {
    effectiveDate: today, kcal, protein, fat: t.fat, carbs, reason: `Auto, body weight ${r1(w)} lb`,
  });
  const change = { date: today, weight: r1(w), from: { kcal: t.kcal, protein: t.protein, fat: t.fat, carbs: t.carbs }, to: { kcal, protein } };
  await setSetting('autoUndo', change);
  return change;
}

// Put the old numbers back and stop following weight.
async function undoAuto(today = dateStr()) {
  const c = await getSetting('autoUndo', null);
  if (!c) return;
  await put('nutritionTargets', { effectiveDate: today, ...c.from, reason: 'Undo auto change' });
  await setSetting('autoProtein', false);
  await setSetting('autoKcal', false);
  await remove('settings', 'autoUndo');
}

async function dismissAuto() { await remove('settings', 'autoUndo'); }

return { SETTINGS, steadyWeight, rebaseline, maybeAutoAdjust, undoAuto, dismissAuto };
})();

/* ===== js/goals.js ===== */
__m['js/goals.js'] = (function () {
// Goal based calorie and protein math, and how check ins react to each goal.
//
// Maintenance calories are estimated as body weight in pounds times an activity number.
// The goal then moves calories up or down by a percentage. These are starting estimates only:
// the check in every 2 weeks corrects them from your real weight and waist.

const GOALS = {
  bulk:     { label: 'Bulking',     hint: 'Gain weight slowly',            kcalAdj: 0.10,  proteinPerLb: 0.8 },
  cut:      { label: 'Cutting',     hint: 'Lose fat',                       kcalAdj: -0.20, proteinPerLb: 1.0 },
  maintain: { label: 'Maintaining', hint: 'Stay about the same',            kcalAdj: 0,     proteinPerLb: 0.8 },
  recomp:   { label: 'Recomping',   hint: 'Lose fat and build muscle together', kcalAdj: -0.05, proteinPerLb: 1.0 },
};

const ACTIVITY = {
  low:      { label: 'Mostly sitting outside the gym', perLb: 14 },
  moderate: { label: 'On my feet some of the day',     perLb: 16 },
  high:     { label: 'Active job or lots of cardio',   perLb: 18 },
};

const r5 = (x) => Math.round(x / 5) * 5;
const r50 = (x) => Math.round(x / 50) * 50;

// Returns { maintenance, kcal, protein, fat, carbs }.
function suggestTargets(goal, weightLb, activity = 'moderate') {
  const g = GOALS[goal] || GOALS.maintain;
  const a = ACTIVITY[activity] || ACTIVITY.moderate;
  const maintenance = r50(weightLb * a.perLb);
  const kcal = r50(maintenance * (1 + g.kcalAdj));
  const protein = r5(weightLb * g.proteinPerLb);
  const fat = Math.round((kcal * 0.27) / 9);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { maintenance, kcal, protein, fat, carbs };
}

// What a check in should say for each goal.
// dW is the change in the 7 day average weight over two weeks, in lb. weight is the current average.
// Returns a list of cases, each { headline, options: [{ label, delta }] }. Empty means nothing to change.
const add = [{ label: 'Add 100 kcal', delta: 100 }, { label: 'Add 150 kcal', delta: 150 }];
const sub = [{ label: 'Subtract 100 kcal', delta: -100 }];

function checkInCases(goal, { dW, weight, waistGrowing }) {
  const perWeekPct = ((dW / 2) / weight) * 100;
  const cases = [];
  if (goal === 'cut') {
    if (perWeekPct <= -1.0) cases.push({ headline: 'You are losing faster than about 1 percent of body weight a week. Eat a little more to protect muscle.', options: add });
    else if (dW > -0.5) cases.push({ headline: 'Your weight is not coming down yet.', options: sub });
  } else if (goal === 'bulk') {
    if (dW <= -0.5) cases.push({ headline: 'Your weekly average weight is dropping.', options: add });
    else if (dW >= 2.0) cases.push({ headline: 'You are gaining faster than about 1 lb a week.', options: sub });
  } else if (goal === 'recomp') {
    if (dW <= -1.5) cases.push({ headline: 'Your weight is dropping faster than a recomp needs.', options: add });
    else if (dW >= 1.5) cases.push({ headline: 'Your weight is creeping up.', options: sub });
  } else {
    if (dW <= -1.0) cases.push({ headline: 'Your weight is drifting down.', options: add });
    else if (dW >= 1.0) cases.push({ headline: 'Your weight is drifting up.', options: sub });
  }
  if (waistGrowing) cases.push({ headline: 'Your waist is growing.', options: sub });
  return cases;
}

return { GOALS, ACTIVITY, suggestTargets, checkInCases };
})();

/* ===== js/backup.js ===== */
__m['js/backup.js'] = (function () {
// Export, import and CSV. Everything lives on this phone, so a backup file is the safety net.
const { PLAN_VERSION } = __m['js/seed.js'];
const { getAll, clear, remove, putMany, getSetting, setSetting, dateStr, STORE_NAMES } = __m['js/db.js'];

const blobToDataUrl = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const dataUrlToBlob = async (url) => (await fetch(url)).blob();

async function exportAll() {
  const out = { app: 'tracker', version: 1, exportedAt: new Date().toISOString(), stores: {} };
  for (const name of STORE_NAMES) {
    const rows = await getAll(name);
    if (name === 'photos') {
      out.stores.photos = [];
      for (const p of rows) out.stores.photos.push({ ...p, blob: p.blob ? await blobToDataUrl(p.blob) : null });
    } else {
      out.stores[name] = rows;
    }
  }
  return out;
}

function countsOf(data) {
  const o = {};
  for (const [k, v] of Object.entries(data.stores || {})) o[k] = v.length;
  return o;
}

async function importAll(data) {
  if (!data || data.app !== 'tracker' || !data.stores) throw new Error('This is not a tracker backup file.');
  for (const name of STORE_NAMES) {
    await clear(name);
    let rows = data.stores[name] || [];
    if (name === 'photos') {
      rows = await Promise.all(rows.map(async (p) => ({ ...p, blob: p.blob ? await dataUrlToBlob(p.blob) : null })));
    }
    if (rows.length) await putMany(name, rows);
  }
}

// Clears the logs you pick. The plan, exercises, presets and settings stay.
// The two history entries you gave me at the start (imported) are real, so they stay too.
async function resetProgress(o) {
  if (o.workouts) {
    const sessions = await getAll('sessions');
    const keep = new Set(sessions.filter((s) => s.imported).map((s) => s.id));
    for (const s of sessions) if (!s.imported) await remove('sessions', s.id);
    for (const r of await getAll('sets')) if (!keep.has(r.sessionId)) await remove('sets', r.id);
    await clear('weeklyTargets');
    await remove('settings', 'baselineWeek');
  }
  if (o.weight) {
    await clear('weights'); await clear('waist');
    for (const k of ['proteinPerLb', 'kcalPerLb', 'autoLast', 'autoUndo']) await remove('settings', k);
  }
  if (o.food) {
    await clear('foodEntries');
    for (const r of await getAll('settings')) {
      if (r.key.startsWith('water:') || r.key.startsWith('carbPortion:')) await remove('settings', r.key);
    }
  }
  if (o.checkins) {
    await clear('checkIns');
    for (const r of await getAll('nutritionTargets')) if ((r.reason || '').startsWith('Check in')) await remove('nutritionTargets', r.id);
  }
  if (o.photos) await clear('photos');
}

async function resetAll() {
  for (const name of STORE_NAMES) await clear(name);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function csvOf(store) {
  const rows = await getAll(store);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c !== 'blob');
  return [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
}

// Share sheet when the phone supports sharing files (Files app, iCloud Drive), otherwise a download.
async function shareOrDownload(filename, text, type) {
  const file = new File([text], filename, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'downloaded';
}

async function exportJsonFile() {
  const data = await exportAll();
  const result = await shareOrDownload(`tracker-backup-${dateStr()}.json`, JSON.stringify(data), 'application/json');
  if (result !== 'cancelled') await setSetting('lastExport', dateStr());
  return result;
}

// Backup reminder: true when the last export (or first use) is 7 or more days ago.
async function backupDue() {
  let base = await getSetting('lastExport', null);
  if (!base) {
    base = await getSetting('installedAt', null);
    if (!base) { await setSetting('installedAt', dateStr()); return false; }
  }
  const a = new Date(base + 'T00:00:00');
  return (Date.now() - a.getTime()) / 86400000 >= 7;
}

// "I'm not Mahi": wipe this phone and start the setup screen for someone else.
async function startFriendSetup() {
  await resetAll();
  await setSetting('seeded', true);
  await setSetting('planVersion', PLAN_VERSION);
  await setSetting('moveUpRule', 'first');
  await setSetting('restTimerSeconds', 90);
  await setSetting('needsSetup', true);
}

return { exportAll, countsOf, importAll, resetProgress, resetAll, csvOf, shareOrDownload, exportJsonFile, backupDue, startFriendSetup };
})();

/* ===== js/screens/setup.js ===== */
__m['js/screens/setup.js'] = (function () {
// First time setup for someone else ("I'm not Mahi"): name, training days, targets.
const { put, getSetting, setSetting, dateStr } = __m['js/db.js'];
const { GOALS, ACTIVITY, suggestTargets } = __m['js/goals.js'];
const { openSheet, esc } = __m['js/ui.js'];
const { startFriendSetup } = __m['js/backup.js'];

const WEEK = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
];

// Warning sheet. Nothing is erased until RESET is typed.
function friendSetupSheet() {
  const { root, close } = openSheet(`
    <h2>Set this up for someone else?</h2>
    <div class="muted small" style="line-height:1.45">This erases everything on this phone: the plan, workouts, weigh ins, food and photos. If this is your own phone, export a backup first from Settings. A friend using their own phone has nothing of yours on it, so they can go ahead.</div>
    <label class="field">Type RESET to continue<input id="n-word" autocapitalize="characters" placeholder="RESET"></label>
    <button class="btn" data-act="go" style="background:#FBBF24;color:#2b2000">Erase and start setup</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'go') return;
    if (root.querySelector('#n-word').value.trim() !== 'RESET') return root.querySelector('#n-word').classList.add('shake');
    await startFriendSetup();
    close();
    location.hash = '#/setup';
    location.reload();
  });
}

async function render(el) {
  if (!(await getSetting('needsSetup', false))) { location.hash = '#/today'; return; }
  el.innerHTML = `
    <div class="header"><h1>Welcome</h1></div>
    <p class="sub">A quick setup. You can change all of it later in Settings.</p>

    <div class="card">
      <h3>Your name</h3>
      <input id="s-name" placeholder="Optional" style="width:100%">
    </div>

    <div class="card">
      <h3>Training days</h3>
      <div class="small muted">Tick the days you lift and name each one, like Push or Legs.</div>
      ${WEEK.map(([k, n], i) => `
        <div class="dayrow">
          <label class="check-line" style="margin:0"><input type="checkbox" data-day="${k}" ${['mon', 'wed', 'fri'].includes(k) ? 'checked' : ''}> ${n.slice(0, 3)}</label>
          <input type="text" data-title="${k}" placeholder="Name, optional">
        </div>`).join('')}
    </div>

    <div class="card">
      <h3>Your goal</h3>
      <div class="segs goalsegs">
        ${Object.entries(GOALS).map(([k, g]) => `<button class="seg" data-goal="${k}">${g.label}</button>`).join('')}
      </div>
      <div class="small muted" id="goalhint" style="margin-top:8px">Pick one. It sets your calorie math and how your check ins react.</div>
      <div class="grid2">
        <label class="field">Current weight lb<input id="s-weight" inputmode="decimal" placeholder="lb"></label>
        <label class="field">Activity
          <select id="s-act">${Object.entries(ACTIVITY).map(([k, a]) => `<option value="${k}" ${k === 'moderate' ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
      </div>
    </div>

    <div class="card">
      <h3>Daily targets</h3>
      <div class="grid2">
        <label class="field" style="margin-top:0">Calories<input id="s-kcal" inputmode="numeric" placeholder="kcal"></label>
        <label class="field" style="margin-top:0">Protein g<input id="s-pro" inputmode="numeric" placeholder="g"></label>
      </div>
      <div class="small muted" id="estnote" style="margin-top:8px;line-height:1.45">Pick a goal and enter your weight and these fill in as an estimate. You can type your own numbers instead.</div>
    </div>

    <div class="card"><div class="small muted" style="line-height:1.45">Your plan starts empty. After this, open Settings and use Add exercise on each day to build it. Weights are in pounds.</div></div>
    <button class="btn" data-act="finish">Finish setup</button>`;

  let goal = null;
  const touched = { kcal: false, pro: false };
  const refresh = () => {
    const w = parseFloat(el.querySelector('#s-weight').value.replace(',', '.'));
    if (!goal || !(w > 50)) return;
    const t = suggestTargets(goal, w, el.querySelector('#s-act').value);
    if (!touched.kcal) el.querySelector('#s-kcal').value = t.kcal;
    if (!touched.pro) el.querySelector('#s-pro').value = t.protein;
    el.querySelector('#estnote').textContent =
      `Estimate: about ${t.maintenance} kcal to maintain your weight, ${GOALS[goal].label.toLowerCase()} adjusts that. Your check ins fine tune it from your real weight and waist.`;
  };
  el.oninput = (e) => {
    if (e.target.id === 's-kcal') touched.kcal = true;
    if (e.target.id === 's-pro') touched.pro = true;
    if (e.target.id === 's-weight') refresh();
  };
  el.onchange = (e) => { if (e.target.id === 's-act') refresh(); };

  el.onclick = async (e) => {
    const g = e.target.closest('[data-goal]');
    if (g) {
      goal = g.dataset.goal;
      el.querySelectorAll('[data-goal]').forEach((b) => b.classList.toggle('on', b === g));
      el.querySelector('#goalhint').textContent = GOALS[goal].hint + '.';
      return refresh();
    }
    if (e.target.closest('[data-act]')?.dataset.act !== 'finish') return;
    if (!goal) return alert('Pick your goal first.');
    const wt = parseFloat(el.querySelector('#s-weight').value.replace(',', '.'));
    const kcal = parseInt(el.querySelector('#s-kcal').value, 10);
    const protein = parseInt(el.querySelector('#s-pro').value, 10);
    const keys = [...el.querySelectorAll('[data-day]')].filter((c) => c.checked).map((c) => c.dataset.day);
    if (!keys.length) return alert('Pick at least one training day.');
    if (!(kcal > 0) || !(protein > 0)) {
      (!(kcal > 0) ? el.querySelector('#s-kcal') : el.querySelector('#s-pro')).classList.add('shake');
      return;
    }
    const days = keys.map((k, i) => ({
      key: k,
      title: el.querySelector(`[data-title="${k}"]`).value.trim() || `Workout ${i + 1}`,
      subtitle: '',
    }));
    const fat = Math.round((kcal * 0.28) / 9);
    const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
    await put('nutritionTargets', { effectiveDate: dateStr(), kcal, protein, fat, carbs, reason: 'Setup' });
    await setSetting('goal', goal);
    await setSetting('activity', el.querySelector('#s-act').value);
    if (wt > 50 && wt < 600) await put('weights', { date: dateStr(), time: '07:00', lb: Math.round(wt * 10) / 10 });
    await setSetting('days', days);
    await setSetting('userName', el.querySelector('#s-name').value.trim());
    await setSetting('needsSetup', false);
    location.hash = '#/today';
    location.reload();
  };
}

return { friendSetupSheet, render };
})();

/* ===== js/charts.js ===== */
__m['js/charts.js'] = (function () {
// Tiny SVG chart renderer in the app theme. No library needed, works offline.
// series: [{ type: 'bars' | 'line' | 'dots' | 'steps', points: [{x, y, color?}], color?, name?, dots? }]
const W = 360;
const C = { grid: '#24345A', text: '#8EA0BF', blue: '#3B82F6', light: '#60A5FA', ok: '#34D399', warn: '#FBBF24' };
const COLORS = C;

function niceStep(raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function chartSvg({ height = 180, series, xTicks = [], yMin = null, yMax = null, invert = false, zero = false, fmt, empty = 'No data yet' }) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return `<div class="chart empty">${empty}</div>`;
  const f = fmt || ((v) => String(Math.round(v * 10) / 10));
  let tickStep = 1;
  const m = { l: 40, r: 10, t: 10, b: 24 };
  const pw = W - m.l - m.r;
  const ph = height - m.t - m.b;

  const xsU = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
  const minDelta = xsU.length > 1 ? Math.min(...xsU.slice(1).map((v, i) => v - xsU[i])) : 1;
  const hasBars = series.some((s) => s.type === 'bars');
  let x0 = xsU[0];
  let x1 = xsU[xsU.length - 1];
  if (hasBars) { x0 -= minDelta * 0.6; x1 += minDelta * 0.6; }
  else if (x0 === x1) { x0 -= 1; x1 += 1; }

  const ys = pts.map((p) => p.y);
  let lo = yMin !== null ? yMin : Math.min(...ys);
  let hi = yMax !== null ? yMax : Math.max(...ys);
  if (hasBars || zero) lo = Math.min(lo, 0);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  if (yMin === null && !(hasBars || zero)) lo -= pad;
  if (yMax === null) hi += pad;

  const step = niceStep((hi - lo) / 4);
  tickStep = step;
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);

  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * pw;
  const Y = (y) => (invert ? m.t + ((y - lo) / (hi - lo)) * ph : m.t + ph - ((y - lo) / (hi - lo)) * ph);

  let out = `<svg class="chart" viewBox="0 0 ${W} ${height}" role="img">`;
  for (const t of ticks) {
    out += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${C.grid}" stroke-width="1"/>`;
    out += `<text x="${m.l - 6}" y="${Y(t) + 3}" fill="${C.text}" font-size="10" text-anchor="end">${f(t, tickStep)}</text>`;
  }
  for (const t of xTicks) {
    out += `<text x="${X(t.x)}" y="${height - 6}" fill="${C.text}" font-size="10" text-anchor="middle">${t.label}</text>`;
  }
  for (const s of series) {
    const col = s.color || C.blue;
    const sorted = [...s.points].sort((a, b) => a.x - b.x);
    if (s.type === 'bars') {
      const bw = Math.max(3, (minDelta / (x1 - x0)) * pw * 0.6);
      const base = Y(Math.max(lo, 0));
      for (const p of sorted) {
        const y = Y(p.y);
        out += `<rect x="${X(p.x) - bw / 2}" y="${Math.min(y, base)}" width="${bw}" height="${Math.max(1, Math.abs(base - y))}" rx="3" fill="${p.color || col}"/>`;
      }
    } else if (s.type === 'line') {
      out += `<polyline fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" points="${sorted.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ')}"/>`;
      if (s.dots !== false && sorted.length < 40) for (const p of sorted) out += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" fill="${col}"/>`;
    } else if (s.type === 'dots') {
      for (const p of sorted) out += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="3" fill="${col}" fill-opacity="0.55"/>`;
    } else if (s.type === 'steps') {
      let d = '';
      sorted.forEach((p, i) => {
        d += i === 0 ? `M${X(p.x)},${Y(p.y)}` : `H${X(p.x)}V${Y(p.y)}`;
      });
      d += `H${X(x1)}`;
      out += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="5 4"/>`;
    }
  }
  out += '</svg>';
  const legend = series.filter((s) => s.name).map((s) => `<span><i style="background:${s.color || C.blue}"></i>${s.name}</span>`).join('');
  return out + (legend ? `<div class="legend">${legend}</div>` : '');
}

// Label decimals follow the tick spacing, so a tight range shows 157.5 and 158.0, not 158 three times.
const autoFmt = (v, step = 1) => v.toFixed(step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

return { COLORS, chartSvg, autoFmt };
})();

/* ===== js/screens/weight.js ===== */
__m['js/screens/weight.js'] = (function () {
// Weight tab: morning weigh in, trend chart, waist log.
const { getAll, put, remove, dateStr, weekStart, parseDate } = __m['js/db.js'];
const { dailyWeights, avgWindow, movingAvg, waistEntries } = __m['js/stats.js'];
const { chartSvg, COLORS, autoFmt } = __m['js/charts.js'];
const { esc, fmtDate, fmtLong, openSheet, addDays, dayNum, nowTime, r1 } = __m['js/ui.js'];

let range = 90; // days shown, 0 means all

// The summary line shown once today's weight is saved.
function summaryLine(daily, today = dateStr()) {
  const last = [...daily].reverse().find((d) => d.date <= today);
  if (!last) return '';
  const avg = avgWindow(daily, last.date, 7);
  const prev = avgWindow(daily, addDays(last.date, -7), 7);
  const delta = avg !== null && prev !== null ? ` (${avg - prev >= 0 ? '+' : ''}${(avg - prev).toFixed(1)} vs last week)` : '';
  return `${last.lb.toFixed(1)} lb, 7 day avg ${avg !== null ? avg.toFixed(1) : 'n/a'}${delta}`;
}

// Weigh in card. Prefilled with the most recent weight, so usually you only edit the decimals.
function weighInHtml(daily, today = dateStr()) {
  const todayHas = daily.some((d) => d.date === today);
  if (todayHas) {
    return `<div class="card"><h3>Morning weigh in</h3><div class="name">${esc(summaryLine(daily, today))}</div></div>`;
  }
  const prev = daily.length ? daily[daily.length - 1].lb : '';
  return `
    <div class="card" id="weighin">
      <h3>Morning weigh in</h3>
      <div class="weighrow">
        <input id="wi" inputmode="decimal" value="${prev === '' ? '' : prev.toFixed(1)}" placeholder="lb" aria-label="Weight in pounds">
        <span class="muted">lb</span>
      </div>
      <button class="btn" data-act="save-weight">Save</button>
      ${prev === '' ? '' : `<div class="small muted" style="margin-top:8px">Prefilled with your last weigh in.</div>`}
    </div>`;
}

async function saveWeighIn(el, again) {
  const input = el.querySelector('#wi');
  const lb = parseFloat(String(input.value).replace(',', '.'));
  if (!(lb > 50 && lb < 600)) { input.classList.add('shake'); input.focus(); return; }
  await put('weights', { date: dateStr(), time: nowTime(), lb: r1(lb) });
  again();
}

function rangeDaily(daily, days) {
  if (!days || !daily.length) return daily;
  const from = addDays(dateStr(), -days);
  return daily.filter((d) => d.date >= from);
}

function weightChart(daily, days, height = 190) {
  const rows = rangeDaily(daily, days);
  if (!rows.length) return '<div class="chart empty">Log a few weigh ins to see the trend.</div>';
  const avg = movingAvg(daily).filter((a) => rows.some((r) => r.date === a.date));
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  const span = dayNum(last) - dayNum(first);
  const n = Math.min(4, Math.max(1, Math.floor(span / 7)));
  const xTicks = [];
  for (let i = 0; i <= n; i++) {
    const x = dayNum(first) + Math.round((span * i) / n);
    const d = new Date(x * 86400000);
    xTicks.push({ x, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
  }
  return chartSvg({
    height,
    xTicks,
    series: [
      { type: 'dots', color: COLORS.light, name: 'Daily', points: rows.map((r) => ({ x: dayNum(r.date), y: r.lb })) },
      { type: 'line', color: COLORS.blue, name: '7 day average', dots: false, points: avg.map((a) => ({ x: dayNum(a.date), y: a.avg })) },
    ],
    fmt: autoFmt,
  });
}

function waistChart(entries, height = 150) {
  if (!entries.length) return '<div class="chart empty">Log your waist to see the trend.</div>';
  return chartSvg({
    height,
    xTicks: [],
    series: [{ type: 'line', color: COLORS.light, points: entries.map((w) => ({ x: dayNum(w.date), y: w.inches })) }],
    fmt: (v, st) => v.toFixed(st >= 0.1 ? 1 : 2),
  });
}

async function render(el) {
  const daily = await dailyWeights();
  const waist = await waistEntries();
  const today = dateStr();
  const entries = (await getAll('weights')).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));
  const sunday = parseDate(today).getDay() === 0;
  const waistThisWeek = waist.some((w) => weekStart(parseDate(w.date)) === weekStart(parseDate(today)));

  el.innerHTML = `
    <div class="header"><h1>Weight</h1></div>
    <p class="sub">Weigh in first thing in the morning</p>
    ${weighInHtml(daily, today)}

    <div class="card">
      <h3>Trend</h3>
      <div class="segs" style="margin-bottom:8px">
        ${[[30, '1 month'], [90, '3 months'], [0, 'All']].map(([d, l]) => `<button class="seg ${range === d ? 'on' : ''}" data-act="range" data-d="${d}">${l}</button>`).join('')}
      </div>
      ${weightChart(daily, range)}
    </div>

    <div class="card">
      <h3>Waist</h3>
      ${sunday && !waistThisWeek ? '<div class="banner" style="margin:0 0 10px">It is Sunday. Measure your waist at the same spot as last time.</div>' : ''}
      <div class="weighrow">
        <input id="waist" inputmode="decimal" value="${waist.length ? waist[waist.length - 1].inches : ''}" placeholder="inches" aria-label="Waist in inches">
        <span class="muted">in</span>
      </div>
      <button class="btn secondary" data-act="save-waist">Save waist</button>
      ${waistChart(waist)}
      ${waist.slice(-4).reverse().map((w) => `<div class="row tap" data-act="edit-waist" data-id="${w.id}"><div>${fmtDate(w.date)}</div><div class="scheme">${w.inches} in</div></div>`).join('')}
    </div>

    <div class="card">
      <h3>Entries</h3>
      ${entries.length ? entries.slice(0, 30).map((w) => `
        <button class="row tap" data-act="edit-weight" data-id="${w.id}">
          <div style="text-align:left">${fmtLong(w.date)}<div class="meta">${esc(w.time || '')}</div></div>
          <div class="scheme">${w.lb.toFixed(1)} lb</div>
        </button>`).join('') : '<div class="muted small">No entries yet.</div>'}
    </div>`;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'save-weight') return saveWeighIn(el, () => render(el));
    if (act === 'range') { range = Number(btn.dataset.d); return render(el); }
    if (act === 'save-waist') {
      const v = parseFloat(String(el.querySelector('#waist').value).replace(',', '.'));
      if (!(v > 10 && v < 100)) return el.querySelector('#waist').classList.add('shake');
      await put('waist', { date: today, inches: Math.round(v * 100) / 100 });
      return render(el);
    }
    if (act === 'edit-weight') {
      const w = entries.find((x) => x.id === Number(btn.dataset.id));
      return editEntry(w, 'weights', 'lb', () => render(el));
    }
    if (act === 'edit-waist') {
      const w = waist.find((x) => x.id === Number(btn.dataset.id));
      return editEntry(w, 'waist', 'inches', () => render(el));
    }
  };

  // Deep link: ?action=weight jumps to the input.
  if (new URLSearchParams(location.search).get('action') === 'weight') {
    const wi = el.querySelector('#wi');
    if (wi) { wi.focus(); wi.select(); }
  }
}

function editEntry(row, store, field, done) {
  const { root, close } = openSheet(`
    <h2>Edit entry</h2>
    <label class="field">Date<input id="x-date" type="date" value="${row.date}"></label>
    <label class="field">${field === 'lb' ? 'Weight lb' : 'Waist inches'}<input id="x-val" inputmode="decimal" value="${row[field]}"></label>
    <button class="btn" data-act="save">Save</button>
    <button class="btn secondary" data-act="delete" style="color:#FBBF24">Delete entry</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') return close();
    if (act === 'delete') { await remove(store, row.id); close(); return done(); }
    if (act === 'save') {
      const v = parseFloat(String(root.querySelector('#x-val').value).replace(',', '.'));
      const d = root.querySelector('#x-date').value;
      if (!(v > 0) || !d) return;
      await put(store, { ...row, [field]: v, date: d });
      close();
      done();
    }
  });
}

return { summaryLine, weighInHtml, saveWeighIn, weightChart, waistChart, render };
})();

/* ===== js/checkin.js ===== */
__m['js/checkin.js'] = (function () {
// Check in every 14 days: compares weight, waist and lifts, then suggests a calorie change.
const { getAll, put, dateStr, getSetting } = __m['js/db.js'];
const { addDays, diffDays } = __m['js/ui.js'];
const { rebaseline } = __m['js/autotargets.js'];
const { GOALS, checkInCases } = __m['js/goals.js'];
const { dailyWeights, avgWindow, waistEntries, targetFor, liftData } = __m['js/stats.js'];

const RULES = {
  weightDrop: -0.5,   // lb change in the weekly average that counts as dropping
  waistGrow: 0.25,    // inches change that counts as growing
  liftsShare: 0.5,    // share of lifts that must be up
};

// Is a check in due, and can we compute one?
async function checkInStatus(today = dateStr()) {
  const daily = await dailyWeights();
  if (!daily.length) return { due: false };
  const done = (await getAll('checkIns')).sort((a, b) => b.date.localeCompare(a.date));
  const base = done.length ? done[0].date : daily[0].date;
  if (diffDays(base, today) < 14) return { due: false };
  const now = avgWindow(daily, today, 7);
  const before = avgWindow(daily, addDays(today, -14), 7);
  if (now === null || before === null) return { due: false, waiting: true };
  return { due: true };
}

async function liftsTrend(today) {
  let up = 0;
  let total = 0;
  const recent = addDays(today, -14);
  const prior = addDays(today, -28);
  const { byEx, sessions, exercises } = await liftData();
  for (const [exId, wm] of byEx) {
    const ex = exercises.get(exId);
    if (!ex) continue;
    const best = (from, to) => {
      let b = null;
      for (const sets of wm.values()) for (const s of sets) {
        const ses = sessions.get(s.sessionId);
        if (!ses || ses.date < from || ses.date >= to) continue;
        const v = s.weight > 0 ? s.weight * (1 + s.reps / 30) : s.reps;
        b = b === null ? v : Math.max(b, v);
      }
      return b;
    };
    const a = best(recent, addDays(today, 1));
    const b = best(prior, recent);
    if (a === null || b === null) continue;
    total += 1;
    if (a > b + 1e-6) up += 1;
  }
  return { up, total, going: total >= 3 && up / total >= RULES.liftsShare };
}

async function computeCheckIn(today = dateStr()) {
  const daily = await dailyWeights();
  const now = avgWindow(daily, today, 7);
  const before = avgWindow(daily, addDays(today, -14), 7);
  const dW = now - before;

  const waist = await waistEntries();
  let dWaist = null;
  if (waist.length >= 2) {
    const latest = waist[waist.length - 1];
    const older = waist.filter((w) => diffDays(w.date, latest.date) >= 7);
    if (older.length) {
      // the entry closest to 14 days before the latest one
      const target = addDays(latest.date, -14);
      older.sort((a, b) => Math.abs(diffDays(a.date, target)) - Math.abs(diffDays(b.date, target)));
      dWaist = latest.inches - older[0].inches;
    }
  }

  const lifts = await liftsTrend(today);
  const target = await targetFor(today);

  // Your goal decides what counts as a problem. No goal saved means bulking, the original rules.
  const goal = await getSetting('goal', 'bulk');
  const waistGrowing = dWaist !== null && dWaist >= RULES.waistGrow;
  const cases = checkInCases(goal, { dW, weight: now, waistGrowing });
  const options = [];
  let headline;
  if (cases.length > 1) {
    headline = 'Signals conflict: ' + cases.map((c) => c.headline.replace(/\.$/, '').toLowerCase()).join(', but ') + '. You choose.';
    for (const c of cases) for (const o of c.options) if (!options.some((x) => x.delta === o.delta)) options.push(o);
  } else if (cases.length === 1) {
    headline = cases[0].headline;
    options.push(...cases[0].options);
  } else if (lifts.going) {
    headline = goal === 'cut' ? 'On track. Weight is coming down and your lifts are holding or rising.' : "It's working, keep going.";
  } else {
    headline = goal === 'cut' ? 'On track. Keep going.' : 'Weight and waist are steady. No change needed.';
  }

  const parts = [
    `Goal: ${GOALS[goal].label}`,
    `Weekly average weight ${now.toFixed(1)} lb, ${dW >= 0 ? '+' : ''}${dW.toFixed(1)} vs two weeks ago`,
    dWaist === null ? 'Waist: not enough entries' : `Waist ${dWaist >= 0 ? '+' : ''}${dWaist.toFixed(2)} in`,
    lifts.total ? `Lifts up: ${lifts.up} of ${lifts.total}` : 'Lifts: not enough data',
  ];
  return { date: today, headline, parts, options, kcal: target.kcal, signals: { dW, dWaist, lifts } };
}

async function applyDelta(c, delta) {
  const t = await targetFor(c.date);
  const kcal = t.kcal + delta;
  const carbs = Math.max(0, Math.round((kcal - t.protein * 4 - t.fat * 9) / 4));
  await put('nutritionTargets', {
    effectiveDate: c.date, kcal, protein: t.protein, fat: t.fat, carbs,
    reason: `Check in ${delta > 0 ? '+' : ''}${delta} kcal`,
  });
  await rebaseline(c.date);
}

async function saveCheckIn(c, applied, delta = null) {
  await put('checkIns', {
    date: c.date, summary: `${c.headline} ${c.parts.join('. ')}.`,
    suggestion: c.options.map((o) => o.label).join(' or ') || 'None', applied, appliedDelta: delta,
  });
}

return { RULES, checkInStatus, computeCheckIn, applyDelta, saveCheckIn };
})();

/* ===== js/photos.js ===== */
__m['js/photos.js'] = (function () {
// Progress photos: compressed, stored on this phone only.
const { put, dateStr } = __m['js/db.js'];

const urls = new Map();
function photoUrl(p) {
  if (!p.blob) return '';
  if (!urls.has(p.id)) urls.set(p.id, URL.createObjectURL(p.blob));
  return urls.get(p.id);
}

function compress(file, maxSide = 1080, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob((b) => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('Could not compress the photo.')); }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the photo.')); };
    img.src = url;
  });
}

async function savePhoto(file) {
  const blob = await compress(file);
  return put('photos', { date: dateStr(), blob });
}

return { photoUrl, savePhoto };
})();

/* ===== js/skip.js ===== */
__m['js/skip.js'] = (function () {
// Skip a training day: ask why, offer a mini workout, and log the choice.
const { getAll, getAllByIndex, put, remove, getSetting, setSetting, dateStr, weekStart } = __m['js/db.js'];
const { loadPlan } = __m['js/targets.js'];
const { esc, openSheet } = __m['js/ui.js'];

const REASONS = [
  'Sick', 'Injured or sore', 'Tired', 'School', 'Work', 'No time', 'Gym closed or too busy', 'Other',
];

// Dips, chin ups and hanging knee raises: all bodyweight, all at the same station.
const MINI_DEFAULT = ['dips', 'chinUp', 'hangingKneeRaise'];

async function miniExerciseIds() {
  const { exercises } = await loadPlan();
  const saved = await getSetting('miniWorkout', null);
  const ids = Array.isArray(saved) ? saved : MINI_DEFAULT;
  return ids.filter((id) => exercises.has(id));
}

// One plan slot per mini exercise. A slot on the skipped day wins, otherwise the first one in the plan.
async function miniSlots(day) {
  const { exercises, slots } = await loadPlan();
  const ids = await miniExerciseIds();
  const out = [];
  for (const id of ids) {
    const pick = slots.find((s) => s.exerciseId === id && s.day === day) || slots.find((s) => s.exerciseId === id);
    if (pick) out.push({ slot: pick, name: exercises.get(id).name });
  }
  return out;
}

async function findSession(day) {
  const ws = weekStart();
  const today = dateStr();
  const mine = (await getAll('sessions')).filter((s) =>
    !s.imported && s.day === day && (s.date === today || (!s.finishedAt && s.weekStart === ws)));
  return mine.sort((a, b) => a.id - b.id).pop() || null;
}

async function clearSets(sessionId) {
  for (const r of await getAllByIndex('sets', 'sessionId', sessionId)) await remove('sets', r.id);
}

// Log the skip. With mini = true the session stays open so the mini workout can be logged in it.
async function recordSkip(day, reason, note, mini) {
  const ws = weekStart();
  let session = await findSession(day);
  if (session) await clearSets(session.id); // only reachable while nothing is logged
  const slots = mini ? (await miniSlots(day)).map((m) => m.slot.id) : [];
  session = {
    ...(session || {}),
    date: dateStr(), day, weekStart: ws, startedAt: Date.now(),
    finishedAt: mini ? null : Date.now(),
    notes: '', exerciseNotes: {},
    skipped: true, skipReason: reason, skipNote: note || '',
    mini: !!mini, miniSlotIds: slots,
  };
  session.id = await put('sessions', session);
  // A mini workout is real data, so it counts as the baseline week. A plain skip does not.
  if (mini && !(await getSetting('baselineWeek', null))) await setSetting('baselineWeek', ws);
  return session;
}

async function undoSkip(session) {
  await clearSets(session.id);
  await remove('sessions', session.id);
}

// Sheet 1 asks why. Sheet 2 offers the mini workout. onDone(session, wantsMini) runs after logging.
async function openSkipSheet(day, dayTitle, onDone) {
  const mini = await miniSlots(day);
  const { root, close } = openSheet(`
    <h2>Skip ${esc(dayTitle)}?</h2>
    <p class="muted">Why are you skipping today?</p>
    <div class="segs" id="reasons">
      ${REASONS.map((r, i) => `<button class="seg ${i === 0 ? 'on' : ''}" data-act="reason" data-val="${esc(r)}">${esc(r)}</button>`).join('')}
    </div>
    <label class="field">Note (optional)<input id="skip-note" placeholder="Anything to remember"></label>
    <button class="btn" data-act="next">Continue</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  let reason = REASONS[0];
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'cancel') return close();
    if (act === 'reason') {
      reason = b.dataset.val;
      root.querySelectorAll('[data-act=reason]').forEach((x) => x.classList.toggle('on', x === b));
      return;
    }
    if (act === 'next') {
      const note = root.querySelector('#skip-note').value.trim();
      if (!mini.length) {
        const s = await recordSkip(day, reason, note, false);
        close();
        return onDone(s, false);
      }
      root.innerHTML = `
        <h2>Do a mini workout instead?</h2>
        <p class="muted">Quick and short, just the key lifts:</p>
        ${mini.map((m) => `<div class="row"><div class="name">${esc(m.name)}</div><div class="scheme">${m.slot.sets} x ${m.slot.repMin} to ${m.slot.repMax}</div></div>`).join('')}
        <button class="btn" data-act="yes">Yes, start the mini workout</button>
        <button class="btn secondary" data-act="no">No, just log the skip</button>`;
      root.onclick = async (ev) => {
        const a = ev.target.closest('[data-act]')?.dataset.act;
        if (a !== 'yes' && a !== 'no') return;
        const s = await recordSkip(day, reason, note, a === 'yes');
        close();
        onDone(s, a === 'yes');
      };
    }
  });
}

// Settings: pick which exercises make up the mini workout.
async function openMiniPicker(onDone) {
  const { exercises } = await loadPlan();
  const current = new Set(await miniExerciseIds());
  const list = [...exercises.values()].sort((a, b) => a.name.localeCompare(b.name));
  const { root, close } = openSheet(`
    <h2>Mini workout</h2>
    <p class="muted">What you can offer yourself on a skipped day. Keep it to three or four.</p>
    ${list.map((x) => `<label class="check-line"><input type="checkbox" data-id="${esc(x.id)}" ${current.has(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}
    <button class="btn" data-act="save">Save</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act === 'save') {
      const ids = [...root.querySelectorAll('input[data-id]')].filter((i) => i.checked).map((i) => i.dataset.id);
      await setSetting('miniWorkout', ids);
      close();
      onDone();
    }
  });
}

return { REASONS, MINI_DEFAULT, miniExerciseIds, miniSlots, recordSkip, undoSkip, openSkipSheet, openMiniPicker };
})();

/* ===== js/screens/today.js ===== */
__m['js/screens/today.js'] = (function () {
const { getAll, getAllByIndex, getSetting, dayKey, dateStr, weekStart, parseDate } = __m['js/db.js'];
const { getDays, DAY_NAMES } = __m['js/seed.js'];
const { maybeAutoAdjust, undoAuto, dismissAuto } = __m['js/autotargets.js'];
const { friendSetupSheet } = __m['js/screens/setup.js'];
const { ensureWeekTargets, weekTargets, isBaselineWeek, loadPlan } = __m['js/targets.js'];
const { dailyWeights, waistEntries, targetFor } = __m['js/stats.js'];
const { weighInHtml, saveWeighIn } = __m['js/screens/weight.js'];
const { checkInStatus, computeCheckIn, applyDelta, saveCheckIn } = __m['js/checkin.js'];
const { backupDue, exportJsonFile } = __m['js/backup.js'];
const { savePhoto } = __m['js/photos.js'];
const { esc } = __m['js/ui.js'];
const { openSkipSheet } = __m['js/skip.js'];

const GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

function nextTrainingDay(from, keys) {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const k = dayKey(d);
    if (keys.includes(k)) return k;
  }
  return keys[0];
}

async function render(el) {
  const now = new Date();
  const today = dateStr(now);
  const key = dayKey(now);
  const long = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const ws = weekStart(now);
  await ensureWeekTargets(ws);
  await maybeAutoAdjust(today);
  const days = await getDays();
  const dmap = new Map(days.map((d) => [d.key, d]));
  const userName = await getSetting('userName', '');

  const { slots: allSlots } = await loadPlan();
  const baseline = await isBaselineWeek(ws);
  const targets = await weekTargets(ws);
  const live = new Set(allSlots.map((s) => s.id));
  let goal = 0;
  for (const r of targets.values()) if (live.has(r.slotId)) goal += r.totalRepGoal || 0;
  const weekLine = baseline ? 'Baseline week, log what you lift' : `Week goal ${goal} reps`;

  // Workout card
  let workout;
  const info = dmap.get(key);
  if (info) {
    const n = allSlots.filter((s) => s.day === key).length;
    const sessions = (await getAll('sessions')).filter((s) =>
      !s.imported && s.day === key && (s.date === today || (!s.finishedAt && s.weekStart === ws)));
    const sess = sessions.sort((a, b) => a.id - b.id).pop();
    const skippedOnly = sess && sess.skipped && !sess.mini;
    const label = !n ? 'Add exercises' : !sess ? 'Start workout' : skippedOnly ? 'View skipped day' : sess.finishedAt ? 'View summary' : 'Resume';
    const skipNote = skippedOnly ? `Skipped today: ${esc(sess.skipReason || 'no reason')}. ` : '';
    const href = n ? `#/workout/${key}` : '#/settings';
    workout = `
      <div class="card">
        <h3>Today's workout</h3>
        <h2>${esc(info.title)}</h2>
        <div class="muted">${esc(info.subtitle || '')}</div>
        <div class="small muted" style="margin-top:8px">${skipNote}${n} exercises. ${weekLine}.</div>
        <a class="btn" href="${href}" style="text-decoration:none;text-align:center;line-height:52px">${label}</a>
        ${n && !sess ? `<button class="link" data-act="skipday" data-day="${key}" style="display:block;margin:12px auto 0">Skip this day</button>` : ''}
      </div>`;
  } else {
    const next = nextTrainingDay(now, days.map((d) => d.key));
    const ninfo = dmap.get(next);
    const n = allSlots.filter((s) => s.day === next).length;
    workout = `
      <div class="card">
        <h3>Today</h3>
        <h2>Rest day</h2>
        <div class="muted" style="margin-top:6px">Next up: ${DAY_NAMES[next]}, ${esc(ninfo.title)} (${n} exercises)</div>
        <div class="small muted" style="margin-top:6px">${weekLine}.</div>
        <a class="btn secondary" href="#/workout" style="text-decoration:none;text-align:center;line-height:52px">See this week</a>
      </div>`;
  }

  // Weigh in
  const daily = await dailyWeights();
  const weigh = weighInHtml(daily, today);

  // Food summary
  const entries = await getAllByIndex('foodEntries', 'date', today);
  const tgt = await targetFor(today);
  const kcal = entries.reduce((a, e) => a + (e.kcal || 0), 0);
  const pro = entries.reduce((a, e) => a + (e.protein || 0), 0);
  const food = `
    <a class="card linkcard" href="#/food">
      <h3>Food today</h3>
      <div class="stats" style="justify-content:flex-start;gap:28px;text-align:left">
        <div><b>${Math.round(kcal)}</b><span>of ${tgt.kcal} kcal</span></div>
        <div><b>${Math.round(pro)}</b><span>of ${tgt.protein} g protein</span></div>
      </div>
    </a>`;

  // Banners and prompts
  const banners = [];
  const auto = await getSetting('autoUndo', null);
  if (auto) {
    const parts = [];
    if (auto.to.protein !== auto.from.protein) parts.push(`protein ${auto.from.protein} to ${auto.to.protein} g`);
    if (auto.to.kcal !== auto.from.kcal) parts.push(`calories ${auto.from.kcal} to ${auto.to.kcal}`);
    banners.push(`<div class="card"><h3>Targets updated</h3>
      <div>Your weight is about ${auto.weight} lb, so your ${parts.join(' and ')}. Same ratio as before.</div>
      <button class="btn secondary" data-act="autook">Got it</button>
      <button class="btn secondary" data-act="autoundo" style="color:#FBBF24">Undo and stop following my weight</button></div>`);
  }
  if (await backupDue()) {
    banners.push(`<div class="card"><h3>Backup</h3><div>It has been a week since your last backup.</div>
      <button class="btn secondary" data-act="backup">Back up now</button></div>`);
  }
  let checkCard = null;
  const st = await checkInStatus(today);
  if (st.due) {
    checkCard = await computeCheckIn(today);
    banners.push(`
      <div class="card" id="checkin">
        <h3>Check in</h3>
        <h2>${esc(checkCard.headline)}</h2>
        ${checkCard.parts.map((p) => `<div class="muted small">${esc(p)}</div>`).join('')}
        ${checkCard.options.map((o, i) => `<button class="btn" data-act="apply" data-i="${i}">${esc(o.label)}</button>`).join('')}
        <button class="btn secondary" data-act="dismiss">${checkCard.options.length ? 'Dismiss' : 'Got it'}</button>
      </div>`);
  }
  const d = parseDate(today);
  if (d.getDate() <= 7) {
    const photos = await getAll('photos');
    if (!photos.some((p) => p.date.slice(0, 7) === today.slice(0, 7))) {
      banners.push(`<div class="card"><h3>Monthly progress photo</h3><div>Same spot, same lighting.</div>
        <label class="btn" style="text-align:center;line-height:52px">Take photo
          <input type="file" id="photo" accept="image/*" capture="environment" hidden></label></div>`);
    }
  }
  if (d.getDay() === 0) {
    const waist = await waistEntries();
    if (!waist.some((w) => weekStart(parseDate(w.date)) === ws)) {
      banners.push(`<a class="card linkcard" href="#/weight"><h3>Sunday</h3><div>Measure your waist and log it.</div></a>`);
    }
  }

  el.innerHTML = `
    <div class="header">
      <h1>Today</h1>
      <a class="icon-btn" href="#/settings" aria-label="Settings">${GEAR}</a>
    </div>
    <p class="sub">${userName ? `Hi ${esc(userName)}. ` : ''}${long}</p>
    ${weigh}
    ${banners.join('')}
    ${workout}
    ${food}
    <button class="link notme" data-act="notme">${!userName || userName === 'Mahi' ? "I'm not Mahi" : 'Set up for someone else'}</button>
  `;

  el.onclick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'save-weight') return saveWeighIn(el, () => render(el));
    if (act === 'backup') { await exportJsonFile(); return render(el); }
    if (act === 'apply') {
      const o = checkCard.options[Number(b.dataset.i)];
      await applyDelta(checkCard, o.delta);
      await saveCheckIn(checkCard, true, o.delta);
      return render(el);
    }
    if (act === 'autook') { await dismissAuto(); return render(el); }
    if (act === 'autoundo') { await undoAuto(today); return render(el); }
    if (act === 'notme') return friendSetupSheet();
    if (act === 'skipday') {
      const info = dmap.get(b.dataset.day);
      return openSkipSheet(b.dataset.day, info.title, (session, mini) => {
        if (mini) location.hash = `#/workout/${b.dataset.day}`;
        else render(el);
      });
    }
    if (act === 'dismiss') { await saveCheckIn(checkCard, false); return render(el); }
  };
  el.onchange = async (e) => {
    if (e.target.id === 'photo' && e.target.files[0]) {
      try { await savePhoto(e.target.files[0]); } catch (err) { alert(String(err.message || err)); }
      render(el);
    }
  };
}

return { render };
})();

/* ===== js/plan.js ===== */
__m['js/plan.js'] = (function () {
// Plan editing: add, remove, reorder and create exercises. Used by Settings and by the session screen.
const { getAll, getAllByIndex, put, putMany, remove } = __m['js/db.js'];
const { DAY_NAMES } = __m['js/seed.js'];
const { esc, fmtW, openSheet } = __m['js/ui.js'];

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'exercise';
const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isNaN(x) ? null : x; };
const int = (v) => { const x = parseInt(v, 10); return Number.isNaN(x) ? null : x; };

async function createExercise({ name, kind = 'weighted', increment = 5, weightLadder = null }) {
  const id = `${slug(name)}_${Math.random().toString(36).slice(2, 6)}`;
  const ex = { id, name, kind, increment, weightLadder, notes: '', custom: true };
  await put('exercises', ex);
  return ex;
}

async function addSlot(day, ex, o) {
  const slots = await getAllByIndex('planSlots', 'day', day);
  const ids = new Set(slots.map((s) => s.id));
  let id = `${day}_${ex.id}`;
  let n = 2;
  while (ids.has(id)) id = `${day}_${ex.id}_${n++}`;
  const order = slots.length ? Math.max(...slots.map((s) => s.order)) + 1 : 0;
  const slot = {
    id, day, order, exerciseId: ex.id, label: o.label || ex.name,
    sets: o.sets, repMin: o.repMin, repMax: o.repMax,
    amrap: !!o.amrap, partialsOnLastSet: !!o.partials, defaultScheme: false,
    startWeight: o.startWeight ?? null, variants: null, notes: o.notes || '',
  };
  await put('planSlots', slot);
  return slot;
}

async function removeSlot(slotId) { await remove('planSlots', slotId); }

async function moveSlot(slotId, dir) {
  const slot = (await getAll('planSlots')).find((s) => s.id === slotId);
  if (!slot) return;
  const list = (await getAllByIndex('planSlots', 'day', slot.day)).sort((a, b) => a.order - b.order);
  const i = list.findIndex((s) => s.id === slotId);
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  list.forEach((s, k) => { s.order = k; });
  await putMany('planSlots', list);
}

// Sheet for adding an exercise to a day, either one you already have or a brand new one.
async function openAddExercise(day, onDone) {
  const exercises = (await getAll('exercises')).sort((a, b) => a.name.localeCompare(b.name));
  const slots = await getAll('planSlots');
  const here = new Set(slots.filter((s) => s.day === day).map((s) => s.exerciseId));
  const opts = exercises.map((e) => `<option value="${e.id}">${esc(e.name)}${here.has(e.id) ? ' (already on this day)' : ''}</option>`).join('');

  const { root, close } = openSheet(`
    <h2>Add exercise to ${DAY_NAMES[day]}</h2>
    <div class="segs" style="margin-top:10px">
      <button class="seg on" data-tab="lib">From my exercises</button>
      <button class="seg" data-tab="new">New exercise</button>
    </div>
    <div id="tab-lib">
      <label class="field">Exercise<select id="a-ex">${opts}</select></label>
    </div>
    <div id="tab-new" hidden>
      <label class="field">Name<input id="n-name" placeholder="Example: Cable lateral raise"></label>
      <label class="field">Type
        <select id="n-kind">
          <option value="weighted">Weights</option>
          <option value="bodyweight">Bodyweight</option>
          <option value="assisted">Assisted (lower is better)</option>
        </select></label>
      <label class="field">Step size lb when you move up<input id="n-inc" inputmode="decimal" value="5"></label>
      <label class="field">Weight stack, optional (for example 33, 38, 44)<input id="n-ladder"></label>
    </div>
    <div class="grid3">
      <label class="field">Sets<input id="a-sets" inputmode="numeric" value="3"></label>
      <label class="field">Reps from<input id="a-min" inputmode="numeric" value="8"></label>
      <label class="field">Reps to<input id="a-max" inputmode="numeric" value="12"></label>
    </div>
    <label class="field">Starting weight, optional<input id="a-start" inputmode="decimal"></label>
    <label class="check-line"><input type="checkbox" id="a-amrap"> Take every set to failure (AMRAP)</label>
    <label class="check-line"><input type="checkbox" id="a-half"> Half reps on the last set</label>
    <button class="btn" data-act="add">Add to ${DAY_NAMES[day]}</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>
  `);

  let tab = 'lib';
  const q = (id) => root.querySelector(id);
  const prefill = () => {
    const s = slots.find((x) => x.exerciseId === q('#a-ex').value);
    if (!s) return;
    q('#a-sets').value = s.sets; q('#a-min').value = s.repMin; q('#a-max').value = s.repMax;
    q('#a-amrap').checked = !!s.amrap; q('#a-half').checked = !!s.partialsOnLastSet;
    q('#a-start').value = s.startWeight ?? '';
  };
  if (exercises.length) prefill();
  q('#a-ex').addEventListener('change', prefill);

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) {
      tab = t.dataset.tab;
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b === t));
      q('#tab-lib').hidden = tab !== 'lib';
      q('#tab-new').hidden = tab !== 'new';
      if (tab === 'new') {
        q('#a-sets').value = 3; q('#a-min').value = 8; q('#a-max').value = 12;
        q('#a-amrap').checked = false; q('#a-half').checked = false; q('#a-start').value = '';
      } else if (exercises.length) prefill();
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'add') return;

    const sets = int(q('#a-sets').value), min = int(q('#a-min').value), max = int(q('#a-max').value);
    if (!(sets > 0) || !(min > 0) || !(max >= min)) return alert('Check the sets and rep range.');
    let ex;
    if (tab === 'lib') {
      ex = exercises.find((x) => x.id === q('#a-ex').value);
    } else {
      const name = q('#n-name').value.trim();
      if (!name) return alert('Give the exercise a name.');
      const ladder = q('#n-ladder').value.split(/[,\s]+/).map(num).filter((n) => n !== null);
      ex = await createExercise({
        name, kind: q('#n-kind').value, increment: num(q('#n-inc').value) || 5,
        weightLadder: ladder.length ? ladder : null,
      });
    }
    const slot = await addSlot(day, ex, {
      sets, repMin: min, repMax: max, startWeight: num(q('#a-start').value),
      amrap: q('#a-amrap').checked, partials: q('#a-half').checked,
    });
    close();
    onDone(slot, ex);
  });
}

// Sheet for editing one slot: name, scheme, flags, step size and stack, order, and removal.
function openEditSlot(slot, ex, onDone, siblings = []) {
  const { root, close } = openSheet(`
    <h2>${esc(slot.label)}</h2>
    <label class="field">Name on this day<input id="e-label" value="${esc(slot.label)}"></label>
    <div class="grid3">
      <label class="field">Sets<input id="e-sets" inputmode="numeric" value="${slot.sets}"></label>
      <label class="field">Reps from<input id="e-min" inputmode="numeric" value="${slot.repMin}"></label>
      <label class="field">Reps to<input id="e-max" inputmode="numeric" value="${slot.repMax}"></label>
    </div>
    <label class="check-line"><input type="checkbox" id="e-amrap" ${slot.amrap ? 'checked' : ''}> Take every set to failure (AMRAP)</label>
    <label class="check-line"><input type="checkbox" id="e-half" ${slot.partialsOnLastSet ? 'checked' : ''}> Half reps on the last set</label>
    <label class="field">Starting weight, used when there is no history
      <input id="e-start" inputmode="decimal" value="${fmtW(slot.startWeight)}"></label>
    ${siblings.length ? `<label class="check-line"><input type="checkbox" id="e-all" checked> Use the same sets, reps and starting weight on the other ${siblings.length === 1 ? 'day' : 'days'} this exercise appears</label>` : ''}
    <div class="muted small" style="margin-top:14px">Step size and weight stack belong to the exercise, so they apply on every day it appears.</div>
    <label class="field">Step size lb<input id="e-inc" inputmode="decimal" value="${fmtW(ex.increment)}"></label>
    <label class="field">Weight stack, optional (for example 33, 38, 44)
      <input id="e-ladder" value="${esc((ex.weightLadder || []).join(', '))}"></label>
    <button class="btn" data-act="save">Save</button>
    <div class="grid3" style="margin-top:8px">
      <button class="btn secondary" data-act="up" style="margin:0">Move up</button>
      <button class="btn secondary" data-act="down" style="margin:0">Move down</button>
      <button class="btn secondary" data-act="remove" style="margin:0;color:#FBBF24">Remove</button>
    </div>
    <button class="btn secondary" data-act="cancel">Cancel</button>
  `);
  const q = (id) => root.querySelector(id);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') return close();
    if (act === 'up' || act === 'down') { await moveSlot(slot.id, act === 'up' ? -1 : 1); close(); return onDone(); }
    if (act === 'remove') {
      if (!confirm(`Remove ${slot.label} from this day? Your history stays saved.`)) return;
      await removeSlot(slot.id); close(); return onDone();
    }
    if (act === 'save') {
      const sets = int(q('#e-sets').value), min = int(q('#e-min').value), max = int(q('#e-max').value);
      if (!(sets > 0) || !(min > 0) || !(max >= min)) return alert('Check the sets and rep range.');
      const ladder = q('#e-ladder').value.split(/[,\s]+/).map(num).filter((n) => n !== null);
      await put('planSlots', {
        ...slot, label: q('#e-label').value.trim() || slot.label, sets, repMin: min, repMax: max,
        amrap: q('#e-amrap').checked, partialsOnLastSet: q('#e-half').checked,
        startWeight: num(q('#e-start').value), defaultScheme: false,
      });
      if (siblings.length && q('#e-all').checked) {
        for (const sib of siblings) {
          await put('planSlots', {
            ...sib, sets, repMin: min, repMax: max, amrap: q('#e-amrap').checked,
            partialsOnLastSet: q('#e-half').checked, startWeight: num(q('#e-start').value), defaultScheme: false,
          });
        }
      }
      await put('exercises', { ...ex, increment: num(q('#e-inc').value) || ex.increment, weightLadder: ladder.length ? ladder : null });
      close();
      onDone();
    }
  });
}

return { createExercise, addSlot, removeSlot, moveSlot, openAddExercise, openEditSlot };
})();

/* ===== js/screens/workout.js ===== */
__m['js/screens/workout.js'] = (function () {
// Workout tab: week overview with targets, the live session screen, and the finish summary.
const { getAll, getAllByIndex, put, remove, getSetting, setSetting, dateStr, dayKey, weekStart, parseDate } = __m['js/db.js'];
const { getDays, DAY_NAMES } = __m['js/seed.js'];
const { loadPlan, loadHistory, weekTargets, ensureWeekTargets, isBaselineWeek, saveTarget, getRule, targetText, syncWeightToSiblings } = __m['js/targets.js'];
const { workingWeight, stepWeight, nextTarget, findBests } = __m['js/progression.js'];
const { esc, fmtW, fmtDate, openSheet, CHECK } = __m['js/ui.js'];
const { openAddExercise, removeSlot } = __m['js/plan.js'];
const { openSkipSheet, undoSkip, miniSlots } = __m['js/skip.js'];

let S = null;          // live session state
let restHandle = null; // rest timer interval

async function render(el, arg) {
  stopRest();
  S = null;
  const days = await getDays();
  if (arg && days.some((d) => d.key === arg)) return renderSession(el, arg, days);
  return renderList(el, days);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const num = (v) => {
  const x = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isNaN(x) ? null : x;
};
const int = (v) => {
  const x = parseInt(String(v ?? ''), 10);
  return Number.isNaN(x) ? null : x;
};

async function sessionsThisWeek(ws) {
  return (await getAll('sessions')).filter((s) => !s.imported && s.date && weekStart(parseDate(s.date)) === ws);
}

function latest(arr) {
  return arr.slice().sort((a, b) => a.id - b.id)[arr.length - 1];
}

function statusOf(session) {
  if (!session) return { text: '', label: 'Start workout' };
  if (session.skipped && !session.mini) return { text: `Skipped, ${session.skipReason || 'no reason'}`, label: 'View' };
  if (session.finishedAt) return { text: `${session.mini ? 'Mini workout done' : 'Done'} ${fmtDate(session.date)}`, label: 'View summary' };
  return { text: session.mini ? 'Mini workout in progress' : 'In progress', label: 'Resume' };
}

/* ------------------------------------------------------------------ */
/* Week overview                                                       */
/* ------------------------------------------------------------------ */

async function renderList(el, dayList) {
  const ws = weekStart();
  await ensureWeekTargets(ws);
  const { exercises, slots } = await loadPlan();
  const targets = await weekTargets(ws);
  const baseline = await isBaselineWeek(ws);
  const sessions = await sessionsThisWeek(ws);
  const today = dayKey();

  let goal = 0;
  const live = new Set(slots.map((x) => x.id));
  for (const t of targets.values()) if (live.has(t.slotId)) goal += t.totalRepGoal || 0;

  const banner = baseline
    ? `<div class="card"><h3>Baseline week</h3>
         <div>Lift like normal and log every set. Next Monday the app builds your targets from what you logged.</div></div>`
    : `<div class="card"><h3>This week</h3>
         <h2>${goal} rep goal</h2>
         <div class="muted small">Built from last week. Tap an exercise under Targets to change one.</div></div>`;

  const dayCards = dayList.map((info) => {
    const d = info.key;
    const daySlots = slots.filter((s) => s.day === d);
    const sess = latest(sessions.filter((s) => s.day === d));
    const st = statusOf(sess);
    const rows = daySlots.map((s) => {
      const ex = exercises.get(s.exerciseId);
      const t = targets.get(s.id);
      const txt = t ? targetText(t, s, ex) : (baseline ? 'No target yet' : '');
      let flag = '';
      if (t && t.suggestion && t.suggestion.type === 'drop') flag = `<span class="badge warn">Try ${fmtW(t.suggestion.targetWeight)} lb</span>`;
      if (t && t.suggestion && t.suggestion.type === 'addWeight') flag = `<span class="badge">Add weight</span>`;
      if (t && t.overridden) flag += `<span class="badge">Edited</span>`;
      return `
        <button class="row tap" data-act="target" data-slot="${s.id}">
          <div style="text-align:left">
            <div class="name">${esc(s.label)}</div>
            <div class="meta">${esc(txt)}</div>
            <div>${flag}</div>
          </div>
          <div class="scheme">${s.sets} x ${s.repMin} to ${s.repMax}</div>
        </button>`;
    }).join('');
    return `
      <div class="card">
        <h3>${DAY_NAMES[d]}${d === today ? ', today' : ''}</h3>
        <h2>${esc(info.title)}</h2>
        <div class="muted small">${esc(info.subtitle || '')}${st.text ? ', ' + st.text : ''}</div>
        <a class="btn ${d === today ? '' : 'secondary'}" href="#/workout/${d}" style="text-decoration:none;text-align:center;line-height:52px">${st.label}</a>
        <details class="targets">
          <summary>Targets (${daySlots.length} exercises)</summary>
          ${rows}
        </details>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="header"><h1>Workout</h1></div>
    <p class="sub">Week of ${fmtDate(ws)}</p>
    ${banner}
    ${dayCards}
  `;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-act="target"]');
    if (!btn) return;
    const slot = slots.find((s) => s.id === btn.dataset.slot);
    const ex = exercises.get(slot.exerciseId);
    const sibs = slots.some((x) => x.exerciseId === slot.exerciseId && x.id !== slot.id);
    openOverride(slot, ex, targets.get(slot.id), ws, () => renderList(el, dayList), sibs);
  };
}

function openOverride(slot, ex, row, ws, done, hasSiblings = false) {
  const showW = ex.kind !== 'bodyweight' || (row && row.targetWeight > 0);
  const reps = (row && row.targetReps) || [];
  const repInputs = Array.from({ length: slot.sets }, (_, i) =>
    `<input data-i="${i}" inputmode="numeric" placeholder="${slot.repMin}" value="${reps[i] ?? ''}">`).join('');
  const drop = row && row.suggestion && row.suggestion.type === 'drop'
    ? `<button class="btn secondary" data-act="usedrop">Use suggestion: ${fmtW(row.suggestion.targetWeight)} lb, ${row.suggestion.targetReps.join(' / ')}</button>` : '';
  const { root, close } = openSheet(`
    <h2>${esc(slot.label)}</h2>
    <div class="muted small">Week of ${fmtDate(ws)}. What you save here replaces the target.</div>
    ${showW ? `<label class="field">${ex.kind === 'assisted' ? 'Assist lb' : 'Weight lb'}
      <input id="ow" inputmode="decimal" value="${fmtW(row ? row.targetWeight : '')}"></label>` : ''}
    <label class="field">Reps for each set
      <div class="reprow">${repInputs}</div></label>
    ${hasSiblings ? '<label class="check-line"><input type="checkbox" id="o-all" checked> Use the same for the other days this exercise appears</label>' : ''}
    ${drop}
    <button class="btn" data-act="save">Save target</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>
  `);
  const applyAll = () => hasSiblings && root.querySelector('#o-all').checked;
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') return close();
    if (act === 'usedrop') {
      await saveTarget(ws, slot, { targetWeight: row.suggestion.targetWeight, targetReps: row.suggestion.targetReps }, applyAll());
    } else if (act === 'save') {
      const w = root.querySelector('#ow') ? num(root.querySelector('#ow').value) : (row ? row.targetWeight : null);
      const r = [...root.querySelectorAll('.reprow input')].map((i) => int(i.value) || 0);
      await saveTarget(ws, slot, { targetWeight: w, targetReps: r }, applyAll());
    } else return;
    close();
    done();
  });
}

/* ------------------------------------------------------------------ */
/* Session screen                                                      */
/* ------------------------------------------------------------------ */

async function renderSession(el, day, dayList) {
  const ws = weekStart();
  const today = dateStr();
  await ensureWeekTargets(ws);
  const { exercises, slots: all } = await loadPlan();

  // Today's session, an unfinished one from this week, or a finished one from earlier this week.
  const mine = (await getAll('sessions')).filter((s) =>
    !s.imported && s.day === day && (s.date === today || s.weekStart === ws));
  let session = latest(mine);
  if (session && session.skipped && !session.mini && session.finishedAt) return renderSkipped(el, session, dayList);
  if (session && session.finishedAt) return renderSummary(el, session);
  const slots = session && session.mini
    ? session.miniSlotIds.map((id) => all.find((x) => x.id === id)).filter(Boolean)
    : all.filter((s) => s.day === day);
  if (!session) {
    session = { date: today, day, weekStart: ws, startedAt: Date.now(), finishedAt: null, notes: '', exerciseNotes: {} };
    session.id = await put('sessions', session);
    if (!(await getSetting('baselineWeek', null))) await setSetting('baselineWeek', ws);
  }
  if (!session.exerciseNotes) session.exerciseNotes = {};

  S = {
    el, session, day, ws, exercises, slots,
    dayInfo: dayList.find((d) => d.key === day) || { title: 'Workout', subtitle: '' },
    targets: await weekTargets(ws),
    baseline: await isBaselineWeek(ws),
    hist: await loadHistory(session.id),
    sets: await getAllByIndex('sets', 'sessionId', session.id),
    rule: await getRule(),
    rest: await getSetting('restTimerSeconds', 90),
    restEnd: 0,
    dismissed: new Set(),
    showWeight: new Set(),
    openNotes: new Set(),
  };
  await ensureSetRows();
  draw();
}

function lastEntry(exerciseId) {
  const list = S.hist.byExercise.get(exerciseId) || [];
  return list[list.length - 1] || null;
}

function prefillWeight(slot) {
  const ex = S.exercises.get(slot.exerciseId);
  const tgt = S.targets.get(slot.id);
  let w = tgt && tgt.targetWeight != null ? tgt.targetWeight : null;
  const last = lastEntry(slot.exerciseId);
  if (last) {
    const lw = workingWeight(last.sets, slot.repMin, ex.kind);
    // If this exercise was already logged on another day this week, use that weight, up or down.
    const sameWeek = last.session.date && weekStart(parseDate(last.session.date)) === S.ws;
    if (w == null || sameWeek) w = lw;
  }
  if (w == null) w = slot.startWeight;
  if (ex.kind === 'bodyweight' && !(w > 0)) return null;
  return w ?? null;
}

async function ensureSetRows() {
  for (const slot of S.slots) {
    const have = S.sets.filter((r) => r.slotId === slot.id);
    if (have.length >= slot.sets) continue;
    const w = prefillWeight(slot);
    const variant = have[0] ? have[0].variant : null;
    for (let i = have.length + 1; i <= slot.sets; i++) {
      const row = {
        sessionId: S.session.id, slotId: slot.id, exerciseId: slot.exerciseId,
        setNumber: i, weight: w, reps: null, partials: null, completed: false, failure: !!slot.amrap, variant,
      };
      row.id = await put('sets', row);
      S.sets.push(row);
    }
  }
}

function restLabel() { return S.rest ? `Rest ${S.rest}s` : 'Rest off'; }

function draw() {
  const { el, slots } = S;
  const plan = S.dayInfo;
  el.innerHTML = `
    <a class="back" href="#/workout">Workout</a>
    <div class="header"><h1>${S.session.mini ? 'Mini workout' : esc(plan.title)}</h1><button class="chip" data-act="rest-cycle">${restLabel()}</button></div>
    <p class="sub">${S.session.mini ? `Instead of ${esc(plan.title)}${S.session.skipReason ? ', skipped: ' + esc(S.session.skipReason) : ''}` : esc(plan.subtitle)}${S.baseline ? '. Baseline week, log what you lift.' : ''}</p>
    ${slots.length ? '' : '<div class="card"><h2>No exercises yet</h2><div class="muted">Add your first exercise below.</div></div>'}
    <div id="cards">${slots.map(cardHtml).join('')}</div>
    ${S.session.mini ? '' : '<button class="btn secondary" data-act="addex">Add exercise</button>'}
    ${!S.session.mini && !S.sets.some((r) => r.completed) ? '<button class="link" data-act="skipday" style="display:block;margin:14px auto">Skip this day</button>' : ''}
    <div id="sessionbar">
      <div id="restbar" hidden>
        <span id="resttxt"></span>
        <span><button data-act="rest-add">+15s</button><button data-act="rest-skip">Skip</button></span>
      </div>
      <div class="barrow">
        <div class="total">Reps this session <b id="reptotal">0</b></div>
        <button class="finish" data-act="finish">Finish</button>
      </div>
    </div>`;
  el.onclick = onClick;
  el.onchange = onChange;
  el.oninput = onInput;
  updateTotal();
}

function moveUpBanner(slot, ex, rows) {
  if (S.rule !== 'first') return null;
  for (const r of rows) {
    if (!r.completed || !(r.reps > 0) || r.reps < slot.repMax) continue;
    const w = r.weight ?? 0;
    if (rows.some((x) => x.setNumber < r.setNumber && x.completed && (x.weight ?? 0) === w)) continue;
    const later = rows.filter((x) => x.setNumber > r.setNumber && !x.completed && (x.weight ?? 0) === w);
    if (!later.length) continue;
    const key = `${slot.id}:${r.setNumber}`;
    if (S.dismissed.has(key)) continue;
    return { key, from: w, to: stepWeight(w, ex, true), reps: r.reps, set: r.setNumber };
  }
  return null;
}

function rowState(slot, ex, tgt, r, idx) {
  if (!r.completed) return '';
  if (r.reps == null) return 'done';
  const t = tgt && tgt.targetReps ? tgt.targetReps[idx] : null;
  const sameWeight = !tgt || tgt.targetWeight == null || (r.weight ?? 0) === tgt.targetWeight;
  if (t && sameWeight) return r.reps >= t ? 'done met' : 'done below';
  if (r.reps >= slot.repMax) return 'done met';
  if (r.reps >= slot.repMin) return 'done';
  return 'done below';
}

function cardHtml(slot) {
  const ex = S.exercises.get(slot.exerciseId);
  const rows = S.sets.filter((r) => r.slotId === slot.id).sort((a, b) => a.setNumber - b.setNumber);
  const tgt = S.targets.get(slot.id);
  const variant = slot.variants ? ((rows[0] && rows[0].variant) || slot.variants[0]) : null;
  const showW = ex.kind !== 'bodyweight' || S.showWeight.has(ex.id) || rows.some((r) => r.weight > 0);
  const wLabel = ex.kind === 'assisted' ? 'Assist lb' : 'Weight lb';

  const badges = [
    slot.amrap ? '<span class="badge">AMRAP</span>' : '',
    slot.partialsOnLastSet ? '<span class="badge">Half reps on last set</span>' : '',
    slot.defaultScheme ? '<span class="badge warn">Set your scheme</span>' : '',
  ].join('');

  const last = lastEntry(slot.exerciseId);
  const lastLine = last
    ? `Last: ${last.sets.map((s) => (s.weight ? `${fmtW(s.weight)} x ${s.reps}` : `${s.reps}`) + (s.failure ? ' F' : '')).join(', ')} (${fmtDate(last.session.date)})`
    : 'First time logging this one';

  let targetLine;
  if (tgt) {
    const txt = targetText(tgt, slot, ex);
    targetLine = `<span class="tgt">Target: ${esc(txt)}</span>`;
  } else if (S.baseline) {
    targetLine = '<span class="muted">Baseline week, no target. Log what you do.</span>';
  } else {
    targetLine = '';
  }

  const hasPartial = slot.partialsOnLastSet;
  const setRows = rows.map((r, i) => {
    const t = tgt && tgt.targetReps ? tgt.targetReps[i] : null;
    const isLast = i === rows.length - 1;
    return `
      <div class="setrow ${rowState(slot, ex, tgt, r, i)}" data-set="${r.id}">
        <div class="setnum">${r.setNumber}</div>
        ${showW ? `<input data-f="weight" inputmode="decimal" placeholder="lb" value="${fmtW(r.weight)}">` : '<div></div>'}
        <input data-f="reps" inputmode="numeric" placeholder="${t || 'reps'}" value="${r.reps ?? ''}">
        ${hasPartial ? (isLast ? `<input data-f="partials" inputmode="numeric" placeholder="half" value="${r.partials ?? ''}">` : '<div></div>') : ''}
        <button class="failbtn ${r.failure ? 'on' : ''}" data-act="fail" aria-pressed="${r.failure ? 'true' : 'false'}" aria-label="Set ${r.setNumber} went to failure">F</button>
        <button class="check" data-act="check" aria-label="Log set ${r.setNumber}">${CHECK}</button>
      </div>`;
  }).join('');

  const b = moveUpBanner(slot, ex, rows);
  const harderWord = ex.kind === 'assisted' ? 'Drop assist to' : 'Move up to';
  const banner = b ? `
    <div class="banner">
      <div>Hit ${b.reps} on set ${b.set}. ${harderWord} ${fmtW(b.to)} lb for the next sets?</div>
      <div class="bannerbtns">
        <button data-act="moveup" data-slot="${slot.id}" data-set="${b.set}" data-from="${b.from}" data-to="${b.to}">${ex.kind === 'assisted' ? 'Drop assist' : 'Move up'}</button>
        <button data-act="stay" data-key="${b.key}">Stay</button>
      </div>
    </div>` : '';

  const note = S.session.exerciseNotes[ex.id] || '';
  const noteOpen = S.openNotes.has(ex.id) || note;

  return `
    <section class="card ex" data-slot="${slot.id}">
      <div class="exhead">
        <div>
          <h2>${esc(variant || slot.label)}</h2>
          <div class="meta">${slot.sets} x ${slot.repMin} to ${slot.repMax}</div>
          <div>${badges}</div>
        </div>
        ${slot.variants ? `<button class="chip" data-act="swap" data-slot="${slot.id}">Swap</button>` : ''}
      </div>
      <div class="lines small"><div class="muted">${esc(lastLine)}</div><div>${targetLine}</div></div>
      ${slot.notes ? `<div class="small muted" style="margin-top:4px">${esc(slot.notes)}</div>` : ''}
      <div class="colhead"><span></span><span>${showW ? wLabel : ''}</span><span>Reps</span>${hasPartial ? '<span>Half</span>' : ''}<span class="failhead">Fail</span><span></span></div>
      ${setRows}
      ${banner}
      <div class="exfoot">
        ${showW ? '' : `<button class="link" data-act="addw" data-ex="${ex.id}">+ added weight</button>`}
        <button class="link" data-act="addset" data-slot="${slot.id}">+ set</button>
        ${rows.length > 1 && !rows[rows.length - 1].completed ? `<button class="link" data-act="rmset" data-slot="${slot.id}">Remove last set</button>` : ''}
        <button class="link" data-act="notes" data-ex="${ex.id}">${note ? 'Note' : 'Add note'}</button>
        ${S.session.mini ? '' : `<button class="link" data-act="rmex" data-slot="${slot.id}">Remove exercise</button>`}
      </div>
      ${noteOpen ? `<textarea class="note" data-note="${ex.id}" rows="2" placeholder="Note for this exercise">${esc(note)}</textarea>` : ''}
    </section>`;
}

function refreshCard(slotId) {
  const slot = S.slots.find((s) => s.id === slotId);
  const old = S.el.querySelector(`.card.ex[data-slot="${slotId}"]`);
  if (!old || !slot) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHtml(slot).trim();
  old.replaceWith(tmp.firstElementChild);
}

function updateTotal() {
  const total = S.sets.filter((r) => r.completed).reduce((a, r) => a + (r.reps || 0), 0);
  const t = document.getElementById('reptotal');
  if (t) t.textContent = total;
}

function flash(input) {
  if (!input) return;
  input.classList.add('shake');
  input.focus();
  setTimeout(() => input.classList.remove('shake'), 500);
}

// Saves a typed value straight away (every keystroke), so closing the app never loses it.
async function saveField(e, refresh) {
  if (!S) return;
  const noteEl = e.target.closest('[data-note]');
  if (noteEl) {
    S.session.exerciseNotes[noteEl.dataset.note] = noteEl.value.trim();
    await put('sessions', S.session);
    return;
  }
  const input = e.target.closest('.setrow input');
  if (!input) return;
  const rowEl = input.closest('.setrow');
  const row = S.sets.find((r) => r.id === Number(rowEl.dataset.set));
  const f = input.dataset.f;
  if (f === 'weight') row.weight = num(input.value);
  else row[f] = int(input.value);
  await put('sets', row);
  if (refresh && row.completed) {
    refreshCard(row.slotId);
    updateTotal();
  }
}
const onInput = (e) => saveField(e, false);
const onChange = (e) => saveField(e, true);

async function toggleCheck(rowEl) {
  const row = S.sets.find((r) => r.id === Number(rowEl.dataset.set));
  const slot = S.slots.find((s) => s.id === row.slotId);
  const ex = S.exercises.get(row.exerciseId);

  if (row.completed) {
    row.completed = false;
    await put('sets', row);
    refreshCard(row.slotId);
    updateTotal();
    return;
  }

  const wInput = rowEl.querySelector('[data-f="weight"]');
  const rInput = rowEl.querySelector('[data-f="reps"]');
  const pInput = rowEl.querySelector('[data-f="partials"]');
  const weight = wInput ? num(wInput.value) : row.weight;
  if (wInput && ex.kind !== 'bodyweight' && weight === null) return flash(wInput);

  let reps = int(rInput.value);
  // You tapped F and left reps empty: log it as a set to failure with the reps lost.
  const lost = reps === null && row.failure && row.failureUser;
  if (reps === null && !lost) {
    // One tap logs the target reps, but only when the weight matches the target.
    const tgt = S.targets.get(slot.id);
    const idx = row.setNumber - 1;
    const t = tgt && tgt.targetReps ? tgt.targetReps[idx] : null;
    const sameWeight = tgt && (tgt.targetWeight == null || (weight ?? 0) === tgt.targetWeight);
    if (t && sameWeight) reps = t;
  }
  if (!lost && !(reps > 0)) return flash(rInput);

  row.weight = weight;
  row.reps = reps;
  row.partials = pInput ? int(pInput.value) : null;
  row.completed = true;
  await put('sets', row);
  refreshCard(row.slotId);
  updateTotal();
  startRest();
}

async function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === 'check') return toggleCheck(btn.closest('.setrow'));

  if (act === 'fail') {
    const rowEl = btn.closest('.setrow');
    const row = S.sets.find((r) => r.id === Number(rowEl.dataset.set));
    row.failure = !row.failure;
    row.failureUser = row.failure;
    btn.classList.toggle('on', row.failure);
    btn.setAttribute('aria-pressed', row.failure ? 'true' : 'false');
    await put('sets', row);
    return;
  }

  if (act === 'moveup') {
    const { slot, set, from, to } = btn.dataset;
    for (const r of S.sets) {
      if (r.slotId === slot && r.setNumber > Number(set) && !r.completed && (r.weight ?? 0) === Number(from)) {
        r.weight = Number(to);
        await put('sets', r);
      }
    }
    return refreshCard(slot);
  }
  if (act === 'stay') {
    S.dismissed.add(btn.dataset.key);
    return refreshCard(btn.dataset.key.split(':')[0]);
  }
  if (act === 'swap') {
    const slot = S.slots.find((s) => s.id === btn.dataset.slot);
    const rows = S.sets.filter((r) => r.slotId === slot.id);
    const cur = rows[0].variant || slot.variants[0];
    const next = slot.variants[(slot.variants.indexOf(cur) + 1) % slot.variants.length];
    for (const r of rows) { r.variant = next; await put('sets', r); }
    return refreshCard(slot.id);
  }
  if (act === 'addw') {
    S.showWeight.add(btn.dataset.ex);
    const slot = S.slots.find((s) => s.exerciseId === btn.dataset.ex);
    return refreshCard(slot.id);
  }
  if (act === 'notes') {
    S.openNotes.add(btn.dataset.ex);
    const slot = S.slots.find((s) => s.exerciseId === btn.dataset.ex);
    refreshCard(slot.id);
    const ta = S.el.querySelector(`[data-note="${btn.dataset.ex}"]`);
    if (ta) ta.focus();
    return;
  }
  if (act === 'rest-cycle') {
    const opts = [0, 60, 90, 120, 180];
    S.rest = opts[(opts.indexOf(S.rest) + 1) % opts.length];
    await setSetting('restTimerSeconds', S.rest);
    btn.textContent = restLabel();
    if (!S.rest) stopRest(true);
    return;
  }
  if (act === 'rest-add') { S.restEnd = Math.max(S.restEnd, Date.now()) + 15000; return tickRest(); }
  if (act === 'rest-skip') return stopRest(true);
  if (act === 'finish') return finish();

  if (act === 'addset') {
    const slot = S.slots.find((x) => x.id === btn.dataset.slot);
    const rows = S.sets.filter((r) => r.slotId === slot.id).sort((a, b) => a.setNumber - b.setNumber);
    const last = rows[rows.length - 1];
    const row = {
      sessionId: S.session.id, slotId: slot.id, exerciseId: slot.exerciseId,
      setNumber: last ? last.setNumber + 1 : 1, weight: last ? last.weight : prefillWeight(slot),
      reps: null, partials: null, completed: false, failure: !!slot.amrap, variant: last ? last.variant : null,
    };
    row.id = await put('sets', row);
    S.sets.push(row);
    return refreshCard(slot.id);
  }
  if (act === 'rmset') {
    const rows = S.sets.filter((r) => r.slotId === btn.dataset.slot).sort((a, b) => a.setNumber - b.setNumber);
    const last = rows[rows.length - 1];
    if (!last || last.completed) return;
    await remove('sets', last.id);
    S.sets = S.sets.filter((r) => r.id !== last.id);
    return refreshCard(btn.dataset.slot);
  }
  if (act === 'skipday') {
    const { el, day, dayInfo } = S;
    return openSkipSheet(day, dayInfo.title, async () => { stopRest(); S = null; renderSession(el, day, await getDays()); });
  }
  if (act === 'rmex') {
    const slot = S.slots.find((x) => x.id === btn.dataset.slot);
    const mine = S.sets.filter((r) => r.slotId === slot.id);
    if (mine.some((r) => r.completed)) return alert('Uncheck the logged sets first, then remove it.');
    if (!confirm(`Remove ${slot.label} from ${S.dayInfo.title}? Your history stays saved.`)) return;
    for (const r of mine) await remove('sets', r.id);
    S.sets = S.sets.filter((r) => r.slotId !== slot.id);
    await removeSlot(slot.id);
    S.slots = S.slots.filter((x) => x.id !== slot.id);
    return draw();
  }
  if (act === 'addex') {
    return openAddExercise(S.day, async () => {
      const plan = await loadPlan();
      S.exercises = plan.exercises;
      S.slots = plan.slots.filter((x) => x.day === S.day);
      await ensureWeekTargets(S.ws);
      S.targets = await weekTargets(S.ws);
      await ensureSetRows();
      draw();
      window.scrollTo(0, document.body.scrollHeight);
    });
  }
}

/* Rest timer */
function startRest() {
  if (!S.rest) return;
  S.restEnd = Date.now() + S.rest * 1000;
  clearInterval(restHandle);
  tickRest();
  restHandle = setInterval(tickRest, 500);
}
function tickRest() {
  const bar = document.getElementById('restbar');
  if (!bar || !S) return stopRest();
  const left = Math.ceil((S.restEnd - Date.now()) / 1000);
  bar.hidden = false;
  const txt = document.getElementById('resttxt');
  if (left <= 0) {
    txt.textContent = 'Rest done, next set';
    clearInterval(restHandle);
    restHandle = null;
    if (navigator.vibrate) navigator.vibrate(250);
    return;
  }
  const m = Math.floor(left / 60);
  txt.textContent = `Rest ${m}:${String(left % 60).padStart(2, '0')}`;
}
function stopRest(hide = false) {
  clearInterval(restHandle);
  restHandle = null;
  if (hide) {
    const bar = document.getElementById('restbar');
    if (bar) bar.hidden = true;
  }
}

async function finish() {
  const done = S.sets.filter((r) => r.completed).length;
  if (!done && !confirm('No sets are logged. Finish anyway?')) return;
  for (const r of S.sets.filter((x) => !x.completed && !(x.reps > 0))) await remove('sets', r.id);
  S.session.finishedAt = Date.now();
  await put('sessions', S.session);
  // Other days of the same exercise take the weight you used today.
  const byEx = new Map();
  for (const r of S.sets.filter((x) => x.completed && x.reps > 0)) {
    if (!byEx.has(r.exerciseId)) byEx.set(r.exerciseId, []);
    byEx.get(r.exerciseId).push(r);
  }
  for (const [exId, sets] of byEx) {
    const ex = S.exercises.get(exId);
    const slot = S.slots.find((x) => x.exerciseId === exId);
    if (!ex || !slot) continue;
    const w = workingWeight(sets, slot.repMin, ex.kind);
    if (ex.kind !== 'bodyweight' || w > 0) await syncWeightToSiblings(exId, w, S.ws, slot.id);
  }
  const { el, session } = S;
  stopRest();
  S = null;
  await renderSummary(el, session);
}

/* ------------------------------------------------------------------ */
/* Skipped day                                                         */
/* ------------------------------------------------------------------ */

async function renderSkipped(el, session, dayList) {
  const info = dayList.find((d) => d.key === session.day) || { title: 'Workout' };
  const mini = await miniSlots(session.day);
  el.innerHTML = `
    <a class="back" href="#/today">Today</a>
    <div class="header"><h1>Day skipped</h1></div>
    <p class="sub">${esc(info.title)}, ${fmtDate(session.date)}</p>
    <div class="card">
      <h3>Reason</h3>
      <div>${esc(session.skipReason || 'No reason given')}</div>
      ${session.skipNote ? `<div class="muted small" style="margin-top:6px">${esc(session.skipNote)}</div>` : ''}
      <div class="muted small" style="margin-top:8px">Nothing changes in your targets. Anything you skip carries forward to next time.</div>
    </div>
    ${mini.length ? '<button class="btn" data-act="domini">Do the mini workout now</button>' : ''}
    <button class="btn secondary" data-act="undo">Undo skip and start the full workout</button>
    <a class="btn secondary" href="#/today" style="text-decoration:none;text-align:center;line-height:52px">Done</a>`;
  el.oninput = null; el.onchange = null;
  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'undo') { await undoSkip(session); return renderSession(el, session.day, dayList); }
    if (act === 'domini') {
      session.mini = true;
      session.miniSlotIds = mini.map((m) => m.slot.id);
      session.finishedAt = null;
      session.startedAt = Date.now();
      await put('sessions', session);
      if (!(await getSetting('baselineWeek', null))) await setSetting('baselineWeek', session.weekStart);
      return renderSession(el, session.day, dayList);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Finish summary                                                      */
/* ------------------------------------------------------------------ */

async function renderSummary(el, session) {
  stopRest();
  const { exercises, slots: all } = await loadPlan();
  const slots = session.mini
    ? session.miniSlotIds.map((id) => all.find((x) => x.id === id)).filter(Boolean)
    : all.filter((s) => s.day === session.day);
  const allSets = await getAllByIndex('sets', 'sessionId', session.id);
  const sets = allSets.filter((s) => s.completed && s.reps > 0);
  const lostSets = allSets.filter((s) => s.completed && s.reps == null);
  const ws = session.weekStart || weekStart(parseDate(session.date));
  const targets = await weekTargets(ws);
  const baseline = await isBaselineWeek(ws);
  const hist = await loadHistory(session.id);
  const rule = await getRule();
  const days = await getDays();
  const dayInfo = days.find((d) => d.key === session.day) || { title: 'Workout' };

  let totalReps = 0;
  let volume = 0;
  const lines = [];
  const bests = [];
  const moveUps = [];

  for (const slot of slots) {
    const ex = exercises.get(slot.exerciseId);
    const mine = sets.filter((s) => s.slotId === slot.id).sort((a, b) => a.setNumber - b.setNumber);
    const shown = [...mine, ...lostSets.filter((s) => s.slotId === slot.id)].sort((a, b) => a.setNumber - b.setNumber);
    if (!shown.length) continue;
    if (!mine.length) {
      lines.push(`<div class="row"><div><div class="name">${esc(slot.label)}</div><div class="meta">${shown.map((s) => (s.weight ? `${fmtW(s.weight)} x ? F` : '? F')).join(', ')}</div></div><div class="scheme">reps lost</div></div>`);
      continue;
    }
    const reps = mine.reduce((a, s) => a + s.reps, 0);
    totalReps += reps;
    if (ex.kind === 'weighted') volume += mine.reduce((a, s) => a + (s.weight || 0) * s.reps, 0);
    const goal = targets.get(slot.id) ? targets.get(slot.id).totalRepGoal : null;
    const cls = goal ? (reps >= goal ? 'ok' : 'low') : '';
    lines.push(`
      <div class="row">
        <div><div class="name">${esc(slot.label)}</div>
          <div class="meta">${shown.map((s) => (s.reps == null ? (s.weight ? `${fmtW(s.weight)} x ?` : '?') : (s.weight ? `${fmtW(s.weight)} x ${s.reps}` : s.reps)) + (s.failure ? ' F' : '')).join(', ')}</div></div>
        <div class="scheme ${cls}">${goal ? `${reps} / ${goal}` : reps}</div>
      </div>`);

    const prior = (hist.byExercise.get(slot.exerciseId) || []).flatMap((h) => h.sets);
    const todayEx = sets.filter((s) => s.exerciseId === slot.exerciseId);
    for (const b of findBests(todayEx, prior, ex.kind)) {
      const w = b.weight ? `${fmtW(b.weight)} lb` : 'bodyweight';
      bests.push(b.type === 'weight'
        ? `${esc(slot.label)}: ${w} for ${b.reps} reps (was ${fmtW(b.prev)} lb)`
        : `${esc(slot.label)}: ${b.reps} reps at ${w} (was ${b.prev})`);
    }

    const slotHist = (hist.bySlot.get(slot.id) || []).filter((h) => !h.session.imported);
    const prev = slotHist[slotHist.length - 1];
    const next = nextTarget({ slot, ex, lastSets: mine, prevSets: prev ? prev.sets : [], rule });
    const wNow = workingWeight(mine, slot.repMin, ex.kind);
    if (next.targetWeight != null && next.targetWeight !== wNow) {
      moveUps.push(`${esc(slot.label)}: ${fmtW(wNow)} to ${fmtW(next.targetWeight)} lb`);
    } else if (next.suggestion && next.suggestion.type === 'addWeight') {
      moveUps.push(`${esc(slot.label)}: top of the range, add weight`);
    }
  }

  const mins = session.startedAt && session.finishedAt ? Math.max(1, Math.round((session.finishedAt - session.startedAt) / 60000)) : null;
  const list = (title, items, empty) => `
    <div class="card"><h3>${title}</h3>
      ${items.length ? items.map((t) => `<div class="row"><div>${t}</div></div>`).join('') : `<div class="muted small">${empty}</div>`}
    </div>`;

  el.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'reopen') {
      session.finishedAt = null;
      await put('sessions', session);
      renderSession(el, session.day, days);
    }
  };
  el.onchange = null;
  el.innerHTML = `
    <a class="back" href="#/today">Today</a>
    <div class="header"><h1>${session.mini ? 'Mini workout done' : 'Workout done'}</h1></div>
    <p class="sub">${session.mini ? `Instead of ${esc(dayInfo.title)}${session.skipReason ? ', skipped: ' + esc(session.skipReason) : ''}` : esc(dayInfo.title)}, ${fmtDate(session.date)}</p>
    <div class="card stats">
      <div><b>${totalReps}</b><span>reps</span></div>
      <div><b>${Math.round(volume).toLocaleString()}</b><span>lb volume</span></div>
      ${mins ? `<div><b>${mins}</b><span>minutes</span></div>` : ''}
    </div>
    ${baseline ? `<div class="card"><h3>Baseline week</h3><div>Logged. Your targets are built next Monday from what you lifted this week.</div></div>` : ''}
    ${list('New bests', bests, 'None this time.')}
    ${list('Move up next time', moveUps, 'Nothing hit the top of its range yet.')}
    <div class="card"><h3>Reps vs goal</h3>${lines.join('') || '<div class="muted small">No sets logged.</div>'}</div>
    <a class="btn" href="#/today" style="text-decoration:none;text-align:center;line-height:52px">Done</a>
    <button class="btn secondary" data-act="reopen">Reopen to edit sets</button>
  `;
}

return { render };
})();

/* ===== js/screens/food.js ===== */
__m['js/screens/food.js'] = (function () {
// Food tab: calories and protein for the day.
const { getAll, getAllByIndex, put, remove, getSetting, setSetting, dateStr, dayKey, parseDate } = __m['js/db.js'];
const { targetFor } = __m['js/stats.js'];
const { esc, fmtLong, openSheet, addDays, nowTime } = __m['js/ui.js'];
const { getDays } = __m['js/seed.js'];

let viewDate = null; // lets you log for another day when you forgot

const n0 = (v) => Math.round(v || 0);
const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isNaN(x) ? null : x; };

function ring(value, goal, label, unit) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = goal ? Math.min(1, value / goal) : 0;
  const over = goal && value > goal;
  const left = Math.round(goal - value);
  return `
    <div class="ringbox">
      <svg viewBox="0 0 120 120" class="ring">
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="#24345A" stroke-width="10"/>
        <circle cx="60" cy="60" r="${r}" fill="none" stroke="${over ? '#FBBF24' : '#3B82F6'}" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${c * pct} ${c}" transform="rotate(-90 60 60)"/>
        <text x="60" y="58" text-anchor="middle" fill="#E8EEF8" font-size="20" font-weight="700">${n0(value)}</text>
        <text x="60" y="76" text-anchor="middle" fill="#8EA0BF" font-size="11">of ${n0(goal)} ${unit}</text>
      </svg>
      <div class="ringlabel">${label}</div>
      <div class="small ${left < 0 ? 'low' : 'muted'}">${left >= 0 ? `${left} ${unit} left` : `${-left} ${unit} over`}</div>
    </div>`;
}

async function render(el) {
  const today = dateStr();
  if (!viewDate) viewDate = today;
  const date = viewDate;
  const entries = (await getAllByIndex('foodEntries', 'date', date)).sort((a, b) => (a.time || '').localeCompare(b.time || '') || a.id - b.id);
  const presets = (await getAll('foodPresets')).sort((a, b) => a.sortOrder - b.sortOrder);
  const target = await targetFor(date);
  const tot = entries.reduce((a, e) => ({
    kcal: a.kcal + (e.kcal || 0), protein: a.protein + (e.protein || 0),
    carbs: a.carbs + (e.carbs || 0), fat: a.fat + (e.fat || 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const liftDay = (await getDays()).some((d) => d.key === dayKey(parseDate(date)));
  const carbDone = await getSetting(`carbPortion:${date}`, false);
  const waterOn = await getSetting('waterOn', false);
  const water = waterOn ? await getSetting(`water:${date}`, 0) : 0;
  const yesterdayCount = (await getAllByIndex('foodEntries', 'date', addDays(date, -1))).length;

  el.innerHTML = `
    <div class="header"><h1>Food</h1></div>
    <div class="datebar">
      <button class="icon-btn" data-act="prev" aria-label="Previous day">&lt;</button>
      <div>${date === today ? 'Today' : fmtLong(date)}</div>
      <button class="icon-btn" data-act="next" aria-label="Next day" ${date >= today ? 'disabled' : ''}>&gt;</button>
    </div>

    <div class="card rings">
      ${ring(tot.kcal, target.kcal, 'Calories', 'kcal')}
      ${ring(tot.protein, target.protein, 'Protein', 'g')}
    </div>
    <div class="small muted" style="margin:-4px 4px 12px">Soft guides: carbs ${n0(tot.carbs)} of ${n0(target.carbs)} g, fat ${n0(tot.fat)} of ${n0(target.fat)} g</div>

    ${liftDay ? `<label class="card check-line" style="margin-bottom:12px"><input type="checkbox" data-act="carb" ${carbDone ? 'checked' : ''}> Carb portion before or after lifting</label>` : ''}
    ${waterOn ? `<div class="card" style="display:flex;align-items:center;justify-content:space-between"><div><h3 style="margin:0">Water</h3><div class="name">${water} glasses</div></div><div><button class="chip" data-act="water" data-d="-1">Less</button> <button class="chip" data-act="water" data-d="1">+1 glass</button></div></div>` : ''}

    <div class="card">
      <h3>Quick add</h3>
      <div class="grid2">
        <label class="field" style="margin-top:0">kcal<input id="q-kcal" inputmode="numeric" class="big"></label>
        <label class="field" style="margin-top:0">Protein g<input id="q-pro" inputmode="decimal" class="big"></label>
      </div>
      <label class="field">Name, optional<input id="q-name" placeholder="Food"></label>
      <details class="targets"><summary>More</summary>
        <div class="grid2">
          <label class="field">Carbs g<input id="q-carb" inputmode="decimal"></label>
          <label class="field">Fat g<input id="q-fat" inputmode="decimal"></label>
        </div>
      </details>
      <label class="check-line"><input type="checkbox" id="q-preset"> Save as preset</label>
      <button class="btn" data-act="quick">Add</button>
    </div>

    <div class="card">
      <h3>Presets <button class="link" data-act="newpreset" style="float:right;min-height:0">New preset</button></h3>
      <div class="presets">
        ${presets.map((p) => `
          <button class="preset" data-act="preset" data-id="${p.id}">
            <b>${esc(p.name)}</b>
            <span>${p.kcal != null ? n0(p.kcal) + ' kcal' : 'tap to set'}${p.protein != null ? ', ' + n0(p.protein) + ' g' : ''}</span>
          </button>`).join('') || '<div class="muted small">No presets yet.</div>'}
      </div>
      <div class="small muted" style="margin-top:8px">Long press a preset to edit it.</div>
    </div>

    <div class="card">
      <h3>${date === today ? "Today's" : 'Day'} entries</h3>
      ${entries.map((e) => `
        <button class="row tap" data-act="edit" data-id="${e.id}">
          <div style="text-align:left"><div class="name">${esc(e.name || 'Food')}</div><div class="meta">${esc(e.time || '')}</div></div>
          <div class="scheme">${n0(e.kcal)} kcal, ${n0(e.protein)} g</div>
        </button>`).join('') || '<div class="muted small">Nothing logged yet.</div>'}
      ${yesterdayCount && !entries.length ? `<button class="btn secondary" data-act="repeat">Repeat yesterday (${yesterdayCount} entries)</button>` : ''}
    </div>

    <details class="card targets">
      <summary>Eating tips</summary>
      <div class="small" style="margin-top:8px;line-height:1.5">
        Have a solid carb portion around the lift. Cut sugar and sauces but keep carbs. Drink plenty of water. Salt your food normally.
      </div>
    </details>`;

  let pressTimer = null;
  const presetEl = (t) => t.closest('[data-act="preset"]');
  el.ontouchstart = (e) => {
    const b = presetEl(e.target);
    if (!b) return;
    pressTimer = setTimeout(() => { pressTimer = 'fired'; editPreset(presets.find((p) => p.id === Number(b.dataset.id)), () => render(el)); }, 550);
  };
  el.ontouchend = () => { if (pressTimer && pressTimer !== 'fired') clearTimeout(pressTimer); };
  el.ontouchmove = () => { if (pressTimer && pressTimer !== 'fired') clearTimeout(pressTimer); };
  el.oncontextmenu = (e) => {
    const b = presetEl(e.target);
    if (b) { e.preventDefault(); editPreset(presets.find((p) => p.id === Number(b.dataset.id)), () => render(el)); }
  };

  el.onchange = async (e) => {
    if (e.target.dataset.act === 'carb') await setSetting(`carbPortion:${date}`, e.target.checked);
  };

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    if (pressTimer === 'fired') { pressTimer = null; return; }
    const act = btn.dataset.act;
    const log = async (o) => {
      await put('foodEntries', { date, time: nowTime(), name: o.name || '', kcal: o.kcal || 0, protein: o.protein || 0, carbs: o.carbs || 0, fat: o.fat || 0, presetId: o.presetId ?? null });
    };

    if (act === 'prev') { viewDate = addDays(date, -1); return render(el); }
    if (act === 'next') { viewDate = addDays(date, 1); return render(el); }
    if (act === 'water') { await setSetting(`water:${date}`, Math.max(0, water + Number(btn.dataset.d))); return render(el); }
    if (act === 'quick') {
      const q = (id) => el.querySelector(id);
      const kcal = num(q('#q-kcal').value);
      const protein = num(q('#q-pro').value);
      if (kcal === null && protein === null) { q('#q-kcal').classList.add('shake'); return; }
      const o = { name: q('#q-name').value.trim(), kcal: kcal || 0, protein: protein || 0, carbs: num(q('#q-carb').value) || 0, fat: num(q('#q-fat').value) || 0 };
      if (q('#q-preset').checked && o.name) {
        const id = await put('foodPresets', { name: o.name, kcal: o.kcal, protein: o.protein, carbs: o.carbs, fat: o.fat, sortOrder: presets.length });
        o.presetId = id;
      }
      await log(o);
      return render(el);
    }
    if (act === 'preset') {
      const p = presets.find((x) => x.id === Number(btn.dataset.id));
      if (p.kcal == null) return editPreset(p, () => render(el), true);
      await log({ ...p, presetId: p.id });
      return render(el);
    }
    if (act === 'newpreset') return editPreset(null, () => render(el));
    if (act === 'repeat') {
      for (const y of await getAllByIndex('foodEntries', 'date', addDays(date, -1))) {
        await log({ name: y.name, kcal: y.kcal, protein: y.protein, carbs: y.carbs, fat: y.fat, presetId: y.presetId });
      }
      return render(el);
    }
    if (act === 'edit') return editEntry(entries.find((x) => x.id === Number(btn.dataset.id)), () => render(el));
  };
}

function fields(o) {
  return `
    <label class="field">Name<input id="f-name" value="${esc(o.name || '')}"></label>
    <div class="grid2">
      <label class="field">kcal<input id="f-kcal" inputmode="numeric" value="${o.kcal ?? ''}"></label>
      <label class="field">Protein g<input id="f-pro" inputmode="decimal" value="${o.protein ?? ''}"></label>
      <label class="field">Carbs g<input id="f-carb" inputmode="decimal" value="${o.carbs ?? ''}"></label>
      <label class="field">Fat g<input id="f-fat" inputmode="decimal" value="${o.fat ?? ''}"></label>
    </div>`;
}
const read = (root) => ({
  name: root.querySelector('#f-name').value.trim(),
  kcal: num(root.querySelector('#f-kcal').value),
  protein: num(root.querySelector('#f-pro').value),
  carbs: num(root.querySelector('#f-carb').value),
  fat: num(root.querySelector('#f-fat').value),
});

function editEntry(row, done) {
  const { root, close } = openSheet(`
    <h2>Edit entry</h2>${fields(row)}
    <button class="btn" data-act="save">Save</button>
    <button class="btn secondary" data-act="delete" style="color:#FBBF24">Delete entry</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') return close();
    if (act === 'delete') { await remove('foodEntries', row.id); close(); return done(); }
    if (act === 'save') {
      const o = read(root);
      await put('foodEntries', { ...row, ...o, kcal: o.kcal || 0, protein: o.protein || 0, carbs: o.carbs || 0, fat: o.fat || 0 });
      close();
      done();
    }
  });
}

// Presets: first tap on a blank one asks for the numbers, saves them, and logs it.
function editPreset(p, done, logAfter = false) {
  const row = p || { name: '', kcal: null, protein: null, carbs: null, fat: null };
  const { root, close } = openSheet(`
    <h2>${p ? 'Edit preset' : 'New preset'}</h2>
    ${logAfter ? '<div class="muted small">Enter the numbers once. They are saved for next time and this one gets logged now.</div>' : ''}
    ${fields(row)}
    <button class="btn" data-act="save">${logAfter ? 'Save and log' : 'Save'}</button>
    ${p ? '<button class="btn secondary" data-act="left">Move earlier</button><button class="btn secondary" data-act="delete" style="color:#FBBF24">Delete preset</button>' : ''}
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'cancel') return close();
    if (act === 'delete') { await remove('foodPresets', p.id); close(); return done(); }
    if (act === 'left') {
      const all = (await getAll('foodPresets')).sort((a, b) => a.sortOrder - b.sortOrder);
      const i = all.findIndex((x) => x.id === p.id);
      if (i > 0) {
        [all[i - 1], all[i]] = [all[i], all[i - 1]];
        for (let k = 0; k < all.length; k++) await put('foodPresets', { ...all[k], sortOrder: k });
      }
      close();
      return done();
    }
    if (act === 'save') {
      const o = read(root);
      if (!o.name) return root.querySelector('#f-name').classList.add('shake');
      const all = await getAll('foodPresets');
      const saved = { ...row, ...o, sortOrder: p ? p.sortOrder : all.length };
      const id = await put('foodPresets', saved);
      if (logAfter) {
        await put('foodEntries', { date: viewDate || dateStr(), time: nowTime(), name: o.name, kcal: o.kcal || 0, protein: o.protein || 0, carbs: o.carbs || 0, fat: o.fat || 0, presetId: id });
      }
      close();
      done();
    }
  });
}

return { render };
})();

/* ===== js/screens/progress.js ===== */
__m['js/screens/progress.js'] = (function () {
// Progress tab: Lifts, Body, Food.
const { getAll, put, dateStr, weekStart, parseDate } = __m['js/db.js'];
const { liftData, dailyWeights, waistEntries, foodTotals, targetFor } = __m['js/stats.js'];
const { chartSvg, COLORS, autoFmt } = __m['js/charts.js'];
const { weightChart, waistChart } = __m['js/screens/weight.js'];
const { nextTarget } = __m['js/progression.js'];
const { loadHistory, weekTargets, getRule } = __m['js/targets.js'];
const { esc, fmtW, fmtDate, addDays, dayNum, openSheet, mean } = __m['js/ui.js'];
const { DAY_NAMES } = __m['js/seed.js'];
const { photoUrl } = __m['js/photos.js'];

let seg = 'lifts';
let exId = null;
let filter = '';
let range = 90;
let photoA = null;
let photoB = null;

const weekTicks = (weeks) => {
  const step = Math.max(1, Math.ceil(weeks.length / 5));
  return weeks.filter((_, i) => i % step === 0).map((w) => ({ x: dayNum(w), label: fmtDate(w) }));
};

async function render(el) {
  const head = `
    <div class="header"><h1>Progress</h1></div>
    <div class="segs" style="margin-bottom:12px">
      ${['lifts', 'body', 'food'].map((s) => `<button class="seg ${seg === s ? 'on' : ''}" data-act="seg" data-s="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}
    </div>`;
  let body = '';
  if (seg === 'lifts') body = await liftsHtml();
  else if (seg === 'body') body = await bodyHtml();
  else body = await foodHtml();
  el.innerHTML = head + body;

  el.oninput = (e) => {
    if (e.target.id === 'ex-filter') {
      filter = e.target.value;
      render(el).then(() => { const f = el.querySelector('#ex-filter'); if (f) { f.focus(); f.setSelectionRange(filter.length, filter.length); } });
    }
  };
  el.onchange = (e) => {
    if (e.target.id === 'ex-pick') { exId = e.target.value; render(el); }
    if (e.target.id === 'pa') { photoA = Number(e.target.value); render(el); }
    if (e.target.id === 'pb') { photoB = Number(e.target.value); render(el); }
  };
  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'seg') { seg = b.dataset.s; render(el); }
    if (b.dataset.act === 'range') { range = Number(b.dataset.d); render(el); }
  };
}

/* ---------------- Lifts ---------------- */
async function liftsHtml() {
  const { exercises, slots, weekly, goals, sessionsByEx, sessions } = await liftData();
  const withData = [...weekly.keys()];
  const all = [...exercises.values()].sort((a, b) => a.name.localeCompare(b.name));
  const list = all.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase()));
  if (!exId || !exercises.has(exId)) exId = withData[0] || (all[0] && all[0].id);
  const ex = exercises.get(exId);

  // Group by the day each exercise first appears on.
  const dayOf = new Map();
  for (const s of slots.sort((a, b) => a.order - b.order)) if (!dayOf.has(s.exerciseId)) dayOf.set(s.exerciseId, s.day);
  const groups = {};
  for (const e of list) (groups[dayOf.get(e.id) || 'other'] ||= []).push(e);
  const opts = Object.entries(groups).map(([d, items]) =>
    `<optgroup label="${DAY_NAMES[d] || 'Other'}">${items.map((e) => `<option value="${e.id}" ${e.id === exId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('');

  let charts = '<div class="card"><div class="muted">Pick an exercise with logged sets.</div></div>';
  if (ex) {
    const rows = weekly.get(ex.id) || [];
    const g = goals.get(ex.id) || new Map();
    const weeks = rows.map((r) => r.week);
    const bars = rows.map((r) => {
      const goal = g.get(r.week);
      return { x: dayNum(r.week), y: r.reps, color: goal ? (r.reps >= goal ? COLORS.ok : COLORS.blue) : COLORS.blue };
    });
    const goalPts = [...g.entries()].sort().map(([w, v]) => ({ x: dayNum(w), y: v }));
    const ticks = weekTicks(weeks);
    const assisted = ex.kind === 'assisted';
    const wPts = rows.filter((r) => r.weight > 0 || assisted).map((r) => ({ x: dayNum(r.week), y: r.weight }));
    const ePts = rows.filter((r) => r.e1rm).map((r) => ({ x: dayNum(r.week), y: Math.round(r.e1rm) }));

    const sess = [...(sessionsByEx.get(ex.id) || new Map()).entries()]
      .map(([sid, sets]) => ({ session: sessions.get(sid), sets: sets.sort((a, b) => a.setNumber - b.setNumber) }))
      .sort((a, b) => (b.session.date || '').localeCompare(a.session.date || ''));

    charts = `
      <div class="card"><h3>Weekly reps and goal</h3>
        ${chartSvg({ height: 170, xTicks: ticks, series: [
          { type: 'bars', color: COLORS.blue, points: bars },
          ...(goalPts.length ? [{ type: 'steps', color: COLORS.ok, name: 'Goal', points: goalPts }] : []),
        ], fmt: (v) => v.toFixed(0), empty: 'Log a session to see weekly reps.' })}
        <div class="small muted">Green bars met the goal.</div>
      </div>
      <div class="card"><h3>${assisted ? 'Assist per week (lower is better)' : 'Working weight per week'}</h3>
        ${chartSvg({ height: 150, xTicks: ticks, invert: assisted, series: [{ type: 'line', color: COLORS.light, points: wPts }], fmt: autoFmt, empty: 'No weighted sets yet.' })}
      </div>
      ${ePts.length ? `<div class="card"><h3>Best estimated one rep max per week</h3>
        ${chartSvg({ height: 150, xTicks: ticks, series: [{ type: 'line', color: COLORS.ok, points: ePts }], fmt: autoFmt })}</div>` : ''}
      <div class="card"><h3>Every session</h3>
        ${sess.map((s) => `<div class="row"><div>${fmtDate(s.session.date)}</div><div class="scheme" style="text-align:right">${s.sets.map((x) => (x.weight ? `${fmtW(x.weight)} x ${x.reps}` : x.reps)).join(', ')}</div></div>`).join('') || '<div class="muted small">No sessions yet.</div>'}
      </div>`;
  }

  return `
    <div class="card">
      <input id="ex-filter" placeholder="Search exercises" value="${esc(filter)}" style="width:100%">
      <select id="ex-pick" style="width:100%;margin-top:8px">${opts}</select>
    </div>
    ${charts}
    ${await weeklySummary(exercises, slots)}`;
}

// This week against the goal, plus next week's goal from Friday on.
async function weeklySummary(exercises, slots) {
  const ws = weekStart();
  const targets = await weekTargets(ws);
  const hist = await loadHistory();
  const rule = await getRule();
  const showNext = parseDate(dateStr()).getDay() === 5 || parseDate(dateStr()).getDay() === 6 || parseDate(dateStr()).getDay() === 0;
  const thisReps = new Map();
  const goal = new Map();
  const next = new Map();
  for (const s of slots) {
    const t = targets.get(s.id);
    goal.set(s.exerciseId, (goal.get(s.exerciseId) || 0) + (t && t.totalRepGoal ? t.totalRepGoal : 0));
    const h = (hist.bySlot.get(s.id) || []).filter((x) => x.session.date && weekStart(parseDate(x.session.date)) === ws && !x.session.imported);
    const last = h[h.length - 1];
    for (const x of h) thisReps.set(s.exerciseId, (thisReps.get(s.exerciseId) || 0) + x.sets.reduce((a, y) => a + y.reps, 0));
    let nt = t ? t.totalRepGoal : null;
    if (last) {
      const all = (hist.bySlot.get(s.id) || []).filter((x) => !x.session.imported);
      const idx = all.indexOf(last);
      nt = nextTarget({ slot: s, ex: exercises.get(s.exerciseId), lastSets: last.sets, prevSets: idx > 0 ? all[idx - 1].sets : [], rule }).totalRepGoal;
    }
    next.set(s.exerciseId, (next.get(s.exerciseId) || 0) + (nt || 0));
  }
  const rows = [...exercises.values()].filter((e) => goal.has(e.id)).sort((a, b) => a.name.localeCompare(b.name)).map((e) => {
    const done = thisReps.get(e.id) || 0;
    const g = goal.get(e.id);
    const cls = g ? (done >= g ? 'ok' : '') : '';
    return `<div class="row"><div class="name">${esc(e.name)}</div>
      <div class="scheme ${cls}">${done}${g ? ` / ${g}` : ''}${showNext && next.get(e.id) ? `<span class="muted small"> next ${next.get(e.id)}</span>` : ''}</div></div>`;
  }).join('');
  return `<div class="card"><h3>This week${showNext ? ' and next week preview' : ''}</h3>${rows || '<div class="muted small">Nothing yet.</div>'}</div>`;
}

/* ---------------- Body ---------------- */
async function bodyHtml() {
  const daily = await dailyWeights();
  const waist = await waistEntries();
  const checkIns = (await getAll('checkIns')).sort((a, b) => b.date.localeCompare(a.date));
  const photos = (await getAll('photos')).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  if (photos.length) {
    if (!photos.some((p) => p.id === photoA)) photoA = photos[0].id;
    if (!photos.some((p) => p.id === photoB)) photoB = photos[photos.length - 1].id;
  }
  const popts = (sel) => photos.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${fmtDate(p.date)}</option>`).join('');
  const pa = photos.find((p) => p.id === photoA);
  const pb = photos.find((p) => p.id === photoB);

  return `
    <div class="card"><h3>Weight</h3>
      <div class="segs" style="margin-bottom:8px">
        ${[[30, '1 month'], [90, '3 months'], [0, 'All']].map(([d, l]) => `<button class="seg ${range === d ? 'on' : ''}" data-act="range" data-d="${d}">${l}</button>`).join('')}
      </div>
      ${weightChart(daily, range)}
    </div>
    <div class="card"><h3>Waist</h3>${waistChart(waist)}</div>
    <div class="card"><h3>Photos</h3>
      ${photos.length >= 1 ? `
        <div class="grid2">
          <select id="pa">${popts(photoA)}</select>
          <select id="pb">${popts(photoB)}</select>
          <img class="photo" src="${pa ? photoUrl(pa) : ''}" alt="Earlier photo">
          <img class="photo" src="${pb ? photoUrl(pb) : ''}" alt="Later photo">
        </div>` : '<div class="muted small">Monthly progress photos show up here. Same spot, same lighting.</div>'}
    </div>
    <div class="card"><h3>Check ins</h3>
      ${checkIns.map((c) => `<div class="row"><div><div class="name">${fmtDate(c.date)}${c.applied ? ', applied' : ''}</div><div class="meta">${esc(c.summary)}</div></div></div>`).join('') || '<div class="muted small">A check in appears every 14 days once you have weigh ins.</div>'}
    </div>`;
}

/* ---------------- Food ---------------- */
async function foodHtml() {
  const totals = await foodTotals();
  const targetRows = await getAll('nutritionTargets');
  const days = [];
  for (let i = 29; i >= 0; i--) days.push(addDays(dateStr(), -i));
  const logged = days.filter((d) => totals.has(d));
  const kcalBars = [];
  const proBars = [];
  const kcalGoal = [];
  const proGoal = [];
  for (const d of days) {
    const t = await targetFor(d, targetRows);
    kcalGoal.push({ x: dayNum(d), y: t.kcal });
    proGoal.push({ x: dayNum(d), y: t.protein });
    const tot = totals.get(d);
    if (tot) {
      kcalBars.push({ x: dayNum(d), y: Math.round(tot.kcal), color: tot.kcal > t.kcal * 1.05 ? COLORS.warn : COLORS.blue });
      proBars.push({ x: dayNum(d), y: Math.round(tot.protein), color: tot.protein >= t.protein ? COLORS.ok : COLORS.blue });
    }
  }
  const ticks = days.filter((_, i) => i % 7 === 0).map((d) => ({ x: dayNum(d), label: fmtDate(d) }));
  const last7 = days.slice(-7).filter((d) => totals.has(d));
  const avgK = mean(last7.map((d) => totals.get(d).kcal));
  const avgP = mean(last7.map((d) => totals.get(d).protein));
  const ws = weekStart();
  let hit = 0;
  for (const d of days.filter((x) => x >= ws && totals.has(x))) {
    const t = await targetFor(d, targetRows);
    if (totals.get(d).protein >= t.protein) hit++;
  }
  const mon = (a, b) => (a ? Math.round(a) : 0);
  return `
    <div class="card stats">
      <div><b>${avgK ? Math.round(avgK) : 0}</b><span>kcal, 7 day avg</span></div>
      <div><b>${avgP ? Math.round(avgP) : 0}</b><span>g protein, 7 day avg</span></div>
      <div><b>${hit}</b><span>days protein hit this week</span></div>
    </div>
    <div class="card"><h3>Calories per day</h3>
      ${chartSvg({ height: 170, xTicks: ticks, series: [{ type: 'bars', color: COLORS.blue, points: kcalBars }, { type: 'steps', color: COLORS.ok, name: 'Target', points: kcalGoal }], fmt: (v) => v.toFixed(0), empty: 'Log food to see calories.' })}
    </div>
    <div class="card"><h3>Protein per day</h3>
      ${chartSvg({ height: 170, xTicks: ticks, series: [{ type: 'bars', color: COLORS.blue, points: proBars }, { type: 'steps', color: COLORS.ok, name: 'Target', points: proGoal }], fmt: (v) => v.toFixed(0), empty: 'Log food to see protein.' })}
      <div class="small muted">Green bars hit the protein target.</div>
    </div>`;
}

return { render };
})();

/* ===== js/screens/settings.js ===== */
__m['js/screens/settings.js'] = (function () {
const { getAll, getAllByIndex, put, count, getSetting, setSetting, dateStr, STORE_NAMES } = __m['js/db.js'];
const { getDays, DAY_NAMES } = __m['js/seed.js'];
const { rebaseline } = __m['js/autotargets.js'];
const { GOALS, ACTIVITY, suggestTargets } = __m['js/goals.js'];
const { dailyWeights } = __m['js/stats.js'];
const { friendSetupSheet } = __m['js/screens/setup.js'];
const { steadyWeight } = __m['js/autotargets.js'];
const { esc, fmtW, openSheet } = __m['js/ui.js'];
const { openMiniPicker, miniSlots } = __m['js/skip.js'];
const { openAddExercise, openEditSlot } = __m['js/plan.js'];
const { targetFor } = __m['js/stats.js'];
const { exportAll, countsOf, importAll, resetAll, resetProgress, csvOf, shareOrDownload, exportJsonFile } = __m['js/backup.js'];

function badges(s) {
  const out = [];
  if (s.amrap) out.push('<span class="badge">AMRAP</span>');
  if (s.partialsOnLastSet) out.push('<span class="badge">Half reps on last set</span>');
  if (s.defaultScheme) out.push('<span class="badge warn">Set your scheme</span>');
  return out.join('');
}

function weightLine(s, ex) {
  if (ex.kind === 'bodyweight') return 'Bodyweight';
  const unit = ex.kind === 'assisted' ? 'assist' : 'lb';
  return s.startWeight == null ? 'Weight set on first session' : `Start ${s.startWeight} ${unit}`;
}

const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isNaN(x) ? null : x; };

async function render(el) {
  const exercises = new Map((await getAll('exercises')).map((e) => [e.id, e]));
  const rule = await getSetting('moveUpRule', 'first');
  const rest = await getSetting('restTimerSeconds', 90);
  const waterOn = await getSetting('waterOn', false);
  const lastExport = await getSetting('lastExport', null);
  const target = await targetFor(dateStr());
  const dayList = await getDays();
  const autoProtein = await getSetting('autoProtein', true);
  const autoKcal = await getSetting('autoKcal', false);
  const goal = await getSetting('goal', 'bulk');
  const sw = await steadyWeight();
  const ppl = await getSetting('proteinPerLb', null);

  let planHtml = '';
  const slotsAll = [];
  for (const info of dayList) {
    const day = info.key;
    const slots = (await getAllByIndex('planSlots', 'day', day)).sort((a, b) => a.order - b.order);
    slotsAll.push(...slots);
    const rows = slots.map((s) => {
      const ex = exercises.get(s.exerciseId);
      if (!ex) return '';
      const ladder = ex.weightLadder && ex.weightLadder.length ? `, stack ${ex.weightLadder.join(' / ')}` : '';
      return `
        <button class="row tap" data-act="edit" data-slot="${s.id}">
          <div style="text-align:left">
            <div class="name">${esc(s.label)}</div>
            <div class="meta">${esc(weightLine(s, ex))}, step ${fmtW(ex.increment)} lb${esc(ladder)}</div>
            <div>${badges(s)}</div>
          </div>
          <div class="scheme">${s.sets} x ${s.repMin} to ${s.repMax}</div>
        </button>`;
    }).join('');
    planHtml += `
      <div class="card">
        <h3>${DAY_NAMES[day]}</h3>
        <h2>${esc(info.title)}</h2>
        <div class="muted small" style="margin-bottom:6px">${esc(info.subtitle || '')}</div>
        ${rows}
        <button class="btn secondary" data-act="add" data-day="${day}">Add exercise</button>
        <button class="link" data-act="renameday" data-day="${day}">Rename this day</button>
      </div>`;
  }

  let persisted = 'Unknown';
  if (navigator.storage && navigator.storage.persisted) {
    persisted = (await navigator.storage.persisted()) ? 'Protected' : 'Not protected yet';
  }
  const counts = [];
  for (const name of ['exercises', 'planSlots', 'sessions', 'sets', 'weeklyTargets', 'weights', 'foodEntries']) {
    counts.push(`<div class="row"><div>${name}</div><div class="scheme">${await count(name)}</div></div>`);
  }

  const miniNames = (await miniSlots(dayList[0] ? dayList[0].key : 'mon')).map((m) => m.name);
  const seg = (name, val, label, cur) => `<button class="seg ${val === cur ? 'on' : ''}" data-act="${name}" data-val="${val}">${label}</button>`;

  el.innerHTML = `
    <a class="back" href="#/today">Back</a>
    <div class="header"><h1>Settings</h1></div>

    <div class="card">
      <h3>When to move up</h3>
      <div class="segs">
        ${seg('rule', 'first', 'First set hits the top', rule)}
        ${seg('rule', 'all', 'Every set hits the top', rule)}
      </div>
      <div class="small muted" style="margin-top:8px">
        Targets are suggestions. You can always log something different. First set: if set 1 reaches the top of the rep range, the app offers a heavier weight for your next sets and builds next week's target from it. Every set: only moves up once all sets reach the top.
      </div>
    </div>

    <div class="card">
      <h3>Rest timer</h3>
      <div class="segs">
        ${[[0, 'Off'], [60, '60s'], [90, '90s'], [120, '2 min'], [180, '3 min']].map(([v, l]) => seg('rest', v, l, rest)).join('')}
      </div>
    </div>

    <div class="card">
      <h3>My goal</h3>
      <div class="segs">
        ${Object.entries(GOALS).map(([k, g]) => seg('goal', k, g.label, goal)).join('')}
      </div>
      <div class="small muted" style="margin-top:8px;line-height:1.45">${GOALS[goal].hint}. Your check ins use this goal to decide when to add or cut calories.</div>
      <button class="btn secondary" data-act="recalc">Recalculate my targets for this goal</button>
    </div>

    <div class="card">
      <h3>Nutrition targets</h3>
      <div class="row"><div>Calories</div><div class="scheme">${target.kcal} kcal</div></div>
      <div class="row"><div>Protein</div><div class="scheme">${target.protein} g</div></div>
      <div class="row"><div class="muted">Carbs, soft guide</div><div class="muted">${target.carbs} g</div></div>
      <div class="row"><div class="muted">Fat, soft guide</div><div class="muted">${target.fat} g</div></div>
      <button class="btn secondary" data-act="targets">Change targets</button>
      <label class="check-line" style="margin-top:8px"><input type="checkbox" data-act="water" ${waterOn ? 'checked' : ''}> Show a water counter on the Food tab</label>
    </div>

    <div class="card">
      <h3>Targets follow your weight</h3>
      <label class="check-line"><input type="checkbox" data-act="autoprotein" ${autoProtein ? 'checked' : ''}> Protein follows my body weight</label>
      <label class="check-line"><input type="checkbox" data-act="autokcal" ${autoKcal ? 'checked' : ''}> Calories follow my body weight</label>
      <div class="small muted" style="margin-top:8px;line-height:1.45">
        ${ppl && sw ? `Your ratio is ${ppl.toFixed(2)} g of protein per lb at about ${sw.toFixed(1)} lb. ` : 'Needs 3 weigh ins in a week to start. '}
        Protein moves in steps of 5 g, at most once a week, and you get a notice with an Undo. Calories are off by default because your check in already changes them from your weight and waist trend, and the two would fight each other.
      </div>
    </div>

    <div class="card">
      <h3>Mini workout</h3>
      <div class="small muted">Offered when you skip a training day. ${miniNames.length ? esc(miniNames.join(', ')) + '.' : 'None picked yet.'}</div>
      <button class="btn secondary" data-act="minipick">Change mini workout</button>
    </div>

    <p class="sub" style="margin-top:16px">Your plan. Tap an exercise to edit it, reorder it or remove it. Add anything new at the bottom of each day.</p>
    ${planHtml}

    <div class="card">
      <h3>Backup</h3>
      <div class="small muted">Everything lives on this phone. Last backup: ${lastExport || 'never'}.</div>
      <button class="btn" data-act="export">Export backup file</button>
      <label class="btn secondary" style="text-align:center;line-height:52px">Import backup file
        <input type="file" id="import" accept="application/json,.json" hidden></label>
      <button class="btn secondary" data-act="csv">Export a table as CSV</button>
    </div>

    <div class="card">
      <h3>Data on this phone</h3>
      <div class="row"><div>Storage</div><div class="scheme">${persisted}</div></div>
      ${counts.join('')}
      <button class="btn secondary" data-act="resetprog" style="color:#FBBF24">Reset progress</button>
      <div class="small muted" style="margin-top:6px">Clears the logs you choose. Your plan and presets stay.</div>
      <button class="btn secondary" data-act="reset" style="color:#FBBF24">Reset everything</button>
      <button class="btn secondary" data-act="notme">I'm not Mahi</button>
      <div class="small muted" style="margin-top:6px">Wipes this phone and starts a fresh setup for someone else.</div>
    </div>
  `;

  el.onclick = async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const again = () => render(el);
    if (act === 'goal') { await setSetting('goal', btn.dataset.val); return again(); }
    if (act === 'recalc') return recalcSheet(again);
    if (act === 'rule') { await setSetting('moveUpRule', btn.dataset.val); return again(); }
    if (act === 'rest') { await setSetting('restTimerSeconds', Number(btn.dataset.val)); return again(); }
    if (act === 'edit') {
      const slot = slotsAll.find((s) => s.id === btn.dataset.slot);
      const sibs = slotsAll.filter((x) => x.exerciseId === slot.exerciseId && x.id !== slot.id);
      return openEditSlot(slot, exercises.get(slot.exerciseId), again, sibs);
    }
    if (act === 'add') return openAddExercise(btn.dataset.day, again);
    if (act === 'renameday') return renameDay(dayList, btn.dataset.day, again);
    if (act === 'targets') return editTargets(target, again);
    if (act === 'export') { await exportJsonFile(); return again(); }
    if (act === 'csv') return csvSheet();
    if (act === 'reset') return resetSheet();
    if (act === 'resetprog') return resetProgressSheet();
    if (act === 'notme') return friendSetupSheet();
    if (act === 'minipick') return openMiniPicker(again);
  };
  el.onchange = async (e) => {
    if (e.target.dataset.act === 'water') { await setSetting('waterOn', e.target.checked); return; }
    if (e.target.dataset.act === 'autoprotein') { await setSetting('autoProtein', e.target.checked); await rebaseline(); return render(el); }
    if (e.target.dataset.act === 'autokcal') { await setSetting('autoKcal', e.target.checked); await rebaseline(); return render(el); }
    if (e.target.id === 'import' && e.target.files[0]) importSheet(e.target.files[0]);
  };
}

function editTargets(t, done) {
  const { root, close } = openSheet(`
    <h2>Nutrition targets</h2>
    <div class="muted small">A change is saved as a new dated target, so your history keeps the old one.</div>
    <div class="grid2">
      <label class="field">Calories<input id="t-kcal" inputmode="numeric" value="${t.kcal}"></label>
      <label class="field">Protein g<input id="t-pro" inputmode="numeric" value="${t.protein}"></label>
      <label class="field">Carbs g, soft<input id="t-carb" inputmode="numeric" value="${t.carbs}"></label>
      <label class="field">Fat g, soft<input id="t-fat" inputmode="numeric" value="${t.fat}"></label>
    </div>
    <button class="btn" data-act="save">Save</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'save') return;
    const g = (id) => num(root.querySelector(id).value);
    if (!(g('#t-kcal') > 0) || !(g('#t-pro') > 0)) return;
    await put('nutritionTargets', { effectiveDate: dateStr(), kcal: g('#t-kcal'), protein: g('#t-pro'), carbs: g('#t-carb') || 0, fat: g('#t-fat') || 0, reason: 'Manual change' });
    await rebaseline();
    close();
    done();
  });
}

function csvSheet() {
  const { root, close } = openSheet(`
    <h2>Export a table</h2>
    <div class="muted small">Opens the share sheet so you can save it to Files or send it to a spreadsheet.</div>
    ${STORE_NAMES.filter((n) => n !== 'photos').map((n) => `<button class="btn secondary" data-store="${n}">${n}</button>`).join('')}
    <button class="btn secondary" data-act="cancel">Close</button>`);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'cancel') return close();
    if (b.dataset.store) await shareOrDownload(`${b.dataset.store}-${dateStr()}.csv`, await csvOf(b.dataset.store), 'text/csv');
  });
}

async function importSheet(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { return alert('That file could not be read.'); }
  if (!data || data.app !== 'tracker') return alert('This is not a tracker backup file.');
  const counts = countsOf(data);
  const { root, close } = openSheet(`
    <h2>Replace everything with this backup?</h2>
    <div class="muted small">Backup from ${esc((data.exportedAt || '').slice(0, 10))}. Importing erases what is on this phone now.</div>
    ${Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `<div class="row"><div>${k}</div><div class="scheme">${n}</div></div>`).join('')}
    <button class="btn" data-act="go">Replace and import</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'go') return;
    try { await importAll(data); } catch (err) { return alert(String(err.message || err)); }
    close();
    location.hash = '#/today';
    location.reload();
  });
}

function resetSheet() {
  const { root, close } = openSheet(`
    <h2>Reset everything?</h2>
    <div class="muted small">This erases every workout, weigh in, meal and photo on this phone. Export a backup first. Type RESET to continue.</div>
    <label class="field"><input id="r-word" autocapitalize="characters" placeholder="RESET"></label>
    <button class="btn" data-act="go" style="background:#FBBF24;color:#2b2000">Erase everything</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'go') return;
    if (root.querySelector('#r-word').value.trim() !== 'RESET') return root.querySelector('#r-word').classList.add('shake');
    await resetAll();
    close();
    location.hash = '#/today';
    location.reload();
  });
}

function resetProgressSheet() {
  const { root, close } = openSheet(`
    <h2>Reset progress</h2>
    <div class="muted small">Pick what to clear. Your plan, exercises, presets and settings stay. Your two starting history entries (triceps and machine chest press) stay too. Export a backup first if you might want this data. Clearing workouts also restarts your baseline week.</div>
    <label class="check-line"><input type="checkbox" id="rp-workouts" checked> Workouts and targets</label>
    <label class="check-line"><input type="checkbox" id="rp-weight" checked> Weigh ins and waist</label>
    <label class="check-line"><input type="checkbox" id="rp-food" checked> Food log</label>
    <label class="check-line"><input type="checkbox" id="rp-checkins" checked> Check ins</label>
    <label class="check-line"><input type="checkbox" id="rp-photos" checked> Progress photos</label>
    <label class="field">Type RESET to continue<input id="rp-word" autocapitalize="characters" placeholder="RESET"></label>
    <button class="btn" data-act="go" style="background:#FBBF24;color:#2b2000">Clear selected</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'go') return;
    if (root.querySelector('#rp-word').value.trim() !== 'RESET') return root.querySelector('#rp-word').classList.add('shake');
    const on = (id) => root.querySelector(id).checked;
    await resetProgress({
      workouts: on('#rp-workouts'), weight: on('#rp-weight'), food: on('#rp-food'),
      checkins: on('#rp-checkins'), photos: on('#rp-photos'),
    });
    close();
    location.hash = '#/today';
    location.reload();
  });
}

function renameDay(dayList, key, done) {
  const info = dayList.find((d) => d.key === key);
  const { root, close } = openSheet(`
    <h2>Rename ${DAY_NAMES[key]}</h2>
    <label class="field">Title<input id="d-title" value="${esc(info.title)}"></label>
    <label class="field">Subtitle, optional<input id="d-sub" value="${esc(info.subtitle || '')}"></label>
    <button class="btn" data-act="save">Save</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'save') return;
    const next = dayList.map((d) => (d.key === key
      ? { ...d, title: root.querySelector('#d-title').value.trim() || d.title, subtitle: root.querySelector('#d-sub').value.trim() }
      : d));
    await setSetting('days', next);
    close();
    done();
  });
}

async function recalcSheet(done) {
  const daily = await dailyWeights();
  if (!daily.length) return alert('Log a weigh in first, then I can work out your numbers.');
  const weight = (await steadyWeight()) || daily[daily.length - 1].lb;
  const goal = await getSetting('goal', 'bulk');
  const activity = await getSetting('activity', 'moderate');
  const { root, close } = openSheet(`
    <h2>Targets for ${GOALS[goal].label.toLowerCase()}</h2>
    <div class="muted small" style="line-height:1.45">Based on about ${weight.toFixed(1)} lb. This is an estimate, and your check ins fine tune it.</div>
    <label class="field">Activity
      <select id="r-act">${Object.entries(ACTIVITY).map(([k, a]) => `<option value="${k}" ${k === activity ? 'selected' : ''}>${a.label}</option>`).join('')}</select></label>
    <div id="r-out"></div>
    <button class="btn" data-act="apply">Use these targets</button>
    <button class="btn secondary" data-act="cancel">Cancel</button>`);
  let t;
  const show = () => {
    t = suggestTargets(goal, weight, root.querySelector('#r-act').value);
    root.querySelector('#r-out').innerHTML = `
      <div class="row"><div class="muted">Maintenance estimate</div><div class="scheme">${t.maintenance} kcal</div></div>
      <div class="row"><div>Calories</div><div class="scheme">${t.kcal} kcal</div></div>
      <div class="row"><div>Protein</div><div class="scheme">${t.protein} g</div></div>`;
  };
  show();
  root.querySelector('#r-act').addEventListener('change', show);
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') return close();
    if (act !== 'apply') return;
    await setSetting('activity', root.querySelector('#r-act').value);
    await put('nutritionTargets', { effectiveDate: dateStr(), kcal: t.kcal, protein: t.protein, fat: t.fat, carbs: t.carbs, reason: `Goal: ${GOALS[goal].label}` });
    await rebaseline();
    close();
    done();
  });
}

return { render };
})();

/* ===== js/app.js ===== */
__m['js/app.js'] = (function () {
// Router, tab bar and boot.
const { openDB, getSetting } = __m['js/db.js'];
const { seedIfEmpty, migratePlan } = __m['js/seed.js'];
const { ensureWeekTargets } = __m['js/targets.js'];
const today = __m['js/screens/today.js'];
const workout = __m['js/screens/workout.js'];
const food = __m['js/screens/food.js'];
const weight = __m['js/screens/weight.js'];
const progress = __m['js/screens/progress.js'];
const settings = __m['js/screens/settings.js'];
const setup = __m['js/screens/setup.js'];

const ROUTES = { today, workout, food, weight, progress, settings, setup };
const app = document.getElementById('app');

async function route() {
  let [name, arg] = (location.hash.replace('#/', '') || 'today').split('?')[0].split('/');
  if (await getSetting('needsSetup', false)) name = 'setup';
  document.body.classList.toggle('setup', name === 'setup');
  const screen = ROUTES[name] || today;
  const tab = ROUTES[name] ? name : 'today';

  document.querySelectorAll('#tabbar a').forEach((a) => {
    a.classList.toggle('active', a.dataset.tab === (tab === 'settings' ? 'today' : tab));
  });

  app.classList.toggle('has-bar', name === 'workout' && !!arg);
  app.onclick = null;
  app.onchange = null;
  app.oninput = null;
  app.ontouchstart = app.ontouchend = app.ontouchmove = app.oncontextmenu = null;
  try {
    await screen.render(app, arg);
  } catch (err) {
    app.innerHTML = `<div class="card"><h2>Something went wrong</h2><div class="muted small">${String(err)}</div></div>`;
    console.error(err);
  }
  window.scrollTo(0, 0);
}

async function boot() {
  try {
    await openDB();
    await seedIfEmpty();
    await migratePlan();
    await ensureWeekTargets();
    // Ask the browser not to evict our data.
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (err) {
    app.innerHTML = `<div class="card"><h2>Storage problem</h2><div class="muted small">${String(err)}</div></div>`;
    console.error(err);
    return;
  }

  // ?action=weight opens the weigh in screen with the input focused.
  if (new URLSearchParams(location.search).get('action') === 'weight' && !location.hash) location.hash = '#/weight';

  window.addEventListener('hashchange', route);
  await route();

  if ('serviceWorker' in navigator) {
    try {
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register('sw.js');
      const offer = (worker) => showUpdateBanner(worker);
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', () => {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
        });
      });
      // Check for a new version each time the app comes back to the front.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
      let reloading = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading || !hadController) return; // first install needs no reload
        reloading = true;
        location.reload();
      });
    } catch (e) { console.warn('SW failed', e); }
  }
}

function showUpdateBanner(worker) {
  if (document.getElementById('updatebar')) return;
  const bar = document.createElement('div');
  bar.id = 'updatebar';
  bar.innerHTML = '<span>Update available</span><button>Tap to reload</button>';
  bar.querySelector('button').onclick = () => worker.postMessage('SKIP_WAITING');
  document.body.appendChild(bar);
}

boot();

return {  };
})();

})();
