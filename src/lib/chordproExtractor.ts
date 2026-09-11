import type {
  ChordProSong,
  ChordProLine,
  ChordProWord,
} from "../types";

interface ExtractedLine {
  words: ChordProWord[];
  isChordLine?: boolean;
}

interface SectionState {
  title: string;
  type: string;
  contentLines: ChordProLine[];
}

const CHORD_RE =
  /^(?:[A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?[0-9]*(?:\/[A-G](?:#|b)?)?(?:\([^)]*\))?|N\.?C\.?)$/i;

const CHORD_TOKEN_RE =
  /(?:^|\s)([A-G](?:#|b)?(?:m|maj|min|dim|aug|sus|add)?[0-9]*(?:\/[A-G](?:#|b)?)?(?:\([^)]*\))?|N\.?C\.?)(?=\s|$)/gi;

const SECTION_PATTERNS: Array<{
  type: string;
  regex: RegExp;
}> = [
  {
    type: "hino",
    regex: /^Hino\b/i,
  },
  {
    type: "psalm",
    regex: /^Salmo\b/i,
  },
  {
    type: "canticle",
    regex: /^Cântico\b/i,
  },
  {
    type: "reading",
    regex: /^Leitura breve\b/i,
  },
  {
    type: "responsory",
    regex: /^Responsório breve\b/i,
  },
  {
    type: "gospel",
    regex: /^Cântico evangélico\b/i,
  },
  {
    type: "intercessions",
    regex: /^Preces\b/i,
  },
  {
    type: "prayer",
    regex: /^Oração\b/i,
  },
];

function normalizeSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isChordToken(text: string): boolean {
  return CHORD_RE.test(text.trim());
}

function isChordLine(line: ExtractedLine): boolean {
  if (line.isChordLine) {
    return true;
  }

  const words = line.words
    .map(word => word.text.trim())
    .filter(Boolean);

  if (!words.length) {
    return false;
  }

  /*
   * Uma linha é considerada linha de acordes quando contém apenas
   * tokens de acordes ou quando a maior parte dos tokens reconhecidos
   * são acordes.
   */
  const chordCount = words.filter(isChordToken).length;

  if (chordCount === words.length) {
    return true;
  }

  return chordCount > 0 && chordCount / words.length >= 0.7;
}

function formatMixedTextLine(
  words: ChordProWord[]
): ChordProLine {
  return {
    words,
  };
}

function formatChordLine(
  words: ChordProWord[]
): ChordProLine {
  return {
    words,
  };
}

function makeWordsFromText(text: string): ChordProWord[] {
  const normalized = normalizeSpaces(text);

  if (!normalized) {
    return [];
  }

  return [
    {
      text: normalized,
    },
  ];
}

function makeWordsFromChordText(text: string): ChordProWord[] {
  const words: ChordProWord[] = [];
  let lastIndex = 0;

  CHORD_TOKEN_RE.lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = CHORD_TOKEN_RE.exec(text)) !== null) {
    const chord = match[1];
    const chordStart = match.index + match[0].indexOf(chord);

    const preceding = text.slice(lastIndex, chordStart);

    if (preceding.trim()) {
      words.push({
        text: preceding.trim(),
      });
    }

    words.push({
      text: chord,
      chord: chord,
    });

    lastIndex = chordStart + chord.length;
  }

  const trailing = text.slice(lastIndex);

  if (trailing.trim()) {
    words.push({
      text: trailing.trim(),
    });
  }

  if (!words.length) {
    return makeWordsFromText(text);
  }

  return words;
}

function parseRawLine(
  rawLine: string
): ExtractedLine {
  const text = rawLine.trim();

  if (!text) {
    return {
      words: [],
      isChordLine: false,
    };
  }

  if (isChordOnlyText(text)) {
    return {
      words: text
        .split(/\s+/)
        .filter(Boolean)
        .map(chord => ({
          text: chord,
          chord,
        })),
      isChordLine: true,
    };
  }

  if (containsChordTokens(text)) {
    return {
      words: makeWordsFromChordText(text),
      isChordLine: false,
    };
  }

  return {
    words: makeWordsFromText(text),
    isChordLine: false,
  };
}

function isChordOnlyText(text: string): boolean {
  const tokens = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!tokens.length) {
    return false;
  }

  return tokens.every(token => isChordToken(token));
}

function containsChordTokens(text: string): boolean {
  CHORD_TOKEN_RE.lastIndex = 0;

  let count = 0;
  let match: RegExpExecArray | null;

  while ((match = CHORD_TOKEN_RE.exec(text)) !== null) {
    count++;
  }

  return count > 0;
}

function isAntiphonLine(text: string): boolean {
  return /^Ant\.?\s*\d*/i.test(text.trim());
}

function isTPLine(text: string): boolean {
  return /^T\.?\s*P\.?\s*[:.]?/i.test(text.trim());
}

function isPsalmOrCanticleType(type: string): boolean {
  return type === "psalm" || type === "canticle";
}

function getSectionType(text: string): string | null {
  const normalized = normalizeSpaces(text);

  for (const pattern of SECTION_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return pattern.type;
    }
  }

  return null;
}

function cleanSectionTitle(text: string): string {
  return normalizeSpaces(text);
}

function createSection(
  title: string,
  type: string
): SectionState {
  return {
    title: cleanSectionTitle(title),
    type,
    contentLines: [],
  };
}

function cloneLine(line: ChordProLine): ChordProLine {
  return {
    ...line,
    words: line.words.map(word => ({
      ...word,
    })),
  };
}

function hasMeaningfulWords(line: ChordProLine): boolean {
  return line.words.some(
    word => Boolean(word.text && word.text.trim())
  );
}

function appendLine(
  section: SectionState,
  line: ChordProLine
): void {
  if (!hasMeaningfulWords(line)) {
    return;
  }

  section.contentLines.push(cloneLine(line));
}

function normalizeExtractedLines(
  lines: ExtractedLine[]
): ExtractedLine[] {
  return lines
    .map(line => ({
      ...line,
      words: line.words.map(word => ({
        ...word,
        text: word.text ?? "",
      })),
    }))
    .filter(line =>
      line.words.some(word => word.text.trim())
    );
}

export function extractChordPro(
  input: string | ExtractedLine[]
): ChordProSong[] {
  const extractedLines: ExtractedLine[] =
    typeof input === "string"
      ? input
          .split(/\r?\n/)
          .map(parseRawLine)
      : normalizeExtractedLines(input);

  const songs: ChordProSong[] = [];

  let current: SectionState | null = null;

  /*
   * Indica que o corpo musical REAL da seção começou.
   *
   * ATENÇÃO:
   * texto simples não ativa este estado.
   *
   * Isso é importante porque PDFs litúrgicos frequentemente possuem,
   * entre o título e a antífona, epígrafes, referências bíblicas,
   * legendas editoriais e outras linhas que não fazem parte do corpo
   * cifrado.
   */
  let bodyStarted = false;

  /*
   * Antífonas que eventualmente aparecem antes de existir uma seção
   * de salmo/cântico válida.
   */
  const pendingAntiphonLines: ChordProLine[] = [];

  function closeCurrent(): void {
    if (!current) {
      return;
    }

    songs.push({
      title: current.title,
      type: current.type,
      lines: current.contentLines,
    } as ChordProSong);

    current = null;
    bodyStarted = false;
  }

  function startSection(
    title: string,
    type: string
  ): void {
    if (current) {
      closeCurrent();
    }

    current = createSection(title, type);

    /*
     * Antífonas pendentes podem ter sido encontradas antes do título
     * por causa da ordem em que o texto do PDF foi extraído.
     */
    if (
      pendingAntiphonLines.length &&
      isPsalmOrCanticleType(type)
    ) {
      for (const pending of pendingAntiphonLines) {
        appendLine(current, pending);
      }

      pendingAntiphonLines.length = 0;
    }

    bodyStarted = false;
  }

  for (let i = 0; i < extractedLines.length; i++) {
    const line = extractedLines[i];
    const next = extractedLines[i + 1];

    const plainText = line.words
      .map(word => word.text)
      .join(" ")
      .trim();

    if (!plainText) {
      continue;
    }

    const sectionType = getSectionType(plainText);

    /*
     * Primeiro identifica títulos de seções.
     */
    if (sectionType) {
      startSection(plainText, sectionType);
      continue;
    }

    /*
     * Antífonas.
     *
     * Para salmos/cânticos:
     *
     * - antes da primeira cifra: antífona de abertura;
     * - depois do início do corpo musical: antífona de fechamento.
     *
     * O ponto crucial da correção é que "bodyStarted" só fica true
     * quando realmente encontramos uma linha de acorde.
     */
    if (isAntiphonLine(plainText)) {
      const currentIsPsalmType =
        current &&
        isPsalmOrCanticleType(current.type);

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
                .join(" ")
                .trim()
            : "";

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
        /*
         * Antífona de abertura: fica no início do próprio salmo/cântico.
         */
        current.contentLines.push(
          formattedAntiphon
        );
      } else {
        /*
         * A antífona pode aparecer antes do título por causa da ordenação
         * da página; nesse caso, aguarda o próximo salmo/cântico.
         */
        pendingAntiphonLines.push(
          formattedAntiphon
        );
      }

      continue;
    }

    /*
     * T.P. isolado.
     *
     * Se ainda existe uma seção aberta, preservamos a linha.
     * Caso contrário, não criamos uma nova seção artificial.
     */
    if (isTPLine(plainText)) {
      if (current) {
        appendLine(
          current,
          formatMixedTextLine(line.words)
        );
      }

      continue;
    }

    /*
     * Linhas de acorde.
     *
     * ESTE É O PONTO QUE DEFINE O INÍCIO REAL DO CORPO.
     */
    if (isChordLine(line)) {
      if (!current) {
        /*
         * Não existe seção aberta. Não há onde colocar a cifra.
         * Mantemos o comportamento seguro de ignorar a linha até
         * encontrarmos um título reconhecido.
         */
        continue;
      }

      appendLine(
        current,
        formatChordLine(line.words)
      );

      bodyStarted = true;

      continue;
    }

    /*
     * Texto simples.
     *
     * Texto simples NÃO ativa bodyStarted.
     *
     * Isso permite preservar corretamente:
     *
     * Salmo 50(51)
     * Tende piedade, ó meu Deus!
     * Ant. 1 ...
     * T.P. ...
     * Renovai...
     * Revesti...
     * (Cd – Salmos para celebrar)
     * D4 D A4 A
     *
     * sem interpretar as linhas intermediárias como início do corpo.
     */
    if (current) {
      appendLine(
        current,
        formatMixedTextLine(line.words)
      );

      /*
       * Não fazer:
       *
       * bodyStarted = true;
       *
       * porque epígrafes e legendas também são texto simples.
       */
    }
  }

  /*
   * Fecha a última seção.
   */
  if (current) {
    closeCurrent();
  }

  return songs;
}

export function extractChordProFromLines(
  lines: ExtractedLine[]
): ChordProSong[] {
  return extractChordPro(lines);
}

export function parseChordProText(
  input: string
): ChordProSong[] {
  return extractChordPro(input);
}

export default extractChordPro;
