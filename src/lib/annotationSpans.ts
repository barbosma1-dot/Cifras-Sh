import type { VoiceId } from './voiceDivision';

/**
 * Trechos marcados SÍLABA POR SÍLABA (comentários e divisão de voz).
 *
 * Posição = linha da cifra + intervalo [from, to) de caracteres no texto
 * cantado da linha (a linha sem os [acordes]). É o mesmo texto que a tela
 * desenha, então o intervalo cai exatamente nas sílabas tocadas.
 *
 * No banco (`chord_annotations.payload`):
 *   spans: [{ dl, f, t }]   dl = linha RELATIVA a line_start (acompanha o
 *                           trecho se a cifra mudar de lugar), f/t = from/to
 *   sel:   texto marcado (só para mostrar no painel)
 * Anotações antigas (sem `spans`) valem para a linha inteira.
 */

export interface LineSpan {
  dl: number;
  f: number;
  t: number;
}

export interface SylPos {
  line: number;
  from: number;
  to: number;
}

/** Marca já posicionada numa linha da cifra (intervalo em caracteres do texto cantado). */
export interface SpanOnLine {
  id: string;
  from: number;
  to: number;
}

export interface VoiceSpanOnLine extends SpanOnLine {
  voice: VoiceId;
}

export interface CommentSpanOnLine extends SpanOnLine {
  scope: 'user' | 'mission';
}

/** Tudo que o desenho da letra precisa saber (ver LyricSpans.tsx). */
export interface SylDecor {
  selectMode: boolean;
  isSelected: (line: number, from: number, to: number) => boolean;
  onTap: (line: number, from: number, to: number) => void;
  voice: Map<number, VoiceSpanOnLine[]>;
  comment: Map<number, CommentSpanOnLine[]>;
}

const CHORD_ONLY_LINE_RE = /^\s*([A-G][b#]?[m7majdimaugsus0-9/]*\s+)*[A-G][b#]?[m7majdimaugsus0-9/]*\s*$/;

/** Texto cantado da linha, exatamente como aparece na tela ('' se for só cifra). */
export function lyricOf(line: string): string {
  if (line.includes('[') && line.includes(']')) return line.replace(/\[.*?\]/g, '');
  if (CHORD_ONLY_LINE_RE.test(line)) return '';
  return line;
}

const cmp = (l1: number, c1: number, l2: number, c2: number) => (l1 !== l2 ? l1 - l2 : c1 - c2);

/** Ordena as duas pontas da seleção (início/fim) pela posição na cifra. */
export function orderSelection(a: SylPos, b: SylPos | null): { lo: SylPos; hi: SylPos } {
  if (!b) return { lo: a, hi: a };
  return cmp(a.line, a.from, b.line, b.from) <= 0 ? { lo: a, hi: b } : { lo: b, hi: a };
}

export function isInSelection(line: number, from: number, to: number, a: SylPos | null, b: SylPos | null): boolean {
  if (!a) return false;
  const { lo, hi } = orderSelection(a, b);
  return cmp(line, from, lo.line, lo.from) >= 0 && cmp(line, to, hi.line, hi.to) <= 0;
}

export interface SelectionResult {
  lineStart: number;
  lineEnd: number;
  spans: LineSpan[];
  /** Texto marcado, uma linha por " / ". */
  sel: string;
}

/** Converte as duas pontas tocadas em trechos por linha. */
export function spansFromSelection(lines: string[], a: SylPos, b: SylPos | null): SelectionResult | null {
  const { lo, hi } = orderSelection(a, b);
  const spans: LineSpan[] = [];
  const parts: string[] = [];
  for (let L = lo.line; L <= hi.line && L < lines.length; L++) {
    const text = lyricOf(lines[L]);
    if (!text.trim()) continue;
    const firstNonSpace = text.length - text.trimStart().length;
    const lastNonSpace = text.trimEnd().length;
    let f = L === lo.line ? lo.from : firstNonSpace;
    let t = L === hi.line ? hi.to : lastNonSpace;
    f = Math.max(0, Math.min(f, text.length));
    t = Math.max(f, Math.min(t, text.length));
    if (t <= f) continue;
    spans.push({ dl: L - lo.line, f, t });
    parts.push(text.slice(f, t).trim());
  }
  if (spans.length === 0) return null;
  return { lineStart: lo.line, lineEnd: hi.line, spans, sel: parts.join(' / ').slice(0, 400) };
}

/** Lê `spans` do payload com segurança (vem do banco, pode estar vazio/errado). */
export function readSpans(payload: unknown): LineSpan[] | null {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (!Array.isArray(p.spans)) return null;
  const out: LineSpan[] = [];
  for (const s of p.spans) {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    if (Number.isInteger(o.dl) && Number.isFinite(o.f) && Number.isFinite(o.t) && (o.dl as number) >= 0 && (o.t as number) > (o.f as number)) {
      out.push({ dl: o.dl as number, f: Math.max(0, o.f as number), t: o.t as number });
    }
  }
  return out.length ? out : null;
}

export function readSel(payload: unknown): string {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return typeof p.sel === 'string' ? p.sel : '';
}

/**
 * Trechos de uma anotação, em linhas ABSOLUTAS da cifra agora.
 * `start`/`end` vêm do reancoramento (resolveAnchor). Sem `spans` (anotação
 * antiga) vale a linha inteira, de start a end.
 */
export function spansOnLines(payload: unknown, start: number, end: number): { line: number; from: number; to: number }[] {
  const spans = readSpans(payload);
  if (!spans) {
    const out: { line: number; from: number; to: number }[] = [];
    for (let i = start; i <= end; i++) out.push({ line: i, from: 0, to: Number.POSITIVE_INFINITY });
    return out;
  }
  return spans.map(s => ({ line: start + s.dl, from: s.f, to: s.t }));
}

/** Última linha que a anotação realmente marca (onde aparece a nota/letra da voz). */
export function lastLineOf(payload: unknown, start: number, end: number): number {
  const spans = readSpans(payload);
  if (!spans) return end;
  return start + Math.max(...spans.map(s => s.dl));
}
