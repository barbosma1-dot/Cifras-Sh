import { useState, useEffect, useRef } from 'react';
import { 
  Music, 
  BookText, 
  ListMusic, 
  Users, 
  UserCircle, 
  Settings, 
  LogOut, 
  Menu, 
  X,
  PlusCircle,
  Search,
  ChevronRight,
  Bell,
  Download,
  History
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile, UserNotification } from '../types';
import ChordsList from './ChordsList';
import ChordBooksList from './ChordBooksList';
import RepertoireList from './RepertoireList';
import MissionView from './MissionView';
import ProfileView from './ProfileView';
import AdminSettings from './AdminSettings';
import ImportBatchesList from './ImportBatchesList';
import { useBackButton } from '../hooks/useBackButton';
import { motion, AnimatePresence } from 'motion/react';
import { usePWAInstall } from '../hooks/usePWAInstall';

const getRoleLabel = (role?: string) => {
  if (!role) return 'Membro';
  switch (role) {
    case 'admin': return 'Administrador';
    case 'coordinator': return 'Coordenador';
    case 'editor': return 'Editor';
    default: return 'Membro';
  }
};

interface DashboardProps {
  user: any;
  profile: UserProfile | null;
  setProfile: (p: UserProfile | null) => void;
}

export default function Dashboard({ user, profile, setProfile }: DashboardProps) {
  // Restaura a última aba/tela aberta ao carregar — sem isso, todo Android
  // que mata o processo do PWA em segundo plano (comportamento normal do
  // sistema pra economizar memória, não é um "fechar" real do app) faz o
  // usuário voltar pra tela inicial ao reabrir, mesmo estando "no meio" de
  // uma tarefa. Guardamos só em localStorage (não em cada tecla digitada em
  // busca/formulário — isso continua se perdendo, só a ABA/TELA persiste).
  const LAST_VIEW_KEY = 'cifrash:lastView';
  const readLastView = (): { tab: string; bookId: string | null; missionId: string | null; repertoireId: string | null } | null => {
    try {
      const raw = localStorage.getItem(LAST_VIEW_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const lastView = readLastView();

  const [activeTab, setActiveTab] = useState(lastView?.tab || 'chords');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  
  // New States for filtering
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(lastView?.missionId || null);
  const [selectedChordBookId, setSelectedChordBookId] = useState<string | null>(lastView?.bookId || null);
  const [selectedRepertoireId, setSelectedRepertoireId] = useState<string | null>(lastView?.repertoireId || null);
  const [triggerNewChord, setTriggerNewChord] = useState(0);

  // Salva a cada mudança de aba/seleção — leve o bastante pra rodar em todo
  // clique, sem precisar de debounce.
  useEffect(() => {
    try {
      localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({
        tab: activeTab,
        bookId: selectedChordBookId,
        missionId: selectedMissionId,
        repertoireId: selectedRepertoireId,
      }));
    } catch {
      // Storage indisponível (modo privado, cota cheia) — não é crítico, só
      // significa que a última tela não será lembrada dessa vez.
    }
  }, [activeTab, selectedChordBookId, selectedMissionId, selectedRepertoireId]);

  // Botão voltar do Android: só sai do app quando já está na aba "Cifras"
  // sem nenhum caderno/missão/repertório selecionado (a "página inicial").
  // Fora disso, volta pra lá em vez de fechar o app. Telas em modal (ver
  // cifra, editar, importar PDF) já lidam com o botão voltar sozinhas — ver
  // `useBackButton` em ChordViewer/ChordEditor/PDFImporter.
  const isAwayFromHome = activeTab !== 'chords' || !!selectedChordBookId || !!selectedMissionId || !!selectedRepertoireId;
  useBackButton(isAwayFromHome, () => {
    if (selectedChordBookId) setSelectedChordBookId(null);
    else if (selectedMissionId) setSelectedMissionId(null);
    else if (selectedRepertoireId) setSelectedRepertoireId(null);
    else setActiveTab('chords');
  });

  const { isInstallable, install } = usePWAInstall();
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!sidebarRef.current || sidebarRef.current.contains(event.target as Node)) return;

      if (window.innerWidth < 768) {
        if (isSidebarOpen) setIsSidebarOpen(false);
      } else {
        if (isSidebarOpen && !isCollapsed) setIsCollapsed(true);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isSidebarOpen, isCollapsed]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repertoireId = params.get('repertoireId');
    if (repertoireId) {
      setSelectedRepertoireId(repertoireId);
      setActiveTab('repertoires');
    }
  }, []);

  useEffect(() => {
    if (profile) {
      fetchNotifications();
      
      // Subscribe to new notifications
      const channel = supabase
        .channel('schema-db-changes')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'user_notifications',
            filter: `user_id=eq.${profile.id}`
          },
          (payload) => {
            setNotifications(prev => [payload.new as UserNotification, ...prev]);
          }
        )
        .subscribe();
      
      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [profile?.id]);

  async function fetchNotifications() {
    try {
      const { data } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profile?.id)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (data) setNotifications(data as UserNotification[]);
    } catch (err) {
      console.error(err);
    }
  }

  const markAsRead = async () => {
    try {
      await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_id', profile?.id)
        .eq('is_read', false);
      
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const menuItems = [
    { id: 'chords', label: 'Cifras', icon: Music },
    { id: 'chordBooks', label: 'Cadernos', icon: BookText },
    { id: 'repertoires', label: 'Repertórios', icon: ListMusic },
    { id: 'mission', label: 'Missão', icon: Users },
    { id: 'profile', label: 'Meu Perfil', icon: UserCircle },
  ];

  if (['admin', 'editor', 'coordinator', 'moderator'].includes(profile?.role || '')) {
    menuItems.splice(2, 0, { id: 'importBatches', label: 'Lotes de Importação', icon: History });
  }

  const isAdmin = profile?.role === 'admin' || 
                  profile?.email === 'barbosma1@gmail.com' || 
                  user?.email === 'barbosma1@gmail.com';

  if (isAdmin) {
    menuItems.push({ id: 'settings', label: 'Configurações', icon: Settings });
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'chords': 
        return (
          <ChordsList 
            profile={profile} 
            initialBookId={selectedChordBookId} 
            triggerNewChord={triggerNewChord}
          />
        );
      case 'chordBooks': 
        return (
          <ChordBooksList 
            profile={profile} 
            onViewChords={(bookId) => {
              setSelectedChordBookId(bookId);
              setActiveTab('chords');
            }} 
          />
        );
      case 'repertoires': 
        return (
          <RepertoireList 
            profile={profile} 
            initialMissionId={selectedMissionId} 
            initialRepertoireId={selectedRepertoireId}
          />
        );
      case 'mission': 
        return (
          <MissionView 
            profile={profile} 
            setProfile={setProfile} 
            onSelectMission={(missionId) => {
              setSelectedMissionId(missionId);
              setActiveTab('repertoires');
            }}
            onViewChords={(bookId) => {
              setSelectedChordBookId(bookId);
              setActiveTab('chords');
            }}
          />
        );
      case 'importBatches': return <ImportBatchesList profile={profile} />;
      case 'profile': return <ProfileView profile={profile} setProfile={setProfile} />;
      case 'settings': return <AdminSettings profile={profile} />;
      default: return <ChordsList profile={profile} />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Sidebar - Desktop/Mobile */}
      <motion.div
        ref={sidebarRef}
        initial={false}
        animate={{ 
          width: isSidebarOpen ? (isCollapsed ? 60 : 210) : 0,
          x: isSidebarOpen ? 0 : -210
        }}
        className={`fixed md:relative z-50 h-full bg-brand-blue text-white flex flex-col shadow-xl overflow-hidden`}
      >
        <div className="p-2.5 flex items-center justify-between min-w-[210px]">
          <div className="flex items-center gap-1.5">
            <img
              src="/icon-192-1.png"
              alt="Cifras Shalom"
              className="w-6 h-6 rounded-md shrink-0 object-contain"
            />
            {!isCollapsed && (
              <motion.span 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="font-display font-bold text-[13px] tracking-tight whitespace-nowrap"
              >
                Cifras Shalom
              </motion.span>
            )}
          </div>
          <button 
            onClick={() => {
              if (window.innerWidth < 768) setIsSidebarOpen(false);
              else setIsCollapsed(!isCollapsed);
            }} 
            className="p-1 hover:bg-white/10 rounded-lg transition-colors"
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <Menu className="w-3.5 h-3.5" />}
          </button>
        </div>

        <nav className="flex-1 px-1.5 py-1 space-y-0.5 overflow-y-auto no-scrollbar min-w-[210px]">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                if (window.innerWidth < 768) setIsSidebarOpen(false);
              }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-xs font-semibold relative group
                ${activeTab === item.id 
                  ? 'bg-brand-orange text-white shadow-sm' 
                  : 'hover:bg-white/5 text-white/40 hover:text-white'}`}
            >
              <item.icon className="w-3.5 h-3.5 shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
              {isCollapsed && (
                <div className="absolute left-full ml-4 px-2 py-1 bg-brand-blue text-[10px] rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl z-[60] whitespace-nowrap">
                  {item.label}
                </div>
              )}
            </button>
          ))}
        </nav>

        <div className="p-2 mt-auto border-t border-white/5 min-w-[210px]">
          <div className="flex items-center gap-2 px-1.5 py-1 mb-1 bg-white/5 rounded-lg">
            <div className="w-5 h-5 rounded-full bg-brand-orange overflow-hidden flex items-center justify-center border border-white/10 shrink-0">
              {profile?.photo_url || profile?.photoURL ? (
                <img src={profile.photo_url || profile?.photoURL} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-3 h-3 text-white" />
              )}
            </div>
            {!isCollapsed && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="overflow-hidden"
              >
                <p className="font-bold text-[9px] truncate leading-none text-white uppercase tracking-tighter">
                  {profile?.display_name || profile?.displayName || 'Usuário'}
                </p>
                <p className="text-[7px] text-white/30 truncate font-bold uppercase tracking-widest leading-none mt-0.5">
                  {getRoleLabel(profile?.role)}
                </p>
              </motion.div>
            )}
          </div>
          {isInstallable && (
            <button
              onClick={install}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all text-[10px] font-bold uppercase tracking-widest mt-2
                bg-white/10 text-white hover:bg-white/20`}
            >
              <Download className="w-3.5 h-3.5 shrink-0" />
              {!isCollapsed && <span>Instalar App</span>}
            </button>
          )}

          <button
            onClick={() => supabase.auth.signOut()}
            className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-white/30 hover:bg-red-500/10 hover:text-red-300 transition-all text-[9px] font-bold uppercase tracking-widest"
          >
            <LogOut className="w-3 h-3 shrink-0" />
            {!isCollapsed && <span>Sair</span>}
          </button>
        </div>
      </motion.div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0 z-30 shadow-sm relative">
          <div className="flex items-center gap-4">
            {(!isSidebarOpen || (isSidebarOpen && isCollapsed)) && (
              <button 
                onClick={() => {
                  if (!isSidebarOpen) setIsSidebarOpen(true);
                  else setIsCollapsed(false);
                }} 
                className="p-2 hover:bg-slate-100 rounded-xl transition-all"
              >
                <Menu className="w-6 h-6 text-brand-blue" />
              </button>
            )}
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
                <img
                  src="/icon-192-1.png"
                  alt="Cifras Shalom"
                  className="w-6 h-6 object-contain"
                />
              </div>
              <h2 className="text-lg md:text-xl font-bold text-brand-blue capitalize truncate">
                {menuItems.find(i => i.id === activeTab)?.label}
              </h2>
            </div>
          </div>
          
          <div className="flex items-center gap-2 md:gap-4">
            <div className="relative">
              <button 
                onClick={() => {
                  setShowNotifications(!showNotifications);
                  if (!showNotifications) markAsRead();
                }}
                className="p-2 hover:bg-slate-100 rounded-xl transition-all relative"
              >
                <Bell className="w-5 h-5 text-slate-400" />
                {notifications.some(n => !n.is_read) && (
                  <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white shadow-sm animate-pulse"></span>
                )}
              </button>

              <AnimatePresence>
                {showNotifications && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute right-0 mt-2 w-80 bg-white rounded-3xl shadow-2xl border border-slate-100 z-[100] overflow-hidden"
                  >
                    <div className="p-4 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                       <h4 className="font-bold text-sm text-brand-blue">Notificações</h4>
                       <button onClick={() => setShowNotifications(false)} className="p-1 hover:bg-slate-200 rounded-full">
                         <X className="w-4 h-4 text-slate-400" />
                       </button>
                    </div>
                    <div className="max-h-[300px] overflow-y-auto no-scrollbar">
                      {notifications.length > 0 ? (
                        notifications.map(n => (
                          <div key={n.id} className={`p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors ${!n.is_read ? 'bg-blue-50/30' : ''}`}>
                             <p className="font-bold text-[13px] text-slate-800">{n.title}</p>
                             <p className="text-xs text-slate-500 mt-1">{n.message}</p>
                             <p className="text-[10px] text-slate-400 mt-2 font-medium">
                               {new Date(n.created_at).toLocaleDateString('pt-BR')} às {new Date(n.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                             </p>
                          </div>
                        ))
                      ) : (
                        <div className="p-8 text-center text-slate-400">
                           <Bell className="w-8 h-8 mx-auto mb-2 opacity-20" />
                           <p className="text-xs italic">Nenhuma notificação</p>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {activeTab === 'chords' && (
              <button 
                onClick={() => setTriggerNewChord(prev => prev + 1)}
                className="bg-brand-orange text-white px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-orange-600 shadow-md transition-all active:scale-95"
              >
                <PlusCircle className="w-4 h-4" />
                <span className="hidden sm:inline">NOVA CIFRA</span>
              </button>
            )}
            
            <div className="hidden sm:flex items-center gap-3 px-3 py-1.5 bg-slate-50 border border-slate-100 rounded-xl transition-all">
               <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-800 leading-tight">
                    {profile?.display_name || profile?.displayName || 'Usuário'}
                  </p>
                  <p className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
                    {getRoleLabel(profile?.role)}
                  </p>
               </div>
               <div className="w-8 h-8 rounded-full bg-slate-200 overflow-hidden ring-2 ring-white shadow-sm border border-slate-100">
                 {profile?.photo_url || profile?.photoURL ? (
                   <img src={profile.photo_url || profile?.photoURL} alt="Profile" className="w-full h-full object-cover" />
                 ) : (
                   <UserCircle className="w-full h-full p-1 text-slate-400" />
                 )}
               </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50 custom-scrollbar">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
