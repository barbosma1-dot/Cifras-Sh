/**
 * Formas (shapes) de acordes para violão e ukulele — sem dependências.
 *
 * Como funciona:
 *  1. `parseChord` entende o acorde como aparece na tela (notação inglesa
 *     "C#m7/G" ou latina "Dó#m7/Sol") e devolve fundamental + tipo + baixo.
 *  2. Para cada instrumento há uma lista de "formas base" (ex.: o E aberto
 *     do violão). Uma forma base é deslocada pelas casas (pestana) até a
 *     fundamental certa; vence a de menor deslocamento (ou seja, a mais
 *     perto da pestana/casa zero).
 *  3. Tipos sem forma base (ex.: ukulele dim/aug, dim7 e m7b5 no violão) são
 *     resolvidos por busca exaustiva de casas, escolhendo a mais fácil.
 *  Todas as formas são checadas por `scripts/checkChordShapes.ts`
 *  (notas tocadas ⊆ notas do acorde e contém as notas essenciais).
 */

export type Instrument = 'guitar' | 'ukulele';

export type ChordQuality =
  | 'maj' | 'min' | '7' | 'm7' | 'maj7' | 'sus4' | 'sus2'
  | 'dim' | 'aug' | '6' | 'm6' | 'add9' | '9' | 'dim7' | 'm7b5' | '5';

export interface ParsedChord {
  /** 0–11 (Dó = 0). */
  root: number;
  quality: ChordQuality;
  /** Baixo de um acorde com barra (ex.: C/G → 7), senão null. */
  bass: number | null;
  /** false quando o sufixo não é reconhecido e foi simplificado (ex.: "C13"). */
  exact: boolean;
  /** Notação usada no texto de entrada, para mostrar as notas igual. */
  latin: boolean;
  /** true se a fundamental foi escrita com bemol. */
  flats: boolean;
}

export interface ChordShape {
  instrument: Instrument;
  /** Uma entrada por corda, da mais grave para a mais aguda
   * (violão: E A D G B e; ukulele: G C E A). null = abafada; 0 = solta. */
  frets: (number | null)[];
  /** Primeira casa mostrada no diagrama (1 = pestana/“nut”). */
  baseFret: number;
  /** Pestana (casa e intervalo de cordas, índices inclusivos) ou null. */
  barre: { fret: number; from: number; to: number } | null;
}

export interface ChordShapeResult {
  parsed: ParsedChord | null;
  shape: ChordShape | null;
  /** Notas do acorde, na notação do texto (ex.: ["Dó", "Mi", "Sol"]). */
  notes: string[];
  /** Aviso para a pessoa (forma simplificada, baixo não incluído, etc.). */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------

const OPEN_STRINGS: Record<Instrument, number[]> = {
  guitar: [4, 9, 2, 7, 11, 4], // E A D G B E
  ukulele: [7, 0, 4, 9] // G C E A (afinação "re-entrante")
};

const NAMES_EN_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_EN_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NAMES_LA_SHARP = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
const NAMES_LA_FLAT = ['Dó', 'Réb', 'Ré', 'Mib', 'Mi', 'Fá', 'Solb', 'Sol', 'Láb', 'Lá', 'Sib', 'Si'];

const ROOT_BASE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  'Dó': 0, Do: 0, 'Ré': 2, Re: 2, Mi: 4, 'Fá': 5, Fa: 5, Sol: 7, 'Lá': 9, La: 9, Si: 11
};

