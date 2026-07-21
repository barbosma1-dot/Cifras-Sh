import { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Settings2, 
  Youtube, 
  Play, 
  Pause, 
  ArrowLeft, 
  ArrowRight, 
  Type, 
  Maximize2, 
  Minimize2,
  Music2,
  Volume2,
  MousePointer2,
  ChevronUp,
  ChevronDown,
  Layout,
  PlusSquare,
  BookText,
  Check,
  Loader2,
  FileDown,
  Music,
  FileText,
  Pencil
} from 'lucide-react';
import { Chord, ChordBook } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { supabase } from '../lib/supabase';

// Transposition & Notation Logic
const NOTES_ENGLISH = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NOTES_LATIN = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];

function transposeChord(chord: string, semitones: number, useFlats: boolean, notation: 'english' | 'latin') {
  const notesEnglish = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const notesEnglishFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  
  const notesLatin = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const notesLatinFlat = ['Dó', 'Réb', 'Ré', 'Mib', 'Mi', 'Fá', 'Solb', 'Sol', 'Láb', 'Lá', 'Sib', 'Si'];

  return chord.replace(/[A-G][b#]?|Dó[#]?|Ré[b#]?|Mi[b]?|Fá[#]?|Sol[b#]?|Lá[b#]?|Si[b]?/g, (match) => {
    // Normalize input match to index (assuming input was English C-B)
    // Actually, we should handle if input is already Latin
    const findIndex = (m: string) => {
      let idx = notesEnglish.indexOf(m);
      if (idx === -1) idx = notesEnglishFlat.indexOf(m);
      if (idx === -1) idx = notesLatin.indexOf(m);
      if (idx === -1) idx = notesLatinFlat.indexOf(m);
      return idx;
    };

    let index = findIndex(match);
    if (index === -1) return match;
    
    let newIndex = (index + semitones) % 12;
    if (newIndex < 0) newIndex += 12;
    
    if (notation === 'latin') {
      return useFlats ? notesLatinFlat[newIndex] : notesLatin[newIndex];
    }
    return useFlats ? notesEnglishFlat[newIndex] : notesEnglish[newIndex];
  });
}

