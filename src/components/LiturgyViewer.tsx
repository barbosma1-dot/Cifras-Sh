import { useEffect, useState } from 'react';
import { X, ExternalLink, WifiOff, Download, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface LiturgyViewerProps {
  title: string;
  url: string;
  onClose: () => void;
}

const LITURGY_CACHE_NAME = 'liturgia-cache'; // precisa bater com o cacheName em vite.config.ts

/**
 * Mostra uma página litúrgica externa (Liturgia Diária, Orações Eucarísticas
 * etc.) DENTRO do app, num iframe, em vez de abrir em nova aba.
 *
 * Por que isso importa para o "baixar para offline": um link comum
 * (`<a target="_blank">`) navega para outra aba, fora do controle do
 * service worker do nosso app — nada ali passa pelo cache dele, então nunca
 * fica disponível offline, não importa quantas vezes a pessoa acesse. Um
 * iframe carregado DENTRO desta página, porém, é uma sub-requisição feita
 * pelo próprio cliente que o service worker do app já controla — por isso o
 * `runtimeCaching` configurado em vite.config.ts consegue interceptar e
 * guardar essa página (ver regra "liturgia-cache" lá).
 *
 * O botão "Salvar para offline" abaixo NÃO depende do iframe carregar com
 * sucesso: ele dispara um `fetch()` direto para a URL, em modo "no-cors".
 * Isso importa porque alguns sites bloqueiam ser exibidos DENTRO de um
 * iframe (cabeçalho X-Frame-Options/CSP) — nesse caso o iframe nunca mostra
 * nada, mas o `fetch()` ainda consegue buscar e cachear o conteúdo (essa
 * restrição é só sobre RENDERIZAR em iframe, não sobre buscar a URL). Então
 * o botão continua funcionando como forma de "baixar para depois", mesmo
 * que a pré-visualização aqui dentro não apareça — nesse caso, use o
 * botão de abrir no navegador (ícone ao lado do X) para ver o conteúdo.
 */
export default function LiturgyViewer({ title, url, onClose }: LiturgyViewerProps) {
  const isOnline = useOnlineStatus();
  const [saveState, setSaveState] = useState<'idle' | 'checking' | 'saving' | 'saved' | 'error' | 'unsupported'>('checking');

  const checkIfCached = async () => {
    if (!('caches' in window)) {
      setSaveState('unsupported');
      return;
    }
    try {
      const cache = await caches.open(LITURGY_CACHE_NAME);
      const match = await cache.match(url, { ignoreVary: true });
      setSaveState(match ? 'saved' : 'idle');
    } catch {
      setSaveState('idle');
    }
  };

  useEffect(() => {
    checkIfCached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const handleSaveOffline = async () => {
    if (!isOnline) {
      setSaveState('error');
      return;
    }
    setSaveState('saving');
    try {
      // no-cors: aceita resposta "opaca" (não conseguimos ler o conteúdo por
      // causa de CORS, mas o service worker ainda intercepta e guarda a
      // resposta no cache — é exatamente o que a regra `cacheableResponse:
      // { statuses: [0, 200] }` do vite.config.ts está preparada para
      // aceitar). cache: 'reload' força buscar uma cópia nova da rede agora,
      // em vez de aceitar algo que já esteja no cache do navegador comum.
      await fetch(url, { mode: 'no-cors', cache: 'reload' });
      // Dá um instante para o service worker terminar de gravar no Cache
      // Storage antes de checar — a gravação acontece de forma assíncrona
      // dentro do evento 'fetch' do SW.
      await new Promise(resolve => setTimeout(resolve, 400));
      await checkIfCached();
    } catch (err) {
      console.error('Falha ao salvar página litúrgica para offline:', err);
      setSaveState('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-100 h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0 gap-3">
          <div className="min-w-0">
            <h3 className="font-black text-slate-800 text-sm truncate">{title}</h3>
            {!isOnline && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mt-0.5">
                <WifiOff className="w-3 h-3 shrink-0" />
                Sem internet — mostrando a última versão vista, se houver.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSaveOffline}
              disabled={saveState === 'saving' || saveState === 'checking' || saveState === 'unsupported' || (!isOnline && saveState !== 'saved')}
              title={
                saveState === 'saved'
                  ? 'Disponível offline — clique para atualizar a cópia salva'
                  : 'Salvar esta página para uso offline'
              }
              className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-[10px] font-bold px-2.5 disabled:opacity-40 ${
                saveState === 'saved'
                  ? 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                  : saveState === 'error'
                  ? 'bg-red-50 text-red-500 hover:bg-red-100'
                  : 'bg-slate-50 text-slate-500 hover:bg-slate-100'
              }`}
            >
              {saveState === 'saving' || saveState === 'checking' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : saveState === 'saved' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : saveState === 'error' ? (
                <AlertTriangle className="w-3.5 h-3.5" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {saveState === 'saving' && 'Salvando...'}
              {saveState === 'checking' && 'Verificando...'}
              {saveState === 'saved' && 'Salvo offline'}
              {saveState === 'error' && 'Falhou, tentar de novo'}
              {saveState === 'idle' && 'Salvar offline'}
              {saveState === 'unsupported' && 'Sem suporte'}
            </button>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Abrir no navegador"
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

        {saveState === 'idle' && !isOnline && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-[11px] text-amber-700 font-bold">
            Esta página ainda não tem cópia salva. Abra com internet e toque em "Salvar offline" antes de precisar dela sem rede.
          </div>
        )}

        <iframe
          key={url}
          src={url}
          title={title}
          className="flex-1 w-full border-0"
          // Sandbox liberando só o necessário para a página externa funcionar
          // dentro do iframe (scripts/forms comuns em sites de liturgia com
          // navegação por data) sem dar acesso a mais do que isso.
          //
          // Observação: alguns sites recusam ser exibidos dentro de um
          // iframe (cabeçalho X-Frame-Options/CSP) — nesse caso a área
          // abaixo pode aparecer em branco ou com a página de erro do
          // próprio navegador, mesmo estando disponível. Isso não afeta o
          // botão "Salvar offline" acima, que busca a página por fora do
          // iframe; use "Abrir no navegador" (ícone ao lado) para ver o
          // conteúdo nesse caso.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
