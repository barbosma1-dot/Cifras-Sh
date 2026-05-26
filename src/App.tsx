/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { UserProfile } from './types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import RepertoireDetail from './components/RepertoireDetail';
import { Loader2 } from 'lucide-react';
import { Repertoire } from './types';

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [publicRepertoireId, setPublicRepertoireId] = useState<string | null>(null);
  const [publicRepertoire, setPublicRepertoire] = useState<Repertoire | null>(null);

  useEffect(() => {
    // Check for public repertoire access
    const urlParams = new URLSearchParams(window.location.search);
    const repertoireId = urlParams.get('repertoireId');
    if (repertoireId) {
      setPublicRepertoireId(repertoireId);
      fetchPublicRepertoire(repertoireId);
    }

    // Check active session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) fetchProfile(session.user.id, session.user);
      else setLoading(false);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) fetchProfile(session.user.id, session.user);
      else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(uid: string, user?: any) {
    try {
      let { data, error: fetchError } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', uid)
        .single();
      
      if (fetchError && fetchError.code === 'PGRST116') {
        // Profile doesn't exist, create it
        const newProfile = {
          id: uid,
          email: user?.email || '',
          display_name: user?.email?.split('@')[0] || 'Novo Usuário',
          role: user?.email === 'barbosma1@gmail.com' ? 'admin' : 'member',
          created_at: new Date().toISOString()
        };

        const { data: created, error: createError } = await supabase
          .from('user_profiles')
          .insert([newProfile])
          .select()
          .single();
        
        if (createError) {
          console.error('Error creating profile:', createError);
          setLoading(false);
          return;
        }
        data = created;
      } else if (fetchError) {
        console.error('Profile fetch error:', fetchError);
        setLoading(false);
        return;
      }

      let profileData = data as UserProfile;

      // Auto-promote barbosma1 to admin and DEMOTE any unauthorized admins
      if (profileData.email === 'barbosma1@gmail.com' && profileData.role !== 'admin') {
        const { data: updated, error: uErr } = await supabase
          .from('user_profiles')
          .update({ role: 'admin' })
          .eq('id', uid)
          .select()
          .single();
        
        if (!uErr && updated) {
          profileData = updated as UserProfile;
        }
      } else if (profileData.email !== 'barbosma1@gmail.com' && profileData.role === 'admin') {
        // Demote anyone else who was previously an admin
        const { data: updated, error: uErr } = await supabase
          .from('user_profiles')
          .update({ role: 'member' })
          .eq('id', uid)
          .select()
          .single();
        
        if (!uErr && updated) {
          profileData = updated as UserProfile;
        }
      }

      setProfile(profileData);
    } catch (err) {
      console.error('Error in fetchProfile:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPublicRepertoire(id: string) {
    try {
      const { data, error } = await supabase
        .from('repertoires')
        .select('*')
        .eq('id', id)
        .single();
      
      if (data) {
        setPublicRepertoire(data as Repertoire);
      }
    } catch (err) {
      console.error('Error fetching public repertoire:', err);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-brand-blue">
        <Loader2 className="w-12 h-12 text-white animate-spin" />
      </div>
    );
  }

  if (!session) {
    if (publicRepertoire) {
      return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-8">
           <div className="max-w-6xl mx-auto">
              <RepertoireDetail 
                repertoire={publicRepertoire} 
                profile={null} 
                onBack={() => {
                  window.location.href = window.location.origin;
                }} 
              />
           </div>
        </div>
      );
    }
    return <Login />;
  }

  return <Dashboard user={session.user} profile={profile} setProfile={setProfile} />;
}
