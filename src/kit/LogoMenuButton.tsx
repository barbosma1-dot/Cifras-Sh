type Props = {
  /** Endereço da logo (ex.: import logo from '/logo.png'). */
  src: string;
  alt: string;
  onClick: () => void;
  /** Texto para leitores de tela. Padrão: "Abrir menu". */
  label?: string;
  expanded?: boolean;
};

/** A logo do app é o botão que abre/fecha o menu (substitui o ícone de "hambúrguer"). */
export function LogoMenuButton({ src, alt, onClick, label = 'Abrir menu', expanded }: Props) {
  return (
    <button type="button" className="sh-logo-btn" onClick={onClick} aria-label={label} aria-expanded={expanded}>
      <img src={src} alt={alt} />
    </button>
  );
}
