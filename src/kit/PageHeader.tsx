import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

type Primary = { label: string; onClick: () => void; icon?: ReactNode };

/**
 * Título da tela + ação principal.
 * Computador: botão no canto superior direito. Celular: botão flutuante no canto inferior direito.
 */
export function PageHeader({
  title, subtitle, primary, actions,
}: { title: string; subtitle?: string; primary?: Primary; actions?: ReactNode }) {
  const icon = primary?.icon ?? <Plus size={18} />;
  return (
    <>
      <header className="sh-header">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="sh-header-actions">
          {actions}
          {primary && (
            <button type="button" className="sh-btn sh-btn-primary" onClick={primary.onClick}>
              {icon}
              {primary.label}
            </button>
          )}
        </div>
      </header>
      {primary && (
        <button type="button" className="sh-btn sh-btn-primary sh-fab" onClick={primary.onClick} aria-label={primary.label}>
          {icon}
          {primary.label}
        </button>
      )}
    </>
  );
}
