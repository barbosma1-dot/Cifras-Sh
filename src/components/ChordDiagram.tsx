import type { ChordShape } from '../lib/chordShapes';

/**
 * Diagrama de braço (violão/ukulele) em SVG puro. Sem dependências.
 * - Cordas da mais grave (esquerda) à mais aguda (direita).
 * - × = corda abafada, ○ = corda solta, ● = dedo, barra arredondada = pestana.
 * - Se o acorde passa da 5ª casa, o diagrama começa na casa mais baixa usada
 *   e mostra o número dela ao lado ("3ª").
 */
interface ChordDiagramProps {
  shape: ChordShape;
  /** Texto alternativo (leitores de tela). */
  label: string;
  className?: string;
}

const ROWS = 5;
const ROW_H = 26;
const TOP = 40;
const LEFT = 36;
const RIGHT = 14;
const WIDTH = 180;
const HEIGHT = TOP + ROWS * ROW_H + 14;
const DOT_R = 9;

export default function ChordDiagram({ shape, label, className }: ChordDiagramProps) {
  const n = shape.frets.length;
  const spacing = (WIDTH - LEFT - RIGHT) / (n - 1);
  const x = (i: number) => LEFT + i * spacing;
  const rowY = (fret: number) => TOP + (fret - shape.baseFret) * ROW_H + ROW_H / 2;
  const showNut = shape.baseFret === 1;

  const summary = shape.frets
    .map(f => (f === null ? 'abafada' : f === 0 ? 'solta' : `casa ${f}`))
    .join(', ');

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={className}
      role="img"
      aria-label={`${label}. Cordas, da grave para a aguda: ${summary}.`}
    >
      {/* casas (linhas horizontais) */}
      {Array.from({ length: ROWS + 1 }, (_, r) => (
        <line
          key={`fret-${r}`}
          x1={x(0)}
          x2={x(n - 1)}
          y1={TOP + r * ROW_H}
          y2={TOP + r * ROW_H}
          stroke="currentColor"
          strokeOpacity={r === 0 && showNut ? 1 : 0.35}
          strokeWidth={r === 0 && showNut ? 5 : 1.5}
          strokeLinecap="round"
        />
      ))}

      {/* cordas (linhas verticais) */}
      {Array.from({ length: n }, (_, i) => (
        <line
          key={`string-${i}`}
          x1={x(i)}
          x2={x(i)}
          y1={TOP}
          y2={TOP + ROWS * ROW_H}
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={1.5}
        />
      ))}

      {/* número da primeira casa quando não é a pestana */}
      {!showNut && (
        <text
          x={LEFT - 14}
          y={rowY(shape.baseFret) + 4}
          textAnchor="end"
          fontSize={12}
          fontWeight={700}
          fill="currentColor"
          fillOpacity={0.8}
        >
          {shape.baseFret}ª
        </text>
      )}

      {/* abafada (×) / solta (○) */}
      {shape.frets.map((f, i) => {
        if (f === null) {
          return (
            <text
              key={`m-${i}`}
              x={x(i)}
              y={TOP - 12}
              textAnchor="middle"
              fontSize={15}
              fontWeight={700}
              fill="currentColor"
              fillOpacity={0.8}
            >
              ×
            </text>
          );
        }
        if (f === 0) {
          return (
            <circle
              key={`o-${i}`}
              cx={x(i)}
              cy={TOP - 16}
              r={5}
              fill="none"
              stroke="currentColor"
              strokeOpacity={0.8}
              strokeWidth={1.8}
            />
          );
        }
        return null;
      })}

      {/* pestana */}
      {shape.barre &&
        shape.barre.fret >= shape.baseFret &&
        shape.barre.fret < shape.baseFret + ROWS && (
          <rect
            x={x(shape.barre.from) - DOT_R}
            y={rowY(shape.barre.fret) - DOT_R}
            width={x(shape.barre.to) - x(shape.barre.from) + DOT_R * 2}
            height={DOT_R * 2}
            rx={DOT_R}
            style={{ fill: 'var(--color-brand-orange, #F64E03)' }}
          />
        )}

      {/* dedos */}
      {shape.frets.map((f, i) => {
        if (f === null || f === 0) return null;
        if (f < shape.baseFret || f >= shape.baseFret + ROWS) return null;
        return (
          <circle
            key={`d-${i}`}
            cx={x(i)}
            cy={rowY(f)}
            r={DOT_R}
            style={{ fill: 'var(--color-brand-orange, #F64E03)' }}
          />
        );
      })}
    </svg>
  );
}
