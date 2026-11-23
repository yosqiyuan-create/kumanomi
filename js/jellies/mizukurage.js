// ミズクラゲ (Aurelia aurita) — add a new species by copying this file and listing it in index.js
export default {
  id: 'mizukurage',
  name: 'ミズクラゲ',
  note: '4つの輪の模様が目印。ゆっくり拍動して漂う',
  count: 10,
  size: [0.42, 0.62],          // bell radius range
  bell: { height: 0.34, flare: 1.05, color: '#d6ecff', opacity: 0.16, rim: 0.75, pattern: 'rings', patternColor: '#f59ad6', lobes: 8, inner: 0.7 },
  pulse: { period: [1.7, 2.3], contract: 0.2, thrust: 0.32 },
  sink: 0.045,
  tentacles: { count: 150, segments: 6, length: 0.2, color: '#f4f8ff', opacity: 0.32 },
  arms: { count: 4, segments: 12, length: 1.1, radius: [0.15, 0.04], color: '#f1e6fb', opacity: 0.6, club: false, style: 'ribbon' },
  lights: ['blue', 'purple', 'rainbow', 'white'],
};
