import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile, Mission } from '../types';
import { Settings, Users, Shield, Trash2, Plus, Loader2, Search, Edit, UserPlus, ArrowRight } from 'lucide-react';

export default function AdminSettings({ profile }: { profile: UserProfile | null }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);

  // Security Guard: Check if the user is truly an admin and NOT barbosma1
  const isTrulyAdmin = profile?.role === 'admin' || 
                        profile?.email === 'barbosma1@gmail.com' || 
                        profile?.email === 'barbosma3@gmail.com';

  if (!isTrulyAdmin) {
    return (
      <div className="flex flex-col items-center justify-center p-20 bg-white rounded-3xl border border-slate-100 shadow-sm text-center">
        <Shield className="w-16 h-16 text-slate-200 mb-4" />
        <h2 className="text-xl font-bold text-slate-800">Acesso Restrito</h2>
        <p className="text-slate-500 max-w-xs mx-auto mt-2">Esta área é reservada apenas para o administrador do sistema.</p>
      </div>
    );
  }
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const [showMissionModal, setShowMissionModal] = useState(false);
  const [newMissionName, setNewMissionName] = useState('');
  const [selectedCoordinator, setSelectedCoordinator] = useState('');

  const [confirmingDelete, setConfirmingDelete] = useState<{ type: 'user' | 'mission', id: string, name: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const [missionMembers, setMissionMembers] = useState<any[]>([]);
  const [selectedUserForMission, setSelectedUserForMission] = useState('');
  const [selectedMissionForUser, setSelectedMissionForUser] = useState('');
  const [memberRole, setMemberRole] = useState('member');

  useEffect(() => {
    fetchData();
    fetchMissionMembers();
  }, []);

  async function fetchMissionMembers() {
    try {
      const { data, error } = await supabase
        .from('mission_members')
        .select(`
          id,
          role,
          user_profiles (id, display_name, email),
          missions (id, name)
        `);
      
      if (error) throw error;
      setMissionMembers(data || []);
    } catch (err) {
      console.error('Erro ao buscar membros de missões:', err);
    }
  }

  const handleCreateAssociation = async () => {
    if (!selectedUserForMission || !selectedMissionForUser) {
      alert('Selecione um usuário e uma missão.');
      return;
    }

    try {
      setActionLoading(true);
      const { error } = await supabase
        .from('mission_members')
        .insert([{
          user_id: selectedUserForMission,
          mission_id: selectedMissionForUser,
          role: memberRole
        }]);

      if (error) {
        if (error.code === '23505') throw new Error('Este usuário já faz parte desta missão.');
        throw error;
      }

      setNotification({ message: 'Usuário associado à missão com sucesso!', type: 'success' });
      setSelectedUserForMission('');
      setSelectedMissionForUser('');
      fetchMissionMembers();
    } catch (err: any) {
      setNotification({ message: err.message || 'Erro ao associar usuário.', type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const removeAssociation = async (id: string) => {
    try {
      setActionLoading(true);
      const { error } = await supabase
        .from('mission_members')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      setNotification({ message: 'Associação removida.', type: 'success' });
      fetchMissionMembers();
    } catch (err: any) {
      setNotification({ message: 'Erro ao remover associação: ' + err.message, type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmingDelete(null);
    }
  };

  async function fetchData() {
    try {
      const { data: uData } = await supabase.from('user_profiles').select('*').order('email');
      const { data: mData } = await supabase.from('missions').select('*').order('name');
      
      setUsers((uData || []).map(u => ({
        id: u.id,
        uid: u.id,
        email: u.email,
        display_name: u.display_name,
        displayName: u.display_name,
        photo_url: u.photo_url,
        photoURL: u.photo_url,
        role: u.role,
        mission_id: u.mission_id,
        missionId: u.mission_id,
        created_at: u.created_at
      } as UserProfile)));

      setMissions((mData || []).map(m => ({
        id: m.id,
        name: m.name,
        invite_code: m.invite_code,
        inviteCode: m.invite_code,
        coordinator_id: m.coordinator_id,
        coordinatorId: m.coordinator_id,
        editor_ids: m.editor_ids || [],
        editorIds: m.editor_ids || [],
        created_at: m.created_at,
        createdAt: new Date(m.created_at)
      } as Mission)));

    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const [editingMission, setEditingMission] = useState<Mission | null>(null);
  const [editMissionName, setEditMissionName] = useState('');

  const openEditMission = (mission: Mission) => {
    setEditingMission(mission);
    setEditMissionName(mission.name);
  };

  const handleUpdateMission = async () => {
    if (!editingMission || !editMissionName) return;
    try {
      const { error } = await supabase
        .from('missions')
        .update({ name: editMissionName })
        .eq('id', editingMission.id);
      
      if (error) throw error;
      setNotification({ message: `Missão atualizada com sucesso para: ${editMissionName}`, type: 'success' });
      setEditingMission(null);
      fetchData();
    } catch (err: any) {
      console.error('Erro ao atualizar missão:', err);
      alert('Erro ao atualizar missão: ' + (err.message || 'Erro desconhecido'));
    }
  };

  const handleCreateMission = async () => {
    if (!newMissionName) {
      alert('Por favor, preencha o nome da missão.');
      return;
    }
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    try {
      const missionData: any = {
        name: newMissionName,
        invite_code: code,
      };

      if (selectedCoordinator) {
        missionData.coordinator_id = selectedCoordinator;
      }

      const { error } = await supabase
        .from('missions')
        .insert([missionData]);

      if (error) throw error;
      
      setNotification({ message: `Missão "${newMissionName}" criada com sucesso! Código: ${code}`, type: 'success' });
      setNewMissionName('');
      setSelectedCoordinator('');
      setShowMissionModal(false);
      fetchData();
    } catch (err: any) {
      console.error('Erro ao criar missão:', err);
      const detail = err.message || JSON.stringify(err);
      alert('Erro ao criar missão: ' + detail);
    }
  };

  const updateUserRole = async (uid: string, role: string) => {
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ role })
        .eq('id', uid);
      if (error) throw error;
      setNotification({ message: `Cargo do usuário atualizado para ${role}`, type: 'success' });
      setUsers(users.map(u => u.uid === uid ? { ...u, role: role as any } : u));
    } catch (err: any) {
      console.error(err);
      alert('Erro ao atualizar cargo: ' + (err.message || 'Erro de permissão'));
    }
  };

  const deleteUser = async (uid: string, email: string) => {
    try {
      setActionLoading(true);
      const { error } = await supabase
        .from('user_profiles')
        .delete()
        .eq('id', uid);
      if (error) throw error;
      setNotification({ message: `Usuário ${email} excluído.`, type: 'success' });
      setUsers(users.filter(u => u.uid !== uid));
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao excluir usuário: ' + (err.message || 'Verifique as permissões.'), type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmingDelete(null);
    }
  };

  const deleteMission = async (id: string, name: string) => {
    try {
      setActionLoading(true);
      const { error } = await supabase
        .from('missions')
        .delete()
        .eq('id', id);
      if (error) throw error;
      setNotification({ message: `Missão ${name} excluída com sucesso.`, type: 'success' });
      setMissions(missions.filter(m => m.id !== id));
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao excluir missão: ' + (err.message || 'Erro desconhecido'), type: 'error' });
    } finally {
      setActionLoading(false);
      setConfirmingDelete(null);
    }
  };

  if (loading) return <div className="flex justify-center p-20"><Loader2 className="animate-spin" /></div>;

  const filteredUsers = users.filter(u => 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 pb-12">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
           <h1 className="text-2xl font-bold text-brand-blue">Painel Administrativo</h1>
           <p className="text-slate-500">Gestão global de usuários e missões</p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
             <input 
                placeholder="Buscar usuários..." 
                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
             />
          </div>
          <button onClick={() => setShowMissionModal(true)} className="bg-brand-blue text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 transition-all shadow-md shrink-0">
             <Plus className="w-5 h-5" />
             <span className="hidden sm:inline">NOVA MISSÃO</span>
          </button>
        </div>
      </div>

      {/* Modal de Nova Missão */}
      {showMissionModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-brand-blue mb-6">Criar Nova Missão</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nome da Missão</label>
                <input 
                  type="text"
                  placeholder="Ex: Igreja Central"
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  value={newMissionName}
                  onChange={(e) => setNewMissionName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Coordenador Responsável</label>
                <select 
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  value={selectedCoordinator}
                  onChange={(e) => setSelectedCoordinator(e.target.value)}
                >
                  <option value="">Sem coordenador (definir depois)</option>
                  {users.map(u => (
                    <option key={u.id || (u as any).uid} value={u.id || (u as any).uid}>
                      {u.display_name || u.displayName} ({u.email})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button 
                onClick={() => setShowMissionModal(false)}
                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200"
              >
                Cancelar
              </button>
              <button 
                onClick={handleCreateMission}
                className="flex-1 py-3 bg-brand-blue text-white font-bold rounded-xl hover:bg-blue-700 shadow-md"
              >
                Criar Missão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Editar Missão */}
      {editingMission && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 w-full max-w-md shadow-2xl animate-in fade-in zoom-in duration-200">
            <h2 className="text-xl font-bold text-brand-blue mb-6">Editar Missão</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Novo Nome da Missão</label>
                <input 
                  type="text"
                  placeholder="Ex: Igreja Central"
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  value={editMissionName}
                  onChange={(e) => setEditMissionName(e.target.value)}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
               <button 
                 onClick={() => setEditingMission(null)}
                 className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200"
               >
                 Cancelar
               </button>
               <button 
                 onClick={handleUpdateMission}
                 className="flex-1 py-3 bg-brand-blue text-white font-bold rounded-xl hover:bg-blue-700 shadow-md"
               >
                 Salvar Alterações
               </button>
            </div>
          </div>
        </div>
      )}

      {/* Gestão de Associações */}
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
           <UserPlus className="w-5 h-5 text-brand-orange" /> Associar Usuário a Missão
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
           <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Usuário</label>
              <select 
                className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm"
                value={selectedUserForMission}
                onChange={(e) => setSelectedUserForMission(e.target.value)}
              >
                <option value="">Selecionar Usuário</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.display_name || u.displayName} ({u.email})</option>
                ))}
              </select>
           </div>
           <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Missão</label>
              <select 
                className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm"
                value={selectedMissionForUser}
                onChange={(e) => setSelectedMissionForUser(e.target.value)}
              >
                <option value="">Selecionar Missão</option>
                {missions.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
           </div>
           <div>
              <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cargo na Missão</label>
              <select 
                className="w-full p-3 bg-slate-50 border border-slate-100 rounded-xl text-sm"
                value={memberRole}
                onChange={(e) => setMemberRole(e.target.value)}
              >
                <option value="member">Membro</option>
                <option value="editor">Editor</option>
                <option value="coordinator">Coordenador</option>
              </select>
           </div>
           <button 
             onClick={handleCreateAssociation}
             disabled={actionLoading}
             className="bg-brand-orange text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-orange-600 transition-all shadow-md disabled:opacity-50"
           >
             {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
             ASSOCIAR
           </button>
        </div>

        <div className="mt-8">
           <p className="text-xs font-bold text-slate-400 uppercase mb-4">Associações Atuais ({missionMembers.length})</p>
           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
              {missionMembers.map((mm: any) => (
                <div key={mm.id} className="p-3 bg-slate-50 border border-slate-100 rounded-xl flex items-center justify-between group">
                   <div className="overflow-hidden">
                      <p className="font-bold text-xs text-brand-blue truncate">{mm.user_profiles?.display_name || mm.user_profiles?.email}</p>
                      <p className="text-[10px] text-slate-500 flex items-center gap-1">
                        <ArrowRight className="w-2 h-2" /> {mm.missions?.name}
                        <span className="bg-slate-200 px-1 rounded text-[8px] font-black uppercase ml-1 opacity-60">{mm.role}</span>
                      </p>
                   </div>
                   <button 
                     onClick={() => removeAssociation(mm.id)}
                     className="p-1.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                   >
                      <Trash2 className="w-3.5 h-3.5" />
                   </button>
                </div>
              ))}
              {missionMembers.length === 0 && (
                <p className="text-[10px] text-slate-400 italic">Nenhuma associação encontrada.</p>
              )}
           </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
           <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-orange" /> Usuários ({users.length})
           </h3>
           <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {filteredUsers.map(user => (
                <div key={user.uid} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100 hover:border-brand-blue/20 transition-all">
                   <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-brand-blue/10 rounded-full flex items-center justify-center text-brand-blue font-bold text-sm">
                         {user.photoURL ? <img src={user.photoURL} className="w-full h-full rounded-full object-cover" /> : user.displayName?.[0] || 'U'}
                      </div>
                      <div className="max-w-[120px] sm:max-w-none truncate">
                         <p className="font-bold text-sm truncate">{user.displayName}</p>
                         <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                      </div>
                   </div>
                   <div className="flex items-center gap-2">
                      <select 
                         className="text-[10px] sm:text-xs bg-white border border-slate-200 rounded-lg p-1.5 font-medium"
                         value={user.role} 
                         onChange={(e) => updateUserRole(user.uid, e.target.value)}
                      >
                         <option value="admin">Admin</option>
                         <option value="coordinator">Coordenador</option>
                         <option value="editor">Editor</option>
                         <option value="member">Membro</option>
                      </select>
                      <button 
                        onClick={() => setConfirmingDelete({ type: 'user', id: user.uid, name: user.email })}
                        className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all rounded-lg"
                      >
                         <Trash2 className="w-4 h-4" />
                      </button>
                   </div>
                </div>
              ))}
              {filteredUsers.length === 0 && (
                <p className="text-center text-slate-400 py-10 text-sm">Nenhum usuário encontrado.</p>
              )}
           </div>
        </div>

        <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
           <h3 className="font-bold text-lg mb-6 flex items-center gap-2">
              <Shield className="w-5 h-5 text-brand-blue" /> Missões Ativas ({missions.length})
           </h3>
           <div className="grid gap-4 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
              {missions.map(m => (
                <div key={m.id} className="bg-slate-50 p-6 rounded-2xl flex justify-between items-center border border-slate-100 hover:border-brand-blue/20 transition-all">
                   <div>
                      <p className="font-bold text-base text-brand-blue">{m.name}</p>
                      <p className="text-xs font-mono text-slate-400 mt-1 bg-white inline-block px-2 py-0.5 rounded border border-slate-100">
                        CÓDIGO: <span className="font-bold">{m.inviteCode || 'NÃO DEFINIDO'}</span>
                      </p>
                   </div>
                   <div className="flex gap-2">
                      <button 
                        onClick={async () => {
                           const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                           const { error } = await supabase.from('missions').update({ invite_code: code }).eq('id', m.id);
                           if (!error) {
                             setNotification({ message: 'Código regenerado!', type: 'success' });
                             fetchData();
                           }
                        }}
                        className="p-3 bg-white text-slate-400 hover:text-brand-orange hover:shadow-sm border border-slate-200 rounded-xl transition-all"
                        title="Regenerar Código"
                      >
                        <Shield className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => openEditMission(m)}
                        className="p-3 bg-white text-slate-400 hover:text-brand-blue hover:shadow-sm border border-slate-200 rounded-xl transition-all"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => setConfirmingDelete({ type: 'mission', id: m.id, name: m.name })}
                        className="p-3 bg-white text-slate-400 hover:text-red-500 hover:shadow-sm border border-slate-200 rounded-xl transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                   </div>
                </div>
              ))}
              {missions.length === 0 && (
                <p className="text-center text-slate-400 py-10 text-sm">Nenhuma missão cadastrada.</p>
              )}
           </div>
        </div>
      </div>

      {/* Confirmação de Exclusão */}
      {confirmingDelete && (
        <div className="fixed inset-0 z-[110] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6">
              <Trash2 className="w-8 h-8 text-red-500" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">Excluir {confirmingDelete.type === 'user' ? 'Usuário' : 'Missão'}?</h3>
            <p className="text-slate-500 text-sm leading-relaxed mb-8">
              Tem certeza que deseja excluir <strong>{confirmingDelete.name}</strong>? Esta ação não pode ser desfeita.
            </p>
            <div className="flex gap-3">
              <button 
                onClick={() => setConfirmingDelete(null)}
                disabled={actionLoading}
                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  if (confirmingDelete.type === 'user') deleteUser(confirmingDelete.id, confirmingDelete.name);
                  else deleteMission(confirmingDelete.id, confirmingDelete.name);
                }}
                disabled={actionLoading}
                className="flex-1 py-3 bg-red-500 text-white font-bold rounded-xl hover:bg-red-600 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-red-500/20"
              >
                {actionLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {actionLoading ? 'Excluindo...' : 'Sim, Excluir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notificação Flutuante */}
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
