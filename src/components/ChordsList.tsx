import { useState, useEffect } from 'react';
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

  const [chordToDelete, setChordToDelete] = useState<string | null>(null);
  const [deleteConfirming, setDeleteConfirming] = useState(false);

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

  async function deleteChord(id: string) {
    const userRole = profile?.role || '';
    const userEmail = profile?.email || '';
    const allowedRoles = ['admin', 'coordinator', 'editor', 'moderator'];
    const canDelete = allowedRoles.includes(userRole);
    
    if (!canDelete) {
      console.warn(`Permission denied for delete: ${userRole}`);
      return;
    }
    
    try {
      setDeleteConfirming(true);
      console.log(`Iniciando exclusão da cifra: ${id}`);
      
      // 1. Limpar referências
      await supabase.from('chord_book_items').delete().eq('chord_id', id);
      await supabase.from('repertoire_items').delete().eq('chord_id', id);

      // 2. Deletar a cifra principal
      const { error } = await supabase
        .from('chords')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Erro Supabase ao deletar cifra:', error);
        throw error;
      }
      
      setChords(prev => prev.filter(c => c.id !== id));
    } catch (err: any) {
      console.error('Erro crítico na exclusão:', err);
    } finally {
      setDeleteConfirming(false);
      setChordToDelete(null);
    }
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

  const filteredChords = chords.filter(c => {
    const searchLower = searchTerm.toLowerCase();
    const searchTerms = normalizedSearch(searchTerm).split(/\s+/).filter(t => t.length > 0);
    
    const chordCategories = c.category ? c.category.split(',').map(cat => cat.trim()) : [];
    
    if (searchTerms.length === 0) {
      const matchesCategory = selectedCategory === 'all' || chordCategories.includes(selectedCategory);
      return matchesCategory;
    }

    const titleNorm = normalizedSearch(c.title);
    const artistNorm = normalizedSearch(c.artist);
    const contentNorm = c.content ? normalizedSearch(stripChords(c.content)) : '';

    const matchesSearch = searchTerms.every(term => 
      titleNorm.includes(term) || 
      artistNorm.includes(term) || 
      contentNorm.includes(term)
    );
                         
    const matchesCategory = selectedCategory === 'all' || chordCategories.includes(selectedCategory);
    return matchesSearch && matchesCategory;
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
          
          <select 
            className="flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-2xl text-slate-600 font-bold text-xs hover:bg-slate-50 shadow-sm transition-all focus:ring-4 focus:ring-brand-orange/10 focus:border-brand-orange outline-none"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">Todas Categorias</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
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
    </div>
  );
}
