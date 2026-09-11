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
const MAX_PAIR_GAP = 44;

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

function getLineText(line: PdfLine): string {
  return line.words.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim();
}

function isPageNumberLine(line: PdfLine): boolean {
  const text = getLineText(line);
  return /^\d{1,3}$/.test(text);
}

function isLaudesHeaderFragment(text: string): boolean {
  return /^[-—–]\s*LAUDES\s*$/i.test(text);
}

function isDayHeaderBase(text: string): RegExpMatchArray | null {
  return text.match(
    /^(I{1,3}|IV|VI{0,3}|V)\s+(DOMINGO|SEGUNDA-FEIRA|TER[ÇC]A-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|S[ÁA]BADO)\s*$/i
  );
}

function isLikelyColumnLine(line: PdfLine, pageWidth: number): 'left' | 'right' | null {
  if (!line.words.length) return null;

  const mid = pageWidth / 2;
  const minX = Math.min(...line.words.map(w => w.x0));
  const maxX = Math.max(...line.words.map(w => w.x1));
  const center = (minX + maxX) / 2;

  // Zona central: linhas curtas/centralizadas não são evidência de coluna.
  const centralMargin = Math.max(35, pageWidth * 0.06);

  if (center < mid - centralMargin) return 'left';
  if (center > mid + centralMargin) return 'right';

  return null;
}

function hasStrongTwoColumnEvidence(
  lines: PdfLine[],
  pageWidth: number
): boolean {
  const candidates = lines
    .filter(line => line.words.length > 0 && !isSpanningLine(line, pageWidth))
    .map(line => ({
      line,
      side: isLikelyColumnLine(line, pageWidth)
    }))
    .filter(
      (item): item is { line: PdfLine; side: 'left' | 'right' } =>
        item.side !== null
    )
    .sort((a, b) => b.line.y - a.line.y);

  const leftYs = candidates
    .filter(item => item.side === 'left')
    .map(item => item.line.y);

  const rightYs = candidates
    .filter(item => item.side === 'right')
    .map(item => item.line.y);

  // Uma coluna real deve apresentar várias linhas dos dois lados,
  // distribuídas verticalmente. Uma ou duas linhas curtas não bastam.
  if (leftYs.length < 3 || rightYs.length < 3) return false;

  const yMin = Math.min(...candidates.map(item => item.line.y));
  const yMax = Math.max(...candidates.map(item => item.line.y));
  const yRange = Math.abs(yMax - yMin);

  if (yRange < 80) return false;

  const distinctLeftBands = new Set(
    leftYs.map(y => Math.round(y / 20))
  ).size;
  const distinctRightBands = new Set(
    rightYs.map(y => Math.round(y / 20))
  ).size;

  if (distinctLeftBands < 3 || distinctRightBands < 3) {
    return false;
  }

  //
  // GUARD RAIL CRÍTICO — não confundir uma única coluna com linhas
  // alternadas de acorde/lettura com uma página de duas colunas.
  //
  // No padrão problemático do PDF, a linha curta de acordes fica mais à
  // esquerda e a linha de letra correspondente, mais comprida, fica mais
  // à direita. Se classificarmos apenas pelo centro X, teremos algo como:
  //
  //   left(chord) -> right(lyric) -> left(chord) -> right(lyric) ...
  //
  // Ou o inverso. Isso é uma sequência vertical alternada, e não dois
  // blocos de texto paralelos. Antes de aceitar duas colunas, procuramos
  // esse padrão explicitamente.
  //
  // A verificação é deliberadamente conservadora: só rejeita a hipótese
  // de duas colunas quando há pelo menos 3 pares consecutivos alternados,
  // cada par está suficientemente próximo no eixo Y para ser uma linha
  // de acorde seguida da respectiva letra, e a alternância representa a
  // maior parte das transições observadas. Em uma página real de duas
  // colunas, o conteúdo de uma coluna tende a formar sequências verticais
  // consecutivas e não uma cadeia acorde/lettura alternada.
  //
  let alternatingPairs = 0;
  let chordLyricAlternatingPairs = 0;
  let alternatingTransitions = 0;

  for (let i = 0; i < candidates.length - 1; i++) {
    const current = candidates[i];
    const next = candidates[i + 1];
    const gap = Math.abs(current.line.y - next.line.y);

    if (current.side !== next.side && gap <= MAX_PAIR_GAP) {
      alternatingTransitions++;

      const currentIsChord = isChordLine(current.line);
      const nextIsChord = isChordLine(next.line);
      const currentHasLyrics = hasLyricText(current.line);
      const nextHasLyrics = hasLyricText(next.line);

      if (
        (currentIsChord && !nextIsChord && nextHasLyrics) ||
        (nextIsChord && !currentIsChord && currentHasLyrics)
      ) {
        chordLyricAlternatingPairs++;
      }
    }
  }

  if (
    chordLyricAlternatingPairs >= 3 &&
    chordLyricAlternatingPairs >= candidates.length * 0.35 &&
    alternatingTransitions >= chordLyricAlternatingPairs
  ) {
    return false;
  }

  // Também detecta o padrão alternado mesmo quando a camada de texto não
  // permite classificar todos os pares como acorde/lettura (por exemplo,
  // acordes muito curtos ou palavras que parecem acordes). Exigimos uma
  // alternância muito forte e ausência de blocos de 3 linhas consecutivas
  // do mesmo lado.
  let longestSameSideRun = 1;
  let currentSameSideRun = 1;
  let sideChanges = 0;

  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].side === candidates[i - 1].side) {
      currentSameSideRun++;
      longestSameSideRun = Math.max(
        longestSameSideRun,
        currentSameSideRun
      );
    } else {
      currentSameSideRun = 1;
      sideChanges++;
    }
  }

  const transitionCount = Math.max(1, candidates.length - 1);
  const alternationRatio = sideChanges / transitionCount;

  if (
    longestSameSideRun <= 2 &&
    alternationRatio >= 0.75 &&
    alternatingTransitions >= 5
  ) {
    return false;
  }

  // Exige presença dos dois lados em uma parte substancial da altura.
  const overlapMin = Math.max(
    Math.min(...leftYs),
    Math.min(...rightYs)
  );
  const overlapMax = Math.min(
    Math.max(...leftYs),
    Math.max(...rightYs)
  );

  return Math.abs(overlapMax - overlapMin) >= yRange * 0.35;
}

