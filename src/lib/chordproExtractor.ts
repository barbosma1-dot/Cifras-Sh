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

// Espaçamento máximo entre uma linha de acordes e a linha de letra
// correspondente.
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
 * Extrai as palavras da camada de texto do PDF com suas coordenadas reais.
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
 * Verifica se existe uma camada de texto suficientemente confiável.
 */
export function hasReliableTextLayer(
  words: PdfWord[]
): boolean {
  return words.length >= 15;
}

/**
 * Agrupa palavras por linha usando somente a coordenada vertical (sem
 * nenhuma noção de coluna). Usada como etapa interna por
 * groupWordsIntoLines — nunca chamar diretamente de fora deste arquivo
 * quando a página tem duas colunas, ou o bug abaixo volta.
 */
function groupWordsByYOnly(
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

/**
 * Mesma heurística usada por orderTwoColumnPage para reconhecer um
 * cabeçalho/título centralizado que atravessa visualmente as duas colunas.
 * Extraída para função própria porque agora ela também é usada ANTES do
 * agrupamento em colunas (ver groupWordsIntoLines) — as duas etapas
 * precisam concordar sobre o que é "linha central", ou o cabeçalho é
 * partido ao meio numa etapa e reconhecido inteiro na outra.
 */
function isSpanningLine(
  line: PdfLine,
  pageWidth: number
): boolean {
  if (!line.words.length) return false;

  const mid = pageWidth / 2;

  const minX = Math.min(
    ...line.words.map(w => w.x0)
  );

  const maxX = Math.max(
    ...line.words.map(w => w.x1)
  );

  const center = (minX + maxX) / 2;

  return (
    minX < mid - 65 &&
    maxX > mid + 65 &&
    Math.abs(center - mid) <
      Math.max(75, pageWidth * 0.14)
  );
}

/**
 * Agrupa palavras por linha.
 *
 * CORREÇÃO CRÍTICA (bug do "Ant./T.P. misturado com o salmo errado"):
 *
 * Antes, esta função agrupava TODAS as palavras da página por y, sem
 * nenhuma noção de coluna. Numa página de duas colunas, uma palavra da
 * coluna esquerda e uma da coluna direita na MESMA altura (y) caíam na
 * MESMA linha — o texto da coluna esquerda e da coluna direita ficavam
 * literalmente fundidos numa linha só (ex.: "Jerusalém; ... - ele faz
 * cair a neve como lã", misturando a antífona da esquerda com o versículo
 * do salmo da direita). orderTwoColumnPage() só reordena LINHAS inteiras
 * entre coluna esquerda/direita — ela não sabe (nem pode) desfazer uma
 * fusão que já aconteceu dentro de uma única linha.
 *
 * Agora, quando pageWidth é informado:
 * 1. as palavras são pré-agrupadas por y só para achar cabeçalhos/títulos
 *    centralizados (mesma regra de orderTwoColumnPage);
 * 2. as palavras restantes são divididas em coluna esquerda/direita PELO
 *    PRÓPRIO CENTRO DA PALAVRA (não da linha, que ainda não existe);
 * 3. cada coluna é agrupada por y SEPARADAMENTE — então uma linha nunca
 *    mistura palavras das duas colunas.
 *
 * pageWidth é opcional só para não quebrar chamadas antigas — sempre que
 * a página puder ter duas colunas, passe pageWidth.
 */
export function groupWordsIntoLines(
  words: PdfWord[],
  pageWidth?: number
): PdfLine[] {
  const rawLines = groupWordsByYOnly(words);

  if (pageWidth == null) {
    return rawLines;
  }

  const mid = pageWidth / 2;

  const spanningWords: PdfWord[] = [];
  const columnWords: PdfWord[] = [];

  for (const line of rawLines) {
    if (isSpanningLine(line, pageWidth)) {
      spanningWords.push(...line.words);
    } else {
      columnWords.push(...line.words);
    }
  }

  const leftWords = columnWords.filter(
    w => (w.x0 + w.x1) / 2 < mid
  );

  const rightWords = columnWords.filter(
    w => (w.x0 + w.x1) / 2 >= mid
  );

  return [
    ...groupWordsByYOnly(spanningWords),
    ...groupWordsByYOnly(leftWords),
    ...groupWordsByYOnly(rightWords)
  ];
}

/**
 * NOVA CORREÇÃO:
 *
 * Organiza corretamente uma página de PDF com duas colunas.
 *
 * O problema anterior era que uma linha centralizada do cabeçalho podia
 * atravessar o meio da página. Isso fazia o algoritmo concluir que a página
 * não possuía duas colunas e então misturava:
 *
 * coluna esquerda
 * coluna direita
 * coluna esquerda
 * coluna direita
 *
 * Agora:
 *
 * 1. linhas realmente centralizadas são separadas;
 * 2. coluna esquerda é processada inteira;
 * 3. coluna direita é processada inteira.
 *
 * Isso é especialmente importante nos PDFs de Laudes enviados.
 */
function orderTwoColumnPage(
  lines: PdfLine[],
  pageWidth: number
): PdfLine[] {
  const mid = pageWidth / 2;

  const spanning: PdfLine[] = [];
  const left: PdfLine[] = [];
  const right: PdfLine[] = [];

  for (const line of lines) {
    if (!line.words.length) continue;

    if (isSpanningLine(line, pageWidth)) {
      spanning.push(line);
      continue;
    }

    const minX = Math.min(
      ...line.words.map(w => w.x0)
    );

    const maxX = Math.max(
      ...line.words.map(w => w.x1)
    );

    const lineCenter =
      (minX + maxX) / 2;

    if (lineCenter < mid) {
      left.push(line);
    } else {
      right.push(line);
    }
  }

  spanning.sort(
    (a, b) => b.y - a.y
  );

  left.sort(
    (a, b) => b.y - a.y
  );

  right.sort(
    (a, b) => b.y - a.y
  );

  /*
   * Ordem final:
   *
   * cabeçalhos centralizados
   * coluna esquerda
   * coluna direita
   */
  return [
    ...spanning,
    ...left,
    ...right
  ];
}

function isChordLine(
  line: PdfLine
): boolean {
  const relevant =
    line.words.filter(
      w => !isLooseHyphen(w.text)
    );

  if (relevant.length === 0) {
    return false;
  }

  const chordish =
    relevant.filter(
      w => isChordToken(w.text)
    );

  return (
    chordish.length /
      relevant.length >=
    0.8
  );
}

/**
 * Junta uma linha de acordes com a linha de letra.
 */
export function mergeChordLyricLines(
  chordLine: PdfLine,
  lyricLine: PdfLine
): string {
  const lyricWords =
    lyricLine.words;

  const chordTokens =
    chordLine.words.filter(
      w => !isLooseHyphen(w.text)
    );

  const assignments =
    new Map<number, string[]>();

  for (const chord of chordTokens) {
    let idx =
      lyricWords.findIndex(
        w =>
          chord.x0 >= w.x0 &&
          chord.x0 < w.x1
      );

    if (idx === -1) {
      idx =
        lyricWords.findIndex(
          w =>
            w.x0 >= chord.x0
        );
    }

    if (idx === -1) {
      idx =
        lyricWords.length - 1;
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

  lyricWords.forEach(
    (w, i) => {
      const chords =
        assignments.get(i);

      if (
        chords &&
        chords.length > 0
      ) {
        result +=
          `[${chords.join('-')}]`;
      }

      result += w.text;

      if (
        i <
        lyricWords.length - 1
      ) {
        result += ' ';
      }
    }
  );

  return result;
}

/**
 * Formata uma linha que possui apenas acordes.
 */
export function formatInstrumentalLine(
  line: PdfLine
): string {
  const tokens =
    line.words.filter(
      w => !isLooseHyphen(w.text)
    );

  if (tokens.length === 0) {
    return '';
  }

  const AVG_CHAR_WIDTH = 6;

  let result = '';

  let lastEnd =
    tokens[0].x0;

  tokens.forEach(
    (w, i) => {
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
    }
  );

  return result;
}

/**
 * Formata uma linha que possui texto e acordes misturados.
 */
const AMBIGUOUS_ALONE_ROOT =
  /^[AE]$/;

export function formatMixedTextLine(
  words: PdfWord[]
): string {
  return words
    .map(w =>
      isChordToken(w.text) &&
      !AMBIGUOUS_ALONE_ROOT.test(
        w.text
      )
        ? `[${w.text}]`
        : w.text
    )
    .join(' ')
    .trim();
}

/**
 * Extrai a primeira linha de letra real.
 */
export function extractFirstLyricLine(
  contentLines: string[]
): string {
  for (
    const raw of contentLines
  ) {
    const plain = raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const lettersOnly = plain
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .replace(
        /[^a-zA-Z]/g,
        ''
      );

    if (
      lettersOnly.length < 2
    ) {
      continue;
    }

    return plain.length > 50
      ? `${plain
          .slice(0, 50)
          .trim()}…`
      : plain;
  }

  return '';
}

/**
 * Extrai uma página inteira no formato ChordPro.
 */
export function extractPageChordProText(
  lines: PdfLine[],
  pageWidth: number
): string {
  const orderedLines =
    lines.length > 4
      ? orderTwoColumnPage(
          lines,
          pageWidth
        )
      : [...lines].sort(
          (a, b) =>
            b.y - a.y
        );

  const outputLines: string[] = [];

  for (
    let i = 0;
    i < orderedLines.length;
    i++
  ) {
    const line =
      orderedLines[i];

    const next =
      orderedLines[i + 1];

    if (isChordLine(line)) {
      const gapToNext =
        next
          ? Math.abs(
              line.y - next.y
            )
          : Infinity;

      const pairsWithNext =
        !!next &&
        !isChordLine(next) &&
        gapToNext <
          MAX_PAIR_GAP;

      if (pairsWithNext) {
        outputLines.push(
          mergeChordLyricLines(
            line,
            next
          )
        );

        i++;
      } else {
        outputLines.push(
          formatInstrumentalLine(
            line
          )
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
 * Entrada principal da extração pré-alinhada.
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

  const view =
    page.view as number[];

  const pageWidth =
    view[2] - view[0];

  const lines =
    groupWordsIntoLines(words, pageWidth);

  return extractPageChordProText(
    lines,
    pageWidth
  );
}

// ---------------------------------------------------------------------------
// MODO OFÍCIO / LAUDES
// ---------------------------------------------------------------------------

export interface LiturgySection {
  title: string;
  hasChords: boolean;
  contentLines: string[];
  isProperOfDay?: boolean;
}

const DAY_NAME_CANON:
  Record<string, string> = {
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
    /^\(?\s*\d+[ºª°a]?\s*(op[cç][ãa]o|melodia)\s*\)?$/i,

  optionNamed:
    /^\(?\s*(?:Op[cç][ãa]o\s+[^()]+?|Miserere(?:\s*\(\s*Salmo\s*50(?:\(51\))?\s*\))?)\s*\)?$/i,

  extraMelodyTitle:
    /^Op[cç][õo]es\s+extras\s+de\s+melodia/i
};

function isAnyHeadingLine(
  text: string
): boolean {
  return Object.values(
    HEADING_RE
  ).some(re =>
    re.test(text)
  );
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
  /*
   * CORREÇÃO PRINCIPAL PARA LAUDES:
   *
   * Nunca mais usamos uma linha centralizada do cabeçalho para decidir
   * que a página inteira possui uma única coluna.
   */
  const orderedLines =
    lines.length > 4
      ? orderTwoColumnPage(
          lines,
          pageWidth
        )
      : [...lines].sort(
          (a, b) =>
            b.y - a.y
        );

  const sections:
    LiturgySection[] = [];

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

  /*
   * TODAS as versões de melodia são preservadas.
   *
   * Não existe mais nenhuma lógica que descarte a segunda,
   * terceira ou demais opções.
   */
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

      hasChords:
        isPsalmType,

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
      HEADING_RE.extraMelodyTitle.test(
        plainText
      )
    ) {
      continue;
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

    /*
     * Miserere pertence ao Salmo 50 e é preservado como
     * alternativa dentro do mesmo canto.
     */
    if (
      !chordLine &&
      /^Miserere\s*\(\s*Salmo\s*50(?:\(51\))?\s*\)$/i.test(
        plainText
      )
    ) {
      if (
        current &&
        /^Salmo\s*50/i.test(
          current.title
        )
      ) {
        current.contentLines.push(
          `— ${plainText} —`
        );

        bodyStarted = true;
      } else {
        startSection(
          'Salmo 50(51)',
          true
        );

        current!.contentLines.push(
          `— ${plainText} —`
        );

        bodyStarted = true;
      }

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

    /*
     * ============================================================
     * TODAS AS OPÇÕES DE MELODIA
     * ============================================================
     *
     * Exemplos presentes nos PDFs:
     *
     * (1º Opção)
     * (2º Opção)
     * (2ª Opção)
     * Opção Canto 34 e 600
     * Miserere (Salmo 50)
     *
     * Elas ficam dentro do mesmo canto.
     */
    if (
      !chordLine &&
      (
        HEADING_RE.altVersion.test(
          plainText
        ) ||
        HEADING_RE.optionNamed.test(
          plainText
        )
      )
    ) {
      if (current) {
        current.contentLines.push(
          `— ${plainText
            .replace(
              /^\(|\)$/g,
              ''
            )
            .trim()} —`
        );

        bodyStarted = true;
      }

      continue;
    }

    /*
     * Subtítulo que aparece entre o título e o corpo cifrado.
     */
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
      const gapToNext =
        next
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
