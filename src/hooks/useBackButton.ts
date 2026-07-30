import { useEffect, useRef } from 'react';

/**
 * Faz o botão físico/gesto de "voltar" do Android fechar uma tela ou modal
 * do APP em vez de sair do PWA — só sai do app quando não há nada "aberto"
 * (ou seja, quando não há nenhum useBackButton ativo no momento).
 *
 * Como funciona: como o app não usa rotas de URL de verdade (é tudo estado
 * de React), a gente simula uma "pilha" usando o histórico do navegador.
 * Quando `isActive` fica true, empilha UMA entrada de histórico. O botão
 * voltar do Android sempre dispara o evento `popstate` do navegador ANTES de
 * fechar o app — então, se ainda temos uma entrada nossa empilhada, a gente
 * intercepta esse evento e chama `onBack()` (fecha a tela/modal) em vez de
 * deixar o navegador continuar e o Android fechar o app. Quando não há
 * nenhuma tela "aberta" com este hook, não empilhamos nada, e o botão voltar
 * volta a se comportar normalmente (sai do app), exatamente como pedido.
 *
 * Uso: dentro do componente do modal/tela, chame
 *   useBackButton(isOpen, () => setIsOpen(false));
 * — funciona tanto para "tela cheia" (ex.: ChordViewer, edição de cifra)
 * quanto para modais (ex.: Importador de PDF, Duplicadas).
 */
export function useBackButton(isActive: boolean, onBack: () => void) {
  // Guarda a versão mais recente de onBack sem precisar re-executar o efeito
  // de pushState toda vez que a função mudar de identidade entre renders.
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!isActive) return;

    window.history.pushState({ __appBackGuard: true }, '');

    const handlePopState = () => {
      onBackRef.current();
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      // Se a tela foi fechada por outro motivo que não o botão voltar (ex.:
      // clique no "X", clique fora do modal), a entrada que empilhamos ainda
      // está lá — sem isso, o PRÓXIMO toque no botão voltar só "consumiria"
      // essa entrada fantasma sem fazer nada visível, e o usuário precisaria
      // apertar voltar duas vezes. `history.back()` consome essa entrada
      // programaticamente pra manter a pilha limpa.
      if (window.history.state?.__appBackGuard) {
        window.history.back();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
}
