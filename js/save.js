// Save games in localStorage. Slot "auto" holds the autosave.
import { G } from './state.js';

// Storage keys keep the game's first name (Isla Genesis) so existing saves still load.
const PREFIX = 'isla-genesis:save:';
export const SLOTS = ['auto', '1', '2', '3', '4', '5', '6'];

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { localStorage.setItem(k, v); }

export function listSaves() {
  const out = [];
  for (const slot of SLOTS) {
    const raw = safeGet(PREFIX + slot + ':meta');
    if (!raw) { out.push({ slot, empty: true }); continue; }
    try { out.push({ slot, ...JSON.parse(raw) }); } catch (e) { out.push({ slot, empty: true }); }
  }
  return out;
}

export function latestSave() {
  const s = listSaves().filter((x) => !x.empty).sort((a, b) => b.savedAt - a.savedAt);
  return s[0] || null;
}

export function saveGame(slot, name) {
  const g = G.game;
  if (!g || g.mode === 'demo') return false;
  const data = g.serialize(name);
  try {
    safeSet(PREFIX + slot, JSON.stringify(data));
    safeSet(PREFIX + slot + ':meta', JSON.stringify({ name: data.name, savedAt: data.savedAt, mode: data.mode, missionId: data.missionId, meta: data.meta }));
    return true;
  } catch (e) {
    g.notify('Could not save – browser storage is full or unavailable.', 'danger');
    return false;
  }
}

export function loadSave(slot) {
  const raw = safeGet(PREFIX + slot);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

export function deleteSave(slot) {
  try { localStorage.removeItem(PREFIX + slot); localStorage.removeItem(PREFIX + slot + ':meta'); } catch (e) { /* ignore */ }
}

export function autosave() {
  if (saveGame('auto', (G.game?.park.name || 'Park') + ' (autosave)')) G.ui?.flashSaved();
}

// Inside a claude.ai artifact the viewer's `downloads` capability saves the file
// (with a confirmation prompt); when running standalone a normal link download is used.
let downloads = null;
export const framed = window.self !== window.top;
if (framed && window.claude?.use) window.claude.use('downloads').then((d) => { downloads = d; }).catch(() => {});
export const canExport = () => !framed || !!downloads;

export async function exportSave() {
  const g = G.game;
  if (!g) return;
  const data = JSON.stringify(g.serialize());
  const filename = `${(g.park.name || 'park').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-day${g.park.day}.dinopark.json`;
  if (framed) {
    if (!downloads) return;
    try { await downloads.save({ filename, data }); g.notify('Save file exported.', 'good'); }
    catch (e) { if (e?.code !== 'declined') g.notify('Export is not available here.', 'warn'); }
    return;
  }
  const blob = new Blob([data], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.setAttribute('download', filename);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importSaveFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { try { const d = JSON.parse(r.result); if (!d.map || !d.park) throw new Error('bad'); resolve(d); } catch (e) { reject(e); } };
    r.onerror = reject;
    r.readAsText(file);
  });
}

G.save = { autosave, saveGame, loadSave, listSaves };
