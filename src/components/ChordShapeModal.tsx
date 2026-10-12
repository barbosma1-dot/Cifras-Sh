import { useMemo, useState } from 'react';
import { Modal } from '../kit';
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

  // Acorde com baixo (ex.: A/C#): diz em que corda/casa está o baixo da forma mostrada.
  const bassName = chordLabel.includes('/') ? chordLabel.split('/')[1].trim() : '';
  let bassInfo = '';
  if (instrument === 'guitar' && bassName && result.shape && !result.warning) {
    const first = result.shape.frets.findIndex(f => f !== null);
    if (first >= 0) {
      const stringNames = ['E (6ª)', 'A (5ª)', 'D (4ª)', 'G (3ª)', 'B (2ª)', 'E (1ª)'];
      const fret = result.shape.frets[first] as number;
      bassInfo = `Baixo ${bassName}: corda ${stringNames[first]}, ${fret === 0 ? 'solta' : `casa ${fret}`}. A forma já inclui o baixo.`;
    }
  }

  return (
    <Modal open onClose={onClose} title={`Acorde ${chordLabel}`}>
        {result.notes.length > 0 && (
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wide">
            Notas: {result.notes.join(' · ')}
          </p>
        )}
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

        {bassInfo && <p className="mt-3 text-xs text-slate-600 bg-slate-100 rounded-xl px-3 py-2">{bassInfo}</p>}

        {result.shape && result.warning && (
          <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">{result.warning}</p>
        )}
    </Modal>
  );
}
