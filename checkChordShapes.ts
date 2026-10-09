/**
 * Confere TODAS as formas de acorde geradas (12 fundamentais × tipos × 2
 * instrumentos): as notas tocadas precisam estar dentro do acorde e conter as
 * notas essenciais; o violão precisa ter a fundamental no grave (exceto "5").
 * Rodar:  bun scripts/checkChordShapes.ts
 */
import { getChordShape, getQualityTones, shapePitchClasses, type ChordQuality, type Instrument } from '../src/lib/chordShapes';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SUFFIX: Record<ChordQuality, string> = {
  maj: '', min: 'm', '7': '7', m7: 'm7', maj7: 'maj7', sus4: 'sus4', sus2: 'sus2', dim: 'dim',
  aug: 'aug', '6': '6', m6: 'm6', add9: 'add9', '9': '9', dim7: 'dim7', m7b5: 'm7b5', '5': '5'
};

let ok = 0, bad = 0, none = 0;
const noneList: string[] = [];
for (const inst of ['guitar', 'ukulele'] as Instrument[]) {
  for (const q of Object.keys(SUFFIX) as ChordQuality[]) {
    for (let root = 0; root < 12; root++) {
      const label = NAMES[root] + SUFFIX[q];
      const r = getChordShape(label, inst);
      if (!r.shape) { none++; noneList.push(`${inst} ${label}`); continue; }
      const { allowed, required } = getQualityTones(q);
      const pcs = shapePitchClasses(r.shape);
      const allowedSet = new Set(allowed.map(i => (root + i) % 12));
      const problems: string[] = [];
      if (!pcs.every(p => allowedSet.has(p))) problems.push('nota fora do acorde');
      for (const rq of required) if (!pcs.includes((root + rq) % 12)) problems.push(`falta intervalo ${rq}`);
      const played = r.shape.frets.filter(f => f !== null) as number[];
      if (Math.max(...played) - Math.min(...played.filter(f => f > 0).concat(Math.max(...played))) > 4) problems.push('abertura > 4 casas');
      if (Math.max(...played) > 15) problems.push('casa muito alta');
      if (inst === 'guitar' && q !== '5' && pcs[0] !== root) problems.push('fundamental não está no grave');
      if (problems.length) { bad++; console.log('✗', inst, label, JSON.stringify(r.shape.frets), problems.join(', ')); } else ok++;
    }
  }
}
// Latim, bemol, barra, variações
const extra = ['Dó', 'Sol7', 'Lám7', 'Sib', 'Réb/Fá', 'C/G', 'Bb', 'F#m7', 'C13', 'Cmaj9', 'Xyz', ''];
for (const l of extra) {
  const g = getChordShape(l, 'guitar');
  console.log(JSON.stringify(l).padEnd(10), g.parsed ? `root=${g.parsed.root} q=${g.parsed.quality} exact=${g.parsed.exact} bass=${g.parsed.bass}` : 'não reconhecido', g.shape ? JSON.stringify(g.shape.frets) : '-', g.notes.join(' '), g.warning ?? '');
}

// Acordes com baixo (violão): a nota mais grave tem que ser o baixo e as notas têm que caber no acorde + baixo.
{
  let okB = 0, badB = 0, warnB = 0;
  const quals: ChordQuality[] = ['maj', 'min', '7', 'm7', 'maj7', 'sus4'];
  for (const q of quals) {
    const { allowed } = getQualityTones(q);
    for (let root = 0; root < 12; root++) {
      for (const iv of allowed) {
        const bass = (root + iv) % 12;
        if (bass === root) continue;
        const label = `${NAMES[root]}${SUFFIX[q]}/${NAMES[bass]}`;
        const r = getChordShape(label, 'guitar');
        if (!r.shape) { badB++; console.log('✗ sem forma', label); continue; }
        if (r.warning) { warnB++; continue; }
        const pcs = shapePitchClasses(r.shape);
        const okSet = new Set(allowed.map(i => (root + i) % 12).concat(bass));
        const problems: string[] = [];
        if (pcs[0] !== bass) problems.push('baixo não é a nota mais grave');
        if (!pcs.every(p => okSet.has(p))) problems.push('nota fora do acorde');
        const played = r.shape.frets.filter((f): f is number => f !== null && f > 0);
        if (played.length && Math.max(...played) - Math.min(...played) > 4) problems.push('abertura > 4 casas');
        if (problems.length) { badB++; console.log('✗ baixo', label, JSON.stringify(r.shape.frets), problems.join(', ')); } else okB++;
      }
    }
  }
  console.log(`\nBaixo (violão): OK ${okB}  PROBLEMAS ${badB}  só com aviso ${warnB}`);
  bad += badB;
}
console.log(`\nOK: ${ok}  PROBLEMAS: ${bad}  SEM FORMA: ${none}`);
if (noneList.length) console.log('Sem forma:', noneList.join(', '));
process.exit(bad ? 1 : 0);
