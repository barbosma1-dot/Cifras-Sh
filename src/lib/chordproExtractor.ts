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
  y: number; // espaço do usuário do PDF (não da viewport renderizada); maior = mais alto na página
}

export interface PdfLine {
  y: number;
  words: PdfWord[];
}

// Tolerância vertical (em unidades do PDF, ~1/72 polegada) para agrupar
// palavras na mesma linha visual.
const Y_TOLERANCE = 2;

// Distância vertical máxima entre uma linha de acordes e a linha de letra
// logo abaixo dela para serem consideradas um par acorde+letra. Linhas mais
// distantes que isso são tratadas como acordes sem letra associada (linha
// instrumental) mesmo que a próxima linha do array não seja de acorde.
const MAX_PAIR_GAP = 20;

// Token de acorde: nota (A-G) + acidente opcional + qualidade opcional +
// extensão(ões) numérica(s) opcionais + alteração opcional + baixo opcional
// (/X). A versão anterior só aceitava UMA palavra de qualidade seguida de UM
// número (ex.: "Dm7"), o que rejeitava notações comuns em cifras brasileiras
// como "Dm7(9)", "F#m7b5", "A7M", "Bb7b5", "Ddim°" — tokens que caíam fora do
// padrão eram tratados como texto solto, e a linha inteira deixava de ser
// reconhecida como linha de acordes (limiar de 80% em isChordLine), fazendo
// os acordes dela "sumirem" (saírem sem colchete) na importação. Esta versão
// é bem mais permissiva nas extensões/alterações, mantendo a raiz A-G como
// âncora obrigatória — por isso não gera falsos positivos em palavras comuns
// da letra (testado contra "Amor", "Deus", "Se", "Ela" etc.).
const ROOT = '[A-G](?:#|b|♯|♭)?';
const QUALITY =
  '(?:maj7|Maj7|MAJ7|m7b5|m7#5|dim7|sus2|sus4|add\\d{1,2}|maj|min|dim|aug|sus|add|no|[mM])?';
const EXTENSION = '(?:[#b]?\\d{1,2}){0,2}'; // 7, 9, 11, 13, b5, #11, 7b5...
const EXTRA_MAJOR = '(?:M)?'; // notação "7M" (maior com sétima)
const DIM_SYMBOL = '(?:°|º|ø)?';
const ALTERATION = '(?:\\(\\s*[#b]?\\d{1,2}[+-]?\\s*\\)|[+-])?'; // (9), (b5), (#11), +5, -5
const BASS = `(?:\\/${ROOT}\\d{0,2})?`; // /G, /F#, /A7 (baixo com extensão, raro mas ocorre)

const CHORD_TOKEN_RE = new RegExp(
  `^\\(?${ROOT}${QUALITY}${EXTENSION}${EXTRA_MAJOR}${DIM_SYMBOL}${ALTERATION}${BASS}\\)?$`
);
// Símbolos comuns em grades de acordes por compasso (a skill trata como
// "acordes" para fins de agrupamento em linha instrumental).
const BAR_SYMBOL_RE = /^[|%]+$/;

function isChordToken(text: string): boolean {
  return CHORD_TOKEN_RE.test(text) || BAR_SYMBOL_RE.test(text);
}

function isLooseHyphen(text: string): boolean {
  // Um "-" isolado é normalmente só o conector visual entre acordes vizinhos
  // no PDF original (ex: "D/F# - G - A"), não uma informação musical nova —
  // mesma regra da skill (item 6 da regra crítica nº0).
  return text === '-' || text === '–' || text === '—';
}

/**
 * Extrai as palavras de uma página do pdf.js com sua posição x0/x1/y real,
 * dividindo itens de texto que contenham mais de uma palavra e estimando a
 * posição de cada uma proporcionalmente ao deslocamento de caracteres dentro
 * do item (pdf.js normalmente já separa por palavra/trecho, mas isso cobre o
 * caso de um item conter mais de uma).
 */
export async function extractPageWords(page: any): Promise<PdfWord[]> {
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
      const wx0 = x0 + (charStart / totalLen) * totalWidth;
      const wx1 = x0 + (charEnd / totalLen) * totalWidth;
      words.push({ text: m[0], x0: wx0, x1: wx1, y });
    }
  }

  return words;
}

/**
 * Heurística para decidir se a página tem camada de texto confiável (cifra
 * digital) ou não (escaneada/foto). Abaixo desse número de palavras, melhor
 * cair no fluxo de imagem + IA com visão.
 */
export function hasReliableTextLayer(words: PdfWord[]): boolean {
  return words.length >= 15;
}

