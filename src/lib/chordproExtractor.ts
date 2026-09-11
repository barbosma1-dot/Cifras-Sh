// Extração de cifras por COORDENADAS REAIS do PDF (não por imagem/IA visual).
//
// Isso é o equivalente em TypeScript do que a skill "chordpro-transcriber" faz
// em Python com `pdfplumber`: em vez de confiar no julgamento visual de um
// modelo de IA para decidir em qual sílaba cada acorde cai, usamos a posição
// x/y real de cada palavra no PDF (disponível via `page.getTextContent()` do
// pdf.js) para calcular isso matematicamente.
//
// Só funciona em páginas com camada de texto real (cifra "digital", com texto
// selecionável no PDF original). Páginas escaneadas/fotografadas não têm essa
// camada — para essas, `hasReliableTextLayer` retorna false e o chamador deve
// cair de volta no fluxo antigo (imagem + IA com visão).
//
// Assim como a skill original, este é um cálculo geométrico com heurísticas
// (tolerância de linha, limiar de "vão" entre colunas, etc.) — não é 100%
// infalível, mas é MUITO mais confiável do que pedir pra uma IA "olhar" a
// imagem e adivinhar a coluna, que era a causa mais comum de acorde
// deslocado nas extrações antigas.

export interface PdfWord {
  text: string;
  x0: number;
  x1: number;
  y: number;
}

export interface PdfLine {
  y: number;
  words: PdfWord[];
}

const Y_TOLERANCE = 2;

// Aumentado para conseguir associar corretamente linhas de acordes
// à linha de letra correspondente em PDFs de Laudes mais espaçados.
const MAX_PAIR_GAP = 36;

const ROOT = '[A-G](?:#|b|♯|♭)?';

const QUALITY =
  '(?:maj7|Maj7|MAJ7|m7b5|m7#5|dim7|sus2|sus4|add\\d{1,2}|maj|min|dim|aug|sus|add|no|[mM])?';

const EXTENSION = '(?:[#b]?\\d{1,2}){0,2}';

const EXTRA_MAJOR = '(?:M)?';

const DIM_SYMBOL = '(?:°|º|ø)?';

const ALTERATION =
  '(?:\\(\\s*[#b]?\\d{1,2}[+-]?\\s*\\)|[+-])?';

const BASS = `(?:\\/${ROOT}\\d{0,2})?`;

const CHORD_TOKEN_RE = new RegExp(
  `^\\(?${ROOT}${QUALITY}${EXTENSION}${EXTRA_MAJOR}${DIM_SYMBOL}${ALTERATION}${BASS}\\)?$`
);

const BAR_SYMBOL_RE = /^[|%]+$/;

function isChordToken(text: string): boolean {
  return CHORD_TOKEN_RE.test(text) || BAR_SYMBOL_RE.test(text);
}

function isLooseHyphen(text: string): boolean {
  return text === '-' || text === '–' || text === '—';
}

/**
 * Extrai as palavras de uma página do pdf.js com sua posição x0/x1/y real.
 */
export async function extractPageWords(
  page: any
): Promise<PdfWord[]> {
  const textContent = await page.getTextContent();

  const words: PdfWord[] = [];

  for (const item of textContent.items as any[]) {
    const str: string = item.str;

    if (!str || !str.trim()) continue;

    const x0 = item.transform[4];
    const y = item.transform[5];

    const totalWidth: number = item.width ?? 0;
    const totalLen = str.length || 1;

    const re = /\S+/g;

    let m: RegExpExecArray | null;

    while ((m = re.exec(str)) !== null) {
      const charStart = m.index;
      const charEnd = m.index + m[0].length;

      const wx0 =
        x0 + (charStart / totalLen) * totalWidth;

      const wx1 =
        x0 + (charEnd / totalLen) * totalWidth;

      words.push({
        text: m[0],
        x0: wx0,
        x1: wx1,
        y
      });
    }
  }

  return words;
}

/**
 * Heurística para decidir se a página possui camada de texto confiável.
 */
export function hasReliableTextLayer(
  words: PdfWord[]
): boolean {
  return words.length >= 15;
}

