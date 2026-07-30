import { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Filter, 
  Music, 
  Trash2, 
  Edit3, 
  Eye, 
  Plus, 
  Link as LinkIcon, 
  Youtube, 
  FileText,
  Loader2,
  BookText,
  FileDown,
  Upload,
  Copy,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Chord, UserProfile } from '../types';
import ChordViewer from './ChordViewer';
import ChordEditor from './ChordEditor';
import PDFImporter from './PDFImporter';
import { exportChordsToPDF } from '../lib/pdfExport';

export default function ChordsList({ profile, initialBookId, triggerNewChord }: { 
  profile: UserProfile | null, 
  initialBookId?: string | null,
  triggerNewChord?: number 
}) {
  const [chords, setChords] = useState<Chord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeBookId, setActiveBookId] = useState<string | null>(initialBookId || null);
  const [bookTitle, setBookTitle] = useState<string | null>(null);
  
  const [selectedChord, setSelectedChord] = useState<Chord | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingChord, setEditingChord] = useState<Chord | null>(null);
  const [isPDFImporterOpen, setIsPDFImporterOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  // Combobox de categoria com busca própria: com a nova regra de "álbum vira
  // categoria" na importação de PDF, a lista de categorias pode crescer muito
  // (uma por álbum/coletânea), e um <select> nativo fica difícil de navegar
  // nesse caso — por isso o dropdown de categoria agora tem seu próprio campo
  // de busca interno, para filtrar a lista de categorias antes de escolher.
  const [isCategoryDropdownOpen, setIsCategoryDropdownOpen] = useState(false);
  const [categorySearchTerm, setCategorySearchTerm] = useState('');
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  // Filtro de "adicionadas recentemente" — facilita achar e revisar/editar
  // categorias logo depois de uma importação de PDF.
  const [recentFilter, setRecentFilter] = useState<'all' | '1h' | '24h' | '7d'>('all');

  const [chordToDelete, setChordToDelete] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [isDuplicatesModalOpen, setIsDuplicatesModalOpen] = useState(false);
  const [duplicateActionId, setDuplicateActionId] = useState<string | null>(null);

  const [isAddChordModalOpen, setIsAddChordModalOpen] = useState(false);
  const [isSelectingExisting, setIsSelectingExisting] = useState(false);
  const [allAvailableChords, setAllAvailableChords] = useState<Chord[]>([]);
  const [addingExistingLoading, setAddingExistingLoading] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    setActiveBookId(initialBookId || null);
  }, [initialBookId]);

  useEffect(() => {
    function handleClickOutsideCategory(event: MouseEvent) {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setIsCategoryDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutsideCategory);
    return () => document.removeEventListener('mousedown', handleClickOutsideCategory);
  }, []);

  useEffect(() => {
    fetchChords();
    if (activeBookId) fetchBookInfo();
    else setBookTitle(null);
    if (profile) fetchUserNotebooks();
  }, [profile, activeBookId]);

  async function fetchUserNotebooks() {
    // Notebook selector functionality removed from general cards as per request
  }

  async function fetchAllAvailableChords() {
    try {
      const { data } = await supabase.from('chords').select('*').order('title');
      if (data) {
        // Filter out chords already in the notebook
        const existingIds = new Set(chords.map(c => c.id));
        setAllAvailableChords((data as Chord[]).filter(c => !existingIds.has(c.id)));
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function addExistingChordToBook(chordId: string) {
    if (!activeBookId) return;
    setAddingExistingLoading(true);
    try {
      const { error } = await supabase
        .from('chord_book_items')
        .insert([{ book_id: activeBookId, chord_id: chordId }]);
      
      if (error) {
        if (error.code === '23505') {
          setNotification({ message: 'Esta cifra já está neste caderno!', type: 'info' });
        } else {
          throw error;
        }
      } else {
        setNotification({ message: 'Cifra adicionada com sucesso!', type: 'success' });
      }
      
      await fetchChords();
      setIsAddChordModalOpen(false);
      setIsSelectingExisting(false);
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao adicionar cifra: ' + (err.message || 'Verifique sua conexão'), type: 'error' });
    } finally {
      setAddingExistingLoading(false);
    }
  }

  useEffect(() => {
    if (triggerNewChord && triggerNewChord > 0) {
      setEditingChord(null);
      setIsEditorOpen(true);
    }
  }, [triggerNewChord]);

  async function fetchBookInfo() {
    if (!activeBookId) return;
    const { data } = await supabase.from('chord_books').select('name').eq('id', activeBookId).single();
    if (data) setBookTitle(data.name);
  }

  async function fetchChords() {
    setLoading(true);
    try {
      let query = supabase.from('chords').select('*');
      
      if (activeBookId) {
        const { data: itemData, error: itemError } = await supabase
          .from('chord_book_items')
          .select('chord_id')
          .eq('book_id', activeBookId);
        
        if (itemError) throw itemError;

        const chordIds = (itemData as any[])?.map(i => i.chord_id) || [];
        if (chordIds.length === 0) {
          setChords([]);
          setNotification({ message: 'Este caderno está vazio. Adicione cifras a ele!', type: 'info' });
          setLoading(false);
          return;
        }
        query = query.in('id', chordIds);
      }

      const { data, error } = await query.order('title');
      
      if (error) throw error;
      const allChords = (data as Chord[]) || [];
      setChords(allChords);
      
      // Extract unique categories
      const allCats = allChords.flatMap(c => 
        c.category ? c.category.split(',').map((cat: string) => cat.trim()) : []
      );
      const cats = Array.from(new Set(allCats)).filter((c): c is string => !!c && c.length > 0);
      setCategories(cats);
    } catch (err: any) {
      console.error('Error fetching chords:', err);
      // Optionally show notification if you add it to props or local state
    } finally {
      setLoading(false);
    }
  }

  async function removeChordFromDb(id: string): Promise<boolean> {
    try {
      await supabase.from('chord_book_items').delete().eq('chord_id', id);
      await supabase.from('repertoire_items').delete().eq('chord_id', id);

      const { error } = await supabase
        .from('chords')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erro Supabase ao deletar cifra:', error);
        return false;
      }

      setChords(prev => prev.filter(c => c.id !== id));
      return true;
    } catch (err: any) {
      console.error('Erro crítico na exclusão:', err);
      return false;
    }
  }

  async function deleteChord(id: string) {
    const userRole = profile?.role || '';
    const allowedRoles = ['admin', 'coordinator', 'editor', 'moderator'];
    if (!allowedRoles.includes(userRole)) {
      console.warn(`Permission denied for delete: ${userRole}`);
      return;
    }
    setDeleteConfirming(true);
    await removeChordFromDb(id);
    setDeleteConfirming(false);
    setChordToDelete(null);
  }

  const normalizedSearch = (text: string) => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  };

  const stripChords = (content: string) => {
    return content.replace(/\[.*?\]/g, ' ');
  };

  // Chave usada para agrupar "a mesma música" nos casos vistos na prática:
  // cifras vindas de importação de PDF às vezes saem com um trecho de letra
  // colado no título (ex.: "Ossos Secos" e "Ossos Secos (Espírito Santo
  // Desce)"), então uma comparação de título EXATO deixa passar essas como
  // não-duplicadas. Aqui: 1) tira tudo a partir do primeiro "(" ou "-", 2)
  // normaliza acento/maiúscula, 3) tira espaço extra. "Ossos Secos" e
  // "Ossos Secos (Espírito Santo Desce)" caem na mesma chave "ossos secos".
  const duplicateGroupKey = (title: string): string => {
    const beforeParen = (title || '').split(/[(\-–—]/)[0];
    return normalizedSearch(beforeParen).replace(/\s+/g, ' ').trim();
  };

  const duplicateGroups: { key: string; title: string; items: Chord[] }[] = (() => {
    const map = new Map<string, Chord[]>();
    for (const c of chords) {
      const key = duplicateGroupKey(c.title);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    return Array.from(map.entries())
      .filter(([, items]) => items.length > 1)
      .map(([key, items]) => ({
        key,
        title: items[0].title,
        // Mais recente primeiro — e entre empates, título mais curto primeiro
        // (o título "poluído" com trecho de letra tende a ser mais longo que
        // o título limpo, então isso ajuda a sugerir o certo pra manter).
        items: [...items].sort((a, b) => {
          const dt = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          if (dt !== 0) return dt;
          return a.title.length - b.title.length;
        })
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  })();

  const deleteAllButFirstInGroup = async (group: { key: string; items: Chord[] }) => {
    const [, ...rest] = group.items;
    if (rest.length === 0) return;
    setDuplicateActionId(`group:${group.key}`);
    for (const chord of rest) {
      await removeChordFromDb(chord.id);
    }
    setDuplicateActionId(null);
  };

  const deleteOneDuplicate = async (id: string) => {
    setDuplicateActionId(id);
    await removeChordFromDb(id);
    setDuplicateActionId(null);
  };

  const RECENT_FILTER_MS: Record<'1h' | '24h' | '7d', number> = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };

  const filteredChords = chords
    .filter(c => {
      const searchLower = searchTerm.toLowerCase();
      const searchTerms = normalizedSearch(searchTerm).split(/\s+/).filter(t => t.length > 0);
      
      const chordCategories = c.category ? c.category.split(',').map(cat => cat.trim()) : [];

      const matchesCategory = selectedCategory === 'all' || chordCategories.includes(selectedCategory);

      let matchesRecent = true;
      if (recentFilter !== 'all' && c.created_at) {
        const createdMs = new Date(c.created_at).getTime();
        matchesRecent = !Number.isNaN(createdMs) && (Date.now() - createdMs) <= RECENT_FILTER_MS[recentFilter];
      }

      if (searchTerms.length === 0) {
        return matchesCategory && matchesRecent;
      }

      const titleNorm = normalizedSearch(c.title);
      const artistNorm = normalizedSearch(c.artist);
      const contentNorm = c.content ? normalizedSearch(stripChords(c.content)) : '';

      const matchesSearch = searchTerms.every(term => 
        titleNorm.includes(term) || 
        artistNorm.includes(term) || 
        contentNorm.includes(term)
      );
                           
      return matchesSearch && matchesCategory && matchesRecent;
    })
    .sort((a, b) => {
      // Com o filtro de recentes ativo, mostra as mais novas primeiro —
      // é exatamente o que ajuda a revisar/editar logo após uma importação.
      if (recentFilter !== 'all') {
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      }
      return 0; // mantém a ordem alfabética já vinda da query
    });

  return (
    <div className="space-y-6">
      {/* Notificações */}
      {notification && (
        <div className={`fixed top-4 right-4 z-[100] p-4 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 ${
          notification.type === 'success' ? 'bg-emerald-500 text-white' : 
          notification.type === 'error' ? 'bg-rose-500 text-white' : 
          'bg-slate-800 text-white'
        }`}>
          <div className="text-sm font-bold">{notification.message}</div>
        </div>
      )}
      {bookTitle && (
        <div className="bg-brand-blue/5 border border-brand-blue/10 p-4 rounded-2xl flex flex-wrap gap-4 justify-between items-center animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-3">
             <div className="bg-brand-blue/10 p-2 rounded-xl">
               <BookText className="w-6 h-6 text-brand-blue" />
             </div>
             <div>
               <p className="text-[10px] font-black text-brand-blue uppercase tracking-[0.2em]">Caderno em Exibição</p>
               <h2 className="font-black text-xl text-slate-800">{bookTitle}</h2>
             </div>
          </div>
          <div className="flex gap-3">
            <button 
              onClick={async () => {
                setIsExporting(true);
                try {
                  await exportChordsToPDF(chords, bookTitle || 'Caderno');
                } finally {
                  setIsExporting(false);
                }
              }}
              disabled={isExporting}
              className="px-4 py-2 bg-brand-blue text-white rounded-xl text-xs font-black flex items-center gap-2 hover:bg-indigo-900 transition-all shadow-lg shadow-brand-blue/20 disabled:opacity-50"
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
              EXPORTAR PDF
            </button>
            <button 
              onClick={() => setActiveBookId(null)}
              className="text-[10px] font-black px-4 py-2 bg-white border border-slate-200 rounded-xl text-slate-500 hover:text-red-500 hover:border-red-500 transition-all uppercase tracking-widest"
            >
              FECHAR CADERNO
            </button>
          </div>
          <div className="w-full mt-2">
            <button 
              onClick={() => setIsAddChordModalOpen(true)}
              className="w-full py-3 bg-brand-orange text-white rounded-xl text-xs font-black flex items-center justify-center gap-2 hover:bg-orange-600 transition-all shadow-lg shadow-brand-orange/20"
            >
              <Plus className="w-4 h-4" />
              ADICIONAR CIFRA A ESTE CADERNO
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-4 items-center justify-between mb-8">
        <div className="relative w-full md:max-w-md group">
          <Search className="absolute left-4 top-3 w-5 h-5 text-slate-300 group-focus-within:text-brand-orange transition-colors" />
          <input
            id="main-chord-search"
            type="text"
            placeholder="Buscar por título, artista ou trecho da letra..."
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-4 focus:ring-brand-orange/10 focus:border-brand-orange outline-none shadow-sm transition-all text-sm font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex gap-3 w-full md:w-auto">
          {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && (
            <button 
              onClick={() => setIsPDFImporterOpen(true)}
              className="bg-brand-blue/10 text-brand-blue px-5 py-3 rounded-2xl font-black text-xs flex items-center gap-2 hover:bg-brand-blue hover:text-white transition-all active:scale-95"
            >
              <Upload className="w-4 h-4" />
              IMPORTAR PDF
            </button>
          )}

          {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && duplicateGroups.length > 0 && (
            <button
              onClick={() => setIsDuplicatesModalOpen(true)}
              className="relative bg-amber-50 text-amber-600 px-5 py-3 rounded-2xl font-black text-xs flex items-center gap-2 hover:bg-amber-500 hover:text-white transition-all active:scale-95"
            >
              <Copy className="w-4 h-4" />
              DUPLICADAS
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                {duplicateGroups.length}
              </span>
            </button>
          )}
          
          <div className="relative" ref={categoryDropdownRef}>
            <button
              type="button"
              onClick={() => setIsCategoryDropdownOpen(prev => !prev)}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-2xl text-slate-600 font-bold text-xs hover:bg-slate-50 shadow-sm transition-all focus:ring-4 focus:ring-brand-orange/10 focus:border-brand-orange outline-none min-w-[160px] justify-between"
            >
              <span className="truncate">{selectedCategory === 'all' ? 'Todas Categorias' : selectedCategory}</span>
              <Filter className="w-3.5 h-3.5 text-slate-300 shrink-0" />
            </button>

            {isCategoryDropdownOpen && (
              <div className="absolute z-40 mt-2 w-64 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden right-0 md:left-0">
                <div className="relative p-2 border-b border-slate-100">
                  <Search className="absolute left-5 top-4.5 w-4 h-4 text-slate-300" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Buscar categoria..."
                    value={categorySearchTerm}
                    onChange={(e) => setCategorySearchTerm(e.target.value)}
                    className="w-full pl-8 pr-2 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-medium outline-none focus:border-brand-orange"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  <button
                    type="button"
                    onClick={() => { setSelectedCategory('all'); setIsCategoryDropdownOpen(false); setCategorySearchTerm(''); }}
                    className={`w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 transition-colors ${selectedCategory === 'all' ? 'text-brand-orange bg-orange-50' : 'text-slate-600'}`}
                  >
                    Todas Categorias
                  </button>
                  {categories
                    .filter(cat => cat.toLowerCase().includes(categorySearchTerm.toLowerCase()))
                    .map(cat => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => { setSelectedCategory(cat); setIsCategoryDropdownOpen(false); setCategorySearchTerm(''); }}
                        className={`w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 transition-colors truncate ${selectedCategory === cat ? 'text-brand-orange bg-orange-50' : 'text-slate-600'}`}
                      >
                        {cat}
                      </button>
                    ))}
                  {categories.filter(cat => cat.toLowerCase().includes(categorySearchTerm.toLowerCase())).length === 0 && (
                    <p className="px-4 py-3 text-[11px] text-slate-400 italic">Nenhuma categoria encontrada</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <select
            className={`flex items-center justify-center gap-2 px-4 py-3 border rounded-2xl font-bold text-xs shadow-sm transition-all focus:ring-4 focus:ring-brand-orange/10 outline-none ${
              recentFilter !== 'all'
                ? 'bg-brand-orange text-white border-brand-orange'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 focus:border-brand-orange'
            }`}
            value={recentFilter}
            onChange={(e) => setRecentFilter(e.target.value as typeof recentFilter)}
            title="Filtrar por cifras adicionadas recentemente — útil para revisar após uma importação"
          >
            <option value="all">Adicionadas: Todas</option>
            <option value="1h">Última hora</option>
            <option value="24h">Últimas 24h</option>
            <option value="7d">Últimos 7 dias</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center p-20">
          <Loader2 className="w-10 h-10 animate-spin text-brand-blue" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filteredChords.map((chord) => (
            <div 
              key={chord.id}
              className="group bg-white rounded-xl px-4 py-2.5 shadow-sm hover:shadow-md transition-all border border-slate-100 hover:border-brand-blue/30 cursor-pointer flex items-center gap-4"
              onClick={() => setSelectedChord(chord)}
            >
              <div className="bg-brand-blue/5 p-2 rounded-lg group-hover:bg-brand-blue group-hover:text-white transition-colors text-brand-blue shrink-0">
                <Music className="w-4 h-4" />
              </div>

              <div className="flex-1 min-w-0 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-sm text-slate-800 group-hover:text-brand-blue truncate">
                    {chord.title}
                  </h3>
                  <p className="text-slate-400 text-[11px] truncate">{chord.artist}</p>
                </div>

                <div className="hidden sm:flex items-center gap-2 shrink-0 flex-wrap justify-end max-w-[200px]">
                  {chord.category ? chord.category.split(',').map(cat => (
                    <span key={cat} className="text-[9px] font-black bg-brand-orange/10 text-brand-orange px-2 py-0.5 rounded uppercase tracking-wider whitespace-nowrap">
                      {cat.trim()}
                    </span>
                  )) : (
                    <span className="text-[9px] font-black bg-slate-100 text-slate-400 px-2 py-0.5 rounded uppercase tracking-wider">
                      Sem Cat.
                    </span>
                  )}
                  <span className="text-[9px] font-black bg-slate-100 text-slate-500 px-2 py-0.5 rounded uppercase tracking-wider">
                    Tom: {chord.original_key || 'C'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {(chord.youtube_url || (chord as any).youtubeUrl) && (
                  <div className="p-1 bg-red-50 rounded text-red-500">
                    <Youtube className="w-3.5 h-3.5" />
                  </div>
                )}
                {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingChord(chord);
                      setIsEditorOpen(true);
                    }}
                    className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-300 hover:text-brand-blue transition-colors"
                    title="Editar Cifra"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
                {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && (
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setChordToDelete(chord.id);
                    }}
                    className="p-1.5 hover:bg-red-50 rounded-lg text-slate-300 hover:text-red-500 transition-colors"
                    title="Excluir Cifra"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
          
          {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && (
            <button 
              onClick={() => {
                setEditingChord(null);
                setIsEditorOpen(true);
              }}
              className="flex items-center justify-center gap-2 p-3 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-brand-orange hover:text-brand-orange hover:bg-white transition-all group mt-2"
            >
              <Plus className="w-5 h-5 group-hover:scale-110 transition-transform" />
              <span className="font-bold text-xs">Nova Cifra</span>
            </button>
          )}
        </div>
      )}

      {isPDFImporterOpen && (
        <PDFImporter 
          onClose={() => setIsPDFImporterOpen(false)} 
          onImportComplete={() => {
            setIsPDFImporterOpen(false);
            fetchChords();
          }}
          bookId={activeBookId}
        />
      )}

      {selectedChord && (
        <ChordViewer 
          chord={selectedChord} 
          onClose={() => setSelectedChord(null)} 
          allChords={filteredChords}
          onSwitchChord={(c) => setSelectedChord(c)}
          onEdit={(c) => {
            setSelectedChord(null);
            setEditingChord(c);
            setIsEditorOpen(true);
          }}
        />
      )}

      {isEditorOpen && (
        <ChordEditor 
          chord={editingChord} 
          bookId={activeBookId}
          profile={profile}
          onClose={() => {
            setIsEditorOpen(false);
            setEditingChord(null);
            fetchChords();
          }} 
        />
      )}
      {isPDFImporterOpen && (
        <PDFImporter 
          onClose={() => setIsPDFImporterOpen(false)} 
          onImportComplete={() => fetchChords()}
          bookId={activeBookId}
          missionId={profile?.mission_id}
        />
      )}

      {isAddChordModalOpen && (
        <div className="fixed inset-0 z-[150] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-2xl font-black text-slate-800 mb-2">Adicionar Cifra</h3>
            <p className="text-slate-500 text-sm mb-8">Escolha como deseja adicionar uma cifra a este caderno.</p>
            
            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => {
                  setEditingChord(null);
                  setIsEditorOpen(true);
                  setIsAddChordModalOpen(false);
                }}
                className="group flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border-2 border-slate-50 hover:border-brand-blue hover:bg-brand-blue/5 transition-all text-left"
              >
                <div className="w-12 h-12 bg-brand-blue/10 text-brand-blue rounded-xl flex items-center justify-center group-hover:bg-brand-blue group-hover:text-white transition-colors">
                  <Plus className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-black text-slate-800">Criar Nova Cifra</p>
                  <p className="text-xs text-slate-400">Escreva ou cole uma cifra nova</p>
                </div>
              </button>

              <button 
                onClick={() => {
                  setIsPDFImporterOpen(true);
                  setIsAddChordModalOpen(false);
                }}
                className="group flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border-2 border-slate-50 hover:border-emerald-500 hover:bg-emerald-50/50 transition-all text-left"
              >
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-colors">
                  <Upload className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-black text-slate-800">Importar de PDF</p>
                  <p className="text-xs text-slate-400">Extraia cifras de arquivos PDF usando IA</p>
                </div>
              </button>

              <button 
                onClick={() => {
                  fetchAllAvailableChords();
                  setIsSelectingExisting(true);
                }}
                className="group flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border-2 border-slate-50 hover:border-brand-orange hover:bg-brand-orange/5 transition-all text-left"
              >
                <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-xl flex items-center justify-center group-hover:bg-brand-orange group-hover:text-white transition-colors">
                  <Music className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-black text-slate-800">Selecionar Existente</p>
                  <p className="text-xs text-slate-400">Adicione uma cifra que já está na sua biblioteca</p>
                </div>
              </button>
            </div>

            <button 
              onClick={() => setIsAddChordModalOpen(false)}
              className="w-full mt-6 py-4 text-slate-400 font-bold uppercase text-[10px] tracking-widest hover:text-slate-600"
            >
              Voltar
            </button>
          </div>
        </div>
      )}

      {isAddChordModalOpen && isSelectingExisting && (
        <div className="fixed inset-0 z-[160] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] p-8 max-w-lg w-full h-[600px] flex flex-col shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-2xl font-black text-slate-800 mb-6">Selecionar Cifra</h3>
            
            <div className="relative mb-4">
              <Search className="absolute left-4 top-3 w-4 h-4 text-slate-300" />
              <input 
                type="text" 
                placeholder="Buscar cifra..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
                onChange={(e) => {
                  const val = e.target.value.toLowerCase();
                  setAllAvailableChords(prev => prev.filter(c => 
                    c.title.toLowerCase().includes(val) || 
                    c.artist.toLowerCase().includes(val)
                  ));
                }}
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {allAvailableChords.map(chord => (
                <button
                  key={chord.id}
                  onClick={() => addExistingChordToBook(chord.id)}
                  className="w-full p-4 bg-slate-50 rounded-2xl flex items-center justify-between group hover:bg-brand-orange/5 border border-transparent hover:border-brand-orange/20 transition-all"
                >
                  <div className="text-left">
                    <p className="font-bold text-slate-800 text-sm group-hover:text-brand-orange transition-colors">{chord.title}</p>
                    <p className="text-[10px] text-slate-400 uppercase font-black">{chord.artist}</p>
                  </div>
                  <Plus className="w-4 h-4 text-slate-300 group-hover:text-brand-orange" />
                </button>
              ))}
              {allAvailableChords.length === 0 && (
                <p className="text-center py-10 text-slate-400 italic text-sm">Nenhuma cifra encontrada.</p>
              )}
            </div>

            <div className="pt-6 mt-6 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setIsSelectingExisting(false)}
                className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {chordToDelete && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Trash2 className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-xl font-black text-slate-800 mb-2">Excluir Cifra?</h3>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              Esta ação é permanente e removerá a cifra de todos os cadernos e repertórios onde ela estiver.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setChordToDelete(null)}
                disabled={deleteConfirming}
                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={() => deleteChord(chordToDelete)}
                disabled={deleteConfirming}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deleteConfirming && <Loader2 className="w-4 h-4 animate-spin" />}
                {deleteConfirming ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDuplicatesModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                <Copy className="w-5 h-5 text-amber-500" /> Cifras Duplicadas
              </h3>
              <button onClick={() => setIsDuplicatesModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
            </div>
            <p className="text-xs text-slate-400 mb-5">
              Cifras agrupadas por nome parecido (mesmo início de título). Revise e exclua as repetidas — a exclusão é permanente.
            </p>

            {duplicateGroups.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">Nenhuma duplicata encontrada. 🎉</p>
            ) : (
              <div className="flex flex-col gap-5">
                {duplicateGroups.map(group => (
                  <div key={group.key} className="border border-slate-100 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-black text-sm text-slate-700">{group.title} <span className="text-slate-400 font-bold">({group.items.length})</span></p>
                      <button
                        onClick={() => deleteAllButFirstInGroup(group)}
                        disabled={duplicateActionId === `group:${group.key}`}
                        className="text-[10px] font-black text-amber-600 bg-amber-50 hover:bg-amber-500 hover:text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {duplicateActionId === `group:${group.key}` && <Loader2 className="w-3 h-3 animate-spin" />}
                        Manter só 1, excluir demais
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {group.items.map((chord, i) => (
                        <div key={chord.id} className={`flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-xl ${i === 0 ? 'bg-green-50' : 'bg-slate-50'}`}>
                          <div className="min-w-0">
                            <p className="font-bold text-slate-600 truncate">{chord.title}{i === 0 && <span className="ml-2 text-[9px] text-green-600 font-black uppercase">sugerido p/ manter</span>}</p>
                            <p className="text-slate-400 text-[10px]">{chord.artist || 'Desconhecido'} · {new Date(chord.created_at).toLocaleDateString('pt-BR')}</p>
                          </div>
                          <button
                            onClick={() => deleteOneDuplicate(chord.id)}
                            disabled={duplicateActionId === chord.id}
                            className="shrink-0 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                          >
                            {duplicateActionId === chord.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
