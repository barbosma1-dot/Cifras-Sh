import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { Chord } from '../types';
import { format } from 'date-fns';

export const exportChordsToPDF = async (chords: Chord[], bookTitle: string = 'Meu Caderno de Cifras') => {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);
  const footerHeight = 10;
  const maxImgHeight = pageHeight - (margin * 2) - footerHeight;

  // Cover Page
  doc.setFillColor(30, 41, 59); // Slate-900 para combinar com o novo design
  doc.rect(0, 0, pageWidth, pageHeight, 'F');
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(40);
  doc.text('Cifra Master', pageWidth / 2, pageHeight / 3, { align: 'center' });
  
  doc.setFontSize(20);
  doc.text(bookTitle, pageWidth / 2, pageHeight / 3 + 15, { align: 'center' });
  
  doc.setFontSize(14);
  doc.text(`${chords.length} músicas selecionadas`, pageWidth / 2, pageHeight / 2, { align: 'center' });
  
  doc.setFontSize(9);
  doc.text('Gerado via Cifra Master em ' + format(new Date(), "dd/MM/yyyy HH:mm"), pageWidth / 2, pageHeight - 15, { align: 'center' });

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = '210mm';
  container.style.backgroundColor = 'white';
  document.body.appendChild(container);

  let currentPageNumber = 0;

  for (let i = 0; i < chords.length; i++) {
    const chord = chords[i];
    
    const songEl = document.createElement('div');
    songEl.style.padding = '12mm';
    songEl.style.color = '#000000';
    songEl.style.fontFamily = 'Arial, sans-serif';
    
    const processChordProForPDF = (text: string) => {
      return text.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return `<div style="height: 0.2em;"></div>`;

        const hasChordPro = line.includes('[') && line.includes(']');
        if (!hasChordPro) return `<div style="margin-bottom: 0px; color: #000000; line-height: 0.5;">${line}</div>`;

        const segments: { chord: string; text: string }[] = [];
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

        return `
          <div style="display: flex; flex-wrap: wrap; margin-bottom: 0px; line-height: 0.5;">
            ${segments.map(seg => `
              <div style="display: flex; flex-direction: column;">
                <span style="color: #000000; font-weight: bold; font-size: 0.8em; height: 0.8em; white-space: pre;">${seg.chord || '&nbsp;'}</span>
                <span style="white-space: pre; color: #000000; font-size: 0.9em;">${seg.text || '&nbsp;'}</span>
              </div>
            `).join('')}
          </div>
        `;
      }).join('');
    };

    songEl.innerHTML = `
      <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 8px;">
        <h1 style="margin: 0; font-size: 16pt; font-family: Arial, sans-serif; font-weight: 800; color: #000000;">${chord.title}</h1>
        <h2 style="margin: 1px 0 0; font-size: 9pt; font-family: Arial, sans-serif; font-weight: 500; color: #334155;">${chord.artist}</h2>
        <div style="margin-top: 2px; font-size: 7pt; font-family: Arial, sans-serif; font-weight: bold; color: #000000; text-transform: uppercase;">
          TOM: ${chord.original_key || 'N/A'} | ${chord.category}
        </div>
      </div>
      <div style="white-space: pre-wrap; font-size: 10pt; line-height: 0.5; color: #000000; font-family: Arial, sans-serif;">
        ${processChordProForPDF(chord.content)}
      </div>
    `;
    
    container.innerHTML = '';
    container.appendChild(songEl);

    const canvas = await html2canvas(songEl, {
      scale: 2,
      useCORS: true,
      logging: false,
    });

    const imgData = canvas.toDataURL('image/jpeg', 0.90);
    const imgProps = doc.getImageProperties(imgData);
    
    // Calculate height at current contentWidth
    let finalImgHeight = (imgProps.height * contentWidth) / imgProps.width;
    let finalWidth = contentWidth;
    let finalX = margin;

    // SCALING LOGIC: If the song is slightly too tall for the page, scale it down to fit one page
    // We allow up to 20% shrinking to avoid splitting 1 song into 2 pages
    if (finalImgHeight > maxImgHeight && finalImgHeight < maxImgHeight * 1.25) {
      const scaleFactor = maxImgHeight / finalImgHeight;
      finalImgHeight = maxImgHeight;
      finalWidth = contentWidth * scaleFactor;
      finalX = margin + (contentWidth - finalWidth) / 2; // Center horizontally
    }

    let heightLeft = finalImgHeight;
    let position = 0;
    let firstBatch = true;

    while (heightLeft > 0) {
      doc.addPage();
      currentPageNumber++;
      
      const currentPartHeight = Math.min(heightLeft, maxImgHeight);
      
      // Calculate ratio of original image height to the height we are drawing
      // If we scaled, finalImgHeight/totalOriginalImgHeight is the ratio
      const drawHeight = (finalImgHeight * finalWidth) / contentWidth;

      doc.addImage(
        imgData, 
        'JPEG', 
        finalX, 
        margin - position, 
        finalWidth, 
        finalImgHeight
      );

      // Masking previous/next parts
      doc.setFillColor(255, 255, 255);
      doc.rect(0, 0, pageWidth, margin, 'F'); // Top mask
      doc.rect(0, pageHeight - footerHeight, pageWidth, footerHeight, 'F'); // Bottom mask

      // Footer
      doc.setFontSize(7);
      doc.setTextColor(160);
      doc.text(`Cifra Master - ${chord.title} - p. ${currentPageNumber}`, pageWidth / 2, pageHeight - 5, { align: 'center' });

      heightLeft -= maxImgHeight;
      position += maxImgHeight;
      firstBatch = false;
    }
  }

  document.body.removeChild(container);
  doc.save(`${bookTitle.replace(/\s+/g, '_')}.pdf`);
};
