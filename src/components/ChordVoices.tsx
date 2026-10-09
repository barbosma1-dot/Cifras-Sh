import { useState } from 'react';
import { X, Plus, Pencil, Trash2, Loader2, LocateFixed, AlertTriangle, Mic, Target } from 'lucide-react';
import { useBackButton } from '../hooks/useBackButton';
import {
  buildExcerpt,
  canManageAnnotation,
  createAnnotation,
  plainLineText,
  updateAnnotation,
  type AnnotationContext,
  type AnnotationScope,
  type ChordAnnotation,
  type ResolvedAnchor
} from '../lib/chordAnnotations';
import {
  VOICES,
  VOICE_TEXT_MAX,
  buildVoicePayload,
  readVoicePayload,
  voiceDef,
  type VoiceId,
  type VoiceMark
} from '../lib/voiceDivision';
import { ScopeChip, ScopePicker } from './AnnotationParts';

/**
 * Camada "Divisão de voz" (T5b): barras coloridas sob a letra mostrando
 * quais linhas cada voz canta, chips para ligar/desligar cada voz e modo foco
 * (só uma voz em destaque). Os dados ficam em `chord_annotations`
 * (`kind = 'voice'`); quem orquestra o estado é `useChordComments`.
 */

// ---------------------------------------------------------------------------
// Barras sob a letra (usadas por wrapLine)
// ---------------------------------------------------------------------------

