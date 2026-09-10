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
    case 'admin':
      return 'Administrador';
    case 'coordinator':
      return 'Coordenador';
    case 'editor':
      return 'Editor';
    default:
      return 'Membro';
  }
};

interface DashboardProps {
  user: any;
  profile: UserProfile | null;
  setProfile: (p: UserProfile | null) => void;
}

export default function Dashboard({
  user,
  profile,
  setProfile
}: DashboardProps) {
  const LAST_VIEW_KEY = 'cifrash:lastView';

  const readLastView = (): {
    tab: string;
    bookId: string | null;
    missionId: string | null;
    repertoireId: string | null;
  } | null => {
    try {
      const raw = localStorage.getItem(LAST_VIEW_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };

  const lastView = readLastView();

  const [activeTab, setActiveTab] = useState(
    lastView?.tab || 'chords'
  );

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [notifications, setNotifications] = useState<
    UserNotification[]
  >([]);

  const [showNotifications, setShowNotifications] =
    useState(false);

  const [selectedMissionId, setSelectedMissionId] =
    useState<string | null>(
      lastView?.missionId || null
    );

  const [selectedChordBookId, setSelectedChordBookId] =
    useState<string | null>(
      lastView?.bookId || null
    );

  const [selectedRepertoireId, setSelectedRepertoireId] =
    useState<string | null>(
      lastView?.repertoireId || null
    );

  const [triggerNewChord, setTriggerNewChord] = useState(0);

  useEffect(() => {
    try {
      localStorage.setItem(
        LAST_VIEW_KEY,
        JSON.stringify({
          tab: activeTab,
          bookId: selectedChordBookId,
          missionId: selectedMissionId,
          repertoireId: selectedRepertoireId
        })
      );
    } catch {
      // Storage indisponível.
    }
  }, [
    activeTab,
    selectedChordBookId,
    selectedMissionId,
    selectedRepertoireId
  ]);

  const isAwayFromHome =
    activeTab !== 'chords' ||
    !!selectedChordBookId ||
    !!selectedMissionId ||
    !!selectedRepertoireId;

  useBackButton(isAwayFromHome, () => {
    if (selectedChordBookId) {
      setSelectedChordBookId(null);
    } else if (selectedMissionId) {
      setSelectedMissionId(null);
    } else if (selectedRepertoireId) {
      setSelectedRepertoireId(null);
    } else {
      setActiveTab('chords');
    }
  });

  const {
    isInstallable,
    install
  } = usePWAInstall();

  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        !sidebarRef.current ||
        sidebarRef.current.contains(
          event.target as Node
        )
      ) {
        return;
      }

      if (window.innerWidth < 768) {
        if (isSidebarOpen) {
          setIsSidebarOpen(false);
        }
      } else {
        if (isSidebarOpen && !isCollapsed) {
          setIsCollapsed(true);
        }
      }
    }

    document.addEventListener(
      'mousedown',
      handleClickOutside
    );

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside
      );
    };
  }, [isSidebarOpen, isCollapsed]);

  useEffect(() => {
    const params = new URLSearchParams(
      window.location.search
    );

    const repertoireId =
      params.get('repertoireId');

    if (repertoireId) {
      setSelectedRepertoireId(repertoireId);
      setActiveTab('repertoires');
    }
  }, []);

  useEffect(() => {
    if (!profile) return;

    fetchNotifications();

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
          setNotifications(prev => [
            payload.new as UserNotification,
            ...prev
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  async function fetchNotifications() {
    try {
      const { data } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profile?.id)
        .order('created_at', {
          ascending: false
        })
        .limit(10);

      if (data) {
        setNotifications(
          data as UserNotification[]
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  const markAsRead = async () => {
    try {
      await supabase
        .from('user_notifications')
        .update({
          is_read: true
        })
        .eq('user_id', profile?.id)
        .eq('is_read', false);

      setNotifications(prev =>
        prev.map(n => ({
          ...n,
          is_read: true
        }))
      );
    } catch (err) {
      console.error(err);
    }
  };

  const menuItems = [
    {
      id: 'chords',
      label: 'Cifras',
      icon: Music
    },
    {
      id: 'chordBooks',
      label: 'Cadernos',
      icon: BookText
    },
    {
      id: 'repertoires',
      label: 'Repertórios',
      icon: ListMusic
    },
    {
      id: 'mission',
      label: 'Missão',
      icon: Users
    },
    {
      id: 'profile',
      label: 'Meu Perfil',
      icon: UserCircle
    }
  ];

  if (
    [
      'admin',
      'editor',
      'coordinator',
      'moderator'
    ].includes(profile?.role || '')
  ) {
    menuItems.splice(2, 0, {
      id: 'importBatches',
      label: 'Lotes de Importação',
      icon: History
    });
  }

  const isAdmin =
    profile?.role === 'admin' ||
    profile?.email === 'barbosma1@gmail.com' ||
    user?.email === 'barbosma1@gmail.com';

  if (isAdmin) {
    menuItems.push({
      id: 'settings',
      label: 'Configurações',
      icon: Settings
    });
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
            initialRepertoireId={
              selectedRepertoireId
            }
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

      case 'importBatches':
        return (
          <ImportBatchesList
            profile={profile}
          />
        );

      case 'profile':
        return (
          <ProfileView
            profile={profile}
            setProfile={setProfile}
          />
        );

      case 'settings':
        return (
          <AdminSettings
            profile={profile}
          />
        );

      default:
        return (
          <ChordsList
            profile={profile}
          />
        );
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* SIDEBAR */}
      <motion.div
        ref={sidebarRef}
        initial={false}
        animate={{
          width: isSidebarOpen
            ? (isCollapsed ? 60 : 210)
            : 0,
          x: isSidebarOpen ? 0 : -210
        }}
        className="fixed md:relative z-50 h-full bg-brand-blue text-white flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 min-h-[64px]">
          {!isCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <Music className="w-7 h-7 shrink-0" />

              <div className="min-w-0">
                <div className="font-bold truncate">
                  Cifra SH
                </div>

                {profile && (
                  <div className="text-xs text-white/70 truncate">
                    {getRoleLabel(profile.role)}
                  </div>
                )}
              </div>
            </div>
          )}

          <button
            type="button"
            aria-label={
              isCollapsed
                ? 'Expandir menu'
                : 'Recolher menu'
            }
            onClick={() =>
              setIsCollapsed(value => !value)
            }
            className="p-2 rounded-lg hover:bg-white/10 shrink-0"
          >
            {isCollapsed ? (
              <Menu size={20} />
            ) : (
              <X size={20} />
            )}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {menuItems.map(item => {
            const Icon = item.icon;
            const active =
              activeTab === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);

                  if (window.innerWidth < 768) {
                    setIsSidebarOpen(false);
                  }
                }}
                className={`w-full flex items-center gap-3 rounded-lg px-3 py-3 mb-1 text-left transition-colors ${
                  active
                    ? 'bg-white/15'
                    : 'hover:bg-white/10'
                }`}
                title={
                  isCollapsed
                    ? item.label
                    : undefined
                }
              >
                <Icon
                  size={20}
                  className="shrink-0"
                />

                {!isCollapsed && (
                  <span className="truncate">
                    {item.label}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-2 space-y-1">
          {!isCollapsed && isInstallable && (
            <button
              type="button"
              onClick={install}
              className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-white/10"
            >
              <Download size={20} />

              <span>
                Instalar aplicativo
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={async () => {
              try {
                await supabase.auth.signOut();
              } catch (err) {
                console.error(
                  'Erro ao sair:',
                  err
                );
              }
            }}
            className="w-full flex items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-white/10"
            title={
              isCollapsed
                ? 'Sair'
                : undefined
            }
          >
            <LogOut
              size={20}
              className="shrink-0"
            />

            {!isCollapsed && (
              <span>Sair</span>
            )}
          </button>
        </div>
      </motion.div>

      {/* MOBILE OVERLAY */}
      <AnimatePresence>
        {isSidebarOpen && !isCollapsed && (
          <motion.button
            type="button"
            aria-label="Fechar menu"
            className="fixed inset-0 z-40 bg-black/30 md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() =>
              setIsSidebarOpen(false)
            }
          />
        )}
      </AnimatePresence>

      {/* MAIN AREA */}
      <div className="flex-1 min-w-0 flex flex-col h-full">
        <header className="h-16 shrink-0 bg-white border-b border-slate-200 flex items-center justify-between px-3 sm:px-5">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              aria-label="Abrir menu"
              onClick={() =>
                setIsSidebarOpen(
                  value => !value
                )
              }
              className="md:hidden p-2 rounded-lg hover:bg-slate-100"
            >
              <Menu size={22} />
            </button>

            <div className="font-semibold text-slate-800 truncate">
              {menuItems.find(
                item => item.id === activeTab
              )?.label || 'Cifras'}
            </div>
          </div>

          <div className="relative flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="Notificações"
              onClick={() => {
                setShowNotifications(
                  value => !value
                );

                if (!showNotifications) {
                  markAsRead();
                }
              }}
              className="relative p-2 rounded-lg hover:bg-slate-100"
            >
              <Bell size={21} />

              {notifications.some(
                n => !n.is_read
              ) && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
              )}
            </button>

            <div className="hidden sm:flex items-center gap-2 max-w-[220px]">
              <UserCircle className="text-slate-500" size={22} />

              <div className="min-w-0">
                <div className="text-sm font-medium text-slate-700 truncate">
                  {profile?.display_name ||
                    user?.email ||
                    'Usuário'}
                </div>

                <div className="text-xs text-slate-500 truncate">
                  {getRoleLabel(
                    profile?.role
                  )}
                </div>
              </div>
            </div>

            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{
                    opacity: 0,
                    y: -6
                  }}
                  animate={{
                    opacity: 1,
                    y: 0
                  }}
                  exit={{
                    opacity: 0,
                    y: -6
                  }}
                  className="absolute right-0 top-12 z-50 w-[min(360px,calc(100vw-24px))] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
                >
                  <div className="px-4 py-3 border-b border-slate-100 font-semibold">
                    Notificações
                  </div>

                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <div className="p-4 text-sm text-slate-500">
                        Nenhuma notificação.
                      </div>
                    ) : (
                      notifications.map(
                        notification => (
                          <div
                            key={
                              notification.id
                            }
                            className={`px-4 py-3 border-b border-slate-100 ${
                              notification.is_read
                                ? ''
                                : 'bg-blue-50'
                            }`}
                          >
                            <div className="font-medium text-sm text-slate-800">
                              {
                                notification.title
                              }
                            </div>

                            <div className="text-sm text-slate-600 mt-1">
                              {
                                notification.message
                              }
                            </div>
                          </div>
                        )
                      )
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </header>

        <main className="flex-1 min-h-0 overflow-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
