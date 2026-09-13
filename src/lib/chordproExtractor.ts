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

  return orderTwoColumnPage(rawLines, pageWidth);
}

/**
 * Decide se a página realmente possui duas colunas independentes.
 *
 * É importante NÃO considerar uma linha longa de uma única coluna como
 * "linha centralizada". Páginas de Leitura, Preces e Oração ocupam a largura
 * inteira da folha e precisam continuar em ordem vertical normal.
 */
function hasTwoColumnLayout(
  lines: PdfLine[],
  pageWidth: number
): boolean {
  const mid = pageWidth / 2;
  let pairedRows = 0;

  for (const line of lines) {
    if (!line.words.length) continue;

    const left = line.words.filter(
      w => (w.x0 + w.x1) / 2 < mid
    );
    const right = line.words.filter(
      w => (w.x0 + w.x1) / 2 >= mid
    );

    if (!left.length || !right.length) continue;

    const leftMaxX = Math.max(
      ...left.map(w => w.x1)
    );
    const rightMinX = Math.min(
      ...right.map(w => w.x0)
    );

    // Uma distância real entre os dois blocos indica duas colunas.
    // Uma frase longa de uma coluna, ao contrário, atravessa o centro
    // sem deixar esse vão.
    if (rightMinX - leftMaxX >= 20) {
      pairedRows++;
    }
  }

  return pairedRows >= 8;
}

/**
 * Organiza uma página em ordem de leitura.
 *
 * Para página de uma coluna: Y descendente, normalmente.
 *
 * Para duas colunas:
 *   1. mantém o cabeçalho/textos de largura total na posição vertical real;
 *   2. detecta o trecho em que existem duas colunas simultâneas;
 *   3. lê a coluna esquerda inteira e depois a direita;
 *   4. mantém novamente, no final, qualquer linha de largura total (como a
 *      antífona de fechamento).
 *
 * Isso evita dois bugs diferentes ao mesmo tempo: misturar colunas na mesma
 * linha e colocar textos de uma coluna inteira ANTES do título da seção.
 */