export function VoiceBars({ marks }: { marks: VoiceMark[] }) {
  return (
    <div className="mt-0.5 mb-1.5 space-y-0.5">
      {marks.map(m => {
        const v = voiceDef(m.voice);
        return (
          <div key={m.id}>
            <div className="flex items-center gap-1.5" title={v.label}>
              <div className="h-1.5 flex-1 rounded-full" style={{ background: v.color }} />
              <span
                className="w-[4.25rem] shrink-0 text-[9px] font-black uppercase tracking-wide leading-none"
                style={{ color: v.ink }}
              >
                {m.first ? v.label : ''}
              </span>
            </div>
            {/* Letra repetida: só aparece quando esta voz canta algo diferente da letra principal. */}
            {m.last && m.text && (
              <p className="mt-0.5 text-[0.8em] italic leading-snug whitespace-pre-line font-semibold" style={{ color: v.ink }}>
                {m.text}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chips (ligar/desligar voz + modo foco)
// ---------------------------------------------------------------------------

export function VoiceChips({
  present,
  hidden,
  focusMode,
  focus,
  onToggle,
  onFocusMode,
  onPickFocus
}: {
  present: VoiceId[];
  hidden: Set<VoiceId>;
  focusMode: boolean;
  focus: VoiceId | null;
  onToggle: (id: VoiceId) => void;
  onFocusMode: () => void;
  onPickFocus: (id: VoiceId) => void;
}) {
  return (
    <div
      className="fixed left-3 right-3 bottom-[4.75rem] z-[62] mx-auto max-w-lg flex items-center gap-1.5 overflow-x-auto rounded-2xl bg-white/95 border border-slate-200 shadow-lg backdrop-blur px-2 py-1.5"
      role="group"
      aria-label="Divisão de voz"
    >
      <button
        onClick={onFocusMode}
        aria-pressed={focusMode}
        title="Modo foco: destaca só uma voz"
        className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-black ${
          focusMode ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
        }`}
      >
        <Target className="w-3.5 h-3.5" /> Foco
      </button>

      {present.map(id => {
        const v = voiceDef(id);
        const on = focusMode ? focus === id : !hidden.has(id);
        return (
          <button
            key={id}
            onClick={() => (focusMode ? onPickFocus(id) : onToggle(id))}
            aria-pressed={on}
            className="shrink-0 flex items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-xs font-bold transition-colors"
            style={
              on
                ? { background: v.color, borderColor: v.color, color: id === 'contralto' ? '#422006' : '#fff' }
                : { background: '#fff', borderColor: '#cbd5e1', color: '#94a3b8', textDecoration: 'line-through' }
            }
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel (lista)
// ---------------------------------------------------------------------------

export function VoicePanel({
  ctx,
  items,
  fromCache,
  loading,
  onClose,
  onNew,
  onGo,
  onEdit,
  onDelete
}: {
  ctx: AnnotationContext;
  items: { a: ChordAnnotation; anchor: ResolvedAnchor }[];
  fromCache: boolean;
  loading: boolean;
  onClose: () => void;
  onNew: () => void;
  onGo: (line: number) => void;
  onEdit: (a: ChordAnnotation) => void;
  onDelete: (a: ChordAnnotation) => Promise<void>;
}) {
  useBackButton(true, onClose);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-[175] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Divisão de voz"
        className="bg-white text-slate-800 w-full sm:max-w-md max-h-[85vh] flex flex-col rounded-t-3xl sm:rounded-3xl shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
          <h3 className="text-lg font-black flex items-center gap-2">
            <Mic className="w-5 h-5 text-brand-orange" /> Divisão de voz
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
            <Plus className="w-4 h-4" /> Nova divisão
          </button>
          {fromCache && (
            <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
              Sem conexão: mostrando a última cópia salva. Para criar ou editar é preciso estar online.
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3">
          {loading && items.length === 0 ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-brand-blue" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">
              Nenhuma divisão de voz nesta cifra ainda. Marque um trecho e escolha quem canta.
            </p>
          ) : (
            items.map(({ a, anchor }) => {
              const pv = readVoicePayload(a.payload);
              const def = pv.voice ? voiceDef(pv.voice) : null;
              const manage = canManageAnnotation(a, ctx);
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border border-slate-200 p-3 border-l-[6px]"
                  style={{ borderLeftColor: def?.color || '#cbd5e1' }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-black" style={{ color: def?.ink }}>
                      {def?.label || 'Voz desconhecida'}
                    </p>
                    <ScopeChip a={a} ctx={ctx} />
                  </div>

                  {a.excerpt && (
                    <p className="mt-1.5 text-xs italic text-slate-500 border-l-2 border-slate-200 pl-2 line-clamp-3">{a.excerpt}</p>
                  )}
                  {pv.text && (
                    <p className="mt-2 text-sm whitespace-pre-line break-words" style={{ color: def?.ink }}>
                      <span className="text-[10px] font-black uppercase tracking-wide text-slate-400 block">Letra desta voz</span>
                      {pv.text}
                    </p>
                  )}

                  {anchor.status === 'lost' && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      O trecho foi alterado na cifra e não foi encontrado. A divisão continua salva.
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
// Formulário (nova / editar)
// ---------------------------------------------------------------------------

export type VoiceFormState = { mode: 'new'; start: number; end: number } | { mode: 'edit'; annotation: ChordAnnotation };

/** Letra principal das linhas a..b (sem acordes), uma linha por linha cantada. */
function mainLyricOf(lines: string[], start: number, end: number): string {
  const out: string[] = [];
  for (let i = start; i <= end && i < lines.length; i++) {
    const t = plainLineText(lines[i]);
    if (t) out.push(t);
  }
  return out.join('\n');
}

export function VoiceForm({
  ctx,
  form,
  lines,
  chordId,
  anchor,
  onClose,
  onSaved
}: {
  ctx: AnnotationContext;
  form: VoiceFormState;
  lines: string[];
  chordId: string;
  anchor?: ResolvedAnchor;
  onClose: () => void;
  onSaved: (saved: ChordAnnotation, isNew: boolean) => void;
}) {
  useBackButton(true, onClose);

  const editing = form.mode === 'edit' ? form.annotation : null;
  const writableMissions = ctx.missions.filter(m => m.canWrite);
  const initial = editing ? readVoicePayload(editing.payload) : { voice: null, text: '' };

  const start = form.mode === 'new' ? form.start : anchor?.start ?? form.annotation.line_start;
  const end = form.mode === 'new' ? form.end : anchor?.end ?? form.annotation.line_end;
  const lost = !!editing && anchor?.status === 'lost';
  // Se o trecho sumiu da cifra, compara com o texto que foi guardado.
  const mainLyric = lost ? (editing?.excerpt || '').replace(/ \/ /g, '\n') : mainLyricOf(lines, start, end);
  const excerpt = editing ? editing.excerpt : buildExcerpt(lines, start, end);

  const [voice, setVoice] = useState<VoiceId | null>(initial.voice);
  const [diffOn, setDiffOn] = useState(!!initial.text);
  const [text, setText] = useState(initial.text);
  const [scope, setScope] = useState<AnnotationScope>(editing?.scope || 'user');
  const [missionId, setMissionId] = useState<string>(editing?.mission_id || writableMissions[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const missionChoiceOk = scope === 'user' || (!!missionId && writableMissions.some(m => m.id === missionId));
  const canSave = !!voice && missionChoiceOk && !saving;

  const toggleDiff = () => {
    setDiffOn(on => {
      // Ao ligar, já traz a letra principal para a pessoa só ajustar o que muda.
      if (!on && !text.trim()) setText(mainLyric.slice(0, VOICE_TEXT_MAX));
      return !on;
    });
  };

  const save = async () => {
    if (!canSave || !voice) return;
    setSaving(true);
    setError('');
    try {
      const mission_id = scope === 'mission' ? missionId : null;
      const payload = buildVoicePayload(voice, diffOn ? text : '', mainLyric);
      if (editing) {
        const saved = await updateAnnotation(editing.id, { payload, scope, mission_id });
        onSaved(saved, false);
      } else {
        const saved = await createAnnotation(ctx.userId, {
          kind: 'voice',
          chord_id: chordId,
          scope,
          mission_id,
          title: '',
          body: '',
          payload,
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
            ? 'A tabela de anotações ainda não existe no banco (rodar a migração T5A).'
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
        aria-label={editing ? 'Editar divisão de voz' : 'Nova divisão de voz'}
        className="bg-white text-slate-800 w-full sm:max-w-md max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-black">{editing ? 'Editar divisão de voz' : 'Nova divisão de voz'}</h3>
          <button onClick={onClose} aria-label="Fechar" className="p-2 -mr-2 rounded-full text-slate-400 hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {excerpt ? (
          <p className="mt-3 text-xs italic text-slate-500 border-l-2 border-brand-orange pl-2 line-clamp-4">{excerpt}</p>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Trecho sem letra (apenas acordes).</p>
        )}

        <label className="block mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Quem canta</label>
        <div className="mt-1 grid grid-cols-3 gap-2">
          {VOICES.map(v => {
            const on = voice === v.id;
            return (
              <button
                key={v.id}
                onClick={() => setVoice(v.id)}
                aria-pressed={on}
                className="py-2.5 rounded-xl border-2 text-xs font-black transition-colors"
                style={
                  on
                    ? { background: v.color, borderColor: v.color, color: v.id === 'contralto' ? '#422006' : '#fff' }
                    : { background: '#fff', borderColor: v.color, color: v.ink }
                }
              >
                {v.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={toggleDiff}
          aria-pressed={diffOn}
          className={`mt-4 w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-bold ${
            diffOn ? 'border-brand-orange bg-orange-50 text-brand-orange' : 'border-slate-200 text-slate-600'
          }`}
        >
          <span>Esta voz canta uma letra diferente</span>
          <span className={`text-[10px] font-black uppercase ${diffOn ? '' : 'text-slate-400'}`}>{diffOn ? 'Sim' : 'Não'}</span>
        </button>

        {diffOn && (
          <>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              maxLength={VOICE_TEXT_MAX}
              rows={4}
              placeholder="Letra que esta voz canta neste trecho"
              className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-orange resize-none"
            />
            <p className="mt-1 text-xs text-slate-400">
              Se a letra ficar igual à principal, ela não é repetida na cifra: aparece só a barra.
            </p>
          </>
        )}

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
