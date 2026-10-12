import { Sun, Moon, MonitorSmartphone, Clock } from 'lucide-react';
import { useTheme } from './useTheme';
import type { ThemeMode } from './theme';

const OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'claro', label: 'Claro', icon: Sun },
  { id: 'escuro', label: 'Escuro', icon: Moon },
  { id: 'noturno', label: 'Noturno', icon: Clock },
  { id: 'auto', label: 'Auto', icon: MonitorSmartphone },
];

type Props = {
  /** 'segmented' = 4 opções lado a lado (Ajustes/menus). 'cycle' = um botão que alterna (cabeçalhos). */
  variant?: 'segmented' | 'cycle';
  /** Só ícones, sem texto (barras laterais). */
  compact?: boolean;
  /** Use sobre fundos escuros (barras laterais coloridas). */
  onDark?: boolean;
};

export function ThemeToggle({ variant = 'segmented', compact = false, onDark = false }: Props) {
  const { mode, setMode } = useTheme();

  if (variant === 'cycle') {
    const idx = OPTIONS.findIndex((o) => o.id === mode);
    const current = OPTIONS[idx < 0 ? 0 : idx];
    const next = OPTIONS[(idx + 1) % OPTIONS.length];
    const Icon = current.icon;
    return (
      <button
        type="button"
        className={`sh-btn sh-btn-ghost sh-btn-icon ${onDark ? 'sh-ondark' : ''}`}
        onClick={() => setMode(next.id)}
        title={`Tema: ${current.label}. Toque para mudar para ${next.label}`}
        aria-label={`Tema: ${current.label}. Mudar para ${next.label}`}
      >
        <Icon size={18} />
      </button>
    );
  }

  return (
    <div className={`sh-theme-seg ${onDark ? 'sh-ondark' : ''}`} role="group" aria-label="Tema do aplicativo">
      {OPTIONS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={mode === id}
          aria-label={label}
          title={id === 'noturno' ? 'Noturno: escuro automático das 18h às 6h' : label}
          onClick={() => setMode(id)}
        >
          <Icon size={16} />
          {!compact && <span>{label}</span>}
        </button>
      ))}
    </div>
  );
}