function filterNonContentLines(lines: PdfLine[]): PdfLine[] {
  return lines.filter(line => !isPageNumberLine(line));
}

function hasLyricText(line: PdfLine): boolean {
  const text = getLineText(line)
    .replace(/\[[^\]]*\]/g, '')
    .trim();

  return /[A-Za-zÀ-ÿ]/.test(text);
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

  // Só dividimos palavras em colunas quando a página demonstra, de fato,
  // uma estrutura consistente de duas colunas. Isso evita embaralhar
  // páginas de uma coluna com títulos centralizados ou linhas curtas.
  if (!hasStrongTwoColumnEvidence(rawLines, pageWidth)) {
    return rawLines;
  }

  const separatedLines: PdfLine[] = [];

  /*
   * IMPORTANTE: a detecção de duas colunas deve separar as palavras para
   * impedir que duas colunas na mesma altura sejam fundidas, mas NÃO deve
   * reordenar a sequência aqui.
   *
   * A ordem original (Y descrescente, X crescente) é preservada nesta etapa.
   * Isso é essencial para que o pareamento acorde -> letra possa ser feito
   * antes da eventual remontagem esquerda -> direita feita por
   * orderTwoColumnPage().
   */
  for (const line of rawLines) {
    if (isSpanningLine(line, pageWidth)) {
      separatedLines.push({
        y: line.y,
        words: [...line.words].sort((a, b) => a.x0 - b.x0)
      });
      continue;
    }

    const side = isLikelyColumnLine(line, pageWidth);

    if (side !== null) {
      separatedLines.push({
        y: line.y,
        words: [...line.words].sort((a, b) => a.x0 - b.x0)
      });
    } else {
      // Linha central curta/ambígua: mantém-na inteira.
      separatedLines.push({
        y: line.y,
        words: [...line.words].sort((a, b) => a.x0 - b.x0)
      });
    }
  }

  return separatedLines.sort(
    (a, b) => b.y - a.y || a.words[0]?.x0 - b.words[0]?.x0
  );
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
  const cleanLines = filterNonContentLines(lines);

  // Conservador: sem evidência forte, a ordem original por Y é a mais
  // segura para páginas de coluna única.
  if (!hasStrongTwoColumnEvidence(cleanLines, pageWidth)) {
    return [...cleanLines].sort(
      (a, b) => b.y - a.y
    );
  }

  const spanning: PdfLine[] = [];
  const left: PdfLine[] = [];
  const right: PdfLine[] = [];

  for (const line of cleanLines) {
    if (!line.words.length) continue;

    if (isSpanningLine(line, pageWidth)) {
      spanning.push(line);
      continue;
    }

    const side = isLikelyColumnLine(line, pageWidth);

    if (side === 'left') {
      left.push(line);
    } else if (side === 'right') {
      right.push(line);
    } else {
      // Linha central curta/ambígua: não inventa uma coluna.
      spanning.push(line);
    }
  }

  spanning.sort((a, b) => b.y - a.y);
  left.sort((a, b) => b.y - a.y);
  right.sort((a, b) => b.y - a.y);

  return [
    ...spanning,
    ...left,
    ...right
  ];
}

