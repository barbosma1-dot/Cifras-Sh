import { useState, useEffect } from 'react';
import { BookText, Plus, Share2, Users, Loader2, FileDown, Music, Search, Edit3, ChevronDown, Globe, Lock, CloudCheck, CloudOff, WifiOff } from 'lucide-react';
import { supabase, fetchAllRows } from '../lib/supabase';
import { UserProfile, ChordBook, Chord, Mission } from '../types';
import { exportChordsToPDF } from '../lib/pdfExport';
import ChordEditor from './ChordEditor';
import { saveChordBookOffline, removeOfflineChordBook, isChordBookOffline, listOfflineChordBooks } from '../lib/offlineDb';

interface ChordBooksListProps {
  profile: UserProfile | null;
  onViewChords?: (bookId: string) => void;
}

export default function ChordBooksList({ profile, onViewChords }: ChordBooksListProps) {
  const [books, setBooks] = useState<ChordBook[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [exportingBookId, setExportingBookId] = useState<string | null>(null);
  
  const [targetBookForAdd, setTargetBookForAdd] = useState<ChordBook | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isSelectingExisting, setIsSelectingExisting] = useState(false);
  const [allAvailableChords, setAllAvailableChords] = useState<Chord[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [searchChord, setSearchChord] = useState('');

  // --- Status offline por caderno (só o texto das cifras fica salvo — áudios
  // e PDFs continuam exigindo internet, mesmo com o caderno marcado como offline) ---
  const [offlineBookIds, setOfflineBookIds] = useState<Set<string>>(new Set());
  const [togglingOfflineId, setTogglingOfflineId] = useState<string | null>(null);
  const [usingOfflineBooks, setUsingOfflineBooks] = useState(false);

  useEffect(() => {
    if (books.length === 0) return;
    let cancelled = false;
    Promise.all(books.map(async (b) => ({ id: b.id, saved: await isChordBookOffline(b.id) })))
      .then((results) => {
        if (cancelled) return;
        setOfflineBookIds(new Set(results.filter(r => r.saved).map(r => r.id)));
      });
    return () => { cancelled = true; };
  }, [books]);

  async function fetchChordsForBook(bookId: string): Promise<Chord[]> {
    const { data: itemData, error: itemError } = await supabase
      .from('chord_book_items')
      .select('chord_id')
      .eq('book_id', bookId);
    if (itemError) throw itemError;
    const chordIds = ((itemData as any[]) || []).map(i => i.chord_id).filter(Boolean);
    if (chordIds.length === 0) return [];
    const chordIdSet = new Set(chordIds);
    const { data, error } = await fetchAllRows<Chord>((from, to) =>
      supabase.from('chords').select('*').order('title').range(from, to)
    );
    if (error) throw error;
    return data.filter(c => chordIdSet.has(c.id));
  }

  async function toggleOfflineForBook(book: ChordBook) {
    setTogglingOfflineId(book.id);
    try {
      if (offlineBookIds.has(book.id)) {
        await removeOfflineChordBook(book.id);
        setOfflineBookIds(prev => {
          const next = new Set(prev);
          next.delete(book.id);
          return next;
        });
        setNotification({ message: 'Removido do armazenamento offline.', type: 'success' });
      } else {
        const chords = await fetchChordsForBook(book.id);
        if (chords.length === 0) {
          setNotification({ message: 'Este caderno está vazio — adicione cifras antes de salvar offline.', type: 'error' });
          return;
        }
        await saveChordBookOffline(book, chords);
        setOfflineBookIds(prev => new Set(prev).add(book.id));
        setNotification({ message: 'Caderno salvo para uso offline! (áudios e PDFs continuam exigindo internet)', type: 'success' });
      }
    } catch (err: any) {
      setNotification({ message: 'Erro ao atualizar status offline: ' + (err.message || 'Verifique sua conexão'), type: 'error' });
    } finally {
      setTogglingOfflineId(null);
    }
  }

  useEffect(() => {
    fetchBooks();
    fetchMissions();
  }, [profile]);

  async function fetchMissions() {
    try {
      const { data } = await supabase.from('missions').select('*').order('name');
      if (data) setMissions(data);
    } catch (err) {
      console.error(err);
    }
  }

  const [isCreating, setIsCreating] = useState(false);
  const [editingBook, setEditingBook] = useState<ChordBook | null>(null);
  const [newBookForm, setNewBookForm] = useState({
    name: '',
    is_public: false,
    missionIds: [] as string[]
  });

  const toggleMissionSelection = (missionId: string) => {
    setNewBookForm(prev => ({
      ...prev,
      missionIds: prev.missionIds.includes(missionId)
        ? prev.missionIds.filter(id => id !== missionId)
        : [...prev.missionIds, missionId]
    }));
  };

  async function fetchBooks() {
    setLoading(true);
    try {
      // Sem rede: nem tenta o Supabase, vai direto pro cache offline.
      if (!navigator.onLine) {
        throw new Error('offline');
      }

      const userId = profile?.id || (profile as any)?.uid;
      if (!userId) {
        setLoading(false);
        return;
      }

      // Fetch books that belong to user's mission, are public, OR user has explicit access
      const { data, error } = await supabase
        .rpc('get_accessible_chord_books', { p_user_id: userId });
      
      let finalBooks: any[] = [];

      if (error) {
        console.warn('RPC get_accessible_chord_books failed, using fallback:', error);
        // Fallback: standard select
        const { data: fallbackData, error: fbError } = await supabase
          .from('chord_books')
          .select('*')
          .or(`is_public.eq.true,owner_id.eq.${userId}`);
        
        if (fbError) throw fbError;
        finalBooks = fallbackData || [];
      } else {
        finalBooks = data || [];
      }

      // Fetch ALL mission links for THESE books to associate correctly
      if (finalBooks.length > 0) {
        const bookIds = finalBooks.map(b => b.id);
        const { data: missionsData, error: mError } = await supabase
          .from('chord_book_missions')
          .select('book_id, mission_id')
          .in('book_id', bookIds);

        if (!mError && missionsData) {
          const booksWithMissions = finalBooks.map((b: any) => ({
            ...b,
            missionIds: missionsData.filter(m => m.book_id === b.id).map(m => m.mission_id) || []
          }));
          setBooks(booksWithMissions);
        } else {
          setBooks(finalBooks.map(b => ({ ...b, missionIds: [] })));
        }
      } else {
        setBooks([]);
      }
      setUsingOfflineBooks(false);
    } catch (err: any) {
      console.error('Error in fetchBooks:', err);

      // Fallback: mostra os cadernos que já foram salvos para uso offline,
      // em vez de deixar a tela vazia quando não há rede.
      try {
        const offlineBooks = await listOfflineChordBooks();
        if (offlineBooks.length > 0) {
          setBooks(offlineBooks.map(r => ({ ...(r.chordBook as any), missionIds: [] })));
          setUsingOfflineBooks(true);
          setNotification({ message: 'Sem conexão. Exibindo cadernos salvos offline.', type: 'error' });
          setLoading(false);
          return;
        }
      } catch (offlineErr) {
        console.error('Erro ao ler cadernos offline:', offlineErr);
      }

      setUsingOfflineBooks(false);
      setBooks([]);
      setNotification({ 
        message: 'Falha ao buscar cadernos: ' + (err.message || 'Erro de conexão'), 
        type: 'error' 
      });
    } finally {
      setLoading(false);
    }
  }

  const handleCreateBook = async () => {
    if (!newBookForm.name || !profile) {
      if (!profile) setNotification({ message: 'Perfil não carregado corretamente.', type: 'error' });
      return;
    }

    try {
      const shareCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const userId = profile.id || (profile as any).id;
      
      const { data: book, error: bookError } = await supabase.from('chord_books').insert([{
        name: newBookForm.name,
        is_public: newBookForm.is_public,
        owner_id: userId,
        share_code: shareCode,
      }]).select().single();

      if (bookError) throw bookError;
      
      if (newBookForm.missionIds.length > 0) {
        const missionLinks = newBookForm.missionIds.map(mid => ({
          book_id: book.id,
          mission_id: mid
        }));
        await supabase.from('chord_book_missions').insert(missionLinks);
      }
      
      setIsCreating(false);
      setNewBookForm({ name: '', is_public: false, missionIds: [] });
      fetchBooks();
      
      if (onViewChords && book) {
        onViewChords(book.id);
      } else {
        setNotification({ message: 'Caderno criado com sucesso!', type: 'success' });
      }
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao criar caderno: ' + (err.message || 'Verifique sua conexão'), type: 'error' });
    }
  };

  const handleJoinByCode = async () => {
    if (!joinCode || !profile) return;
    setJoining(true);
    try {
      const { data: book, error: findError } = await supabase
        .from('chord_books')
        .select('*')
        .eq('share_code', joinCode.trim().toUpperCase())
        .single();
      
      if (findError || !book) {
        setNotification({ message: 'Código inválido.', type: 'error' });
        return;
      }

      const userId = profile.id || (profile as any).uid;
      const { error: joinError } = await supabase
        .from('chord_book_access')
        .insert([{ user_id: userId, book_id: book.id }]);
      
      if (joinError && joinError.code !== '23505') throw joinError;

      setNotification({ message: `Acesso liberado ao caderno: ${book.name}`, type: 'success' });
      setIsJoinModalOpen(false);
      setJoinCode('');
      fetchBooks();
    } catch (err: any) {
      setNotification({ message: 'Erro ao entrar no caderno: ' + err.message, type: 'error' });
    } finally {
      setJoining(false);
    }
  };

  const handleExportBook = async (book: ChordBook) => {
    setExportingBookId(book.id);
    try {
      // Fetch chords for this book
      const { data: itemData } = await supabase
        .from('chord_book_items')
        .select('chord_id')
        .eq('book_id', book.id);
      
      const chordIds = (itemData as any[])?.map(i => i.chord_id) || [];
      if (chordIds.length === 0) {
        setNotification({ message: 'Este caderno está vazio.', type: 'error' });
        return;
      }

      // Evita `.in('id', chordIds)` com um caderno grande: centenas de UUIDs
      // na URL de GET podem passar do limite aceito pela rede e voltar como
      // "Bad Request" (400). Busca a tabela inteira (paginada) e filtra no
      // app pelos ids do caderno — funciona com qualquer tamanho de caderno.
      const chordIdSet = new Set(chordIds);
      const { data: allChords, error } = await fetchAllRows<Chord>((from, to) =>
        supabase.from('chords').select('*').order('title').range(from, to)
      );
      if (error) throw error;
      const chords = allChords.filter(c => chordIdSet.has(c.id));

      if (chords.length > 0) {
        await exportChordsToPDF(chords, book.name);
      }
    } catch (err) {
      console.error(err);
      setNotification({ message: 'Falha ao exportar.', type: 'error' });
    } finally {
      setExportingBookId(null);
    }
  };

  const handleAddExisting = async (chordId: string) => {
    if (!targetBookForAdd) return;
    setJoining(true);
    try {
      const { error } = await supabase
        .from('chord_book_items')
        .insert([{ book_id: targetBookForAdd.id, chord_id: chordId }]);
      
      if (error) {
        if (error.code === '23505') {
          setNotification({ message: 'Esta cifra já está neste caderno!', type: 'success' });
        } else {
          throw error;
        }
      } else {
        setNotification({ message: 'Cifra adicionada ao caderno!', type: 'success' });
      }
      
      setIsAddModalOpen(false);
      setIsSelectingExisting(false);
      fetchBooks();
    } catch (err: any) {
      setNotification({ message: 'Erro ao adicionar cifra: ' + err.message, type: 'error' });
    } finally {
      setJoining(false);
    }
  };

  const fetchChordsForSelection = async () => {
    try {
      const { data, error } = await fetchAllRows<Chord>((from, to) =>
        supabase.from('chords').select('*').order('title').range(from, to)
      );
      if (error) { console.error(error); return; }
      setAllAvailableChords(data);
    } catch (err) {
      console.error(err);
    }
  };
  const handleUpdateBook = async () => {
    if (!editingBook || !newBookForm.name) return;

    try {
      // 1. Update book basic info
      const { error: updateError } = await supabase
        .from('chord_books')
        .update({
          name: newBookForm.name,
          is_public: newBookForm.is_public
        })
        .eq('id', editingBook.id);

      if (updateError) throw updateError;
      
      // 2. Sync missions
      // Delete old ones
      await supabase.from('chord_book_missions').delete().eq('book_id', editingBook.id);
      
      // Insert new ones
      if (newBookForm.missionIds.length > 0) {
        const missionLinks = newBookForm.missionIds.map(mid => ({
          book_id: editingBook.id,
          mission_id: mid
        }));
        await supabase.from('chord_book_missions').insert(missionLinks);
      }
      
      setEditingBook(null);
      setNewBookForm({ name: '', is_public: false, missionIds: [] });
      fetchBooks();
      setNotification({ message: 'Caderno atualizado!', type: 'success' });
    } catch (err: any) {
      setNotification({ message: 'Erro ao atualizar: ' + err.message, type: 'error' });
    }
  };

  const openEditBook = async (book: ChordBook) => {
    setEditingBook(book);
    
    // Fetch current missions for this book
    const { data } = await supabase
      .from('chord_book_missions')
      .select('mission_id')
      .eq('book_id', book.id);
    
    const currentMissionIds = data?.map(m => m.mission_id) || [];
    
    setNewBookForm({
      name: book.name,
      is_public: book.is_public || false,
      missionIds: currentMissionIds
    });
  };
  const copyShareCode = (book: ChordBook) => {
    if (!book.share_code) {
      setNotification({ message: 'Este caderno não possui um código de compartilhamento.', type: 'error' });
      return;
    }
    navigator.clipboard.writeText(book.share_code);
    setNotification({ message: `Código "${book.share_code}" copiado!`, type: 'success' });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-display font-bold text-brand-blue">Meus Cadernos</h1>
          <p className="text-slate-500">Organize suas cifras por temas ou finalidades</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => setIsJoinModalOpen(true)}
            className="bg-white text-brand-blue border border-brand-blue/20 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-50 transition-all shadow-sm"
          >
            <Users className="w-5 h-5" />
            INSERIR CÓDIGO
          </button>
          <button 
            onClick={() => setIsCreating(true)}
            className="bg-brand-orange text-white px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:bg-orange-600 transition-all shadow-lg hover:shadow-orange-200"
          >
            <Plus className="w-5 h-5" />
            NOVO CADERNO
          </button>
        </div>
      </div>

      {isJoinModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-2xl font-bold text-slate-800 mb-6">Entrar em Caderno</h3>
            <div className="space-y-4">
              <input 
                type="text"
                placeholder="Código de Acesso (Ex: ABCD12)"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-blue/20 outline-none uppercase font-mono text-center text-xl tracking-widest"
              />
              <div className="flex gap-3">
                <button onClick={() => setIsJoinModalOpen(false)} className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl">Cancelar</button>
                <button 
                  onClick={handleJoinByCode} 
                  disabled={joining}
                  className="flex-1 py-4 bg-brand-blue text-white font-bold rounded-2xl flex items-center justify-center gap-2"
                >
                  {joining ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Entrar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {(isCreating || editingBook) && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-brand-orange/10 text-brand-orange rounded-2xl">
                <BookText className="w-6 h-6" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800">{editingBook ? 'Editar Caderno' : 'Novo Caderno'}</h3>
            </div>
            
            <div className="space-y-5">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Nome do Caderno</label>
                <input 
                  type="text"
                  placeholder="Ex: Advento 2024, Missas de Domingo..."
                  value={newBookForm.name}
                  onChange={(e) => setNewBookForm({ ...newBookForm, name: e.target.value })}
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-2 focus:ring-brand-blue/20 outline-none transition-all"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Vincular às Missões</label>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-2 custom-scrollbar">
                  {missions.map(m => (
                    <button
                      key={m.id}
                      onClick={() => toggleMissionSelection(m.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                        newBookForm.missionIds.includes(m.id)
                          ? 'bg-brand-blue/10 border-brand-blue text-brand-blue'
                          : 'bg-slate-50 border-slate-100 text-slate-500 hover:border-slate-200'
                      }`}
                    >
                      <span className="text-sm font-bold">{m.name}</span>
                      {newBookForm.missionIds.includes(m.id) && <div className="w-2 h-2 bg-brand-blue rounded-full" />}
                    </button>
                  ))}
                  {missions.length === 0 && (
                    <p className="text-[10px] text-slate-400 italic text-center py-2">Nenhuma missão disponível</p>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${newBookForm.is_public ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-200 text-slate-500'}`}>
                    {newBookForm.is_public ? <Globe className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-700 text-sm">Privacidade</p>
                    <p className="text-[10px] text-slate-500 font-medium">{newBookForm.is_public ? 'Público para todos' : 'Restrito'}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setNewBookForm({ ...newBookForm, is_public: !newBookForm.is_public })}
                  className={`w-12 h-6 rounded-full transition-colors relative ${newBookForm.is_public ? 'bg-brand-blue' : 'bg-slate-300'}`}
                >
                  <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${newBookForm.is_public ? 'left-7' : 'left-1'}`} />
                </button>
              </div>

              <div className="flex gap-3 pt-2">
                <button 
                  onClick={() => {
                    setIsCreating(false);
                    setEditingBook(null);
                  }}
                  className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-200 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={editingBook ? handleUpdateBook : handleCreateBook}
                  className="flex-1 py-4 bg-brand-blue text-white font-bold rounded-2xl shadow-lg shadow-brand-blue/20 hover:bg-blue-700 transition-colors"
                >
                  {editingBook ? 'Salvar' : 'Criar Agora'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-20"><Loader2 className="animate-spin text-brand-blue" /></div>
      ) : (
        <>
        {usingOfflineBooks && (
          <div className="flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 px-4 py-3 rounded-2xl text-sm font-bold mb-4">
            <WifiOff className="w-4 h-4 flex-shrink-0" />
            Sem conexão. Exibindo os cadernos salvos offline (ações como editar, adicionar cifra ou exportar PDF exigem internet).
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {books.map((book) => (
            <div 
              key={book.id}
              className="bg-white p-5 rounded-2xl border border-slate-100 hover:border-brand-blue/30 transition-all cursor-pointer group shadow-sm flex flex-col"
            >
              <div className="w-10 h-10 bg-brand-blue/5 rounded-xl flex items-center justify-center text-brand-blue mb-4 group-hover:bg-brand-blue group-hover:text-white transition-all relative">
                <BookText className="w-5 h-5" />
                {offlineBookIds.has(book.id) && (
                  <span
                    className="absolute -bottom-1.5 -right-1.5 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center border-2 border-white"
                    title="Salvo offline"
                  >
                    <CloudCheck className="w-3 h-3" />
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1 truncate">{book.name}</h3>
              <p className="text-[11px] text-slate-400 mb-4 flex items-center gap-1.5 font-medium">
                <Users className="w-3 h-3" /> 
                {book.is_public ? 'Global' : 'Missão Própria'}
              </p>
              <div className="flex gap-2 mt-auto">
                <button 
                  onClick={() => onViewChords?.(book.id)}
                  className="flex-1 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 border border-slate-100 uppercase tracking-widest transition-colors"
                >
                  Ver Cifras
                </button>
                <div className="flex gap-1">
                  {profile && (profile.email === 'barbosma1@gmail.com' || book.owner_id === profile.id) && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditBook(book);
                      }}
                      className="p-2 border border-slate-100 text-slate-400 hover:text-brand-blue hover:bg-slate-50 rounded-lg transition-colors"
                      title="Editar Caderno"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                  )}
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      setTargetBookForAdd(book);
                      setIsAddModalOpen(true);
                    }}
                    className="p-2 border border-brand-orange/20 text-brand-orange hover:bg-brand-orange/5 rounded-lg transition-colors"
                    title="Adicionar Cifra"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleOfflineForBook(book);
                    }}
                    disabled={togglingOfflineId === book.id}
                    className={`p-2 border rounded-lg transition-colors disabled:opacity-50 ${
                      offlineBookIds.has(book.id)
                        ? 'border-emerald-200 text-emerald-600 hover:bg-red-50 hover:text-red-500 hover:border-red-100'
                        : 'border-slate-100 text-slate-300 hover:text-brand-blue hover:bg-slate-50'
                    }`}
                    title={offlineBookIds.has(book.id) ? 'Salvo offline — clique para remover' : 'Salvar cifras deste caderno para uso offline'}
                  >
                    {togglingOfflineId === book.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : offlineBookIds.has(book.id) ? (
                      <CloudCheck className="w-4 h-4" />
                    ) : (
                      <CloudOff className="w-4 h-4" />
                    )}
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExportBook(book);
                    }}
                    disabled={exportingBookId === book.id}
                    className="p-2 border border-slate-100 rounded-lg text-slate-300 hover:text-green-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    title="Exportar como PDF"
                  >
                    {exportingBookId === book.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      copyShareCode(book);
                    }}
                    className="p-2 border border-slate-100 rounded-lg text-slate-300 hover:text-brand-blue hover:bg-slate-50 transition-colors"
                    title="Copiar código de compartilhamento"
                  >
                    <Share2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          
          {books.length === 0 && (
            <div className="col-span-full py-20 text-center text-slate-400">
              <BookText className="w-12 h-12 mx-auto mb-4 opacity-20" />
              <p>Nenhum caderno encontrado.</p>
            </div>
          )}
        </div>
        </>
      )}

      {/* Modais de Adição de Cifra */}
      {isAddModalOpen && targetBookForAdd && !isSelectingExisting && !isEditorOpen && (
        <div className="fixed inset-0 z-[150] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] p-8 max-w-md w-full shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200 text-center">
            <h3 className="text-2xl font-black text-slate-800 mb-2">Adicionar a {targetBookForAdd.name}</h3>
            <p className="text-slate-500 text-sm mb-8">Escolha como deseja adicionar uma cifra a este caderno.</p>
            
            <div className="grid grid-cols-1 gap-4">
              <button 
                onClick={() => setIsEditorOpen(true)}
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
                  setIsSelectingExisting(true);
                  fetchChordsForSelection();
                }}
                className="group flex items-center gap-4 p-5 bg-slate-50 rounded-2xl border-2 border-slate-50 hover:border-brand-orange hover:bg-brand-orange/5 transition-all text-left"
              >
                <div className="w-12 h-12 bg-brand-orange/10 text-brand-orange rounded-xl flex items-center justify-center group-hover:bg-brand-orange group-hover:text-white transition-colors">
                  <Music className="w-6 h-6" />
                </div>
                <div>
                  <p className="font-black text-slate-800">Selecionar Existente</p>
                  <p className="text-xs text-slate-400">Adicione uma cifra da sua biblioteca</p>
                </div>
              </button>
            </div>

            <button 
              onClick={() => setIsAddModalOpen(false)}
              className="w-full mt-6 py-4 text-slate-400 font-bold uppercase text-[10px] tracking-widest hover:text-slate-600"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isSelectingExisting && targetBookForAdd && (
        <div className="fixed inset-0 z-[160] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-[32px] p-8 max-w-lg w-full h-[600px] flex flex-col shadow-2xl border border-slate-100 animate-in zoom-in-95 duration-200">
            <h3 className="text-2xl font-black text-slate-800 mb-6 truncate max-w-full">Adicionar a {targetBookForAdd.name}</h3>
            
            <div className="relative mb-4">
              <Search className="absolute left-4 top-3 w-4 h-4 text-slate-300" />
              <input 
                type="text" 
                placeholder="Buscar cifra..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
                value={searchChord}
                onChange={(e) => setSearchChord(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {allAvailableChords
                .filter(c => 
                  c.title.toLowerCase().includes(searchChord.toLowerCase()) || 
                  c.artist.toLowerCase().includes(searchChord.toLowerCase())
                )
                .map(chord => (
                  <button
                    key={chord.id}
                    onClick={() => handleAddExisting(chord.id)}
                    className="w-full p-4 bg-slate-50 rounded-2xl flex items-center justify-between group hover:bg-brand-orange/5 border border-transparent hover:border-brand-orange/20 transition-all text-left"
                  >
                    <div>
                      <p className="font-bold text-slate-800 text-sm group-hover:text-brand-orange transition-colors">{chord.title}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-black">{chord.artist}</p>
                    </div>
                    <Plus className="w-4 h-4 text-slate-300 group-hover:text-brand-orange" />
                  </button>
                ))
              }
              {allAvailableChords.length === 0 && (
                <div className="py-20 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-brand-orange mx-auto mb-2" />
                  <p className="text-sm text-slate-400">Carregando cifras...</p>
                </div>
              )}
            </div>

            <div className="pt-6 mt-6 border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setIsSelectingExisting(false)}
                className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-2xl"
              >
                Voltar
              </button>
            </div>
          </div>
        </div>
      )}

      {isEditorOpen && targetBookForAdd && (
        <ChordEditor 
          chord={null} 
          bookId={targetBookForAdd.id}
          profile={profile}
          onClose={() => {
            setIsEditorOpen(false);
            setIsAddModalOpen(false);
          }} 
        />
      )}
      {notification && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[160] px-6 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-4 flex items-center gap-2 font-bold text-sm ${
          notification.type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-red-500 text-white border-red-400'
        }`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}
