import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2 } from 'lucide-react';

/** Pilha de janelas abertas: o Esc fecha só a de cima. */
const openStack: symbol[] = [];

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Use <ModalActions /> para manter os botões sempre no mesmo lugar. */
  footer?: ReactNode;
  size?: 'md' | 'lg';
};

/** Painel que sobe da base no celular e fica centralizado no computador. */
export function Modal({ open, onClose, title, children, footer, size = 'md' }: ModalProps) {
  const id = useRef(Symbol('modal'));
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const me = id.current;
    openStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === me) onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = openStack.indexOf(me);
      if (i >= 0) openStack.splice(i, 1);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="sh-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`sh-modal ${size === 'lg' ? 'sh-modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sh-modal-head">
          <h2>{title}</h2>
          <button type="button" className="sh-btn sh-btn-ghost sh-btn-icon" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </div>
        <div className="sh-modal-body">{children}</div>
        {footer && <div className="sh-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

type ActionsProps = {
  onCancel: () => void;
  onConfirm?: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  /** true quando a ação principal é destrutiva (excluir, encerrar). */
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  /** Ação secundária de risco (ex.: "Excluir"): fica isolada à esquerda. */
  extra?: ReactNode;
  /** Use quando o botão principal envia um <form id="..."> */
  formId?: string;
};

/** Ordem padrão: [extra ........] [Cancelar] [Ação principal]  (principal sempre à direita). */
export function ModalActions({
  onCancel, onConfirm, cancelLabel = 'Cancelar', confirmLabel = 'Salvar',
  danger = false, loading = false, disabled = false, extra, formId,
}: ActionsProps) {
  return (
    <>
      {extra && <div className="sh-modal-extra">{extra}</div>}
      <button type="button" className="sh-btn sh-btn-secondary" onClick={onCancel} disabled={loading}>
        {cancelLabel}
      </button>
      <button
        type={formId ? 'submit' : 'button'}
        form={formId}
        className={`sh-btn ${danger ? 'sh-btn-danger' : 'sh-btn-primary'}`}
        onClick={formId ? undefined : onConfirm}
        disabled={disabled || loading}
      >
        {loading && <Loader2 size={16} className="animate-spin" />}
        {confirmLabel}
      </button>
    </>
  );
}
