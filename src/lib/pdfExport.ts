import jsPDF from 'jspdf';
import { Chord } from '../types';
import { format } from 'date-fns';

// --------------------------------------------------------------------------------
// Geração de PDF 100% nativa (texto vetorial do jsPDF).
//
// A versão anterior renderizava cada música como HTML fora da tela e tirava um
// "print" dela com html2canvas (rasterização em canvas + JPEG) para cada uma das
// músicas do repertório/caderno. Isso é MUITO lento e ainda gera um PDF pesado.
//
// Aqui desenhamos o texto diretamente no PDF (doc.text), sem nenhuma etapa de
// renderização em tela.
// --------------------------------------------------------------------------------

type Segment = {
  chord: string;
  text: string;
};

function parseChordProLine(
  line: string
): Segment[] {
  // Cada acorde deve permanecer associado ao texto que vem depois dele.
  //
  // O parser anterior perdia acordes consecutivos, por exemplo:
  //
  // [C][D]Sois
  //
  // porque o [D] sobrescrevia o [C].
  //
  // Agora cada marcador é tratado individualmente.

  const segments: Segment[] = [];

  const re = /\[([^\]]+)\]/g;

  let cursor = 0;

  let match: RegExpExecArray | null;

  while (
    (match = re.exec(line)) !== null
  ) {
    const plainBefore = line.slice(
      cursor,
      match.index
    );

    if (plainBefore) {
      const previous =
        segments[
          segments.length - 1
        ];

      if (
        previous &&
        previous.chord &&
        !previous.text
      ) {
        previous.text =
          plainBefore;
      } else {
        segments.push({
          chord: '',
          text: plainBefore
        });
      }
    }

    segments.push({
      chord: match[1],
      text: ''
    });

    cursor =
      match.index +
      match[0].length;
  }

  const tail =
    line.slice(cursor);

  if (tail) {
    const previous =
      segments[
        segments.length - 1
      ];

    if (
      previous &&
      previous.chord &&
      !previous.text
    ) {
      previous.text = tail;
    } else {
      segments.push({
        chord: '',
        text: tail
      });
    }
  }

  return segments;
}

// Reconhece um acorde isolado, incluindo baixo com barra.
//
// Exemplos:
// A/D
// D/F#
// G#7/C
// C#m7

