import { useState, useEffect } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Plus, 
  Trash2, 
  Pencil,
  GripVertical,
  Music,
  ExternalLink,
  ChevronRight,
  Loader2,
  Settings,
  ChevronDown,
  Share2,
  FileDown,
  Eye,
  BookOpen,
  Heart,
  SunDim,
  Play,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Users as UsersIcon,
  Mic2,
  Mic,
  Piano,
  Music2,
  Box,
  Download,
  CheckCircle,
  Trash,
  WifiOff
} from 'lucide-react';
import { supabase, fetchAllRows } from '../lib/supabase';
import { UserProfile, Repertoire, Chord, RepertoireAttendance, AttendanceStatus } from '../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import ChordViewer from './ChordViewer';
import ChordEditor from './ChordEditor';
import LiturgyViewer from './LiturgyViewer';
import LiturgyTextViewer, { fetchAndSaveLiturgy, loadSavedLiturgy } from './LiturgyTextViewer';
import { exportChordsToPDF } from '../lib/pdfExport';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import {
  saveRepertoireOffline,
  getOfflineRepertoire,
  removeOfflineRepertoire,
  isRepertoireOffline,
  OfflineRepertoireItem,
} from '../lib/offlineDb';
import { withTimeout } from '../lib/withTimeout';

interface RepertoireDetailProps {
  repertoire: Repertoire;
  profile: UserProfile | null;
  onBack: () => void;
}

const ROLES = [
  'Voz Masculina', 'Voz Feminina', 'Violão', 'Guitarra', 'Teclado', 'Baixo', 
  'Violoncelo', 'Violino', 'Flauta', 'Bateria', 'Outro'
];

// Tons disponíveis pra trocar o tom só dentro de um repertório (bemóis, que é
// o padrão usado nas cifras existentes — ex.: "Ab" na tela de repertórios).
const KEY_OPTIONS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const REPERTOIRE_SECTIONS: Record<string, string[]> = {
  'Missa': [
    'Canto de Entrada', 'Motivação', 'Kyrie', 'Glória', 'Salmo', 'Aclamação', 
    'Preces e outros', 'Ofertório', 'Santo', 'Or Eucaristica', 'Elevação', 
    'Amém', 'Cordeiro', 'Comunhão', 'Ação de graças', 'Envio'
  ],
  'Laudes': [
    'Invitatorio', 'Hino', 'Salmo 1', 'Cântico', 'Salmo 2', 'Benedictus', 'Extra'
  ],
  'Generico': ['Geral']
};

type RepertoireDisplayItem = Chord & { item_id: string, section: string, display_key?: string | null };

