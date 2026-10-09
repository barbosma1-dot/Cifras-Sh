import { PDFDocument } from 'pdf-lib';
import { supabase } from './supabase';

/** Mesmo limite de anexo usado no ChordEditor. */
export const MAX_SCORE_PDF_MB = 20;

export interface ScoreAttachment {
  name: string;
  url: string;
  type: 'score';
}

/** "12, 13, 14, 20" -> "12–14, 20" (para nome e rótulos). */
export function formatPageRanges(pages: number[]): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  const parts: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** PDF original já carregado — carregue UMA vez e reaproveite para várias músicas. */
export type ScoreSource = PDFDocument;

/**
 * Carrega o PDF original para extrair páginas dele.
 *
 * Importante: `bytes` precisa ser uma cópia FRESCA do arquivo
 * (`await file.arrayBuffer()` de novo) — o PDF.js pode "consumir" o buffer
 * que recebeu em `getDocument`, deixando-o vazio.
 */
export async function loadScoreSource(bytes: ArrayBuffer | Uint8Array): Promise<ScoreSource> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

/**
 * Cria um PDF novo só com as páginas indicadas (numeração 1-based) do PDF
 * original, na ordem crescente e sem repetir página.
 */
export async function buildScorePdf(source: ScoreSource, pages1Based: number[]): Promise<Uint8Array> {
  const wanted = Array.from(new Set(pages1Based)).sort((a, b) => a - b);
  if (wanted.length === 0) throw new Error('Nenhuma página de partitura informada.');

  const total = source.getPageCount();
  const indices = wanted.filter(p => p >= 1 && p <= total).map(p => p - 1);
  if (indices.length === 0) throw new Error('As páginas de partitura estão fora do PDF.');

  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, indices);
  copied.forEach(p => out.addPage(p));
  return out.save();
}

function safeFileName(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'partitura'
  );
}

/**
 * Monta o PDF das páginas de partitura, sobe para o bucket "attachments"
 * (mesmo bucket e pasta-por-tipo dos anexos do ChordEditor) e devolve o anexo
 * pronto para entrar em `chords.attachments`.
 *
 * Lança erro se o PDF passar do limite de tamanho ou o upload falhar — quem
 * chama decide se isso interrompe a importação (no importador, não interrompe).
 */
export async function createScoreAttachment(
  source: ScoreSource,
  pages1Based: number[],
  songTitle: string
): Promise<ScoreAttachment> {
  const bytes = await buildScorePdf(source, pages1Based);

  const sizeMB = bytes.byteLength / (1024 * 1024);
  if (sizeMB > MAX_SCORE_PDF_MB) {
    throw new Error(
      `PDF da partitura com ${sizeMB.toFixed(1)}MB passa do limite de ${MAX_SCORE_PDF_MB}MB.`
    );
  }

  const filePath = `score/${Math.random().toString(36).substring(2)}_${safeFileName(songTitle)}.pdf`;
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });

  const { error } = await supabase.storage
    .from('attachments')
    .upload(filePath, blob, { cacheControl: '3600', upsert: false, contentType: 'application/pdf' });
  if (error) throw new Error(`Erro ao enviar a partitura: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from('attachments').getPublicUrl(filePath);

  return {
    name: `Partitura (pág. ${formatPageRanges(pages1Based)}).pdf`,
    url: publicUrl,
    type: 'score',
  };
}
