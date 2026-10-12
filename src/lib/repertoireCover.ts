import { supabase } from './supabase';
import { removeStorageFilesByUrl } from './storageCleanup';

const BUCKET = 'attachments';
const MAX_WIDTH = 1600;
const MAX_HEIGHT = 900;
const MAX_INPUT_MB = 15;

/** Lê o arquivo, reduz para no máx. 1600x900 e devolve um JPEG leve (~100–300 KB). */
export async function compressCoverImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Escolha um arquivo de imagem (JPG, PNG ou WebP).');
  }
  if (file.size > MAX_INPUT_MB * 1024 * 1024) {
    throw new Error(`A imagem passa de ${MAX_INPUT_MB}MB. Escolha uma menor.`);
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler essa imagem.'));
      el.src = url;
    });

    const scale = Math.min(1, MAX_WIDTH / img.naturalWidth, MAX_HEIGHT / img.naturalHeight);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Não foi possível processar a imagem.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.82)
    );
    if (!blob) throw new Error('Não foi possível comprimir a imagem.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Envia a capa ao Storage e devolve a URL pública. */
export async function uploadRepertoireCover(repertoireId: string, blob: Blob): Promise<string> {
  const filePath = `repertoire-cover/${repertoireId}-${Date.now()}.jpg`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(filePath, blob, { cacheControl: '31536000', upsert: false, contentType: 'image/jpeg' });
  if (error) throw new Error(`Erro ao enviar a imagem: ${error.message}`);

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(filePath);
  return publicUrl;
}

/** Apaga uma capa antiga do Storage (silencioso: falha aqui não deve travar o salvamento). */
export async function removeRepertoireCover(url: string | null | undefined): Promise<void> {
  if (!url) return;
  try {
    await removeStorageFilesByUrl([url]);
  } catch (err) {
    console.warn('Não foi possível apagar a capa antiga do repertório:', err);
  }
}
