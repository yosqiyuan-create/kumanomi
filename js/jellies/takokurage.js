// タコクラゲ — remade from the user's sample video:
// glowing blue dome covered in small white dots, a big white cauliflower-like mass of oral arms,
// and thin clear-blue strings with white club tips trailing behind.
export default {
  id: 'takokurage',
  name: 'タコクラゲ',
  note: '白い水玉の青い傘と、白いもこもこの口腕。先の白い細い付属物をなびかせて泳ぐ',
  count: 9,
  size: [0.4, 0.56],
  bell: { height: 0.95, flare: 1.0, color: '#3a6ddc', opacity: 0.5, rim: 0.9, pattern: 'whiteSpot', patternColor: '#f4f8ff' },
  pulse: { period: [1.0, 1.35], contract: 0.14, thrust: 0.48 },
  sink: 0.07,
  tentacles: null,
  arms: {
    count: 8, segments: 6, length: 1.3, style: 'mastigias', rootR: 0.22, splay: 0.6, lumpDetail: 1, clusterBias: 0.9,
    lump: 0.24, lumpsPerSeg: 34, lumpSize: 0.04, clusters: 16, clusterSpread: 0.6,
    lumpColors: ['#f7f4ec', '#e6d8b8', '#bcd0f0', '#8ea6d4'], lumpOdds: [0.5, 0.25, 0.15, 0.1], emissive: '#46527a',
    apps: { segments: 10, length: 1.7, width: 0.03, color: '#86aef0', tip: '#cfe0ff', opacity: 0.32, bulb: '#f4f6ff', bulbSize: 0.075 },
  },
  lights: ['blue', 'white', 'purple', 'rainbow'],
};