function processContent(content: string, semitones: number, useFlats: boolean, showChords: boolean, notation: 'english' | 'latin', fontSize: number, lineSpacing: number) {
  const lines = content.split('\n');
  let insideChorus = false;

  // 1ª passada: calcula, para cada linha, se ela pertence ao refrão e monta o elemento
  // "cru" da linha (sem borda/fundo por linha — isso agora é feito no agrupamento).
  type LineInfo = { isChorus: boolean; skip: boolean; el: JSX.Element | null };
  const lineInfos: LineInfo[] = [];

  lines.forEach((line, i) => {
    const strippedLower = line.replace(/\[.*?\]/g, '').trim().toLowerCase();
    const isChorusStart = /^(refrão|refrao|coro|chorus)\b/.test(strippedLower);
    // "Fim", "Fim Refrão" etc. fecham o bloco mas NÃO são exibidos no viewer.
    const isChorusEnd = /^(fim|end)\b/.test(strippedLower);
    const isOtherSectionLabel = /^(estrofe|verso|intro|solo|ponte|final|instrumental|vocalize|inst|passagem|dedilhado|ritmo)\b\s*:?\s*$/.test(strippedLower);
    const isDoubleBlank = strippedLower === '' && i > 0 && lines[i - 1].trim() === '';

    if (isChorusStart) {
      insideChorus = true;
    } else if (isChorusEnd || isOtherSectionLabel || isDoubleBlank) {
      insideChorus = false;
    }

    if (isChorusEnd) {
      // Marcador "Fim" é apenas um controle interno; não gera linha no viewer.
      lineInfos.push({ isChorus: false, skip: true, el: null });
      return;
    }

    const isChorus = insideChorus;
    const hasChordPro = line.includes('[') && line.includes(']');

    if (hasChordPro) {
      if (!showChords) {
        lineInfos.push({
          isChorus,
          skip: false,
          el: <div key={i} className="lyrics-line" style={{ paddingBottom: `${lineSpacing * 0.3}em` }}>{line.replace(/\[.*?\]/g, '')}</div>
        });
        return;
      }

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

      lineInfos.push({
        isChorus,
        skip: false,
        el: (
          <div key={i} className="chord-pro-line flex flex-wrap items-start" style={{ marginBottom: `${lineSpacing * 0.5}em` }}>
            {segments.map((seg, sidx) => {
              const chordLabel = seg.chord ? transposeChord(seg.chord, semitones, useFlats, notation) : '';
              const minWidth = chordLabel ? `${chordLabel.length + 1}ch` : undefined;
              return (
                <div key={sidx} className="flex flex-col" style={{ minWidth, marginRight: chordLabel ? '0.35em' : 0 }}>
                  <span className="text-brand-orange font-bold text-[0.85em] leading-none h-[1.2em] whitespace-pre">
                    {chordLabel || '\u00A0'}
                  </span>
                  <span className="lyrics-text whitespace-pre">{seg.text || (sidx === segments.length - 1 ? '' : '\u00A0')}</span>
                </div>
              );
            })}
          </div>
        )
      });
      return;
    }

    // Classic detection
    const isChordLine = /^\s*([A-G][b#]?[m7majdimaugsus0-9/]*\s+)*[A-G][b#]?[m7majdimaugsus0-9/]*\s*$/.test(line);

    if (isChordLine) {
      if (!showChords) { lineInfos.push({ isChorus, skip: true, el: null }); return; }
      const transposed = transposeChord(line, semitones, useFlats, notation);
      lineInfos.push({
        isChorus,
        skip: false,
        el: <div key={i} className="chord-line font-bold text-brand-orange" style={{ height: '1.2em' }}>{transposed}</div>
      });
      return;
    }

    lineInfos.push({
      isChorus,
      skip: false,
      el: <div key={i} className="lyrics-line" style={{ paddingBottom: `${lineSpacing * 0.3}em` }}>{line}</div>
    });
  });

  // 2ª passada: agrupa linhas consecutivas do refrão em um único "quadro" com a cifra dentro,
  // em vez de aplicar borda/fundo linha a linha (o que causava o efeito de linhas separadas).
  const elements: JSX.Element[] = [];
  let i = 0;
  let groupIdx = 0;
  while (i < lineInfos.length) {
    const info = lineInfos[i];
    if (info.skip) { i++; continue; }

    if (info.isChorus) {
      const group: JSX.Element[] = [];
      while (i < lineInfos.length && lineInfos[i].isChorus) {
        if (!lineInfos[i].skip && lineInfos[i].el) group.push(lineInfos[i].el as JSX.Element);
        i++;
      }
      if (group.length > 0) {
        elements.push(
          <div key={`chorus-${groupIdx++}`} className="font-bold border-l-4 border-brand-orange bg-orange-50/50 rounded-r-2xl pl-3 pr-3 py-3 my-3">
            {group}
          </div>
        );
      }
    } else {
      if (info.el) elements.push(info.el);
      i++;
    }
  }

  return elements;
}

interface ChordViewerProps {
  chord: Chord;
  onClose: () => void;
  allChords?: Chord[];
  onSwitchChord?: (c: Chord) => void;
  onEdit?: (chord: Chord) => void;
}

export default function ChordViewer({ chord, onClose, allChords, onSwitchChord, onEdit }: ChordViewerProps) {
  const [semitones, setSemitones] = useState(0);
  const [useFlats, setUseFlats] = useState(false);
  const [notationSystem, setNotationSystem] = useState<'english' | 'latin'>('english');
  const [fontSize, setFontSize] = useState(16);
  const [lineSpacing, setLineSpacing] = useState(1.5);
  const [columns, setColumns] = useState(false);
  const [showChords, setShowChords] = useState(true);
  const [showYoutube, setShowYoutube] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [showBookSelector, setShowBookSelector] = useState(false);
  const [userBooks, setUserBooks] = useState<ChordBook[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [addingToBook, setAddingToBook] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [scrollSpeed, setScrollSpeed] = useState(0);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const [showTools, setShowTools] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ... (rest of the file remains similar but uses these states)

  useEffect(() => {
    if (showBookSelector) {
      fetchUserBooks();
    }
  }, [showBookSelector]);

  async function fetchUserBooks() {
    setLoadingBooks(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.rpc('get_accessible_chord_books', { p_user_id: user.id });
      if (error) {
        // Fallback
        const { data: fallback } = await supabase.from('chord_books').select('*');
        setUserBooks(fallback || []);
      } else {
        setUserBooks(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBooks(false);
    }
  }

  const handleAddToBook = async (bookId: string) => {
    setAddingToBook(bookId);
    try {
      const { error } = await supabase
        .from('chord_book_items')
        .insert([{ book_id: bookId, chord_id: chord.id }]);
      
      if (error && error.code !== '23505') throw error;
      
      setNotification({ message: 'Cifra adicionada!', type: 'success' });
      setTimeout(() => setAddingToBook(null), 1000);
    } catch (err) {
      console.error(err);
      setNotification({ message: 'Erro ao adicionar cifra ao caderno', type: 'error' });
      setAddingToBook(null);
    }
  };
  
  const currentIndex = allChords?.findIndex(c => c.id === chord.id) ?? -1;

  useEffect(() => {
    if (scrollSpeed === 0) return;
    const interval = setInterval(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop += 1;
      }
    }, 100 / scrollSpeed);
    return () => clearInterval(interval);
  }, [scrollSpeed]);

  const handleNext = () => {
    if (allChords && currentIndex < allChords.length - 1) {
      onSwitchChord?.(allChords[currentIndex + 1]);
      setSemitones(0);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }
  };

  const nextChord = allChords && currentIndex < allChords.length - 1 ? allChords[currentIndex + 1] : null;

  const handlePrev = () => {
    if (allChords && currentIndex > 0) {
      onSwitchChord?.(allChords[currentIndex - 1]);
      setSemitones(0);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-[60] bg-white flex flex-col"
    >
      {/* Header Controls */}
      <AnimatePresence>
      {!immersive && (
      <motion.div 
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        transition={{ duration: 0.2 }}
        className="bg-brand-blue text-white shrink-0 px-3 md:px-8 pt-3 pb-2 md:py-4 flex flex-col gap-2"
      >
        {/* Linha 1: voltar + título/artista (altura livre, nunca é cortada) */}
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg shrink-0">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-lg leading-tight truncate">{chord.title}</h2>
            <p className="text-xs text-white/60 truncate">{chord.artist}</p>
          </div>
          <button 
            onClick={() => setImmersive(true)}
            className="p-2 rounded-lg transition-colors hover:bg-white/10 shrink-0"
            title="Ocultar Menus"
          >
            <Maximize2 className="w-6 h-6" />
          </button>
          <button 
            onClick={() => setShowTools(!showTools)}
            className={`p-2 rounded-lg transition-colors shrink-0 ${showTools ? 'bg-brand-orange text-white' : 'hover:bg-white/10'}`}
            title="Ferramentas"
          >
            <Settings2 className="w-6 h-6" />
          </button>
        </div>

        {/* Linha 2: badges + ícones de ação. Rola horizontalmente se não couber, então nada é cortado */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1 flex-wrap min-w-0">
            {chord.category?.split(',').map(cat => (
              <span key={cat} className="text-[8px] font-black bg-white/20 text-white px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">
                {cat.trim()}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar shrink-0 max-w-full">
            {onEdit && (
              <button
                onClick={() => onEdit(chord)}
                className="p-2 rounded-lg transition-colors hover:bg-white/10 shrink-0"
                title="Editar Cifra"
              >
                <Pencil className="w-6 h-6" />
              </button>
            )}
            <button 
               onClick={() => setShowChords(!showChords)}
               className={`p-2 rounded-lg transition-all flex items-center gap-2 shrink-0 ${showChords ? 'bg-brand-orange text-white' : 'hover:bg-white/10 text-white'}`}
               title={showChords ? "Ocultar Cifras" : "Exibir Cifras"}
            >
              {showChords ? <Music2 className="w-6 h-6" /> : <BookText className="w-6 h-6" />}
            </button>
            
            <button 
              onClick={() => setShowBookSelector(!showBookSelector)}
              className={`p-2 rounded-lg transition-colors shrink-0 ${showBookSelector ? 'bg-white text-brand-blue' : 'hover:bg-white/10'}`}
              title="Adicionar ao Caderno"
            >
              <PlusSquare className="w-6 h-6" />
            </button>
            {chord.youtube_url && (
              <button 
                onClick={() => setShowYoutube(!showYoutube)}
                className={`p-2 rounded-lg transition-colors shrink-0 ${showYoutube ? 'bg-red-500 text-white' : 'hover:bg-white/10'}`}
                title="YouTube"
              >
                <Youtube className="w-6 h-6" />
              </button>
            )}
            {(chord.audio_url || chord.attachment_url || (Array.isArray(chord.attachments) && chord.attachments.length > 0)) && (
              <button 
                onClick={() => setShowMedia(!showMedia)}
                className={`p-2 rounded-lg transition-colors shrink-0 ${showMedia ? 'bg-emerald-500 text-white' : 'hover:bg-white/10'}`}
                title="Mídias e Anexos"
              >
                <Music className="w-6 h-6" />
              </button>
            )}
            <div className="hidden md:flex gap-1 bg-white/10 p-1 rounded-xl shrink-0">
               <button onClick={() => setSemitones(s => s - 1)} className="px-3 py-1 hover:bg-white/10 rounded-lg text-sm font-bold">-</button>
               <span className="px-2 py-1 text-xs font-mono bg-brand-orange rounded-lg min-w-[3rem] text-center">{semitones > 0 ? '+' : ''}{semitones} ST</span>
               <button onClick={() => setSemitones(s => s + 1)} className="px-3 py-1 hover:bg-white/10 rounded-lg text-sm font-bold">+</button>
            </div>
          </div>
        </div>
      </motion.div>
      )}
      </AnimatePresence>

      {/* Botão flutuante para voltar a exibir os menus quando estiverem ocultos */}
      {immersive && (
        <button
          onClick={() => setImmersive(false)}
          className="fixed top-3 right-3 z-[65] p-2.5 rounded-full bg-black/30 text-white backdrop-blur-sm hover:bg-black/50 transition-colors shadow-lg"
          title="Mostrar Menus"
        >
          <Minimize2 className="w-5 h-5" />
        </button>
      )}

      {/* Main Area */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        
        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-6 md:p-12 pb-32"
          style={{ fontSize: `${fontSize}px` }}
        >
          {chord.youtube_url && showYoutube && (
            <div className="max-w-3xl mx-auto mb-8 aspect-video rounded-3xl overflow-hidden bg-black shadow-2xl">
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${chord.youtube_url.split('v=')[1]?.split('&')[0] || chord.youtube_url.split('/').pop()}`}
                title="YouTube video player"
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              ></iframe>
            </div>
          )}
          <div className="max-w-7xl mx-auto">
            {showMedia && (() => {
               const audios = Array.isArray(chord.attachments) 
                 ? chord.attachments.filter(a => a.type === 'audio') 
                 : (chord.audio_url ? [{ name: 'Áudio Principal', url: chord.audio_url, type: 'audio' }] : []);
               const texts = Array.isArray(chord.attachments) 
                 ? chord.attachments.filter(a => a.type === 'text') 
                 : (chord.attachment_url ? [{ name: 'Documento Anexo', url: chord.attachment_url, type: 'text' }] : []);
                 
               return (
                 <div className="mb-8 p-6 bg-slate-100 border border-slate-200 rounded-3xl space-y-6 animate-in fade-in slide-in-from-top-4 duration-300">
                    <div className="flex items-center justify-between">
                       <h4 className="font-extrabold text-sm uppercase tracking-wider text-slate-600 flex items-center gap-2">
                          <Music className="w-5 h-5 text-brand-blue" />
                          Mídias e Anexos Disponíveis
                       </h4>
                       <button onClick={() => setShowMedia(false)} className="text-slate-400 hover:text-slate-600 p-1 hover:bg-slate-200 rounded-full transition-colors">
                         <X className="w-4 h-4" />
                       </button>
                    </div>

                    {/* Playable Audios */}
                    {audios.length > 0 && (
                      <div className="space-y-4">
                        <label className="text-xs font-black text-emerald-600 uppercase flex items-center gap-2 tracking-wider">
                          <Volume2 className="w-4 h-4" />
                          Reprodutores de Áudio ({audios.length})
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {audios.map((aud, aidx) => (
                            <div key={aidx} className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm space-y-2">
                              <p className="text-xs font-bold text-slate-700 truncate" title={aud.name}>
                                {aud.name || `Áudio ${aidx + 1}`}
                              </p>
                              <audio 
                                controls 
                                className="w-full h-8 accent-emerald-500"
                                src={aud.url}
                              >
                                Seu navegador não suporta áudio.
                              </audio>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Downloadable / Viewable Files */}
                    {texts.length > 0 && (
                      <div className="pt-4 border-t border-slate-200 space-y-3">
                        <label className="text-xs font-black text-brand-blue uppercase flex items-center gap-2 tracking-wider">
                          <FileText className="w-4 h-4" />
                          Documentos, Letras e Partituras ({texts.length})
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 font-sans">
                          {texts.map((txt, tidx) => (
                            <a 
                              key={tidx}
                              href={txt.url} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-2xl hover:border-brand-blue/30 hover:shadow-sm transition-all group min-w-0"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                 <div className="p-2 bg-brand-blue/10 text-brand-blue rounded-xl shrink-0">
                                    <FileDown className="w-5 h-5" />
                                 </div>
                                 <div className="min-w-0">
                                    <p className="text-xs font-bold text-slate-700 truncate" title={txt.name}>
                                      {txt.name || `Anexo ${tidx + 1}`}
                                    </p>
                                    <p className="text-[9px] text-slate-400 uppercase tracking-wider">Acessar Arquivo</p>
                                 </div>
                              </div>
                              <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-blue group-hover:translate-x-1 transition-all shrink-0" />
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {audios.length === 0 && texts.length === 0 && (
                      <p className="text-xs text-slate-400 text-center italic py-2">Nenhuma mídia cadastrada para esta música.</p>
                    )}
                 </div>
               );
            })()}

            <div 
              className={`transition-all duration-500 mx-auto ${columns ? 'bg-white shadow-2xl border border-slate-200' : ''}`}
              style={columns ? {
                columnCount: 2,
                columnGap: window.innerWidth > 768 ? '4rem' : '1.5rem',
                columnFill: 'balance',
                columnRule: '1px dashed #e2e8f0',
                padding: window.innerWidth > 768 ? '20mm' : '1rem',
                width: '100%',
                maxWidth: '1000px',
              } : {}}
            >
              <div>
                {processContent(chord.content, semitones, useFlats, showChords, notationSystem, fontSize, lineSpacing)}
              </div>
            </div>

            {nextChord && (
               <div className="mt-12 pt-12 border-t border-slate-100 animate-in fade-in slide-in-from-bottom-8 duration-700 overflow-hidden">
                  <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest mb-4">Próxima música no repertório</p>
                  <button 
                    onClick={handleNext}
                    className="w-full p-6 bg-slate-50 hover:bg-brand-blue/5 rounded-3xl border border-dashed border-slate-200 hover:border-brand-blue/30 transition-all flex items-center justify-between group"
                  >
                    <div className="flex items-center gap-4 text-left">
                       <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center text-brand-blue group-hover:bg-brand-blue group-hover:text-white transition-all">
                          <Music2 className="w-6 h-6" />
                       </div>
                       <div>
                          <p className="font-bold text-slate-800 text-lg group-hover:text-brand-blue transition-colors">{nextChord.title}</p>
                          <p className="text-xs text-slate-400 font-medium uppercase">{nextChord.artist}</p>
                       </div>
                    </div>
                    <ArrowRight className="w-6 h-6 text-slate-300 group-hover:text-brand-blue group-hover:translate-x-1 transition-all" />
                  </button>
               </div>
            )}
          </div>
        </div>

        {/* Floating Tool Panel */}
        <AnimatePresence>
          {showTools && (
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 w-[90vw] max-w-md z-[80] space-y-6"
            >
              <div className="flex justify-between items-center mb-2">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-brand-blue" />
                  Ajustes de Visualização
                </h3>
                <button onClick={() => setShowTools(false)} className="text-slate-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Notação (# / b)</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setUseFlats(false)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${!useFlats ? 'bg-white shadow text-brand-blue' : 'text-slate-400'}`}
                      >
                        Sustenido
                      </button>
                      <button 
                        onClick={() => setUseFlats(true)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${useFlats ? 'bg-white shadow text-brand-blue' : 'text-slate-400'}`}
                      >
                        Bemol
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sistema</label>
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                      <button 
                        onClick={() => setNotationSystem('english')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${notationSystem === 'english' ? 'bg-white shadow text-brand-blue' : 'text-slate-400'}`}
                      >
                        C D E
                      </button>
                      <button 
                        onClick={() => setNotationSystem('latin')}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${notationSystem === 'latin' ? 'bg-white shadow text-brand-blue' : 'text-slate-400'}`}
                      >
                        Dó Ré Mi
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Tom (Transposição)</label>
                    <span className="text-xs font-bold text-brand-orange">{semitones > 0 ? '+' : ''}{semitones} semitões</span>
                  </div>
                  <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
                    <button 
                      onClick={() => setSemitones(s => s - 1)}
                      className="flex-1 py-2 bg-white shadow rounded-lg text-brand-blue font-black"
                    >
                      -1
                    </button>
                    <button 
                      onClick={() => setSemitones(0)}
                      className="flex-1 py-2 text-slate-400 font-bold text-[10px] uppercase"
                    >
                      Reset
                    </button>
                    <button 
                      onClick={() => setSemitones(s => s + 1)}
                      className="flex-1 py-2 bg-white shadow rounded-lg text-brand-blue font-black"
                    >
                      +1
                    </button>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Tamanho da Letra</label>
                    <span className="text-xs font-bold text-brand-blue">{fontSize}px</span>
                  </div>
                  <input 
                    type="range" min="8" max="32" value={fontSize} 
                    onChange={(e) => setFontSize(parseInt(e.target.value))}
                    className="w-full accent-brand-blue cursor-pointer"
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Espaçamento</label>
                    <span className="text-xs font-bold text-brand-blue">{lineSpacing.toFixed(1)}</span>
                  </div>
                  <input 
                    type="range" min="0.1" max="3.0" step="0.1" value={lineSpacing} 
                    onChange={(e) => setLineSpacing(parseFloat(e.target.value))}
                    className="w-full accent-brand-blue cursor-pointer"
                  />
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setShowChords(!showChords)}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 ${
                        showChords 
                          ? 'border-brand-orange bg-brand-orange/5 text-brand-orange shadow-lg shadow-brand-orange/10' 
                          : 'border-slate-100 bg-slate-50 text-slate-400'
                      }`}
                    >
                      <Music2 className="w-6 h-6" />
                      <span className="text-[10px] font-black uppercase whitespace-nowrap">Com Cifras</span>
                    </button>
                    <button 
                      onClick={() => setColumns(!columns)}
                      className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all gap-2 ${
                        columns 
                          ? 'border-brand-blue bg-brand-blue/5 text-brand-blue shadow-lg shadow-brand-blue/10' 
                          : 'border-slate-100 bg-slate-50 text-slate-400'
                      }`}
                    >
                      <Layout className="w-6 h-6" />
                      <span className="text-[10px] font-black uppercase whitespace-nowrap">Duas Colunas</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-4 pt-2 border-t border-slate-50">

                <div className="space-y-2">
                  <div className="flex justify-between">
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Velocidade Rolagem</label>
                    <span className="text-xs font-bold text-brand-blue">{scrollSpeed}x</span>
                  </div>
                  <input 
                    type="range" min="0" max="20" value={scrollSpeed} 
                    onChange={(e) => setScrollSpeed(parseInt(e.target.value))}
                    className="w-full accent-brand-orange"
                  />
                </div>
              </div>
            </div>
          </motion.div>
          )}
        </AnimatePresence>

        {/* Sidebar Controls (Floating on Mobile) */}
        <AnimatePresence>
        {!immersive && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 md:relative md:translate-x-0 md:bottom-0 md:w-64 md:border-l border-slate-100 bg-white shadow-2xl md:shadow-none p-4 rounded-2xl md:rounded-none flex md:flex-col gap-4 items-center justify-center z-[55]"
        >
          <div className="flex md:flex-col gap-2">
            <button 
              disabled={currentIndex <= 0}
              onClick={handlePrev} 
              className="p-3 bg-brand-blue text-white rounded-xl disabled:opacity-30 hover:bg-brand-blue/90"
            >
              <ArrowLeft className="w-6 h-6" />
            </button>
            <button 
              disabled={!allChords || currentIndex >= allChords.length - 1}
              onClick={handleNext} 
              className="p-3 bg-brand-blue text-white rounded-xl disabled:opacity-30 hover:bg-brand-blue/90"
            >
              <ArrowRight className="w-6 h-6" />
            </button>
          </div>

          <div className="w-px h-8 bg-slate-200 md:w-full md:h-px"></div>

          <button 
            onClick={() => setShowTools(!showTools)}
            className={`p-3 rounded-xl flex items-center gap-2 ${showTools ? 'bg-brand-blue text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            <Settings2 className="w-6 h-6" />
            <span className="hidden md:inline font-bold text-xs uppercase">Ferramentas</span>
          </button>

          <button 
             onClick={() => setShowChords(!showChords)}
             className={`p-3 rounded-xl flex items-center gap-2 ${showChords ? 'bg-brand-blue text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            <Music2 className="w-6 h-6" />
            <span className="hidden md:inline font-bold text-xs uppercase">Cifras</span>
          </button>
        </motion.div>
        )}
        </AnimatePresence>

        {/* Youtube Overlay */}
        <AnimatePresence>
          {showBookSelector && (
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="absolute right-0 top-0 bottom-0 w-full md:w-[350px] bg-white z-[70] flex flex-col shadow-2xl border-l border-slate-100"
            >
              <div className="p-4 flex justify-between items-center bg-slate-50 border-b border-slate-100">
                <span className="text-brand-blue font-bold flex items-center gap-2">
                  <BookText className="w-5 h-5" />
                  Meus Cadernos
                </span>
                <button onClick={() => setShowBookSelector(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingBooks ? (
                  <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-brand-blue" /></div>
                ) : userBooks.length > 0 ? (
                  userBooks.map(book => (
                    <button 
                      key={book.id}
                      onClick={() => handleAddToBook(book.id)}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-brand-blue/5 rounded-2xl border border-slate-100 transition-all text-left group"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-800 truncate text-sm">{book.name}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">{book.is_public ? 'Global' : 'Privado'}</p>
                      </div>
                      <div className={`p-2 rounded-lg transition-all ${addingToBook === book.id ? 'bg-green-500 text-white' : 'bg-white text-slate-300 group-hover:text-brand-blue'}`}>
                        {addingToBook === book.id ? <Check className="w-4 h-4" /> : <PlusSquare className="w-4 h-4" />}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="text-center py-10">
                    <BookText className="w-10 h-10 text-slate-100 mx-auto mb-3" />
                    <p className="text-xs text-slate-400">Você não tem cadernos</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Notificações */}
      {notification && (
        <div className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[100] px-6 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-4 flex items-center gap-2 font-bold text-sm ${
          notification.type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-red-500 text-white border-red-400'
        }`}>
          {notification.message}
        </div>
      )}
    </motion.div>
  );
}
