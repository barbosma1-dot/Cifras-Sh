import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { MessageSquare, X, Plus, Pencil, Trash2, Loader2, LocateFixed, AlertTriangle, Eye, EyeOff } from 'lucide-react';
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
import { VOICES, readVoicePayload, type VoiceId, type VoiceMark } from '../lib/voiceDivision';
import { ScopeChip, ScopePicker } from './AnnotationParts';
import { VoiceAltLyrics, VoiceChips, VoiceForm, VoicePanel, type VoiceFormState } from './ChordVoices';
import {
  isInSelection,
  lastLineOf,
  readSel,
  spansFromSelection,
  spansOnLines,
  type CommentSpanOnLine,
  type LineSpan,
  type SylDecor,
  type SylPos,
  type VoiceSpanOnLine
} from '../lib/annotationSpans';

/**
 * Camada "Comentários" da cifra (T5a).
 *
 * Fluxo: menu ⋮ → Comentários → "Novo comentário" → toca na PRIMEIRA sílaba e
 * depois na ÚLTIMA sílaba do trecho → escreve título/nota e escolhe "Só eu"
 * ou "Missão". As sílabas comentadas ficam sublinhadas (ondulado) e o texto do
 * comentário aparece logo abaixo da linha, com um botão para ocultar (por
 * comentário e, na barra do rodapé, todos de uma vez).
 *
 * `useChordComments` concentra todo o estado; o ChordViewer só pega o que ele
 * devolve (`decor` para desenhar as linhas, `ui` para as telas, `open` e
 * `count` para o menu).
 *
 * T5b: o mesmo hook também cuida da "Divisão de voz" (`kind = 'voice'`),
 * que reaproveita contexto do usuário, seleção de trecho e decoração das linhas.
 */

// ---------------------------------------------------------------------------
// Decoração das linhas (consumida por processContent no ChordViewer)
// ---------------------------------------------------------------------------

export interface NoteView {
  id: string;
  title: string;
  body: string;
  scope: 'user' | 'mission';
  /** true = o texto está recolhido (só o botão pequeno aparece). */
  collapsed: boolean;
}

export interface LineDecor {
  selectMode: boolean;
  /** Marca-texto, sublinhado e seleção sílaba por sílaba (ver LyricSpans.tsx). */
  syl: SylDecor;
  /** Comentários a mostrar logo abaixo da linha em que terminam. */
  notes: Map<number, NoteView[]>;
  onNoteHide: (id: string) => void;
  onNoteShow: (id: string) => void;
  onNoteEdit: (id: string) => void;
  /** Letra própria de cada voz (só na última linha do trecho; já filtrada por chips/foco). */
  voices: Map<number, VoiceMark[]>;
  /** Linhas a esmaecer no modo foco; null = nenhuma. */
  dim: Set<number> | null;
}

const NOTE_CLASS: Record<'user' | 'mission', string> = {
  user: 'border-amber-400 bg-amber-50',
  mission: 'border-brand-blue bg-sky-50'
};

