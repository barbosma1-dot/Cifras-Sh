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
  Bell,
  Download,
  History,
  ChevronRight
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

  const [showNotifications, setShowNotifications] = useState(false);

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
        sidebarRef.current.contains(event.target as Node)
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
        className="fixed md:relative z-50 h-full bg-brand-blue text-white flex flex-col
