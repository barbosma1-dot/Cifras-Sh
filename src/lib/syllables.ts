/**
 * Separação silábica do português (aproximada, sem dicionário).
 * Serve só para dividir a letra em "toques" na hora de marcar um trecho
 * sílaba por sílaba. Devolve intervalos [from, to) em índices do texto.
 *
 * Regras usadas: hiato (a-e-o entre si), ditongos/tritongos com i/u, dígrafos
 * (ch lh nh qu gu), encontros inseparáveis (bl br cl cr dl dr fl fr gl gr pl
 * pr tl tr vr) e consoantes dobradas/rs/ss/rr/sc/sç separadas.
 */

export interface SyllableRange {
  from: number;
  to: number;
}

const VOWELS = 'aeiouáéíóúâêôãõàü';
const STRONG = 'aeoáéíóúâêôãõà'; // a e o (+ acentuadas): formam hiato entre si
const isLetter = (c: string) => /\p{L}/u.test(c);
const isVowel = (c: string) => VOWELS.includes(c.toLowerCase());
const isStrong = (c: string) => STRONG.includes(c.toLowerCase());

const INSEPARABLE = new Set(['bl', 'br', 'cl', 'cr', 'dl', 'dr', 'fl', 'fr', 'gl', 'gr', 'pl', 'pr', 'tl', 'tr', 'vr']);
const DIGRAPHS = new Set(['ch', 'lh', 'nh', 'qu', 'gu']);

/** Há quebra entre as vogais w[j-1] e w[j]? */
function hiatus(w: string, j: number): boolean {
  const a = w[j - 1].toLowerCase();
  const b = w[j].toLowerCase();
  // a/e/o + a/e/o  → hiato (co-e-lho, re-a-li-zar)
  if (isStrong(a) && isStrong(b)) {
    // nasais ã/õ + e/o formam ditongo (mãe, põe)
    if ((a === 'ã' || a === 'õ') && 'eo'.includes(b)) return false;
    return true;
  }
  // i/u acentuado depois de vogal: hiato (sa-ú-de, o-í)
  if ('íú'.includes(b)) return true;
  // i/u + a/e/o: na música se separa (Ma-ri-a, con-fi-ar, tu-a),
  // menos depois de q/g (quan-do, lín-gua, á-gua).
  if ((a === 'i' || a === 'u') && isStrong(b)) {
    if (a === 'u' && j >= 2 && 'qg'.includes(w[j - 2].toLowerCase())) return false;
    return true;
  }
  return false; // vogal + i/u (ai, ei, oi, ui, au, eu, ou, iu): ditongo
}

function syllabifyWord(word: string, offset: number, out: SyllableRange[]) {
  const w = word;
  const n = w.length;
  if (n === 0) return;

  // posição onde cada sílaba começa
  const cuts: number[] = [0];

  // núcleos vocálicos agrupados (ditongo/tritongo juntos, hiato separado)
  type Nucleus = { s: number; e: number }; // [s, e)
  const nuclei: Nucleus[] = [];
  let i = 0;
  while (i < n) {
    if (!isVowel(w[i])) {
      i++;
      continue;
    }
    // "qu"/"gu" + e/i: o u não conta como vogal
    if ((w[i].toLowerCase() === 'u') && i > 0 && 'qg'.includes(w[i - 1].toLowerCase()) && i + 1 < n && 'eiéêíè'.includes(w[i + 1].toLowerCase())) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < n && isVowel(w[j]) && !hiatus(w, j)) j++;
    nuclei.push({ s: i, e: j });
    i = j;
  }

  if (nuclei.length <= 1) {
    out.push({ from: offset, to: offset + n });
    return;
  }

  // entre dois núcleos, decide onde cortar
  for (let k = 0; k < nuclei.length - 1; k++) {
    const gapStart = nuclei[k].e;
    const gapEnd = nuclei[k + 1].s;
    const cons = w.slice(gapStart, gapEnd).toLowerCase();
    let cut: number;
    if (cons.length === 0) {
      cut = gapEnd; // hiato
    } else if (cons.length === 1) {
      cut = gapStart; // V-CV
    } else {
      // pega o final do grupo que fica junto da próxima vogal
      const last2 = cons.slice(-2);
      if (INSEPARABLE.has(last2) || DIGRAPHS.has(last2)) cut = gapEnd - 2;
      else cut = gapEnd - 1; // as demais ficam: VC-CV (ex.: per-nas, as-sim)
      // "ss", "rr", "sc", "sç", "xc" separam entre as duas letras (já cai em VC-CV)
      // consoante final de sílaba antes de grupo: "ns" + "tr" → pe-ns-tr: o cut acima já cobre
    }
    cuts.push(cut);
  }

  cuts.push(n);
  for (let k = 0; k < cuts.length - 1; k++) {
    if (cuts[k + 1] > cuts[k]) out.push({ from: offset + cuts[k], to: offset + cuts[k + 1] });
  }
}

/** Divide um texto em sílabas; espaços e pontuação ficam fora (viram "buracos"). */
export function syllabify(text: string): SyllableRange[] {
  const out: SyllableRange[] = [];
  let i = 0;
  while (i < text.length) {
    if (!isLetter(text[i]) && !/\d/.test(text[i])) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && (isLetter(text[j]) || /\d/.test(text[j]))) j++;
    syllabifyWord(text.slice(i, j), i, out);
    i = j;
  }
  return out;
}

/** Texto -> pedaços {from,to,syl}: sílabas e o que há entre elas (espaços, pontuação). */
export function splitWithSyllables(text: string): { from: number; to: number; syl: boolean }[] {
  const syl = syllabify(text);
  const out: { from: number; to: number; syl: boolean }[] = [];
  let pos = 0;
  for (const s of syl) {
    if (s.from > pos) out.push({ from: pos, to: s.from, syl: false });
    out.push({ from: s.from, to: s.to, syl: true });
    pos = s.to;
  }
  if (pos < text.length) out.push({ from: pos, to: text.length, syl: false });
  return out;
}
