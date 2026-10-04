export interface PdfWord {
  text: string;
  x0: number;
  x1: number;
  y: number;
  /**
   * Posição X de cada caractere da palavra (length = text.length + 1: o
   * último valor é o x1 da palavra). Permite encaixar um acorde no MEIO
   * de uma palavra (ex.: "Se[Bb9]nhor"), igual ao PDF original, em vez de
   * só no começo da palavra.
   */
  charX?: number[];
}

export interface PdfLine {
  y: number;
  words: PdfWord[];
  /** true quando a linha está sobre um retângulo colorido (refrão/resposta). */
  shaded?: boolean;
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

const BASS = `(?:\\/${ROOT}\\d{0,2})?(?:\\/[-+b#]?\\d{1,2})?\\*?`;

// Marcadores que cifras de banda colocam colados no acorde: "*Bm", ".Aadd9",
// "(Em", "G7M)".
const CHORD_TOKEN_RE = new RegExp(
  `^[*.]?\\(?${ROOT}${QUALITY}${EXTENSION}${EXTRA_MAJOR}${DIM_SYMBOL}${ALTERATION}${BASS}\\)?$`
);

const BAR_SYMBOL_RE = /^[|%]+$/;

function isChordToken(text: string): boolean {
  return CHORD_TOKEN_RE.test(text) || BAR_SYMBOL_RE.test(text);
}

function isLooseHyphen(text: string): boolean {
  return text === '-' || text === '–' || text === '—';
}

// Parênteses soltos ("( Em D/F# )") e símbolos de ênfase não contam nem a
// favor nem contra na decisão "esta linha é de acordes?".
function isNeutralToken(text: string): boolean {
  return (
    isLooseHyphen(text) ||
    /^[()*.\/]+$/.test(text)
  );
}

// ---------------------------------------------------------------------------
// LARGURA DE CARACTERES
// ---------------------------------------------------------------------------

/**
 * Larguras (Helvetica/Arial, unidades de 1/1000 em) dos caracteres mais
 * comuns. O pdf.js só informa a largura do TRECHO de texto inteiro, não de
 * cada letra. Antes, a largura era repartida igualmente entre as letras
 * ("i" ocupava o mesmo que "m"), o que deslocava acordes em até 1-2
 * sílabas. Aqui a largura do trecho é repartida proporcionalmente a estas
 * larguras — o total continua sendo exatamente o largura real do trecho,
 * só muda como ele é dividido entre as letras.
 */
const GLYPH_W: Record<string, number> = {
  ' ': 278, '!': 278, '"': 355, '#': 556, '$': 556, '%': 889, '&': 667,
  "'": 191, '(': 333, ')': 333, '*': 389, '+': 584, ',': 278, '-': 333,
  '.': 278, '/': 278, ':': 278, ';': 278, '<': 584, '=': 584, '>': 584,
  '?': 556, '@': 1015, '[': 278, '\\': 278, ']': 278, '^': 469, '_': 556,
  '`': 333, '{': 334, '|': 260, '}': 334, '~': 584, '…': 1000, '–': 556,
  '—': 1000, '°': 400, 'º': 365, 'ª': 370,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278,
  J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722,
  S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222,
  j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333,
  s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500
};

function glyphWidth(ch: string): number {
  const direct = GLYPH_W[ch];
  if (direct !== undefined) return direct;

  if (ch >= '0' && ch <= '9') return 556;

  // Letras acentuadas têm a mesma largura da letra-base (á = a, Ç = C...).
  const base = ch.normalize('NFD').charAt(0);
  const viaBase = GLYPH_W[base];
  if (viaBase !== undefined) return viaBase;

  return 556;
}

/**
 * Posição X de cada caractere de um trecho de texto: length = str.length+1.
 */
function charPositions(
  str: string,
  x0: number,
  width: number
): number[] {
  const n = str.length;
  const weights: number[] = [];
  let total = 0;

  for (let i = 0; i < n; i++) {
    const w = glyphWidth(str[i]);
    weights.push(w);
    total += w;
  }

  const out: number[] = [x0];
  let acc = 0;

  for (let i = 0; i < n; i++) {
    acc += weights[i];
    out.push(x0 + (total > 0 ? (acc / total) * width : 0));
  }

  return out;
}

// ---------------------------------------------------------------------------
// EXTRAÇÃO DE PALAVRAS
// ---------------------------------------------------------------------------

interface RawItem {
  str: string;
  x0: number;
  y: number;
  width: number;
  size: number;
}

/**
 * Extrai as palavras da camada de texto do PDF com suas coordenadas reais.
 *
 * CORREÇÃO (bug do "Se nhor", "Ky rie", "E b"):
 * PDFs cifrados feitos no Word trocam de fonte (negrito/normal) no meio
 * das palavras — cada troca vira um "item" de texto separado, mas os itens
 * ficam encostados (sem espaço entre eles). Antes, cada item virava uma
 * palavra, e o texto saía como "Se nhor", "Ca mi nho", "E b". Agora os
 * itens são juntados quando não existe espaço nem vão entre eles.
 */
export async function extractPageWords(
  page: any
): Promise<PdfWord[]> {
  const textContent = await page.getTextContent();

  const items: RawItem[] = [];

  for (const item of textContent.items as any[]) {
    const str: string = item.str;

    if (typeof str !== 'string' || str.length === 0) continue;

    items.push({
      str,
      x0: item.transform[4],
      y: item.transform[5],
      width: item.width ?? 0,
      size:
        Math.abs(item.transform[3]) ||
        item.height ||
        10
    });
  }

  // Agrupa os itens em linhas por Y.
  items.sort((a, b) => b.y - a.y || a.x0 - b.x0);

  const rows: RawItem[][] = [];

  for (const it of items) {
    const row = rows.find(
      r => Math.abs(r[0].y - it.y) <= Y_TOLERANCE
    );

    if (row) {
      row.push(it);
    } else {
      rows.push([it]);
    }
  }

  const words: PdfWord[] = [];

  for (const row of rows) {
    row.sort((a, b) => a.x0 - b.x0);

    let curText = '';
    let curX: number[] = [];
    let curY = 0;
    let prevEnd = -Infinity;
    let prevSize = 10;

    const flush = () => {
      if (curText.length > 0) {
        words.push({
          text: curText,
          x0: curX[0],
          x1: curX[curX.length - 1],
          y: curY,
          charX: curX
        });
      }

      curText = '';
      curX = [];
    };

    for (const it of row) {
      const pos = charPositions(it.str, it.x0, it.width);

      // Vão entre este item e o anterior: se for visível, é um espaço.
      const gap = it.x0 - prevEnd;
      const gapLimit = Math.max(0.9, prevSize * 0.07);

      if (curText.length > 0 && gap > gapLimit) {
        flush();
      }

      for (let i = 0; i < it.str.length; i++) {
        const ch = it.str[i];

        if (/\s/.test(ch)) {
          flush();
          continue;
        }

        if (curText.length === 0) {
          curY = it.y;
          curX = [pos[i]];
        }

        curText += ch;
        curX.push(pos[i + 1]);
      }

      prevEnd = it.x0 + it.width;
      prevSize = it.size;
    }

    flush();
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
 * Quando pageWidth é informado, a página é tratada como possivelmente de
 * duas colunas (ver orderTwoColumnPage): uma linha nunca mistura palavras
 * das duas colunas e a coluna esquerda é lida inteira antes da direita.
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
 * Uma linha tem "vão de coluna" quando há palavras dos dois lados do
 * centro e um espaço vazio de pelo menos 20pt entre elas.
 */
function hasColumnGap(
  line: PdfLine,
  mid: number
): boolean {
  const left = line.words.filter(
    w => (w.x0 + w.x1) / 2 < mid
  );
  const right = line.words.filter(
    w => (w.x0 + w.x1) / 2 >= mid
  );

  if (!left.length || !right.length) return false;

  const leftMaxX = Math.max(...left.map(w => w.x1));
  const rightMinX = Math.min(...right.map(w => w.x0));

  return rightMinX - leftMaxX >= 20;
}

/**
 * Uma linha "cruza" o centro quando alguma palavra (ou duas palavras
 * quase encostadas) passa por cima da linha central da página.
 */
function crossesCenter(
  line: PdfLine,
  mid: number
): boolean {
  const ws = [...line.words].sort((a, b) => a.x0 - b.x0);

  for (let i = 0; i < ws.length; i++) {
    const w = ws[i];

    if (w.x0 < mid - 3 && w.x1 > mid + 3) return true;

    const next = ws[i + 1];

    if (
      next &&
      w.x1 <= mid &&
      next.x0 >= mid &&
      next.x0 - w.x1 < 9
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Decide se a página realmente possui duas colunas independentes.
 *
 * É importante NÃO considerar uma linha longa de uma única coluna como
 * "linha centralizada". Páginas de Leitura, Preces e Oração ocupam a largura
 * inteira da folha e precisam continuar em ordem vertical normal.
 *
 * CORREÇÃO (cifra de coluna única lida como duas colunas): em cifras de
 * banda, observações à direita da linha ("Ref.", "Conv: A2 C# D...") e
 * letras que passam do meio da folha criam muitas linhas com "vão". Antes,
 * 8 linhas assim bastavam para a página ser tratada como duas colunas e
 * toda a ordem de leitura saía embaralhada. Numa página de duas colunas de
 * verdade, o centro da folha fica livre: só poucas linhas (títulos)
 * cruzam o meio. Se muitas linhas cruzam o meio, a página é de coluna
 * única.
 */
function hasTwoColumnLayout(
  lines: PdfLine[],
  pageWidth: number
): boolean {
  const mid = pageWidth / 2;
  let pairedRows = 0;
  let crossingRows = 0;

  for (const line of lines) {
    if (!line.words.length) continue;

    if (hasColumnGap(line, mid)) pairedRows++;
    if (crossesCenter(line, mid)) crossingRows++;
  }

  if (pairedRows < 8) return false;

  return crossingRows <= Math.max(5, pairedRows * 0.3);
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

  const pairedRows = cleaned.filter(line =>
    hasColumnGap(line, mid)
  );

  if (pairedRows.length < 3) {
    return cleaned;
  }

  // Num PDF, Y CRESCE PARA CIMA (o topo da página tem o maior Y).
  const lowestBodyY = Math.min(
    ...pairedRows.map(line => line.y)
  );
  const highestBodyY = Math.max(
    ...pairedRows.map(line => line.y)
  );

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
      w => !isNeutralToken(w.text)
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

// ---------------------------------------------------------------------------
// CABEÇALHO / RODAPÉ REPETIDOS
// ---------------------------------------------------------------------------

const MARGIN_BAND = 0.06;

let repeatedMarginKeys: Set<string> | null = null;

function marginKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function lineText(line: PdfLine): string {
  return line.words.map(w => w.text).join(' ');
}

function isMarginLine(
  line: PdfLine,
  pageHeight: number,
  pageBottom: number
): boolean {
  const rel = (line.y - pageBottom) / pageHeight;

  return rel > 1 - MARGIN_BAND || rel < MARGIN_BAND;
}

const PAGE_NUMBER_RE =
  /^(?:p[áa]g(?:ina)?\.?\s*)?\d+(?:\s*(?:\/|de)\s*\d+)?$/i;

/**
 * Descobre, olhando algumas páginas do documento, quais textos se repetem
 * no topo/rodapé (ex.: "Cantai a Deus com Alegria Cifrado...", "RRS –
 * Versão Fev/2023 Pág. 88 / 1302") para removê-los de TODAS as páginas.
 * Chamar UMA vez depois de abrir o PDF, antes de extrair as páginas.
 * Números são normalizados, então "Pág. 88" e "Pág. 90" contam como o
 * mesmo texto.
 */
export async function prepareHeaderFooterFilter(
  pdf: any,
  sampleSize = 12
): Promise<void> {
  repeatedMarginKeys = null;

  try {
    const total: number = pdf.numPages;

    if (!total || total < 3) return;

    const count = Math.min(sampleSize, total);
    const pagesToSample = new Set<number>();

    for (let i = 0; i < count; i++) {
      pagesToSample.add(
        Math.max(
          1,
          Math.min(total, Math.round(1 + (i * (total - 1)) / Math.max(1, count - 1)))
        )
      );
    }

    const counts = new Map<string, number>();
    let sampled = 0;

    for (const n of pagesToSample) {
      const page = await pdf.getPage(n);
      const words = await extractPageWords(page);

      if (!hasReliableTextLayer(words)) continue;

      sampled++;

      const view = page.view as number[];
      const pageHeight = view[3] - view[1];
      const pageBottom = view[1];

      const seenOnPage = new Set<string>();

      for (const line of groupWordsByYOnly(words)) {
        if (!isMarginLine(line, pageHeight, pageBottom)) continue;

        const key = marginKey(lineText(line));

        if (key) seenOnPage.add(key);
      }

      for (const key of seenOnPage) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    if (sampled < 3) return;

    const keys = new Set<string>();
    const minCount = Math.max(2, Math.ceil(sampled * 0.5));

    for (const [key, c] of counts) {
      if (c >= minCount) keys.add(key);
    }

    repeatedMarginKeys = keys;
  } catch (err) {
    console.error('Falha ao detectar cabeçalho/rodapé repetidos:', err);
    repeatedMarginKeys = null;
  }
}

function removeHeaderFooterLines(
  lines: PdfLine[],
  pageHeight: number,
  pageBottom: number
): PdfLine[] {
  return lines.filter(line => {
    if (!isMarginLine(line, pageHeight, pageBottom)) return true;

    const text = lineText(line).trim();

    if (PAGE_NUMBER_RE.test(text)) return false;

    if (repeatedMarginKeys?.has(marginKey(text))) return false;

    return true;
  });
}

// ---------------------------------------------------------------------------
// RETÂNGULOS COLORIDOS (refrão / resposta da assembleia)
// ---------------------------------------------------------------------------

interface ShadeRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function parseHexColor(
  value: any
): [number, number, number] | null {
  if (typeof value !== 'string') return null;

  const m = /^#([0-9a-f]{6})$/i.exec(value.trim());

  if (!m) return null;

  const n = parseInt(m[1], 16);

  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Lê as caixas de fundo colorido da página (o "fundo salmão" do refrão e
 * das respostas da assembleia). Cinzas, branco e cores escuras são
 * ignorados: a barra cinza do título e as linhas vermelhas do cabeçalho
 * não contam.
 */
export async function extractShadedRects(
  page: any,
  OPS: any
): Promise<ShadeRect[]> {
  const rects: ShadeRect[] = [];

  try {
    const ol = await page.getOperatorList();

    let fill: [number, number, number] | null = null;

    // Pilha de transformações (cm / q / Q) para chegar nas coordenadas
    // reais da página.
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];

    const mul = (m: number[], n: number[]) => [
      m[0] * n[0] + m[2] * n[1],
      m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3],
      m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4],
      m[1] * n[4] + m[3] * n[5] + m[5]
    ];

    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i];
      const args = ol.argsArray[i];

      if (fn === OPS.save) {
        stack.push([...ctm]);
      } else if (fn === OPS.restore) {
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
      } else if (fn === OPS.transform) {
        ctm = mul(ctm, args);
      } else if (fn === OPS.setFillRGBColor) {
        fill = parseHexColor(args?.[0]) ?? null;
      } else if (fn === OPS.constructPath) {
        // pdf.js v5: args = [paintOp, [pathData], [minX, minY, maxX, maxY]]
        const paintOp = args?.[0];
        const bbox = args?.[2];

        const isFill =
          paintOp === OPS.fill ||
          paintOp === OPS.eoFill ||
          paintOp === OPS.fillStroke ||
          paintOp === OPS.eoFillStroke;

        if (!isFill || !fill || !bbox || bbox.length < 4) continue;

        const [r, g, b] = fill;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        const saturated = max - min >= 8;

        if (!saturated || luminance < 0.75 || luminance > 0.995) continue;

        const ax = ctm[0] * bbox[0] + ctm[2] * bbox[1] + ctm[4];
        const ay = ctm[1] * bbox[0] + ctm[3] * bbox[1] + ctm[5];
        const bx = ctm[0] * bbox[2] + ctm[2] * bbox[3] + ctm[4];
        const by = ctm[1] * bbox[2] + ctm[3] * bbox[3] + ctm[5];

        const rect: ShadeRect = {
          x0: Math.min(ax, bx),
          x1: Math.max(ax, bx),
          y0: Math.min(ay, by),
          y1: Math.max(ay, by)
        };

        // Só caixas grandes o bastante para conter uma linha de texto.
        if (rect.y1 - rect.y0 >= 8 && rect.x1 - rect.x0 >= 60) {
          rects.push(rect);
        }
      }
    }
  } catch (err) {
    console.error('Falha ao ler retângulos coloridos da página:', err);
  }

  return rects;
}

function markShadedLines(
  lines: PdfLine[],
  rects: ShadeRect[]
): void {
  if (!rects.length) return;

  for (const line of lines) {
    line.shaded = rects.some(
      r => line.y >= r.y0 - 1 && line.y <= r.y1 + 1
    );
  }
}

// ---------------------------------------------------------------------------
// FUSÃO ACORDE + LETRA
// ---------------------------------------------------------------------------

/**
 * Tudo o que está na linha de acordes fica DENTRO do colchete, inclusive
 * marcadores colados como "*Bm", ".Aadd9", "(Em" e "G7M)". O visualizador
 * transpõe só as notas (A-G) de dentro do colchete, então os marcadores
 * continuam iguais ao PDF e o acorde continua transponível.
 */
function bracketChord(text: string): string {
  return `[${text}]`;
}

function bracketChordGroup(texts: string[]): string {
  // Barras de compasso e "%" ficam cada uma no seu próprio colchete;
  // acordes que caem na mesma sílaba ficam juntos, ligados por hífen.
  const parts: string[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length > 0) {
      parts.push(`[${run.join('-')}]`);
      run = [];
    }
  };

  for (const t of texts) {
    if (BAR_SYMBOL_RE.test(t)) {
      flush();
      parts.push(`[${t}]`);
    } else {
      run.push(t);
    }
  }

  flush();

  return parts.join('');
}

const LABEL_BEFORE_ANNOTATION_RE = /^[*]?(?:Ref|Conv|Obs|Final|Fim)\.?:?$/i;

/**
 * Anotações em acordes impressas no FIM da linha de letra (ex.: "...Glória.
 * Ref.  D D C# C# B", em vermelho no PDF): não pertencem à letra, então não
 * entram no alinhamento — são só acrescentadas, entre colchetes, no fim da
 * linha.
 */
function splitTrailingChordAnnotation(words: PdfWord[]): {
  lyric: PdfWord[];
  annotation: PdfWord[];
} {
  let k = words.length;

  while (
    k > 0 &&
    isChordToken(words[k - 1].text) &&
    !BAR_SYMBOL_RE.test(words[k - 1].text)
  ) {
    k--;
  }

  const count = words.length - k;

  if (count >= 2 && k > 0) {
    const before = words[k - 1];
    const first = words[k];

    if (
      LABEL_BEFORE_ANNOTATION_RE.test(before.text) ||
      first.x0 - before.x1 >= 25
    ) {
      return {
        lyric: words.slice(0, k),
        annotation: words.slice(k)
      };
    }
  }

  return { lyric: words, annotation: [] };
}

interface LyricChar {
  ch: string;
  x0: number;
  x1: number;
  space: boolean;
}

function lyricChars(words: PdfWord[]): LyricChar[] {
  const out: LyricChar[] = [];

  words.forEach((w, wi) => {
    const pos =
      w.charX && w.charX.length === w.text.length + 1
        ? w.charX
        : charPositions(w.text, w.x0, w.x1 - w.x0);

    for (let i = 0; i < w.text.length; i++) {
      out.push({
        ch: w.text[i],
        x0: pos[i],
        x1: pos[i + 1],
        space: false
      });
    }

    if (wi < words.length - 1) {
      out.push({
        ch: ' ',
        x0: w.x1,
        x1: words[wi + 1].x0,
        space: true
      });
    }
  });

  return out;
}

/**
 * Cola parênteses soltos aos acordes vizinhos: "( Em D/F# G7M )" vira
 * "(Em", "D/F#", "G7M)".
 */
function glueParentheses(tokens: PdfWord[]): PdfWord[] {
  const out: PdfWord[] = [];
  let pendingOpen: PdfWord | null = null;

  for (const t of tokens) {
    if (t.text === '(') {
      pendingOpen = t;
      continue;
    }

    if (t.text === ')') {
      const prev = out[out.length - 1];

      if (prev) {
        out[out.length - 1] = {
          ...prev,
          text: prev.text + ')',
          x1: t.x1,
          charX: undefined
        };
      }

      continue;
    }

    if (pendingOpen) {
      out.push({
        ...t,
        text: '(' + t.text,
        x0: pendingOpen.x0,
        charX: undefined
      });
      pendingOpen = null;
      continue;
    }

    out.push(t);
  }

  return out;
}

/**
 * Junta uma linha de acordes com a linha de letra.
 *
 * Cada acorde é encaixado no CARACTERE da letra que está logo abaixo do
 * início dele — inclusive no meio de uma palavra ("Se[Bb9]nhor",
 * "Ca[Dm7]minho"). Acordes além do fim da letra, e anotações em texto da
 * linha de acordes ("Conv:", "Ref."), vão para o fim da linha.
 */
export function mergeChordLyricLines(
  chordLine: PdfLine,
  lyricLine: PdfLine
): string {
  const { lyric, annotation } = splitTrailingChordAnnotation(
    lyricLine.words
  );

  const chars = lyricChars(lyric);

  let tokens = glueParentheses(
    chordLine.words.filter(
      w => !isLooseHyphen(w.text)
    )
  ).filter(t => !isNeutralToken(t.text));

  if (chars.length === 0) {
    return formatInstrumentalLine(chordLine);
  }

  // Anotações da linha de acordes (em vermelho no PDF) que não são
  // acordes alinhados à letra:
  //  - "Conv: A2 C# D ..." (rótulo terminado em ":"): tudo daí em diante;
  //  - uma sequência "*D D C# C# B": acorde marcado com "*" seguido de pelo
  //    menos mais 3 acordes até o fim da linha.
  let annotationStart = tokens.findIndex(t =>
    /^[*]?[A-Za-zÀ-ú]{2,}:$/.test(t.text)
  );

  if (annotationStart === -1) {
    // Procura de trás para frente: vale o ÚLTIMO "*Acorde" que ainda tem
    // 3+ acordes depois dele (um "*Bm" no meio da linha, seguido de
    // acordes normais da música, não é anotação).
    let star = -1;

    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];

      if (
        t.text.startsWith('*') &&
        isChordToken(t.text) &&
        tokens.length - i - 1 >= 3 &&
        tokens.slice(i + 1).every(x => isChordToken(x.text))
      ) {
        star = i;
        break;
      }
    }

    annotationStart = star;
  }

  const annotationTail: string[] = [];

  if (annotationStart !== -1) {
    for (const t of tokens.slice(annotationStart)) {
      annotationTail.push(
        isChordToken(t.text) ? bracketChord(t.text) : t.text
      );
    }

    tokens = tokens.slice(0, annotationStart);
  }

  const trailing: string[] = [];

  const lastCharX1 = chars[chars.length - 1].x1;

  const before = new Map<number, string[]>();

  for (const tok of tokens) {
    const isChord = isChordToken(tok.text);

    // Depois do fim da letra (com pequena folga): vai para o fim da linha.
    if (tok.x0 > lastCharX1 + 2 || !isChord) {
      trailing.push(
        isChord ? bracketChord(tok.text) : tok.text
      );
      continue;
    }

    // Primeiro caractere (não-espaço) que termina depois do início do acorde.
    let idx = chars.findIndex(
      c => !c.space && c.x1 > tok.x0
    );

    if (idx === -1) {
      trailing.push(bracketChord(tok.text));
      continue;
    }

    const c = chars[idx];

    // Acorde começa na metade direita da letra: pertence à letra seguinte.
    if (
      tok.x0 > c.x0 &&
      (tok.x0 - c.x0) / Math.max(0.01, c.x1 - c.x0) > 0.5
    ) {
      const next = chars.findIndex(
        (cc, k) => k > idx && !cc.space
      );

      if (next !== -1) idx = next;
    }

    if (!before.has(idx)) before.set(idx, []);

    before.get(idx)!.push(tok.text);
  }

  let result = '';

  chars.forEach((c, i) => {
    const list = before.get(i);

    if (list && list.length > 0) {
      result += bracketChordGroup(list);
    }

    result += c.ch;
  });

  const tail = [
    ...annotation.map(w => bracketChord(w.text)),
    ...trailing,
    ...annotationTail
  ];

  if (tail.length > 0) {
    result += ' ' + tail.join(' ');
  }

  return result;
}

/**
 * Formata uma linha que possui apenas acordes (Intro, Solo, grade de
 * compassos). Só o que é acorde ou barra vai entre colchetes — rótulos como
 * "Intro Guitar:" ou "Final Piano:" continuam texto comum. O espaçamento
 * entre os elementos acompanha o do PDF.
 */
export function formatInstrumentalLine(
  line: PdfLine
): string {
  const tokens = glueParentheses([...line.words]);

  if (tokens.length === 0) {
    return '';
  }

  let totalChars = 0;
  let totalWidth = 0;

  for (const w of tokens) {
    totalChars += w.text.length;
    totalWidth += w.x1 - w.x0;
  }

  const avgChar =
    totalChars > 0 && totalWidth > 0
      ? Math.min(9, Math.max(4.5, totalWidth / totalChars))
      : 6;

  // Agrupa "D/F# - G - A" (acordes ligados por hífen) num só colchete.
  type Piece = { text: string; x0: number; x1: number; chord: boolean };
  const pieces: Piece[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (isLooseHyphen(t.text)) {
      const prev = pieces[pieces.length - 1];
      const next = tokens[i + 1];

      if (
        prev &&
        prev.chord &&
        !BAR_SYMBOL_RE.test(prev.text) &&
        next &&
        isChordToken(next.text) &&
        !BAR_SYMBOL_RE.test(next.text)
      ) {
        prev.text += '-' + next.text;
        prev.x1 = next.x1;
        i++;
        continue;
      }

      pieces.push({ text: '-', x0: t.x0, x1: t.x1, chord: false });
      continue;
    }

    pieces.push({
      text: t.text,
      x0: t.x0,
      x1: t.x1,
      chord: isChordToken(t.text)
    });
  }

  let result = '';
  let lastEnd = pieces[0].x0;

  pieces.forEach((p, i) => {
    const gap =
      i === 0
        ? 0
        : Math.max(1, Math.round((p.x0 - lastEnd) / avgChar));

    result += ' '.repeat(gap) + (p.chord ? bracketChord(p.text) : p.text);

    lastEnd = p.x1;
  });

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
        ? bracketChord(w.text)
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

// ---------------------------------------------------------------------------
// PÁGINA INTEIRA
// ---------------------------------------------------------------------------

interface Unit {
  text: string;
  /** Y da primeira linha do bloco (a mais alta). */
  top: number;
  /** Y da última linha do bloco (a mais baixa). */
  bottom: number;
  shaded: boolean;
}

/**
 * Distância "normal" entre duas linhas consecutivas da página (usada para
 * decidir onde existe uma linha em branco de verdade entre estrofes).
 */
function typicalRowPitch(lines: PdfLine[]): number {
  const diffs: number[] = [];

  for (let i = 0; i < lines.length - 1; i++) {
    const d = lines[i].y - lines[i + 1].y;

    if (d >= 8 && d <= 40) diffs.push(d);
  }

  if (diffs.length === 0) return 18;

  diffs.sort((a, b) => a - b);

  return diffs[Math.floor(diffs.length * 0.2)];
}

/**
 * Extrai uma página inteira no formato ChordPro.
 *
 * - acordes entram dentro da palavra, na sílaba certa;
 * - linhas em branco do PDF (entre estrofes) são preservadas;
 * - blocos sobre fundo colorido (refrão/resposta) viram "Refrão:" ... "Fim",
 *   que é o padrão que o visualizador do app destaca.
 */
export function extractPageChordProText(
  lines: PdfLine[],
  pageWidth: number,
  options: { markShadedAsChorus?: boolean } = {}
): string {
  const markShaded = options.markShadedAsChorus !== false;

  // `lines` já vem ordenado por groupWordsIntoLines (que já roda
  // orderTwoColumnPage). Rodar de novo aqui desfazia a separação de
  // colunas em vez de preservá-la.
  const orderedLines = lines;

  const pitch = typicalRowPitch(orderedLines);

  const units: Unit[] = [];

  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    const next = orderedLines[i + 1];

    if (isChordLine(line)) {
      const gapToNext = next
        ? Math.abs(line.y - next.y)
        : Infinity;

      const pairsWithNext =
        !!next &&
        !isChordLine(next) &&
        gapToNext < MAX_PAIR_GAP &&
        // linhas de colunas diferentes nunca se juntam
        Math.abs(line.y - next.y) > 0.5;

      if (pairsWithNext) {
        units.push({
          text: mergeChordLyricLines(line, next),
          top: line.y,
          bottom: next.y,
          shaded: !!(line.shaded || next.shaded)
        });

        i++;
      } else {
        units.push({
          text: formatInstrumentalLine(line),
          top: line.y,
          bottom: line.y,
          shaded: !!line.shaded
        });
      }
    } else {
      units.push({
        text: formatMixedTextLine(line.words),
        top: line.y,
        bottom: line.y,
        shaded: !!line.shaded
      });
    }
  }

  // Remove rótulo repetido: "Intro Piano e Cordas:" impresso uma vez em
  // cima da partitura (imagem) e de novo na linha dos acordes.
  const dedup: Unit[] = [];

  for (let i = 0; i < units.length; i++) {
    const cur = units[i];
    const nxt = units[i + 1];

    if (
      nxt &&
      !cur.text.includes('[') &&
      cur.text.trim().length > 0 &&
      nxt.text.startsWith(cur.text.trim())
    ) {
      continue;
    }

    dedup.push(cur);
  }

  // Rótulos sem conteúdo depois deles ("Intro Guitar:", "Final:" — eram
  // títulos de partituras impressas como imagem, que não têm texto para
  // importar) ficariam soltos na cifra: removidos.
  const isOrphanLabel = (u: Unit) =>
    !u.text.includes('[') &&
    /:\s*$/.test(u.text) &&
    u.text.trim().split(/\s+/).length <= 4;

  const cleaned: Unit[] = [];

  for (let i = 0; i < dedup.length; i++) {
    const cur = dedup[i];
    const nxt = dedup[i + 1];

    if (
      isOrphanLabel(cur) &&
      (!nxt || isOrphanLabel(nxt) || cur.bottom - nxt.top > pitch * 4)
    ) {
      continue;
    }

    cleaned.push(cur);
  }

  const out: string[] = [];
  let insideShade = false;

  const closeShade = () => {
    if (insideShade) {
      out.push('Fim');
      insideShade = false;
    }
  };

  cleaned.forEach((u, i) => {
    const prev = cleaned[i - 1];

    const blankBefore =
      !!prev && prev.bottom - u.top > pitch * 1.5;

    if (markShaded) {
      if (u.shaded && !insideShade) {
        if (blankBefore && out.length > 0) out.push('');

        out.push('Refrão:');
        insideShade = true;
      } else if (!u.shaded && insideShade) {
        closeShade();

        if (blankBefore) out.push('');
      } else if (blankBefore && !insideShade && out.length > 0) {
        out.push('');
      } else if (blankBefore && insideShade) {
        // Linha em branco DENTRO do mesmo bloco colorido: mantém.
        out.push('');
      }
    } else if (blankBefore && out.length > 0) {
      out.push('');
    }

    out.push(u.text);
  });

  closeShade();

  return out.join('\n');
}

/**
 * Entrada principal da extração pré-alinhada.
 */
export async function extractPreAlignedPageText(
  page: any,
  options: { markShadedAsChorus?: boolean; ops?: any } = {}
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

  const pageHeight =
    view[3] - view[1];

  let lines =
    groupWordsIntoLines(words, pageWidth);

  lines = removeHeaderFooterLines(lines, pageHeight, view[1]);

  if (options.markShadedAsChorus !== false) {
    try {
      // `ops` só precisa ser passado fora do navegador (testes em Node);
      // no app, o mesmo módulo pdfjs-dist já carregado é reutilizado.
      const ops =
        options.ops ?? ((await import('pdfjs-dist')) as any).OPS;
      const rects = await extractShadedRects(page, ops);

      markShadedLines(lines, rects);
    } catch (err) {
      console.error('Falha ao detectar fundo colorido:', err);
    }
  }

  const text = extractPageChordProText(
    lines,
    pageWidth,
    options
  );

  // Página sem nada além de cabeçalho/rodapé e rótulos de imagens: sem
  // camada de texto útil — o importador segue o caminho normal (imagem).
  return text.trim().length > 0 ? text : null;
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
