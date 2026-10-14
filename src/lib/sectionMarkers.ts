/**
 * Marcadores de seção "estilo refrão": uma linha de rótulo abre o bloco e ele
 * vai até "Fim", até o rótulo de outra seção ou até uma linha em branco dupla.
 *
 *   Refrão:      → negrito + barra laranja
 *   Pré-refrão:  → itálico + barra azul discreta
 *   Ponte:       → itálico + barra cinza discreta
 *
 * Fonte única da regra: usada pelo ChordViewer (tela / cifra compartilhada) e
 * pelo pdfExport. A linha instrumental "Ponte: C G Am" (acordes na mesma
 * linha) NÃO abre bloco: a ponte só abre com "Ponte:" sozinho na linha.
 * "Ponte" sem dois-pontos continua sendo um rótulo simples (fim de bloco).
 */

export type SectionKind = 'chorus' | 'prechorus' | 'bridge';

const CHORUS_START_RE = /^(refrão|refrao|coro|chorus)\b/;
// pré-refrão, pre-refrão, prerefrão, prerefrao, "pré refrão", "pre-refrao"...
const PRECHORUS_START_RE = /^pr[eé][-\s]?refr[aã]o\b/;
const BRIDGE_START_RE = /^ponte\s*:\s*$/;

export const SECTION_END_RE = /^(fim|end)\b/;

export const OTHER_SECTION_LABEL_RE =
  /^(estrofe|verso|intro|solo|ponte|final|instrumental|vocalize|inst|passagem|dedilhado|ritmo)\b\s*:?\s*$/;

/** Recebe a linha já sem [acordes], aparada e em minúsculas. */
export function sectionStartOf(strippedLower: string): SectionKind | null {
  if (PRECHORUS_START_RE.test(strippedLower)) return 'prechorus';
  if (CHORUS_START_RE.test(strippedLower)) return 'chorus';
  if (BRIDGE_START_RE.test(strippedLower)) return 'bridge';
  return null;
}

/** Estado seguinte do bloco após ler uma linha. */
export function nextSection(
  current: SectionKind | null,
  strippedLower: string,
  prevLineBlank: boolean
): SectionKind | null {
  const start = sectionStartOf(strippedLower);
  if (start) return start;
  if (
    SECTION_END_RE.test(strippedLower) ||
    OTHER_SECTION_LABEL_RE.test(strippedLower) ||
    (strippedLower === '' && prevLineBlank)
  ) {
    return null;
  }
  return current;
}

export const isItalicSection = (k: SectionKind | null) =>
  k === 'prechorus' || k === 'bridge';

/** Rótulos que o editor insere (ver ChordEditor). */
export const SECTION_LABEL: Record<SectionKind, string> = {
  chorus: 'Refrão:',
  prechorus: 'Pré-refrão:',
  bridge: 'Ponte:'
};

/**
 * Envolve as linhas [selStart, selEnd) do texto com "Rótulo:" ... "Fim".
 * Seleção vazia: insere o par de marcadores na linha do cursor.
 * Devolve o novo texto e a faixa de seleção a aplicar.
 */
export function wrapWithSection(
  text: string,
  selStart: number,
  selEnd: number,
  kind: SectionKind
): { text: string; selStart: number; selEnd: number } {
  const label = SECTION_LABEL[kind];
  const a = Math.min(selStart, selEnd);
  let b = Math.max(selStart, selEnd);
  // seleção terminando logo após uma quebra de linha não inclui a linha seguinte
  if (b > a && text[b - 1] === '\n') b -= 1;

  const lineStart = text.lastIndexOf('\n', a - 1) + 1;
  const nl = text.indexOf('\n', b);
  const lineEnd = nl === -1 ? text.length : nl;

  const before = text.slice(0, lineStart);
  const block = text.slice(lineStart, lineEnd);
  const after = text.slice(lineEnd);

  const inner = block.length ? block : '';
  const out = `${label}\n${inner}${inner ? '\n' : ''}Fim`;
  const next = before + out + after;
  const caret = before.length + label.length + 1;
  return {
    text: next,
    selStart: caret,
    selEnd: caret + inner.length
  };
}
