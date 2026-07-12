import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';
import { Camera, User, Phone, Mail, Lock, Save, Loader2, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';

interface ProfileViewProps {
  profile: UserProfile | null;
  setProfile: (p: UserProfile | null) => void;
}

export default function ProfileView({ profile, setProfile }: ProfileViewProps) {
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  const [form, setForm] = useState({
    displayName: profile?.displayName || (profile as any)?.display_name || '',
    whatsapp: (profile as any)?.whatsapp || '',
    newPassword: '',
    photoURL: profile?.photoURL || (profile as any)?.photo_url || '',
  });

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setLoading(true);
    setSuccess(false);

    try {
      const updates = {
        display_name: form.displayName,
        whatsapp: form.whatsapp,
        photo_url: form.photoURL,
        updated_at: new Date().toISOString()
      };

      const { data: updatedProfile, error } = await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', profile.id || (profile as any).uid)
        .select()
        .single();

      if (error) throw error;
      console.log('Perfil atualizado no Supabase:', updatedProfile);
      setNotification({ message: 'Perfil atualizado com sucesso!', type: 'success' });

      if (form.newPassword) {
        const { error: pwdError } = await supabase.auth.updateUser({
          password: form.newPassword
        });
        if (pwdError) throw pwdError;
      }

      // Update state with returned server data for consistency
      if (updatedProfile) {
        setProfile({
          ...profile,
          ...updatedProfile,
          displayName: updatedProfile.display_name,
          photoURL: updatedProfile.photo_url,
          missionId: updatedProfile.mission_id,
          role: profile?.email === 'barbosma1@gmail.com' ? 'admin' : updatedProfile.role
        } as any);
      }
      
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      setForm(prev => ({ ...prev, newPassword: '' }));
    } catch (err) {
      console.error(err);
      setNotification({ message: 'Erro ao atualizar perfil.', type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    
    setLoading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile.uid || (profile as any).id}.${fileExt}`;
      const filePath = `profiles/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ photo_url: publicUrl })
        .eq('id', profile.uid || (profile as any).id);

      if (updateError) throw updateError;

      setProfile({ ...profile, photoURL: publicUrl } as any);
      setForm(prev => ({ ...prev, photoURL: publicUrl }));
    } catch (err) {
      console.error(err);
      setNotification({ message: 'Erro no upload da foto. Verifique o bucket "avatars" existe.', type: 'error' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="h-32 bg-brand-blue relative">
            <div className="absolute -bottom-12 left-8 flex items-end gap-6 text-white">
              <div className="relative group">
                <div className="w-24 h-24 rounded-3xl bg-brand-orange border-4 border-white overflow-hidden shadow-lg flex items-center justify-center">
                   {profile?.photoURL ? (
                     <img src={profile.photoURL} alt="Avatar" className="w-full h-full object-cover" />
                   ) : (
                     <User className="w-12 h-12 text-white" />
                   )}
                </div>
                <label className="absolute bottom-1 right-1 bg-white p-1.5 rounded-lg shadow-lg cursor-pointer transform hover:scale-110 transition-transform">
                  <Camera className="w-4 h-4 text-brand-blue" />
                  <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                </label>
              </div>
              <div className="mb-4">
                <h2 className="text-2xl font-bold">{profile?.displayName}</h2>
                <p className="opacity-60 text-sm font-medium uppercase tracking-widest">
                  {profile?.role === 'admin' ? 'Administrador' : (profile?.role === 'coordinator' ? 'Coordenador' : (profile?.role === 'editor' ? 'Editor' : 'Membro'))}
                </p>
              </div>
            </div>
          </div>

          <div className="p-8 pt-16 mt-4">
            <form onSubmit={handleUpdate} className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <h3 className="font-bold text-lg text-slate-800 border-b border-slate-100 pb-2">Informações Pessoais</h3>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                    <User className="w-4 h-4" /> Nome Completo
                  </label>
                  <input 
                     className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                     value={form.displayName}
                     onChange={e => setForm({...form, displayName: e.target.value})}
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-600 mb-1 flex items-center gap-2">
                    <Mail className="w-4 h-4" /> Email
                  </label>
                  <input 
                     className="w-full px-4 py-2 bg-slate-100 text-slate-500 border border-slate-200 rounded-xl"
                     value={profile?.email}
                     disabled
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                    <Phone className="w-4 h-4" /> WhatsApp
                  </label>
                  <input 
                     className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                     placeholder="(00) 00000-0000"
                     value={form.whatsapp}
                     onChange={e => setForm({...form, whatsapp: e.target.value})}
                  />
                </div>
              </div>

              <div className="space-y-6">
                <h3 className="font-bold text-lg text-slate-800 border-b border-slate-100 pb-2">Segurança</h3>
                
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1 flex items-center gap-2">
                    <Lock className="w-4 h-4" /> Nova Senha
                  </label>
                  <input 
                     type="password"
                     className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl"
                     placeholder="Deixe em branco para não alterar"
                     value={form.newPassword}
                     onChange={e => setForm({...form, newPassword: e.target.value})}
                  />
                </div>

                <div className="pt-6">
                  <button 
                    disabled={loading}
                    className={`w-full py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg
                      ${success ? 'bg-green-500 text-white' : 'bg-brand-blue text-white hover:bg-brand-blue/90'}`}
                  >
                    {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 
                     success ? <CheckCircle2 className="w-6 h-6" /> : (
                       <>
                          <Save className="w-6 h-6" />
                          SALVAR ALTERAÇÕES
                       </>
                     )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
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
