import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { MessageSquare, X, Plus, Pencil, Trash2, Loader2, Users, User, LocateFixed, AlertTriangle } from 'lucide-react';
import { useBackButton } from '../hooks/useBackButton';
import {
  buildExcerpt,
  canManageAnnotation,
  createAnnotation,
  deleteAnnotation,
  fetchAnnotations,
  getCachedAnnotations,
  setCachedAnnotations,
  loadAnnotationContext,
  resolveAnchor,
  updateAnnotation,
  type AnnotationContext,
  type AnnotationScope,
  type ChordAnnotation,
  type ResolvedAnchor
} from '../lib/chordAnnotations';

/**
 * Camada "Comentários" da cifra (T5a).
 *
 * Fluxo: menu ⋮ → Comentários → "Novo comentário" → toca na linha (ou em duas,
 * para um intervalo) → escreve título/nota e escolhe "Só eu" ou "Missão".
 * As linhas comentadas ganham uma barra lateral colorida e um selo com a
 * quantidade; tocar no selo abre o comentário.
 *
 * `useChordComments` concentra todo o estado; o ChordViewer só pega o que ele
 * devolve (`decor` para desenhar as linhas, `ui` para as telas, `open` e
 * `count` para o menu).
 */

// ---------------------------------------------------------------------------
// Decoração das linhas (consumida por processContent no ChordViewer)
// ---------------------------------------------------------------------------

export interface LineDecor {
  selectMode: boolean;
  selection: [number, number] | null;
  bars: Map<number, 'user' | 'mission' | 'both'>;
  badges: Map<number, string[]>;
  onLineTap: (line: number) => void;
  onBadgeTap: (ids: string[]) => void;
}

const BAR_CLASS: Record<'user' | 'mission' | 'both', string> = {
  user: 'border-amber-400 bg-amber-50/60',
  mission: 'border-brand-blue bg-sky-50/70',
  both: 'border-violet-500 bg-violet-50/60'
};

