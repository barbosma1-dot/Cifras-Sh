import jsPDF from 'jspdf';
import { Chord } from '../types';
import { format } from 'date-fns';

// --------------------------------------------------------------------------------
// Geração de PDF 100% nativa (texto vetorial do jsPDF).
//
// A versão anterior renderizava cada música como HTML fora da tela e tirava um
// "print" dela com html2canvas (rasterização em canvas + JPEG) para cada uma das
// músicas do repertório/caderno. Isso é MUITO lento (reflow de DOM + rasterização
// em alta resolução por música, em série) e ainda gera um PDF pesado, com texto
// que não pode ser selecionado/pesquisado.
//
// Aqui desenhamos o texto diretamente no PDF (doc.text), sem nenhuma etapa de
// renderização em tela. O resultado: geração praticamente instantânea mesmo com
// dezenas de músicas, arquivo bem mais leve, e texto selecionável/pesquisável.
// --------------------------------------------------------------------------------

type Segment = { chord: string; text: string };

function parseChordProLine(line: string): Segment[] {
  const segments: Segment[] = [];
  const parts = line.split(/(\[.*?\])/g);
  let currentChord = '';
  for (const part of parts) {
    if (part.startsWith('[') && part.endsWith(']')) {
      currentChord = part.slice(1, -1);
    } else {
      segments.push({ chord: currentChord, text: part });
      currentChord = '';
    }
  }
  return segments;
}

// Reconhece UM acorde isolado, incluindo baixo com barra (ex: A/D, D/F#, G#7/C, C#m7).
// A versão anterior não aceitava letra maiúscula depois da barra (baixo), então
// qualquer linha de acordes com "cifra de baixo" (muito comum: A/D, D/F#, D/B, D/C...)
// deixava de ser reconhecida como linha de acordes e virava "letra" (não-negrito),
// quebrando o espaçamento vertical entre acorde e letra nas linhas seguintes.
const CHORD_TOKEN =
  /^[A-G](?:#|b)?(?:maj7|maj9|maj|m7b5|m9|m7|m6|m11|m|sus2|sus4|sus|dim7|dim|aug|add9|add11|add2|69|6|7|9|11|13|2|4|5)?(?:\/[A-G](?:#|b)?)?$/;

const isChordOnlyLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return false;
  const tokens = trimmed.split(/\s+/);
  return tokens.length > 0 && tokens.every((t) => CHORD_TOKEN.test(t));
};

