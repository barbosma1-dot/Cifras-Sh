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
 * Lê um WAV manualmente, byte a byte, sem depender do decodeAudioData do
 * navegador — que falha em alguns WAVs exportados de DAW (ex.: formato
 * "extensible", float 32-bit, ou 24-bit), mesmo sendo um WAV válido.
 * Suporta PCM inteiro (8/16/24/32 bits) e IEEE float (32 bits), mono ou
 * multicanal (inclusive o cabeçalho "extensible" usado por muitos DAWs).
 */
function parseWavManually(arrayBuffer: ArrayBuffer, ctx: BaseAudioContext): AudioBuffer {
  const view = new DataView(arrayBuffer);
  if (view.getUint32(0, false) !== 0x52494646 /* 'RIFF' */ || view.getUint32(8, false) !== 0x57415645 /* 'WAVE' */) {
    throw new Error('Não é um arquivo WAV válido (cabeçalho RIFF/WAVE ausente).');
  }

  let offset = 12;
  let fmt: { audioFormat: number; numChannels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (offset + 8 <= view.byteLength) {
    const chunkId = view.getUint32(offset, false);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkBodyOffset = offset + 8;

    if (chunkId === 0x666d7420 /* 'fmt ' */) {
      let audioFormat = view.getUint16(chunkBodyOffset, true);
      const numChannels = view.getUint16(chunkBodyOffset + 2, true);
      const sampleRate = view.getUint32(chunkBodyOffset + 4, true);
      const bitsPerSample = view.getUint16(chunkBodyOffset + 14, true);
      // Formato "extensible" (comum em exports de DAW): o formato real vem
      // nos 2 primeiros bytes do GUID de subformato, 24 bytes após o começo do fmt.
      if (audioFormat === 0xfffe && chunkSize >= 40) {
        audioFormat = view.getUint16(chunkBodyOffset + 24, true);
      }
      fmt = { audioFormat, numChannels, sampleRate, bitsPerSample };
    } else if (chunkId === 0x64617461 /* 'data' */) {
      dataOffset = chunkBodyOffset;
      dataLength = Math.min(chunkSize, view.byteLength - chunkBodyOffset);
    }

    offset = chunkBodyOffset + chunkSize + (chunkSize % 2); // chunks são alinhados em bytes pares
  }

  if (!fmt || dataOffset === -1) {
    throw new Error('WAV sem chunk "fmt " ou "data" reconhecível.');
  }

  const { audioFormat, numChannels, sampleRate, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / (bytesPerSample * numChannels));
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    let readOffset = dataOffset + ch * bytesPerSample;
    for (let i = 0; i < frameCount; i++) {
      let sample: number;
      if (audioFormat === 3 && bitsPerSample === 32) {
        sample = view.getFloat32(readOffset, true);
      } else if (bitsPerSample === 8) {
        sample = (view.getUint8(readOffset) - 128) / 128;
      } else if (bitsPerSample === 16) {
        sample = view.getInt16(readOffset, true) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(readOffset);
        const b1 = view.getUint8(readOffset + 1);
        const b2 = view.getUint8(readOffset + 2);
        let v = (b2 << 16) | (b1 << 8) | b0;
        if (v & 0x800000) v -= 0x1000000;
        sample = v / 8388608;
      } else if (bitsPerSample === 32) {
        sample = view.getInt32(readOffset, true) / 2147483648;
      } else {
        throw new Error(`Profundidade de bits WAV não suportada: ${bitsPerSample}`);
      }
      channelData[i] = sample;
      readOffset += bytesPerSample * numChannels;
    }
  }

  return buffer;
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

    let decoded: AudioBuffer;
    try {
      decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0));
    } catch (decodeErr) {
      // Fallback: alguns WAVs de DAW (extensible/float/24-bit) o navegador
      // recusa decodificar mesmo sendo válidos — lemos manualmente.
      const looksLikeWav = file.type.includes('wav') || /\.wav$/i.test(file.name);
      if (!looksLikeWav) throw decodeErr;
      decoded = parseWavManually(arrayBuffer, decodeCtx);
    }
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
    alert(`Não foi possível comprimir "${file.name}" neste navegador. Se o arquivo for grande, exporte-o como MP3 antes de enviar.`);
    return file;
  }
}
