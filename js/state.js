// Shared global state. Modules read and write fields at runtime.
export const G = {
  game: null,     // current Game instance
  engine: null,   // render engine
  ui: null,       // UI controller
  audio: null,    // audio engine
  tools: null,    // input/tool controller
  settings: {
    shadows: true,
    reflections: true,
    dayNight: false,
    volume: 0.6,
    music: 0.35,
    edgeScroll: false,
    autosave: true,
    quality: 'high',
  },
};

const SETTINGS_KEY = 'isla-genesis:settings';
export function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    Object.assign(G.settings, s);
  } catch (e) { /* storage unavailable */ }
}
export function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) { /* ignore */ }
}
