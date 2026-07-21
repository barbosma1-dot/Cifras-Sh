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

const isChordOnlyLine = (line: string) =>
  /^\s*([A-G][b#]?[m7majdimaugsus0-9/]*\s+)*[A-G][b#]?[m7majdimaugsus0-9/]*\s*$/.test(line);

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
  const LINE_GAP = 5.4;       // linha com acorde + letra
  const PLAIN_LINE_GAP = 4.6; // linha simples (letra ou linha de acordes "clássica")

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

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (!trimmed) {
        y += 2.2;
        if (y > bottomLimit) breakPage();
        continue;
      }

      const hasChordPro = rawLine.includes('[') && rawLine.includes(']');

      if (hasChordPro) {
        if (y + LINE_GAP > bottomLimit) breakPage();

        const segments = parseChordProLine(rawLine);
        let x = margin;
        const chordY = y;
        const lyricY = y + 3.6;

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
      } else if (isChordOnlyLine(trimmed)) {
        if (y + PLAIN_LINE_GAP > bottomLimit) breakPage();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(LYRIC_SIZE);
        doc.setTextColor(0, 0, 0);
        doc.text(trimmed, margin, y);
        y += PLAIN_LINE_GAP;
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(LYRIC_SIZE);
        doc.setTextColor(0, 0, 0);
        const wrapped: string[] = doc.splitTextToSize(trimmed, contentWidth);
        wrapped.forEach((wLine) => {
          if (y + PLAIN_LINE_GAP > bottomLimit) breakPage();
          doc.text(wLine, margin, y);
          y += PLAIN_LINE_GAP;
        });
      }
    }

    drawFooter();
  });

  doc.save(`${bookTitle.replace(/\s+/g, '_')}.pdf`);
};
