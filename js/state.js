// Saved aquarium state + real-time simulation (runs while the app is closed too)

const KEY = 'ore-no-suizokukan.v1';
const HOUR = 3600;

// Rates per second (real time)
export const RATES = {
  hungerDecay: 1 / (48 * HOUR),      // full -> empty in 2 days
  dirtBase: 1 / (10 * 24 * HOUR),    // clean -> very dirty in 10 days
  dirtPerRottenPellet: 0.01,         // uneaten food makes the water dirty
  healthLossHungry: 1 / (3 * 24 * HOUR),
  healthLossDirty: 1 / (5 * 24 * HOUR),
  healthGain: 1 / (2 * 24 * HOUR),
};

export function defaultState(now = Date.now()) {
  return {
    version: 1,
    startedAt: now,
    lastSeen: now,
    fish: { name: 'クマノミ', hunger: 0.6, health: 1.0, born: now },
    tank: { dirt: 0.05 },
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.version === 1 && s.fish && s.tank) return s;
    }
  } catch {}
  return defaultState();
}

export function saveState(s) {
  s.lastSeen = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function resetState() {
  try { localStorage.removeItem(KEY); } catch {}
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Advance the state by `sec` seconds of real time
export function simulate(s, sec) {
  const f = s.fish, t = s.tank;
  f.hunger = clamp01(f.hunger - RATES.hungerDecay * sec);
  t.dirt = clamp01(t.dirt + RATES.dirtBase * sec);
  let dh = 0;
  if (f.hunger < 0.15) dh -= RATES.healthLossHungry;
  if (t.dirt > 0.7) dh -= RATES.healthLossDirty * (1 + (t.dirt - 0.7) * 3);
  if (dh === 0 && f.hunger > 0.35 && t.dirt < 0.5) dh = RATES.healthGain;
  // death is handled in a later step: keep the fish just alive for now
  f.health = Math.max(0.05, Math.min(1, f.health + dh * sec));
}

// Catch up on the time the app was closed (in 1-hour slices, at most 60 days)
export function catchUp(s, now = Date.now()) {
  let sec = Math.max(0, (now - (s.lastSeen || now)) / 1000);
  sec = Math.min(sec, 60 * 24 * HOUR);
  const away = sec;
  while (sec > 0) {
    const step = Math.min(HOUR, sec);
    simulate(s, step);
    sec -= step;
  }
  s.lastSeen = now;
  return away;
}

export function dayCount(s, now = Date.now()) {
  return Math.floor((now - s.startedAt) / (24 * HOUR * 1000)) + 1;
}

// Short messages about what needs care (empty array = all good)
export function careMessages(s) {
  const m = [];
  if (s.fish.hunger < 0.15) m.push('おなかがペコペコです');
  else if (s.fish.hunger < 0.35) m.push('おなかがすいてきました');
  if (s.tank.dirt > 0.7) m.push('水がかなり汚れています。水換えしてください');
  else if (s.tank.dirt > 0.45) m.push('水が汚れてきました');
  if (s.fish.health < 0.3) m.push('元気がありません');
  return m;
}

export function formatAway(sec) {
  if (sec < 60) return '';
  if (sec < HOUR) return `${Math.round(sec / 60)}分ぶり`;
  if (sec < 24 * HOUR) return `${Math.round(sec / HOUR)}時間ぶり`;
  return `${Math.round(sec / (24 * HOUR))}日ぶり`;
}
