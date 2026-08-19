import { useEffect, useState } from 'react';
import { X, ExternalLink, WifiOff, Download, CheckCircle2, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface LiturgyTextViewerProps {
  onClose: () => void;
  // Data (AAAA-MM-DD) da liturgia a mostrar/salvar. Se omitido, usa hoje —
  // mantém o comportamento antigo pra quem abre sem vir de um repertório
  // com data específica.
  date?: string;
}

const STORAGE_PREFIX = 'liturgia-diaria-texto-salvo';

interface SavedLiturgy {
  title: string;
  text: string;
  source: string;
  fetchedAt: string;
  requestedDate: string | null;
  resolvedDate: string | null;
  dateMismatch?: boolean;
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Cada data vira uma chave própria de localStorage — assim salvar a liturgia
// do dia de um repertório futuro não sobrescreve a de "hoje" (ou de outro
// repertório), e várias datas podem ficar guardadas offline ao mesmo tempo.
function storageKeyFor(dateKey: string): string {
  return `${STORAGE_PREFIX}:${dateKey}`;
}

/** Busca (se online) e guarda em localStorage a liturgia de uma data específica. Usada tanto pelo visualizador quanto para salvar em segundo plano ao abrir um repertório. */
export async function fetchAndSaveLiturgy(dateKey: string): Promise<SavedLiturgy> {
  const res = await fetch(`/api/liturgy?date=${dateKey}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `Erro ${res.status}`);
  const record: SavedLiturgy = {
    title: data.title,
    text: data.text,
    source: data.source,
    fetchedAt: data.fetchedAt,
    requestedDate: data.requestedDate,
    resolvedDate: data.resolvedDate,
    dateMismatch: data.dateMismatch,
  };
  localStorage.setItem(storageKeyFor(dateKey), JSON.stringify(record));
  return record;
}

export function loadSavedLiturgy(dateKey: string): SavedLiturgy | null {
  try {
    const raw = localStorage.getItem(storageKeyFor(dateKey));
    return raw ? (JSON.parse(raw) as SavedLiturgy) : null;
  } catch {
    return null;
  }
}

/**
 * Mostra a Liturgia Diária como TEXTO LIMPO (sem anúncios, sem navegação
 * para outros dias) de uma DATA ESPECÍFICA — por padrão hoje, mas pode ser a
 * data de um repertório (passado ou futuro). Buscado e filtrado no servidor
 * (functions/api/liturgy.ts) e guardado em localStorage, por data.
 */
export default function LiturgyTextViewer({ onClose, date }: LiturgyTextViewerProps) {
  const dateKey = date || todayKey();
  const isToday = dateKey === todayKey();
  const isOnline = useOnlineStatus();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedLiturgy | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const cached = loadSavedLiturgy(dateKey);
      if (cached) setSaved(cached);

      // Já temos essa data salva -> não busca de novo à toa (dias passados
      // não mudam; hoje já buscamos uma vez). Só refaz se não tiver nada
      // salvo ainda e estivermos online.
      if (!cached && isOnline) {
        try {
          const record = await fetchAndSaveLiturgy(dateKey);
          setSaved(record);
        } catch (err: any) {
          setError(err?.message || 'Não foi possível buscar a liturgia desta data.');
        }
      } else if (!cached && !isOnline) {
        setError('Sem internet e nenhuma liturgia salva para esta data ainda. Conecte-se à internet pelo menos uma vez para salvar o texto.');
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  const handleRefresh = async () => {
    if (!isOnline) return;
    setRefreshing(true);
    setError(null);
    try {
      const record = await fetchAndSaveLiturgy(dateKey);
      setSaved(record);
    } catch (err: any) {
      setError(err?.message || 'Não foi possível atualizar a liturgia agora.');
    } finally {
      setRefreshing(false);
    }
  };

  const dateLabel = new Date(dateKey + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-100 h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0 gap-3">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-sm truncate">
              Liturgia Diária {!isToday && <span className="font-bold text-slate-400">— {dateLabel}</span>}
            </h3>
            {!isOnline && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mt-0.5">
                <WifiOff className="w-3 h-3 shrink-0" />
                Sem internet — mostrando o texto salvo.
              </p>
            )}
            {saved?.dateMismatch && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mt-0.5">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                O site mostrou outra data — pode não ser exatamente {dateLabel}.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading || !isOnline}
              title={isOnline ? 'Buscar e salvar novamente' : 'Precisa de internet para atualizar'}
              className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-bold px-2.5 disabled:opacity-40 ${
                saved && !saved.dateMismatch
                  ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {refreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saved && !saved.dateMismatch ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {refreshing ? 'Atualizando...' : saved && !saved.dateMismatch ? 'Salvo offline' : 'Salvar offline'}
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
              href={`https://sagradaliturgia.com.br/liturgia_diaria.php?date=${dateKey}`}
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
                Fonte: Sagrada Liturgia — texto extraído em {new Date(saved.fetchedAt).toLocaleString('pt-BR')}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
