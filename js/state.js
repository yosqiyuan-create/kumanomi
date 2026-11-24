// Saved aquarium state + real-time simulation (runs while the app is closed too)

const KEY = 'ore-no-suizokukan.v1';
const HOUR = 3600;
export const MAX_FISH = 6;  // main tank capacity
export const PAIR = 2;      // '仲間を迎える' is offered until there is a pair
const DAY = 24 * HOUR;

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
  spawnInterval: 14 * 24 * HOUR,     // a healthy pair spawns about every 2 weeks
  incubation: 8 * 24 * HOUR,         // eggs hatch after about 8 days
  larval: 10 * 24 * HOUR,            // larvae settle after about 10 days
  fryReady: 30 * 24 * HOUR,          // young fish can move to the main tank after about a month
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
    breed: newBreed(),
    events: [],
  };
}

const newBreed = () => ({ ready: 0, clutch: null, nursery: null, released: 0 });

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
        if (!s.breed) s.breed = newBreed();
        if (!s.events) s.events = [];
        if (!s.fishes.length) s.fishes.push(newFishData(s.nextId++, 'クマノミ'));
        return s;
      }
    }
  } catch {}
  return defaultState();
}

let frozen = false;   // set while restoring a backup, so nothing overwrites it
export function freezeSaves() { frozen = true; }

export function saveState(s) {
  if (frozen) return;
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
  simBreed(s, sec, now);
}

// ---------- breeding ----------
const days = (sec) => sec / DAY;

function simBreed(s, sec, now) {
  const b = s.breed, t = s.tank;
  const alive = aliveFishes(s);
  const fem = alive.find((f) => f.sex === 'female');
  const mal = alive.find((f) => f.sex === 'male');

  // a healthy, well-fed pair in clean water gets ready to spawn
  const good = fem && mal && fem.health > 0.5 && mal.health > 0.5 && fem.hunger > 0.3 && mal.hunger > 0.3 && t.dirt < 0.6;
  if (!b.clutch && good) {
    b.ready += sec / RATES.spawnInterval;
    if (b.ready >= 1) {
      b.ready = 0;
      const n = Math.round(300 + Math.random() * 400);
      b.clutch = { laidAt: now, eggs: n, laid: n, hatchAt: now + RATES.incubation * 1000, mother: fem.name, father: mal.name };
      s.events.push({ type: 'spawn', n, father: mal.name });
    }
  }

  // eggs: the father guards them; dirty water or no father means losses
  if (b.clutch) {
    const c = b.clutch;
    let loss = 0.01;                                  // per day
    if (t.dirt > 0.6) loss += 0.12;
    if (!mal || mal.health < 0.4) loss += 0.35;
    c.eggs *= Math.exp(-loss * days(sec));
    if (c.eggs < 1) {
      b.clutch = null;
      s.events.push({ type: 'eggs-lost' });
    } else if (now >= c.hatchAt) {
      const n = Math.max(1, Math.floor(c.eggs * 0.8));
      if (b.nursery) b.nursery.count += n;
      else b.nursery = { hatchedAt: now, count: n, hunger: 0.7, settled: false, ready: false, mother: c.mother, father: c.father };
      b.clutch = null;
      s.events.push({ type: 'hatch', n });
    }
  }

  // nursery tank: larvae need their own tiny food (rotifers) every day
  if (b.nursery) {
    const ny = b.nursery;
    const age = (now - ny.hatchedAt) / 1000;
    ny.hunger = clamp01(ny.hunger - sec / DAY);
    let loss = age < RATES.larval ? 0.06 : 0.01;    // natural losses per day
    if (ny.hunger < 0.15) loss += 0.5;
    if (t.dirt > 0.7) loss += 0.1;
    ny.count *= Math.exp(-loss * days(sec));
    if (!ny.settled && age >= RATES.larval) { ny.settled = true; s.events.push({ type: 'settled', n: Math.floor(ny.count) }); }
    if (!ny.ready && age >= RATES.fryReady) { ny.ready = true; s.events.push({ type: 'fry-ready', n: Math.floor(ny.count) }); }
    if (ny.count < 1) { b.nursery = null; s.events.push({ type: 'fry-lost' }); }
  }
}

export function feedNursery(s) {
  if (!s.breed.nursery) return false;
  s.breed.nursery.hunger = Math.min(1, s.breed.nursery.hunger + 0.6);
  return true;
}

// move one grown-up fry into the main tank
export function moveFryToTank(s, name, now = Date.now()) {
  const ny = s.breed.nursery;
  if (!ny || !ny.ready || ny.count < 1 || aliveFishes(s).length >= MAX_FISH) return null;
  const f = newFishData(s.nextId++, name, now);
  f.born = ny.hatchedAt;
  f.growth = 0.1;
  f.mother = ny.mother; f.father = ny.father;
  s.fishes.push(f);
  ny.count -= 1;
  if (ny.count < 1) s.breed.nursery = null;
  return f;
}

// give all remaining fry to new homes (お別れ)
export function releaseFry(s) {
  const ny = s.breed.nursery;
  if (!ny) return 0;
  const n = Math.floor(ny.count);
  s.breed.released += n;
  s.breed.nursery = null;
  return n;
}

export function nurseryInfo(s, now = Date.now()) {
  const b = s.breed;
  const out = {};
  if (b.clutch) {
    const c = b.clutch;
    out.eggs = Math.round(c.eggs);
    out.eggDay = Math.floor((now - c.laidAt) / 1000 / DAY) + 1;
    out.hatchIn = Math.max(0, Math.ceil((c.hatchAt - now) / 1000 / DAY));
    out.eggProgress = Math.min(1, (now - c.laidAt) / (c.hatchAt - c.laidAt));
  }
  if (b.nursery) {
    const ny = b.nursery;
    const age = (now - ny.hatchedAt) / 1000;
    out.fry = Math.floor(ny.count);
    out.fryDay = Math.floor(age / DAY) + 1;
    out.fryStage = age < RATES.larval ? '仔魚（透明で漂う時期）' : (ny.ready ? '幼魚（水槽に移せます）' : '稚魚（色と帯が出てきた）');
    out.fryHunger = ny.hunger;
    out.readyIn = Math.max(0, Math.ceil((RATES.fryReady - age) / DAY));
    out.ready = ny.ready;
  }
  return out;
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

// ---------- backup / restore ----------
const CODE_HEAD = 'ORESUI1:';

export function exportCode(s) {
  const json = JSON.stringify({ ...s, lastSeen: Date.now() });
  return CODE_HEAD + btoa(unescape(encodeURIComponent(json)));
}

// accepts a backup code or plain JSON; returns the state or null
export function parseBackup(text) {
  try {
    text = (text || '').trim();
    let json = text;
    const i = text.indexOf(CODE_HEAD);
    if (i >= 0) json = decodeURIComponent(escape(atob(text.slice(i + CODE_HEAD.length).replace(/\s+/g, ''))));
    const s = JSON.parse(json);
    if (!s || !s.tank || !(Array.isArray(s.fishes) || s.fish)) return null;
    return s;
  } catch { return null; }
}

// write a backup into storage; time while it was away does not count against the fish
export function restoreBackup(s) {
  s.lastSeen = Date.now();
  frozen = true;
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { return false; }
}

export function backupSummary(s) {
  const list = s.fishes || (s.fish ? [s.fish] : []);
  const names = list.filter((f) => f.alive !== false).map((f) => f.name).join('・') || '（いません）';
  return `クマノミ：${names}`;
}