/** Agrupa palavras soltas em linhas (mesmo y, com tolerância), ordenadas de cima pra baixo e da esquerda pra direita. */
export function groupWordsIntoLines(words: PdfWord[]): PdfLine[] {
  const sorted = [...words].sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const lines: PdfLine[] = [];

  for (const w of sorted) {
    let line = lines.find(l => Math.abs(l.y - w.y) <= Y_TOLERANCE);
    if (!line) {
      line = { y: w.y, words: [] };
      lines.push(line);
    }
    line.words.push(w);
  }

  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) l.words.sort((a, b) => a.x0 - b.x0);
  return lines;
}

function isChordLine(line: PdfLine): boolean {
  const relevant = line.words.filter(w => !isLooseHyphen(w.text));
  if (relevant.length === 0) return false;
  const chordish = relevant.filter(w => isChordToken(w.text));
  // Maioria (não 100%, pra tolerar hífens/anotações soltas) dos tokens da
  // linha parecem acordes.
  return chordish.length / relevant.length >= 0.8;
}

/**
 * Funde uma linha de acordes com a linha de letra logo abaixo, inserindo cada
 * acorde em colchetes imediatamente antes da palavra sobre a qual ele caía
 * visualmente no PDF original — regra central da skill, calculada aqui por
 * coordenada em vez de julgamento visual de IA.
 */
export function mergeChordLyricLines(chordLine: PdfLine, lyricLine: PdfLine): string {
  const lyricWords = lyricLine.words;
  const chordTokens = chordLine.words.filter(w => !isLooseHyphen(w.text));
  const assignments = new Map<number, string[]>();

  for (const chord of chordTokens) {
    // 1) a palavra de letra cujo intervalo [x0,x1] contém o x0 do acorde
    let idx = lyricWords.findIndex(w => chord.x0 >= w.x0 && chord.x0 < w.x1);
    // 2) senão, a primeira palavra seguinte com x0 >= x0 do acorde
    if (idx === -1) idx = lyricWords.findIndex(w => w.x0 >= chord.x0);
    // 3) senão, a última palavra da linha (acorde "sobrando" no fim, comum em
    //    codas/fins de frase — mesmo fallback da skill)
    if (idx === -1) idx = lyricWords.length - 1;
    if (idx < 0) continue;

    if (!assignments.has(idx)) assignments.set(idx, []);
    assignments.get(idx)!.push(chord.text);
  }

  let result = '';
  lyricWords.forEach((w, i) => {
    const chords = assignments.get(i);
    if (chords && chords.length > 0) {
      // Múltiplos acordes na mesma palavra ficam agrupados com hífen, na
      // ordem em que apareceram (ex: [G-A-Bm]).
      result += `[${chords.join('-')}]`;
    }
    result += w.text;
    if (i < lyricWords.length - 1) result += ' ';
  });

  return result;
}

/**
 * Formata uma linha de acordes SEM letra associada (intro/solo/ponte, ou
 * grade de acordes por compasso) — cada elemento (acorde, "|", "%") em seu
 * próprio colchete, preservando o espaçamento horizontal aproximado do PDF
 * original para representar o tempo rítmico.
 */
export function formatInstrumentalLine(line: PdfLine): string {
  const tokens = line.words.filter(w => !isLooseHyphen(w.text));
  if (tokens.length === 0) return '';

  const AVG_CHAR_WIDTH = 6; // estimativa; só precisa preservar espaçamento relativo
  let result = '';
  let lastEnd = tokens[0].x0;

  tokens.forEach((w, i) => {
    const gap = i === 0 ? 0 : Math.max(1, Math.round((w.x0 - lastEnd) / AVG_CHAR_WIDTH));
    result += ' '.repeat(gap) + `[${w.text}]`;
    lastEnd = w.x1;
  });

  return result;
}

/**
 * Monta o texto ChordPro (já com os acordes posicionados corretamente) de uma
 * página inteira, a partir das linhas agrupadas por `groupWordsIntoLines`.
 * Detecta duas colunas (regra 5 da skill): se nenhuma linha cruza o centro da
 * página, lê a coluna esquerda inteira antes da direita.
 */
export function extractPageChordProText(lines: PdfLine[], pageWidth: number): string {
  const mid = pageWidth / 2;
  const crossesMid = lines.some(l => l.words.some(w => w.x0 < mid - 10 && w.x1 > mid + 10));

  let orderedLines: PdfLine[];
  if (!crossesMid && lines.length > 4) {
    const left = lines
      .map(l => ({ y: l.y, words: l.words.filter(w => w.x0 < mid) }))
      .filter(l => l.words.length > 0);
    const right = lines
      .map(l => ({ y: l.y, words: l.words.filter(w => w.x0 >= mid) }))
      .filter(l => l.words.length > 0);
    orderedLines = [...left, ...right];
  } else {
    orderedLines = lines;
  }

  const outputLines: string[] = [];
  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    const next = orderedLines[i + 1];

    if (isChordLine(line)) {
      const gapToNext = next ? Math.abs(line.y - next.y) : Infinity;
      const pairsWithNext = !!next && !isChordLine(next) && gapToNext < MAX_PAIR_GAP;

      if (pairsWithNext) {
        outputLines.push(mergeChordLyricLines(line, next!));
        i++; // já consumiu a linha de letra correspondente
      } else {
        outputLines.push(formatInstrumentalLine(line));
      }
    } else {
      outputLines.push(line.words.map(w => w.text).join(' '));
    }
  }

  return outputLines.join('\n');
}

