import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useBackButton } from '../hooks/useBackButton';
import { getChordShape, type Instrument } from '../lib/chordShapes';
import ChordDiagram from './ChordDiagram';

/**
 * Modal "shape do acorde": abre ao tocar num acorde da cifra (ChordViewer).
 * Recebe o acorde exatamente como aparece na tela (já transposto e na
 * notação escolhida), então o desenho sempre acompanha a transposição.
 * O instrumento escolhido (violão/ukulele) fica salvo no aparelho.
 */
interface ChordShapeModalProps {
  /** Acorde como exibido, ex.: "G7", "Lám", "C/G". */
  chordLabel: string;
  onClose: () => void;
}

const STORAGE_KEY = 'chord_shape_instrument';

function loadInstrument(): Instrument {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'guitar' || v === 'ukulele') return v;
  } catch {
    /* localStorage indisponível: usa o padrão */
  }
  return 'guitar';
}

const INSTRUMENTS: { id: Instrument; label: string; strings: string }[] = [
  { id: 'guitar', label: 'Violão', strings: 'E A D G B E' },
  { id: 'ukulele', label: 'Ukulele', strings: 'G C E A' }
];

export default function ChordShapeModal({ chordLabel, onClose }: ChordShapeModalProps) {
  useBackButton(true, onClose);

  const [instrument, setInstrument] = useState<Instrument>(loadInstrument);
  const result = useMemo(() => getChordShape(chordLabel, instrument), [chordLabel, instrument]);

  const chooseInstrument = (id: Instrument) => {
    setInstrument(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignora */
    }
  };

  const current = INSTRUMENTS.find(i => i.id === instrument)!;
  const fretsText = result.shape
    ? result.shape.frets.map(f => (f === null ? 'x' : String(f))).join(' ')
    : '';

  return (
    <div
      className="fixed inset-0 z-[180] bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Shape do acorde ${chordLabel}`}
    >
      <div
        className="bg-white text-slate-800 w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-3xl font-black text-brand-orange leading-none truncate">{chordLabel}</h3>
            {result.notes.length > 0 && (
              <p className="mt-1.5 text-xs font-bold text-slate-400 uppercase tracking-wide">
                Notas: {result.notes.join(' · ')}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="p-2 -mr-1 -mt-1 rounded-full text-slate-400 hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl" role="tablist" aria-label="Instrumento">
          {INSTRUMENTS.map(i => (
            <button
              key={i.id}
              role="tab"
              aria-selected={instrument === i.id}
              onClick={() => chooseInstrument(i.id)}
              className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                instrument === i.id ? 'bg-white text-brand-blue shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {i.label}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-col items-center">
          {result.shape ? (
            <>
              <ChordDiagram
                shape={result.shape}
                label={`${chordLabel} no ${current.label.toLowerCase()}`}
                className={`text-slate-700 ${instrument === 'ukulele' ? 'w-44' : 'w-56'} h-auto`}
              />
              <p className="mt-1 text-[11px] font-mono text-slate-400">
                Cordas {current.strings} → <span className="font-bold text-slate-600">{fretsText}</span>
              </p>
            </>
          ) : (
            <p className="py-10 text-center text-sm text-slate-400">
              {result.warning || 'Sem desenho disponível.'}
            </p>
          )}
        </div>

        {result.shape && result.warning && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">{result.warning}</p>
        )}
      </div>
    </div>
  );
}