/** Envolve uma linha renderizada com marcador/seleção. Sem nada a mostrar, devolve a linha intacta. */
export function wrapLine(el: ReactElement, idx: number, d: LineDecor): ReactElement {
  const bar = d.bars.get(idx);
  const badge = d.badges.get(idx);
  if (!d.selectMode && !bar && !badge) return el;

  const selected = !!d.selection && idx >= d.selection[0] && idx <= d.selection[1];
  const cls = [
    'relative',
    d.selectMode ? 'cursor-pointer rounded-lg -mx-2 px-2 active:bg-brand-orange/10' : '',
    selected ? 'bg-brand-orange/15 ring-1 ring-brand-orange/50 rounded-lg' : '',
    // -ml-3 + pl-2 + borda de 4px = 12px: a letra não se mexe quando o marcador aparece.
    bar && !selected && !d.selectMode ? `border-l-4 -ml-3 pl-2 ${BAR_CLASS[bar]}` : '',
    badge && !d.selectMode ? 'pr-10' : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      key={`ln-${idx}`}
      data-line={idx}
      className={cls}
      onClick={d.selectMode ? () => d.onLineTap(idx) : undefined}
    >
      {el}
      {badge && !d.selectMode && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            d.onBadgeTap(badge);
          }}
          aria-label={`Ver ${badge.length} comentário(s) deste trecho`}
          className="absolute right-0 top-0 flex items-center gap-0.5 rounded-full bg-slate-800 text-white text-[10px] font-bold leading-none px-1.5 py-1 shadow active:opacity-70"
        >
          <MessageSquare className="w-3 h-3" />
          {badge.length}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseChordCommentsOptions {
  chordId: string;
  content: string;
  /** false em link compartilhado (somente leitura / sem login). */
  enabled: boolean;
  /** Chamado ao entrar no modo de seleção (ex.: pausar a auto rolagem). */
  onStartSelect?: () => void;
  notify: (message: string, type: 'success' | 'error') => void;
}

type FormState =
  | { mode: 'new'; start: number; end: number }
  | { mode: 'edit'; annotation: ChordAnnotation }
  | null;

export function useChordComments({ chordId, content, enabled, onStartSelect, notify }: UseChordCommentsOptions) {
  const [ctx, setCtx] = useState<AnnotationContext | null>(null);
  const [list, setList] = useState<ChordAnnotation[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelFilter, setPanelFilter] = useState<string[] | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selection, setSelection] = useState<[number, number] | null>(null);
  const [form, setForm] = useState<FormState>(null);

  const lines = useMemo(() => (content || '').split('\n'), [content]);

  // Atualiza a lista na tela e o cache offline juntos (só em ações do usuário,
  // nunca num efeito: ao trocar de cifra isso gravaria a lista antiga na chave nova).
  const commit = useCallback(
    (updater: (prev: ChordAnnotation[]) => ChordAnnotation[]) => {
      setList(prev => {
        const next = updater(prev);
        if (ctx) setCachedAnnotations(ctx.userId, chordId, next);
        return next;
      });
    },
    [ctx, chordId]
  );

  // Carrega usuário/missões e as anotações da cifra (cache primeiro, rede depois).
  useEffect(() => {
    setList([]);
    setCtx(null);
    setPanelOpen(false);
    setSelectMode(false);
    setSelection(null);
    setForm(null);
    if (!enabled || !chordId) return;

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const c = await loadAnnotationContext();
        if (cancelled || !c) return;
        setCtx(c);
        setList(getCachedAnnotations(c.userId, chordId));
        const res = await fetchAnnotations(c.userId, chordId);
        if (cancelled) return;
        setList(res.list);
        setFromCache(res.fromCache);
      } catch {
        /* sem sessão/rede: a camada simplesmente não aparece */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, chordId]);

  // Onde cada anotação está AGORA (as linhas podem ter mudado se a cifra foi editada).
  const resolved = useMemo(
    () => list.map(a => ({ a, anchor: resolveAnchor(a, lines) as ResolvedAnchor })),
    [list, lines]
  );
  const anchorById = useMemo(() => new Map(resolved.map(r => [r.a.id, r.anchor])), [resolved]);

  const decor = useMemo<LineDecor | null>(() => {
    if (!enabled || !ctx) return null;
    const bars = new Map<number, 'user' | 'mission' | 'both'>();
    const badges = new Map<number, string[]>();
    for (const { a, anchor } of resolved) {
      if (anchor.status === 'lost') continue;
      for (let i = anchor.start; i <= anchor.end; i++) {
        const prev = bars.get(i);
        bars.set(i, prev && prev !== a.scope ? 'both' : a.scope);
      }
      badges.set(anchor.end, [...(badges.get(anchor.end) || []), a.id]);
    }
    return {
      selectMode,
      selection,
      bars,
      badges,
      onLineTap: line => {
        if (!(lines[line] || '').trim()) return; // linha em branco não vira trecho
        setSelection(prev => {
          if (!prev) return [line, line];
          if (prev[0] === prev[1]) return [Math.min(prev[0], line), Math.max(prev[0], line)];
          return [line, line];
        });
      },
      onBadgeTap: ids => {
        setPanelFilter(ids);
        setPanelOpen(true);
      }
    };
  }, [enabled, ctx, resolved, selectMode, selection, lines]);

  const cancelSelect = useCallback(() => {
    setSelectMode(false);
    setSelection(null);
  }, []);
  useBackButton(selectMode, cancelSelect);

  const startSelect = useCallback(() => {
    setPanelOpen(false);
    setPanelFilter(null);
    setSelection(null);
    setSelectMode(true);
    onStartSelect?.();
  }, [onStartSelect]);

  const confirmSelect = () => {
    if (!selection) return;
    setForm({ mode: 'new', start: selection[0], end: selection[1] });
    setSelectMode(false);
    setSelection(null);
  };

  const goToLine = (line: number) => {
    setPanelOpen(false);
    setPanelFilter(null);
    // espera o painel sair da tela antes de rolar
    window.setTimeout(() => {
      document.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  };

  const available = enabled && !!ctx;

  const ui: ReactNode = available ? (
    <>
      {panelOpen && (
        <CommentsPanel
          ctx={ctx!}
          items={resolved}
          filter={panelFilter}
          fromCache={fromCache}
          loading={loading}
          onClearFilter={() => setPanelFilter(null)}
          onClose={() => {
            setPanelOpen(false);
            setPanelFilter(null);
          }}
          onNew={startSelect}
          onGo={goToLine}
          onEdit={a => setForm({ mode: 'edit', annotation: a })}
          onDelete={async a => {
            try {
              await deleteAnnotation(a.id);
              commit(prev => prev.filter(x => x.id !== a.id));
              notify('Comentário apagado.', 'success');
            } catch {
              notify('Não foi possível apagar. Verifique a conexão.', 'error');
            }
          }}
        />
      )}

      {selectMode && <SelectionBar selection={selection} onCancel={cancelSelect} onConfirm={confirmSelect} />}

      {form && (
        <CommentForm
          ctx={ctx!}
          form={form}
          lines={lines}
          chordId={chordId}
          anchor={form.mode === 'edit' ? anchorById.get(form.annotation.id) : undefined}
          onClose={() => setForm(null)}
          onSaved={(saved, isNew) => {
            commit(prev => (isNew ? [...prev, saved] : prev.map(x => (x.id === saved.id ? saved : x))));
            setForm(null);
            notify(isNew ? 'Comentário salvo.' : 'Comentário atualizado.', 'success');
          }}
        />
      )}
    </>
  ) : null;

  return {
    available,
    count: list.length,
    selectMode,
    decor,
    ui,
    open: () => {
      setPanelFilter(null);
      setPanelOpen(true);
    }
  };
}

// ---------------------------------------------------------------------------
// Barra de seleção do trecho
// ---------------------------------------------------------------------------

function SelectionBar({
  selection,
  onCancel,
  onConfirm
}: {
  selection: [number, number] | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const hint = !selection
    ? 'Toque na linha do trecho'
    : selection[0] === selection[1]
      ? 'Linha marcada. Toque em outra para ampliar o trecho'
      : `Trecho de ${selection[1] - selection[0] + 1} linhas marcado. Toque numa linha para recomeçar`;

  return (
    <div className="fixed left-3 right-3 bottom-20 z-[65] mx-auto max-w-md rounded-2xl bg-slate-900 text-white shadow-2xl p-3">
      <p className="text-sm font-semibold text-center px-2">{hint}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="py-2.5 rounded-xl bg-white/10 font-bold text-sm active:opacity-70">
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={!selection}
          className="py-2.5 rounded-xl bg-brand-orange font-bold text-sm disabled:opacity-40 active:opacity-70"
        >
          Continuar
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel (lista)
// ---------------------------------------------------------------------------

function ScopeChip({ a, ctx }: { a: ChordAnnotation; ctx: AnnotationContext }) {
  if (a.scope === 'user') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
        <User className="w-3 h-3" /> Só eu
      </span>
    );
  }
  const name = ctx.missions.find(m => m.id === a.mission_id)?.name || 'Missão';
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wide bg-sky-100 text-sky-800 rounded-full px-2 py-0.5 max-w-full">
      <Users className="w-3 h-3 shrink-0" /> <span className="truncate">{name}</span>
    </span>
  );
}

function CommentsPanel({
  ctx,
  items,
  filter,
  fromCache,
  loading,
  onClearFilter,
  onClose,
  onNew,
  onGo,
  onEdit,
  onDelete
}: {
  ctx: AnnotationContext;
  items: { a: ChordAnnotation; anchor: ResolvedAnchor }[];
  filter: string[] | null;
  fromCache: boolean;
  loading: boolean;
  onClearFilter: () => void;
  onClose: () => void;
  onNew: () => void;
  onGo: (line: number) => void;
  onEdit: (a: ChordAnnotation) => void;
  onDelete: (a: ChordAnnotation) => Promise<void>;
}) {
  useBackButton(true, onClose);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const shown = filter ? items.filter(i => filter.includes(i.a.id)) : items;

  return (
    <div className="fixed inset-0 z-[175] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Comentários da cifra"
        className="bg-white text-slate-800 w-full sm:max-w-md max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h3 className="text-lg font-black flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-brand-orange" /> Comentários
          </h3>
          <button onClick={onClose} aria-label="Fechar" className="p-2 -mr-2 rounded-full text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 pb-3">
          <button
            onClick={onNew}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-brand-orange text-white font-bold text-sm active:opacity-80"
          >
            <Plus className="w-4 h-4" /> Novo comentário
          </button>
          {fromCache && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              Sem conexão: mostrando a última cópia salva. Para criar ou editar é preciso estar online.
            </p>
          )}
        </div>

        {filter && (
          <div className="px-5 pb-2">
            <button onClick={onClearFilter} className="text-xs font-bold text-brand-blue underline underline-offset-2">
              Ver todos os comentários da cifra
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-blue" />
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Nenhum comentário nesta cifra ainda.</p>
          ) : (
            shown.map(({ a, anchor }) => {
              const manage = canManageAnnotation(a, ctx);
              return (
                <div key={a.id} className="rounded-2xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-bold text-slate-800 break-words min-w-0">{a.title}</p>
                    <ScopeChip a={a} ctx={ctx} />
                  </div>

                  {a.excerpt && (
                    <p className="mt-1.5 text-xs italic text-slate-500 border-l-2 border-slate-200 pl-2 line-clamp-3">{a.excerpt}</p>
                  )}
                  {a.body && <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap break-words">{a.body}</p>}

                  {anchor.status === 'lost' && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      O trecho foi alterado na cifra e não foi encontrado. O comentário continua salvo.
                    </p>
                  )}

                  <div className="mt-2 flex items-center gap-1 flex-wrap">
                    {anchor.status !== 'lost' && (
                      <button
                        onClick={() => onGo(anchor.start)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600 active:opacity-70"
                      >
                        <LocateFixed className="w-3.5 h-3.5" /> Ir ao trecho
                      </button>
                    )}
                    {manage && (
                      <>
                        <button
                          onClick={() => onEdit(a)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-600 active:opacity-70"
                        >
                          <Pencil className="w-3.5 h-3.5" /> Editar
                        </button>
                        {confirmId === a.id ? (
                          <button
                            disabled={busyId === a.id}
                            onClick={async () => {
                              setBusyId(a.id);
                              await onDelete(a);
                              setBusyId(null);
                              setConfirmId(null);
                            }}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500 text-xs font-bold text-white active:opacity-70 disabled:opacity-60"
                          >
                            {busyId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Confirmar
                          </button>
                        ) : (
                          <button
                            onClick={() => setConfirmId(a.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-red-600 active:opacity-70"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Apagar
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formulário (novo / editar)
// ---------------------------------------------------------------------------

function CommentForm({
  ctx,
  form,
  lines,
  chordId,
  anchor,
  onClose,
  onSaved
}: {
  ctx: AnnotationContext;
  form: Exclude<FormState, null>;
  lines: string[];
  chordId: string;
  anchor?: ResolvedAnchor;
  onClose: () => void;
  onSaved: (saved: ChordAnnotation, isNew: boolean) => void;
}) {
  useBackButton(true, onClose);

  const editing = form.mode === 'edit' ? form.annotation : null;
  const writableMissions = ctx.missions.filter(m => m.canWrite);

  const [title, setTitle] = useState(editing?.title || '');
  const [body, setBody] = useState(editing?.body || '');
  const [scope, setScope] = useState<AnnotationScope>(editing?.scope || 'user');
  const [missionId, setMissionId] = useState<string>(editing?.mission_id || writableMissions[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const start = form.mode === 'new' ? form.start : anchor?.start ?? form.annotation.line_start;
  const end = form.mode === 'new' ? form.end : anchor?.end ?? form.annotation.line_end;
  const excerpt = editing ? editing.excerpt : buildExcerpt(lines, start, end);

  const missionChoiceOk = scope === 'user' || (!!missionId && writableMissions.some(m => m.id === missionId));
  const canSave = title.trim().length > 0 && missionChoiceOk && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      const mission_id = scope === 'mission' ? missionId : null;
      if (editing) {
        const saved = await updateAnnotation(editing.id, { title, body, scope, mission_id });
        onSaved(saved, false);
      } else {
        const saved = await createAnnotation(ctx.userId, {
          chord_id: chordId,
          scope,
          mission_id,
          title,
          body,
          line_start: start,
          line_end: end,
          excerpt
        });
        onSaved(saved, true);
      }
    } catch (e: any) {
      const msg = String(e?.message || '');
      setError(
        /row-level security|permission/i.test(msg)
          ? 'Sem permissão para salvar nesse escopo.'
          : /does not exist|schema cache/i.test(msg)
            ? 'A tabela de comentários ainda não existe no banco (rodar a migração T5A).'
            : 'Não foi possível salvar. Verifique a conexão e tente de novo.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[185] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Editar comentário' : 'Novo comentário'}
        className="bg-white text-slate-800 w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-black">{editing ? 'Editar comentário' : 'Novo comentário'}</h3>
          <button onClick={onClose} aria-label="Fechar" className="p-2 -mr-2 rounded-full text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {excerpt ? (
          <p className="mt-3 text-xs italic text-slate-500 border-l-2 border-brand-orange pl-2 line-clamp-4">{excerpt}</p>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Trecho sem letra (apenas acordes).</p>
        )}

        <label className="block mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Título</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          maxLength={120}
          placeholder="Ex.: Entrada em coro, só violão…"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-orange"
        />

        <label className="block mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Nota (opcional)</label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Detalhes para quem for tocar ou cantar"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-orange resize-none"
        />

        <label className="block mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Quem vê</label>
        <div className="mt-1 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl" role="tablist">
          <button
            role="tab"
            aria-selected={scope === 'user'}
            onClick={() => setScope('user')}
            className={`py-2 rounded-lg text-sm font-bold ${scope === 'user' ? 'bg-white text-brand-orange shadow-sm' : 'text-slate-500'}`}
          >
            Só eu
          </button>
          <button
            role="tab"
            aria-selected={scope === 'mission'}
            onClick={() => writableMissions.length > 0 && setScope('mission')}
            disabled={writableMissions.length === 0}
            className={`py-2 rounded-lg text-sm font-bold disabled:opacity-40 ${
              scope === 'mission' ? 'bg-white text-brand-blue shadow-sm' : 'text-slate-500'
            }`}
          >
            Missão
          </button>
        </div>

        {writableMissions.length === 0 && (
          <p className="mt-2 text-xs text-slate-400">
            Comentários da missão só podem ser criados por coordenador ou editor.
          </p>
        )}

        {scope === 'mission' && writableMissions.length > 0 && (
          writableMissions.length === 1 ? (
            <p className="mt-2 text-xs text-slate-500">
              Visível para todos de <span className="font-bold">{writableMissions[0].name}</span>.
            </p>
          ) : (
            <select
              value={missionId}
              onChange={e => setMissionId(e.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold bg-white"
            >
              {writableMissions.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          )
        )}

        {error && <p className="mt-3 text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onClose} className="py-3 rounded-xl bg-slate-100 text-slate-600 font-bold text-sm">
            Cancelar
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="py-3 rounded-xl bg-brand-orange text-white font-bold text-sm disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
