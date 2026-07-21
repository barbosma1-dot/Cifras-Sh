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
import { Loader2, WifiOff } from 'lucide-react';
import { Repertoire } from './types';
import { withTimeout } from './lib/withTimeout';

// Tempo máximo de espera por chamadas de rede no arranque do app. Sem isso,
// numa conexão "falsa" (sinal presente mas sem internet de verdade), a tela
// de carregamento pode ficar presa por muito tempo antes de falhar sozinha.
const AUTH_TIMEOUT_MS = 7000;
const PROFILE_CACHE_KEY = 'cifra-sh-cached-profile';
const USER_CACHE_KEY = 'cifra-sh-cached-user';

function cacheProfile(profile: UserProfile, user?: any) {
  try {
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile));
    if (user) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify({ id: user.id, email: user.email }));
    }
  } catch {
    // Armazenamento local indisponível (modo privado, etc). Sem problema, só não cacheia.
  }
}

function getCachedProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

function getCachedUser(): { id: string; email: string } | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [usingCachedAuth, setUsingCachedAuth] = useState(false);
  const [publicRepertoireId, setPublicRepertoireId] = useState<string | null>(null);
  const [publicRepertoire, setPublicRepertoire] = useState<Repertoire | null>(null);
  const [publicRepertoireLoading, setPublicRepertoireLoading] = useState(false);
  const [publicRepertoireError, setPublicRepertoireError] = useState(false);

  useEffect(() => {
    // Check for public repertoire access
    const urlParams = new URLSearchParams(window.location.search);
    const repertoireId = urlParams.get('repertoireId');
    if (repertoireId) {
      setPublicRepertoireId(repertoireId);
      setPublicRepertoireLoading(true);
      fetchPublicRepertoire(repertoireId);
    }

    const handleAuthAndSession = async () => {
      // 1. Extract tokens from URL (query string or hash)
      const searchParams = new URLSearchParams(window.location.search);
      let accessToken = searchParams.get('access_token');
      let refreshToken = searchParams.get('refresh_token');

      const hash = window.location.hash;
      if (hash) {
        const hashParams = new URLSearchParams(hash.substring(1));
        if (!accessToken) accessToken = hashParams.get('access_token');
        if (!refreshToken) refreshToken = hashParams.get('refresh_token');
      }

      if (accessToken && refreshToken) {
        try {
          console.log('SSO: Tentando autenticar com tokens recebidos na URL...');
          const { data, error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });

          if (error) {
            console.error('SSO Error: Falha ao definir sessão do Supabase:', error.message);
          } else if (data.session) {
            console.log('SSO Success: Autenticado com sucesso para o usuário', data.session.user.email);
            
            // Clean URL parameters using history.replaceState
            const url = new URL(window.location.href);
            url.searchParams.delete('access_token');
            url.searchParams.delete('refresh_token');
            const currentHash = url.hash;
            if (currentHash) {
              const hashParams = new URLSearchParams(currentHash.substring(1));
              hashParams.delete('access_token');
              hashParams.delete('refresh_token');
              const newHash = hashParams.toString();
              url.hash = newHash ? `#${newHash}` : '';
            }
            window.history.replaceState({}, document.title, url.toString());
          }
        } catch (err) {
          console.error('SSO Exception:', err);
        }
      }

      // 2. Check active session (which could be the one we just set or a previously saved one)
      try {
        const { data: { session: currentSession } } = await withTimeout(
          supabase.auth.getSession(),
          AUTH_TIMEOUT_MS,
          'timeout-session'
        );
        setSession(currentSession);
        if (currentSession) {
          await fetchProfile(currentSession.user.id, currentSession.user);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error('Erro ao obter sessão (possível falta de conexão):', err);

        // Sem rede (ou rede muito lenta/instável): tenta usar o login e o perfil
        // salvos localmente da última vez que o app abriu com sucesso, para que
        // o usuário ainda consiga acessar os repertórios já baixados offline.
        const cachedUser = getCachedUser();
        const cachedProfile = getCachedProfile();
        if (cachedUser && cachedProfile) {
          setSession({ user: cachedUser });
          setProfile(cachedProfile);
          setUsingCachedAuth(true);
        }
        setLoading(false);
      }
    };

    handleAuthAndSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      if (currentSession) {
        fetchProfile(currentSession.user.id, currentSession.user);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchProfile(uid: string, user?: any) {
    try {
      let { data, error: fetchError } = await withTimeout(
        supabase
          .from('user_profiles')
          .select('*')
          .eq('id', uid)
          .single(),
        AUTH_TIMEOUT_MS,
        'timeout-profile'
      );
      
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
      if (profileData.email === 'barbosma1@gmail.com') {
        profileData.role = 'admin'; // Force role to admin on client-side for barbosma1
        
        const { data: updated, error: uErr } = await supabase
          .from('user_profiles')
          .update({ role: 'admin' })
          .eq('id', uid)
          .select()
          .single();
        
        if (!uErr && updated) {
          profileData = { ...(updated as UserProfile), role: 'admin' };
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
      cacheProfile(profileData, user);
      setUsingCachedAuth(false);
    } catch (err) {
      console.error('Error in fetchProfile (possível falta de conexão):', err);

      // Sem rede: usa o último perfil salvo localmente, se existir e for do mesmo usuário.
      const cachedProfile = getCachedProfile();
      if (cachedProfile && cachedProfile.id === uid) {
        setProfile(cachedProfile);
        setUsingCachedAuth(true);
      }
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

      if (error || !data) {
        setPublicRepertoireError(true);
      } else {
        setPublicRepertoire(data as Repertoire);
      }
    } catch (err) {
      console.error('Error fetching public repertoire:', err);
      setPublicRepertoireError(true);
    } finally {
      setPublicRepertoireLoading(false);
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
    // Se veio de um link de repertório compartilhado, espera essa busca terminar
    // antes de decidir se mostra o repertório ou a tela de Login. Antes, a tela de
    // Login aparecia de imediato (a checagem de sessão termina antes da busca do
    // repertório público), e quem abrisse o link sem estar logado via a tela de
    // Login em vez do repertório, mesmo quando o link era válido.
    if (publicRepertoireId && publicRepertoireLoading) {
      return (
        <div className="flex items-center justify-center min-h-screen bg-brand-blue">
          <Loader2 className="w-12 h-12 text-white animate-spin" />
        </div>
      );
    }

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

    if (publicRepertoireId && publicRepertoireError) {
      return (
        <div className="min-h-screen bg-brand-blue flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center space-y-3">
            <p className="text-slate-800 font-semibold">Não foi possível abrir este repertório.</p>
            <p className="text-slate-500 text-sm">
              O link pode ter expirado, o repertório pode não ser mais público, ou você
              pode precisar fazer login para acessá-lo.
            </p>
            <button
              onClick={() => { window.location.href = window.location.origin; }}
              className="mt-2 w-full bg-orange-500 text-white font-semibold py-2.5 rounded-xl"
            >
              Ir para o login
            </button>
          </div>
        </div>
      );
    }

    return <Login />;
  }

  return (
    <>
      {usingCachedAuth && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1.5 bg-amber-500 text-white text-[10px] font-bold py-1 px-2.5 rounded-full shadow-md max-w-[92vw]">
          <WifiOff className="w-3 h-3 shrink-0" />
          <span className="truncate">Sem conexão — login salvo localmente</span>
        </div>
      )}
      <Dashboard user={session.user} profile={profile} setProfile={setProfile} />
    </>
  );
}
