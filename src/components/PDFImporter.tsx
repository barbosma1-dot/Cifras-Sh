import React, { useState, useRef } from 'react';
import { X, Upload, Loader2, Check, Music, User, AlertCircle, Sparkles, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { extractPreAlignedPageText } from '../lib/chordproExtractor';

// Configuração do worker do PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface ExtractedSong {
  title: string;
  artist: string;
  category: string;
  content: string;
  original_key: string;
  youtube_url?: string;
}

// Reconhece links de YouTube em qualquer formato comum que possa aparecer
// impresso num PDF (site com QR code, rodapé de cifra, etc.): youtube.com/watch?v=,
// youtu.be/, youtube.com/embed/, m.youtube.com, com ou sem "https://"/"www.".
const YOUTUBE_URL_RE =
  /(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;

/** Varre um texto (conteúdo da cifra, ou qualquer campo livre vindo da IA) em busca de um link do YouTube e devolve a URL normalizada, ou null. */
function findYoutubeUrlInText(text: string): string | null {
  const match = text.match(YOUTUBE_URL_RE);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

interface PDFImporterProps {
  onClose: () => void;
  onImportComplete: () => void;
  bookId?: string | null;
  missionId?: string | null;
}

// Categorias mais comuns, exibidas como atalhos (chips) para marcar cada
// música individualmente sem precisar digitar tudo na mão.
const COMMON_CATEGORIES = ['Missa', 'Louvor', 'Adoração', 'Oração', 'Ação de Graças', 'Outros'];

export default function PDFImporter({ onClose, onImportComplete, bookId, missionId }: PDFImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [extractedSongs, setExtractedSongs] = useState<ExtractedSong[]>([]);
  const [importing, setImporting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [startPage, setStartPage] = useState<number>(1);
  const [endPage, setEndPage] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      setFile(selected);
      // Reseta a lista de músicas extraídas aqui (ao trocar de arquivo), não a
      // cada clique em "Iniciar Extração" — senão, ao continuar um PDF grande
      // de onde parou (ex.: retomar na página 21), as músicas já extraídas das
      // páginas anteriores eram apagadas antes mesmo da nova leva começar.
      setExtractedSongs([]);
      setNotification(null);
      try {
        const arrayBuffer = await selected.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
        setNumPages(pdf.numPages);
        setStartPage(1);
        setEndPage(pdf.numPages);
      } catch (err) {
        console.error('Erro ao ler número de páginas:', err);
      }
    }
  };

  const processPDF = async () => {
    if (!file) return;
    setLoading(true);
    // Limpa o aviso da tentativa anterior para não deixar uma mensagem de erro
    // antiga (de um lote de páginas diferente) exibida por cima do resultado
    // desta nova tentativa.
    setNotification(null);
    setStatus('Lendo PDF...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const totalPages = pdf.numPages;

      // Respeita o intervalo de páginas escolhido pelo usuário — importante para PDFs
      // grandes (hinários com centenas de páginas), onde processar tudo de uma vez é
      // lento, arriscado (pode travar o navegador no celular) e consome muita cota da IA.
      const firstPage = Math.max(1, Math.min(startPage || 1, totalPages));
      const lastPage = Math.max(firstPage, Math.min(endPage || totalPages, totalPages));

      // Lotes maiores = menos chamadas de IA para o mesmo número de páginas (poupa cota
      // por minuto e diária), MAS modelos de visão mais leves como o gemini-2.5-flash-lite
      // tendem a "prender a atenção" na primeira imagem de um lote com várias e ignorar
      // silenciosamente o resto — foi isso que causou extrações incompletas mesmo com
      // instruções explícitas no prompt para processar todas as páginas do lote. Uma
      // página por chamada elimina essa ambiguidade: não há "resto do lote" pra ignorar.
      // Custa mais chamadas (mais lento, mais cota consumida), mas é a única forma
      // confiável de garantir que nenhuma música seja pulada.
      const batchSize = 1;
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      // Espaçamento mínimo real entre chamadas à IA, calculado para ficar com folga
      // abaixo do limite de requisições por minuto do tier gratuito (evita bater no
      // 429 em vez de só reagir a ele depois).
      const MIN_INTERVAL_MS = 4500;
      let lastCallAt = 0;
      const waitForRateLimit = async () => {
        const elapsed = Date.now() - lastCallAt;
        if (elapsed < MIN_INTERVAL_MS) {
          await delay(MIN_INTERVAL_MS - elapsed);
        }
        lastCallAt = Date.now();
      };

      let consecutiveFailures = 0;
      let stoppedEarly = false;
      let lastBatchErrorMessage = '';

      for (let i = firstPage; i <= lastPage; i += batchSize) {
        const endOfBatch = Math.min(i + batchSize - 1, lastPage);

        try {
          const currentBatch: string[] = [];
          const currentTextBlocks: string[] = [];
          setStatus(`Processando páginas ${i} até ${endOfBatch} de ${lastPage}...`);

          for (let j = i; j <= endOfBatch; j++) {
            const page = await pdf.getPage(j);
            const viewport = page.getViewport({ scale: 2.0 }); // Even smaller scale for speed/size
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            if (context) {
              await page.render({
                canvasContext: context,
                viewport,
              } as any).promise;
              const base64Image = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
              currentBatch.push(base64Image);
            }

            // Tenta extrair a camada de texto REAL do PDF (não a imagem) e alinhar os
            // acordes por coordenada (ver src/lib/chordproExtractor.ts) — muito mais
            // confiável do que pedir pra IA "adivinhar" visualmente onde cada acorde
            // cai em cima da letra, que era a causa mais comum de acorde deslocado.
            // Só funciona em páginas com texto selecionável (cifra digital); em
            // páginas escaneadas/foto, `extractPreAlignedPageText` devolve null e a
            // IA usa só a imagem, como já fazia antes.
            try {
              const preAligned = await extractPreAlignedPageText(page);
              if (preAligned) {
                currentTextBlocks.push(
                  `--- Página ${j} (texto pré-alinhado por coordenadas — USE ESTE ALINHAMENTO DE ACORDES) ---\n${preAligned}`
                );
              }
            } catch (err) {
              console.error(`Falha ao extrair camada de texto da página ${j}:`, err);
            }
          }

          setStatus(`Convertendo músicas das páginas ${i}-${endOfBatch}...`);

          // Tenta o lote com algumas repetições em caso de limite de taxa (429), em vez
          // de abortar a importação inteira na primeira vez que isso acontecer — um
          // bloqueio temporário de RPM pode acontecer mesmo respeitando o espaçamento.
          let extracted: ExtractedSong[] = [];
          let attempt = 0;
          const maxAttempts = 3;
          let quotaExhausted = false;
          while (attempt < maxAttempts) {
            await waitForRateLimit();
            try {
              extracted = await extractWithGemini(currentBatch, currentTextBlocks);
              break;
            } catch (err: any) {
              attempt++;
              const isRateLimit = /429|quota|limite/i.test(err.message || '');
              if (isRateLimit && attempt < maxAttempts) {
                const backoffMs = 10000 * attempt; // 10s, 20s
                setStatus(`Limite temporário da IA — aguardando ${backoffMs / 1000}s para tentar de novo (páginas ${i}-${endOfBatch})...`);
                await delay(backoffMs);
                continue;
              }
              if (isRateLimit) {
                quotaExhausted = true;
                break;
              }
              throw err;
            }
          }

          if (extracted && extracted.length > 0) {
            // Atualiza incrementalmente: assim as músicas já extraídas ficam visíveis e
            // salváveis na hora, e não se perdem se o restante do PDF falhar ou se o
            // navegador for fechado no meio de um documento longo.
            setExtractedSongs(prev => [...prev, ...extracted]);
            consecutiveFailures = 0;
          }

          if (quotaExhausted) {
            // Depois de esgotar as tentativas de reenvio, provavelmente a cota da chave
            // (por minuto ou diária) foi atingida. Insistir agora só desperdiça mais cota
            // — melhor parar, deixar o que já foi extraído salvo, e configurar o intervalo
            // de páginas para retomar exatamente daqui na próxima tentativa.
            stoppedEarly = true;
            setStartPage(i);
            setEndPage(lastPage);
            setNotification({
              type: 'error',
              message: `Limite de uso da IA atingido na página ${i}. As músicas já extraídas foram mantidas abaixo. Aguarde alguns minutos (ou até amanhã, se o limite diário foi atingido) e clique em "Iniciar extração" novamente — o intervalo de páginas já está ajustado para continuar da página ${i}.`
            });
            break;
          }
        } catch (error: any) {
          console.error(`Erro no lote ${i}-${endOfBatch}:`, error);
          consecutiveFailures++;
          lastBatchErrorMessage = error?.message || 'Erro desconhecido';

          // Se vários lotes seguidos falharem por outro motivo (rede caiu, chave de API
          // inválida, timeout dos provedores, etc.), paramos, mas preservamos o que já foi
          // extraído e deixamos o intervalo pronto para retomar da página em que parou.
          // Limite reduzido de 5 para 3: assim o motivo real do erro aparece na tela mais
          // cedo, em vez de continuar tentando (e gastando cota) 5 vezes às cegas.
          if (consecutiveFailures >= 3) {
            stoppedEarly = true;
            setStartPage(i);
            setEndPage(lastPage);
            setNotification({
              type: 'error',
              message: `Falha repetida na extração (página ${i}): ${lastBatchErrorMessage}. As músicas já processadas foram mantidas abaixo, e o intervalo já está ajustado para retomar dali.`
            });
            break;
          }
        }
      }

      if (!stoppedEarly) {
        setStatus('Extração concluída!');
      }
    } catch (error) {
      console.error('Erro ao processar PDF:', error);
      setNotification({ type: 'error', message: 'Falha ao processar o PDF. Verifique se o arquivo está correto.' });
    } finally {
      setLoading(false);
    }
  };

  const extractWithGemini = async (images: string[], textBlocks: string[] = []): Promise<ExtractedSong[]> => {
    try {
      const prompt = `Você é um Analista de Cifras Litúrgicas sênior especializado em OCR e transcrição musical de ALTA FIDELIDADE para o formato ChordPro (.chopro).
Sua missão é extrair músicas com PRECISÃO CIRÚRGICA, garantindo que o alinhamento dos acordes com as sílabas seja PERFEITO.

### REGRAS DE OURO DE OCR (CRÍTICO):
0. ALINHAMENTO PRÉ-CALCULADO (quando presente): Junto com a imagem de uma página, pode vir também um bloco de texto começando com "--- Página N (texto pré-alinhado por coordenadas...)". Esse bloco foi calculado a partir da posição real de cada palavra no PDF (não é um palpite de IA) e já tem os acordes posicionados CORRETAMENTE. Para essa página, use o bloco de texto como fonte de verdade para o conteúdo e a posição dos acordes — copie as linhas de acorde+letra QUASE literalmente, mantendo os colchetes [Acorde] exatamente onde estão. Use a IMAGEM da mesma página apenas para decidir título, artista, categoria, tom, marcação de Refrão/Fim e limpeza de cabeçalhos/rodapés — NÃO para reposicionar acordes que já vieram prontos no bloco de texto. Se uma página NÃO tiver bloco de texto pré-alinhado correspondente, ela é uma página escaneada/foto — nesse caso siga a regra 3 abaixo normalmente, usando só a imagem, inclusive para o posicionamento dos acordes.
1. VARREDURA COMPLETA (CRÍTICO): Cada lote pode conter VÁRIAS páginas e VÁRIAS músicas diferentes — inclusive mais de uma música na MESMA página. Percorra TODAS as páginas do lote, do início ao fim, e retorne um objeto para CADA música encontrada. NUNCA pare depois de extrair a primeira música do lote — isso é o erro mais grave que você pode cometer aqui. Antes de responder, confira: "processei a última página deste lote, e há um objeto no array para cada música que vi, sem exceção?".
2. CONTINUIDADE MULTI-PÁGINA: Se uma música começa em uma página e continua na próxima, MESCLE-AS em um único objeto. Não crie dois registros para a mesma música.
3. ALINHAMENTO CHORDPRO (CRÍTICO — ERRO MUITO COMUM): A maioria dos PDFs de origem imprime o acorde numa linha SEPARADA, ACIMA da linha de letra, alinhado pela posição horizontal (coluna) da sílaba onde ele cai — esse é só o jeito de IMPRIMIR, não o formato de saída. Você NUNCA deve reproduzir essas duas linhas separadamente no "content". Sempre que uma linha de acordes estiver posicionada acima de uma linha de LETRA (texto cantável), você deve: (a) olhar a posição horizontal de cada acorde em relação às letras da linha de baixo, (b) FUNDIR as duas linhas em UMA ÚNICA linha de saída, inserindo cada acorde entre colchetes imediatamente antes do caractere/sílaba sobre a qual ele estava posicionado, e (c) descartar a linha de acordes separada — ela não deve sobrar no resultado. Isso vale mesmo que o espaçamento do PDF pareça "impreciso"; use o seu melhor julgamento de qual sílaba cada acorde acompanha.
   Exemplo de ENTRADA (duas linhas, como aparece no PDF):
     C                D                Em   G
     Vem, Santo Espírito, inflama os corações
   Exemplo de SAÍDA CORRETA (uma linha só, ChordPro):
     [C]Vem, [D]Santo Espírito, in[Em]flama os cora[G]ções
   Exemplo de SAÍDA ERRADA (proibido — são duas linhas, uma delas só com acordes soltos):
     [C]                [D]                [Em] [G]
     Vem, Santo Espírito, inflama os corações
4. LINHAS INSTRUMENTAIS (Intro/Solo/Ponte sem letra nenhuma): a regra 3 NÃO se aplica aqui — quando a linha de acordes NÃO tem nenhuma letra cantável embaixo (só uma sequência de acordes, como um trecho de intro/solo), mantenha-a como uma linha própria, só com os acordes, preservando o espaçamento visual do PDF para representar o tempo rítmico. Use espaços múltiplos entre acordes.
   Exemplo: [G]        [D/F#]        [Em]        [C]
5. FLUXO DE COLUNAS: Se o PDF tiver duas colunas, leia a coluna da ESQUERDA inteira (de cima a baixo) antes de passar para a coluna da DIREITA. Nunca misture linhas horizontais de colunas diferentes.
6. LIMPEZA TOTAL: Remova números de página, rodapés de hinários, nomes de missas/tempos litúrgicos repetidos e anotações manuais. 
6b. ÁLBUM COMO CATEGORIA (CRÍTICO): Se a página, o cabeçalho, o rodapé, a capa do hinário/coletânea ou o índice mencionar o nome de um ÁLBUM, CD, hinário ou coletânea ao qual a música pertence (ex.: "Álbum: Alma Missionária", "CD Encontro com Deus 3", "Coletânea Diante do Trono Vol. 2"), inclua esse nome de álbum como mais um item na lista de "category" da música, além das categorias litúrgicas normais (Missa, Louvor, etc.). Não invente nome de álbum — só inclua se ele aparecer explicitamente escrito no PDF.
6c. LINK DE VÍDEO/YOUTUBE: Se houver, em qualquer lugar da página (rodapé, cabeçalho, junto de um QR code, nota de rodapé), um link ou URL de YouTube impresso como texto (ex.: "youtube.com/watch?v=...", "youtu.be/...", ou instrução tipo "Assista em: ..."), extraia essa URL completa e devolva no campo "youtube_url". Se não houver nenhum link de vídeo visível na página, devolva "youtube_url": "".
7. ESTRUTURA: Marque o início do refrão com uma linha contendo apenas "Refrão:" e feche o bloco com uma linha contendo apenas "Fim" logo após a última linha do refrão. NÃO use {soc}/{eoc} nem tags como [REFRÃO] — o app só reconhece o padrão "Refrão:" / "Fim". Para outras seções, use rótulos simples em linha própria, como "Intro", "Estrofe", "Ponte", "Solo".
8. PÁGINAS SEM MÚSICA: Se a página for um índice, sumário, lista de CDs/álbuns, capa ou contracapa (sem NENHUM acorde e sem NENHUMA letra), IGNORE-A completamente — não crie nenhum objeto para ela. Uma página com acordes mas sem letra (regra 9) NÃO se enquadra aqui — ela tem música e deve ser extraída.
9. CIFRA SEM LETRA (GRADE DE ACORDES POR COMPASSO): Algumas músicas são notadas apenas como sequência de acordes por compasso, sem nenhuma letra impressa (comum em cifras de banda/instrumental) — ex.: "D/F# | % | G | Gm |" ou "-a- F | C | Am | G |". Isso É uma música válida e DEVE ser extraída como as demais, mesmo sem letra nenhuma. Não tente inventar sílabas nem forçar o formato colchete-sobre-sílaba da regra 3 (que só se aplica quando há letra). Em vez disso, preserve fielmente cada linha de compasso tal como está no PDF, incluindo as barras "|", o símbolo de repetição "%" e os rótulos de seção como estão (ex.: "-Intro-", "-a1-", "-chorus-", "-c bridge-", "-fim-"). Nunca pule uma música só porque ela não tem letra.

### FORMATO DE SAÍDA (Obrigatório):
Retorne um ARRAY JSON de objetos seguindo estritamente este esquema:
[{
  "title": "TÍTULO DA MÚSICA (Letras Maiúsculas)",
  "artist": "Autor ou Ministério (Ex: Pe. Zezinho, Shalom)",
  "category": "Missa, Oração, Outros, Nome do Álbum se houver (use uma ou mais, separadas por vírgula)",
  "original_key": "Tom (Ex: G, Am, F#m)",
  "content": "A cifra completa em formato ChordPro",
  "youtube_url": "URL do YouTube impressa na página, se houver; caso contrário string vazia"
}]

NÃO use blocos de código Markdown. Retorne apenas o JSON bruto.`;

      // Timeout duro: sem isso, se o servidor (ou algum provedor de IA na
      // cascata) travar sem responder, o app fica parado em "Processando..."
      // pra sempre, sem cair no retry nem mostrar erro nenhum. 100s dá folga
      // para o servidor tentar os 3 provedores da cascata (cada um com seu
      // próprio timeout interno, ~90s no pior caso) antes de o cliente desistir.
      const REQUEST_TIMEOUT_MS = 100000;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch('/api/extract-pdf', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            images,
            textBlocks,
            prompt
          }),
          signal: controller.signal
        });
      } catch (fetchErr: any) {
        if (fetchErr.name === 'AbortError') {
          throw new Error(`Tempo limite excedido (${REQUEST_TIMEOUT_MS / 1000}s) ao contatar o servidor de IA.`);
        }
        throw fetchErr;
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Falha na comunicação com o servidor de IA');
      }

      const data = await response.json();
      const songs: ExtractedSong[] = Array.isArray(data) ? data : [];

      // Fallback local: se a IA não retornou "youtube_url" (campo novo, pode
      // ainda não vir preenchido em todo caso), tenta achar um link colado
      // dentro do próprio "content" antes de desistir — sem gastar outra
      // chamada de IA.
      return songs.map(s => ({
        ...s,
        youtube_url: s.youtube_url || (s.content ? findYoutubeUrlInText(s.content) || '' : '')
      }));
    } catch (error: any) {
      console.error('Extraction error:', error);
      throw error;
    }
  };

  const importAll = async () => {
    if (extractedSongs.length === 0) return;
    setImporting(true);

    try {
      const songsToInsert = extractedSongs.map(s => ({
        ...s,
        artist: s.artist || 'Desconhecido',
        category: s.category || 'Outros',
        original_key: s.original_key || 'C',
        youtube_url: s.youtube_url || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      // Insere em lotes menores: um `insert` único com centenas de músicas (comum ao
      // importar um hinário inteiro) arrisca estourar tamanho de payload ou timeout.
      const CHUNK = 25;
      const allInserted: any[] = [];
      for (let i = 0; i < songsToInsert.length; i += CHUNK) {
        const chunk = songsToInsert.slice(i, i + CHUNK);
        setStatus(`Salvando ${i + 1}-${Math.min(i + CHUNK, songsToInsert.length)} de ${songsToInsert.length}...`);

        const { data: insertedChords, error: insertError } = await supabase
          .from('chords')
          .insert(chunk)
          .select();

        if (insertError) throw insertError;
        if (insertedChords) allInserted.push(...insertedChords);
      }

      if (bookId && allInserted.length > 0) {
        const bookItems = allInserted.map(chord => ({
          book_id: bookId,
          chord_id: chord.id,
          created_at: new Date().toISOString()
        }));

        const { error: linkError } = await supabase
          .from('chord_book_items')
          .insert(bookItems);

        if (linkError) {
          console.error('Erro ao vincular ao caderno:', linkError);
          // Não falhamos a importação inteira se apenas o vínculo falhar, 
          // mas informamos o erro se necessário.
        }
      }

      setNotification({ type: 'success', message: `${extractedSongs.length} cifras importadas com sucesso!` });
      setTimeout(() => {
        onImportComplete();
        onClose();
      }, 1500);
    } catch (error) {
      console.error('Erro ao importar:', error);
      setNotification({ type: 'error', message: 'Erro ao salvar cifras no banco de dados.' });
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-5xl max-h-[92vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-white/20">
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-gradient-to-r from-brand-blue to-indigo-900 text-white">
          <div className="flex items-center gap-4">
            <div className="bg-white/20 p-3 rounded-2xl backdrop-blur-md">
              <Sparkles className="w-8 h-8 text-brand-orange" />
            </div>
            <div>
              <h2 className="text-2xl font-black tracking-tight">Importador Inteligente</h2>
              <p className="text-white/60 text-sm font-medium uppercase tracking-widest">Extração de PDF com IA</p>
            </div>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white/10 rounded-2xl transition-all">
            <X className="w-8 h-8" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-8 bg-slate-50/50">
          {notification && (
            <div className={`p-4 rounded-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 ${
              notification.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'
            }`}>
              {notification.type === 'success' ? <Check className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
              <span className="font-bold text-sm">{notification.message}</span>
              <button onClick={() => setNotification(null)} className="ml-auto">
                <X className="w-4 h-4 opacity-50 hover:opacity-100" />
              </button>
            </div>
          )}

          {!file && (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-4 border-dashed border-slate-200 rounded-[2rem] p-16 flex flex-col items-center justify-center cursor-pointer hover:border-brand-orange hover:bg-brand-orange/5 transition-all group"
            >
              <div className="bg-slate-100 p-8 rounded-[2rem] mb-6 group-hover:scale-110 group-hover:bg-brand-orange transition-all">
                <Upload className="w-16 h-16 text-slate-400 group-hover:text-white" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 mb-2">Selecione seu PDF de cifras</h3>
              <p className="text-slate-500 text-center max-w-md">
                Nossa IA irá ler as imagens e converter automaticamente em textos formatados para seu caderno.
              </p>
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".pdf" 
                className="hidden" 
              />
            </div>
          )}

          {file && !loading && extractedSongs.length === 0 && (
            <div className="flex flex-col items-center justify-center p-20 space-y-6">
              <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100 flex items-center gap-4 w-full max-w-md">
                <div className="bg-red-100 p-3 rounded-xl">
                  <Upload className="w-8 h-8 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">
                    {(file.size / 1024 / 1024).toFixed(2)} MB{numPages ? ` · ${numPages} páginas` : ''}
                  </p>
                </div>
                <button onClick={() => setFile(null)} className="text-slate-300 hover:text-red-500 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {numPages && numPages > 10 && (
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100 w-full max-w-md space-y-2">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    PDF grande detectado — processe por partes
                  </p>
                  <p className="text-[11px] text-slate-400">
                    Escolha um intervalo de páginas para essa extração (você pode importar o restante depois, repetindo o processo com outro intervalo).
                  </p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase">De</label>
                      <input
                        type="number"
                        min={1}
                        max={numPages}
                        value={startPage}
                        onChange={(e) => setStartPage(Number(e.target.value))}
                        className="w-full p-2 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold text-slate-700"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-slate-400 font-bold uppercase">Até</label>
                      <input
                        type="number"
                        min={1}
                        max={numPages}
                        value={endPage}
                        onChange={(e) => setEndPage(Number(e.target.value))}
                        className="w-full p-2 bg-slate-50 border border-slate-100 rounded-xl text-sm font-bold text-slate-700"
                      />
                    </div>
                  </div>
                </div>
              )}

              <button 
                onClick={processPDF}
                className="bg-brand-orange text-white px-12 py-4 rounded-2xl font-black text-lg shadow-xl shadow-brand-orange/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-3"
              >
                <Sparkles className="w-6 h-6" />
                INICIAR EXTRAÇÃO
              </button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <Loader2 className="w-12 h-12 animate-spin text-brand-orange" />
              <p className="font-black text-brand-blue animate-pulse text-lg uppercase tracking-widest text-center">{status}</p>
              {extractedSongs.length > 0 && (
                <p className="text-slate-400 text-sm font-bold">
                  {extractedSongs.length} cifra{extractedSongs.length === 1 ? '' : 's'} encontrada{extractedSongs.length === 1 ? '' : 's'} até agora — já podem ser salvas abaixo a qualquer momento.
                </p>
              )}
            </div>
          )}

          {extractedSongs.length > 0 && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xl font-black text-brand-blue flex items-center gap-2">
                  <Check className="w-6 h-6 text-green-500" />
                  {extractedSongs.length} Cifras Encontradas
                </h3>
                <div className="flex gap-4">
                  <button 
                    onClick={() => setExtractedSongs([])}
                    disabled={loading}
                    className="px-6 py-2 bg-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    RECOMEÇAR
                  </button>
                  <button 
                    onClick={importAll}
                    disabled={importing}
                    className="px-8 py-2 bg-green-500 text-white rounded-xl font-black shadow-lg shadow-green-500/20 hover:bg-green-600 transition-all flex items-center gap-2"
                  >
                    {importing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                    SALVAR TODAS NO CADERNO
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {extractedSongs.map((song, idx) => (
                  <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative group overflow-hidden flex flex-col">
                    <div className="absolute top-0 right-0 p-2 opacity-5 group-hover:opacity-100 transition-opacity">
                      <Music className="w-8 h-8 text-brand-blue" />
                    </div>
                    <div className="flex gap-3 items-start mb-3">
                      <div className="bg-indigo-50 p-2 rounded-xl">
                        <Music className="w-4 h-4 text-indigo-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <input 
                          value={song.title}
                          onChange={(e) => {
                            const newSongs = [...extractedSongs];
                            newSongs[idx].title = e.target.value;
                            setExtractedSongs(newSongs);
                          }}
                          className="font-black text-sm text-slate-800 bg-transparent border-b border-transparent hover:border-slate-200 focus:border-brand-blue focus:ring-0 w-full mb-0.5"
                        />
                        <div className="flex items-center gap-1.5 text-slate-400">
                          <User className="w-3 h-3" />
                          <input 
                            value={song.artist}
                            onChange={(e) => {
                              const newSongs = [...extractedSongs];
                              newSongs[idx].artist = e.target.value;
                              setExtractedSongs(newSongs);
                            }}
                            className="bg-transparent border-b border-transparent hover:border-slate-200 focus:border-brand-blue focus:ring-0 text-[10px] font-bold uppercase tracking-wider"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="bg-slate-50 rounded-xl p-3 mb-3 flex-1">
                      <textarea 
                        value={song.content}
                        onChange={(e) => {
                          const newSongs = [...extractedSongs];
                          newSongs[idx].content = e.target.value;
                          setExtractedSongs(newSongs);
                        }}
                        className="w-full h-32 bg-transparent border-none font-mono text-[11px] leading-relaxed resize-none focus:ring-0"
                      />
                    </div>

                    <div className="mb-3">
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {COMMON_CATEGORIES.map(cat => {
                          const currentCats = song.category ? song.category.split(',').map(c => c.trim()).filter(Boolean) : [];
                          const active = currentCats.includes(cat);
                          return (
                            <button
                              key={cat}
                              type="button"
                              onClick={() => {
                                const newSongs = [...extractedSongs];
                                const cats = song.category ? song.category.split(',').map(c => c.trim()).filter(Boolean) : [];
                                const catIdx = cats.indexOf(cat);
                                if (catIdx >= 0) cats.splice(catIdx, 1); else cats.push(cat);
                                newSongs[idx] = { ...newSongs[idx], category: cats.join(', ') };
                                setExtractedSongs(newSongs);
                              }}
                              className={`text-[8px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest whitespace-nowrap border transition-colors ${
                                active
                                  ? 'bg-brand-orange text-white border-brand-orange'
                                  : 'bg-white text-slate-400 border-slate-200 hover:border-brand-orange/50 hover:text-brand-orange'
                              }`}
                            >
                              {cat}
                            </button>
                          );
                        })}
                      </div>
                      <input
                        value={song.category || ''}
                        onChange={(e) => {
                          const newSongs = [...extractedSongs];
                          newSongs[idx] = { ...newSongs[idx], category: e.target.value };
                          setExtractedSongs(newSongs);
                        }}
                        placeholder="Categorias separadas por vírgula"
                        className="w-full text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/20 outline-none"
                      />
                    </div>

                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-slate-400 mb-1">
                        <span className="text-[8px] font-black uppercase tracking-widest">Link YouTube</span>
                      </div>
                      <input
                        value={song.youtube_url || ''}
                        onChange={(e) => {
                          const newSongs = [...extractedSongs];
                          newSongs[idx] = { ...newSongs[idx], youtube_url: e.target.value };
                          setExtractedSongs(newSongs);
                        }}
                        placeholder="Detectado automaticamente do PDF, se houver"
                        className="w-full text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 focus:border-brand-orange focus:ring-1 focus:ring-brand-orange/20 outline-none"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2 mb-3">
                       <span className="text-[8px] font-black bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full uppercase tracking-widest font-black">
                         TOM: {song.original_key || 'C'}
                       </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