/**
 * Ponto de entrada único: recebe uma página do pdf.js e devolve o texto
 * ChordPro pré-alinhado da página, ou `null` se a página não tiver camada de
 * texto confiável (nesse caso, o chamador deve usar o fluxo de imagem + IA).
 */
export async function extractPreAlignedPageText(page: any): Promise<string | null> {
  const words = await extractPageWords(page);
  if (!hasReliableTextLayer(words)) return null;

  const lines = groupWordsIntoLines(words);
  // page.view = [x0, y0, x1, y1] no espaço do usuário do PDF (não escalado
  // pela viewport de renderização) — mesma unidade usada em x0/x1/y das
  // palavras acima, por isso usamos ele (e não viewport.width) para achar o
  // centro real da página.
  const view = page.view as number[];
  const pageWidth = view[2] - view[0];

  return extractPageChordProText(lines, pageWidth);
}

// ---------------------------------------------------------------------------
// MODO OFÍCIO/LAUDES: segmentação determinística de uma página de Liturgia
// das Horas em peças separadas (Invitatório, Hino, cada Salmo, cada Cântico,
// Leitura breve, Responsório breve, Preces, Oração...), SEM passar pela IA
// para o conteúdo cifrado.
//
// Motivação: em páginas muito densas (várias peças, várias com dezenas de
// versículos repetitivos), o modelo de IA "resumia" ou pulava trechos mesmo
// com instruções explícitas contra isso — um problema conhecido de modelos
// leves em transcrição longa. Como a camada de texto do PDF já dá a posição
// exata de cada palavra e cada acorde (ver `extractPageChordProText` acima),
// não há necessidade de pedir pra um modelo de linguagem "regenerar" esse
// conteúdo do zero — só copiar. Este segmentador faz isso deterministicamente
// via regex sobre os cabeçalhos impressos, sem risco de omitir versículo.
//
// É heurístico (como o resto deste arquivo) e assume o vocabulário comum de
// cabeçalhos da Liturgia das Horas em português. Só é chamado quando o modo
// "Ofício/Laudes" está ligado no importador; fora dele, o fluxo antigo
// (imagem + IA) continua sendo usado.

export interface LiturgySection {
  title: string;
  hasChords: boolean;
  contentLines: string[];
}

const HEADING_RE = {
  dayHeader: /^(I{1,3}|IV|VI{0,3}|V)\s+(DOMINGO|SEGUNDA-FEIRA|TER[ÇC]A-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|S[ÁA]BADO)\.?$/i,
  invitatorio: /^Invitat[oó]rio$/i,
  hino: /^H[Ii]no$/,
  salmodia: /^Salmodia$/i,
  salmo: /^Salmo\s+\d/i,
  cantico: /^C[âa]ntico\b/i,
  leitura: /^Leitura breve\b/i,
  responsorio: /^Respons[oó]rio breve\b/i,
  preces: /^Preces$/i,
  oracao: /^Ora[cç][ãa]o$/i,
  antifona: /^Ant\.?\s*\d*\b/i,
  altVersion: /^\(\s*\d+[ªa]\s*(op[cç][ãa]o|melodia)\s*\)$/i,
};

function isAnyHeadingLine(text: string): boolean {
  return Object.values(HEADING_RE).some(re => re.test(text));
}

/**
 * Segmenta as linhas já ordenadas (mesma ordenação de coluna usada em
 * `extractPageChordProText`) de uma página de Ofício em peças separadas.
 */