const CHORD_TOKEN =
  /^[A-G](?:#|b)?(?:maj7|maj9|maj|m7b5|m9|m7|m6|m11|m|sus2|sus4|sus|dim7|dim|aug|add9|add11|add2|69|6|7|9|11|13|2|4|5)?(?:\/[A-G](?:#|b)?)?$/;

const isChordOnlyLine = (
  line: string
) => {
  const trimmed =
    line.trim();

  if (!trimmed) {
    return false;
  }

  const tokens =
    trimmed.split(/\s+/);

  return (
    tokens.length > 0 &&
    tokens.every(t =>
      CHORD_TOKEN.test(t)
    )
  );
};

export const exportChordsToPDF = async (
  chords: Chord[],
  bookTitle: string =
    'Meu Caderno de Cifras'
) => {
  const doc = new jsPDF(
    'p',
    'mm',
    'a4'
  );

  const pageWidth =
    doc.internal.pageSize.getWidth();

  const pageHeight =
    doc.internal.pageSize.getHeight();

  const margin = 14;

  const contentWidth =
    pageWidth - margin * 2;

  const footerY =
    pageHeight - 8;

  const bottomLimit =
    pageHeight - 14;

  const CHORD_SIZE = 8.5;

  const LYRIC_SIZE = 10;

  const CHORD_LYRIC_OFFSET = 4.3;

  const LINE_GAP = 7.4;

  const PLAIN_LINE_GAP = 5.0;

  // --------------------------------------------------------------------------
  // CAPA
  // --------------------------------------------------------------------------

  doc.setFillColor(
    30,
    41,
    59
  );

  doc.rect(
    0,
    0,
    pageWidth,
    pageHeight,
    'F'
  );

  doc.setTextColor(
    255,
    255,
    255
  );

  doc.setFont(
    'helvetica',
    'bold'
  );

  doc.setFontSize(40);

  doc.text(
    'Cifra Master',
    pageWidth / 2,
    pageHeight / 3,
    {
      align: 'center'
    }
  );

  doc.setFontSize(20);

  doc.text(
    bookTitle,
    pageWidth / 2,
    pageHeight / 3 + 15,
    {
      align: 'center'
    }
  );

  doc.setFont(
    'helvetica',
    'normal'
  );

  doc.setFontSize(14);

  doc.text(
    `${chords.length} música${
      chords.length === 1
        ? ''
        : 's'
    } selecionada${
      chords.length === 1
        ? ''
        : 's'
    }`,
    pageWidth / 2,
    pageHeight / 2,
    {
      align: 'center'
    }
  );

  doc.setFontSize(9);

  doc.text(
    'Gerado via Cifra Master em ' +
      format(
        new Date(),
        'dd/MM/yyyy HH:mm'
      ),
    pageWidth / 2,
    pageHeight - 15,
    {
      align: 'center'
    }
  );

  // --------------------------------------------------------------------------
  // UMA MÚSICA POR VEZ
  // --------------------------------------------------------------------------

  chords.forEach(chord => {
    doc.addPage();

    let y = margin;

    let songPageNum = 1;

    const drawFooter = () => {
      doc.setFont(
        'helvetica',
        'normal'
      );

      doc.setFontSize(7);

      doc.setTextColor(
        160,
        160,
        160
      );

      doc.text(
        `Cifra Master - ${chord.title} - p. ${songPageNum}`,
        pageWidth / 2,
        footerY,
        {
          align: 'center'
        }
      );
    };

    const breakPage = () => {
      drawFooter();

      doc.addPage();

      songPageNum++;

      y = margin;
    };

    // ------------------------------------------------------------------------
    // CABEÇALHO
    // ------------------------------------------------------------------------

    doc.setTextColor(
      0,
      0,
      0
    );

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.setFontSize(16);

    const titleLines =
      doc.splitTextToSize(
        chord.title || '',
        contentWidth
      );

    doc.text(
      titleLines,
      margin,
      y
    );

    y +=
      6 * titleLines.length;

    doc.setFont(
      'helvetica',
      'normal'
    );

    doc.setFontSize(9);

    doc.setTextColor(
      51,
      65,
      85
    );

    doc.text(
      chord.artist || '',
      margin,
      y
    );

    y += 4.5;

    doc.setFont(
      'helvetica',
      'bold'
    );

    doc.setFontSize(7);

    doc.setTextColor(
      0,
      0,
      0
    );

    doc.text(
      `TOM: ${
        chord.original_key ||
        'N/A'
      } | ${
        (
          chord.category || ''
        ).toUpperCase()
      }`,
      margin,
      y
    );

    y += 3;

    doc.setDrawColor(
      226,
      232,
      240
    );

    doc.setLineWidth(0.2);

    doc.line(
      margin,
      y,
      pageWidth - margin,
      y
    );

    y += 6;

    const lines =
      (
        chord.content || ''
      ).split('\n');

    let idx = 0;

    while (
      idx < lines.length
    ) {
      const rawLine =
        lines[idx];

      const trimmed =
        rawLine.trim();

      if (!trimmed) {
        y += 2.2;

        if (
          y > bottomLimit
        ) {
          breakPage();
        }

        idx++;

        continue;
      }

      const hasChordPro =
        rawLine.includes('[') &&
        rawLine.includes(']');

      // ----------------------------------------------------------------------
      // FORMATO CHORDPRO
      // ----------------------------------------------------------------------

      if (hasChordPro) {
        if (
          y + LINE_GAP >
          bottomLimit
        ) {
          breakPage();
        }

        const segments =
          parseChordProLine(
            rawLine
          );

        let x = margin;

        const chordY = y;

        const lyricY =
          y +
          CHORD_LYRIC_OFFSET;

        segments.forEach(
          seg => {
            doc.setFont(
              'helvetica',
              'bold'
            );

            doc.setFontSize(
              CHORD_SIZE
            );

            const chordW =
              seg.chord
                ? doc.getTextWidth(
                    seg.chord
                  )
                : 0;

            if (seg.chord) {
              doc.text(
                seg.chord,
                x,
                chordY
              );
            }

            doc.setFont(
              'helvetica',
              'normal'
            );

            doc.setFontSize(
              LYRIC_SIZE
            );

            const textW =
              seg.text
                ? doc.getTextWidth(
                    seg.text
                  )
                : 0;

            if (seg.text) {
              doc.text(
                seg.text,
                x,
                lyricY
              );
            }

            x +=
              Math.max(
                chordW,
                textW
              ) + 1;
          }
        );

        y += LINE_GAP;

        idx++;

        continue;
      }

      // ----------------------------------------------------------------------
      // LINHA CLÁSSICA DE ACORDES
      // ----------------------------------------------------------------------

      if (
        isChordOnlyLine(
          trimmed
        )
      ) {
        const nextRaw =
          lines[idx + 1];

        const nextTrimmed =
          nextRaw
            ? nextRaw.trim()
            : '';

        const nextHasChordPro =
          !!nextRaw &&
          nextRaw.includes(
            '['
          ) &&
          nextRaw.includes(
            ']'
          );

        const nextIsLyric =
          !!nextTrimmed &&
          !nextHasChordPro &&
          !isChordOnlyLine(
            nextTrimmed
          );

        if (nextIsLyric) {
          if (
            y + LINE_GAP >
            bottomLimit
          ) {
            breakPage();
          }

          doc.setFont(
            'courier',
            'bold'
          );

          doc.setFontSize(
            CHORD_SIZE
          );

          doc.setTextColor(
            0,
            0,
            0
          );

          doc.text(
            trimmed,
            margin,
            y
          );

          doc.setFont(
            'courier',
            'normal'
          );

          doc.setFontSize(
            LYRIC_SIZE
          );

          const wrappedLyric: string[] =
            doc.splitTextToSize(
              nextTrimmed,
              contentWidth
            );

          doc.text(
            wrappedLyric[0],
            margin,
            y +
              CHORD_LYRIC_OFFSET
          );

          y += LINE_GAP;

          doc.setFont(
            'helvetica',
            'normal'
          );

          for (
            let w = 1;
            w <
            wrappedLyric.length;
            w++
          ) {
            if (
              y +
                PLAIN_LINE_GAP >
              bottomLimit
            ) {
              breakPage();
            }

            doc.text(
              wrappedLyric[w],
              margin,
              y
            );

            y +=
              PLAIN_LINE_GAP;
          }

          idx += 2;

          continue;
        }

        if (
          y +
            PLAIN_LINE_GAP >
          bottomLimit
        ) {
          breakPage();
        }

        doc.setFont(
          'courier',
          'bold'
        );

        doc.setFontSize(
          CHORD_SIZE
        );

        doc.setTextColor(
          0,
          0,
          0
        );

        doc.text(
          trimmed,
          margin,
          y
        );

        y +=
          PLAIN_LINE_GAP;

        idx++;

        continue;
      }

      // ----------------------------------------------------------------------
      // TEXTO NORMAL
      // ----------------------------------------------------------------------

      doc.setFont(
        'helvetica',
        'normal'
      );

      doc.setFontSize(
        LYRIC_SIZE
      );

      doc.setTextColor(
        0,
        0,
        0
      );

      const wrapped: string[] =
        doc.splitTextToSize(
          trimmed,
          contentWidth
        );

      wrapped.forEach(
        wLine => {
          if (
            y +
              PLAIN_LINE_GAP >
            bottomLimit
          ) {
            breakPage();
          }

          doc.text(
            wLine,
            margin,
            y
          );

          y +=
            PLAIN_LINE_GAP;
        }
      );

      idx++;
    }

    drawFooter();
  });

  doc.save(
    `${bookTitle.replace(
      /\s+/g,
      '_'
    )}.pdf`
  );
};
