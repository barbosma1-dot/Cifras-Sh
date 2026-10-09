import { Users, User } from 'lucide-react';
import type { AnnotationContext, AnnotationScope, ChordAnnotation } from '../lib/chordAnnotations';

/** Etiqueta "Só eu" / nome da missão, usada nos cartões de comentário e de voz. */
export function ScopeChip({ a, ctx }: { a: ChordAnnotation; ctx: AnnotationContext }) {
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

/** Seletor "Quem vê": Só eu | Missão (+ escolha da missão quando há mais de uma). */
export function ScopePicker({
  ctx,
  scope,
  onScope,
  missionId,
  onMission
}: {
  ctx: AnnotationContext;
  scope: AnnotationScope;
  onScope: (s: AnnotationScope) => void;
  missionId: string;
  onMission: (id: string) => void;
}) {
  const writableMissions = ctx.missions.filter(m => m.canWrite);

  return (
    <>
      <label className="block mt-4 text-xs font-black uppercase tracking-wide text-slate-400">Quem vê</label>
      <div className="mt-1 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl" role="tablist">
        <button
          role="tab"
          aria-selected={scope === 'user'}
          onClick={() => onScope('user')}
          className={`py-2 rounded-lg text-sm font-bold ${scope === 'user' ? 'bg-white text-brand-orange shadow-sm' : 'text-slate-500'}`}
        >
          Só eu
        </button>
        <button
          role="tab"
          aria-selected={scope === 'mission'}
          onClick={() => writableMissions.length > 0 && onScope('mission')}
          disabled={writableMissions.length === 0}
          className={`py-2 rounded-lg text-sm font-bold disabled:opacity-40 ${
            scope === 'mission' ? 'bg-white text-brand-blue shadow-sm' : 'text-slate-500'
          }`}
        >
          Missão
        </button>
      </div>

      {writableMissions.length === 0 && (
        <p className="mt-2 text-xs text-slate-400">Itens da missão só podem ser criados por coordenador ou editor.</p>
      )}

      {scope === 'mission' &&
        writableMissions.length > 0 &&
        (writableMissions.length === 1 ? (
          <p className="mt-2 text-xs text-slate-500">
            Visível para todos de <span className="font-bold">{writableMissions[0].name}</span>.
          </p>
        ) : (
          <select
            value={missionId}
            onChange={e => onMission(e.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold bg-white"
          >
            {writableMissions.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        ))}
    </>
  );
}
