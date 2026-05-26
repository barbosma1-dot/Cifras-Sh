import { useState, useEffect } from 'react';
import Calendar from 'react-calendar';
import 'react-calendar/dist/Calendar.css';
import { 
  Calendar as CalendarIcon, 
  MapPin, 
  Clock, 
  ChevronRight, 
  Plus, 
  Filter,
  Share2,
  CalendarDays,
  Loader2,
  X
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { UserProfile, Repertoire, Mission } from '../types';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import RepertoireDetail from './RepertoireDetail';

export default function RepertoireList({ profile, initialMissionId, initialRepertoireId }: { profile: UserProfile | null, initialMissionId?: string | null, initialRepertoireId?: string | null }) {
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [date, setDate] = useState<any>(new Date());

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedRepertoire, setSelectedRepertoire] = useState<Repertoire | null>(null);
  
  // Active filter for mission
  const [activeMissionFilter, setActiveMissionFilter] = useState<string | null>(initialMissionId || null);

  useEffect(() => {
    if (initialRepertoireId) {
      fetchSingleRepertoire(initialRepertoireId);
    }
  }, [initialRepertoireId]);

  async function fetchSingleRepertoire(id: string) {
    try {
      const { data, error } = await supabase
        .from('repertoires')
        .select('*')
        .eq('id', id)
        .single();
      
      if (data) {
        setSelectedRepertoire(data as Repertoire);
      }
    } catch (err) {
      console.error('Erro ao buscar repertório inicial:', err);
    }
  }

  useEffect(() => {
    if (initialMissionId) {
      setActiveMissionFilter(initialMissionId);
    }
  }, [initialMissionId]);

  // Form state
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('Missa');
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd'T'HH:mm"));
  const [newMissionId, setNewMissionId] = useState('');
  const [newColor, setNewColor] = useState('white');

  const COLORS = [
    { label: 'Branco', value: 'white', class: 'bg-white border-slate-200' },
    { label: 'Dourado', value: 'gold', class: 'bg-amber-400' },
    { label: 'Azul', value: 'blue', class: 'bg-blue-600' },
    { label: 'Verde', value: 'green', class: 'bg-emerald-500' },
    { label: 'Vermelho', value: 'red', class: 'bg-rose-500' },
    { label: 'Roxo', value: 'purple', class: 'bg-violet-600' },
  ];

  useEffect(() => {
    if (profile) {
      fetchData();
    }
  }, [profile]);

  async function fetchData() {
    setLoading(true);
    try {
      const userId = profile?.id || (profile as any)?.uid;
      
      // Fetch missions the user belongs to
      const { data: mData, error: mError } = await supabase
        .from('mission_members')
        .select('missions(*)')
        .eq('user_id', userId);
      
      if (mError) throw mError;
      const userMissions = (mData as any[]).map(m => m.missions);
      
      // Fallback: If no missions found in mission_members but profile has one
      const currentMissionId = profile?.missionId || profile?.mission_id;
      if (userMissions.length === 0 && currentMissionId) {
        const { data: legacyMission } = await supabase
          .from('missions')
          .select('*')
          .eq('id', currentMissionId)
          .single();
        if (legacyMission) userMissions.push(legacyMission);
      }

      setMissions(userMissions);
      if (userMissions.length > 0 && !newMissionId) setNewMissionId(userMissions[0].id);

      // Fetch repertoires from these missions
      let missionIds = userMissions.map(m => m.id);
      const isAdmin = profile?.role === 'admin' || profile?.email === 'barbosma1@gmail.com';
      
      if (isAdmin) {
        // Admins see all repertoires
        const { data, error } = await supabase
          .from('repertoires')
          .select('*')
          .order('date', { ascending: false });
        
        if (error) throw error;
        setRepertoires(data || []);
        return;
      }

      if (activeMissionFilter) {
        missionIds = [activeMissionFilter];
      }
      
      if (missionIds.length === 0) {
        // Tenta buscar repertórios públicos ou onde o usuário é responsável
        const { data: fallbackReps } = await supabase
          .from('repertoires')
          .select('*')
          .or(`is_public.eq.true,responsible_id.eq.${userId}`)
          .order('date', { ascending: false });
        setRepertoires(fallbackReps || []);
        return;
      }

      // Constrói a query de forma segura
      let query = supabase.from('repertoires').select('*');
      
      if (missionIds.length > 0) {
        query = query.or(`mission_id.in.(${missionIds.join(',')}),responsible_id.eq.${userId}`);
      } else {
        query = query.eq('responsible_id', userId);
      }

      const { data, error } = await query.order('date', { ascending: false });
      
      if (error) throw error;
      setRepertoires(data as any[]);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const handleCreate = async () => {
    if (!newName || !newMissionId) {
      setNotification({ message: 'Preencha o nome e selecione a missão.', type: 'error' });
      return;
    }

    try {
      const { error } = await supabase
        .from('repertoires')
        .insert([{
          name: newName,
          type: newType,
          date: newDate,
          mission_id: newMissionId,
          color: newColor,
          responsible_id: profile?.id || (profile as any)?.uid
        }]);

      if (error) throw error;
      
      setNotification({ message: 'Repertório criado com sucesso!', type: 'success' });
      setIsModalOpen(false);
      setNewName('');
      fetchData();
    } catch (err: any) {
      console.error(err);
      setNotification({ message: 'Erro ao criar repertório: ' + err.message, type: 'error' });
    }
  };

  if (selectedRepertoire) {
    return (
      <RepertoireDetail 
        repertoire={selectedRepertoire} 
        profile={profile} 
        onBack={() => {
          setSelectedRepertoire(null);
          fetchData(); // Recarrega dados ao voltar
        }} 
      />
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-100">
        <div>
          <h1 className="text-2xl font-display font-bold text-brand-blue">Meus Repertórios</h1>
          <p className="text-slate-500">Planeje as músicas de cada missão ou evento</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="flex bg-slate-100 p-1 rounded-xl">
             <button 
                onClick={() => setViewMode('list')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'list' ? 'bg-white shadow text-brand-blue' : 'text-slate-500'}`}
             >
                LISTA
             </button>
             <button 
                onClick={() => setViewMode('calendar')}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'calendar' ? 'bg-white shadow text-brand-blue' : 'text-slate-500'}`}
             >
                CALENDÁRIO
             </button>
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="bg-brand-orange text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-orange-600 transition-all shadow-lg"
          >
            <Plus className="w-5 h-5" />
            NOVO
          </button>
        </div>
      </div>

      {/* Modal de Novo Repertório */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-8 w-full max-w-lg shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-brand-blue">Novo Repertório</h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nome do Repertório</label>
                <input 
                  type="text"
                  placeholder="Ex: Missa de Domingo"
                  className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Tipo</label>
                   <select 
                      className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                      value={newType}
                      onChange={(e) => setNewType(e.target.value)}
                   >
                      <option value="Missa">Missa</option>
                      <option value="Laudes">Laudes</option>
                      <option value="Vésperas">Vésperas</option>
                      <option value="Grupo de Oração">Grupo de Oração</option>
                      <option value="Outro">Outro</option>
                   </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Data e Hora</label>
                  <input 
                    type="datetime-local"
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                  />
                </div>
              </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Vincular à Missão</label>
                  <select 
                    className="w-full p-4 bg-slate-50 border border-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-brand-blue/20"
                    value={newMissionId}
                    onChange={(e) => setNewMissionId(e.target.value)}
                  >
                    {missions.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                    {missions.length === 0 && <option value="">Nenhuma missão encontrada</option>}
                  </select>
                  {missions.length === 0 && (
                    <p className="text-[10px] text-brand-orange mt-2 font-bold uppercase">Aviso: Você precisa participar de uma missão para criar repertórios vinculados.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Cor Litúrgica / Tema</label>
                  <div className="flex gap-2">
                    {COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => setNewColor(c.value)}
                        title={c.label}
                        className={`w-10 h-10 rounded-full border-2 transition-all ${c.class} ${newColor === c.value ? 'ring-2 ring-brand-blue ring-offset-2 scale-110' : 'opacity-60 hover:opacity-100'}`}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-3 mt-8">
               <button 
                 onClick={() => setIsModalOpen(false)}
                 className="flex-1 py-4 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200"
               >
                 Cancelar
               </button>
               <button 
                 onClick={handleCreate}
                 disabled={missions.length === 0}
                 className="flex-1 py-4 bg-brand-blue text-white font-bold rounded-xl hover:bg-blue-700 shadow-lg disabled:opacity-50"
               >
                 Criar Repertório
               </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className={viewMode === 'list' ? 'lg:col-span-8 space-y-4' : 'lg:col-span-12'}>
          {loading ? (
             <div className="flex justify-center p-20"><Loader2 className="animate-spin text-brand-blue" /></div>
          ) : viewMode === 'list' ? (
            <div className="space-y-4">
              {repertoires.map(item => {
                const bgColor = COLORS.find(c => c.value === item.color)?.class || 'bg-brand-blue';
                const isLight = item.color === 'white';
                
                return (
                  <div key={item.id} className="bg-white p-3 rounded-2xl border border-slate-100 hover:border-brand-blue/30 transition-all flex items-center justify-between group shadow-sm">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex flex-col items-center justify-center border shadow-sm
                        ${bgColor} ${isLight ? 'text-slate-500' : 'text-white'}`}>
                        <span className={`text-[8px] font-black uppercase ${isLight ? 'text-brand-blue' : 'text-white/80'}`}>{format(new Date(item.date), 'MMM', { locale: ptBR })}</span>
                        <span className="text-sm font-black">{format(new Date(item.date), 'dd')}</span>
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-slate-800 leading-tight">{item.name}</h3>
                        <div className="flex items-center gap-3 text-[10px] text-slate-500 mt-0.5">
                          <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> {format(new Date(item.date), 'HH:mm')}</span>
                          <span className="flex items-center gap-1 font-bold uppercase tracking-wider text-[8px]"><Filter className="w-2.5 h-2.5" /> {item.type}</span>
                          <span className="flex items-center gap-1"><Share2 className="w-2.5 h-2.5" /> {(item.chord_ids || []).length}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setSelectedRepertoire(item)}
                        className="p-2 bg-brand-blue/5 text-brand-blue rounded-lg group-hover:bg-brand-blue group-hover:text-white transition-all"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {!loading && repertoires.length === 0 && (
                <div className="py-20 text-center text-slate-400">
                  <CalendarDays className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>Nenhum repertório planejado.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <div className="lg:col-span-8 bg-white p-6 md:p-8 rounded-3xl shadow-sm border border-slate-100 flex flex-col items-center">
                 <Calendar 
                   onChange={setDate} 
                   value={date}
                   className="repertoire-calendar w-full !border-none !font-sans"
                   locale="pt-BR"
                   tileContent={({ date: cellDate, view }) => {
                     if (view === 'month') {
                       const dayReps = repertoires.filter(r => 
                         new Date(r.date).toDateString() === cellDate.toDateString()
                       );
                       if (dayReps.length > 0) {
                         return (
                           <div className="flex justify-center gap-1 mt-1">
                             {dayReps.slice(0, 3).map((r, i) => {
                               const dotColor = COLORS.find(c => c.value === r.color)?.class || 'bg-brand-blue';
                               return <div key={i} className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />;
                             })}
                             {dayReps.length > 3 && <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />}
                           </div>
                         );
                       }
                     }
                     return null;
                   }}
                 />
              </div>

              <div className="lg:col-span-4 space-y-4">
                <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm min-h-[300px]">
                   <h3 className="font-bold text-slate-800 flex items-center gap-2 mb-6">
                     <CalendarIcon className="w-5 h-5 text-brand-orange" />
                     {format(date, "dd 'de' MMMM", { locale: ptBR })}
                   </h3>
                   
                   <div className="space-y-3">
                     {repertoires
                       .filter(r => new Date(r.date).toDateString() === date.toDateString())
                       .map(item => {
                         const colorClass = COLORS.find(c => c.value === item.color)?.class || 'bg-brand-blue';
                         return (
                           <button 
                             key={item.id}
                             onClick={() => setSelectedRepertoire(item)}
                             className="w-full text-left p-4 rounded-2xl border border-slate-50 hover:bg-slate-50 hover:border-brand-blue/30 transition-all group"
                           >
                             <div className="flex items-center gap-3">
                               <div className={`w-3 h-10 rounded-full ${colorClass}`} />
                               <div className="flex-1 overflow-hidden">
                                 <p className="font-bold text-slate-800 truncate text-sm">{item.name}</p>
                                 <p className="text-[10px] text-slate-400 font-bold uppercase">{item.type} • {format(new Date(item.date), 'HH:mm')}</p>
                               </div>
                               <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-brand-blue" />
                             </div>
                           </button>
                         );
                       })}
                     
                     {repertoires.filter(r => new Date(r.date).toDateString() === date.toDateString()).length === 0 && (
                       <div className="text-center py-10">
                         <MapPin className="w-8 h-8 text-slate-100 mx-auto mb-3" />
                         <p className="text-xs text-slate-400 italic">Nenhum evento neste dia</p>
                       </div>
                     )}
                   </div>
                </div>

                <div className="p-6 bg-brand-blue/5 rounded-3xl border border-brand-blue/10">
                   <p className="text-xs font-bold text-brand-blue uppercase tracking-widest mb-2">Dica</p>
                   <p className="text-xs text-slate-600 leading-relaxed">
                     Os pontos coloridos no calendário indicam a cor litúrgica ou tema definido para cada evento do dia.
                   </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {viewMode === 'list' && (
          <div className="lg:col-span-4 space-y-6">
            <div className="bg-brand-blue text-white p-8 rounded-3xl shadow-xl relative overflow-hidden">
              <div className="absolute -right-10 -bottom-10 opacity-10">
                 <CalendarDays className="w-48 h-48 rotate-12" />
              </div>
              <h4 className="font-bold mb-4 flex items-center gap-2">
                 <Clock className="w-5 h-5 text-brand-orange" />
                 Próximos Eventos
              </h4>
              <div className="space-y-4">
                 {repertoires.slice(0, 3).map(e => (
                   <div key={e.id} className="bg-white/10 p-4 rounded-xl backdrop-blur-sm border border-white/10">
                      <p className="text-xs font-bold text-white/50 mb-1 uppercase">
                        {format(new Date(e.date), "EEEE, dd MMM - HH:mm", { locale: ptBR })}
                      </p>
                      <p className="font-bold text-sm truncate">{e.name}</p>
                   </div>
                 ))}
                 {repertoires.length === 0 && (
                   <p className="text-sm opacity-50 italic">Nenhum evento próximo</p>
                 )}
              </div>
            </div>
          </div>
        )}
      </div>

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