/**
 * Agrupa palavras em linhas.
 */
export function groupWordsIntoLines(
  words: PdfWord[]
): PdfLine[] {
  const sorted = [...words].sort(
    (a, b) => b.y - a.y || a.x0 - b.x0
  );

  const lines: PdfLine[] = [];

  for (const w of sorted) {
    let line = lines.find(
      l => Math.abs(l.y - w.y) <= Y_TOLERANCE
    );

    if (!line) {
      line = {
        y: w.y,
        words: []
      };

      lines.push(line);
    }

    line.words.push(w);
  }

  lines.sort((a, b) => b.y - a.y);

  for (const l of lines) {
    l.words.sort((a, b) => a.x0 - b.x0);
  }

  return lines;
}

function isChordLine(line: PdfLine): boolean {
  const relevant = line.words.filter(
    w => !isLooseHyphen(w.text)
  );

  if (relevant.length === 0) return false;

  const chordish = relevant.filter(
    w => isChordToken(w.text)
  );

  return (
    chordish.length / relevant.length >= 0.8
  );
}

/**
 * Funde uma linha de acordes com a linha de letra abaixo.
 */
export function mergeChordLyricLines(
  chordLine: PdfLine,
  lyricLine: PdfLine
): string {
  const lyricWords = lyricLine.words;

  const chordTokens = chordLine.words.filter(
    w => !isLooseHyphen(w.text)
  );

  const assignments = new Map<
    number,
    string[]
  >();

  for (const chord of chordTokens) {
    let idx = lyricWords.findIndex(
      w =>
        chord.x0 >= w.x0 &&
        chord.x0 < w.x1
    );

    if (idx === -1) {
      idx = lyricWords.findIndex(
        w => w.x0 >= chord.x0
      );
    }

    if (idx === -1) {
      idx = lyricWords.length - 1;
    }

    if (idx < 0) continue;

    if (!assignments.has(idx)) {
      assignments.set(idx, []);
    }

    assignments
      .get(idx)!
      .push(chord.text);
  }

  let result = '';

  lyricWords.forEach((w, i) => {
    const chords = assignments.get(i);

    if (chords && chords.length > 0) {
      result += `[${chords.join('-')}]`;
    }

    result += w.text;

    if (i < lyricWords.length - 1) {
      result += ' ';
    }
  });

  return result;
}

/**
 * Formata uma linha de acordes sem letra associada.
 */
export function formatInstrumentalLine(
  line: PdfLine
): string {
  const tokens = line.words.filter(
    w => !isLooseHyphen(w.text)
  );

  if (tokens.length === 0) return '';

  const AVG_CHAR_WIDTH = 6;

  let result = '';

  let lastEnd = tokens[0].x0;

  tokens.forEach((w, i) => {
    const gap =
      i === 0
        ? 0
        : Math.max(
            1,
            Math.round(
              (w.x0 - lastEnd) /
                AVG_CHAR_WIDTH
            )
          );

    result +=
      ' '.repeat(gap) +
      `[${w.text}]`;

    lastEnd = w.x1;
  });

  return result;
}

// Algumas linhas possuem letra e acordes misturados na mesma linha.
//
// Exemplo:
//
// "a F C/E D esposa do Cordeiro"
//
// vira:
//
// "a [F] [C/E] [D] esposa do Cordeiro"
//
// As raízes A e E isoladas são excluídas porque normalmente são
// artigos/conjunções em português.

const AMBIGUOUS_ALONE_ROOT = /^[AE]$/;

export function formatMixedTextLine(
  words: PdfWord[]
): string {
  return words
    .map(w =>
      isChordToken(w.text) &&
      !AMBIGUOUS_ALONE_ROOT.test(w.text)
        ? `[${w.text}]`
        : w.text
    )
    .join(' ')
    .trim();
}

/**
 * Extrai a primeira linha de letra real do conteúdo.
 */
export function extractFirstLyricLine(
  contentLines: string[]
): string {
  for (const raw of contentLines) {
    const plain = raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const lettersOnly = plain
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z]/g, '');

    if (lettersOnly.length < 2) {
      continue;
    }

    return plain.length > 50
      ? `${plain.slice(0, 50).trim()}…`
      : plain;
  }

  return '';
}

