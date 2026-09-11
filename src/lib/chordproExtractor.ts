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

// Em algumas peças (sobretudo antífonas e cânticos em prosa "corrida"), o
// acorde não fica numa linha própria acima da letra — ele é digitado dentro
// da própria linha de texto, na mesma altura de base (ex.: PDF traz "a
// noiva, a" e "F", "C/E", "D" todos no mesmo y, antes de "esposa do
// Cordeiro!" continuar na linha seguinte). Como isChordLine só reconhece uma
// linha inteira majoritariamente feita de acordes (>=80%), essas linhas
// mistas (poucos tokens de acorde perdidos em meio a muita letra) nunca
// batem no critério e caíam direto como texto puro — os acordes apareciam
// soltos, sem colchete ("...a F C/E D esposa...") em vez de convertidos pro
// formato ChordPro ("...a [F][C/E][D] esposa..."). Esta função varre
// qualquer linha (mista ou não) e colcheta cada token que parece acorde.
//
// Exceção: a raiz isolada "A" ou "E" sozinha (sem qualidade/extensão) quase
// sempre é o artigo/conjunção comum do português ("A cifra...", "E o
// Senhor...") e não um acorde real; fora de uma linha de acorde dedicada
// (que já teria sido tratada por isChordLine/mergeChordLyricLines antes de
// chegar aqui), colchetar esses dois de forma solta gera mais falso positivo
// do que acerto, então ficam de fora.
const AMBIGUOUS_ALONE_ROOT = /^[AE]$/;

export function formatMixedTextLine(words: PdfWord[]): string {
  return words
    .map(w => (isChordToken(w.text) && !AMBIGUOUS_ALONE_ROOT.test(w.text) ? `[${w.text}]` : w.text))
    .join(' ')
    .trim();
}

/**
 * Extrai a primeira linha de letra "de verdade" (sem colchete de acorde) do
 * conteúdo já segmentado de uma peça — usada para compor o incipit no título
 * (ex.: "Hino — Ó Criador do Universo"). Pula linhas puramente instrumentais
 * (só "[|]"/"[%]"/acordes soltos, sem nenhuma letra) e linhas em branco. Corta
 * em ~50 caracteres para não estourar o título com um verso inteiro longo.
 */
export function extractFirstLyricLine(contentLines: string[]): string {
  for (const raw of contentLines) {
    const plain = raw.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
    const lettersOnly = plain.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z]/g, '');
    if (lettersOnly.length < 2) continue; // sem letra de verdade — pula (ex.: linha só de acorde)
    return plain.length > 50 ? `${plain.slice(0, 50).trim()}…` : plain;
  }
  return '';
}

// Vão mínimo (em unidades do PDF) exigido bem no centro da página para
// considerar que ali existe um "gutter" real de duas colunas — ver
// `splitLineAtGutter`/`orderLinesByColumn` logo abaixo para a explicação
// completa do bug que isso corrige. Calibrado contra as coordenadas reais de
// páginas de Ofício/Laudes: vãos de coluna genuínos medidos ficaram entre
// ~20 e ~280 unidades; o maior "quase-cruzamento" de cabeçalho/rodapé de
// largura total medido (texto corrido de uma linha só, sem coluna nenhuma)
// ficou em ~4 unidades (o espaço normal entre duas palavras vizinhas que por
// coincidência caem uma de cada lado do centro). 15 fica com folga segura
// entre os dois grupos nos casos reais observados.
const MID_GUTTER_THRESHOLD = 15;

/**
 * Se `line` tiver um vão vazio de pelo menos `MID_GUTTER_THRESHOLD` unidades
 * bem no meio da página (nenhuma palavra ali, uma parte inteira de palavras
 * terminando antes do centro e a próxima só começando bem depois dele),
 * devolve as palavras já divididas em esquerda/direita. Caso contrário (linha
 * de largura total sem vão real no centro — cabeçalho/rodapé corrente, texto
 * corrido de página de coluna única etc.), devolve `null` e a linha NÃO deve
 * ser dividida.
 */
