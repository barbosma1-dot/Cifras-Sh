// Tema claro / escuro / automático / noturno (por horário). Sem dependências.
export type ThemeMode = 'claro' | 'escuro' | 'auto' | 'noturno';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'sh-theme';
/** Horário do modo noturno (24h). Padrão: das 18h às 6h. */
export const NIGHT_START = 18;
export const NIGHT_END = 6;

export function getStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'claro' || v === 'escuro' || v === 'auto' || v === 'noturno') return v;
  } catch {}
  return 'auto';
}

export function resolveTheme(mode: ThemeMode, now: Date = new Date()): ResolvedTheme {
  if (mode === 'claro') return 'light';
  if (mode === 'escuro') return 'dark';
  if (mode === 'noturno') {
    const h = now.getHours();
    return h >= NIGHT_START || h < NIGHT_END ? 'dark' : 'light';
  }
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let lightThemeColor: string | null = null;
export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    if (lightThemeColor === null) lightThemeColor = meta.getAttribute('content') || '#ffffff';
    meta.setAttribute('content', resolved === 'dark' ? '#0b0b0d' : lightThemeColor);
  }
  return resolved;
}

const listeners = new Set<() => void>();
let started = false;

/** Chame uma vez em main.tsx, antes de renderizar. */
export function initTheme() {
  applyTheme(getStoredMode());
  if (started) return;
  started = true;
  const refresh = () => { applyTheme(getStoredMode()); listeners.forEach((l) => l()); };
  if (typeof matchMedia !== 'undefined') matchMedia('(prefers-color-scheme: dark)').addEventListener('change', refresh);
  setInterval(refresh, 60_000); // reavalia o modo noturno a cada minuto
  window.addEventListener('storage', refresh);
}

export function setThemeMode(mode: ThemeMode) {
  try { localStorage.setItem(KEY, mode); } catch {}
  applyTheme(mode);
  listeners.forEach((l) => l());
}

export function subscribeTheme(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