/**
 * Monta o texto ChordPro de uma página inteira.
 */
export function extractPageChordProText(
  lines: PdfLine[],
  pageWidth: number
): string {
  const mid = pageWidth / 2;

  const crossesMid = lines.some(l =>
    l.words.some(
      w =>
        w.x0 < mid - 10 &&
        w.x1 > mid + 10
    )
  );

  let orderedLines: PdfLine[];

  if (!crossesMid && lines.length > 4) {
    const left = lines
      .map(l => ({
        y: l.y,
        words: l.words.filter(
          w => w.x0 < mid
        )
      }))
      .filter(
        l => l.words.length > 0
      );

    const right = lines
      .map(l => ({
        y: l.y,
        words: l.words.filter(
          w => w.x0 >= mid
        )
      }))
      .filter(
        l => l.words.length > 0
      );

    orderedLines = [
      ...left,
      ...right
    ];
  } else {
    orderedLines = lines;
  }

  const outputLines: string[] = [];

  for (
    let i = 0;
    i < orderedLines.length;
    i++
  ) {
    const line = orderedLines[i];
    const next = orderedLines[i + 1];

    if (isChordLine(line)) {
      const gapToNext = next
        ? Math.abs(line.y - next.y)
        : Infinity;

      const pairsWithNext =
        !!next &&
        !isChordLine(next) &&
        gapToNext < MAX_PAIR_GAP;

      if (pairsWithNext) {
        outputLines.push(
          mergeChordLyricLines(
            line,
            next!
          )
        );

        i++;
      } else {
        outputLines.push(
          formatInstrumentalLine(line)
        );
      }
    } else {
      outputLines.push(
        formatMixedTextLine(
          line.words
        )
      );
    }
  }

  return outputLines.join('\n');
}

/**
 * Ponto de entrada para extração pré-alinhada.
 */
export async function extractPreAlignedPageText(
  page: any
): Promise<string | null> {
  const words =
    await extractPageWords(page);

  if (
    !hasReliableTextLayer(words)
  ) {
    return null;
  }

  const lines =
    groupWordsIntoLines(words);

  const view =
    page.view as number[];

  const pageWidth =
    view[2] - view[0];

  return extractPageChordProText(
    lines,
    pageWidth
  );
}

// ---------------------------------------------------------------------------
// MODO OFÍCIO/LAUDES
// ---------------------------------------------------------------------------

export interface LiturgySection {
  title: string;
  hasChords: boolean;
  contentLines: string[];
  isProperOfDay?: boolean;
}

const DAY_NAME_CANON: Record<
  string,
  string
> = {
  DOMINGO: 'Domingo',
  'SEGUNDA-FEIRA':
    'Segunda-feira',
  'TERÇA-FEIRA':
    'Terça-feira',
  'TERCA-FEIRA':
    'Terça-feira',
  'QUARTA-FEIRA':
    'Quarta-feira',
  'QUINTA-FEIRA':
    'Quinta-feira',
  'SEXTA-FEIRA':
    'Sexta-feira',
  'SÁBADO':
    'Sábado',
  SABADO:
    'Sábado'
};

function normalizeDayHeader(
  romanNumeral: string,
  dayName: string
): string {
  const canon =
    DAY_NAME_CANON[
      dayName.toUpperCase()
    ] || dayName;

  return `${romanNumeral.toUpperCase()} ${canon}`;
}

const HEADING_RE = {
  dayHeader:
    /^(I{1,3}|IV|VI{0,3}|V)\s+(DOMINGO|SEGUNDA-FEIRA|TER[ÇC]A-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|S[ÁA]BADO)\b(?:\s*[—–-].*)?\.?$/i,

  invitatorio:
    /^Invitat[oó]rio$/i,

  hino:
    /^Hino$/i,

  salmodia:
    /^Salmodia$/i,

  salmo:
    /^Salmo\s+\d/i,

  canticoEvangelico:
    /^C[âa]ntico\s+evang[eé]lico\b/i,

  cantico:
    /^C[âa]ntico\b/i,

  leitura:
    /^Leitura breve\b/i,

  responsorio:
    /^Respons[oó]rio breve\b/i,

  preces:
    /^Preces$/i,

  oracao:
    /^Ora[cç][ãa]o$/i,

  antifona:
    /^Ant\.?\s*\d*\b/i,

  altVersion:
    /^\(\s*\d+[ªa]\s*(op[cç][ãa]o|melodia)\s*\)$/i
};

