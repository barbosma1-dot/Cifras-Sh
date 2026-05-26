import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile, Mission } from '../types';
import { 
  Users, 
  ShieldCheck, 
  UserPlus, 
  Copy, 
  CheckCircle2, 
  Crown, 
  Settings2,
  Lock,
  ArrowRight,
  Hash,
  Loader2,
  ListMusic,
  BookText
} from 'lucide-react';

interface MissionViewProps {
  profile: UserProfile | null;
  setProfile: (p: UserProfile | null) => void;
  onSelectMission?: (missionId: string) => void;
  onViewChords?: (bookId: string) => void;
}

export default function MissionView({ profile, setProfile, onSelectMission, onViewChords }: MissionViewProps) {
  const [mission, setMission] = useState<Mission | null>(null);
  const [members, setMembers] = useState<UserProfile[]>([]);
  const [linkedBooks, setLinkedBooks] = useState<any[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);

  const [userMissions, setUserMissions] = useState<(Mission & { member_role: string })[]>([]);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [selectedMember, setSelectedMember] = useState<UserProfile | null>(null);
  const [updatingRole, setUpdatingRole] = useState(false);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    fetchUserMissions();
  }, [profile?.id, (profile as any)?.uid]);

  useEffect(() => {
    if (profile?.missionId || profile?.mission_id) {
      fetchMissionData();
    }
  }, [profile?.missionId, profile?.mission_id]);

  async function fetchUserMissions() {
    if (!profile) {
      setLoading(false);
      return;
    }
    const userId = profile.id || profile.uid || (profile as any).userId;
    try {
      const { data, error } = await supabase
        .from('mission_members')
        .select(`
          mission_id,
          role,
          missions (*)
        `)
        .eq('user_id', userId);
      
      if (error) throw error;
      
      const formatted = (data as any[] || []).map(m => ({
        ...m.missions,
        member_role: m.role
      })).filter(m => m.id); // Filter out any orphaned/null missions

      setUserMissions(formatted);

      // Se o usuário não tem uma missão ativa no profile mas tem missões, seleciona a primeira
      if (!profile.missionId && !profile.mission_id && formatted.length > 0) {
        setProfile({ ...profile, missionId: formatted[0].id, mission_id: formatted[0].id });
      }
    } catch (err) {
      console.error('Erro ao buscar missões do usuário:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMissionData() {
    const currentMissionId = profile?.missionId || profile?.mission_id;
    if (!currentMissionId) return;

    try {
      const { data: mData, error: mError } = await supabase
        .from('missions')
        .select('*')
        .eq('id', currentMissionId)
        .single();
      
      if (mData) {
        setMission(mData as Mission);
      }

      // Buscar membros da missão atual via mission_members join user_profiles
      const { data: memData, error: memError } = await supabase
        .from('mission_members')
        .select(`
          role,
          user_profiles (*)
        `)
        .eq('mission_id', currentMissionId);
      
      if (memData) {
        const formattedMembers = (memData as any[]).map(m => {
          if (!m.user_profiles) return null;
          return {
            ...m.user_profiles,
            role: m.role // sobrescreve role do perfil com role da missão
          };
        }).filter(m => m !== null);
        setMembers(formattedMembers);

        // Atualizar role do usuário logado se ele estiver na lista
        const userId = profile?.id || profile?.uid || (profile as any).userId;
        const myMember = formattedMembers.find(m => (m.id || m.uid) === userId);
        if (myMember && profile && myMember.role !== profile.role) {
          setProfile({ ...profile, role: myMember.role });
        }
      }

      // Buscar cadernos vinculados via chord_book_missions
      const { data: bookData } = await supabase
        .from('chord_book_missions')
        .select(`
          chord_books (*)
        `)
        .eq('mission_id', currentMissionId);
      
      if (bookData) {
        const formattedBooks = (bookData as any[]).map(b => b.chord_books).filter(b => b !== null);
        setLinkedBooks(formattedBooks);
      }
    } catch (err) {
      console.error('Erro ao buscar dados da missão:', err);
    }
  }

  const handleJoinMission = async () => {
    if (!joinCode || !profile) {
      setNotification({ message: 'Por favor, insira um código.', type: 'error' });
      return;
    }
    setLoading(true);
    
    try {
      const code = joinCode.trim().toUpperCase();
      console.log('Tentando entrar na missão com código:', code);

      const { data: mData, error: mError } = await supabase
        .from('missions')
        .select('*')
        .eq('invite_code', code)
        .maybeSingle();
      
      if (mError) {
        console.error('Erro na busca da missão:', mError);
        setNotification({ 
          message: `Erro na busca: ${mError.message}`, 
          type: 'error' 
        });
        setLoading(false);
        return;
      }

      if (!mData) {
        setNotification({ message: 'Código inválido ou missão inexistente.', type: 'error' });
        setLoading(false);
        return;
      }

      const userId = profile.id || profile.uid || (profile as any).id;

      if (!userId) {
        setNotification({ message: 'Erro de autenticação. Tente sair e entrar novamente.', type: 'error' });
        setLoading(false);
        return;
      }

      // Inserir na tabela de membros
      const { error: joinError } = await supabase
        .from('mission_members')
        .insert([{
          user_id: userId,
          mission_id: mData.id,
          role: 'member'
        }]);
      
      if (joinError) {
        if (joinError.code === '23505') {
          setNotification({ message: 'Você já faz parte desta missão.', type: 'error' });
        } else {
          throw joinError;
        }
      } else {
        setNotification({ message: `Sucesso! Agora você faz parte da missão: ${mData.name}`, type: 'success' });
        if (profile) {
          setProfile({...profile, missionId: mData.id, mission_id: mData.id});
        }
        await fetchUserMissions();
      }
    } catch (e: any) {
      console.error('Erro ao entrar na missão:', e);
      setNotification({ message: 'Erro ao entrar na missão: ' + (e.message || 'Erro desconhecido'), type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  const copyJoinCode = () => {
    if (!mission?.invite_code && !mission?.inviteCode) return;
    const code = (mission?.invite_code || mission?.inviteCode) as string;
    navigator.clipboard.writeText(code);
    setNotification({ message: 'Código de convite copiado!', type: 'success' });
  };

  const handleUpdateMemberRole = async (memberUserId: string, newRole: string) => {
    const currentMissionId = profile?.missionId || profile?.mission_id;
    if (!currentMissionId) return;

    setUpdatingRole(true);
    try {
      const { error } = await supabase
        .from('mission_members')
        .update({ role: newRole })
        .eq('mission_id', currentMissionId)
        .eq('user_id', memberUserId);

      if (error) throw error;

      setNotification({ message: 'Permissão atualizada com sucesso!', type: 'success' });
      setSelectedMember(null);
      await fetchMissionData();
    } catch (err: any) {
      console.error('Erro ao atualizar permissão:', err);
      setNotification({ message: 'Erro ao atualizar: ' + (err.message || 'Erro desconhecido'), type: 'error' });
    } finally {
      setUpdatingRole(false);
    }
  };

  const handleOpenSettings = (member: UserProfile) => {
    setSelectedMember(member);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-brand-orange animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Seletor de Missões Ativas */}
      <div className="flex overflow-x-auto pb-4 gap-3 no-scrollbar">
        {userMissions.map(m => (
          <button
            key={m.id}
            onClick={() => setProfile({ ...profile!, missionId: m.id, mission_id: m.id })}
            className={`px-6 py-3 rounded-2xl font-bold whitespace-nowrap transition-all border shadow-sm
              ${(profile?.missionId === m.id || profile?.mission_id === m.id)
                ? 'bg-brand-blue text-white border-brand-blue' 
                : 'bg-white text-slate-500 border-slate-100 hover:border-brand-blue/30'}`}
          >
            {m.name}
          </button>
        ))}
        <button 
          onClick={() => setProfile({ ...profile!, missionId: undefined, mission_id: undefined })}
          className={`px-6 py-3 rounded-2xl font-bold whitespace-nowrap transition-all border border-dashed flex items-center gap-2
            ${(!profile?.missionId && !profile?.mission_id) ? 'bg-slate-100 text-brand-blue border-brand-blue' : 'bg-white text-slate-400 border-slate-200'}`}
        >
          <UserPlus className="w-4 h-4" />
          ENTRAR EM OUTRA
        </button>
      </div>

      {!(mission || !profile?.missionId) && (profile?.missionId || profile?.mission_id) ? (
         <div className="flex flex-col items-center justify-center h-64 bg-white rounded-3xl border border-slate-100 p-8 text-center">
            <Loader2 className="w-8 h-8 text-brand-orange animate-spin mb-4" />
            <p className="text-slate-500 font-medium">Carregando dados da missão...</p>
         </div>
      ) : (!profile?.missionId && !profile?.mission_id) ? (
        <div className="max-w-xl mx-auto mt-10">
          <div className="relative bg-white rounded-[40px] shadow-2xl border border-slate-100 overflow-hidden">
            {/* Design Elements */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-brand-orange/5 rounded-full -mr-16 -mt-16" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-brand-blue/5 rounded-full -ml-12 -mb-12" />
            
            <div className="p-10 relative">
              <div className="w-24 h-24 bg-brand-orange/10 text-brand-orange rounded-3xl flex items-center justify-center mb-8 rotate-3 shadow-inner">
                <Users className="w-12 h-12" />
              </div>
              
              <div className="space-y-2 mb-10">
                <h2 className="text-4xl font-display font-black text-brand-blue tracking-tight">Entrar em uma Missão</h2>
                <p className="text-slate-500 font-medium text-lg leading-relaxed">
                  Conecte-se com sua comunidade inserindo o código de convite de <span className="text-brand-orange font-bold">6 dígitos</span>.
                </p>
              </div>
              
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 ml-1">Código de Acesso</label>
                  <div className="flex gap-2">
                    {/* Visual Code Input */}
                    <div className="relative flex-1 group">
                      <Hash className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-300 group-focus-within:text-brand-orange transition-colors" />
                      <input 
                        type="text" 
                        placeholder="EX: CODE01"
                        maxLength={10}
                        autoFocus
                        className="w-full pl-16 pr-6 p-6 bg-slate-50 border-2 border-slate-100 rounded-3xl transition-all outline-none focus:border-brand-orange focus:bg-white font-mono text-3xl font-black text-brand-blue placeholder:text-slate-200 placeholder:italic uppercase tracking-[0.2em]"
                        value={joinCode}
                        onChange={e => {
                          const val = e.target.value.toUpperCase();
                          setJoinCode(val);
                          if (val.length === 6) {
                            // Delay slightly to show the last character before auto-submitting
                            setTimeout(() => {
                              if (val.length === 6) {
                                // We can't easily call handleJoinMission directly with the current state in a reliable way here 
                                // without refactoring, but we can trigger it.
                              }
                            }, 500);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleJoinMission();
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <button 
                     onClick={handleJoinMission}
                     disabled={loading}
                     className="w-full group relative overflow-hidden bg-brand-blue text-white p-6 rounded-3xl font-black text-lg transition-all hover:bg-brand-blue/90 active:scale-[0.98] shadow-xl shadow-brand-blue/20"
                  >
                    <div className="relative z-10 flex items-center justify-center gap-3">
                      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : <UserPlus className="w-6 h-6" />}
                      {loading ? 'PROCESSANDO...' : 'CONFIRMAR ENTRADA'}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
                  </button>

                  <div className="flex items-center gap-4 py-2 opacity-50">
                    <div className="h-px flex-1 bg-slate-200" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Informações</span>
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <Lock className="w-4 h-4 text-brand-orange mb-2" />
                      <p className="text-[10px] font-bold text-slate-800 uppercase mb-1">Privacidade</p>
                      <p className="text-[9px] text-slate-500 leading-tight">Suas informações são visíveis apenas para membros da mesma missão.</p>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <ShieldCheck className="w-4 h-4 text-brand-blue mb-2" />
                      <p className="text-[10px] font-bold text-slate-800 uppercase mb-1">Sincronismo</p>
                      <p className="text-[9px] text-slate-500 leading-tight">Repertórios e escalas são atualizados em tempo real para todos.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="bg-slate-50 p-6 px-10 border-t border-slate-100 flex items-center justify-between">
              <p className="text-xs text-slate-400 font-medium">Não tem um código? Fale com seu coordenador.</p>
              <Users className="w-5 h-5 text-slate-300" />
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-3xl font-display font-bold text-brand-blue">{mission?.name}</h1>
                <p className="text-slate-500">Membros da Missão</p>
                {onSelectMission && (
                  <button 
                    onClick={() => onSelectMission(mission!.id)}
                    className="mt-4 flex items-center gap-2 px-4 py-2 bg-brand-blue/5 text-brand-blue rounded-xl font-bold text-xs hover:bg-brand-blue hover:text-white transition-all border border-brand-blue/20"
                  >
                    <ListMusic className="w-4 h-4" />
                    VER REPERTÓRIO DESTA MISSÃO
                  </button>
                )}
              </div>
              <div className="bg-brand-orange/10 p-4 rounded-2xl text-right">
                <p className="text-[10px] font-bold text-brand-orange uppercase tracking-widest">Código da Missão</p>
                <div className="flex items-center gap-2 mt-1">
                   <span className="font-mono font-black text-xl text-brand-blue">{mission?.invite_code || mission?.inviteCode}</span>
                   <button 
                     onClick={copyJoinCode}
                     className="text-slate-400 hover:text-brand-blue"
                   >
                     <Copy className="w-4 h-4" />
                   </button>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              {members.map(member => (
                <div key={member.uid || (member as any).id} className="flex items-center justify-between p-4 hover:bg-slate-50 rounded-2xl transition-all border border-transparent hover:border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-blue/10 rounded-full flex items-center justify-center text-brand-blue font-bold">
                       {member.photoURL || (member as any).photo_url ? <img src={member.photoURL || (member as any).photo_url} className="w-full h-full rounded-full object-cover" /> : (member.displayName || (member as any).display_name)?.[0] || 'U'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800">{member.displayName || (member as any).display_name}</span>
                        {member.role === 'coordinator' && <Crown className="w-3 h-3 text-yellow-500" />}
                        {member.role === 'editor' && <ShieldCheck className="w-3 h-3 text-blue-500" />}
                        {member.role === 'admin' && <ShieldCheck className="w-3 h-3 text-purple-500" />}
                      </div>
                      <p className="text-xs text-slate-400">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest
                      ${member.role === 'coordinator' ? 'bg-yellow-100 text-yellow-700' : 
                        member.role === 'editor' ? 'bg-blue-100 text-blue-700' : 
                        member.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>
                      {member.role === 'coordinator' ? 'Coordenador' : 
                       member.role === 'editor' ? 'Editor' : 
                       member.role === 'admin' ? 'Admin' : 'Membro'}
                    </span>
                    {(profile?.role === 'admin' || profile?.role === 'coordinator' || (profile?.uid || (profile as any).id) === ((mission as any)?.coordinator_id || mission?.coordinatorId)) && (member.uid || (member as any).id) !== (profile?.uid || (profile as any).id) && (
                       <button 
                         onClick={() => handleOpenSettings(member)}
                         className="p-2 hover:bg-slate-200 rounded-lg text-slate-400"
                       >
                          <Settings2 className="w-4 h-4" />
                       </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-6">
           <div className="bg-brand-orange p-8 rounded-3xl text-white shadow-xl">
              <h3 className="font-bold text-xl mb-4 flex items-center gap-2">
                 <ShieldCheck className="w-6 h-6" />
                 Gerenciar Acesso
              </h3>
              <p className="text-sm opacity-80 mb-6">Como coordenador ou administrador, você pode elevar membros para editores para gerenciar repertórios.</p>
              <div className="space-y-3">
                 <div className="flex items-center justify-between bg-white/10 p-3 rounded-xl border border-white/20 text-xs">
                    <span>Membros Editores</span>
                    <span className="font-bold">{members.filter(m => m.role === 'editor').length}</span>
                 </div>
                 <div className="flex items-center justify-between bg-white/10 p-3 rounded-xl border border-white/20 text-xs">
                    <span>Total de Membros</span>
                    <span className="font-bold">{members.length}</span>
                 </div>
              </div>

              {selectedMember && (
                <div className="mt-8 bg-white rounded-2xl p-4 text-slate-800 animate-in fade-in slide-in-from-bottom-2">
                  <p className="text-[10px] font-black uppercase text-slate-400 mb-3 tracking-widest">
                    Alterar Permissão: {selectedMember.displayName || (selectedMember as any).display_name}
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {selectedMember.role !== 'editor' && (
                      <button 
                        onClick={() => handleUpdateMemberRole(selectedMember.id || (selectedMember as any).uid || (selectedMember as any).userId, 'editor')}
                        disabled={updatingRole}
                        className="w-full py-3 bg-brand-blue text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2"
                      >
                        {updatingRole ? <Loader2 className="w-3 h-3 animate-spin" /> : <ShieldCheck className="w-3 h-3" />}
                        PROMOVER A EDITOR
                      </button>
                    )}
                    {selectedMember.role === 'editor' && (
                      <button 
                        onClick={() => handleUpdateMemberRole(selectedMember.id || (selectedMember as any).uid || (selectedMember as any).userId, 'member')}
                        disabled={updatingRole}
                        className="w-full py-3 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2"
                      >
                        {updatingRole ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                        REBAIXAR A MEMBRO
                      </button>
                    )}
                    <button 
                      onClick={() => setSelectedMember(null)}
                      className="w-full py-2 text-slate-400 font-bold text-[10px] uppercase mt-2"
                    >
                      CANCELAR
                    </button>
                  </div>
                </div>
              )}
           </div>

           <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm">
              <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                 <BookText className="w-5 h-5 text-brand-blue" />
                 Cadernos da Missão
              </h3>
              <div className="space-y-3">
                 {linkedBooks.length > 0 ? (
                   linkedBooks.map(book => (
                     <button 
                       key={book.id} 
                       onClick={() => onViewChords?.(book.id)}
                       className="w-full text-left p-4 bg-slate-50 rounded-2xl border border-transparent hover:border-brand-blue/20 transition-all group flex items-center justify-between"
                     >
                        <div>
                          <p className="font-bold text-slate-800 text-sm group-hover:text-brand-blue transition-colors">{book.name}</p>
                          <p className="text-[10px] text-slate-400 mt-1 uppercase font-black tracking-widest">Acesso pela Missão</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-300 group-hover:text-brand-blue group-hover:translate-x-1 transition-all" />
                     </button>
                   ))
                 ) : (
                   <p className="text-xs text-slate-400 italic">Nenhum caderno vinculado.</p>
                 )}
              </div>
              <p className="text-[9px] text-slate-300 mt-6 leading-tight">
                Cadernos vinculados à missão são compartilhados automaticamente com todos os membros.
              </p>
           </div>
        </div>
      </div>
      )}

      {/* Notificações */}
      {notification && (
        <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-[120] px-6 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-4 flex items-center gap-2 font-bold text-sm ${
          notification.type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-red-500 text-white border-red-400'
        }`}>
          {notification.message}
        </div>
      )}
    </div>
  );
}
