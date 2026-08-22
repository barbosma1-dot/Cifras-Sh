/**
 * Compressão de áudio no navegador, antes do upload para o Supabase Storage.
 *
 * Modo mais econômico: mono, 22050Hz, Opus a 24kbps — nível "voz/podcast",
 * suficiente pra ouvir referência de uma música cantada/tocada, bem abaixo
 * do que uma gravação de música precisa em estéreo/44khz. Isso costuma
 * cortar o tamanho de um áudio gravado no celular (normalmente AAC/M4A a
 * ~128-256kbps estéreo, ou pior, WAV não comprimido) em 80-95%.
 *
 * Por que não usar ffmpeg.wasm: ele resolveria com mais controle de formato,
 * mas baixa ~30MB de WebAssembly na hora e trava o navegador durante a
 * conversão — pesado demais pra um app que já preza por ser leve no celular.
 * A técnica abaixo usa só APIs nativas (Web Audio API para decodificar +
 * MediaRecorder para regravar em Opus comprimido), sem baixar nada extra.
 *
 * Limitação conhecida: o Safari/iOS não suporta gravar em "audio/webm" via
 * MediaRecorder. Nesses casos, a função devolve o arquivo ORIGINAL sem
 * comprimir — não trava o upload, só não economiza espaço nesse navegador.
 */

const TARGET_SAMPLE_RATE = 22050; // suficiente pra voz/instrumento, corta metade de um áudio original a 44100Hz
const TARGET_BITRATE = 24000; // 24kbps — "modo econômico": nível de podcast/voz, não de música em alta-fidelidade
const MIME_TYPE = 'audio/webm;codecs=opus';

export function isAudioCompressionSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window.AudioContext || (window as any).webkitAudioContext) &&
    typeof MediaRecorder !== 'undefined' &&
    MediaRecorder.isTypeSupported(MIME_TYPE)
  );
}

/**
 * Recebe um File de áudio qualquer e devolve uma versão comprimida (Opus,
 * mono, baixa taxa de bits) como novo File — ou o arquivo original, sem
 * alterar, se o navegador não suportar a técnica ou algo der errado no meio
 * do caminho (nunca lança erro que bloqueie o upload).
 */
export async function compressAudioFile(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<File> {
  if (!isAudioCompressionSupported()) return file;

  try {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    const decodeCtx = new AudioContextCtor();
    const arrayBuffer = await file.arrayBuffer();
    const decoded: AudioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    await decodeCtx.close();

    // Contexto de reprodução em tempo real (MediaRecorder precisa de um
    // MediaStream "ao vivo" — não dá pra gravar direto de um buffer offline).
    // O destino é um MediaStreamAudioDestinationNode, não os alto-falantes,
    // então nada toca audível durante a compressão.
    const playCtx = new AudioContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
    const source = playCtx.createBufferSource();

    // Downmix para mono se o áudio original for estéreo — voz/instrumento
    // isolado não perde nada perceptível relevante, e já corta ~50% sozinho.
    let bufferToPlay = decoded;
    if (decoded.numberOfChannels > 1) {
      const mono = playCtx.createBuffer(1, decoded.length, decoded.sampleRate);
      const monoData = mono.getChannelData(0);
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        const chData = decoded.getChannelData(ch);
        for (let i = 0; i < chData.length; i++) monoData[i] += chData[i] / decoded.numberOfChannels;
      }
      bufferToPlay = mono;
    }
    source.buffer = bufferToPlay;

    const dest = playCtx.createMediaStreamDestination();
    source.connect(dest);

    const recorder = new MediaRecorder(dest.stream, {
      mimeType: MIME_TYPE,
      audioBitsPerSecond: TARGET_BITRATE
    });

    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

    const durationSeconds = bufferToPlay.duration;
    const result: File = await new Promise((resolve, reject) => {
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      const startedAt = Date.now();

      recorder.onerror = (e) => reject(e);
      recorder.onstop = async () => {
        if (progressTimer) clearInterval(progressTimer);
        await playCtx.close();
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const compressedName = file.name.replace(/\.[^.]+$/, '') + '.webm';
        resolve(new File([blob], compressedName, { type: 'audio/webm' }));
      };

      if (onProgress && durationSeconds > 0) {
        progressTimer = setInterval(() => {
          onProgress(Math.min(0.99, (Date.now() - startedAt) / 1000 / durationSeconds));
        }, 200);
      }

      recorder.start();
      source.start(0);
      // A regravação acontece em tempo real (a duração da compressão é a
      // mesma duração do áudio) — por isso paramos exatamente quando a
      // reprodução termina.
      source.onended = () => recorder.stop();
    });

    onProgress?.(1);

    // Salvaguarda: se por algum motivo o resultado comprimido saiu MAIOR
    // que o original (arquivos já bem comprimidos, ex. um MP3/Opus que já
    // veio enxuto), mantém o original em vez de "comprimir" para pior.
    if (result.size >= file.size) return file;
    return result;
  } catch (err) {
    console.error('Falha ao comprimir áudio no navegador — enviando o arquivo original sem compressão:', err);
    return file;
  }
}