function isAnyHeadingLine(
  text: string
): boolean {
  return Object.values(
    HEADING_RE
  ).some(re => re.test(text));
}

export interface LiturgyPageResult {
  sections: LiturgySection[];

  dayTitle: string | null;

  pendingAntiphon: string[];
}

export function segmentLiturgyOfHoursPage(
  lines: PdfLine[],
  pageWidth: number,
  carryOverSection?: {
    title: string;
    hasChords: boolean;
  } | null,
  carryOverDayTitle?: string | null,
  carryOverPendingAntiphon?:
    | string[]
    | null
): LiturgyPageResult {
  const mid = pageWidth / 2;

  const crossesMid = lines.some(
    l =>
      l.words.some(
        w =>
          w.x0 < mid - 10 &&
          w.x1 > mid + 10
      )
  );

  let orderedLines: PdfLine[];

  if (
    !crossesMid &&
    lines.length > 4
  ) {
    const left = lines
      .map(l => ({
        y: l.y,
        words: l.words.filter(
          w => w.x0 < mid
        )
      }))
      .filter(
        l => l.words.length > 0
      );

    const right = lines
      .map(l => ({
        y: l.y,
        words: l.words.filter(
          w => w.x0 >= mid
        )
      }))
      .filter(
        l => l.words.length > 0
      );

    orderedLines = [
      ...left,
      ...right
    ];
  } else {
    orderedLines = lines;
  }

  const sections: LiturgySection[] =
    [];

  let current:
    | LiturgySection
    | null = carryOverSection
    ? {
        title:
          carryOverSection.title,
        hasChords:
          carryOverSection.hasChords,
        contentLines: []
      }
    : null;

  let currentIsPsalmType =
    carryOverSection?.hasChords ??
    false;

  let bodyStarted =
    !!carryOverSection;

  let pendingAntiphonLines:
    string[] =
    carryOverPendingAntiphon
      ? [
          ...carryOverPendingAntiphon
        ]
      : [];

  // IMPORTANTE:
  //
  // Não descartamos mais versões alternativas.
  //
  // Antes existia uma lógica com `skippingAltVersion`
  // que fazia a segunda opção de melodia desaparecer.
  //
  // Agora todas as opções encontradas no PDF são preservadas
  // dentro da mesma peça.
  let checkNextLineForSubtitle =
    false;

  let dayTitle:
    | string
    | null =
    carryOverDayTitle ?? null;

  const closeCurrent = () => {
    if (
      current &&
      current.contentLines.length > 0
    ) {
      sections.push(current);
    }

    current = null;

    bodyStarted = false;

    currentIsPsalmType =
      false;

    checkNextLineForSubtitle =
      false;
  };

  const startSection = (
    title: string,
    isPsalmType: boolean,
    isProperOfDay = false
  ) => {
    closeCurrent();

    current = {
      title,
      hasChords: isPsalmType,
      contentLines: [],
      isProperOfDay
    };

    if (
      isPsalmType &&
      pendingAntiphonLines.length >
        0
    ) {
      current.contentLines.push(
        ...pendingAntiphonLines
      );

      pendingAntiphonLines = [];
    }

    currentIsPsalmType =
      isPsalmType;

    bodyStarted = false;

    checkNextLineForSubtitle =
      isPsalmType;
  };

  for (
    let i = 0;
    i < orderedLines.length;
    i++
  ) {
    const line =
      orderedLines[i];

    const next =
      orderedLines[i + 1];

    const plainText =
      line.words
        .map(w => w.text)
        .join(' ')
        .trim();

    const chordLine =
      isChordLine(line);

    if (!chordLine) {
      const dayMatch =
        plainText.match(
          HEADING_RE.dayHeader
        );

      if (dayMatch) {
        dayTitle =
          normalizeDayHeader(
            dayMatch[1],
            dayMatch[2]
          );

        continue;
      }
    }

    if (
      !chordLine &&
      HEADING_RE.salmodia.test(
        plainText
      )
    ) {
      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.invitatorio.test(
        plainText
      )
    ) {
      startSection(
        'Invitatório',
        false
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.hino.test(
        plainText
      )
    ) {
      startSection(
        'Hino',
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.salmo.test(
        plainText
      )
    ) {
      startSection(
        plainText
          .split(',')[0]
          .trim(),
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.canticoEvangelico.test(
        plainText
      )
    ) {
      startSection(
        plainText,
        true,
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.cantico.test(
        plainText
      )
    ) {
      startSection(
        plainText,
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.leitura.test(
        plainText
      )
    ) {
      startSection(
        plainText,
        false,
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.responsorio.test(
        plainText
      )
    ) {
      startSection(
        plainText,
        false,
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.preces.test(
        plainText
      )
    ) {
      startSection(
        'Preces',
        false,
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.oracao.test(
        plainText
      )
    ) {
      startSection(
        'Oração',
        false,
        true
      );

      continue;
    }

    if (
      !chordLine &&
      HEADING_RE.antifona.test(
        plainText
      )
    ) {
      if (
        currentIsPsalmType &&
        bodyStarted
      ) {
        current!.contentLines.push(
          formatMixedTextLine(
            line.words
          )
        );

        closeCurrent();
      } else {
        pendingAntiphonLines.push(
          formatMixedTextLine(
            line.words
          )
        );
      }

      continue;
    }

    // ============================================================
    // OPÇÕES EXTRAS DE MELODIA
    // ============================================================
    //
    // Antes desta correção, existia uma lógica que fazia:
    //
    //   primeira opção -> mantém
    //   segunda opção -> começa a descartar
    //   terceira opção -> também descarta
    //
    // Isso fazia desaparecer as melodias alternativas do PDF.
    //
    // Agora o marcador é preservado e o conteúdo seguinte continua
    // pertencendo à mesma peça.
    //
    // Exemplo:
    //
    // (2ª Opção)
    //
    // G       B7    C
    // Ó Pai, dá-me...
    //
    // fica dentro do mesmo Salmo/Hino.
    //
    if (
      !chordLine &&
      HEADING_RE.altVersion.test(
        plainText
      )
    ) {
      if (current) {
        current.contentLines.push(
          formatMixedTextLine(
            line.words
          )
        );

        bodyStarted = true;
      }

      continue;
    }

    // Uma linha de subtítulo temático pode vir logo após o cabeçalho
    // "Salmo N"/"Cântico" e antes do corpo cifrado.
    if (
      checkNextLineForSubtitle
    ) {
      checkNextLineForSubtitle =
        false;

      if (
        !chordLine &&
        next &&
        isChordLine(next)
      ) {
        continue;
      }
    }

    if (!current) {
      continue;
    }

    if (chordLine) {
      const gapToNext = next
        ? Math.abs(
            line.y - next.y
          )
        : Infinity;

      const nextPlainText =
        next
          ? next.words
              .map(w => w.text)
              .join(' ')
              .trim()
          : '';

      const nextIsHeading =
        !!next &&
        !isChordLine(next) &&
        isAnyHeadingLine(
          nextPlainText
        );

      const pairsWithNext =
        !!next &&
        !isChordLine(next) &&
        gapToNext <
          MAX_PAIR_GAP &&
        !nextIsHeading;

      if (pairsWithNext) {
        current.contentLines.push(
          mergeChordLyricLines(
            line,
            next!
          )
        );

        i++;
      } else {
        current.contentLines.push(
          formatInstrumentalLine(
            line
          )
        );
      }

      bodyStarted = true;
    } else {
      current.contentLines.push(
        formatMixedTextLine(
          line.words
        )
      );

      bodyStarted = true;
    }
  }

  closeCurrent();

  return {
    sections,
    dayTitle,
    pendingAntiphon:
      pendingAntiphonLines
  };
}
