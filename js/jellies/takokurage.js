// タコクラゲ — from the user's sample video and photos:
// blue dome covered in small white dots; under it a stout pillar that splits into solid, spongy,
// frilled oral-arm blocks (the key feature); thick finger-like appendages stream from their ends.
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
    count: 8, segments: 6, length: 1.0, style: 'mastigias', rootR: 0.1, splay: 0.1, stiff: 1.0, lumpDetail: 1, clusterBias: 0.9,
    block: { color: '#fff4dc', emissive: '#7a6e52', soft: 1.0 },   // solid spongy frilled oral arms (the key feature)
    lump: 0.24, lumpsPerSeg: 6, lumpSize: 0.03, clusters: 10, clusterSpread: 0.5,
    lumpColors: ['#f7f0de', '#e6d8b8'], lumpOdds: [0.6, 0.4], emissive: '#6a604a',
    // long appendages: thick, bumpy finger-like straps that stream and ripple behind (from the user's photos)
    apps: { segments: 10, length: 1.5, width: 0.12, taper: 0.35, round: 0.45, bumpy: true, color: '#e9e0c8', tip: '#f4efe0', opacity: 0.85,
      cols: 7, stiff: 0.15, wave: { amp: 0.26, len: 2.4, speed: 1.4 } },
  },
  lights: ['blue', 'white', 'purple', 'rainbow'],
};
