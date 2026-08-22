import lamejs from 'lamejs';

/**
 * Compressão de áudio no navegador, antes do upload para o Supabase Storage.
 *
 * IMPORTANTE (v2): a primeira versão regravava o áudio em TEMPO REAL via
 * MediaRecorder — um áudio de 4 minutos levava 4 minutos pra "comprimir", e
 * rodar vários de uma vez sobrecarregava o navegador (vários áudios tocando
 * ao mesmo tempo). Esta versão não tem esse problema: usa
 * `OfflineAudioContext` para reamostrar/reduzir para mono, que roda o mais
 * rápido possível (não em tempo real — um áudio de 4 minutos processa em
 * frações de segundo), e `lamejs` (biblioteca pura em JS, ~50KB, bem mais
 * leve que ffmpeg.wasm) para codificar em MP3, que também é só computação,
 * sem precisar "tocar" o áudio.
 *
 * Modo mais econômico: mono, 22050Hz, MP3 a 32kbps — nível "voz/referência",
 * suficiente pra ouvir uma música cantada/tocada, bem abaixo do que áudio em
 * alta-fidelidade precisa.
 */

const TARGET_SAMPLE_RATE = 22050;
const TARGET_BITRATE_KBPS = 32;

export function isAudioCompressionSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.AudioContext || (window as any).webkitAudioContext);
}

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

/** Codifica um Int16Array PCM mono em MP3 usando lamejs, em blocos, cedendo o thread principal de vez em quando pra não travar a interface durante áudios longos. */
async function encodeMp3(pcm: Int16Array, sampleRate: number, kbps: number): Promise<Uint8Array> {
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const blockSize = 1152;
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < pcm.length; i += blockSize) {
    const chunk = pcm.subarray(i, i + blockSize);
    const encoded = encoder.encodeBuffer(chunk);
    if (encoded.length > 0) chunks.push(new Uint8Array(encoded));

    // A cada ~2000 blocos (uns 4 minutos de áudio), cede o thread principal
    // por um instante — evita travar a interface em áudios bem longos, sem
    // deixar a codificação lenta (é só uma pausa de 0ms entre blocos).
    if (i % (blockSize * 2000) === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }

  const final = encoder.flush();
  if (final.length > 0) chunks.push(new Uint8Array(final));

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.length; }
  return result;
}

/**
 * Recebe um File de áudio qualquer e devolve uma versão comprimida (MP3,
 * mono, baixa taxa de bits) como novo File — ou o arquivo original, sem
 * alterar, se o navegador não suportar a técnica ou algo der errado no meio
 * do caminho (nunca lança erro que bloqueie o upload).
 */
export async function compressAudioFile(file: File): Promise<File> {
  if (!isAudioCompressionSupported()) return file;

  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const decodeCtx = new AudioContextCtor();
    const arrayBuffer = await file.arrayBuffer();
    const decoded: AudioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    await decodeCtx.close();

    // OfflineAudioContext com 1 canal de destino já faz o downmix
    // estéreo->mono automaticamente (regra padrão de mixagem do Web Audio
    // API), e roda a reamostragem pro TARGET_SAMPLE_RATE — tudo isso
    // renderizado o mais rápido possível, não em tempo real.
    const targetLength = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
    const offlineCtx = new OfflineAudioContext(1, targetLength, TARGET_SAMPLE_RATE);
    const source = offlineCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(offlineCtx.destination);
    source.start(0);
    const rendered = await offlineCtx.startRendering();

    const pcm16 = floatTo16BitPCM(rendered.getChannelData(0));
    const mp3Bytes = await encodeMp3(pcm16, TARGET_SAMPLE_RATE, TARGET_BITRATE_KBPS);

    const compressedName = file.name.replace(/\.[^.]+$/, '') + '.mp3';
    const result = new File([mp3Bytes], compressedName, { type: 'audio/mpeg' });

    // Salvaguarda: se por algum motivo o resultado saiu maior que o
    // original (arquivo já bem comprimido, ex. um MP3/Opus enxuto), mantém
    // o original em vez de "comprimir" para pior.
    if (result.size >= file.size) return file;
    return result;
  } catch (err) {
    console.error('Falha ao comprimir áudio no navegador — enviando o arquivo original sem compressão:', err);
    return file;
  }
}
