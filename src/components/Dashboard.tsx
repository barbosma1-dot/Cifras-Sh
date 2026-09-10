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

const LOGO = '/brand/logo-mark-blue.png';
const LAST_VIEW_KEY = 'cifrash:lastView';

interface DashboardProps {
  user: any;
  profile: UserProfile | null;
  setProfile: (p: UserProfile | null) => void;
}

const getRoleLabel = (role?: string) => {
  switch (role) {
    case 'admin':
      return 'Administrador';
    case 'coordinator':
      return 'Coordenador';
    case 'editor':
      return 'Editor';
    case 'moderator':
      return 'Moderador';
    default:
      return 'Membro';
  }
};

export default function Dashboard({
  user,
  profile,
  setProfile
}: DashboardProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState('chords');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const [notifications, setNotifications] = useState<
    UserNotification[]
  >([]);

  const [showNotifications, setShowNotifications] =
    useState(false);

  const [selectedMissionId, setSelectedMissionId] =
    useState<string | null>(null);

  const [selectedChordBookId, setSelectedChordBookId] =
    useState<string | null>(null);

  const [selectedRepertoireId, setSelectedRepertoireId] =
    useState<string | null>(null);

  const [triggerNewChord, setTriggerNewChord] = useState(0);

  const {
    isInstallable,
    install
  } = usePWAInstall();

  /*
   * Recupera a última tela aberta.
   */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LAST_VIEW_KEY);

      if (!raw) return;

      const saved = JSON.parse(raw);

      if (saved?.tab) {
        setActiveTab(saved.tab);
      }

      if (saved?.bookId) {
        setSelectedChordBookId(saved.bookId);
      }

      if (saved?.missionId) {
        setSelectedMissionId(saved.missionId);
      }

      if (saved?.repertoireId) {
        setSelectedRepertoireId(saved.repertoireId);
      }
    } catch (error) {
      console.warn(
        'Não foi possível recuperar a última tela:',
        error
      );
    }
  }, []);

  /*
   * Salva a navegação atual.
   */
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
      // Ignora indisponibilidade do localStorage.
    }
  }, [
    activeTab,
    selectedChordBookId,
    selectedMissionId,
    selectedRepertoireId
  ]);

  /*
   * Botão voltar do celular.
   */
  const isAwayFromHome =
    activeTab !== 'chords' ||
    selectedChordBookId !== null ||
    selectedMissionId !== null ||
    selectedRepertoireId !== null;

  useBackButton(isAwayFromHome, () => {
    if (selectedChordBookId) {
      setSelectedChordBookId(null);
      return;
    }

    if (selectedMissionId) {
      setSelectedMissionId(null);
      return;
    }

    if (selectedRepertoireId) {
      setSelectedRepertoireId(null);
      return;
    }

    setActiveTab('chords');
  });

  /*
   * Fecha o menu ao clicar fora no celular.
   */
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isSidebarOpen) return;

      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(
          event.target as Node
        )
      ) {
        if (window.innerWidth < 768) {
          setIsSidebarOpen(false);
        }
      }
    };

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
  }, [isSidebarOpen]);

  /*
   * Fecha o menu automaticamente quando a tela muda
   * para desktop.
   */
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsSidebarOpen(true);
      } else {
        setIsSidebarOpen(false);
      }
    };

    handleResize();

    window.addEventListener(
      'resize',
      handleResize
    );

    return () => {
      window.removeEventListener(
        'resize',
        handleResize
      );
    };
  }, []);

  /*
   * Notificações.
   */
  useEffect(() => {
    if (!profile?.id) return;

    fetchNotifications();

    const channel = supabase
      .channel(`user-notifications-${profile.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_notifications',
          filter: `user_id=eq.${profile.id}`
        },
        payload => {
          setNotifications(previous => [
            payload.new as UserNotification,
            ...previous
          ]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const fetchNotifications = async () => {
    if (!profile?.id) return;

    try {
      const { data, error } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', profile.id)
        .order('created_at', {
          ascending: false
        })
        .limit(10);

      if (error) {
        console.error(
          'Erro ao buscar notificações:',
          error
        );
        return;
      }

      if (data) {
        setNotifications(
          data as UserNotification[]
        );
      }
    } catch (error) {
      console.error(
        'Erro ao buscar notificações:',
        error
      );
    }
  };

  const markAsRead = async () => {
    if (!profile?.id) return;

    try {
      await supabase
        .from('user_notifications')
        .update({
          is_read: true
        })
        .eq('user_id', profile.id)
        .eq('is_read', false);

      setNotifications(previous =>
        previous.map(notification => ({
          ...notification,
          is_read: true
        }))
      );
    } catch (error) {
      console.error(
        'Erro ao marcar notificações:',
        error
      );
    }
  };

  /*
   * Menus.
   */
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

  const canManageImports = [
    'admin',
    'editor',
    'coordinator',
    'moderator'
  ].includes(profile?.role || '');

  if (canManageImports) {
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

  /*
   * Navegação.
   */
  const handleMenuClick = (id: string) => {
    setActiveTab(id);

    /*
     * Ao trocar de menu, limpa seleções internas.
     */
    if (id !== 'chords') {
      setSelectedChordBookId(null);
    }

    if (id !== 'mission') {
      setSelectedMissionId(null);
    }

    if (id !== 'repertoires') {
      setSelectedRepertoireId(null);
    }

    /*
     * No celular, o menu fica sobre a página.
     * Ao clicar em uma opção, ele fecha e a página
     * volta a ocupar 100% da largura.
     */
    if (window.innerWidth < 768) {
      setIsSidebarOpen(false);
    }
  };

  /*
   * Conteúdo principal.
   */
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
            onViewChords={bookId => {
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
            onSelectMission={missionId => {
              setSelectedMissionId(missionId);
              setActiveTab('repertoires');
            }}
            onViewChords={bookId => {
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

  const currentMenu =
    menuItems.find(
      item => item.id === activeTab
    );

  const CurrentIcon =
    currentMenu?.icon || Music;

  const unreadCount = notifications.filter(
    notification => !notification.is_read
  ).length;

  return (
    <div className="relative flex h-screen w-full overflow-hidden bg-slate-50">
      {/*
       * =====================================================
       * FUNDO ESCURO DO MENU NO CELULAR
       *
       * Importante:
       * o menu é FIXED no celular, portanto NÃO reduz
       * nem corta a largura da página.
       * =====================================================
       */}
      <AnimatePresence>
        {isSidebarOpen && (
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

      {/*
       * =====================================================
       * MENU LATERAL
       *
       * Desktop:
       * fica ao lado da página.
       *
       * Celular:
       * fica SOBRE a página.
       * =====================================================
       */}
      <motion.aside
        ref={sidebarRef}
        initial={false}
        animate={{
          width: isSidebarOpen
            ? isCollapsed
              ? 72
              : 260
            : 0,
          x: isSidebarOpen ? 0 : -280
        }}
        transition={{
          duration: 0.2,
          ease: 'easeOut'
        }}
        className="
          fixed
          md:relative
          left-0
          top-0
          bottom-0
          z-50
          h-screen
          shrink-0
          overflow-hidden
          bg-brand-blue
          text-white
          shadow-2xl
          md:shadow-none
        "
      >
        <div className="flex h-full w-full flex-col">
          {/*
           * =================================================
           * CABEÇALHO DO MENU
           * LOGO NO TOPO
           * =================================================
           */}
          <div
            className={`
              flex
              h-[88px]
              shrink-0
              items-center
              border-b
              border-white/10
              px-4
              ${isCollapsed
                ? 'justify-center'
                : 'justify-between'}
            `}
          >
            {!isCollapsed && (
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-sm">
                  <img
                    src={LOGO}
                    alt="Cifra SH"
                    className="h-full w-full object-contain"
                  />
                </div>

                <div className="min-w-0">
                  <div className="truncate text-lg font-bold">
                    Cifra SH
                  </div>

                  <div className="truncate text-sm text-white/70">
                    {getRoleLabel(
                      profile?.role
                    )}
                  </div>
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
                setIsCollapsed(
                  value => !value
                )
              }
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white transition hover:bg-white/10"
            >
              {isCollapsed ? (
                <Menu size={24} />
              ) : (
                <X size={24} />
              )}
            </button>
          </div>

          {/*
           * =================================================
           * ITENS DO MENU
           * =================================================
           */}
          <nav className="flex-1 overflow-y-auto px-3 py-5">
            <div className="space-y-1">
              {menuItems.map(item => {
                const Icon = item.icon;
                const active =
                  activeTab === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      handleMenuClick(
                        item.id
                      )
                    }
                    title={
                      isCollapsed
                        ? item.label
                        : undefined
                    }
                    className={`
                      group
                      flex
                      w-full
                      items-center
                      rounded-xl
                      transition-all
                      duration-150
                      ${isCollapsed
                        ? 'justify-center px-2'
                        : 'gap-4 px-4'}
                      py-3.5
                      ${
                        active
                          ? 'bg-white/15 shadow-sm'
                          : 'hover:bg-white/10'
                      }
                    `}
                  >
                    <Icon
                      size={25}
                      strokeWidth={1.8}
                      className="shrink-0"
                    />

                    {!isCollapsed && (
                      <span className="truncate text-[17px] font-medium">
                        {item.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          {/*
           * =================================================
           * RODAPÉ DO MENU
           * =================================================
           */}
          <div className="shrink-0 border-t border-white/10 p-3">
            {isInstallable && (
              <button
                type="button"
                onClick={install}
                title={
                  isCollapsed
                    ? 'Instalar aplicativo'
                    : undefined
                }
                className={`
                  mb-1
                  flex
                  w-full
                  items-center
                  rounded-xl
                  py-3.5
                  transition
                  hover:bg-white/10
                  ${isCollapsed
                    ? 'justify-center px-2'
                    : 'gap-4 px-4'}
                `}
              >
                <Download
                  size={24}
                  className="shrink-0"
                />

                {!isCollapsed && (
                  <span className="text-[17px]">
                    Instalar aplicativo
                  </span>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                try {
                  await supabase.auth.signOut();
                } catch (error) {
                  console.error(
                    'Erro ao sair:',
                    error
                  );
                }
              }}
              title={
                isCollapsed
                  ? 'Sair'
                  : undefined
              }
              className={`
                flex
                w-full
                items-center
                rounded-xl
                py-3.5
                transition
                hover:bg-white/10
                ${isCollapsed
                  ? 'justify-center px-2'
                  : 'gap-4 px-4'}
              `}
            >
              <LogOut
                size={24}
                className="shrink-0"
              />

              {!isCollapsed && (
                <span className="text-[17px]">
                  Sair
                </span>
              )}
            </button>
          </div>
        </div>
      </motion.aside>

      {/*
       * =====================================================
       * ÁREA PRINCIPAL
       *
       * Sempre ocupa o espaço restante.
       * No celular o menu não participa do layout,
       * portanto não corta a página.
       * =====================================================
       */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/*
         * =================================================
         * BARRA SUPERIOR
         *
         * Logo branca + título do menu.
         * =================================================
         */}
        <header className="relative z-30 flex h-[72px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 shadow-sm sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            {/*
             * Botão do menu no celular
             */}
            <button
              type="button"
              aria-label="Abrir menu"
              onClick={() =>
                setIsSidebarOpen(
                  value => !value
                )
              }
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100 md:hidden"
            >
              <Menu size={28} />
            </button>

            {/*
             * Logo com fundo branco
             */}
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-white p-1 shadow-sm">
              <img
                src={LOGO}
                alt="Cifra SH"
                className="h-full w-full object-contain"
              />
            </div>

            {/*
             * Título da tela atual
             */}
            <div className="flex min-w-0 items-center">
              <CurrentIcon
                size={21}
                className="mr-2 hidden shrink-0 text-brand-blue sm:block"
              />

              <h1 className="truncate text-lg font-semibold text-slate-800 sm:text-xl">
                {currentMenu?.label ||
                  'Cifras'}
              </h1>
            </div>
          </div>

          {/*
           * =================================================
           * NOTIFICAÇÕES + USUÁRIO
           * =================================================
           */}
          <div className="relative flex shrink-0 items-center gap-1 sm:gap-3">
            <button
              type="button"
              aria-label="Notificações"
              onClick={() => {
                const willOpen =
                  !showNotifications;

                setShowNotifications(
                  willOpen
                );

                if (willOpen) {
                  markAsRead();
                }
              }}
              className="relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-700 transition hover:bg-slate-100"
            >
              <Bell size={25} />

              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                  {unreadCount > 9
                    ? '9+'
                    : unreadCount}
                </span>
              )}
            </button>

            <div className="hidden h-10 w-px bg-slate-200 sm:block" />

            <div className="hidden max-w-[220px] items-center gap-2 md:flex">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
                <UserCircle
                  size={24}
                  className="text-slate-500"
                />
              </div>

              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-700">
                  {profile?.display_name ||
                    user?.email ||
                    'Usuário'}
                </div>

                <div className="truncate text-xs text-slate-500">
                  {getRoleLabel(
                    profile?.role
                  )}
                </div>
              </div>
            </div>

            {/*
             * =================================================
             * PAINEL DE NOTIFICAÇÕES
             * =================================================
             */}
            <AnimatePresence>
              {showNotifications && (
                <motion.div
                  initial={{
                    opacity: 0,
                    y: -8
                  }}
                  animate={{
                    opacity: 1,
                    y: 0
                  }}
                  exit={{
                    opacity: 0,
                    y: -8
                  }}
                  className="absolute right-0 top-14 z-[100] w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
                    <span className="font-semibold text-slate-800">
                      Notificações
                    </span>

                    {unreadCount > 0 && (
                      <span className="rounded-full bg-red-50 px-2 py-1 text-xs font-semibold text-red-600">
                        {unreadCount}{' '}
                        nova
                        {unreadCount !==
                        1
                          ? 's'
                          : ''}
                      </span>
                    )}
                  </div>

                  <div className="max-h-[360px] overflow-y-auto">
                    {notifications.length ===
                    0 ? (
                      <div className="px-5 py-8 text-center text-sm text-slate-500">
                        Nenhuma notificação.
                      </div>
                    ) : (
                      notifications.map(
                        notification => (
                          <div
                            key={
                              notification.id
                            }
                            className={`
                              border-b
                              border-slate-100
                              px-4
                              py-3
                              ${
                                notification.is_read
                                  ? 'bg-white'
                                  : 'bg-blue-50'
                              }
                            `}
                          >
                            <div className="text-sm font-semibold text-slate-800">
                              {
                                notification.title
                              }
                            </div>

                            <div className="mt-1 text-sm text-slate-600">
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

        {/*
         * =====================================================
         * CONTEÚDO
         *
         * A página inteira fica disponível e o menu lateral
         * não reduz sua largura no celular.
         * =====================================================
         */}
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
