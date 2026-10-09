import type { CSSProperties, ReactNode } from 'react';
import { splitWithSyllables } from '../lib/syllables';
import { voiceDef } from '../lib/voiceDivision';
import type { SylDecor } from '../lib/annotationSpans';

/**
 * Desenha um pedaço da letra (texto cantado) com:
 *  - marca-texto colorido nas sílabas de cada voz (divisão de voz);
 *  - sublinhado ondulado nas sílabas comentadas;
 *  - no modo de seleção, cada sílaba vira um botão tocável.
 *
 * `base` = posição deste pedaço dentro do texto cantado da linha inteira. Em
 * linhas com [acordes] a letra é desenhada em vários pedaços (um por acorde),
 * e é por isso que cada pedaço precisa saber onde começa.
 * Sem `syl` (ou sem nada a mostrar) devolve o texto puro, igual ao de antes.
 */

const COMMENT_COLOR = { user: '#f59e0b', mission: '#2563eb' } as const;

const hlStyle = (colors: string[]): CSSProperties => {
  const background =
    colors.length === 1
      ? colors[0]
      : `linear-gradient(to bottom, ${colors
          .map((c, i) => `${c} ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`)
          .join(', ')})`;
  return {
    background,
    borderRadius: 3,
    padding: '0 1px',
    margin: '0 -1px',
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone'
  } as CSSProperties;
};

export function renderLyric(text: string, base: number, line: number, syl: SylDecor | null | undefined): ReactNode {
  if (!syl || !text) return text;
  const len = text.length;

  // ---- modo de seleção: cada sílaba é um botão ----------------------------
  if (syl.selectMode) {
    return splitWithSyllables(text).map((p, i) => {
      const piece = text.slice(p.from, p.to);
      if (!p.syl) return piece;
      const from = base + p.from;
      const to = base + p.to;
      const on = syl.isSelected(line, from, to);
      return (
        <span
          key={i}
          role="button"
          data-syl={`${line}:${from}`}
          onClick={e => {
            e.stopPropagation();
            syl.onTap(line, from, to);
          }}
          className={`cursor-pointer rounded-[3px] px-[1px] -mx-[1px] touch-manipulation select-none ${
            on ? 'bg-brand-orange text-white' : 'bg-slate-200/70 active:bg-brand-orange/40'
          }`}
        >
          {piece}
        </span>
      );
    });
  }

  // ---- leitura: marca-texto e sublinhado ----------------------------------
  const vs = (syl.voice.get(line) || []).filter(m => m.to > base && m.from < base + len);
  const cs = (syl.comment.get(line) || []).filter(m => m.to > base && m.from < base + len);
  if (vs.length === 0 && cs.length === 0) return text;

  const cuts = new Set<number>([0, len]);
  for (const m of [...vs, ...cs]) {
    cuts.add(Math.max(0, m.from - base));
    cuts.add(Math.min(len, m.to - base));
  }
  const points = [...cuts].sort((a, b) => a - b);

  const out: ReactNode[] = [];
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k];
    const b = points[k + 1];
    if (b <= a) continue;
    const piece = text.slice(a, b);
    const mid = base + (a + b) / 2;
    const vHere = vs.filter(m => m.from <= mid && mid < m.to);
    const cHere = cs.filter(m => m.from <= mid && mid < m.to);
    if (vHere.length === 0 && cHere.length === 0) {
      out.push(piece);
      continue;
    }
    const style: CSSProperties = {};
    if (vHere.length) {
      // mesma ordem dos chips, sem repetir a voz
      const ids = [...new Set(vHere.map(m => m.voice))];
      Object.assign(style, hlStyle(ids.map(id => voiceDef(id).hl)));
    }
    if (cHere.length) {
      const scope = cHere.some(m => m.scope === 'mission') ? 'mission' : 'user';
      Object.assign(style, {
        textDecorationLine: 'underline',
        textDecorationStyle: 'wavy',
        textDecorationColor: COMMENT_COLOR[scope],
        textDecorationThickness: '1.5px',
        textUnderlineOffset: '3px'
      } as CSSProperties);
    }
    out.push(
      <span key={k} style={style} data-voice={vHere.length ? vHere.map(m => m.voice).join(' ') : undefined}>
        {piece}
      </span>
    );
  }
  return out;
}
