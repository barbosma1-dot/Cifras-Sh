/**
 * Cores dos comentários (T5): cada TÍTULO tem uma cor da paleta fixa abaixo.
 *
 * - Automática: hash do título normalizado → índice da paleta. Dentro de uma cifra,
 *   se dois títulos caírem no mesmo índice, o que apareceu depois (created_at) pula
 *   para a próxima cor livre — assim títulos diferentes da mesma cifra ficam com
 *   cores diferentes e os já existentes não mudam de cor quando entra um novo.
 * - Manual: `payload.color` (id da paleta) vale só para aquele comentário.
 *
 * Cores = Tailwind 500 (borda/sublinhado/ponto), 50 (fundo do cartão) e 900 (texto).
 * Fundo claro + texto escuro dá contraste alto também no tema escuro (o cartão tem
 * fundo próprio); o 500 serve de sublinhado tanto sobre fundo branco quanto escuro.
 */

export interface CommentColor {
  id: string;
  label: string;
  /** Borda esquerda, sublinhado ondulado na letra e ponto dos chips. */
  main: string;
  /** Fundo claro do cartão. */
  bg: string;
  /** Texto escuro sobre o fundo claro. */
  ink: string;
}

export const COMMENT_COLORS: CommentColor[] = [
  { id: 'amber', label: 'Âmbar', main: '#f59e0b', bg: '#fffbeb', ink: '#78350f' },
  { id: 'blue', label: 'Azul', main: '#3b82f6', bg: '#eff6ff', ink: '#1e3a8a' },
  { id: 'emerald', label: 'Verde', main: '#10b981', bg: '#ecfdf5', ink: '#064e3b' },
  { id: 'rose', label: 'Rosa', main: '#f43f5e', bg: '#fff1f2', ink: '#881337' },
  { id: 'violet', label: 'Violeta', main: '#8b5cf6', bg: '#f5f3ff', ink: '#4c1d95' },
  { id: 'orange', label: 'Laranja', main: '#f97316', bg: '#fff7ed', ink: '#7c2d12' },
  { id: 'cyan', label: 'Ciano', main: '#06b6d4', bg: '#ecfeff', ink: '#164e63' },
  { id: 'fuchsia', label: 'Magenta', main: '#d946ef', bg: '#fdf4ff', ink: '#701a75' }
];

/** Chave normalizada do título: sem acentos, minúsculas, espaços das pontas/duplicados removidos. "" = sem título. */
export function normTitle(t: string | null | undefined): string {
  return (t || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** djb2 — determinístico, sem dependências. */
function hashKey(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h;
}

export function colorById(id: string | null | undefined): CommentColor | null {
  return COMMENT_COLORS.find(c => c.id === id) || null;
}

/** Cor escolhida à mão (payload.color), se válida. */
export function readColorId(payload: unknown): string | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return typeof p.color === 'string' && colorById(p.color) ? p.color : null;
}

/** título normalizado → índice da paleta, na ordem de criação (o mais antigo mantém o índice do hash). */
export function buildTitleColors(items: { title: string | null; created_at: string }[]): Map<string, number> {
  const sorted = [...items].sort((x, y) => (x.created_at < y.created_at ? -1 : x.created_at > y.created_at ? 1 : 0));
  const map = new Map<string, number>();
  for (const it of sorted) {
    const key = normTitle(it.title);
    if (!map.has(key)) map.set(key, freeIndex(key, map));
  }
  return map;
}

function freeIndex(key: string, map: Map<string, number>): number {
  const n = COMMENT_COLORS.length;
  const used = new Set(map.values());
  let idx = hashKey(key) % n;
  if (used.size >= n) return idx; // paleta esgotada: repete
  while (used.has(idx)) idx = (idx + 1) % n;
  return idx;
}

/** Cor automática de um título (já existente na cifra ou novo). */
export function titleColor(map: Map<string, number>, title: string | null | undefined): CommentColor {
  const key = normTitle(title);
  const idx = map.get(key) ?? freeIndex(key, map);
  return COMMENT_COLORS[idx];
}
