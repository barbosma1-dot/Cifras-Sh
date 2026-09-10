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
  Check,
  AlertTriangle,
  Download,
  WifiOff,
  CheckCircle,
  Trash,
  Clock,
} from 'lucide-react';
import { supabase, fetchAllRows } from '../lib/supabase';
import { searchYoutubeForSong } from '../lib/youtubeSearch';
import { useBackButton } from '../hooks/useBackButton';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { Chord, UserProfile } from '../types';
import ChordViewer from './ChordViewer';
import ChordEditor from './ChordEditor';
import PDFImporter from './PDFImporter';
import { exportChordsToPDF } from '../lib/pdfExport';
import { removeStorageFilesByUrl } from '../lib/storageCleanup';
import {
  saveChordBookOffline,
  getOfflineChordBook,
  removeOfflineChordBook,
  isChordBookOffline,
} from '../lib/offlineDb';

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
  // Diferente de `notification` (que some sozinho em 3s), isso fica visível na tela
  // até o usuário resolver ou tentar de novo — é o que faltava para não parecer que
  // "a página ficou vazia do nada, sem erro nenhum": antes, uma falha na busca só
  // ia para o console (invisível no celular), e o caderno simplesmente aparecia
  // vazio sem nenhuma pista do motivo.
  const [chordsFetchError, setChordsFetchError] = useState<string | null>(null);
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
  const [isRecentDropdownOpen, setIsRecentDropdownOpen] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);
  const RECENT_FILTER_LABELS: Record<typeof recentFilter, string> = {
    all: 'Adicionadas: Todas',
    '1h': 'Última hora',
    '24h': 'Últimas 24h',
    '7d': 'Últimos 7 dias',
  };

  const [chordToDelete, setChordToDelete] = useState<string | null>(null);
  useBackButton(!!chordToDelete, () => setChordToDelete(null));
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [isDuplicatesModalOpen, setIsDuplicatesModalOpen] = useState(false);
  // Botão "Preencher YouTube faltantes": roda a busca em lote para TODAS as
  // cifras do banco sem youtube_url (não só as carregadas na tela).
  const [isBulkYoutubeRunning, setIsBulkYoutubeRunning] = useState(false);
  const [bulkYoutubeStatus, setBulkYoutubeStatus] = useState<string | null>(null);
  useBackButton(isDuplicatesModalOpen, () => setIsDuplicatesModalOpen(false));
  const [duplicateActionId, setDuplicateActionId] = useState<string | null>(null);

  const [isAddChordModalOpen, setIsAddChordModalOpen] = useState(false);
  const [isSelectingExisting, setIsSelectingExisting] = useState(false);
  const [allAvailableChords, setAllAvailableChords] = useState<Chord[]>([]);
  const [addingExistingLoading, setAddingExistingLoading] = useState(false);
  const [selectedExistingIds, setSelectedExistingIds] = useState<Set<string>>(new Set());
  const [existingSearchTerm, setExistingSearchTerm] = useState('');
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // --- Uso offline (só o texto das cifras — áudios e PDFs continuam exigindo internet) ---
  const isOnline = useOnlineStatus();
  const [isSavedOffline, setIsSavedOffline] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const [usingOfflineData, setUsingOfflineData] = useState(false);

  useEffect(() => {
    if (activeBookId) {
      isChordBookOffline(activeBookId).then(setIsSavedOffline);
    } else {
      setIsSavedOffline(false);
    }
  }, [activeBookId]);

  const handleSaveOffline = async () => {
    if (!activeBookId) return;
    if (chords.length === 0) {
      setNotification({ message: 'Adicione cifras ao caderno antes de salvar offline.', type: 'error' });
      return;
    }
    setSavingOffline(true);
    try {
      await saveChordBookOffline({ id: activeBookId, name: bookTitle || 'Caderno' } as any, chords);
      setIsSavedOffline(true);
      setNotification({ message: 'Caderno salvo para uso offline! (áudios e PDFs continuam exigindo internet)', type: 'success' });
    } catch (err: any) {
      setNotification({ message: 'Erro ao salvar offline: ' + err.message, type: 'error' });
    } finally {
      setSavingOffline(false);
    }
  };

  const handleRemoveOffline = async () => {
    if (!activeBookId) return;
    try {
      await removeOfflineChordBook(activeBookId);
      setIsSavedOffline(false);
      setNotification({ message: 'Removido do armazenamento offline.', type: 'success' });
    } catch (err: any) {
      setNotification({ message: 'Erro ao remover cópia offline: ' + err.message, type: 'error' });
    }
  };

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
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(event.target as Node)) {
        setIsRecentDropdownOpen(false);
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
      const { data, error } = await fetchAllRows<Chord>((from, to) =>
        supabase.from('chords').select('*').order('title').range(from, to)
      );
      if (error) { console.error(error); return; }
      // Filter out chords already in the notebook
      const existingIds = new Set(chords.map(c => c.id));
      setAllAvailableChords(data.filter(c => !existingIds.has(c.id)));
      setSelectedExistingIds(new Set());
      setExistingSearchTerm('');
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

  function toggleExistingSelection(chordId: string) {
    setSelectedExistingIds(prev => {
      const next = new Set(prev);
      if (next.has(chordId)) next.delete(chordId);
      else next.add(chordId);
      return next;
    });
  }

  function toggleSelectAllExisting() {
    setSelectedExistingIds(prev =>
      prev.size === allAvailableChords.length
        ? new Set()
        : new Set(allAvailableChords.map(c => c.id))
    );
  }

  /** Adiciona todas as cifras marcadas de uma vez (em vez de uma a uma), num único lote de inserção. */
  async function addSelectedChordsToBook() {
    if (!activeBookId || selectedExistingIds.size === 0) return;
    setAddingExistingLoading(true);
    try {
      const rows = Array.from(selectedExistingIds).map(chordId => ({ book_id: activeBookId, chord_id: chordId }));
      const { error } = await supabase.from('chord_book_items').insert(rows);

      if (error) {
        if (error.code === '23505') {
          // Alguma(s) já estava(m) no caderno (condição de corrida ou seleção
          // desatualizada) — como o Supabase rejeita o lote inteiro nesse caso,
          // inserimos uma por uma para salvar as que não são duplicadas em vez
          // de perder a seleção inteira por causa de 1 item repetido.
          let addedCount = 0;
          for (const row of rows) {
            const { error: singleError } = await supabase.from('chord_book_items').insert([row]);
            if (!singleError) addedCount++;
          }
          setNotification({
            message: addedCount > 0
              ? `${addedCount} cifra(s) adicionada(s). As demais já estavam neste caderno.`
              : 'Todas as cifras selecionadas já estavam neste caderno.',
            type: addedCount > 0 ? 'success' : 'info'
          });
        } else {
          throw error;
        }
      } else {
        setNotification({ message: `${rows.length} cifra(s) adicionada(s) com sucesso!`, type: 'success' });
      }

      await fetchChords();
      setIsAddChordModalOpen(false);
      setIsSelectingExisting(false);
      setSelectedExistingIds(new Set());
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao adicionar cifras: ' + (err.message || 'Verifique sua conexão'), type: 'error' });
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
    setChordsFetchError(null);
    try {
      if (activeBookId) {
        // Sem rede: nem tenta o Supabase, vai direto pro cache offline do caderno.
        if (!navigator.onLine) {
          throw new Error('offline');
        }

        const { data: itemData, error: itemError } = await supabase
          .from('chord_book_items')
          .select('chord_id')
          .eq('book_id', activeBookId);
        
        // Antes, esse erro (ex.: RLS bloqueando a leitura por falta de
        // permissão, ou uma falha de rede) caía só no catch lá embaixo, que
        // apenas dava console.error — no celular, isso é 100% invisível: a
        // tela mostrava o caderno vazio como se realmente não tivesse nada,
        // sem nenhuma pista de que a busca tinha falhado.
        if (itemError) {
          console.error('Erro ao buscar vínculos do caderno:', itemError);
          setChordsFetchError(
            `Não foi possível carregar as cifras deste caderno (erro ao consultar vínculos: ${itemError.message}). ` +
            `Isso costuma ser permissão do Supabase (RLS) ou conexão instável — não é o caderno estar vazio de verdade.`
          );
          setChords([]);
          setLoading(false);
          return;
        }

        // UUID v1-v5 válido (aceita maiúsc./minúsc.). Qualquer chord_id fora desse
        // formato — null, string vazia, ou lixo — quebra a consulta `.in('id', ...)`
        // lá embaixo com "Bad Request" (400) do PostgREST, porque a coluna 'id' é
        // do tipo uuid e não aceita um valor não-UUID na lista de comparação. Isso
        // também explica a tela ficar vazia "do nada, mesmo conectado": não é rede,
        // é um vínculo órfão/corrompido em chord_book_items derrubando a consulta
        // inteira, mesmo que só 1 dos vários vínculos esteja ruim.
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const rawChordIds = (itemData as any[])?.map(i => i.chord_id) || [];
        const chordIds = rawChordIds.filter((id): id is string => typeof id === 'string' && uuidRegex.test(id));
        const invalidCount = rawChordIds.length - chordIds.length;
        if (invalidCount > 0) {
          console.warn(`${invalidCount} vínculo(s) com chord_id inválido/nulo neste caderno foram ignorados para evitar erro na consulta.`);
        }
        if (chordIds.length === 0) {
          setChords([]);
          if (invalidCount > 0) {
            setChordsFetchError(
              `Este caderno tem ${invalidCount} vínculo(s) corrompido(s) (referência de cifra inválida ou nula), e nenhum vínculo válido. ` +
              `Provavelmente aconteceu numa importação ou exclusão que não removeu o vínculo direito. Recomendo remover e adicionar a(s) cifra(s) de novo.`
            );
          } else {
            setNotification({ message: 'Este caderno está vazio. Adicione cifras a ele!', type: 'info' });
          }
          setLoading(false);
          return;
        }
        // Antes, isso usava `.in('id', chordIds)` — com um caderno que tem
        // muitas cifras vinculadas (centenas), isso monta uma URL de GET com
        // centenas de UUIDs (~37 caracteres cada), que passa do limite de
        // tamanho de URL aceito pela rede/Supabase e volta como "Bad Request"
        // (400) — foi exatamente o que aconteceu com o caderno "Cantai a
        // Deus". Buscando a tabela inteira (já paginada, sem esse limite) e
        // filtrando no app pelos ids do caderno, evita o problema por
        // completo, e funciona com caderno de qualquer tamanho.
        const chordIdSet = new Set(chordIds);
        const { data, error } = await fetchAllRows<Chord>((from, to) =>
          supabase.from('chords').select('*').order('title').range(from, to)
        );
        if (error) throw error;
        const allChords = data.filter(c => chordIdSet.has(c.id));

        // Se o caderno tem vínculos (chordIds > 0) mas a busca das cifras em si
        // devolveu menos itens do que os vínculos — ou zero —, as cifras foram
        // excluídas por outro caminho (ex.: exclusão direto na tabela 'chords')
        // deixando vínculos "órfãos" em chord_book_items. Isso também explica
        // uma lista vazia sem nenhum erro técnico: a query funcionou, só não
        // achou as cifras que os vínculos apontavam.
        if (allChords.length === 0) {
          setChordsFetchError(
            `Este caderno tem ${chordIds.length} cifra(s) vinculada(s), mas nenhuma foi encontrada na biblioteca. ` +
            `Provavelmente elas foram excluídas separadamente e os vínculos ficaram órfãos.`
          );
        } else if (allChords.length < chordIds.length) {
          setChordsFetchError(
            `Atenção: ${chordIds.length - allChords.length} de ${chordIds.length} cifra(s) vinculada(s) a este caderno não foram encontradas (podem ter sido excluídas). Mostrando as ${allChords.length} restantes.`
          );
        } else if (invalidCount > 0) {
          setChordsFetchError(
            `Atenção: ${invalidCount} vínculo(s) corrompido(s) neste caderno foram ignorados. As ${allChords.length} cifra(s) válida(s) estão sendo mostradas normalmente.`
          );
        }

        setChords(allChords);
        setUsingOfflineData(false);
        const allCats = allChords.flatMap(c => 
          c.category ? c.category.split(',').map((cat: string) => cat.trim()) : []
        );
        const cats = Array.from(new Set(allCats)).filter((c): c is string => !!c && c.length > 0);
        setCategories(cats);
        setLoading(false);

        // Se este caderno já tinha sido baixado antes, mantém a cópia offline
        // atualizada (sempre sem áudios/PDFs — só o texto das cifras).
        isChordBookOffline(activeBookId).then((already) => {
          if (already) {
            saveChordBookOffline({ id: activeBookId, name: bookTitle || 'Caderno' } as any, allChords).catch(() => {});
          }
        });
        return;
      }

      const { data, error } = await fetchAllRows<Chord>((from, to) =>
        supabase.from('chords').select('*').order('title').range(from, to)
      );

      if (error) throw error;
      const allChords = data;
      setChords(allChords);
      
      // Extract unique categories
      const allCats = allChords.flatMap(c => 
        c.category ? c.category.split(',').map((cat: string) => cat.trim()) : []
      );
      const cats = Array.from(new Set(allCats)).filter((c): c is string => !!c && c.length > 0);
      setCategories(cats);
    } catch (err: any) {
      console.error('Error fetching chords:', err);

      // Se for um caderno específico, tenta cair na cópia salva offline antes
      // de desistir (áudios/PDFs não estarão disponíveis nessa cópia).
      if (activeBookId) {
        const offlineData = await getOfflineChordBook(activeBookId);
        if (offlineData) {
          setChords(offlineData.chords as Chord[]);
          setBookTitle(offlineData.chordBook.name);
          setUsingOfflineData(true);
          const allCats = offlineData.chords.flatMap(c =>
            c.category ? c.category.split(',').map((cat: string) => cat.trim()) : []
          );
          setCategories(Array.from(new Set(allCats)).filter((c): c is string => !!c && c.length > 0));
          setNotification({ message: 'Sem conexão. Exibindo o caderno salvo offline (sem áudios/PDFs).', type: 'error' });
          setLoading(false);
          return;
        }
        setUsingOfflineData(false);
        if (!navigator.onLine) {
          setNotification({ message: 'Sem conexão e este caderno não foi salvo para uso offline.', type: 'error' });
          setChords([]);
          setLoading(false);
          return;
        }
      }

      const extra = [err?.code, err?.details, err?.hint].filter(Boolean).join(' | ');
      setChordsFetchError(
        `Não foi possível carregar as cifras (${err?.message || 'erro desconhecido'}${extra ? ` — ${extra}` : ''}). Verifique sua conexão e tente novamente.`
      );
      setChords([]);
    } finally {
      setLoading(false);
    }
  }

  async function removeChordFromDb(id: string): Promise<boolean> {
    try {
      // Pega os anexos ANTES de apagar a linha — depois de apagada, não tem
      // mais como saber quais arquivos do Storage pertenciam a essa cifra.
      const chordLocal = chords.find(c => c.id === id);
      const attachmentUrls = (chordLocal?.attachments || []).map(a => a.url).filter(Boolean);

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

      // Limpeza do Storage só acontece DEPOIS da exclusão no banco ter sido
      // confirmada, e é melhor esforço (não trava nem reverte a exclusão se
      // falhar) — ver comentário em removeStorageFilesByUrl.
      if (attachmentUrls.length > 0) {
        removeStorageFilesByUrl(attachmentUrls).catch(err =>
          console.error('Falha ao limpar anexos do Storage após excluir cifra:', err)
        );
      }

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

  // Só o título parecido não basta pra provar que é a MESMA música — "HOJE"
  // de um ministério e "HOJE" de outro podem ser cifras completamente
  // diferentes com o mesmo nome. Por isso, além de agrupar por título,
  // comparamos o CONTEÚDO (letra, sem os acordes entre colchetes) de cada
  // par dentro do grupo, usando coeficiente de Dice sobre bigramas de
  // caracteres — rápido de calcular e tolerante a pequenas diferenças de
  // digitação/pontuação entre duas cópias da mesma letra.
  const charBigrams = (text: string): Set<string> => {
    const clean = normalizedSearch(text).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const grams = new Set<string>();
    for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2));
    return grams;
  };

  const contentSimilarity = (a: string, b: string): number => {
    const A = charBigrams(a);
    const B = charBigrams(b);
    if (A.size === 0 || B.size === 0) return 0; // sem conteúdo pra comparar -> não pode confirmar que é a mesma letra
    let shared = 0;
    for (const g of A) if (B.has(g)) shared++;
    return (2 * shared) / (A.size + B.size);
  };

  // Letra/acorde é considerado "a mesma música" a partir de 55% de
  // similaridade — abaixo disso, tratamos como coincidência de nome.
  const CONTENT_SIMILARITY_THRESHOLD = 0.55;

  // Chave usada para pré-agrupar candidatos por título (mesmo critério de
  // antes: cifras vindas de importação de PDF às vezes saem com um trecho de
  // letra colado no título, então tiramos tudo a partir do primeiro "(" ou
  // "-", normalizamos acento/maiúscula). Isso só decide QUEM entra na
  // comparação de conteúdo abaixo — sozinho, título parecido não confirma
  // duplicata.
  const duplicateGroupKey = (title: string): string => {
    return normalizedSearch(title || '').replace(/\s+/g, ' ').trim();
  };

  type ChordGroup = { key: string; title: string; items: Chord[] };

  // Dentro de cada grupo por título, separa em subgrupos (union-find
  // simples) por similaridade de conteúdo — assim "HOJE" com 3 letras
  // diferentes vira 3 subgrupos de 1 item cada (não aparece como
  // duplicata), e só entra na lista quem realmente tem letra parecida.
  const splitByContentSimilarity = (items: Chord[]): Chord[][] => {
    const parent = items.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (i: number, j: number) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
    const contents = items.map(c => stripChords(c.content || ''));
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (contentSimilarity(contents[i], contents[j]) >= CONTENT_SIMILARITY_THRESHOLD) union(i, j);
      }
    }
    const clusters = new Map<number, Chord[]>();
    items.forEach((c, i) => {
      const root = find(i);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(c);
    });
    return Array.from(clusters.values());
  };

  const { duplicateGroups, sameNameDifferentSongGroups } = (() => {
    const byTitle = new Map<string, Chord[]>();
    for (const c of chords) {
      const key = duplicateGroupKey(c.title);
      if (!key) continue;
      if (!byTitle.has(key)) byTitle.set(key, []);
      byTitle.get(key)!.push(c);
    }

    const real: ChordGroup[] = [];
    const sameNameOnly: ChordGroup[] = [];

    for (const [key, items] of byTitle.entries()) {
      if (items.length < 2) continue;
      const clusters = splitByContentSimilarity(items);
      clusters.forEach((clusterItems, idx) => {
        if (clusterItems.length < 2) return; // sozinho no subgrupo -> não é duplicata de ninguém
        // Mais recente primeiro — e entre empates, título mais curto primeiro
        // (o título "poluído" com trecho de letra tende a ser mais longo que
        // o título limpo, então isso ajuda a sugerir o certo pra manter).
        const sorted = [...clusterItems].sort((a, b) => {
          const dt = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          if (dt !== 0) return dt;
          return a.title.length - b.title.length;
        });
        real.push({ key: `${key}#${idx}`, title: sorted[0].title, items: sorted });
      });
      // Se o grupo por título tinha mais de um item mas NENHUM par ficou
      // junto por conteúdo, é só coincidência de nome — mostra à parte,
      // sem sugestão de exclusão em massa.
      if (clusters.every(cl => cl.length < 2) && items.length > 1) {
        sameNameOnly.push({ key, title: items[0].title, items });
      }
    }

    real.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    sameNameOnly.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
    return { duplicateGroups: real, sameNameDifferentSongGroups: sameNameOnly };
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

  /**
   * Botão "Preencher YouTube faltantes" (tela de listagem): busca TODAS as
   * cifras do banco com youtube_url vazio/nulo — não só as carregadas na
   * tela — e roda a mesma busca já usada na importação de PDF
   * (`searchYoutubeForSong`, de src/lib/youtubeSearch.ts) uma por uma, com o
   * mesmo intervalo de 600ms entre chamadas para não estourar o rate limit
   * do endpoint. Diferente da revisão de importação, aqui não existe uma
   * tela de conferência antes de salvar — cada resultado encontrado já vai
   * direto para um UPDATE no Supabase. Cifras que já têm link não são
   * tocadas (nem entram na busca) e erros numa música pulam para a próxima
   * sem travar o lote inteiro.
   */
  const fillMissingYoutubeLinksBulk = async () => {
    if (isBulkYoutubeRunning) return;
    setIsBulkYoutubeRunning(true);
    setBulkYoutubeStatus('Buscando cifras sem link do YouTube...');
    try {
      const { data: pending, error } = await fetchAllRows<Chord>((from, to) =>
        supabase
          .from('chords')
          .select('id, title, artist, category')
          .or('youtube_url.is.null,youtube_url.eq.')
          .order('title')
          .range(from, to)
      );

      if (error) {
        setNotification({ message: 'Erro ao buscar cifras sem YouTube: ' + error.message, type: 'error' });
        return;
      }

      if (pending.length === 0) {
        setNotification({ message: 'Todas as cifras já têm link do YouTube preenchido!', type: 'info' });
        return;
      }

      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
      let filled = 0;
      let notFound = 0;
      const failed: string[] = [];

      for (let i = 0; i < pending.length; i++) {
        const song = pending[i] as any;
        setBulkYoutubeStatus(`Buscando (${i + 1}/${pending.length}): ${song.title}...`);
        try {
          const videoUrl = await searchYoutubeForSong(song.title, song.artist, song.category);
          if (videoUrl) {
            const { error: updateError } = await supabase
              .from('chords')
              .update({ youtube_url: videoUrl })
              .eq('id', song.id);
            if (updateError) throw updateError;
            filled++;
            // Reflete na tela sem precisar recarregar a lista inteira.
            setChords(prev => prev.map(c => (c.id === song.id ? { ...c, youtube_url: videoUrl } : c)));
          } else {
            notFound++;
          }
        } catch (err: any) {
          console.error(`Falha ao buscar/salvar YouTube para "${song.title}":`, err);
          failed.push(song.title);
        }
        if (i < pending.length - 1) await delay(600);
      }

      const failedNote = failed.length > 0
        ? ` Falharam: ${failed.slice(0, 5).join(', ')}${failed.length > 5 ? ` e mais ${failed.length - 5}` : ''}.`
        : '';
      setNotification({
        message: `YouTube preenchido: ${filled} encontrada(s), ${notFound} sem resultado.${failedNote}`,
        type: filled > 0 ? 'success' : 'info',
      });
    } finally {
      setBulkYoutubeStatus(null);
      setIsBulkYoutubeRunning(false);
    }
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
          <div className="flex flex-wrap gap-3">
            {isSavedOffline ? (
              <button
                onClick={handleRemoveOffline}
                className="px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 text-xs font-black flex items-center gap-2 hover:bg-red-50 hover:text-red-500 hover:border-red-100 transition-all group"
                title="Salvo offline — clique para remover"
              >
                <CheckCircle className="w-4 h-4 group-hover:hidden" />
                <Trash className="w-4 h-4 hidden group-hover:block" />
                <span className="group-hover:hidden">SALVO OFFLINE</span>
                <span className="hidden group-hover:inline">REMOVER</span>
              </button>
            ) : (
              <button
                onClick={handleSaveOffline}
                disabled={savingOffline || chords.length === 0}
                className="px-4 py-2 bg-white text-slate-500 border border-slate-200 rounded-xl text-xs font-black flex items-center gap-2 hover:text-brand-blue hover:border-brand-blue transition-all disabled:opacity-40"
                title="Salvar cifras deste caderno para uso offline (áudios e PDFs continuam exigindo internet)"
              >
                {savingOffline ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                SALVAR OFFLINE
              </button>
            )}
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
          {(!isOnline || usingOfflineData) && (
            <div className="w-full flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 px-4 py-3 rounded-2xl text-sm font-bold">
              <WifiOff className="w-4 h-4 flex-shrink-0" />
              {usingOfflineData
                ? 'Você está offline. Exibindo a última versão salva deste caderno (áudios e PDFs não ficam disponíveis offline).'
                : 'Sem conexão com a internet.'}
            </div>
          )}
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

      <div className="flex flex-col gap-3 mb-8">
        {/* Barra de pesquisa — ocupa toda a largura disponível */}
        <div className="relative w-full group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300 group-focus-within:text-brand-orange transition-colors" />
          <input
            id="main-chord-search"
            type="text"
            placeholder="Buscar por título, artista ou trecho da letra..."
            className="w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:ring-4 focus:ring-brand-orange/10 focus:border-brand-orange outline-none shadow-sm transition-all text-sm font-medium"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Ações — botões reduzidos a ícones, mesma linha, cores originais mantidas.
            O nome de cada ação aparece via tooltip nativo (title) ao passar o mouse. */}
        <div className="flex flex-wrap items-center gap-2">
          {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && (
            <button
              onClick={() => setIsPDFImporterOpen(true)}
              title="Importar PDF"
              aria-label="Importar PDF"
              className="bg-brand-blue/10 text-brand-blue p-3 rounded-2xl flex items-center justify-center hover:bg-brand-blue hover:text-white transition-all active:scale-95"
            >
              <Upload className="w-4 h-4" />
            </button>
          )}

          {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && duplicateGroups.length > 0 && (
            <button
              onClick={() => setIsDuplicatesModalOpen(true)}
              title="Duplicadas"
              aria-label="Duplicadas"
              className="relative bg-amber-50 text-amber-600 p-3 rounded-2xl flex items-center justify-center hover:bg-amber-500 hover:text-white transition-all active:scale-95"
            >
              <Copy className="w-4 h-4" />
              <span className="absolute -top-1.5 -right-1.5 bg-red-500 text-white text-[9px] font-black rounded-full w-4 h-4 flex items-center justify-center">
                {duplicateGroups.length}
              </span>
            </button>
          )}

          {profile && ['admin', 'editor', 'coordinator', 'moderator'].includes(profile.role || '') && (
            <button
              onClick={fillMissingYoutubeLinksBulk}
              disabled={isBulkYoutubeRunning}
              title="Preencher YouTube faltantes"
              aria-label="Preencher YouTube faltantes"
              className="bg-red-50 text-red-600 p-3 rounded-2xl flex items-center justify-center hover:bg-red-500 hover:text-white transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-50 disabled:hover:text-red-600"
            >
              {isBulkYoutubeRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Youtube className="w-4 h-4" />}
            </button>
          )}

          <div className="relative" ref={categoryDropdownRef}>
            <button
              type="button"
              onClick={() => setIsCategoryDropdownOpen(prev => !prev)}
              title={selectedCategory === 'all' ? 'Todas Categorias' : selectedCategory || 'Categorias'}
              aria-label="Categorias"
              className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-600 flex items-center justify-center hover:bg-slate-50 shadow-sm transition-all focus:ring-4 focus:ring-brand-orange/10 focus:border-brand-orange outline-none"
            >
              <Filter className="w-4 h-4" />
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

          <div className="relative" ref={recentDropdownRef}>
            <button
              type="button"
              onClick={() => setIsRecentDropdownOpen(prev => !prev)}
              title={RECENT_FILTER_LABELS[recentFilter] + ' — filtrar por cifras adicionadas recentemente'}
              aria-label="Adicionadas"
              className={`p-3 border rounded-2xl flex items-center justify-center shadow-sm transition-all focus:ring-4 focus:ring-brand-orange/10 outline-none ${
                recentFilter !== 'all'
                  ? 'bg-brand-orange text-white border-brand-orange'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 focus:border-brand-orange'
              }`}
            >
              <Clock className="w-4 h-4" />
            </button>

            {isRecentDropdownOpen && (
              <div className="absolute z-40 mt-2 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden right-0 md:left-0">
                {(Object.keys(RECENT_FILTER_LABELS) as Array<typeof recentFilter>).map(key => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => { setRecentFilter(key); setIsRecentDropdownOpen(false); }}
                    className={`w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 transition-colors ${recentFilter === key ? 'text-brand-orange bg-orange-50' : 'text-slate-600'}`}
                  >
                    {RECENT_FILTER_LABELS[key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {bulkYoutubeStatus && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-red-500 shrink-0 animate-spin" />
          <p className="text-red-700 text-xs font-bold">{bulkYoutubeStatus}</p>
        </div>
      )}

      {chordsFetchError && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-red-700 text-sm font-medium">{chordsFetchError}</p>
            <button
              onClick={() => fetchChords()}
              className="mt-3 text-xs font-black uppercase tracking-wide text-red-600 hover:text-red-800 transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )}

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
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-black text-slate-800">Selecionar Cifras</h3>
              {allAvailableChords.length > 0 && (
                <button
                  onClick={toggleSelectAllExisting}
                  className="text-xs font-black uppercase tracking-wide text-brand-orange hover:text-orange-700 transition-colors"
                >
                  {selectedExistingIds.size === allAvailableChords.length ? 'Desmarcar todas' : 'Selecionar todas'}
                </button>
              )}
            </div>
            
            <div className="relative mb-4">
              <Search className="absolute left-4 top-3 w-4 h-4 text-slate-300" />
              <input 
                type="text" 
                value={existingSearchTerm}
                placeholder="Buscar cifra..."
                className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl text-sm outline-none focus:ring-2 focus:ring-brand-orange/20 focus:border-brand-orange transition-all"
                onChange={(e) => setExistingSearchTerm(e.target.value)}
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
              {allAvailableChords
                .filter(c => {
                  const val = existingSearchTerm.toLowerCase();
                  return !val || c.title.toLowerCase().includes(val) || c.artist.toLowerCase().includes(val);
                })
                .map(chord => {
                  const checked = selectedExistingIds.has(chord.id);
                  return (
                    <button
                      key={chord.id}
                      onClick={() => toggleExistingSelection(chord.id)}
                      className={`w-full p-4 rounded-2xl flex items-center justify-between group border transition-all ${
                        checked
                          ? 'bg-brand-orange/10 border-brand-orange/30'
                          : 'bg-slate-50 border-transparent hover:bg-brand-orange/5 hover:border-brand-orange/20'
                      }`}
                    >
                      <div className="text-left">
                        <p className="font-bold text-slate-800 text-sm group-hover:text-brand-orange transition-colors">{chord.title}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-black">{chord.artist}</p>
                      </div>
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
                        checked ? 'bg-brand-orange border-brand-orange' : 'border-slate-300'
                      }`}>
                        {checked && <Check className="w-3.5 h-3.5 text-white" />}
                      </div>
                    </button>
                  );
                })}
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
              <button
                onClick={addSelectedChordsToBook}
                disabled={selectedExistingIds.size === 0 || addingExistingLoading}
                className="flex-1 py-4 bg-brand-orange text-white font-bold rounded-2xl flex items-center justify-center gap-2 disabled:opacity-40 transition-all"
              >
                {addingExistingLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {addingExistingLoading
                  ? 'Adicionando...'
                  : `Adicionar${selectedExistingIds.size > 0 ? ` (${selectedExistingIds.size})` : ''}`}
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
              Agrupadas por nome E letra parecidos (não só o título) — reduz o risco de sugerir excluir músicas diferentes que só coincidem no nome. Revise e exclua as repetidas — a exclusão é permanente.
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

            {sameNameDifferentSongGroups.length > 0 && (
              <div className="mt-6 pt-5 border-t border-slate-100">
                <p className="text-[11px] font-black text-slate-400 uppercase mb-1">
                  Mesmo nome, música diferente ({sameNameDifferentSongGroups.length})
                </p>
                <p className="text-[11px] text-slate-400 mb-3">
                  Título parecido, mas a letra não bate o suficiente para considerar duplicata — provavelmente arranjos diferentes de ministérios diferentes. Nada aqui é excluído automaticamente.
                </p>
                <div className="flex flex-col gap-2">
                  {sameNameDifferentSongGroups.map(group => (
                    <div key={group.key} className="text-xs px-3 py-2 rounded-xl bg-slate-50">
                      <p className="font-bold text-slate-500">{group.title} <span className="text-slate-400 font-normal">({group.items.length})</span></p>
                      <p className="text-slate-400 text-[10px] truncate">
                        {group.items.map(c => c.artist || 'Desconhecido').join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
