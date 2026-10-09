import { supabase } from './supabase';
import { withTimeout } from './withTimeout';

/**
 * Anotações de cifra (T5a: comentários; T5b reaproveita a mesma tabela para a
 * divisão de voz via `kind: 'voice'` + `payload`).
 *
 * Um comentário = título + nota opcional + trecho da cifra (intervalo de
 * linhas do `chords.content`, 0-based) e escopo "usuário" (só eu) ou "missão".
 */

export type AnnotationKind = 'comment' | 'voice';
export type AnnotationScope = 'user' | 'mission';

export interface ChordAnnotation {
  id: string;
  chord_id: string;
  kind: AnnotationKind;
  scope: AnnotationScope;
  owner_id: string;
  mission_id: string | null;
  title: string | null;
  body: string | null;
  line_start: number;
  line_end: number;
  excerpt: string;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AnnotationMission {
  id: string;
  name: string;
  /** true se o usuário pode criar/editar comentários dessa missão. */
  canWrite: boolean;
}

export interface AnnotationContext {
  userId: string;
  isAdmin: boolean;
  missions: AnnotationMission[];
}

const WRITE_ROLES = ['coordinator', 'editor', 'admin'];
const ADMIN_EMAIL = 'barbosma1@gmail.com';
const FETCH_TIMEOUT_MS = 12000;

// ---------------------------------------------------------------------------
// Contexto do usuário (quem sou eu, de quais missões participo)
// ---------------------------------------------------------------------------

export async function loadAnnotationContext(): Promise<AnnotationContext | null> {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [membersRes, profileRes] = await Promise.all([
    supabase.from('mission_members').select('role, missions(id, name, coordinator_id)').eq('user_id', user.id),
    supabase.from('user_profiles').select('role').eq('id', user.id).maybeSingle()
  ]);

  const isAdmin = user.email === ADMIN_EMAIL || profileRes.data?.role === 'admin';

  const missions: AnnotationMission[] = [];
  for (const row of (membersRes.data as any[]) || []) {
    const m = Array.isArray(row.missions) ? row.missions[0] : row.missions;
    if (!m?.id) continue;
    missions.push({
      id: m.id,
      name: m.name || 'Missão',
      canWrite: isAdmin || m.coordinator_id === user.id || WRITE_ROLES.includes(row.role)
    });
  }

  return { userId: user.id, isAdmin, missions };
}

/** Pode editar/apagar esta anotação? (a RLS do banco é quem decide de verdade) */
export function canManageAnnotation(a: ChordAnnotation, ctx: AnnotationContext | null): boolean {
  if (!ctx) return false;
  if (a.scope === 'user') return a.owner_id === ctx.userId;
  return ctx.missions.some(m => m.id === a.mission_id && m.canWrite) || ctx.isAdmin;
}

// ---------------------------------------------------------------------------
// CRUD (com cache local para leitura offline)
// ---------------------------------------------------------------------------

const cacheKey = (userId: string, chordId: string) => `chord_annotations:${userId}:${chordId}`;

function readCache(userId: string, chordId: string): ChordAnnotation[] {
  try {
    const raw = localStorage.getItem(cacheKey(userId, chordId));
    return raw ? (JSON.parse(raw) as ChordAnnotation[]) : [];
  } catch {
    return [];
  }
}

function writeCache(userId: string, chordId: string, list: ChordAnnotation[]) {
  try {
    localStorage.setItem(cacheKey(userId, chordId), JSON.stringify(list));
  } catch {
    /* sem espaço / indisponível: ignora */
  }
}

export function setCachedAnnotations(userId: string, chordId: string, list: ChordAnnotation[]) {
  writeCache(userId, chordId, list);
}

export function getCachedAnnotations(userId: string, chordId: string): ChordAnnotation[] {
  return readCache(userId, chordId);
}

export async function fetchAnnotations(
  userId: string,
  chordId: string,
  kind: AnnotationKind = 'comment'
): Promise<{ list: ChordAnnotation[]; fromCache: boolean }> {
  try {
    const { data, error } = await withTimeout(
      supabase
        .from('chord_annotations')
        .select('*')
        .eq('chord_id', chordId)
        .eq('kind', kind)
        .order('line_start', { ascending: true })
        .order('created_at', { ascending: true }),
      FETCH_TIMEOUT_MS
    );
    if (error) throw error;
    const list = (data as ChordAnnotation[]) || [];
    if (kind === 'comment') writeCache(userId, chordId, list);
    return { list, fromCache: false };
  } catch {
    // Offline, tabela ainda não migrada, etc.: usa o último cache conhecido.
    return { list: kind === 'comment' ? readCache(userId, chordId) : [], fromCache: true };
  }
}

export interface AnnotationInput {
  chord_id: string;
  scope: AnnotationScope;
  mission_id: string | null;
  title: string;
  body: string;
  line_start: number;
  line_end: number;
  excerpt: string;
}

export async function createAnnotation(userId: string, input: AnnotationInput): Promise<ChordAnnotation> {
  const { data, error } = await withTimeout(
    supabase
      .from('chord_annotations')
      .insert({
        chord_id: input.chord_id,
        kind: 'comment',
        scope: input.scope,
        owner_id: userId,
        mission_id: input.scope === 'mission' ? input.mission_id : null,
        title: input.title.trim(),
        body: input.body.trim() || null,
        line_start: input.line_start,
        line_end: input.line_end,
        excerpt: input.excerpt
      })
      .select('*')
      .single(),
    FETCH_TIMEOUT_MS
  );
  if (error) throw error;
  return data as ChordAnnotation;
}

export async function updateAnnotation(
  id: string,
  patch: Partial<Pick<AnnotationInput, 'scope' | 'mission_id' | 'title' | 'body'>>
): Promise<ChordAnnotation> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.body !== undefined) row.body = patch.body.trim() || null;
  if (patch.scope !== undefined) {
    row.scope = patch.scope;
    row.mission_id = patch.scope === 'mission' ? patch.mission_id : null;
  }
  const { data, error } = await withTimeout(
    supabase.from('chord_annotations').update(row).eq('id', id).select('*').single(),
    FETCH_TIMEOUT_MS
  );
  if (error) throw error;
  return data as ChordAnnotation;
}

