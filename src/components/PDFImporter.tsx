import React, { useState, useRef } from 'react';
import { X, Upload, Loader2, Check, Music, User, AlertCircle, Sparkles, Save } from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Configuração do worker do PDF.js
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

interface ExtractedSong {
  title: string;
  artist: string;
  category: string;
  content: string;
  original_key: string;
}

interface PDFImporterProps {
  onClose: () => void;
  onImportComplete: () => void;
  bookId?: string | null;
  missionId?: string | null;
}

export default function PDFImporter({ onClose, onImportComplete, bookId, missionId }: PDFImporterProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [extractedSongs, setExtractedSongs] = useState<ExtractedSong[]>([]);
  const [importing, setImporting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const processPDF = async () => {
    if (!file) return;
    setLoading(true);
    setExtractedSongs([]);
    setStatus('Lendo PDF...');

    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      const allExtracted: ExtractedSong[] = [];

      // Processaremos em lotes de 3 páginas para manter contexto de músicas que continuam
      const batchSize = 3;
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      
      for (let i = 1; i <= numPages; i += batchSize) {
        try {
          const currentBatch: string[] = [];
          const endPage = Math.min(i + batchSize - 1, numPages);
          
          setStatus(`Processando páginas ${i} até ${endPage} de ${numPages}...`);
          
          for (let j = i; j <= endPage; j++) {
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
          }
          
          setStatus(`Convertendo músicas das páginas ${i}-${endPage}...`);
          const extracted = await extractWithGemini(currentBatch);
          if (extracted && extracted.length > 0) {
            allExtracted.push(...extracted);
          }

          // Small delay to avoid hitting rate limits too quickly
          if (i + batchSize <= numPages) {
            await delay(1000); 
          }
        } catch (error: any) {
          console.error(`Erro no lote ${i}:`, error);
          if (error.message?.includes('429') || error.message?.includes('quota') || error.message?.includes('Limite')) {
            setNotification({ 
              type: 'error', 
              message: 'Limite de uso da IA atingido. A extração foi interrompida para evitar bloqueios. Você pode salvar as músicas já processadas.' 
            });
            break; // Stop but preserve what we have
          }
        }
      }

      setExtractedSongs(allExtracted);
      setStatus('Extração concluída!');
    } catch (error) {
      console.error('Erro ao processar PDF:', error);
      setNotification({ type: 'error', message: 'Falha ao processar o PDF. Verifique se o arquivo está correto.' });
    } finally {
      setLoading(false);
    }
  };

  const extractWithGemini = async (images: string[]): Promise<ExtractedSong[]> => {
    try {
      const prompt = `Você é um Analista de Cifras Litúrgicas sênior especializado em OCR e transcrição musical de ALTA FIDELIDADE para o formato ChordPro (.chopro).
Sua missão é extrair músicas com PRECISÃO CIRÚRGICA, garantindo que o alinhamento dos acordes com as sílabas seja PERFEITO.

### REGRAS DE OURO DE OCR (CRÍTICO):
1. CONTINUIDADE MULTI-PÁGINA: Se uma música começa em uma página e continua na próxima, MESCLE-AS em um único objeto. Não crie dois registros para a mesma música.
2. ALINHAMENTO CHORDPRO: O acorde deve ser inserido EXATAMENTE antes da sílaba onde ele ocorre. 
   Exemplo: [G]Vin[D/F#]de cria[Em]tu[C]ras.
3. LINHAS INSTRUMENTAIS (Intro/Solo): Mantenha o espaçamento visual do PDF para representar o tempo rítmico. Use espaços múltiplos entre acordes.
   Exemplo: [G]        [D/F#]        [Em]        [C]
4. FLUXO DE COLUNAS: Se o PDF tiver duas colunas, leia a coluna da ESQUERDA inteira (de cima a baixo) antes de passar para a coluna da DIREITA. Nunca misture linhas horizontais de colunas diferentes.
5. LIMPEZA TOTAL: Remova números de página, rodapés de hinários, nomes de missas/tempos litúrgicos repetidos e anotações manuais. 
6. ESTRUTURA: Identifique e marque seções como {soc} (início de refrão) e {eoc} (fim de refrão) se possível, ou use tags como [REFRÃO], [PONTE], [INTRO].

### FORMATO DE SAÍDA (Obrigatório):
Retorne um ARRAY JSON de objetos seguindo estritamente este esquema:
[{
  "title": "TÍTULO DA MÚSICA (Letras Maiúsculas)",
  "artist": "Autor ou Ministério (Ex: Pe. Zezinho, Shalom)",
  "category": "Missa, Oração, Outros (use uma ou mais, separadas por vírgula)",
  "original_key": "Tom (Ex: G, Am, F#m)",
  "content": "A cifra completa em formato ChordPro"
}]

NÃO use blocos de código Markdown. Retorne apenas o JSON bruto.`;

      const response = await fetch('/api/extract-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          images,
          prompt
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || 'Falha na comunicação com o servidor de IA');
      }

      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch (error: any) {
      console.error('Extraction error:', error);
      setNotification({ type: 'error', message: error.message || 'Falha na extração por IA' });
      return [];
    }
  };

  const importAll = async () => {
    if (extractedSongs.length === 0) return;
    setImporting(true);
    setStatus('Salvando no banco de dados...');

    try {
      const songsToInsert = extractedSongs.map(s => ({
        ...s,
        artist: s.artist || 'Desconhecido',
        category: s.category || 'Outros',
        original_key: s.original_key || 'C',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { data: insertedChords, error: insertError } = await supabase
        .from('chords')
        .insert(songsToInsert)
        .select();

      if (insertError) throw insertError;

      if (bookId && insertedChords) {
        const bookItems = insertedChords.map(chord => ({
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

          {file && !extractedSongs.length && (
            <div className="flex flex-col items-center justify-center p-20 space-y-6">
              <div className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100 flex items-center gap-4 w-full max-w-md">
                <div className="bg-red-100 p-3 rounded-xl">
                  <Upload className="w-8 h-8 text-red-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-800 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <button onClick={() => setFile(null)} className="text-slate-300 hover:text-red-500 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!loading ? (
                <button 
                  onClick={processPDF}
                  className="bg-brand-orange text-white px-12 py-4 rounded-2xl font-black text-lg shadow-xl shadow-brand-orange/20 hover:scale-105 active:scale-95 transition-all flex items-center gap-3"
                >
                  <Sparkles className="w-6 h-6" />
                  INICIAR EXTRAÇÃO
                </button>
              ) : (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="w-16 h-16 animate-spin text-brand-orange" />
                  <p className="font-black text-brand-blue animate-pulse text-xl uppercase tracking-widest">{status}</p>
                </div>
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
                    className="px-6 py-2 bg-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-300 transition-colors"
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

                    <div className="flex flex-wrap gap-2 mb-3">
                       {song.category ? song.category.split(',').map(cat => (
                         <span key={cat} className="text-[8px] font-black bg-brand-orange/10 text-brand-orange px-2 py-0.5 rounded-full uppercase tracking-widest whitespace-nowrap">
                           {cat.trim()}
                         </span>
                       )) : (
                         <span className="text-[8px] font-black bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full uppercase tracking-widest font-black">
                           MISSA
                         </span>
                       )}
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