function splitLineAtGutter(line: PdfLine, mid: number): { left: PdfWord[]; right: PdfWord[] } | null {
  const sorted = [...line.words].sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (a.x1 <= mid && b.x0 >= mid && b.x0 - a.x1 >= MID_GUTTER_THRESHOLD) {
      return { left: sorted.slice(0, i + 1), right: sorted.slice(i + 1) };
    }
  }
  return null;
}

/**
 * Reordena as linhas de uma página em ordem de leitura real, respeitando
 * layout de duas colunas quando ele realmente existir (regra 5 da skill).
 *
 * BUG CORRIGIDO — o primeiro dos "dois bugs em cadeia" deste arquivo: a
 * versão anterior decidia "a página inteira tem duas colunas?" checando se
 * ALGUMA PALAVRA cruzava sozinha o centro da página (x0 antes do meio E x1
 * depois do meio, dentro da MESMA palavra) — sinal pensado para achar um
 * título largo centralizado tipo "II SEXTA-FEIRA — LAUDES" e, ao achar,
 * tratar a página como coluna única (não dividir). O problema: esse
 * cabeçalho corrente se repete em TODA página do documento (e o rodapé com o
 * nome da peça também), então essa checagem batia sempre — a página NUNCA
 * era dividida em colunas, mesmo quando o corpo da peça genuinamente usava
 * duas colunas lado a lado (ex.: duas harmonizações diferentes do Salmo
 * 50(51), ou do Salmo 147 B) — os acordes de uma coluna eram então lidos ao
 * lado da letra da OUTRA coluna, produzindo cifra fora de ordem/desalinhada.
 *
 * A correção: em vez de uma decisão única "página inteira tem 2 colunas?",
 * decide LINHA A LINHA se aquela linha específica tem um vão real de coluna
 * bem no centro (ver `splitLineAtGutter`). Um cabeçalho largo centralizado
 * não tem esse vão (a própria palavra ocupa o centro, ou — no caso do
 * rodapé — há só o espaço normal de ~2-4 unidades entre duas palavras
 * vizinhas); linhas de corpo em duas colunas genuínas, medidas neste
 * documento, têm vãos de ~20 a ~280 unidades no centro. Linhas sem vão real
 * passam intactas, na ordem original (preservando cabeçalho/rodapé
 * corrente inteiros, sem fragmentar); sequências consecutivas de linhas COM
 * vão são acumuladas e, ao encontrar a próxima linha sem vão (ou o fim da
 * página), a coluna esquerda acumulada é despejada inteira antes da
 * direita, reiniciando o acúmulo depois. Isso cobre o caso comum de um
 * cabeçalho/rodapé de largura total entre (ou ao redor) de blocos de duas
 * colunas sem embaralhar a ordem de leitura de cada coluna.
 *
 * Limitação aceita (rara, cosmética): se uma linha do fim de uma coluna não
 * tiver nenhuma palavra correspondente na outra coluna naquela altura (uma
 * coluna terminou um pouco antes/depois da outra bem no fim da página), ela
 * não tem vão pra detectar e acaba sendo despejada como linha solta na
 * posição em que aparece, em vez de anexada ao fim da coluna a que
 * pertence — na prática, um verso residual de 1 linha pode ficar deslocado
 * bem no fim da página nesse caso extremo.
 */
function orderLinesByColumn(lines: PdfLine[], pageWidth: number): PdfLine[] {
  const mid = pageWidth / 2;
  const result: PdfLine[] = [];
  let leftBuf: PdfLine[] = [];
  let rightBuf: PdfLine[] = [];

  const flush = () => {
    result.push(...leftBuf, ...rightBuf);
    leftBuf = [];
    rightBuf = [];
  };

  for (const line of lines) {
    const split = splitLineAtGutter(line, mid);
    if (split) {
      leftBuf.push({ y: line.y, words: split.left });
      rightBuf.push({ y: line.y, words: split.right });
    } else {
      flush();
      result.push(line);
    }
  }
  flush();

  return result;
}

/**
 * Monta o texto ChordPro (já com os acordes posicionados corretamente) de uma
 * página inteira, a partir das linhas agrupadas por `groupWordsIntoLines`.
 */
