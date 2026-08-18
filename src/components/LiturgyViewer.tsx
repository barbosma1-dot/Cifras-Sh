import { X, ExternalLink, WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

interface LiturgyViewerProps {
  title: string;
  url: string;
  onClose: () => void;
}

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
 * guardar essa página (ver regra "liturgia-cache" lá). Na prática: a
 * primeira vez que a pessoa abre com internet, o service worker guarda uma
 * cópia; da próxima vez, mesmo offline, essa última cópia vista aparece
 * aqui dentro do app.
 */
export default function LiturgyViewer({ title, url, onClose }: LiturgyViewerProps) {
  const isOnline = useOnlineStatus();

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl border border-slate-100 h-[90vh] sm:h-[85vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="font-black text-slate-800 text-sm">{title}</h3>
            {!isOnline && (
              <p className="flex items-center gap-1 text-[10px] font-bold text-amber-600 mt-0.5">
                <WifiOff className="w-3 h-3" />
                Sem internet — mostrando a última versão vista, se houver.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
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

        <iframe
          key={url}
          src={url}
          title={title}
          className="flex-1 w-full border-0"
          // Sandbox liberando só o necessário para a página externa funcionar
          // dentro do iframe (scripts/forms comuns em sites de liturgia com
          // navegação por data) sem dar acesso a mais do que isso.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