function NoteCard({ n, d }: { n: NoteView; d: LineDecor }) {
  if (n.collapsed) {
    return (
      <button
        type="button"
        onClick={() => d.onNoteShow(n.id)}
        aria-label={`Mostrar comentário: ${n.title}`}
        className="mt-1 mb-1 mr-1 inline-flex max-w-full items-center gap-1 rounded-full bg-slate-800 text-white text-[10px] font-bold leading-none px-2 py-1.5 shadow active:opacity-70"
      >
        <MessageSquare className="w-3 h-3 shrink-0" />
        <span className="truncate">{n.title || 'Comentário'}</span>
        <Eye className="w-3 h-3 shrink-0 opacity-70" />
      </button>
    );
  }
  return (
    <div className={`mt-1 mb-2 rounded-xl border-l-4 px-2.5 py-1.5 text-[0.82em] leading-snug text-slate-800 ${NOTE_CLASS[n.scope]}`}>
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {n.title && <p className="font-black break-words">{n.title}</p>}
          {n.body && <p className="whitespace-pre-wrap break-words">{n.body}</p>}
        </div>
        <button
          type="button"
          onClick={() => d.onNoteEdit(n.id)}
          aria-label="Abrir comentário no painel"
          className="shrink-0 p-1 -mt-0.5 rounded-full text-slate-400 active:bg-black/10"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => d.onNoteHide(n.id)}
          aria-label="Ocultar este comentário"
          className="shrink-0 p-1 -mt-0.5 -mr-1 rounded-full text-slate-500 active:bg-black/10"
        >
          <EyeOff className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Envolve uma linha renderizada com as notas/letra de voz. Sem nada a mostrar, devolve a linha intacta. */
export function wrapLine(el: ReactElement, idx: number, d: LineDecor): ReactElement {
  const notes = !d.selectMode ? d.notes.get(idx) : undefined;
  const voiceMarks = !d.selectMode ? d.voices.get(idx) : undefined;
  const dimmed = !!d.dim && d.dim.has(idx) && !d.selectMode;
  const marked = d.syl.voice.has(idx) || d.syl.comment.has(idx);
  if (!notes && !voiceMarks && !dimmed && !marked) return el;

  return (
    <div key={`ln-${idx}`} data-line={idx} className={dimmed ? 'relative opacity-30' : 'relative'}>
      {el}
      {voiceMarks && <VoiceAltLyrics marks={voiceMarks} />}
      {notes && notes.map(n => <NoteCard key={n.id} n={n} d={d} />)}
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
  | { mode: 'new'; start: number; end: number; spans: LineSpan[]; sel: string }
  | { mode: 'edit'; annotation: ChordAnnotation }
  | null;

const HIDDEN_VOICES_KEY = 'chord_voice_hidden';

function loadHiddenVoices(): Set<VoiceId> {
  try {
    const raw = JSON.parse(localStorage.getItem(HIDDEN_VOICES_KEY) || '[]');
    const valid = new Set<string>(VOICES.map(v => v.id));
    return new Set((Array.isArray(raw) ? raw : []).filter((x: unknown) => typeof x === 'string' && valid.has(x)) as VoiceId[]);
  } catch {
    return new Set();
  }
}

const COMMENTS_SHOWN_KEY = 'chord_comments_shown';
const COMMENTS_COLLAPSED_KEY = 'chord_comments_collapsed';

function loadCommentsShown(): boolean {
  try {
    return localStorage.getItem(COMMENTS_SHOWN_KEY) !== '0';
  } catch {
    return true;
  }
}

function loadCollapsedNotes(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COMMENTS_COLLAPSED_KEY) || '[]');
    return new Set((Array.isArray(raw) ? raw : []).filter((x: unknown) => typeof x === 'string') as string[]);
  } catch {
    return new Set();
  }
}

function saveCollapsedNotes(set: Set<string>) {
  try {
    localStorage.setItem(COMMENTS_COLLAPSED_KEY, JSON.stringify([...set]));
  } catch {
    /* ignora */
  }
}

function saveHiddenVoices(set: Set<VoiceId>) {
  try {
    localStorage.setItem(HIDDEN_VOICES_KEY, JSON.stringify([...set]));
  } catch {
    /* ignora */
  }
}

