// ミズクラゲ (Aurelia aurita) — add a new species by copying this file and listing it in index.js
export default {
  id: 'mizukurage',
  name: 'ミズクラゲ',
  note: '4つの輪の模様が目印。ゆっくり拍動して漂う',
  count: 10,
  size: [0.42, 0.62],          // bell radius range
  bell: { height: 0.36, flare: 1.04, color: '#cfe8ff', opacity: 0.22, rim: 0.9, pattern: 'rings', patternColor: '#e8b8f0' },
  pulse: { period: [1.7, 2.3], contract: 0.2, thrust: 0.32 },
  sink: 0.045,
  tentacles: { count: 72, segments: 6, length: 0.22, color: '#eaf6ff', opacity: 0.45 },
  arms: { count: 4, segments: 9, length: 0.55, radius: [0.05, 0.018], color: '#f0dcff', opacity: 0.55, club: false },
  lights: ['blue', 'purple', 'rainbow', 'white'],
};
