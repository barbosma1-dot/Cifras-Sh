import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { MessageSquare, X, Plus, Pencil, Trash2, Loader2, LocateFixed, AlertTriangle, Eye, EyeOff, Check, User, Users } from 'lucide-react';
import { useBackButton } from '../hooks/useBackButton';
import { Modal, ModalActions } from '../kit';
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
import {
  COMMENT_COLORS,
  buildTitleColors,
  colorById,
  normTitle,
  readColorId,
  titleColor,
  type CommentColor
} from '../lib/commentColors';
import { ScopeChip, ScopePicker } from './AnnotationParts';
import { VoiceAltLyrics, VoiceBarReopen, VoiceChips, VoiceForm, VoicePanel, type VoiceFormState } from './ChordVoices';
import {
  firstLineOf,
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
  /** Cor do cartão (id da paleta): manual (payload.color) ou a do título. */
  colorId: string;
  /** Primeira linha do trecho comentado (o cartão aparece acima dela). */
  line: number;
  /** Posição na ordem de criação (para empilhar na ordem certa). */
  order: number;
}

export interface LineDecor {
  selectMode: boolean;
  /** Marca-texto, sublinhado e seleção sílaba por sílaba (ver LyricSpans.tsx). */
  syl: SylDecor;
  /** Comentários a mostrar logo ACIMA da primeira linha do trecho (o viewer sobe o cartão acima da linha de acordes, se houver). */
  notes: Map<number, NoteView[]>;
  onNoteHide: (id: string) => void;
  onNoteShow: (id: string) => void;
  onNoteEdit: (id: string) => void;
  /** Letra própria de cada voz (só na última linha do trecho; já filtrada por chips/foco). */
  voices: Map<number, VoiceMark[]>;
  /** Linhas a esmaecer no modo foco; null = nenhuma. */
  dim: Set<number> | null;
}