const ROOT_RE = /^(Dó|Do|Ré|Re|Mi|Fá|Fa|Sol|Lá|La|Si|[A-G])([#b♯♭]?)/;

const ROOT_RE_ENGLISH = /^([A-G])([#b♯♭]?)/;

function parseRoot(
  text: string,
  englishOnly = false
): { pc: number; rest: string; latin: boolean; flat: boolean } | null {
  const m = text.match(englishOnly ? ROOT_RE_ENGLISH : ROOT_RE);
  if (!m) return null;
  const base = ROOT_BASE[m[1]];
  if (base === undefined) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return {
    pc: (base + acc + 12) % 12,
    rest: text.slice(m[0].length),
    latin: /^(Dó|Do|Ré|Re|Mi|Fá|Fa|Sol|Lá|La|Si)$/.test(m[1]),
    flat: acc === -1
  };
}

// ---------------------------------------------------------------------------
// Parsing do símbolo do acorde
// ---------------------------------------------------------------------------

const SUFFIX_MAP: Record<string, ChordQuality> = {
  '': 'maj', maj: 'maj', M: 'maj',
  m: 'min', min: 'min', '-': 'min',
  '7': '7', dom7: '7',
  m7: 'm7', min7: 'm7', '-7': 'm7',
  maj7: 'maj7', M7: 'maj7', '7M': 'maj7', '△': 'maj7', '△7': 'maj7', Δ: 'maj7', Δ7: 'maj7',
  sus4: 'sus4', sus: 'sus4', '4': 'sus4',
  sus2: 'sus2', '2': 'sus2',
  dim: 'dim', '°': 'dim', o: 'dim',
  dim7: 'dim7', '°7': 'dim7', o7: 'dim7',
  m7b5: 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', 'm7♭5': 'm7b5',
  aug: 'aug', '+': 'aug', '#5': 'aug',
  '6': '6', m6: 'm6', min6: 'm6',
  add9: 'add9', add2: 'add9',
  '9': '9',
  '5': '5'
};

export function parseChord(label: string): ParsedChord | null {
  const clean = (label || '').trim().replace(/[()\s]/g, '');
  if (!clean) return null;

  const slash = clean.indexOf('/');
  const main = slash >= 0 ? clean.slice(0, slash) : clean;
  const bassText = slash >= 0 ? clean.slice(slash + 1) : '';

  // "Faug" pode ser Fá + "ug" ou F + "aug"; "Fadd9", "Dom" etc. também. Tenta a
  // leitura latina e a inglesa e fica com a primeira cujo sufixo é conhecido.
  const candidates = [parseRoot(main), parseRoot(main, true)].filter(
    (r): r is NonNullable<ReturnType<typeof parseRoot>> => r !== null
  );
  if (candidates.length === 0) return null;
  const root = candidates.find(r => SUFFIX_MAP[r.rest] !== undefined) ?? candidates[0];

  const suffix = root.rest;
  let quality: ChordQuality | undefined = SUFFIX_MAP[suffix];
  let exact = true;

  if (!quality) {
    exact = false;
    if (/sus4|sus$/.test(suffix)) quality = 'sus4';
    else if (/sus2/.test(suffix)) quality = 'sus2';
    else if (/^(maj|M|Δ|△)/.test(suffix)) quality = 'maj7';
    else if (/^(m|min|-)(?!aj)/.test(suffix)) quality = /7/.test(suffix) ? 'm7' : 'min';
    else if (/^7/.test(suffix) || /^(9|11|13)/.test(suffix)) quality = '7';
    else quality = 'maj';
  }

  let bass: number | null = null;
  if (bassText) {
    const b = parseRoot(bassText);
    if (b && b.rest === '') bass = b.pc;
  }

  return { root: root.pc, quality, bass, exact, latin: root.latin, flats: root.flat };
}

/** Intervalos (semitons a partir da fundamental): permitidos e obrigatórios. */
const QUALITY_TONES: Record<ChordQuality, { allowed: number[]; required: number[] }> = {
  maj: { allowed: [0, 4, 7], required: [0, 4] },
  min: { allowed: [0, 3, 7], required: [0, 3] },
  '7': { allowed: [0, 4, 7, 10], required: [0, 4, 10] },
  m7: { allowed: [0, 3, 7, 10], required: [0, 3, 10] },
  maj7: { allowed: [0, 4, 7, 11], required: [0, 4, 11] },
  sus4: { allowed: [0, 5, 7], required: [0, 5] },
  sus2: { allowed: [0, 2, 7], required: [0, 2] },
  dim: { allowed: [0, 3, 6], required: [0, 3, 6] },
  aug: { allowed: [0, 4, 8], required: [0, 4, 8] },
  '6': { allowed: [0, 4, 7, 9], required: [0, 4, 9] },
  m6: { allowed: [0, 3, 7, 9], required: [0, 3, 9] },
  add9: { allowed: [0, 2, 4, 7], required: [0, 2, 4] },
  '9': { allowed: [0, 2, 4, 7, 10], required: [0, 2, 4, 10] },
  dim7: { allowed: [0, 3, 6, 9], required: [0, 3, 6, 9] },
  m7b5: { allowed: [0, 3, 6, 10], required: [0, 3, 6, 10] },
  '5': { allowed: [0, 7], required: [0, 7] }
};

export function getQualityTones(q: ChordQuality) {
  return QUALITY_TONES[q];
}

// ---------------------------------------------------------------------------
// Formas base (frets por corda; null = abafada). `base` = nota (0–11) que a
// forma toca como fundamental quando está "solta" (sem deslocamento).
// ---------------------------------------------------------------------------

interface Template {
  base: number;
  frets: (number | null)[];
}

const X = null;

const TEMPLATES: Record<Instrument, Partial<Record<ChordQuality, Template[]>>> = {
  guitar: {
    maj: [
      { base: 4, frets: [0, 2, 2, 1, 0, 0] }, // E
      { base: 9, frets: [X, 0, 2, 2, 2, 0] }, // A
      { base: 0, frets: [X, 3, 2, 0, 1, 0] }, // C
      { base: 2, frets: [X, X, 0, 2, 3, 2] }, // D
      { base: 7, frets: [3, 2, 0, 0, 0, 3] } // G
    ],
    min: [
      { base: 4, frets: [0, 2, 2, 0, 0, 0] }, // Em
      { base: 9, frets: [X, 0, 2, 2, 1, 0] }, // Am
      { base: 2, frets: [X, X, 0, 2, 3, 1] } // Dm
    ],
    '7': [
      { base: 4, frets: [0, 2, 0, 1, 0, 0] }, // E7
      { base: 9, frets: [X, 0, 2, 0, 2, 0] }, // A7
      { base: 0, frets: [X, 3, 2, 3, 1, 0] }, // C7
      { base: 2, frets: [X, X, 0, 2, 1, 2] }, // D7
      { base: 7, frets: [3, 2, 0, 0, 0, 1] } // G7
    ],
    m7: [
      { base: 4, frets: [0, 2, 0, 0, 0, 0] }, // Em7
      { base: 9, frets: [X, 0, 2, 0, 1, 0] }, // Am7
      { base: 2, frets: [X, X, 0, 2, 1, 1] } // Dm7
    ],
    maj7: [
      { base: 4, frets: [0, 2, 1, 1, 0, 0] }, // Emaj7
      { base: 9, frets: [X, 0, 2, 1, 2, 0] }, // Amaj7
      { base: 0, frets: [X, 3, 2, 0, 0, 0] }, // Cmaj7
      { base: 2, frets: [X, X, 0, 2, 2, 2] }, // Dmaj7
      { base: 7, frets: [3, 2, 0, 0, 0, 2] } // Gmaj7
    ],
    sus4: [
      { base: 4, frets: [0, 2, 2, 2, 0, 0] }, // Esus4
      { base: 9, frets: [X, 0, 2, 2, 3, 0] }, // Asus4
      { base: 2, frets: [X, X, 0, 2, 3, 3] } // Dsus4
    ],
    sus2: [
      { base: 9, frets: [X, 0, 2, 2, 0, 0] }, // Asus2
      { base: 2, frets: [X, X, 0, 2, 3, 0] } // Dsus2
    ],
    dim: [{ base: 9, frets: [X, 0, 1, 2, 1, X] }], // Adim
    aug: [
      { base: 9, frets: [X, 0, 3, 2, 2, 1] }, // Aaug
      { base: 4, frets: [0, 3, 2, 1, 1, 0] } // Eaug
    ],
    '6': [
      { base: 4, frets: [0, 2, 2, 1, 2, 0] }, // E6
      { base: 9, frets: [X, 0, 2, 2, 2, 2] } // A6
    ],
    m6: [{ base: 9, frets: [X, 0, 2, 2, 1, 2] }], // Am6
    add9: [{ base: 0, frets: [X, 3, 2, 0, 3, 0] }], // Cadd9
    '9': [{ base: 4, frets: [0, 2, 0, 1, 0, 2] }], // E9
    '5': [{ base: 4, frets: [0, 2, 2, X, X, X] }] // E5 (pestana móvel)
  },
  ukulele: {
    maj: [
      { base: 0, frets: [0, 0, 0, 3] }, // C
      { base: 9, frets: [2, 1, 0, 0] }, // A
      { base: 5, frets: [2, 0, 1, 0] }, // F
      { base: 7, frets: [0, 2, 3, 2] }, // G
      { base: 2, frets: [2, 2, 2, 0] } // D
    ],
    min: [
      { base: 0, frets: [0, 3, 3, 3] }, // Cm
      { base: 9, frets: [2, 0, 0, 0] }, // Am
      { base: 2, frets: [2, 2, 1, 0] }, // Dm
      { base: 7, frets: [0, 2, 3, 1] } // Gm
    ],
    '7': [
      { base: 0, frets: [0, 0, 0, 1] }, // C7
      { base: 9, frets: [0, 1, 0, 0] }, // A7
      { base: 7, frets: [0, 2, 1, 2] }, // G7
      { base: 2, frets: [2, 2, 2, 3] } // D7
    ],
    m7: [
      { base: 0, frets: [3, 3, 3, 3] }, // Cm7
      { base: 9, frets: [0, 0, 0, 0] }, // Am7
      { base: 2, frets: [2, 2, 1, 3] } // Dm7
    ],
    maj7: [
      { base: 0, frets: [0, 0, 0, 2] }, // Cmaj7
      { base: 9, frets: [1, 1, 0, 0] }, // Amaj7
      { base: 7, frets: [0, 2, 2, 2] } // Gmaj7
    ],
    sus4: [
      { base: 0, frets: [0, 0, 1, 3] }, // Csus4
      { base: 9, frets: [2, 2, 0, 0] }, // Asus4
      { base: 7, frets: [0, 2, 3, 3] } // Gsus4
    ],
    sus2: [
      { base: 0, frets: [0, 2, 3, 3] }, // Csus2
      { base: 2, frets: [2, 2, 0, 0] } // Dsus2
    ]
  }
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

function pcsOf(instrument: Instrument, frets: (number | null)[]): (number | null)[] {
  const open = OPEN_STRINGS[instrument];
  return frets.map((f, i) => (f === null ? null : (open[i] + f) % 12));
}

function lowestPlayedPc(instrument: Instrument, frets: (number | null)[]): number | null {
  const pcs = pcsOf(instrument, frets);
  for (const pc of pcs) if (pc !== null) return pc;
  return null;
}

function buildShape(
  instrument: Instrument,
  frets: (number | null)[],
  barreStrings: number[]
): ChordShape {
  const positive = frets.filter((f): f is number => f !== null && f > 0);
  const maxFret = positive.length ? Math.max(...positive) : 0;
  const minFret = positive.length ? Math.min(...positive) : 1;
  const baseFret = maxFret <= 5 ? 1 : minFret;

  let barre: ChordShape['barre'] = null;
  if (barreStrings.length >= 2) {
    const fret = frets[barreStrings[0]];
    if (fret !== null && fret > 0) {
      barre = { fret, from: Math.min(...barreStrings), to: Math.max(...barreStrings) };
    }
  }
  return { instrument, frets, baseFret, barre };
}

function shapeFromTemplates(
  instrument: Instrument,
  parsed: ParsedChord
): { shape: ChordShape; bassMatched: boolean } | null {
  const list = TEMPLATES[instrument][parsed.quality];
  if (!list || list.length === 0) return null;

  let best: { score: number; frets: (number | null)[]; barreStrings: number[]; bassMatched: boolean } | null = null;

  for (const t of list) {
    const shift = (parsed.root - t.base + 12) % 12;
    const frets = t.frets.map(f => (f === null ? null : f + shift));
    const played = frets.filter((f): f is number => f !== null);
    const maxFret = Math.max(...played);
    const bassMatched = parsed.bass !== null && lowestPlayedPc(instrument, frets) === parsed.bass;

    // Menor deslocamento primeiro; depois a casa mais alta; baixo certo ganha muito.
    const score = shift * 100 + maxFret - (bassMatched ? 10000 : 0);

    if (!best || score < best.score) {
      const barreStrings: number[] = [];
      if (shift > 0) {
        t.frets.forEach((f, i) => {
          if (f === 0) barreStrings.push(i);
        });
      }
      best = { score, frets, barreStrings, bassMatched };
    }
  }
  if (!best) return null;
  return {
    shape: buildShape(instrument, best.frets, best.barreStrings),
    bassMatched: best.bassMatched
  };
}

/** Busca exaustiva: usada quando o tipo de acorde não tem forma base. */
function shapeBySearch(instrument: Instrument, parsed: ChordParsedLike): ChordShape | null {
  const open = OPEN_STRINGS[instrument];
  const n = open.length;
  const { allowed, required } = QUALITY_TONES[parsed.quality];
  const allowedSet = new Set(allowed.map(i => (parsed.root + i) % 12));
  const requiredPcs = required.map(i => (parsed.root + i) % 12);
  const minPlayed = 4;

  let best: { cost: number; frets: (number | null)[] } | null = null;

  for (let ws = 0; ws <= 9; ws++) {
    const options: (number | null)[][] = [];
    for (let s = 0; s < n; s++) {
      const opts: (number | null)[] = [0];
      for (let f = Math.max(ws, 1); f <= ws + 3; f++) opts.push(f);
      if (instrument === 'guitar') opts.push(null);
      options.push(opts);
    }

    const current: (number | null)[] = new Array(n).fill(null);
    const walk = (s: number) => {
      if (s === n) {
        const played = current.filter((f): f is number => f !== null);
        if (played.length < minPlayed) return;
        // violão: cordas tocadas contíguas (sem abafar no meio)
        if (instrument === 'guitar') {
          const first = current.findIndex(f => f !== null);
          let last = n - 1;
          while (current[last] === null) last--;
          for (let i = first; i <= last; i++) if (current[i] === null) return;
          if ((open[first] + (current[first] as number)) % 12 !== parsed.root) return; // fundamental no grave
        }
        const pcs = new Set<number>();
        for (let i = 0; i < n; i++) {
          const f = current[i];
          if (f === null) continue;
          const pc = (open[i] + f) % 12;
          if (!allowedSet.has(pc)) return;
          pcs.add(pc);
        }
        for (const r of requiredPcs) if (!pcs.has(r)) return;
        const fretted = played.filter(f => f > 0);
        const maxF = fretted.length ? Math.max(...fretted) : 0;
        const minF = fretted.length ? Math.min(...fretted) : 0;
        const cost = maxF * 10 + (maxF - minF) * 3 + (n - played.length);
        if (!best || cost < best.cost) best = { cost, frets: current.slice() };
        return;
      }
      for (const o of options[s]) {
        current[s] = o;
        walk(s + 1);
      }
      current[s] = null;
    };
    walk(0);
  }

  if (!best) return null;
  return buildShape(instrument, (best as { frets: (number | null)[] }).frets, []);
}

type ChordParsedLike = Pick<ParsedChord, 'root' | 'quality'>;

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export function chordNotes(parsed: ParsedChord): string[] {
  const names = parsed.latin
    ? parsed.flats ? NAMES_LA_FLAT : NAMES_LA_SHARP
    : parsed.flats ? NAMES_EN_FLAT : NAMES_EN_SHARP;
  const out = QUALITY_TONES[parsed.quality].allowed.map(i => names[(parsed.root + i) % 12]);
  if (parsed.bass !== null) {
    const bassName = names[parsed.bass];
    if (!out.includes(bassName)) out.push(bassName);
  }
  return out;
}

const cache = new Map<string, ChordShapeResult>();

export function getChordShape(label: string, instrument: Instrument): ChordShapeResult {
  const key = `${instrument}|${label}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const parsed = parseChord(label);
  if (!parsed) {
    const miss: ChordShapeResult = { parsed: null, shape: null, notes: [], warning: 'Não consegui reconhecer este acorde.' };
    cache.set(key, miss);
    return miss;
  }

  const warnings: string[] = [];
  if (!parsed.exact) warnings.push('Variação não reconhecida: mostrando a forma mais próxima.');

  let shape: ChordShape | null = null;
  const fromTemplate = shapeFromTemplates(instrument, parsed);
  if (fromTemplate) {
    shape = fromTemplate.shape;
    if (parsed.bass !== null && !fromTemplate.bassMatched && parsed.bass !== parsed.root) {
      const names = parsed.latin
        ? parsed.flats ? NAMES_LA_FLAT : NAMES_LA_SHARP
        : parsed.flats ? NAMES_EN_FLAT : NAMES_EN_SHARP;
      warnings.push(`Baixo ${names[parsed.bass]}: toque essa nota no baixo (a forma mostra o acorde base).`);
    }
  } else {
    shape = shapeBySearch(instrument, parsed);
  }

  const result: ChordShapeResult = {
    parsed,
    shape,
    notes: chordNotes(parsed),
    warning: shape ? (warnings.join(' ') || undefined) : 'Sem desenho disponível para este tipo de acorde neste instrumento.'
  };
  cache.set(key, result);
  return result;
}

/** Utilitário para testes: notas (0–11) que a forma realmente toca. */
export function shapePitchClasses(shape: ChordShape): number[] {
  return pcsOf(shape.instrument, shape.frets).filter((p): p is number => p !== null);
}
