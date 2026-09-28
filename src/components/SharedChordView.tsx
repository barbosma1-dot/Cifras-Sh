import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import ChordViewer from './ChordViewer';
import SplashScreen from './SplashScreen';

/** Extrai o id da cifra de /cifra/<uuid> (ou ?cifraId=<uuid>). */
export function getSharedChordId(): string | null {
  const m = window.location.pathname.match(/^\/cifra\/([0-9a-fA-F-]{36})\/?$/);
  if (m) return m[1];
  const q = new URLSearchParams(window.location.search).get('cifraId');
  return q && /^[0-9a-fA-F-]{36}$/.test(q) ? q : null;
}

/**
 * Acesso por link: só leitura. Busca a cifra pelo id (SELECT público no RLS)
 * e abre o ChordViewer com readOnly — sem editar, excluir nem adicionar a caderno.
 * A escrita continua bloqueada no banco por can_edit_chord().
 */
export default function SharedChordView({ chordId }: { chordId: string }) {
  const [chord, setChord] = useState<any>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    supabase
      .from('chords')
      .select('*')
      .eq('id', chordId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) setState('error');
        else { setChord(data); setState('ok'); }
      });
    return () => { active = false; };
  }, [chordId]);

  const goHome = () => { window.location.href = window.location.origin; };

  if (state === 'loading') return <SplashScreen />;
  if (state === 'error') {
    return (
      <div className="min-h-screen bg-brand-blue flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center space-y-3">
          <p className="text-slate-800 font-semibold">Não foi possível abrir esta cifra.</p>
          <p className="text-slate-500 text-sm">O link pode estar incorreto ou a cifra foi removida.</p>
          <button onClick={goHome} className="mt-2 w-full bg-orange-500 text-white font-semibold py-2.5 rounded-xl">
            Ir para o início
          </button>
        </div>
      </div>
    );
  }
  return <ChordViewer chord={chord} onClose={goHome} readOnly />;
}
