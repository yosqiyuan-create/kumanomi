// タコクラゲ (Mastigias papua)
export default {
  id: 'takokurage',
  name: 'タコクラゲ',
  note: '白い水玉の傘と太い8本の腕。力強く泳ぐ',
  count: 7,
  size: [0.36, 0.5],
  bell: { height: 0.62, flare: 0.98, color: '#a07a44', opacity: 0.78, rim: 0.35, pattern: 'spots', patternColor: '#f4efe0' },
  pulse: { period: [0.95, 1.25], contract: 0.16, thrust: 0.55 },
  sink: 0.07,
  tentacles: null,
  arms: { count: 8, segments: 11, length: 0.85, radius: [0.085, 0.04], color: '#f0ead6', opacity: 0.95, club: { color: '#c9d8f0', size: 0.09 } },
  lights: ['white', 'blue', 'purple', 'rainbow'],
};