function NoteCard({ n, d, dim }: { n: NoteView; d: LineDecor; dim: boolean }) {
  const pal = colorById(n.colorId) || COMMENT_COLORS[0];
  if (n.collapsed) {
    return (
      <button
        type="button"
        data-note-id={n.id}
        onClick={() => d.onNoteShow(n.id)}
        aria-label={`Mostrar comentário: ${n.title}`}
        className={`mt-1 mb-1 mr-1 inline-flex max-w-full items-center gap-1 rounded-full bg-slate-800 text-white text-[10px] font-bold leading-none px-2 py-1.5 shadow active:opacity-70 ${dim ? 'opacity-30' : ''}`}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: pal.main }} />
        <MessageSquare className="w-3 h-3 shrink-0" />
        <span className="truncate">{n.title || 'Comentário'}</span>
        <Eye className="w-3 h-3 shrink-0 opacity-70" />
      </button>
    );
  }
  return (
    <div
      data-note-id={n.id}
      className={`mt-1 mb-2 rounded-xl border-l-4 px-2.5 py-1.5 text-[0.82em] leading-snug ${dim ? 'opacity-30' : ''}`}
      style={{ borderLeftColor: pal.main, background: pal.bg, color: pal.ink }}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
            {n.title && <p className="font-black break-words">{n.title}</p>}
            {/* "Só eu" / "Missão" é só um selo: a cor vem do título */}
            <span
              className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px text-[0.72em] font-bold uppercase tracking-wide bg-white/70"
              style={{ borderColor: pal.main, color: pal.ink }}
            >
              {n.scope === 'mission' ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
              {n.scope === 'mission' ? 'Missão' : 'Só eu'}
            </span>
          </div>
          {n.body && <p className="whitespace-pre-wrap break-words">{n.body}</p>}
        </div>
        <button
          type="button"
          onClick={() => d.onNoteEdit(n.id)}
          aria-label="Abrir comentário no painel"
          className="shrink-0 p-1 -mt-0.5 rounded-full opacity-60 active:bg-black/10"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => d.onNoteHide(n.id)}
          aria-label="Ocultar este comentário"
          className="shrink-0 p-1 -mt-0.5 -mr-1 rounded-full opacity-60 active:bg-black/10"
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

  // Os cartões ficam ACIMA da linha. Cada um esmaece conforme a linha do trecho
  // comentado (n.line), não conforme a linha de acordes em que o viewer o encaixou.
  return (
    <div key={`ln-${idx}`} data-line={idx} className="relative">
      {notes && notes.map(n => <NoteCard key={n.id} n={n} d={d} dim={!!d.dim && d.dim.has(n.line) && !d.selectMode} />)}
      <div className={dimmed ? 'opacity-30' : undefined}>
        {el}
        {voiceMarks && <VoiceAltLyrics marks={voiceMarks} />}
      </div>
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
/** T3 — preferência GLOBAL (vale para todas as cifras): '1' = barra de vozes oculta. */
const VOICE_BAR_HIDDEN_KEY = 'chord_voice_bar_hidden';

function loadVoiceBarHidden(): boolean {
  try {
    return localStorage.getItem(VOICE_BAR_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}
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

// ---------------------------------------------------------------------------
// Filtro de comentários por título (T2)
// ---------------------------------------------------------------------------

const TITLE_FILTER_PREFIX = 'chord_comment_titles_off:';

export interface TitleOption {
  key: string;
  label: string;
  count: number;
  /** Cor automática do título (id da paleta). */
  colorId: string;
}

/** Guardamos só os títulos DESMARCADOS por cifra: o padrão é "todos selecionados" e títulos novos entram marcados. */
function loadTitlesOff(chordId: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(TITLE_FILTER_PREFIX + chordId) || '[]');
    return new Set((Array.isArray(raw) ? raw : []).filter((x: unknown) => typeof x === 'string') as string[]);
  } catch {
    return new Set();
  }
}

function saveTitlesOff(chordId: string, set: Set<string>) {
  try {
    if (set.size === 0) localStorage.removeItem(TITLE_FILTER_PREFIX + chordId);
    else localStorage.setItem(TITLE_FILTER_PREFIX + chordId, JSON.stringify([...set]));
  } catch {
    /* ignora */
  }
}

/** Chips de títulos (selecionado = comentário aparece no texto) + "Todos" / "Nenhum". */
function TitleFilterChips({
  titles,
  off,
  onToggle,
  onAll,
  onNone
}: {
  titles: TitleOption[];
  off: Set<string>;
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={onAll}
          className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-700 active:opacity-70"
        >
          Todos
        </button>
        <button
          type="button"
          onClick={onNone}
          className="px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs font-bold text-slate-700 active:opacity-70"
        >
          Nenhum
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {titles.map(t => {
          const on = !off.has(t.key);
          const pal = colorById(t.colorId) || COMMENT_COLORS[0];
          return (
            <button
              key={t.key || '__sem_titulo__'}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(t.key)}
              className={`max-w-full inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-bold ${
                on ? '' : 'bg-white border-slate-300 text-slate-400 line-through'
              }`}
              style={on ? { background: pal.bg, borderColor: pal.main, color: pal.ink } : undefined}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: pal.main, opacity: on ? 1 : 0.45 }} />
              {on && <Check className="w-3 h-3 shrink-0" />}
              <span className="truncate">{t.label}</span>
              <span className="opacity-60">{t.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Acesso rápido (ícone de filtro no rodapé). */
function TitleFilterModal(props: {
  titles: TitleOption[];
  off: Set<string>;
  onToggle: (key: string) => void;
  onAll: () => void;
  onNone: () => void;
  onClose: () => void;
}) {
  useBackButton(true, props.onClose);
  return (
    <Modal open onClose={props.onClose} title="Quais comentários ver">
      <p className="text-xs text-slate-500 pb-3">
        Toque nos títulos para mostrar ou esconder os comentários no texto. Os comentários escondidos continuam salvos.
      </p>
      <TitleFilterChips titles={props.titles} off={props.off} onToggle={props.onToggle} onAll={props.onAll} onNone={props.onNone} />
    </Modal>
  );
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
  // T2 — filtro por título (guarda os desmarcados, por cifra)
  const [titlesOff, setTitlesOff] = useState<Set<string>>(() => loadTitlesOff(chordId));
  const [titleFilterOpen, setTitleFilterOpen] = useState(false);

  // T5b — divisão de voz
  const [voiceList, setVoiceList] = useState<ChordAnnotation[]>([]);
  const [voiceFromCache, setVoiceFromCache] = useState(false);
  const [voicePanelOpen, setVoicePanelOpen] = useState(false);
  const [voiceForm, setVoiceForm] = useState<VoiceFormState | null>(null);
  const [selectPurpose, setSelectPurpose] = useState<'comment' | 'voice'>('comment');
  const [hiddenVoices, setHiddenVoices] = useState<Set<VoiceId>>(loadHiddenVoices);
  const [voiceBarHidden, setVoiceBarHiddenState] = useState<boolean>(loadVoiceBarHidden);
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
    setTitleFilterOpen(false);
    setTitlesOff(loadTitlesOff(chordId));
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

  const setVoiceBarHidden = useCallback((hidden: boolean) => {
    setVoiceBarHiddenState(hidden);
    try {
      if (hidden) localStorage.setItem(VOICE_BAR_HIDDEN_KEY, '1');
      else localStorage.removeItem(VOICE_BAR_HIDDEN_KEY);
    } catch {
      /* ignora */
    }
  }, []);

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

  // T5 — cor por título (determinística; ver lib/commentColors.ts).
  const titleColorMap = useMemo(() => buildTitleColors(list), [list]);
  /** Cor do comentário: escolha manual (payload.color) ou a do título. */
  const colorOf = useCallback(
    (a: ChordAnnotation): CommentColor => colorById(readColorId(a.payload)) || titleColor(titleColorMap, a.title),
    [titleColorMap]
  );
  const autoColorFor = useCallback((title: string): CommentColor => titleColor(titleColorMap, title), [titleColorMap]);

  // Títulos distintos (todas as anotações da cifra, inclusive as de trecho perdido).
  const titleOptions = useMemo<TitleOption[]>(() => {
    const map = new Map<string, TitleOption>();
    for (const a of list) {
      const key = normTitle(a.title);
      const cur = map.get(key);
      if (cur) cur.count += 1;
      else
        map.set(key, {
          key,
          label: key === '' ? 'Sem título' : (a.title || '').trim(),
          count: 1,
          colorId: titleColor(titleColorMap, a.title).id
        });
    }
    return [...map.values()].sort((x, y) => x.label.localeCompare(y.label, 'pt-BR'));
  }, [list, titleColorMap]);

  const updateTitlesOff = useCallback(
    (updater: (prev: Set<string>) => Set<string>) => {
      setTitlesOff(prev => {
        const next = updater(prev);
        saveTitlesOff(chordId, next);
        return next;
      });
    },
    [chordId]
  );
  const toggleTitle = useCallback(
    (key: string) =>
      updateTitlesOff(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    [updateTitlesOff]
  );
  const showAllTitles = useCallback(() => updateTitlesOff(() => new Set()), [updateTitlesOff]);
  const showNoTitles = useCallback(
    () => updateTitlesOff(() => new Set(titleOptions.map(t => t.key))),
    [updateTitlesOff, titleOptions]
  );
  // Ao salvar/editar um comentário, o título dele volta a ficar visível (senão ele "sumiria" logo após criar).
  const ensureTitleOn = useCallback(
    (title: string) => {
      const key = normTitle(title);
      setTitlesOff(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        saveTitlesOff(chordId, next);
        return next;
      });
    },
    [chordId]
  );
  const filteredOut = titleOptions.some(t => titlesOff.has(t.key));

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
      // Ordem de criação (a lista vem do banco ordenada por linha).
      const byCreation = [...liveComments].sort((x, y) =>
        x.a.created_at < y.a.created_at ? -1 : x.a.created_at > y.a.created_at ? 1 : 0
      );
      for (const [order, { a, anchor }] of byCreation.entries()) {
        if (titlesOff.has(normTitle(a.title))) continue;
        for (const sp of spansOnLines(a.payload, anchor.start, anchor.end)) {
          commentSpans.set(sp.line, [
            ...(commentSpans.get(sp.line) || []),
            { id: a.id, scope: a.scope, from: sp.from, to: sp.to, color: colorOf(a).main }
          ]);
        }
        const first = firstLineOf(a.payload, anchor.start, anchor.end);
        notes.set(first, [
          ...(notes.get(first) || []),
          {
            id: a.id,
            title: a.title || '',
            body: a.body || '',
            scope: a.scope,
            collapsed: collapsedNotes.has(a.id),
            colorId: colorOf(a).id,
            line: first,
            order
          }
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
  }, [enabled, ctx, liveComments, commentsShown, collapsedNotes, titlesOff, colorOf, selectMode, sylA, sylB, voiceView, hideNote, showNote]);

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

  const goToLine = (line: number, noteId?: string) => {
    setPanelOpen(false);
    setVoicePanelOpen(false);
    setPanelFilter(null);
    // espera o painel sair da tela antes de rolar
    window.setTimeout(() => {
      // O cartão do comentário fica acima do trecho: rola até ele; sem cartão (oculto), rola até a linha.
      const card = noteId ? document.querySelector(`[data-note-id="${noteId}"]`) : null;
      (card || document.querySelector(`[data-line="${line}"]`))?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 80);
  };

  const available = enabled && !!ctx;
  // Há algo para a barra mostrar (vozes e/ou comentários)?
  const hasBar = voiceView.present.length > 0 || liveComments.length > 0;

  const ui: ReactNode = available ? (
    <>
      {panelOpen && (
        <CommentsPanel
          ctx={ctx!}
          items={resolved}
          titles={titleOptions}
          colorOf={colorOf}
          titlesOff={titlesOff}
          onToggleTitle={toggleTitle}
          onAllTitles={showAllTitles}
          onNoTitles={showNoTitles}
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
          barVisible={!voiceBarHidden}
          onToggleBar={() => setVoiceBarHidden(!voiceBarHidden)}
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

      {hasBar && !selectMode && voiceBarHidden && <VoiceBarReopen onClick={() => setVoiceBarHidden(false)} />}

      {hasBar && !selectMode && !voiceBarHidden && (
        <VoiceChips
          onHide={() => setVoiceBarHidden(true)}
          comments={
            liveComments.length > 0
              ? {
                  count: liveComments.length,
                  shown: commentsShown,
                  onToggle: toggleCommentsShown,
                  onFilter: () => setTitleFilterOpen(true),
                  filtered: filteredOut
                }
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

      {titleFilterOpen && (
        <TitleFilterModal
          titles={titleOptions}
          off={titlesOff}
          onToggle={toggleTitle}
          onAll={showAllTitles}
          onNone={showNoTitles}
          onClose={() => setTitleFilterOpen(false)}
        />
      )}

      {selectMode && <SelectionBar stage={!sylA ? 0 : sylB ? 2 : 1} onCancel={cancelSelect} onConfirm={confirmSelect} />}

      {form && (
        <CommentForm
          ctx={ctx!}
          form={form}
          lines={lines}
          chordId={chordId}
          autoColorFor={autoColorFor}
          anchor={form.mode === 'edit' ? anchorById.get(form.annotation.id) : undefined}
          onClose={() => setForm(null)}
          onSaved={(saved, isNew) => {
            commit(prev => (isNew ? [...prev, saved] : prev.map(x => (x.id === saved.id ? saved : x))));
            ensureTitleOn(saved.title);
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
    voiceChipsVisible: available && hasBar && !selectMode && !voiceBarHidden,
    // Abrir o painel pelo menu ⋮ também reexibe a barra.
    openVoices: () => {
      setVoiceBarHidden(false);
      setVoicePanelOpen(true);
    },
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
  titles,
  colorOf,
  titlesOff,
  onToggleTitle,
  onAllTitles,
  onNoTitles,
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
  titles: TitleOption[];
  colorOf: (a: ChordAnnotation) => CommentColor;
  titlesOff: Set<string>;
  onToggleTitle: (key: string) => void;
  onAllTitles: () => void;
  onNoTitles: () => void;
  filter: string[] | null;
  fromCache: boolean;
  loading: boolean;
  onClearFilter: () => void;
  onClose: () => void;
  onNew: () => void;
  onGo: (line: number, noteId?: string) => void;
  onEdit: (a: ChordAnnotation) => void;
  onDelete: (a: ChordAnnotation) => Promise<void>;
}) {
  useBackButton(true, onClose);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const shown = filter ? items.filter(i => filter.includes(i.a.id)) : items;

  return (
    <Modal open onClose={onClose} title="Comentários">
        <div className="pb-3">
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

        {!filter && titles.length > 0 && (
          <div className="pb-3">
            <p className="text-xs font-black uppercase tracking-wide text-slate-400 mb-1.5">Mostrar no texto</p>
            <TitleFilterChips titles={titles} off={titlesOff} onToggle={onToggleTitle} onAll={onAllTitles} onNone={onNoTitles} />
          </div>
        )}

        <div className="space-y-3">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-blue" />
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Nenhum comentário nesta cifra ainda.</p>
          ) : (
            shown.map(({ a, anchor }) => {
              const manage = canManageAnnotation(a, ctx);
              const titleKey = normTitle(a.title);
              const hiddenByTitle = titlesOff.has(titleKey);
              return (
                <div
                  key={a.id}
                  className={`rounded-2xl border border-slate-200 border-l-[6px] p-3 ${hiddenByTitle ? 'opacity-50' : ''}`}
                  style={{ borderLeftColor: colorOf(a).main }}
                >
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
                    {hiddenByTitle && (
                      <button
                        onClick={() => onToggleTitle(titleKey)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 text-xs font-bold text-white active:opacity-70"
                      >
                        <Eye className="w-3.5 h-3.5" /> Mostrar no texto
                      </button>
                    )}
                    {anchor.status !== 'lost' && !hiddenByTitle && (
                      <button
                        onClick={() => onGo(anchor.start, a.id)}
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
    </Modal>
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
  autoColorFor,
  anchor,
  onClose,
  onSaved
}: {
  ctx: AnnotationContext;
  form: Exclude<FormState, null>;
  lines: string[];
  chordId: string;
  /** Cor automática que o título digitado terá. */
  autoColorFor: (title: string) => CommentColor;
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
  // null = automática (cor do título); senão id da paleta, guardado em payload.color
  const [colorId, setColorId] = useState<string | null>(() => readColorId(editing?.payload));
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
        // payload inteiro é regravado: preserva spans/sel e só mexe em `color`
        const { color: _old, ...rest } = (editing.payload || {}) as Record<string, unknown>;
        const payload = colorId ? { ...rest, color: colorId } : rest;
        const saved = await updateAnnotation(editing.id, { title, body, scope, mission_id, payload });
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
          payload: form.mode === 'new' ? { spans: form.spans, sel: form.sel, ...(colorId ? { color: colorId } : {}) } : undefined
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
    <Modal
      open
      onClose={onClose}
      title={editing ? 'Editar comentário' : 'Novo comentário'}
      footer={<ModalActions onCancel={onClose} onConfirm={save} confirmLabel="Salvar" disabled={!canSave} loading={saving} />}
    >
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

        <label className="block mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Cor</label>
        <div className="mt-1 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Cor do comentário">
          <button
            type="button"
            role="radio"
            aria-checked={colorId === null}
            onClick={() => setColorId(null)}
            className={`flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-bold ${
              colorId === null ? 'border-slate-800 text-slate-800' : 'border-slate-200 text-slate-500'
            }`}
          >
            <span className="w-3.5 h-3.5 rounded-full" style={{ background: autoColorFor(title).main }} />
            Automática
          </button>
          {COMMENT_COLORS.map(c => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={colorId === c.id}
              aria-label={c.label}
              title={c.label}
              onClick={() => setColorId(c.id)}
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                colorId === c.id ? 'border-slate-800' : 'border-transparent'
              }`}
              style={{ background: c.main }}
            >
              {colorId === c.id && <Check className="w-4 h-4 text-white" />}
            </button>
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-400">Automática: o mesmo título sempre tem a mesma cor.</p>

        <ScopePicker ctx={ctx} scope={scope} onScope={setScope} missionId={missionId} onMission={setMissionId} />

        {error && <p className="mt-3 text-xs text-red-700 bg-red-50 rounded-xl px-3 py-2">{error}</p>}
    </Modal>
  );
}