function isChordLine(
  line: PdfLine
): boolean {
  const relevant = line.words.filter(
    w => !isLooseHyphen(w.text)
  );

  if (relevant.length === 0) {
    return false;
  }

  const chordish = relevant.filter(
    w => isChordToken(w.text)
  );

  if (chordish.length === 0) {
    return false;
  }

  // Linhas com vários tokens exigem maioria clara de acordes. Para uma
  // linha de um único token, só aceitamos um acorde inequívoco.
  if (relevant.length === 1) {
    return !AMBIGUOUS_ALONE_ROOT.test(
      relevant[0].text
    );
  }

  return (
    chordish.length >= 2 &&
    chordish.length / relevant.length >= 0.6
  );
}

/**
 * Junta uma linha de acordes com a linha de letra.
 */
export function mergeChordLyricLines(
  chordLine: PdfLine,
  lyricLine: PdfLine
): string {
  const lyricWords = lyricLine.words;

  if (lyricWords.length === 0) {
    // Não perde a linha de acordes se o PDF não tiver palavras de letra.
    return formatInstrumentalLine(chordLine);
  }

  const chordTokens = chordLine.words.filter(
    w => !isLooseHyphen(w.text)
  );

  const assignments = new Map<number, string[]>();

  for (const chord of chordTokens) {
    let bestIndex = -1;
    let bestDistance = Infinity;

    // Primeiro tenta sobreposição horizontal real; se não houver, escolhe
    // a palavra de letra mais próxima do ponto inicial do acorde.
    lyricWords.forEach((word, index) => {
      const overlaps =
        chord.x0 <= word.x1 &&
        chord.x1 >= word.x0;

      const distance = overlaps
        ? 0
        : chord.x0 < word.x0
          ? word.x0 - chord.x0
          : chord.x0 - word.x1;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    if (bestIndex < 0) continue;

    if (!assignments.has(bestIndex)) {
      assignments.set(bestIndex, []);
    }

    assignments
      .get(bestIndex)!
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

  return result.trim();
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
  const cleanLines = filterNonContentLines(lines);

  const orderedLines =
    orderTwoColumnPage(
      cleanLines,
      pageWidth
    );

  /*
   * O pareamento acorde <-> letra é calculado ANTES da reordenação por
   * colunas, usando exclusivamente a geometria original da página.
   *
   * Em uma página de uma coluna isso preserva o padrão:
   *
   *   acorde (Y maior)
   *   letra  (Y menor)
   *
   * Mesmo que o centro X da letra esteja do outro lado do meio da página.
   *
   * Em uma página de duas colunas reais, linhas que estejam na mesma altura
   * não podem formar um par porque o gap vertical precisa ser positivo e a
   * compatibilidade horizontal impede o cruzamento de colunas.
   */
  const originalLines = [...cleanLines].sort(
    (a, b) =>
      b.y - a.y ||
      (a.words[0]?.x0 ?? 0) -
        (b.words[0]?.x0 ?? 0)
  );

  const originalPairForChord =
    new Map<PdfLine, PdfLine>();

  for (let j = 0; j < originalLines.length - 1; j++) {
    const chord = originalLines[j];
    const lyric = originalLines[j + 1];

    if (
      !isChordLine(chord) ||
      isChordLine(lyric) ||
      !hasLyricText(lyric)
    ) {
      continue;
    }

    const gap = chord.y - lyric.y;

    if (
      gap <= 0 ||
      gap > MAX_PAIR_GAP
    ) {
      continue;
    }

    const chordMinX = Math.min(
      ...chord.words.map(w => w.x0)
    );
    const chordMaxX = Math.max(
      ...chord.words.map(w => w.x1)
    );
    const lyricMinX = Math.min(
      ...lyric.words.map(w => w.x0)
    );
    const lyricMaxX = Math.max(
      ...lyric.words.map(w => w.x1)
    );

    const horizontalDistance =
      chordMaxX < lyricMinX
        ? lyricMinX - chordMaxX
        : lyricMaxX < chordMinX
          ? chordMinX - lyricMaxX
          : 0;

    const maxHorizontalDistance =
      Math.max(
        120,
        pageWidth * 0.08
      );

    if (
      horizontalDistance <=
      maxHorizontalDistance
    ) {
      originalPairForChord.set(
        chord,
        lyric
      );
    }
  }

  const outputLines: string[] = [];
  const consumedLyricLines =
    new Set<PdfLine>();

  for (
    let i = 0;
    i < orderedLines.length;
    i++
  ) {
    const line =
      orderedLines[i];

    if (consumedLyricLines.has(line)) {
      continue;
    }

    if (isChordLine(line)) {
      const pairedLyric =
        originalPairForChord.get(line);

      if (
        pairedLyric &&
        !consumedLyricLines.has(
          pairedLyric
        )
      ) {
        outputLines.push(
          mergeChordLyricLines(
            line,
            pairedLyric
          )
        );
        consumedLyricLines.add(
          pairedLyric
        );
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
    /^(I{1,3}|IV|VI{0,3}|V)\s+(DOMINGO|SEGUNDA-FEIRA|TER[ÇC]A-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|S[ÁA]BADO)\b(?:\s*[—–-]\s*LAUDES)?\s*\.?$/i,

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
    /^Op[cç][õo]es\s+extras\s+de\s+melodia/i,

  numberedExtraOption:
    /^\d+\.\s+(?:(?:C[âa]ntico|Salmo)\b.+?)?—\s*(?:\d+[ºªa°]?\s*Op[cç][ãa]o|confer[êe]ncia\s+das?\s+\d+\s+vers(?:[ãa]o|[õo]es)).*$/i
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
  const cleanLines = filterNonContentLines(lines);

  const orderedLines =
    orderTwoColumnPage(
      cleanLines,
      pageWidth
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

  /*
   * Uma antífona pendente é contexto LOCAL da página. O valor recebido do
   * chamador só é aceito quando existe também uma seção de continuidade;
   * assim uma antífona solta nunca é injetada no primeiro Salmo/Cântico
   * não relacionado da página seguinte.
   */
  let pendingAntiphonLines: string[] = [];

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

  const normalizeSectionTitle = (title: string): string =>
    title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  const startSection = (
    title: string,
    isPsalmType: boolean,
    isProperOfDay = false
  ) => {
    /*
     * Se o mesmo título reaparece enquanto ainda estamos dentro da mesma
     * peça (situação comum em cabeçalhos/repetições de página), não fecha
     * e reabre a seção. Continua acumulando o conteúdo.
     */
    if (
      current &&
      normalizeSectionTitle(current.title) ===
        normalizeSectionTitle(title)
    ) {
      current.hasChords =
        current.hasChords || isPsalmType;
      current.isProperOfDay =
        current.isProperOfDay || isProperOfDay;
      currentIsPsalmType =
        current.hasChords;
      return;
    }

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

      const dayBaseMatch =
        isDayHeaderBase(plainText);

      if (dayBaseMatch) {
        dayTitle =
          normalizeDayHeader(
            dayBaseMatch[1],
            dayBaseMatch[2]
          );

        continue;
      }

      // Quando o PDF quebra "II SEXTA-FEIRA — LAUDES" em duas linhas,
      // esta segunda linha é apenas um fragmento do cabeçalho.
      if (isLaudesHeaderFragment(plainText)) {
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
      const formattedAntiphon =
        formatMixedTextLine(
          line.words
        );

      /*
       * Uma antífona encontrada ANTES da primeira linha realmente
       * cifrada é a antífona de abertura.
       *
       * IMPORTANTE: linhas simples que aparecem entre o título do
       * salmo/cântico e a antífona (epígrafe, legenda, referência
       * bíblica, indicação editorial etc.) NÃO iniciam o corpo.
       * Portanto, bodyStarted só pode ser true depois que encontramos
       * uma linha de acorde/conteúdo musical real.
       *
       * Se já existe corpo cifrado, esta é a antífona de fechamento.
       * Ela permanece dentro da mesma seção. Se houver T.P. logo em
       * seguida, ele também pertence ao fechamento e deve ser preservado.
       */
      if (
        currentIsPsalmType &&
        bodyStarted &&
        current
      ) {
        current.contentLines.push(
          formattedAntiphon
        );

        const nextPlainText =
          next && !isChordLine(next)
            ? next.words
                .map(w => w.text)
                .join(' ')
                .trim()
            : '';

        if (
          nextPlainText &&
          /^T\.?\s*P\.?\s*[:.]?/i.test(
            nextPlainText
          )
        ) {
          current.contentLines.push(
            formatMixedTextLine(
              next!.words
            )
          );
          i++;
        }

        closeCurrent();
      } else if (
        currentIsPsalmType &&
        current
      ) {
        // Antífona de abertura: fica no início do próprio salmo/cântico.
        current.contentLines.push(
          formattedAntiphon
        );
      } else {
        // A antífona pode aparecer antes do título por causa da ordenação
        // da página; nesse caso, aguarda o próximo salmo/cântico.
        pendingAntiphonLines.push(
          formattedAntiphon
        );
      }

      continue;
    }

    /*
     * ============================================================
     * NUMBERED EXTRA MELODY OPTIONS (novo)
     * ============================================================
     *
     * Exemplos no PDF de complemento:
     *
     * 1. Cântico de Habacuc (Hab 3,2-4.13a.15-19) — 2ª Opção
     * 2. Salmo 99 (100) — 1ª Opção
     * 3. Salmo 99 (100) — 2ª Opção
     * 4. Salmo 50 (51) — conferência das 3 versões
     *
     * Elas são seções NOVAS e isoladas, não sub-versões de um
     * cântico existente.
     */
    if (
      !chordLine &&
      HEADING_RE.numberedExtraOption.test(
        plainText
      )
    ) {
      const titleMatch = plainText.match(
        /^\d+\.\s+(.+?)(?:\s*—\s*(?:\d+[ºªa°]?\s*Op[cç][ãa]o|confer[êe]ncia.*))?$/i
      );

      const title = titleMatch
        ? titleMatch[1].trim()
        : plainText;

      startSection(title, true);

      continue;
    }

    /*
     * ============================================================
     * TODAS AS OPÇÕES DE MELODIA (versão antiga, mantida)
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

      /*
       * Texto simples pode ser epígrafe/legenda/subtítulo entre o
       * título e a antífona ou antes da primeira cifra. Não é suficiente
       * para declarar que o corpo musical começou.
       *
       * O estado bodyStarted é ligado somente por conteúdo musical real
       * (linha de acorde) ou pelas alternativas especiais tratadas acima.
       */
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