export async function deleteAnnotation(id: string): Promise<void> {
  const { error } = await withTimeout(
    supabase.from('chord_annotations').delete().eq('id', id),
    FETCH_TIMEOUT_MS
  );
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Trecho: texto das linhas e reancoragem se a cifra for editada
// ---------------------------------------------------------------------------

const CHORD_ONLY_LINE_RE =
  /^\s*([A-G][b#]?[m7majdimaugsus0-9/]*\s+)*[A-G][b#]?[m7majdimaugsus0-9/]*\s*$/;

/** Texto "de leitura" de uma linha: sem [acordes] e vazio se for só cifra. */
export function plainLineText(line: string): string {
  if (CHORD_ONLY_LINE_RE.test(line)) return '';
  return line.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

/** Texto do trecho (linhas a..b) para guardar e comparar. */
export function buildExcerpt(lines: string[], start: number, end: number): string {
  const parts: string[] = [];
  for (let i = start; i <= end && i < lines.length; i++) {
    const t = plainLineText(lines[i]);
    if (t) parts.push(t);
  }
  return parts.join(' / ').slice(0, 400);
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export interface ResolvedAnchor {
  start: number;
  end: number;
  /** ok = linhas iguais ao salvo; moved = reencontrado em outro lugar; lost = trecho não existe mais. */
  status: 'ok' | 'moved' | 'lost';
}

/**
 * Descobre onde o trecho está AGORA no conteúdo. Se as linhas salvas ainda
 * têm o mesmo texto → ok. Senão procura um intervalo de mesmo tamanho com o
 * mesmo texto (o mais próximo da posição antiga) → moved. Senão → lost.
 */
export function resolveAnchor(a: Pick<ChordAnnotation, 'line_start' | 'line_end' | 'excerpt'>, lines: string[]): ResolvedAnchor {
  const span = a.line_end - a.line_start;
  const want = norm(a.excerpt);

  // Anotação sem texto de referência (ex.: trecho só de acordes): confia nas linhas.
  if (!want) {
    const inRange = a.line_start < lines.length;
    return inRange
      ? { start: a.line_start, end: Math.min(a.line_end, lines.length - 1), status: 'ok' }
      : { start: a.line_start, end: a.line_end, status: 'lost' };
  }

  const same = (s: number) => s >= 0 && s + span < lines.length && norm(buildExcerpt(lines, s, s + span)) === want;

  if (same(a.line_start)) return { start: a.line_start, end: a.line_end, status: 'ok' };

  let best = -1;
  for (let s = 0; s + span < lines.length; s++) {
    if (!same(s)) continue;
    if (best === -1 || Math.abs(s - a.line_start) < Math.abs(best - a.line_start)) best = s;
  }
  if (best !== -1) return { start: best, end: best + span, status: 'moved' };

  return { start: a.line_start, end: a.line_end, status: 'lost' };
}