export default function RepertoireDetail({ repertoire, profile, onBack }: RepertoireDetailProps) {
  const [items, setItems] = useState<RepertoireDisplayItem[]>([]);
  const [availableChords, setAvailableChords] = useState<Chord[]>([]);
  const [missionMembers, setMissionMembers] = useState<UserProfile[]>([]);
  const [currentResponsibleId, setCurrentResponsibleId] = useState<string | null>(repertoire.responsible_id);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Filtro de categoria na busca de "adicionar música" (a mesma ideia já
  // existente na lista principal de cifras — ChordsList.tsx — estava
  // faltando aqui, o que obrigava rolar a biblioteca inteira pra achar,
  // por exemplo, só as músicas de "Adoração").
  const [addSearchCategory, setAddSearchCategory] = useState<string>('all');
  const [isAddCategoryDropdownOpen, setIsAddCategoryDropdownOpen] = useState(false);
  const [isAddingMode, setIsAddingMode] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [targetSection, setTargetSection] = useState<string>('');
  const [selectedChord, setSelectedChord] = useState<RepertoireDisplayItem | null>(null);
  const [editingChord, setEditingChord] = useState<RepertoireDisplayItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  const [attendances, setAttendances] = useState<RepertoireAttendance[]>([]);
  const [isAttendanceLoading, setIsAttendanceLoading] = useState(false);

  const isGuest = !profile;
  const canManageEscala = !isGuest && ['admin', 'coordinator', 'editor'].includes(profile.role);

  // --- Uso offline ---
  const isOnline = useOnlineStatus();
  const [isSavedOffline, setIsSavedOffline] = useState(false);
  const [savingOffline, setSavingOffline] = useState(false);
  const [usingOfflineData, setUsingOfflineData] = useState(false);

  useEffect(() => {
    isRepertoireOffline(repertoire.id).then(setIsSavedOffline);
  }, [repertoire.id]);

  const handleDownloadOffline = async () => {
    if (items.length === 0) {
      setNotification({ message: 'Adicione músicas ao repertório antes de baixar.', type: 'error' });
      return;
    }
    setSavingOffline(true);
    try {
      await saveRepertoireOffline(repertoire, items as OfflineRepertoireItem[]);
      setIsSavedOffline(true);
      setNotification({ message: 'Repertório salvo para uso offline!', type: 'success' });
    } catch (err: any) {
      setNotification({ message: 'Erro ao salvar offline: ' + err.message, type: 'error' });
    } finally {
      setSavingOffline(false);
    }
  };

  const handleRemoveOffline = async () => {
    try {
      await removeOfflineRepertoire(repertoire.id);
      setIsSavedOffline(false);
      setNotification({ message: 'Removido do armazenamento offline.', type: 'success' });
    } catch (err: any) {
      setNotification({ message: 'Erro ao remover cópia offline: ' + err.message, type: 'error' });
    }
  };

  /** Exclui este repertório já feito e volta para a lista. */
  const handleDeleteRepertoire = async () => {
    setDeletingRepertoire(true);
    try {
      const { error } = await supabase.from('repertoires').delete().eq('id', repertoire.id);
      if (error) throw error;
      try {
        await removeOfflineRepertoire(repertoire.id);
      } catch (offlineErr) {
        console.error('Repertório excluído, mas falhou ao limpar cópia offline:', offlineErr);
      }
      onBack();
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao excluir repertório: ' + err.message, type: 'error' });
      setIsDeleteConfirmOpen(false);
    } finally {
      setDeletingRepertoire(false);
    }
  };

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    // O link público (?repertoireId=...) renderiza este componente com profile=null (isGuest=true).
    // Um visitante sem login deve ver APENAS a lista de músicas deste repertório — nada de
    // biblioteca completa de cifras, membros da missão ou registros de presença da equipe.
    fetchRepertoireItems();
    if (!isGuest) {
      fetchLibrary();
      fetchMissionMembers();
      fetchAttendance();
    }
  }, [repertoire.id]);

  async function fetchAttendance() {
    setIsAttendanceLoading(true);
    try {
      const { data, error } = await supabase
        .from('repertoire_attendance')
        .select('*')
        .eq('repertoire_id', repertoire.id);
      
      if (error) throw error;
      setAttendances(data || []);
    } catch (err) {
      console.error('Erro ao buscar presença:', err);
    } finally {
      setIsAttendanceLoading(false);
    }
  }

  const handleUpdateAttendance = async (userId: string, status: AttendanceStatus, role?: string) => {
    try {
      const existingAtt = attendances.find(a => a.user_id === userId);
      
      if (existingAtt) {
        const { error } = await supabase
          .from('repertoire_attendance')
          .update({ 
            status, 
            role: role !== undefined ? role : existingAtt.role,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingAtt.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('repertoire_attendance')
          .insert([{
            repertoire_id: repertoire.id,
            user_id: userId,
            status,
            role: role || null
          }]);
        if (error) throw error;
      }
      
      await fetchAttendance();
      if (userId === profile?.id) {
        setNotification({ message: 'Sua presença foi atualizada!', type: 'success' });
      }
    } catch (err: any) {
      setNotification({ message: 'Erro ao atualizar presença: ' + err.message, type: 'error' });
    }
  };

  async function fetchMissionMembers() {
    try {
      const { data, error } = await supabase
        .from('mission_members')
        .select('user_profiles(*)')
        .eq('mission_id', repertoire.mission_id);
      
      if (data) {
        setMissionMembers((data as any[]).map(m => m.user_profiles));
      }
    } catch (err) {
      console.error('Erro ao buscar membros:', err);
    }
  }

  const [isEditingBaseInfo, setIsEditingBaseInfo] = useState(false);
  // Excluir este repertório (mesmo padrão de confirmação usado em outras
  // exclusões do app: modal com "Cancelar" / "Sim, Excluir").
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deletingRepertoire, setDeletingRepertoire] = useState(false);
  // Qual recurso litúrgico está aberto no visualizador em app (LiturgyViewer)
  // — null quando fechado. Cobre os três: Liturgia Diária, Orações
  // Eucarísticas e Laudes (Ofício). Abrir dentro do app (em vez de nova aba)
  // é o que permite ao service worker cachear a página para uso offline.
  const [openLiturgyResource, setOpenLiturgyResource] = useState<{ title: string; url: string } | null>(null);
  // Liturgia Diária virou uma tela separada (texto limpo, sem iframe) — ver
  // LiturgyTextViewer.tsx. Orações Eucarísticas e Laudes continuam no
  // visualizador antigo (iframe), que funciona bem para essas duas.
  const [isLiturgyTextOpen, setIsLiturgyTextOpen] = useState(false);

  // Data do repertório em AAAA-MM-DD (fuso LOCAL, não UTC — `toISOString()`
  // pode "voltar" um dia dependendo do horário/fuso, o que faria salvar a
  // liturgia do dia errado). `repertoire.date` normalmente vem como
  // timestamp ISO do banco.
  const repertoireDateKey = (() => {
    const d = new Date(repertoire.date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Salva a Liturgia Diária do dia deste repertório automaticamente, assim
  // que a tela abre — sem precisar que a pessoa toque em nada. Assim, quando
  // ela abrir o app já sem internet (ex.: dentro da igreja, no dia do
  // repertório), o texto já está lá. Só busca se ainda não tiver essa data
  // salva (evita gastar dados de novo à toa) e se estiver online agora.
  useEffect(() => {
    if (!repertoireDateKey) return;
    if (loadSavedLiturgy(repertoireDateKey)) return; // já salvo, nada a fazer
    if (!navigator.onLine) return;
    fetchAndSaveLiturgy(repertoireDateKey).catch(err => {
      // Silencioso de propósito: isso é um "pré-carregamento" em segundo
      // plano, não uma ação que a pessoa pediu diretamente — se falhar (site
      // fora do ar, sem rede momentânea), ela ainda pode tentar manualmente
      // depois abrindo o visualizador, que mostra o erro normalmente.
      console.warn('Pré-carregamento automático da liturgia do repertório falhou:', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repertoireDateKey]);
  const [editForm, setEditForm] = useState({
    name: repertoire.name,
    type: repertoire.type,
    date: repertoire.date,
    color: repertoire.color || 'white'
  });

  const COLORS = [
    { label: 'Branco', value: 'white', class: 'bg-white border-slate-200' },
    { label: 'Dourado', value: 'gold', class: 'bg-amber-400' },
    { label: 'Azul', value: 'blue', class: 'bg-blue-600' },
    { label: 'Verde', value: 'green', class: 'bg-emerald-500' },
    { label: 'Vermelho', value: 'red', class: 'bg-rose-500' },
    { label: 'Roxo', value: 'purple', class: 'bg-violet-600' },
  ];

  const handleUpdateBaseInfo = async () => {
    try {
      const { error } = await supabase
        .from('repertoires')
        .update({
          name: editForm.name,
          type: editForm.type,
          date: editForm.date,
          color: editForm.color
        })
        .eq('id', repertoire.id);
      
      if (error) throw error;
      setNotification({ message: 'Informações atualizadas com sucesso!', type: 'success' });
      setIsEditingBaseInfo(false);
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      setNotification({ message: 'Erro ao atualizar: ' + err.message, type: 'error' });
    }
  };

  const handleAssignResponsible = async (userId: string) => {
    setAssigning(true);
    try {
      const { error } = await supabase
        .from('repertoires')
        .update({ responsible_id: userId === 'none' ? null : userId })
        .eq('id', repertoire.id);
      
      if (error) throw error;
      setCurrentResponsibleId(userId === 'none' ? null : userId);

      if (userId !== 'none' && userId !== profile?.id) {
        await supabase.from('user_notifications').insert([{
          user_id: userId,
          title: 'Novo Repertório Atribuído',
          message: `Você foi escalado como responsável pelo repertório: ${repertoire.name}`,
          type: 'assignment'
        }]);
        setNotification({ message: 'Responsável atribuído e notificado!', type: 'success' });
      } else if (userId !== 'none') {
        setNotification({ message: 'Você se atribuiu como responsável.', type: 'success' });
      }

    } catch (err: any) {
      setNotification({ message: 'Erro ao atribuir responsável: ' + err.message, type: 'error' });
    } finally {
      setAssigning(false);
    }
  };

  const sections = REPERTOIRE_SECTIONS[repertoire.type] || 
                   REPERTOIRE_SECTIONS[repertoire.type.charAt(0).toUpperCase() + repertoire.type.slice(1).toLowerCase()] ||
                   REPERTOIRE_SECTIONS['Generico'];

  async function fetchRepertoireItems() {
    setLoading(true);
    try {
      if (!navigator.onLine) {
        // Sem rede: nem tenta o Supabase, vai direto pro cache offline.
        throw new Error('offline');
      }

      const { data, error } = await withTimeout(
        supabase
          .from('repertoire_items')
          .select(`
            id,
            order_index,
            section,
            display_key,
            chords (*)
          `)
          .eq('repertoire_id', repertoire.id)
          .order('order_index', { ascending: true }),
        8000,
        'timeout-repertoire-items'
      );

      if (error) throw error;
      
      const formatted = (data as any[]).map(d => ({
        ...d.chords,
        item_id: d.id,
        section: d.section || 'Geral',
        order_index: d.order_index,
        display_key: d.display_key ?? null
      }));

      const sectionOrder = REPERTOIRE_SECTIONS[repertoire.type] || 
                          REPERTOIRE_SECTIONS[repertoire.type.charAt(0).toUpperCase() + repertoire.type.slice(1).toLowerCase()] ||
                          REPERTOIRE_SECTIONS['Generico'];
      
      const sorted = [...formatted].sort((a, b) => {
        const indexA = sectionOrder.indexOf(a.section);
        const indexB = sectionOrder.indexOf(b.section);
        
        if (indexA === -1 && indexB === -1) return a.order_index - b.order_index;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        
        if (indexA !== indexB) return indexA - indexB;
        return a.order_index - b.order_index;
      });

      setItems(sorted);
      setUsingOfflineData(false);

      // Se este repertório já tinha sido baixado antes, mantém a cópia offline atualizada.
      const alreadyOffline = await isRepertoireOffline(repertoire.id);
      if (alreadyOffline) {
        saveRepertoireOffline(repertoire, sorted as OfflineRepertoireItem[]).catch(() => {});
      }
    } catch (err) {
      console.error('Erro ao buscar itens do repertório:', err);

      // Fallback: tenta carregar a cópia salva offline.
      const offlineData = await getOfflineRepertoire(repertoire.id);
      if (offlineData) {
        setItems(offlineData.items);
        setUsingOfflineData(true);
        setNotification({ message: 'Sem conexão. Exibindo dados salvos offline.', type: 'error' });
      } else {
        setUsingOfflineData(false);
        if (!navigator.onLine) {
          setNotification({ message: 'Sem conexão e este repertório não foi baixado para uso offline.', type: 'error' });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchLibrary() {
    try {
      const { data, error } = await fetchAllRows<Chord>((from, to) =>
        supabase.from('chords').select('*').order('title', { ascending: true }).range(from, to)
      );

      if (error) throw error;
      setAvailableChords(data);
    } catch (err) {
      console.error('Erro ao buscar biblioteca:', err);
    }
  }

  /**
   * Muda o tom só dentro DESTE repertório (não mexe na cifra original/global).
   * `newKey === ''` limpa a sobreposição e volta a usar o tom original da cifra.
   * Atualização otimista: a UI muda na hora, e desfaz se o salvamento falhar.
   */
  const handleUpdateItemKey = async (itemId: string, newKey: string) => {
    const valueToSave = newKey === '' ? null : newKey;
    const previous = items;
    setItems(prev => prev.map(it => it.item_id === itemId ? { ...it, display_key: valueToSave } : it));
    try {
      const { error } = await supabase
        .from('repertoire_items')
        .update({ display_key: valueToSave })
        .eq('id', itemId);
      if (error) throw error;
    } catch (err: any) {
      setItems(previous);
      setNotification({ message: 'Erro ao salvar o tom: ' + err.message, type: 'error' });
    }
  };

  const openAddingMode = (section: string) => {
    setTargetSection(section);
    setEditingItemId(null);
    setIsAddingMode(true);
  };

  const openEditMode = (item: RepertoireDisplayItem) => {
    setTargetSection(item.section);
    setEditingItemId(item.item_id);
    setIsAddingMode(true);
  };

  const addItem = async (chord: Chord) => {
    try {
      if (items.some(i => i.id === chord.id && i.section === targetSection)) {
        setNotification({ message: 'Esta música já está nesta seção.', type: 'error' });
        return;
      }

      const { error } = await supabase
        .from('repertoire_items')
        .insert([{
          repertoire_id: repertoire.id,
          chord_id: chord.id,
          section: targetSection,
          order_index: items.filter(i => i.section === targetSection).length
        }]);

      if (error) throw error;
      
      await fetchRepertoireItems();
    } catch (err: any) {
      setNotification({ message: 'Erro ao adicionar música: ' + err.message, type: 'error' });
    }
  };

  const swapItem = async (chord: Chord) => {
    if (!editingItemId) return;
    try {
      if (items.some(i => i.id === chord.id && i.section === targetSection && i.item_id !== editingItemId)) {
        setNotification({ message: 'Esta música já está nesta seção.', type: 'error' });
        return;
      }

      const { error } = await supabase
        .from('repertoire_items')
        .update({ chord_id: chord.id })
        .eq('id', editingItemId);

      if (error) throw error;

      setNotification({ message: 'Música trocada com sucesso!', type: 'success' });
      setIsAddingMode(false);
      setEditingItemId(null);
      await fetchRepertoireItems();
    } catch (err: any) {
      setNotification({ message: 'Erro ao trocar música: ' + err.message, type: 'error' });
    }
  };

  const removeItem = async (itemId: string) => {
    try {
      const { error } = await supabase
        .from('repertoire_items')
        .delete()
        .eq('id', itemId);

      if (error) throw error;
      setItems(items.filter(i => i.item_id !== itemId));
    } catch (err: any) {
      setNotification({ message: 'Erro ao remover música: ' + err.message, type: 'error' });
    }
  };

  const handleExportPDF = async () => {
    if (items.length === 0) {
      setNotification({ message: 'Selecione ao menos uma música para exportar.', type: 'error' });
      return;
    }
    setExporting(true);
    try {
      await exportChordsToPDF(items, `Repertório - ${repertoire.name}`);
    } catch (err) {
      console.error(err);
      setNotification({ message: 'Erro ao gerar PDF', type: 'error' });
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}?repertoireId=${repertoire.id}`;
    try {
      // O link só funciona para quem não tem login se o repertório estiver marcado como
      // público — é essa flag que a política de segurança (RLS) do Supabase usa para
      // liberar a leitura para visitantes. Sem isso, o link simplesmente não abre para
      // ninguém de fora da missão.
      if (!repertoire.is_public) {
        const { error } = await supabase
          .from('repertoires')
          .update({ is_public: true })
          .eq('id', repertoire.id);
        if (error) throw error;
        repertoire.is_public = true;
      }
      await navigator.clipboard.writeText(shareUrl);
      setNotification({ message: 'Link de compartilhamento copiado!', type: 'success' });
    } catch (err: any) {
      console.error('Erro ao gerar link público:', err);
      navigator.clipboard.writeText(shareUrl);
      setNotification({ message: 'Link copiado, mas não foi possível confirmar o acesso público. Peça a um administrador para verificar.', type: 'error' });
    }
  };

  const normalizedSearch = (text: string) => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  };

  const stripChords = (content: string) => {
    return content.replace(/\[.*?\]/g, ' ');
  };

  const addSearchCategories = Array.from(
    new Set(
      availableChords.flatMap(c => (c.category ? c.category.split(',').map(cat => cat.trim()) : []))
    )
  ).filter((c): c is string => !!c && c.length > 0).sort((a, b) => a.localeCompare(b, 'pt-BR'));

  const filteredLibrary = availableChords
    .filter(c => {
      const searchTerms = normalizedSearch(searchQuery).split(/\s+/).filter(t => t.length > 0);

      const chordCategories = c.category ? c.category.split(',').map(cat => cat.trim()) : [];
      const matchesCategory = addSearchCategory === 'all' || chordCategories.includes(addSearchCategory);
      if (!matchesCategory) return false;

      if (searchTerms.length === 0) return true;

      const titleNorm = normalizedSearch(c.title);
      const artistNorm = normalizedSearch(c.artist);
      const contentNorm = c.content ? normalizedSearch(stripChords(c.content)) : '';

      return searchTerms.every(term => 
        titleNorm.includes(term) || 
        artistNorm.includes(term) || 
        contentNorm.includes(term)
      );
    })
    .sort((a, b) => {
      // Título que contém as palavras buscadas aparece primeiro (antes só
      // ficava na ordem em que `availableChords` chegou do banco, então uma
      // música que batia o termo escondido na letra podia aparecer antes da
      // que o usuário via de cara que era pelo título).
      const searchTerms = normalizedSearch(searchQuery).split(/\s+/).filter(t => t.length > 0);
      if (searchTerms.length === 0) return a.title.localeCompare(b.title, 'pt-BR');
      const titleRank = (c: Chord) => {
        const titleNorm = normalizedSearch(c.title);
        if (searchTerms.every(term => titleNorm.includes(term))) return 0;
        const artistNorm = normalizedSearch(c.artist);
        if (searchTerms.every(term => artistNorm.includes(term))) return 1;
        return 2;
      };
      const ra = titleRank(a);
      const rb = titleRank(b);
      if (ra !== rb) return ra - rb;
      return a.title.localeCompare(b.title, 'pt-BR');
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-3 bg-slate-50 text-slate-500 rounded-2xl hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-brand-blue">{repertoire.name}</h1>
              <span className="text-[10px] font-bold px-2 py-1 bg-brand-orange/10 text-brand-orange rounded uppercase">
                {repertoire.type}
              </span>
            </div>
            <p className="text-sm text-slate-400 font-medium">
              {format(new Date(repertoire.date), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isSavedOffline ? (
            <button
              onClick={handleRemoveOffline}
              className="p-3 bg-emerald-50 text-emerald-600 rounded-xl border border-emerald-100 shadow-sm transition-all hover:bg-red-50 hover:text-red-500 hover:border-red-100 group"
              title="Salvo offline — clique para remover"
            >
              <CheckCircle className="w-5 h-5 group-hover:hidden" />
              <Trash className="w-5 h-5 hidden group-hover:block" />
            </button>
          ) : (
            <button
              onClick={handleDownloadOffline}
              disabled={savingOffline || items.length === 0}
              className="p-3 bg-white text-slate-400 hover:text-brand-blue rounded-xl border border-slate-100 shadow-sm transition-all disabled:opacity-40"
              title="Baixar para uso offline"
            >
              {savingOffline ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            </button>
          )}
          {!isGuest && (
            <button 
              onClick={() => setIsEditingBaseInfo(true)}
              className="p-3 bg-white text-slate-400 hover:text-brand-blue rounded-xl border border-slate-100 shadow-sm transition-all"
              title="Editar informações"
            >
              <Settings className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {(!isOnline || usingOfflineData) && (
        <div className="flex items-center gap-2 bg-amber-50 text-amber-700 border border-amber-200 px-4 py-3 rounded-2xl text-sm font-bold">
          <WifiOff className="w-4 h-4 flex-shrink-0" />
          {usingOfflineData
            ? 'Você está offline. Exibindo a última versão salva deste repertório.'
            : 'Sem conexão com a internet.'}
        </div>
      )}

      <AnimatePresence>
        {isEditingBaseInfo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150] flex items-center justify-center p-4 text-left"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white w-full max-w-md rounded-3xl p-8 shadow-2xl"
            >
              <h3 className="text-2xl font-bold text-slate-800 mb-6">Editar Repertório</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nome do Evento</label>
                  <input 
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-brand-blue/20"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tipo</label>
                    <select 
                      value={editForm.type}
                      onChange={(e) => setEditForm(prev => ({ ...prev, type: e.target.value }))}
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl"
                    >
                      <option value="Missa">Missa</option>
                      <option value="Laudes">Laudes</option>
                      <option value="Vésperas">Vésperas</option>
                      <option value="Adoração">Adoração</option>
                      <option value="Casamento">Casamento</option>
                      <option value="Batismo">Batismo</option>
                      <option value="Grupo de Oração">Grupo de Oração</option>
                      <option value="Outros">Outros</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Data e Hora</label>
                    <input 
                      type="datetime-local"
                      value={editForm.date ? format(new Date(editForm.date), "yyyy-MM-dd'T'HH:mm") : ''}
                      onChange={(e) => setEditForm(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cor Litúrgica</label>
                  <div className="flex gap-2">
                    {COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setEditForm(prev => ({ ...prev, color: c.value }))}
                        className={`w-10 h-10 rounded-full border-2 transition-all ${c.class} ${editForm.color === c.value ? 'ring-2 ring-brand-blue ring-offset-2 scale-110' : 'opacity-60'}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button onClick={() => setIsEditingBaseInfo(false)} className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-xl">Cancelar</button>
                <button onClick={handleUpdateBaseInfo} className="flex-1 py-4 bg-brand-blue text-white font-bold rounded-xl shadow-lg shadow-brand-blue/20">Salvar Alterações</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isAddingMode && (
        <div className="bg-brand-blue text-white p-4 rounded-2xl flex items-center justify-between animate-in slide-in-from-top-4 duration-300">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
              {editingItemId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            </div>
            <p className="font-bold text-sm">
              {editingItemId ? 'Trocando música em: ' : 'Adicionando para: '}
              <span className="text-brand-orange">{targetSection}</span>
            </p>
          </div>
          <button 
            onClick={() => { setIsAddingMode(false); setEditingItemId(null); }}
            className="text-xs font-black uppercase tracking-widest bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-all"
          >
            Concluir
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-4">
          {loading ? (
            <div className="flex justify-center p-20"><Loader2 className="animate-spin text-brand-blue" /></div>
          ) : isAddingMode ? (
            <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input 
                    id="repertoire-chord-search"
                    type="text"
                    placeholder="Buscar na biblioteca (título, artista ou letra)..."
                    className="w-full pl-12 pr-4 py-4 bg-white border border-slate-100 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setIsAddCategoryDropdownOpen(prev => !prev)}
                    title={addSearchCategory === 'all' ? 'Todas Categorias' : addSearchCategory}
                    className={`h-full px-4 py-4 rounded-2xl border shadow-sm flex items-center gap-2 text-xs font-black uppercase tracking-wider transition-colors ${addSearchCategory !== 'all' ? 'bg-brand-blue/10 border-brand-blue/30 text-brand-blue' : 'bg-white border-slate-100 text-slate-500'}`}
                  >
                    <span className="max-w-[120px] truncate">{addSearchCategory === 'all' ? 'Categoria' : addSearchCategory}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  {isAddCategoryDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-56 max-h-72 overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-100 z-20 custom-scrollbar">
                      <button
                        type="button"
                        onClick={() => { setAddSearchCategory('all'); setIsAddCategoryDropdownOpen(false); }}
                        className={`w-full text-left px-4 py-3 text-sm font-bold hover:bg-slate-50 transition-colors ${addSearchCategory === 'all' ? 'text-brand-orange bg-orange-50' : 'text-slate-700'}`}
                      >
                        Todas Categorias
                      </button>
                      {addSearchCategories.map(cat => (
                        <button
                          type="button"
                          key={cat}
                          onClick={() => { setAddSearchCategory(cat); setIsAddCategoryDropdownOpen(false); }}
                          className={`w-full text-left px-4 py-3 text-sm font-bold hover:bg-slate-50 transition-colors truncate ${addSearchCategory === cat ? 'text-brand-orange bg-orange-50' : 'text-slate-700'}`}
                        >
                          {cat}
                        </button>
                      ))}
                      {addSearchCategories.length === 0 && (
                        <p className="px-4 py-3 text-xs text-slate-400 italic">Nenhuma categoria encontrada</p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
                {filteredLibrary.map(chord => {
                  // Marca visualmente uma música que já está na seção sendo
                  // editada (targetSection), pra não ficar sem indicação de
                  // qual já foi escolhida antes de tentar adicionar de novo.
                  // Ao trocar uma música (swapItem), a própria música que
                  // está sendo trocada não conta como "já selecionada".
                  const alreadyInSection = items.some(i =>
                    i.id === chord.id &&
                    i.section === targetSection &&
                    (!editingItemId || i.item_id !== editingItemId)
                  );
                  return (
                  <div
                    key={chord.id}
                    className={`p-4 rounded-2xl border flex items-center justify-between group transition-all ${
                      alreadyInSection
                        ? 'bg-emerald-50 border-emerald-200'
                        : 'bg-white border-slate-100 hover:border-brand-blue/30'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                       <div className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all ${
                         alreadyInSection
                           ? 'bg-emerald-100 text-emerald-600'
                           : 'bg-slate-50 text-slate-400 group-hover:text-brand-blue group-hover:bg-brand-blue/5'
                       }`}>
                         {alreadyInSection ? <CheckCircle className="w-5 h-5" /> : <Music className="w-5 h-5" />}
                       </div>
                       <div>
                         <p className="font-bold text-slate-800">{chord.title}</p>
                         <p className="text-xs text-slate-500">{chord.artist} • {chord.original_key || 'N/A'}</p>
                         {alreadyInSection && (
                           <p className="text-[11px] font-bold text-emerald-600 uppercase mt-0.5">Já está nesta seção</p>
                         )}
                       </div>
                    </div>
                    {alreadyInSection ? (
                      <span
                        className="p-3 text-emerald-500"
                        title="Esta música já está nesta seção"
                      >
                        <CheckCircle className="w-5 h-5" />
                      </span>
                    ) : (
                      <button
                        onClick={() => editingItemId ? swapItem(chord) : addItem(chord)}
                        className="p-3 bg-brand-blue/5 text-brand-blue rounded-xl hover:bg-brand-blue hover:text-white transition-all"
                      >
                        {editingItemId ? <Pencil className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                      </button>
                    )}
                  </div>
                  );
                })}
                {filteredLibrary.length === 0 && (
                  <div className="text-center py-20 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200">
                    <p className="text-slate-400 italic">Nenhuma música encontrada na busca.</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => {
                const sectionItems = items.filter(i => i.section === section);
                if (sectionItems.length === 0) return null; 
                
                return (
                  <div key={section} className="group">
                    <div className="flex justify-between items-center mb-1 px-0.5">
                       <h3 className="text-[13px] font-black text-slate-600 uppercase tracking-wider">{section}</h3>
                       {!isGuest && (
                         <button 
                           onClick={() => openAddingMode(section)}
                           className="flex items-center gap-1 px-2 py-1 bg-brand-blue/5 text-brand-blue rounded-lg text-[10px] font-bold uppercase hover:bg-brand-blue hover:text-white transition-all"
                         >
                           <Plus className="w-3 h-3" />
                           Adicionar
                         </button>
                       )}
                    </div>
                    <div className="bg-white rounded-xl border border-slate-50 shadow-sm divide-y divide-slate-50 overflow-hidden">
                       {sectionItems.map((item, idx) => {
                         // Item "vazio": a seção foi criada mas nenhuma música foi
                         // atribuída a ela ainda (chord_id nulo / cifra apagada). Antes,
                         // isso renderizava uma linha em branco clicável que abria o
                         // ChordViewer com título e letra vazios — uma tela toda branca,
                         // sem nenhuma explicação, especialmente ruim pra quem abre o
                         // link público sem o app e não tem como saber o que houve.
                         const hasContent = !!(item.id && item.title);
                         return (
                         <div 
                            key={item.item_id} 
                            onClick={() => hasContent && setSelectedChord(item)}
                            className={`p-1.5 px-2.5 flex items-center gap-2 group/item transition-all ${
                              hasContent ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default opacity-60'
                            }`}
                          >
                            <div className="w-4 h-4 flex items-center justify-center bg-slate-50 text-slate-300 rounded-sm text-[8px] font-bold">
                               {idx + 1}
                            </div>
                            <div className="flex-1 overflow-hidden">
                                {hasContent ? (
                                  <>
                                    <p className="font-bold text-slate-700 text-[14px] leading-none group-hover/item:text-brand-blue transition-colors truncate">{item.title}</p>
                                    <p className="text-[7px] text-slate-400 font-medium uppercase truncate leading-none mt-0.5">{item.artist}</p>
                                  </>
                                ) : (
                                  <p className="text-[11px] italic text-slate-400 leading-none">Música ainda não definida</p>
                                )}
                             </div>
                            <div className="flex items-center gap-1.5 transition-opacity opacity-100">
                               {hasContent && <Eye className="w-3 h-3 text-slate-300" />}
                               {isGuest ? (
                                 <span className="px-1 py-0.5 bg-slate-100 text-slate-500 rounded text-[7px] font-bold">
                                    {item.display_key || item.original_key}
                                 </span>
                               ) : (
                                 <select
                                   value={item.display_key || ''}
                                   onClick={(e) => e.stopPropagation()}
                                   onChange={(e) => {
                                     e.stopPropagation();
                                     handleUpdateItemKey(item.item_id, e.target.value);
                                   }}
                                   title="Tom só neste repertório (não altera a cifra original)"
                                   className={`px-1 py-0.5 rounded text-[7px] font-bold border-0 focus:outline-none focus:ring-1 focus:ring-brand-blue cursor-pointer ${
                                     item.display_key && item.display_key !== item.original_key
                                       ? 'bg-brand-orange/10 text-brand-orange'
                                       : 'bg-slate-100 text-slate-500'
                                   }`}
                                 >
                                   <option value="">{item.original_key} (original)</option>
                                   {KEY_OPTIONS.map(k => (
                                     <option key={k} value={k}>{k}</option>
                                   ))}
                                 </select>
                               )}
                               {!isGuest && (
                                 <button 
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     openEditMode(item);
                                   }}
                                   className="p-1 text-slate-300 hover:text-brand-blue rounded transition-all"
                                   title="Trocar música"
                                 >
                                   <Pencil className="w-2.5 h-2.5" />
                                 </button>
                               )}
                               {!isGuest && (
                                 <button 
                                   onClick={(e) => {
                                     e.stopPropagation();
                                     removeItem(item.item_id);
                                   }}
                                   className="p-1 text-slate-300 hover:text-red-500 rounded transition-all"
                                   title="Excluir música"
                                 >
                                   <Trash2 className="w-2.5 h-2.5" />
                                 </button>
                               )}
                            </div>
                         </div>
                         );
                       })}
                    </div>
                  </div>
                );
              })}
              
              {!isGuest && (
                <div className="pt-4 border-t border-slate-50">
                  <p className="text-[8px] font-bold text-slate-300 uppercase tracking-widest mb-2">Adicionar Música a uma Seção</p>
                  <div className="flex flex-wrap gap-2">
                    {sections.map(section => {
                      const sectionItems = items.filter(i => i.section === section);
                      const hasItems = sectionItems.length > 0;
                      return (
                        <button
                          key={section}
                          onClick={() => openAddingMode(section)}
                          className="px-2.5 py-1.5 bg-slate-50 text-slate-400 rounded-lg text-[11px] font-bold uppercase hover:bg-brand-blue/5 hover:text-brand-blue transition-colors border border-transparent hover:border-brand-blue/20"
                        >
                          + {section}{hasItems ? ` (${sectionItems.length})` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 space-y-6">
           <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm sticky top-6">
             <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
               {isGuest ? <Music className="w-4 h-4 text-brand-orange" /> : <Settings className="w-4 h-4 text-brand-orange" />}
               {isGuest ? 'Opções de Visualização' : 'Ações do Repertório'}
             </h3>
             <div className="space-y-4">
                <button 
                  onClick={() => {
                    // Pula seções ainda sem música definida (chord_id nulo) em vez de
                    // sempre abrir items[0] — antes, se o Canto de Entrada estivesse
                    // vazio, o botão abria o ChordViewer em branco, sem nenhuma cifra
                    // pra mostrar, o que parecia uma tela quebrada pra quem clicava.
                    const firstPlayable = items.find(it => it.id && it.title);
                    if (firstPlayable) setSelectedChord(firstPlayable);
                  }}
                  disabled={!items.some(it => it.id && it.title)}
                  className="w-full p-4 bg-brand-blue-light text-white font-black rounded-2xl text-left flex items-center justify-between hover:bg-brand-blue-light/90 shadow-lg shadow-brand-blue-light/20 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    <Play className="w-5 h-5 fill-current" />
                    <span className="flex flex-col">
                       <span className="text-sm">Viver Sequência</span>
                       <span className="text-[10px] font-medium opacity-70 leading-none mt-1">Sempre do Canto de Entrada</span>
                    </span>
                  </span>
                  <ChevronRight className="w-4 h-4 opacity-50" />
                </button>

                <div className="pt-1 flex flex-col gap-2">
                   <button 
                     onClick={handleExportPDF}
                     disabled={exporting}
                     className="w-full p-4 bg-brand-peach/40 text-brand-orange font-bold rounded-2xl text-left flex items-center justify-between border border-brand-peach-border/60 hover:bg-brand-peach/60 transition-colors disabled:opacity-50"
                   >
                     <span className="flex items-center gap-2">
                       {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />}
                       {exporting ? 'Gerando...' : 'Exportar PDF'}
                     </span>
                     <ExternalLink className="w-4 h-4 opacity-30" />
                   </button>
                   <button 
                     onClick={handleShare}
                     className="w-full p-4 bg-brand-peach/40 text-brand-orange font-bold rounded-2xl text-left flex items-center justify-between border border-brand-peach-border/60 hover:bg-brand-peach/60 transition-colors"
                   >
                     <span className="flex items-center gap-2">
                       <Share2 className="w-4 h-4" />
                       Compartilhar Link
                     </span>
                     <ExternalLink className="w-4 h-4 opacity-30" />
                   </button>
                   {!isGuest && (
                     <button 
                       onClick={() => setIsDeleteConfirmOpen(true)}
                       className="w-full p-4 bg-red-50 text-red-500 font-bold rounded-2xl text-left flex items-center justify-between hover:bg-red-500 hover:text-white transition-colors"
                     >
                       <span className="flex items-center gap-2">
                         <Trash2 className="w-4 h-4" />
                         Excluir Repertório
                       </span>
                     </button>
                   )}
                </div>

                {(repertoire.type === 'Missa' || repertoire.type === 'Laudes') && (
                  <div className="pt-4 border-t border-slate-50 space-y-2">
                    <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">Recursos Litúrgicos</p>
                    {repertoire.type === 'Missa' && (
                      <>
                        <button
                          onClick={() => setIsLiturgyTextOpen(true)}
                          className="w-full p-4 bg-brand-orange/5 text-brand-orange font-bold rounded-2xl text-left flex items-center justify-between hover:bg-brand-orange/10 transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <BookOpen className="w-4 h-4" />
                            Liturgia Diária
                          </span>
                          <ExternalLink className="w-4 h-4 opacity-50" />
                        </button>
                        <button
                          onClick={() => setOpenLiturgyResource({ title: 'Orações Eucarísticas', url: 'https://www.catolicoorante.com.br/oeucaristicas.html' })}
                          className="w-full p-4 bg-brand-blue/5 text-brand-blue font-bold rounded-2xl text-left flex items-center justify-between hover:bg-brand-blue/10 transition-colors"
                        >
                          <span className="flex items-center gap-2">
                            <Heart className="w-4 h-4" />
                            Orações Eucarísticas
                          </span>
                          <ExternalLink className="w-4 h-4 opacity-50" />
                        </button>
                      </>
                    )}

                    {repertoire.type === 'Laudes' && (
                      <button
                        onClick={() => setOpenLiturgyResource({ title: 'Laudes (Ofício)', url: 'https://www.paulus.com.br/portal/liturgia-diaria-das-horas/' })}
                        className="w-full p-4 bg-brand-blue/5 text-brand-blue font-bold rounded-2xl text-left flex items-center justify-between hover:bg-brand-blue/10 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <SunDim className="w-4 h-4" />
                          Laudes (Ofício)
                        </span>
                        <ExternalLink className="w-4 h-4 opacity-50" />
                      </button>
                    )}
                  </div>
                )}

                {!isGuest && (
                  <div className="pt-4 border-t border-slate-50">
                    <label className="block text-[10px] text-slate-400 font-bold uppercase mb-2">Responsável</label>
                    <select 
                      value={currentResponsibleId || 'none'}
                      onChange={(e) => handleAssignResponsible(e.target.value)}
                      disabled={assigning}
                      className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    >
                      <option value="none">Nenhum Atribuído</option>
                      {missionMembers.map(m => (
                        <option key={m.id} value={m.id}>{m.displayName || (m as any).display_name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {!isGuest && (
                  <div className="pt-4 border-t border-slate-50">
                    <label className="block text-[10px] text-slate-400 font-bold uppercase mb-3">Minha Escala</label>
                    <div className="flex gap-2">
                       {[
                         { id: 'confirmed', icon: CheckCircle2, label: 'Vou', color: 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100' },
                         { id: 'declined', icon: XCircle, label: 'Não vou', color: 'bg-rose-50 text-rose-600 border-rose-100 hover:bg-rose-100' },
                         { id: 'tentative', icon: HelpCircle, label: 'Em dúvida', color: 'bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100' }
                       ].map(status => {
                         const current = attendances.find(a => a.user_id === profile.id);
                         const isActive = current?.status === status.id;
                         return (
                           <button
                             key={status.id}
                             onClick={() => handleUpdateAttendance(profile.id, status.id as AttendanceStatus)}
                             className={`flex-1 flex flex-col items-center gap-1 p-2 rounded-xl border transition-all ${isActive ? status.color.replace('bg-emerald-50', 'bg-emerald-500').replace('text-emerald-600', 'text-white').replace('bg-rose-50', 'bg-rose-500').replace('text-rose-600', 'text-white').replace('bg-amber-50', 'bg-amber-500').replace('text-amber-600', 'text-white') : 'bg-white text-slate-400 border-slate-100 hover:bg-slate-50'}`}
                           >
                             <status.icon className="w-4 h-4" />
                             <span className="text-[9px] font-bold">{status.label}</span>
                           </button>
                         );
                       })}
                    </div>
                    {attendances.find(a => a.user_id === profile.id)?.status === 'confirmed' && (
                      <div className="mt-3">
                        <select 
                          value={attendances.find(a => a.user_id === profile.id)?.role || ''}
                          onChange={(e) => handleUpdateAttendance(profile.id, 'confirmed', e.target.value)}
                          className="w-full p-2 bg-slate-50 border border-slate-100 rounded-lg text-[10px] font-bold text-slate-600"
                        >
                          <option value="">Selecione sua função...</option>
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-4 border-t border-slate-50">
                  <div className="flex justify-between items-center mb-3">
                    <label className="block text-[10px] text-slate-400 font-bold uppercase">Escala da Missão</label>
                    <span className="text-[10px] font-bold text-emerald-500 bg-emerald-50 px-2 rounded-full">
                      {attendances.filter(a => a.status === 'confirmed').length} Confirmados
                    </span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {missionMembers.map(member => {
                      const att = attendances.find(a => a.user_id === member.id);
                      return (
                        <div key={member.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50/50 border border-slate-50 group hover:border-slate-100 transition-all">
                           <div className="flex items-center gap-2 overflow-hidden">
                              <div className="w-6 h-6 rounded-full bg-brand-orange/10 text-brand-orange flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-black">{member.display_name?.charAt(0).toUpperCase()}</span>
                              </div>
                              <div className="overflow-hidden">
                                <p className="text-[10px] font-bold text-slate-700 truncate">{member.display_name}</p>
                                <p className="text-[9px] text-slate-400 truncate tracking-tight">{att?.role || 'Visitante'}</p>
                              </div>
                           </div>
                           <div className="flex items-center gap-1.5 shrink-0">
                              {canManageEscala ? (
                                <select 
                                  value={att?.status || 'none'}
                                  onChange={(e) => handleUpdateAttendance(member.id, e.target.value as AttendanceStatus)}
                                  className={`p-1 bg-white border border-slate-100 rounded text-[9px] font-bold focus:outline-none ${att?.status === 'confirmed' ? 'text-emerald-600' : att?.status === 'declined' ? 'text-rose-600' : 'text-slate-400'}`}
                                >
                                   <option value="none">-</option>
                                   <option value="confirmed">Sim</option>
                                   <option value="declined">Não</option>
                                   <option value="tentative">?</option>
                                </select>
                              ) : (
                                att?.status === 'confirmed' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> :
                                att?.status === 'declined' ? <XCircle className="w-3.5 h-3.5 text-rose-500" /> :
                                att?.status === 'tentative' ? <HelpCircle className="w-3.5 h-3.5 text-amber-500" /> : null
                              )}
                              
                              {canManageEscala && att?.status === 'confirmed' && (
                                <select 
                                  value={att?.role || ''}
                                  onChange={(e) => handleUpdateAttendance(member.id, 'confirmed', e.target.value)}
                                  className="w-16 p-1 bg-white border border-slate-100 rounded text-[9px] font-bold focus:outline-none"
                                >
                                   <option value="">Função</option>
                                   {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                                </select>
                              )}
                           </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-50">
                  <p className="text-[10px] text-slate-400 font-bold uppercase mb-2">Resumo</p>
                  <div className="grid grid-cols-2 gap-2">
                     <div className="bg-slate-50 p-3 rounded-xl text-center">
                        <p className="text-lg font-black text-brand-blue">{items.length}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase">Músicas</p>
                     </div>
                     <div className="bg-slate-50 p-3 rounded-xl text-center">
                        <p className="text-lg font-black text-brand-orange">{sections.length}</p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase">Seções</p>
                     </div>
                  </div>
                </div>
             </div>
           </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedChord && (
          <ChordViewer 
            chord={selectedChord} 
            onClose={() => setSelectedChord(null)} 
            allChords={items}
            onSwitchChord={(c) => setSelectedChord(c)}
            onEdit={!isGuest ? (c) => {
              setSelectedChord(null);
              setEditingChord(c);
            } : undefined}
          />
        )}
      </AnimatePresence>

      {editingChord && (
        <ChordEditor 
          chord={editingChord}
          profile={profile}
          onClose={() => {
            setEditingChord(null);
            fetchRepertoireItems();
            fetchLibrary();
          }}
        />
      )}

      {openLiturgyResource && (
        <LiturgyViewer
          title={openLiturgyResource.title}
          url={openLiturgyResource.url}
          onClose={() => setOpenLiturgyResource(null)}
        />
      )}

      {isLiturgyTextOpen && (
        <LiturgyTextViewer onClose={() => setIsLiturgyTextOpen(false)} date={repertoireDateKey} />
      )}

      {isDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[160] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Trash2 className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-xl font-black text-slate-800 mb-2">Excluir Repertório?</h3>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              Tem certeza que deseja excluir "{repertoire.name}"? Esta ação é permanente — as cifras em si não são apagadas, só este repertório e a lista de músicas dele.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={deletingRepertoire}
                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteRepertoire}
                disabled={deletingRepertoire}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {deletingRepertoire && <Loader2 className="w-4 h-4 animate-spin" />}
                {deletingRepertoire ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notificações */}
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
