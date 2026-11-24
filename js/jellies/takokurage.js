// タコクラゲ (Mastigias papua)
export default {
  id: 'takokurage',
  name: 'タコクラゲ',
  note: '白い水玉の傘と、もこもこの口腕。先の白い長い付属物をなびかせて力強く泳ぐ',
  count: 7,
  size: [0.36, 0.5],
  bell: { height: 0.78, flare: 1.0, color: '#cfe0ec', opacity: 0.16, rim: 0.4, pattern: 'photoStrip', texture: 'jelly-mastigias.jpg', patternColor: '#f6f7f0', brownChance: 0.25 },
  pulse: { period: [0.95, 1.25], contract: 0.15, thrust: 0.5 },
  sink: 0.07,
  tentacles: null,
  arms: {
    count: 8, segments: 6, length: 0.6, style: 'mastigias', lump: 0.2, lumpsPerSeg: 16,
    apps: { segments: 10, length: 1.25, width: 0.07, color: '#d6cb88', tip: '#e9f1ff', opacity: 0.6 },
  },
  lights: ['white', 'blue', 'purple', 'rainbow'],
};
