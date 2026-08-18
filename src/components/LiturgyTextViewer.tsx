import { useEffect, useState } from 'react';
import { X, ExternalLink, WifiOff, Download, CheckCircle2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface LiturgyTextViewerProps {
  onClose: () => void;
}

const STORAGE_KEY = 'liturgia-diaria-texto-salvo';

interface SavedLiturgy {
  title: string;
  text: string;
  source: string;
  fetchedAt: string;
  // Guardamos a data (YYYY-MM-DD, fuso local) em que foi buscado, só para
  // avisar a pessoa se está vendo o texto de um dia diferente de hoje —
  // não bloqueamos nada por isso, porque sem internet é melhor mostrar uma
  // liturgia "velha" do que nenhuma.
  savedForDate: string;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Mostra a Liturgia Diária como TEXTO LIMPO (sem anúncios, sem navegação
 * para outros dias, sem propaganda), buscado e filtrado no servidor
 * (functions/api/liturgy.ts) e guardado em localStorage.
 *
 * Por que texto em vez de iframe: a página original injeta um anúncio de
 * vídeo em tela cheia e não se comportava de forma confiável com o cache do
 * service worker (às vezes salvava uma versão pequena/errada em vez da
 * página real). Guardar só o texto, já limpo, resolve os dois problemas de
 * uma vez — e de quebra atende ao pedido de salvar só o conteúdo do dia,
 * sem os "anexos" (menu de outros dias, anúncios etc.).
 */
export default function LiturgyTextViewer({ onClose }: LiturgyTextViewerProps) {
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedLiturgy | null>(null);

  const loadFromStorage = (): SavedLiturgy | null => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SavedLiturgy) : null;
    } catch {
      return null;
    }
  };

  const fetchAndSave = async () => {
    try {
      const res = await fetch('/api/liturgy');
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
      const record: SavedLiturgy = {
        title: data.title,
        text: data.text,
        source: data.source,
        fetchedAt: data.fetchedAt,
        savedForDate: todayKey()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
      setSaved(record);
      setError(null);
    } catch (err: any) {
      console.error('Erro ao buscar/salvar liturgia:', err);
      throw err;
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      const cached = loadFromStorage();
      if (cached) setSaved(cached);

      // Se já temos o texto de HOJE salvo, não precisa buscar de novo — evita
      // gastar dados/tempo à toa. Se for de outro dia (ou não houver nada
      // salvo ainda) e estivermos online, busca uma versão atualizada.
      const needsRefresh = !cached || cached.savedForDate !== todayKey();
      if (needsRefresh && isOnline) {
        try {
          await fetchAndSave();
        } catch (err: any) {
          if (!cached) setError(err?.message || 'Não foi possível buscar a liturgia de hoje.');
          // Se já tinha algo salvo (de outro dia), mantém mostrando aquilo em
          // vez de deixar a tela vazia por causa de uma falha ao atualizar.
        }
      } else if (!cached && !isOnline) {
        setError('Sem internet e nenhuma liturgia salva ainda. Conecte-se à internet pelo menos uma vez para salvar o texto do dia.');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async () => {
    if (!isOnline) return;
    setRefreshing(true);
    setError(null);
    try {
      await fetchAndSave();
    } catch (err: any) {
      setError(err?.message || 'Não foi possível atualizar a liturgia agora.');
    } finally {
      setRefreshing(false);
    }
  };

  const isStale = saved && saved.savedForDate !== todayKey();

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-100 h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0 gap-3">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-sm truncate">Liturgia Diária</h3>
            {!isOnline && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mt-0.5">
                <WifiOff className="w-3 h-3 shrink-0" />
                Sem internet — mostrando o texto salvo.
              </p>
            )}
            {isOnline && isStale && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mt-0.5">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Texto salvo de outro dia — atualize.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading || !isOnline}
              title={isOnline ? 'Buscar a versão de hoje e salvar' : 'Precisa de internet para atualizar'}
              className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-bold px-2.5 disabled:opacity-40 ${
                saved && !isStale
                  ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {refreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saved && !isStale ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {refreshing ? 'Atualizando...' : saved && !isStale ? 'Salvo de hoje' : 'Salvar de hoje'}
            </button>
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading || !isOnline}
              title="Forçar atualização"
              className="p-2 text-slate-400 hover:text-brand-blue rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-30"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            <a
              href="https://www.catolicoorante.com.br/liturgia_diaria.php"
              target="_blank"
              rel="noreferrer"
              title="Abrir a página original no navegador"
              className="p-2 text-slate-400 hover:text-brand-blue rounded-lg hover:bg-slate-50 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              onClick={onClose}
              title="Fechar"
              className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex justify-center pt-16">
              <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
            </div>
          ) : error && !saved ? (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-5 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-red-700 text-sm font-medium">{error}</p>
                {isOnline && (
                  <button
                    onClick={handleRefresh}
                    className="mt-3 text-xs font-black uppercase tracking-wide text-red-600 hover:text-red-800 transition-colors"
                  >
                    Tentar novamente
                  </button>
                )}
              </div>
            </div>
          ) : saved ? (
            <>
              {error && (
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-5 text-xs text-amber-700 font-medium">
                  {error}
                </div>
              )}
              <h2 className="text-lg font-black text-slate-800 mb-4">{saved.title}</h2>
              <div className="whitespace-pre-wrap text-slate-700 text-sm leading-relaxed">
                {saved.text}
              </div>
              <p className="text-[10px] text-slate-300 mt-8 pt-4 border-t border-slate-50">
                Fonte: Católico Orante — texto extraído em {new Date(saved.fetchedAt).toLocaleString('pt-BR')}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