export function useChordComments({ chordId, content, enabled, onStartSelect, notify }: UseChordCommentsOptions) {
  const [ctx, setCtx] = useState<AnnotationContext | null>(null);
  const [list, setList] = useState<ChordAnnotation[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelFilter, setPanelFilter] = useState<string[] | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  // seleção sílaba por sílaba: primeira e última sílaba tocadas
  const [sylA, setSylA] = useState<SylPos | null>(null);
  const [sylB, setSylB] = useState<SylPos | null>(null);
  const [commentsShown, setCommentsShown] = useState<boolean>(loadCommentsShown);
  const [collapsedNotes, setCollapsedNotes] = useState<Set<string>>(loadCollapsedNotes);
  const [form, setForm] = useState<FormState>(null);

  // T5b — divisão de voz
  const [voiceList, setVoiceList] = useState<ChordAnnotation[]>([]);
  const [voiceFromCache, setVoiceFromCache] = useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [voiceForm, setVoiceForm] = useState<VoiceFormState | null>(null);
  const [selectPurpose, setSelectPurpose] = useState<'comment' | 'voice'>('comment');
  const [hiddenVoices, setHiddenVoices] = useState<Set<VoiceId>>(loadHiddenVoices);
  const [focusMode, setFocusMode] = useState(false);
  const [focusVoice, setFocusVoice] = useState<VoiceId | null>(null);

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

  const commitVoice = useCallback(
    (updater: (prev: ChordAnnotation[]) => ChordAnnotation[]) => {
      setVoiceList(prev => {
        const next = updater(prev);
        if (ctx) setCachedAnnotations(ctx.userId, chordId, next, 'voice');
        return next;
      });
    },
    [ctx, chordId]
  );

  // Carrega usuário/missões e as anotações da cifra (cache primeiro, rede depois).
  useEffect(() => {
    setList([]);
    setVoiceList([]);
    setCtx(null);
    setPanelOpen(false);
    setVoicePanelOpen(false);
    setVoiceForm(null);
    setFocusMode(false);
    setSelectMode(false);
    setSylA(null);
    setSylB(null);
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
        setVoiceList(getCachedAnnotations(c.userId, chordId, 'voice'));
        const [res, vres] = await Promise.all([
          fetchAnnotations(c.userId, chordId),
          fetchAnnotations(c.userId, chordId, 'voice')
        ]);
        if (cancelled) return;
        setList(res.list);
        setFromCache(res.fromCache);
        setVoiceList(vres.list);
        setVoiceFromCache(vres.fromCache);
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

  const voiceResolved = useMemo(
    () => voiceList.map(a => ({ a, anchor: resolveAnchor(a, lines) as ResolvedAnchor })),
    [voiceList, lines]
  );
  const voiceAnchorById = useMemo(() => new Map(voiceResolved.map(r => [r.a.id, r.anchor])), [voiceResolved]);

  // Marca-texto das vozes por linha, já respeitando chips (liga/desliga) e modo foco.
  const voiceView = useMemo(() => {
    const parsed = voiceResolved
      .filter(r => r.anchor.status !== 'lost')
      .map(r => ({ ...r, pv: readVoicePayload(r.a.payload) }))
      .filter(r => r.pv.voice);
    const present = VOICES.map(v => v.id).filter(id => parsed.some(r => r.pv.voice === id));
    const focusActive = focusMode && focusVoice && present.includes(focusVoice) ? focusVoice : null;

    const spans = new Map<number, VoiceSpanOnLine[]>();
    const marks = new Map<number, VoiceMark[]>(); // letra própria da voz, na última linha
    const focusLines = new Set<number>();
    for (const r of parsed) {
      const id = r.pv.voice as VoiceId;
      const visible = focusActive ? id === focusActive : !hiddenVoices.has(id);
      if (!visible) continue;
      for (const sp of spansOnLines(r.a.payload, r.anchor.start, r.anchor.end)) {
        focusLines.add(sp.line);
        spans.set(sp.line, [...(spans.get(sp.line) || []), { id: r.a.id, voice: id, from: sp.from, to: sp.to }]);
      }
      if (r.pv.text) {
        const last = lastLineOf(r.a.payload, r.anchor.start, r.anchor.end);
        marks.set(last, [...(marks.get(last) || []), { id: r.a.id, voice: id, first: true, last: true, text: r.pv.text }]);
      }
    }
    // Empilha sempre na mesma ordem dos chips.
    const order = new Map(VOICES.map((v, i) => [v.id, i]));
    marks.forEach(list => list.sort((x, y) => (order.get(x.voice) ?? 0) - (order.get(y.voice) ?? 0)));

    let dim: Set<number> | null = null;
    if (focusActive) {
      dim = new Set<number>();
      for (let i = 0; i < lines.length; i++) if (!focusLines.has(i)) dim.add(i);
    }
    return { present, spans, marks, dim, focusActive };
  }, [voiceResolved, hiddenVoices, focusMode, focusVoice, lines]);

  const toggleVoice = (id: VoiceId) => {
    setHiddenVoices(prev => {
      const next = new Set<VoiceId>(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveHiddenVoices(next);
      return next;
    });
  };
  const toggleFocusMode = () => {
    setFocusMode(on => {
      if (!on && (!focusVoice || !voiceView.present.includes(focusVoice))) setFocusVoice(voiceView.present[0] ?? null);
      return !on;
    });
  };

  // Seleção em andamento (primeira/última sílaba) já convertida em trecho por linha.
  const selection = useMemo(() => (sylA ? spansFromSelection(lines, sylA, sylB) : null), [sylA, sylB, lines]);

  // Comentários vivos (trecho encontrado) — para sublinhado, notas e contagem.
  const liveComments = useMemo(() => resolved.filter(r => r.anchor.status !== 'lost'), [resolved]);

  const hideNote = useCallback((id: string) => {
    setCollapsedNotes(prev => {
      const next = new Set<string>(prev);
      next.add(id);
      saveCollapsedNotes(next);
      return next;
    });
  }, []);
  const showNote = useCallback((id: string) => {
    setCollapsedNotes(prev => {
      const next = new Set<string>(prev);
      next.delete(id);
      saveCollapsedNotes(next);
      return next;
    });
  }, []);
  const toggleCommentsShown = () => {
    setCommentsShown(on => {
      try {
        localStorage.setItem(COMMENTS_SHOWN_KEY, on ? '0' : '1');
      } catch {
        /* ignora */
      }
      return !on;
    });
  };

  const decor = useMemo<LineDecor | null>(() => {
    if (!enabled || !ctx) return null;
    const commentSpans = new Map<number, CommentSpanOnLine[]>();
    const notes = new Map<number, NoteView[]>();
    if (commentsShown) {
      for (const { a, anchor } of liveComments) {
        for (const sp of spansOnLines(a.payload, anchor.start, anchor.end)) {
          commentSpans.set(sp.line, [...(commentSpans.get(sp.line) || []), { id: a.id, scope: a.scope, from: sp.from, to: sp.to }]);
        }
        const last = lastLineOf(a.payload, anchor.start, anchor.end);
        notes.set(last, [
          ...(notes.get(last) || []),
          { id: a.id, title: a.title || '', body: a.body || '', scope: a.scope, collapsed: collapsedNotes.has(a.id) }
        ]);
      }
    }
    const syl: SylDecor = {
      selectMode,
      isSelected: (line, from, to) => isInSelection(line, from, to, sylA, sylB),
      onTap: (line, from, to) => {
        const pos = { line, from, to };
        if (!sylA || sylB) {
          setSylA(pos);
          setSylB(null);
        } else {
          setSylB(pos);
        }
      },
      voice: voiceView.spans,
      comment: commentSpans
    };
    return {
      selectMode,
      syl,
      notes,
      onNoteHide: hideNote,
      onNoteShow: showNote,
      onNoteEdit: id => {
        setPanelFilter([id]);
        setPanelOpen(true);
      },
      voices: voiceView.marks,
      dim: voiceView.dim
    };
  }, [enabled, ctx, liveComments, commentsShown, collapsedNotes, selectMode, sylA, sylB, voiceView, hideNote, showNote]);

  const cancelSelect = useCallback(() => {
    setSelectMode(false);
    setSylA(null);
    setSylB(null);
  }, []);
  useBackButton(selectMode, cancelSelect);

  const startSelect = useCallback(
    (purpose: 'comment' | 'voice') => {
    setPanelOpen(false);
    setVoicePanelOpen(false);
    setPanelFilter(null);
    setSelectPurpose(purpose);
    setSylA(null);
    setSylB(null);
    setSelectMode(true);
    onStartSelect?.();
    },
    [onStartSelect]
  );

  const confirmSelect = () => {
    if (!selection) return;
    const base = { mode: 'new' as const, start: selection.lineStart, end: selection.lineEnd, spans: selection.spans, sel: selection.sel };
    if (selectPurpose === 'voice') setVoiceForm(base);
    else setForm(base);
    setSelectMode(false);
    setSylA(null);
    setSylB(null);
  };

  const goToLine = (line: number) => {
    setPanelOpen(false);
    setVoicePanelOpen(false);
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
          onNew={() => startSelect('comment')}
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

      {voicePanelOpen && (
        <VoicePanel
          ctx={ctx!}
          items={voiceResolved}
          fromCache={voiceFromCache}
          loading={loading}
          onClose={() => setVoicePanelOpen(false)}
          onNew={() => startSelect('voice')}
          onGo={goToLine}
          onEdit={a => setVoiceForm({ mode: 'edit', annotation: a })}
          onDelete={async a => {
            try {
              await deleteAnnotation(a.id);
              commitVoice(prev => prev.filter(x => x.id !== a.id));
              notify('Divisão de voz apagada.', 'success');
            } catch {
              notify('Não foi possível apagar. Verifique a conexão.', 'error');
            }
          }}
        />
      )}

      {voiceForm && (
        <VoiceForm
          ctx={ctx!}
          form={voiceForm}
          lines={lines}
          chordId={chordId}
          anchor={voiceForm.mode === 'edit' ? voiceAnchorById.get(voiceForm.annotation.id) : undefined}
          onClose={() => setVoiceForm(null)}
          onSaved={(saved, isNew) => {
            commitVoice(prev => (isNew ? [...prev, saved] : prev.map(x => (x.id === saved.id ? saved : x))));
            setVoiceForm(null);
            notify(isNew ? 'Divisão de voz salva.' : 'Divisão de voz atualizada.', 'success');
          }}
        />
      )}

      {(voiceView.present.length > 0 || liveComments.length > 0) && !selectMode && (
        <VoiceChips
          comments={
            liveComments.length > 0
              ? { count: liveComments.length, shown: commentsShown, onToggle: toggleCommentsShown }
              : undefined
          }
          present={voiceView.present}
          hidden={hiddenVoices}
          focusMode={!!voiceView.focusActive}
          focus={voiceView.focusActive}
          onToggle={toggleVoice}
          onFocusMode={toggleFocusMode}
          onPickFocus={setFocusVoice}
        />
      )}

      {selectMode && <SelectionBar stage={!sylA ? 0 : sylB ? 2 : 1} onCancel={cancelSelect} onConfirm={confirmSelect} />}

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
    voiceCount: voiceList.length,
    /** true quando a barra de chips de voz está na tela (o viewer abre espaço no rodapé). */
    voiceChipsVisible: available && (voiceView.present.length > 0 || liveComments.length > 0) && !selectMode,
    openVoices: () => setVoicePanelOpen(true),
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

function SelectionBar({ stage, onCancel, onConfirm }: { stage: 0 | 1 | 2; onCancel: () => void; onConfirm: () => void }) {
  const hint =
    stage === 0
      ? 'Toque na PRIMEIRA sílaba do trecho'
      : stage === 1
        ? 'Sílaba marcada. Toque na ÚLTIMA sílaba do trecho (ou em Continuar para só esta)'
        : 'Trecho marcado. Toque numa sílaba para recomeçar';

  return (
    <div className="fixed left-3 right-3 bottom-20 z-[65] mx-auto max-w-md rounded-2xl bg-slate-900 text-white shadow-2xl p-3">
      <p className="text-sm font-semibold text-center px-2">{hint}</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={onCancel} className="py-2.5 rounded-xl bg-white/10 font-bold text-sm active:opacity-70">
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          disabled={stage === 0}
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

                  {(readSel(a.payload) || a.excerpt) && (
                    <p className="mt-1.5 text-xs italic text-slate-500 border-l-2 border-slate-200 pl-2 line-clamp-3">
                      {readSel(a.payload) || a.excerpt}
                    </p>
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
  const shown = form.mode === 'new' ? form.sel : readSel(editing?.payload) || excerpt;

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
          excerpt,
          payload: form.mode === 'new' ? { spans: form.spans, sel: form.sel } : undefined
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

        {shown ? (
          <p className="mt-3 text-xs italic text-slate-500 border-l-2 border-brand-orange pl-2 line-clamp-4">{shown}</p>
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

        <ScopePicker ctx={ctx} scope={scope} onScope={setScope} missionId={missionId} onMission={setMissionId} />

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