export const exportChordsToPDF = async (chords: Chord[], bookTitle: string = 'Meu Caderno de Cifras') => {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const footerY = pageHeight - 8;
  const bottomLimit = pageHeight - 14; // reserva espaço para o rodapé

  const CHORD_SIZE = 8.5;
  const LYRIC_SIZE = 10;
  const CHORD_LYRIC_OFFSET = 4.3; // distância do acorde até a letra, dentro do mesmo par
  const LINE_GAP = 7.4;           // passo total até o próximo par acorde+letra (era 5.4, causava sobreposição)
  const PLAIN_LINE_GAP = 5.0;     // linha simples (letra ou linha de acordes "clássica"), era 4.6

  // ---------- Capa (igual à versão anterior) ----------
  doc.setFillColor(30, 41, 59);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(40);
  doc.text('Cifra Master', pageWidth / 2, pageHeight / 3, { align: 'center' });

  doc.setFontSize(20);
  doc.text(bookTitle, pageWidth / 2, pageHeight / 3 + 15, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(14);
  doc.text(`${chords.length} música${chords.length === 1 ? '' : 's'} selecionada${chords.length === 1 ? '' : 's'}`, pageWidth / 2, pageHeight / 2, { align: 'center' });

  doc.setFontSize(9);
  doc.text('Gerado via Cifra Master em ' + format(new Date(), "dd/MM/yyyy HH:mm"), pageWidth / 2, pageHeight - 15, { align: 'center' });

  // ---------- Uma música por vez, cada uma começando em página nova ----------
  chords.forEach((chord) => {
    doc.addPage();
    let y = margin;
    let songPageNum = 1;

    const drawFooter = () => {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(160, 160, 160);
      doc.text(`Cifra Master - ${chord.title} - p. ${songPageNum}`, pageWidth / 2, footerY, { align: 'center' });
    };

    const breakPage = () => {
      drawFooter();
      doc.addPage();
      songPageNum++;
      y = margin;
    };

    // Cabeçalho da música
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    const titleLines = doc.splitTextToSize(chord.title || '', contentWidth);
    doc.text(titleLines, margin, y);
    y += 6 * titleLines.length;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(chord.artist || '', margin, y);
    y += 4.5;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(0, 0, 0);
    doc.text(`TOM: ${chord.original_key || 'N/A'} | ${(chord.category || '').toUpperCase()}`, margin, y);
    y += 3;

    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageWidth - margin, y);
    y += 6;

    const lines = (chord.content || '').split('\n');

    let idx = 0;
    while (idx < lines.length) {
      const rawLine = lines[idx];
      const trimmed = rawLine.trim();

      if (!trimmed) {
        y += 2.2;
        if (y > bottomLimit) breakPage();
        idx++;
        continue;
      }

      const hasChordPro = rawLine.includes('[') && rawLine.includes(']');

      if (hasChordPro) {
        if (y + LINE_GAP > bottomLimit) breakPage();

        const segments = parseChordProLine(rawLine);
        let x = margin;
        const chordY = y;
        const lyricY = y + CHORD_LYRIC_OFFSET;

        segments.forEach(seg => {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(CHORD_SIZE);
          const chordW = seg.chord ? doc.getTextWidth(seg.chord) : 0;
          if (seg.chord) doc.text(seg.chord, x, chordY);

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(LYRIC_SIZE);
          const textW = seg.text ? doc.getTextWidth(seg.text) : 0;
          if (seg.text) doc.text(seg.text, x, lyricY);

          x += Math.max(chordW, textW) + 1;
        });

        y += LINE_GAP;
        idx++;
        continue;
      }

      if (isChordOnlyLine(trimmed)) {
        // Formato "clássico": linha só com acordes, seguida da linha de letra logo abaixo.
        // Tratamos as duas como um par (como no formato ChordPro), com o mesmo espaçamento
        // generoso, em vez de avançar cada linha isoladamente — era isso que fazia a letra
        // colar visualmente no acorde da linha seguinte.
        const nextRaw = lines[idx + 1];
        const nextTrimmed = nextRaw ? nextRaw.trim() : '';
        const nextHasChordPro = !!nextRaw && nextRaw.includes('[') && nextRaw.includes(']');
        const nextIsLyric = !!nextTrimmed && !nextHasChordPro && !isChordOnlyLine(nextTrimmed);

        if (nextIsLyric) {
          if (y + LINE_GAP > bottomLimit) breakPage();

          // Fonte monoespaçada aqui: o alinhamento do acorde acima da sílaba certa
          // depende dos espaços múltiplos do texto original, que só ficam retos
          // com uma fonte de largura fixa (com Helvetica proporcional os espaços
          // "encolhem" e o acorde desalinha da sílaba).
          doc.setFont('courier', 'bold');
          doc.setFontSize(CHORD_SIZE);
          doc.setTextColor(0, 0, 0);
          doc.text(trimmed, margin, y);

          doc.setFont('courier', 'normal');
          doc.setFontSize(LYRIC_SIZE);
          const wrappedLyric: string[] = doc.splitTextToSize(nextTrimmed, contentWidth);
          doc.text(wrappedLyric[0], margin, y + CHORD_LYRIC_OFFSET);
          y += LINE_GAP;

          // Se a letra dessa linha for longa e quebrar em mais de uma linha, desenha o resto normalmente.
          doc.setFont('helvetica', 'normal');
          for (let w = 1; w < wrappedLyric.length; w++) {
            if (y + PLAIN_LINE_GAP > bottomLimit) breakPage();
            doc.text(wrappedLyric[w], margin, y);
            y += PLAIN_LINE_GAP;
          }

          idx += 2;
          continue;
        }

        if (y + PLAIN_LINE_GAP > bottomLimit) breakPage();
        doc.setFont('courier', 'bold');
        doc.setFontSize(CHORD_SIZE);
        doc.setTextColor(0, 0, 0);
        doc.text(trimmed, margin, y);
        y += PLAIN_LINE_GAP;
        idx++;
        continue;
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(LYRIC_SIZE);
      doc.setTextColor(0, 0, 0);
      const wrapped: string[] = doc.splitTextToSize(trimmed, contentWidth);
      wrapped.forEach((wLine) => {
        if (y + PLAIN_LINE_GAP > bottomLimit) breakPage();
        doc.text(wLine, margin, y);
        y += PLAIN_LINE_GAP;
      });
      idx++;
    }

    drawFooter();
  });

  doc.save(`${bookTitle.replace(/\s+/g, '_')}.pdf`);
};
