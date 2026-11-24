// ミズクラゲ (Aurelia aurita) — add a new species by copying this file and listing it in index.js
export default {
  id: 'mizukurage',
  name: 'ミズクラゲ',
  note: '4つの輪の模様が目印。ゆっくり拍動して漂う',
  count: 14,
  size: [0.42, 0.62],          // bell radius range
  bell: { height: 0.5, flare: 1.04, color: '#d6ecff', opacity: 0.26, rim: 0.85, pattern: 'photo', texture: 'jelly-aurelia.jpg', patternColor: '#ffe2b8', lobes: 8, inner: 0.9 },
  pulse: { period: [1.5, 2.0], contract: 0.27, thrust: 0.34 },
  sink: 0.045,
  tilt: 0.75,
  tentacles: { count: 150, segments: 7, length: 0.42, color: '#f4f8ff', opacity: 0.36 },
  arms: { count: 4, segments: 12, length: 0.95, radius: [0.26, 0.09], color: '#eef3ff', frill: '#fff0cf', opacity: 0.58, club: false, style: 'ribbon' },
  lights: ['blue', 'purple', 'rainbow', 'white'],
};
