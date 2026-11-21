// Saved aquarium state + real-time simulation (runs while the app is closed too)

const KEY = 'ore-no-suizokukan.v1';
const HOUR = 3600;
export const MAX_FISH = 2; // a pair

// Rates per second (real time)
export const RATES = {
  hungerDecay: 1 / (48 * HOUR),      // full -> empty in 2 days
  dirtBase: 1 / (10 * 24 * HOUR),    // clean -> very dirty in 10 days
  dirtPerFish: 1 / (40 * 24 * HOUR), // each extra fish dirties the water a little
  dirtPerRottenPellet: 0.01,         // uneaten food makes the water dirty
  healthLossHungry: 1 / (3 * 24 * HOUR),
  healthLossDirty: 1 / (5 * 24 * HOUR),
  healthGain: 1 / (2 * 24 * HOUR),
  growth: 1 / (365 * 24 * HOUR),    // young fish -> adult in about a year with good care
};

export const ADULT = 0.6;

export function defaultState(now = Date.now()) {
  return {
    version: 2,
    startedAt: now,
    lastSeen: now,
    nextId: 2,
    fishes: [newFishData(1, 'クマノミ', now)],
    tank: { dirt: 0.05 },
    graves: [],
  };
}

// A young clownfish (幼魚) as it would come from a shop.
// Clownfish are all born male-to-be; the biggest of a pair turns female.
export function newFishData(id, name = 'クマノミ', now = Date.now()) {
  return { id, name, hunger: 0.6, health: 1.0, born: now, growth: 0.08, alive: true, sex: 'young' };
}

export function addFish(s, name = 'クマノミ', now = Date.now()) {
  const f = newFishData(s.nextId++, name, now);
  s.fishes.push(f);
  return f;
}

// Move a dead fish to the graves
export function farewell(s, fish) {
  s.graves.push({ name: fish.name, days: dayCount(fish), diedAt: fish.diedAt || Date.now(), cause: fish.cause || '' });
  s.fishes = s.fishes.filter((f) => f !== fish);
}

export const aliveFishes = (s) => s.fishes.filter((f) => f.alive);

export function stageName(g) {
  if (g < 0.15) return '幼魚';
  if (g < 0.6) return '若魚';
  return '成魚';
}

export function sexName(f) {
  if (f.sex === 'female') return 'メス';
  if (f.sex === 'male') return 'オス';
  return '';
}

// Sex change rule (like real clownfish):
//  - a fish that grows up becomes male
//  - when two adults live together and there is no female, the bigger one turns female (for good)
export function updateSexes(s) {
  const alive = aliveFishes(s);
  for (const f of alive) if (f.growth >= ADULT && f.sex === 'young') f.sex = 'male';
  const adults = alive.filter((f) => f.growth >= ADULT);
  if (adults.length >= 2 && !adults.some((f) => f.sex === 'female')) {
    adults.sort((a, b) => b.growth - a.growth);
    adults[0].sex = 'female';
    return adults[0]; // just changed
  }
  return null;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 1 && s.fish && s.tank) {
        // upgrade data saved by older versions (one fish -> list of fish)
        const f = s.fish;
        if (f.growth === undefined) f.growth = 0.08;
        if (f.alive === undefined) f.alive = true;
        if (!f.born) f.born = s.startedAt;
        f.id = 1;
        f.sex = f.growth >= ADULT ? 'male' : 'young';
        s.fishes = [f];
        delete s.fish;
        s.nextId = 2;
        s.version = 2;
      }
      if (s && s.version === 2 && s.fishes && s.tank) {
        if (!s.graves) s.graves = [];
        if (!s.fishes.length) s.fishes.push(newFishData(s.nextId++, 'クマノミ'));
        return s;
      }
    }
  } catch {}
  return defaultState();
}

export function saveState(s) {
  s.lastSeen = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Advance the state by `sec` seconds of real time
export function simulate(s, sec, now = Date.now()) {
  const t = s.tank;
  const n = aliveFishes(s).length;
  t.dirt = clamp01(t.dirt + (RATES.dirtBase + RATES.dirtPerFish * Math.max(0, n - 1)) * sec);
  for (const f of s.fishes) {
    if (!f.alive) continue;
    f.hunger = clamp01(f.hunger - RATES.hungerDecay * sec);
    let dh = 0;
    if (f.hunger < 0.15) dh -= RATES.healthLossHungry;
    if (t.dirt > 0.7) dh -= RATES.healthLossDirty * (1 + (t.dirt - 0.7) * 3);
    if (dh === 0 && f.hunger > 0.35 && t.dirt < 0.5) dh = RATES.healthGain;
    f.health = Math.min(1, f.health + dh * sec);
    // growth: good care = full speed, poor care = slow
    const care = (f.hunger > 0.3 && t.dirt < 0.6) ? 1 : 0.3;
    f.growth = Math.min(1, f.growth + RATES.growth * care * (0.5 + 0.5 * f.health) * sec);
    if (f.health <= 0) {
      f.health = 0;
      f.alive = false;
      f.diedAt = now;
      f.cause = f.hunger < 0.15 && t.dirt > 0.7 ? 'both' : (f.hunger < 0.15 ? 'hunger' : 'water');
    }
  }
  updateSexes(s);
}

// Catch up on the time the app was closed (in 1-hour slices, at most 60 days)
export function catchUp(s, now = Date.now()) {
  let sec = Math.max(0, (now - (s.lastSeen || now)) / 1000);
  sec = Math.min(sec, 60 * 24 * HOUR);
  const away = sec;
  let at = now - sec * 1000;
  while (sec > 0) {
    const step = Math.min(HOUR, sec);
    at += step * 1000;
    simulate(s, step, at);
    sec -= step;
  }
  s.lastSeen = now;
  return away;
}

export function dayCount(f, now = Date.now()) {
  const end = f.alive ? now : (f.diedAt || now);
  return Math.floor((end - f.born) / (24 * HOUR * 1000)) + 1;
}

// Short messages about what needs care for one fish + the tank (empty = all good)
export function careMessages(s, f) {
  const m = [];
  if (f && f.alive) {
    if (f.health < 0.12) m.push('とても弱っています！すぐにお世話を');
    if (f.hunger < 0.15) m.push('おなかがペコペコです');
    else if (f.hunger < 0.35) m.push('おなかがすいてきました');
  }
  if (s.tank.dirt > 0.7) m.push('水がかなり汚れています。水換えしてください');
  else if (s.tank.dirt > 0.45) m.push('水が汚れてきました');
  if (f && f.alive && f.health < 0.3 && f.health >= 0.12) m.push('元気がありません');
  return m;
}

// The most urgent message across all fish (for the "welcome back" toast)
export function worstMessage(s) {
  for (const f of aliveFishes(s)) {
    const m = careMessages(s, f);
    if (m.length) return (s.fishes.length > 1 ? f.name + '：' : '') + m[0];
  }
  const m = careMessages(s, null);
  return m[0] || '';
}

export function formatAway(sec) {
  if (sec < 60) return '';
  if (sec < HOUR) return `${Math.round(sec / 60)}分ぶり`;
  if (sec < 24 * HOUR) return `${Math.round(sec / HOUR)}時間ぶり`;
  return `${Math.round(sec / (24 * HOUR))}日ぶり`;
}
