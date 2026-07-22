import { useState, useEffect } from 'react';
import { FileText, RefreshCw, Loader2, Calendar, Music, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import PDFImporter from './PDFImporter';
import { UserProfile } from '../types';

interface ImportBatch {
  id: string;
  source_file_name: string;
  storage_path: string | null;
  page_start: number | null;
  page_end: number | null;
  total_pages: number | null;
  song_count: number;
  status: string;
  created_at: string;
  last_reimported_at: string | null;
  chord_book_id: string | null;
}

interface ImportBatchesListProps {
  profile: UserProfile | null;
}

/**
 * Tela "Lotes de Importação": lista cada execução de importação de PDF já
 * feita (arquivo de origem + intervalo de páginas + quantas músicas vieram
 * dali) e permite "Atualizar" um lote — reprocessa o MESMO PDF (baixado de
 * volta do Storage, sem precisar que o usuário o reencontre no computador) e
 * sincroniza as músicas já existentes desse lote em vez de duplicá-las.
 *
 * Depende da migration `migrations/2026_07_import_batches.sql` (tabela
 * `import_batches`, coluna `chords.import_batch_id`, bucket "pdf-imports").
 * Se essa migration ainda não foi rodada no projeto Supabase, a consulta
 * abaixo falha graciosamente e mostra uma mensagem explicando o que rodar.
 */
export default function ImportBatchesList({ profile }: ImportBatchesListProps) {
  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [reimportTarget, setReimportTarget] = useState<{ batch: ImportBatch; file: File } | null>(null);
  const [downloadingBatchId, setDownloadingBatchId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    fetchBatches();
  }, []);

  const fetchBatches = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('import_batches')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Código 42P01 = tabela não existe — ainda não rodaram a migration.
      if ((error as any).code === '42P01') {
        setMigrationMissing(true);
      } else {
        console.error('Erro ao buscar lotes de importação:', error);
      }
      setBatches([]);
    } else {
      setBatches((data as ImportBatch[]) || []);
    }
    setLoading(false);
  };

  const startReimport = async (batch: ImportBatch) => {
    if (!batch.storage_path) {
      setNotification({ type: 'error', message: 'Este lote não tem o PDF original salvo (foi importado antes desta função existir). Reenvie o arquivo manualmente pela importação normal.' });
      return;
    }
    setDownloadingBatchId(batch.id);
    try {
      const { data, error } = await supabase.storage.from('pdf-imports').download(batch.storage_path);
      if (error || !data) throw error || new Error('Download vazio');

      const file = new File([data], batch.source_file_name, { type: 'application/pdf' });
      setReimportTarget({ batch, file });
    } catch (err) {
      console.error('Falha ao baixar PDF do lote:', err);
      setNotification({ type: 'error', message: 'Não foi possível baixar o PDF original deste lote do Storage.' });
    } finally {
      setDownloadingBatchId(null);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="flex items-center gap-1 text-[10px] font-black text-green-600 bg-green-50 px-2 py-0.5 rounded-full uppercase tracking-widest"><CheckCircle2 className="w-3 h-3" /> Completo</span>;
      case 'partial':
        return <span className="flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-widest"><AlertCircle className="w-3 h-3" /> Parcial</span>;
      default:
        return <span className="flex items-center gap-1 text-[10px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-widest"><Clock className="w-3 h-3" /> Processando</span>;
    }
  };

  if (migrationMissing) {
    return (
      <div className="max-w-2xl mx-auto mt-12 bg-white border border-amber-200 rounded-3xl p-8 text-center shadow-sm">
        <AlertCircle className="w-10 h-10 text-amber-500 mx-auto mb-4" />
        <h3 className="font-black text-slate-800 mb-2">Migration pendente</h3>
        <p className="text-sm text-slate-500">
          Para usar "Lotes de Importação" e "Atualizar Lote", rode primeiro o arquivo{' '}
          <code className="bg-slate-100 px-1.5 py-0.5 rounded font-mono text-xs">migrations/2026_07_import_batches.sql</code>{' '}
          no SQL Editor do seu projeto Supabase.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      {notification && (
        <div className={`mb-4 p-4 rounded-2xl text-sm font-bold ${notification.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {notification.message}
        </div>
      )}

      <div className="mb-6">
        <h2 className="text-lg font-black text-brand-blue">Lotes de Importação</h2>
        <p className="text-xs text-slate-400 mt-1">
          Cada importação de PDF vira um lote aqui. Use "Atualizar Lote" para reprocessar o mesmo arquivo — cifras já
          salvas desse lote são atualizadas no lugar, sem duplicar.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center p-16"><Loader2 className="w-8 h-8 animate-spin text-brand-blue" /></div>
      ) : batches.length === 0 ? (
        <div className="text-center p-16 text-slate-400">
          <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nenhum lote de importação ainda. Importe um PDF pela tela de Cifras para começar.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {batches.map(batch => (
            <div key={batch.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 shadow-sm">
              <div className="bg-indigo-50 p-3 rounded-xl shrink-0">
                <FileText className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black text-sm text-slate-800 truncate">{batch.source_file_name}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-400 font-medium">
                  <span className="flex items-center gap-1">
                    <Music className="w-3 h-3" /> {batch.song_count} música{batch.song_count === 1 ? '' : 's'}
                  </span>
                  <span>
                    Páginas {batch.page_start}–{batch.page_end} de {batch.total_pages}
                  </span>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> {new Date(batch.created_at).toLocaleDateString('pt-BR')}
                  </span>
                  {batch.last_reimported_at && (
                    <span className="italic">
                      Atualizado em {new Date(batch.last_reimported_at).toLocaleDateString('pt-BR')}
                    </span>
                  )}
                  {statusBadge(batch.status)}
                </div>
              </div>
              <button
                onClick={() => startReimport(batch)}
                disabled={downloadingBatchId === batch.id}
                className="shrink-0 flex items-center justify-center gap-2 px-4 py-2 bg-brand-orange/10 text-brand-orange rounded-xl font-black text-xs hover:bg-brand-orange hover:text-white transition-all disabled:opacity-50"
              >
                {downloadingBatchId === batch.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Atualizar Lote
              </button>
            </div>
          ))}
        </div>
      )}

      {reimportTarget && (
        <PDFImporter
          onClose={() => setReimportTarget(null)}
          onImportComplete={() => {
            setNotification({ type: 'success', message: `Lote "${reimportTarget.batch.source_file_name}" atualizado com sucesso.` });
            fetchBatches();
          }}
          bookId={reimportTarget.batch.chord_book_id}
          reimportBatchId={reimportTarget.batch.id}
          reimportFile={reimportTarget.file}
        />
      )}
    </div>
  );
}