function orderTwoColumnPage(
  lines: PdfLine[],
  pageWidth: number
): PdfLine[] {
  const cleaned = lines
    .filter(line => line.words.length > 0)
    .sort((a, b) => b.y - a.y);

  if (!hasTwoColumnLayout(cleaned, pageWidth)) {
    return cleaned;
  }

  const mid = pageWidth / 2;

  // Uma linha só é considerada parte do corpo de duas colunas quando há
  // palavras dos dois lados E existe um vão real entre as duas colunas.
  // Assim, uma frase longa que atravessa o centro não inicia falsamente o
  // corpo de duas colunas.
  const pairedRows = cleaned.filter(line => {
    const left = line.words.filter(
      w => (w.x0 + w.x1) / 2 < mid
    );
    const right = line.words.filter(
      w => (w.x0 + w.x1) / 2 >= mid
    );

    if (!left.length || !right.length) return false;

    const leftMaxX = Math.max(
      ...left.map(w => w.x1)
    );
    const rightMinX = Math.min(
      ...right.map(w => w.x0)
    );

    return rightMinX - leftMaxX >= 20;
  });

  if (pairedRows.length < 3) {
    return cleaned;
  }

  // Num PDF, Y CRESCE PARA CIMA (o topo da página tem o maior Y). O menor
  // Y entre as linhas pareadas é, portanto, a linha mais BAIXA do bloco de
  // duas colunas (fisicamente embaixo, perto do rodapé), e o maior Y é a
  // linha mais ALTA do bloco (fisicamente em cima, perto do título).
  const lowestBodyY = Math.min(
    ...pairedRows.map(line => line.y)
  );
  const highestBodyY = Math.max(
    ...pairedRows.map(line => line.y)
  );

  // CORREÇÃO (bug do cabeçalho/título indo parar DEPOIS do corpo de duas
  // colunas): como Y cresce para cima, o cabeçalho da página ("Hino",
  // "Salmo 50(51)" etc.) sempre tem Y MAIOR que o bloco de duas colunas —
  // ou seja, ele pertence ao grupo "acima do corpo", não ao grupo "abaixo
  // do corpo". A versão anterior comparava certo, mas devolvia os dois
  // grupos na ORDEM ERRADA (rodapé antes do corpo, cabeçalho depois do
  // corpo), fazendo o título da seção só ser reconhecido no fim da
  // página — depois de todo o conteúdo já ter sido perdido ou atribuído
  // à seção anterior por engano.
  const aboveBodyLines = cleaned.filter(
    line => line.y > highestBodyY + Y_TOLERANCE
  );
  const bodyLines = cleaned.filter(
    line =>
      line.y >= lowestBodyY - Y_TOLERANCE &&
      line.y <= highestBodyY + Y_TOLERANCE
  );
  const belowBodyLines = cleaned.filter(
    line => line.y < lowestBodyY - Y_TOLERANCE
  );

  const leftWords: PdfWord[] = [];
  const rightWords: PdfWord[] = [];

  for (const line of bodyLines) {
    for (const word of line.words) {
      if ((word.x0 + word.x1) / 2 < mid) {
        leftWords.push(word);
      } else {
        rightWords.push(word);
      }
    }
  }

  const leftBody = groupWordsByYOnly(leftWords);
  const rightBody = groupWordsByYOnly(rightWords);

  return [
    ...aboveBodyLines,
    ...leftBody,
    ...rightBody,
    ...belowBodyLines
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
  // Ver o comentário equivalente em segmentLiturgyOfHoursPage: `lines`
  // já vem ordenado por groupWordsIntoLines (que já roda
  // orderTwoColumnPage). Rodar de novo aqui desfazia a separação de
  // colunas em vez de preservá-la.
  const orderedLines = lines;

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
  isContinuation?: boolean;
  // Sufixo de opção de melodia (ex.: "Opção 1") de um Hino com arranjos
  // alternativos. Fica separado do título porque o título final precisa
  // levar o incipit ENTRE o nome e o sufixo — "Hino — {incipit} — Opção N"
  // — e o incipit só é conhecido depois, quando PDFImporter.tsx já extraiu
  // o conteúdo. Ver uso em startSection (bloco HEADING_RE.hino) e em
  // PDFImporter.tsx (composição do título final).
  titleSuffix?: string;
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
    // Sem o sufixo opcional, "HINO — OPÇÃO 1/2/3" (Hinos com arranjos
    // musicais alternativos, cada um impresso com esse cabeçalho completo)
    // não batia aqui — a linha inteira caía como conteúdo comum e ficava
    // grudada na seção anterior (Invitatório), em vez de abrir um Hino novo.
    /^Hino\b(?:\s*[—–-]\s*Op[cç][ãa]o\s*\d+)?$/i,

  salmodia:
    /^Salmodia$/i,

  salmo:
    /^Salmo\s+\d|^Salmo\s*[—–-]/i,

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

/**
 * Alguns PDFs (ex.: Laudes numeradas "1. Invitatório", "2. Hino",
 * "9. Preces", "10. Oração") imprimem um índice numérico colado ao
 * nome da seção. Sem remover esse prefixo, os regexes de cabeçalho
 * (que exigem o nome da seção sozinho no início da linha) não batem
 * e a página inteira cai no caminho por IA, perdendo/mesclando
 * seções. Removemos apenas o prefixo "N. " — nunca usado para
 * números dentro de títulos, como "Salmo 50(51)" — antes de testar
 * contra os cabeçalhos de seção conhecidos.
 */
function stripOrdinalPrefix(text: string): string {
  return text.replace(/^\d{1,2}\.\s+/, '');
}

function isAnyHeadingLine(
  text: string
): boolean {
  return Object.values(
    HEADING_RE
  ).some(re =>
    re.test(text)
  );
}

/**
 * Remove apenas o número de página impresso no rodapé.
 * Não usamos esta regra para números dentro de títulos (ex.: Salmo 50(51))
 * nem para opções de melodia como "1. ...".
 */
function isPrintedPageNumber(
  line: PdfLine,
  pageWidth: number
): boolean {
  const text = line.words
    .map(w => w.text)
    .join(' ')
    .trim();

  if (!/^\d{1,4}$/.test(text)) {
    return false;
  }

  const minX = Math.min(
    ...line.words.map(w => w.x0)
  );
  const maxX = Math.max(
    ...line.words.map(w => w.x1)
  );

  // No PDF de Laudes o número fica isolado no rodapé, à direita.
  return minX >= pageWidth * 0.80 &&
    maxX >= pageWidth * 0.85;
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
   * CORREÇÃO CRÍTICA (bug da "coluna duplicada"/conteúdo trocado entre
   * seções em PDFs de duas colunas):
   *
   * `lines` já chega aqui na ordem de leitura correta — quem chama esta
   * função (extractPreAlignedPageText, e o modo Ofício/Laudes em
   * PDFImporter.tsx) sempre produz `lines` através de
   * `groupWordsIntoLines(words, pageWidth)`, que JÁ executa
   * `orderTwoColumnPage` internamente.
   *
   * Chamar `orderTwoColumnPage` de novo aqui pegava uma lista que já
   * tinha sido separada em "bloco esquerdo inteiro" + "bloco direito
   * inteiro" e a reordenava de novo — e como cada linha, depois da
   * primeira separação, só tem palavras de UM lado, ela deixa de
   * "parecer" duas colunas para `hasTwoColumnLayout` (que exige palavras
   * dos dois lados na MESMA linha). Isso fazia a segunda chamada achar
   * que a página não tinha duas colunas e devolver tudo ordenado só por
   * Y de novo — o que intercala linha da coluna esquerda / linha da
   * coluna direita que têm a MESMA altura, exatamente como antes da
   * correção original. Foi isso que causou acordes de uma coluna
   * grudando na letra da outra coluna (ex.: "Deus, que criastes a
   * [C-D/C-Bm-Em]luz," juntando o Hino da coluna esquerda com o acorde
   * da coluna direita) e conteúdo de uma seção aparecendo dentro do
   * título errado.
   *
   * Corrigido: usar `lines` como já vier, sem reordenar de novo.
   */
  const orderedLines = lines;

  // Se a página possui um cabeçalho de seção próprio, não ativamos o
  // carry-over antes dele. Isso evita jogar epígrafes/antífonas iniciais
  // da nova seção dentro da música da página anterior.
  const pageContainsSectionHeading = orderedLines.some(line => {
    const text = line.words.map(w => w.text).join(' ').trim();
    const textNoOrdinal = stripOrdinalPrefix(text);
    return !isChordLine(line) && (
      HEADING_RE.invitatorio.test(textNoOrdinal) ||
      HEADING_RE.hino.test(textNoOrdinal) ||
      HEADING_RE.salmo.test(textNoOrdinal) ||
      HEADING_RE.canticoEvangelico.test(textNoOrdinal) ||
      HEADING_RE.cantico.test(textNoOrdinal) ||
      HEADING_RE.leitura.test(textNoOrdinal) ||
      HEADING_RE.responsorio.test(textNoOrdinal) ||
      HEADING_RE.preces.test(textNoOrdinal) ||
      HEADING_RE.oracao.test(textNoOrdinal) ||
      HEADING_RE.numberedExtraOption.test(text)
    );
  });

  const sections:
    LiturgySection[] = [];

  // A seção da página anterior é apenas uma CANDIDATA a continuação.
  // Não podemos anexá-la imediatamente: a página pode começar com um
  // epígrafe/texto e só depois apresentar o cabeçalho de uma nova seção.
  let carryOverCandidate = carryOverSection
    ? {
        title: carryOverSection.title,
        hasChords: carryOverSection.hasChords
      }
    : null;

  let current: LiturgySection | null = null;

  let currentIsPsalmType = false;

  let bodyStarted = false;

  let sawNewSectionHeading = false;

  let checkNextLineForSubtitle = false;

  const activateCarryOver = () => {
    if (!carryOverCandidate || current || sawNewSectionHeading) {
      return;
    }

    current = {
      title: carryOverCandidate.title,
      hasChords: carryOverCandidate.hasChords,
      contentLines: [],
      isContinuation: true
    };

    currentIsPsalmType = carryOverCandidate.hasChords;
    bodyStarted = false;
    checkNextLineForSubtitle = carryOverCandidate.hasChords;

    if (pendingAntiphonLines.length > 0) {
      current.contentLines.push(...pendingAntiphonLines);
      pendingAntiphonLines = [];
    }

    carryOverCandidate = null;
  };

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
    isProperOfDay = false,
    titleSuffix?: string
  ) => {
    sawNewSectionHeading = true;
    carryOverCandidate = null;
    closeCurrent();

    current = {
      title,

      hasChords:
        isPsalmType,

      contentLines: [],

      isProperOfDay,

      titleSuffix
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
    // CORREÇÃO (erro de compilação "Property 'contentLines' does not
    // exist on type 'never'"): `current` é reatribuído dentro de
    // closures (closeCurrent/startSection/activateCarryOver) chamadas
    // ao longo do corpo deste loop. O checker do TypeScript não refaz
    // essa análise de fluxo entre uma iteração e a próxima (o "current"
    // no início do laço só enxerga o valor de ANTES do loop, que é
    // `null`), então em alguns pontos ele concluía — incorretamente —
    // que `current` só poderia ser `null` ali, e reduzia o tipo da
    // checagem `current && ...` para `never`. Reatribuir aqui, com o
    // tipo explícito, obriga o checker a tratar `current` como
    // `LiturgySection | null` de novo em cada iteração. Não muda nada
    // em tempo de execução — é só para o `tsc` (o `npm run lint`) parar
    // de reclamar; o comportamento da extração não depende disto.
    current = current as LiturgySection | null;

    const line =
      orderedLines[i];

    const next =
      orderedLines[i + 1];

    const plainTextRaw =
      line.words
        .map(w => w.text)
        .join(' ')
        .trim();

    // Remove o "N. " de índice ("1. Invitatório", "9. Preces"...) e,
    // quando o cabeçalho vem no formato composto "Salmo — <título>" /
    // "Cântico — <título>" (usado por algumas Laudes numeradas), fica
    // só com o título real, igual ao que aparece de novo no corpo do
    // salmo/cântico logo abaixo. Ver stripOrdinalPrefix.
    const plainText =
      stripOrdinalPrefix(plainTextRaw)
        // "Salmo — Salmo 89 (90)" -> "Salmo 89 (90)" (remove a
        // palavra "Salmo" duplicada, mantendo o título real).
        .replace(/^Salmo\s*[—–-]\s*/i, '')
        // "Cântico — Is 42,10-16" -> "Cântico Is 42,10-16" (mantém a
        // palavra "Cântico", só troca o travessão por espaço, para
        // ficar igual ao cabeçalho repetido no corpo do cântico).
        .replace(/^(C[âa]ntico)\s*[—–-]\s*(?!evang)/i, '$1 ');

    const chordLine =
      isChordLine(line);

    if (!chordLine && isPrintedPageNumber(line, pageWidth)) {
      continue;
    }

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

    /*
     * Cabeçalhos numerados compostos ("3. Salmo — Salmo 89 (90)",
     * "5. Salmo — Salmo 134 (135),1-12", "4. Cântico — Is 42,10-16")
     * são apenas um índice — o título de verdade ("Salmo 89 (90)",
     * "Cântico Is 42,10-16"...) volta a aparecer sozinho, sem número,
     * logo antes dos acordes. Se abríssemos seção já aqui, essa
     * segunda aparição do título dispararia HEADING_RE.salmo/cantico
     * de novo e fecharia esta seção prematuramente — sobrando uma
     * seção órfã só com a antífona de abertura, separada do corpo.
     * Por isso ignoramos esta linha e deixamos a antífona (que vem
     * em seguida) esperar em pendingAntiphonLines até o título real.
     */
    if (
      !chordLine &&
      (
        /^\d{1,2}\.\s+Salmo\s*[—–-]/i.test(
          plainTextRaw
        ) ||
        /^\d{1,2}\.\s+C[âa]ntico\s*[—–-]\s*(?!evang)/i.test(
          plainTextRaw
        )
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
      // O título da seção fica sempre "Hino" — o número da opção
      // ("HINO — OPÇÃO 1", "HINO — OPÇÃO 2"...) é extraído à parte em
      // titleSuffix, e não colado direto no título aqui. Cada opção
      // continua sendo um Hino DIFERENTE (arranjo próprio), mas o
      // título final (montado em PDFImporter.tsx) precisa do formato
      // "Hino — {incipit} — Opção N", com o incipit ENTRE o nome e o
      // número da opção — por isso o sufixo não pode ir já embutido no
      // título aqui, só é conhecido o incipit depois de extrair o
      // conteúdo da seção.
      const optionMatch = plainText.match(
        /[—–-]\s*Op[cç][ãa]o\s*(\d+)/i
      );

      startSection(
        'Hino',
        true,
        false,
        optionMatch
          ? `Opção ${optionMatch[1]}`
          : undefined
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

    if (!current && carryOverCandidate && !sawNewSectionHeading) {
      // Para uma página sem cabeçalho próprio, uma linha musical é prova
      // forte de que a peça anterior realmente continuou. Para páginas que
      // têm um novo cabeçalho, aguardamos esse cabeçalho e descartamos a
      // candidata, evitando vazamento de texto entre seções.
      if (chordLine || !pageContainsSectionHeading) {
        activateCarryOver();
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