export function segmentLiturgyOfHoursPage(lines: PdfLine[], pageWidth: number): LiturgySection[] {
  const mid = pageWidth / 2;
  const crossesMid = lines.some(l => l.words.some(w => w.x0 < mid - 10 && w.x1 > mid + 10));

  let orderedLines: PdfLine[];
  if (!crossesMid && lines.length > 4) {
    const left = lines
      .map(l => ({ y: l.y, words: l.words.filter(w => w.x0 < mid) }))
      .filter(l => l.words.length > 0);
    const right = lines
      .map(l => ({ y: l.y, words: l.words.filter(w => w.x0 >= mid) }))
      .filter(l => l.words.length > 0);
    orderedLines = [...left, ...right];
  } else {
    orderedLines = lines;
  }

  const sections: LiturgySection[] = [];
  let current: LiturgySection | null = null;
  let currentIsPsalmType = false;
  let bodyStarted = false;
  let pendingAntiphonLines: string[] = [];
  let skippingAltVersion = false;
  let sawAltVersionMarkerOnce = false;
  let checkNextLineForSubtitle = false;

  const closeCurrent = () => {
    if (current && current.contentLines.length > 0) sections.push(current);
    current = null;
    bodyStarted = false;
    currentIsPsalmType = false;
    skippingAltVersion = false;
    sawAltVersionMarkerOnce = false;
    checkNextLineForSubtitle = false;
  };

  const startSection = (title: string, isPsalmType: boolean) => {
    closeCurrent();
    current = { title, hasChords: isPsalmType, contentLines: [] };
    if (isPsalmType && pendingAntiphonLines.length > 0) {
      current.contentLines.push(...pendingAntiphonLines);
      pendingAntiphonLines = [];
    }
    currentIsPsalmType = isPsalmType;
    bodyStarted = false;
    checkNextLineForSubtitle = isPsalmType;
  };

  for (let i = 0; i < orderedLines.length; i++) {
    const line = orderedLines[i];
    const next = orderedLines[i + 1];
    const plainText = line.words.map(w => w.text).join(' ').trim();
    const chordLine = isChordLine(line);

    if (!chordLine && HEADING_RE.dayHeader.test(plainText)) continue;
    if (!chordLine && HEADING_RE.salmodia.test(plainText)) continue;

    if (!chordLine && HEADING_RE.invitatorio.test(plainText)) { startSection('Invitatório', false); continue; }
    if (!chordLine && HEADING_RE.hino.test(plainText)) { startSection('Hino', true); continue; }
    if (!chordLine && HEADING_RE.salmo.test(plainText)) {
      startSection(plainText.split(',')[0].trim(), true);
      continue;
    }
    if (!chordLine && HEADING_RE.cantico.test(plainText)) { startSection(plainText, true); continue; }
    if (!chordLine && HEADING_RE.leitura.test(plainText)) { startSection(plainText, false); continue; }
    if (!chordLine && HEADING_RE.responsorio.test(plainText)) { startSection(plainText, false); continue; }
    if (!chordLine && HEADING_RE.preces.test(plainText)) { startSection('Preces', false); continue; }
    if (!chordLine && HEADING_RE.oracao.test(plainText)) { startSection('Oração', false); continue; }

    if (!chordLine && HEADING_RE.antifona.test(plainText)) {
      if (currentIsPsalmType && bodyStarted) {
        // fechamento: a mesma antífona reimpressa depois do salmo/cântico —
        // entra como últimas linhas da peça que está fechando, não vira item novo.
        current!.contentLines.push(plainText);
        closeCurrent();
      } else {
        // abertura: fica pendente até a próxima peça com acorde (Salmo/Cântico).
        pendingAntiphonLines.push(plainText);
      }
      continue;
    }

    if (!chordLine && HEADING_RE.altVersion.test(plainText)) {
      if (!sawAltVersionMarkerOnce) {
        sawAltVersionMarkerOnce = true; // entrando na 1ª opção/melodia — mantém coletando
      } else {
        skippingAltVersion = true; // 2ª opção em diante — pula até o próximo cabeçalho
      }
      continue;
    }

    if (skippingAltVersion) continue;

    // Uma linha de subtítulo temático (itálico, sem acorde) pode vir logo após o
    // cabeçalho "Salmo N"/"Cântico" e antes do corpo cifrado — não faz parte do
    // conteúdo cantado, então é descartada (só quando a linha seguinte já é de
    // acorde, confirmando que o corpo começa logo em seguida).
    if (checkNextLineForSubtitle) {
      checkNextLineForSubtitle = false;
      if (!chordLine && next && isChordLine(next)) continue;
    }

    if (!current) continue; // conteúdo antes de qualquer cabeçalho reconhecido — ignora

    if (chordLine) {
      const gapToNext = next ? Math.abs(line.y - next.y) : Infinity;
      const nextPlainText = next ? next.words.map(w => w.text).join(' ').trim() : '';
      const nextIsHeading = !!next && !isChordLine(next) && isAnyHeadingLine(nextPlainText);
      const pairsWithNext = !!next && !isChordLine(next) && gapToNext < MAX_PAIR_GAP && !nextIsHeading;

      if (pairsWithNext) {
        current.contentLines.push(mergeChordLyricLines(line, next!));
        i++;
      } else {
        current.contentLines.push(formatInstrumentalLine(line));
      }
      bodyStarted = true;
    } else {
      current.contentLines.push(plainText);
      bodyStarted = true;
    }
  }

  closeCurrent();
  return sections;
}