export function extractPageChordProText(lines: PdfLine[], pageWidth: number): string {
  const orderedLines = orderLinesByColumn(lines, pageWidth);

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
      outputLines.push(formatMixedTextLine(line.words));
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
  // Marca Leitura breve / Preces / Oração — os trechos "Próprios do Dia" do
  // Ofício, que mudam a cada dia da semana e por isso levam o dia no título
  // (ver isProperOfTheDay em startSection e o uso em PDFImporter.tsx).
  isProperOfDay?: boolean;
}

// "I TERÇA-FEIRA" (como sai do PDF, maiúsculo) -> "I Terça-feira" (título legível).
const DAY_NAME_CANON: Record<string, string> = {
  'DOMINGO': 'Domingo',
  'SEGUNDA-FEIRA': 'Segunda-feira',
  'TERÇA-FEIRA': 'Terça-feira',
  'TERCA-FEIRA': 'Terça-feira',
  'QUARTA-FEIRA': 'Quarta-feira',
  'QUINTA-FEIRA': 'Quinta-feira',
  'SEXTA-FEIRA': 'Sexta-feira',
  'SÁBADO': 'Sábado',
  'SABADO': 'Sábado',
};

function normalizeDayHeader(romanNumeral: string, dayName: string): string {
  const canon = DAY_NAME_CANON[dayName.toUpperCase()] || dayName;
  return `${romanNumeral.toUpperCase()} ${canon}`;
}

const HEADING_RE = {
  // Aceita tanto o cabeçalho "puro" ("II Sexta-feira") quanto o formato de
  // cabeçalho corrente de página usado neste PDF, que traz a hora litúrgica
  // colada em seguida com um travessão ("II SEXTA-FEIRA — LAUDES",
  // "I TERÇA-FEIRA — VÉSPERAS" etc.). Sem o sufixo opcional abaixo, essa
  // linha nunca batia com o regex (por causa do "$" logo após o nome do dia)
  // e por isso: 1) o dia nunca era capturado, então Preces/Oração/Leitura
  // breve/Responsório breve/Cântico evangélico nunca levavam o dia no título;
  // e 2) a linha não reconhecida caía no branch genérico de conteúdo e
  // poluía a peça que estivesse aberta naquele momento.
  dayHeader:
    /^(I{1,3}|IV|VI{0,3}|V)\s+(DOMINGO|SEGUNDA-FEIRA|TER[ÇC]A-FEIRA|QUARTA-FEIRA|QUINTA-FEIRA|SEXTA-FEIRA|S[ÁA]BADO)\b(?:\s*[—–-].*)?\.?$/i,
  invitatorio: /^Invitat[oó]rio$/i,
  hino: /^Hino$/i,
  salmodia: /^Salmodia$/i,
  salmo: /^Salmo\s+\d/i,
  // "Cântico evangélico" (Benedictus/Magnificat) é checado ANTES do genérico
  // "cantico" abaixo — sua antífona muda a cada dia do Ofício (é o Próprio do
  // Dia, como Leitura/Preces/Oração), diferente dos demais cânticos da
  // Salmodia, que seguem o saltério fixo e por isso levam incipit, não dia.
  canticoEvangelico: /^C[âa]ntico\s+evang[eé]lico\b/i,
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
// Quando um Salmo/Cântico/Hino atravessa uma quebra de página SEM repetir o
// cabeçalho na página seguinte (comum em Ofício/Laudes — ex.: "Salmo 32(33)"
// continua na página seguinte só com linhas de acorde+letra, sem reimprimir
// "Salmo 32(33)"), passe aqui o título/tipo da última peça ainda "aberta" da
// página anterior (ver `previousPageLastTitleRaw`/categoria em
// PDFImporter.tsx). Sem isso, `current` começa null nesta página e as linhas
// iniciais (sem cabeçalho reconhecido) caem no `if (!current) continue`
// abaixo e são DESCARTADAS silenciosamente — era esse o bug real por trás de
// estrofes/salmos inteiros sumindo quando a peça começava numa página e
// terminava na seguinte. Com o carryOver, a peça desta página nasce com o
// MESMO título da anterior, o que também faz a fusão por título já existente
// em PDFImporter.tsx (comparação com `previousPageLastTitleKey`) funcionar
// automaticamente — não precisou mexer na lógica de fusão, só parar de
// perder o conteúdo aqui.
// Retorno inclui o título do dia (ex.: "I Terça-feira") detectado nesta
// página, ou null se a página não trouxe cabeçalho de dia — nesse caso o
// chamador deve repassar o último título de dia conhecido como
// `carryOverDayTitle` na chamada da próxima página (o cabeçalho só aparece
// uma vez, na primeira página de cada dia).
export interface LiturgyPageResult {
  sections: LiturgySection[];
  dayTitle: string | null;
  // Antífona de ABERTURA lida nesta página mas ainda não anexada a nenhum
  // Salmo/Cântico — acontece quando a antífona é a(s) última(s) linha(s) da
  // página e o cabeçalho do Salmo/Cântico que ela introduz só aparece na
  // página seguinte (comum quando a quebra de página cai bem entre a
  // antífona e o corpo cifrado). Sem repassar isso pro `carryOverPendingAntiphon`
  // da PRÓXIMA chamada, essa antífona era descartada silenciosamente — o
  // Salmo/Cântico nascia sem ela, e a antífona "sumia" (ou, pior, quando a
  // IA/outro fluxo reprocessava essa mesma antífona solta, ela podia virar
  // uma cifra própria). Vazio quando toda antífona lida nesta página já foi
  // consumida por uma peça iniciada na mesma página.
  pendingAntiphon: string[];
}

export function segmentLiturgyOfHoursPage(
  lines: PdfLine[],
  pageWidth: number,
  carryOverSection?: { title: string; hasChords: boolean } | null,
  carryOverDayTitle?: string | null,
  carryOverPendingAntiphon?: string[] | null
): LiturgyPageResult {
  // Mesma correção de detecção de colunas usada em `extractPageChordProText`
  // — ver comentário completo em `orderLinesByColumn` acima. Sem isso, esta
  // função (que roda o mesmo "orderedLines" através da máquina de estados de
  // segmentação abaixo) sofria do mesmo bug: cabeçalho/rodapé corrente
  // presente em toda página fazia a página nunca ser dividida em colunas,
  // então o corpo de peças em duas colunas genuínas (Salmo 50(51), Salmo 147
  // B) era lido fora de ordem.
  const orderedLines = orderLinesByColumn(lines, pageWidth);

  const sections: LiturgySection[] = [];
  let current: LiturgySection | null = carryOverSection
    ? { title: carryOverSection.title, hasChords: carryOverSection.hasChords, contentLines: [] }
    : null;
  let currentIsPsalmType = carryOverSection?.hasChords ?? false;
  let bodyStarted = !!carryOverSection; // já estava "no meio" da peça ao virar a página
  let pendingAntiphonLines: string[] = carryOverPendingAntiphon ? [...carryOverPendingAntiphon] : [];
  let skippingAltVersion = false;
  let sawAltVersionMarkerOnce = false;
  let checkNextLineForSubtitle = false;
  let dayTitle: string | null = carryOverDayTitle ?? null;

  const closeCurrent = () => {
    if (current && current.contentLines.length > 0) sections.push(current);
    current = null;
    bodyStarted = false;
    currentIsPsalmType = false;
    skippingAltVersion = false;
    sawAltVersionMarkerOnce = false;
    checkNextLineForSubtitle = false;
  };

  const startSection = (title: string, isPsalmType: boolean, isProperOfDay = false) => {
    closeCurrent();
    current = { title, hasChords: isPsalmType, contentLines: [], isProperOfDay };
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

    if (!chordLine) {
      const dayMatch = plainText.match(HEADING_RE.dayHeader);
      if (dayMatch) { dayTitle = normalizeDayHeader(dayMatch[1], dayMatch[2]); continue; }
    }
    if (!chordLine && HEADING_RE.salmodia.test(plainText)) continue;

    if (!chordLine && HEADING_RE.invitatorio.test(plainText)) { startSection('Invitatório', false); continue; }
    if (!chordLine && HEADING_RE.hino.test(plainText)) { startSection('Hino', true); continue; }
    if (!chordLine && HEADING_RE.salmo.test(plainText)) {
      startSection(plainText.split(',')[0].trim(), true);
      continue;
    }
    if (!chordLine && HEADING_RE.canticoEvangelico.test(plainText)) { startSection(plainText, true, true); continue; }
    if (!chordLine && HEADING_RE.cantico.test(plainText)) { startSection(plainText, true); continue; }
    // Leitura breve / Responsório breve / Preces / Oração são o "Próprio do
    // Dia": texto que muda a cada dia da semana. Marcadas com
    // isProperOfDay=true para o chamador (PDFImporter.tsx) acrescentar o dia
    // no título e na categoria.
    if (!chordLine && HEADING_RE.leitura.test(plainText)) { startSection(plainText, false, true); continue; }
    if (!chordLine && HEADING_RE.responsorio.test(plainText)) { startSection(plainText, false, true); continue; }
    if (!chordLine && HEADING_RE.preces.test(plainText)) { startSection('Preces', false, true); continue; }
    if (!chordLine && HEADING_RE.oracao.test(plainText)) { startSection('Oração', false, true); continue; }

    if (!chordLine && HEADING_RE.antifona.test(plainText)) {
      if (currentIsPsalmType && bodyStarted) {
        // fechamento: a mesma antífona reimpressa depois do corpo do
        // salmo/cântico — entra como últimas linhas da peça que está
        // fechando, não vira item novo.
        current!.contentLines.push(formatMixedTextLine(line.words));
        closeCurrent();
      } else if (current && currentIsPsalmType) {
        // BUG CORRIGIDO — o segundo dos "dois bugs em cadeia" deste arquivo:
        // abertura de uma peça que JÁ ESTÁ ABERTA nesta mesma página (o
        // cabeçalho "Salmo N"/"Cântico" acabou de ser lido por `startSection`
        // logo acima; `current` existe, mas o corpo cifrado ainda não
        // começou, por isso `bodyStarted` é false). Antes, esse caso caía no
        // mesmo `else` genérico usado para antífona "solta" (quando NENHUMA
        // peça está aberta ainda e o cabeçalho só aparece na página
        // seguinte) — a antífona de abertura era desviada pra fila global
        // `pendingAntiphonLines` em vez de virar conteúdo da peça que já
        // estava aberta. Essa fila só é consumida no próximo `startSection`,
        // então a antífona acabava grudada na peça ERRADA (a seguinte) ou,
        // se nenhuma outra peça aparecesse depois na mesma página, sumia da
        // peça atual — e ao ser reprocessada solta em outro fluxo, podia
        // virar uma cifra própria (era essa a causa de antífonas surgindo
        // como itens separados no caderno). Correção: entra direto no
        // conteúdo da peça atual. Marcamos `bodyStarted = true` para que, se
        // essa MESMA antífona for reimpressa mais adiante (fechamento), a
        // condição acima já a reconheça corretamente.
        current.contentLines.push(formatMixedTextLine(line.words));
        bodyStarted = true;
      } else {
        // abertura genuína "solta": nenhuma peça aberta ainda nesta página
        // (o cabeçalho do Salmo/Cântico que essa antífona introduz só vai
        // aparecer na página seguinte) — fica pendente até lá.
        pendingAntiphonLines.push(formatMixedTextLine(line.words));
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
      // BUG ADICIONAL encontrado ao validar a correção acima contra o PDF
      // real (não fazia parte dos dois bugs em cadeia originais, mas causava
      // o mesmo sintoma de "cifra confusa"): `formatMixedTextLine` colcheta
      // qualquer token que passe no regex de acorde, mesmo em peças SEM
      // acorde nenhum (Leitura breve/Responsório breve/Preces/Oração, com
      // `hasChords: false`) — texto corrido em português tem palavras curtas
      // que coincidem com nomes de acorde (o exemplo real deste PDF:
      // "Em" — preposição comum — bate com o acorde "Mi menor"), e essas
      // peças viravam prosa com colchetes soltos tipo "[Em] vossas mãos,
      // Senhor...". Só formata como ChordPro quando a peça atual realmente
      // tem acorde; senão mantém o texto puro da linha.
      current.contentLines.push(current.hasChords ? formatMixedTextLine(line.words) : plainText);
      bodyStarted = true;
    }
  }

  closeCurrent();
  return { sections, dayTitle, pendingAntiphon: pendingAntiphonLines };
}
