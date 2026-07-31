import { useEffect, useRef } from 'react';

/**
 * Faz o botão físico/gesto de "voltar" do Android fechar uma tela ou modal
 * do APP em vez de sair do PWA — só sai do app quando não há nada "aberto".
 *
 * IMPLEMENTAÇÃO (v2): uma pilha ÚNICA e global de handlers, compartilhada por
 * todos os componentes que usam este hook, com UM SÓ listener de `popstate`
 * registrado uma vez.
 *
 * Por que não é "cada tela empilha sua própria entrada de histórico e chama
 * history.back() ao fechar" (implementação anterior): quando uma tela fecha
 * E outra abre no mesmo instante (ex.: botão "Editar" dentro da visualização
 * de cifra — fecha o Viewer e abre o Editor na mesma função) o
 * `history.back()` do fechamento é ASSÍNCRONO e corria contra o
 * `pushState()` da tela nova abrindo logo depois. Resultado: o `popstate`
 * atrasado do back() disparava DEPOIS que o Editor já tinha registrado seu
 * próprio listener, e era interpretado como "usuário apertou voltar",
 * fechando o Editor imediatamente após abrir.
 *
 * Esta versão nunca chama `history.back()`/`forward()` programaticamente.
 * Ela só empilha UMA entrada de histórico por vez (quando a pilha lógica sai
 * de vazia para não-vazia) e, ao fechar uma tela por qualquer motivo que não
 * seja o botão voltar (clique no X, navegação para outra tela), apenas
 * remove o handler da pilha em memória — sem tocar no histórico do
 * navegador. A entrada física de histórico correspondente fica "sobrando"
 * até o próximo voltar de verdade, o que é inofensivo: ela só garante que
 * ainda exista uma entrada pra interceptar enquanto a pilha lógica não
 * estiver vazia.
 */
type BackHandler = () => void;

const backStack: BackHandler[] = [];
let guardPushed = false;
let listenerRegistered = false;

function ensureGuardPushed() {
  if (!guardPushed) {
    window.history.pushState({ __appBackGuard: true, __depth: backStack.length }, '');
    guardPushed = true;
  }
}

function ensureListener() {
  if (listenerRegistered) return;
  listenerRegistered = true;
  window.addEventListener('popstate', () => {
    // A entrada que motivou este popstate foi consumida pelo navegador —
    // qualquer entrada nossa "sobrando" de fechamentos programáticos
    // anteriores também já era, então tratamos a pilha lógica como fonte de
    // verdade a partir daqui.
    guardPushed = false;
    const handler = backStack.pop();
    if (handler) {
      handler();
    }
    // Ainda há telas abertas na pilha lógica: garante uma entrada de
    // histórico pra interceptar o PRÓXIMO botão voltar também. Se a pilha
    // ficou vazia, não empilha nada — o próximo voltar sai do app mesmo,
    // como esperado.
    if (backStack.length > 0) {
      ensureGuardPushed();
    }
  });
}

export function useBackButton(isActive: boolean, onBack: () => void) {
  const onBackRef = useRef(onBack);
  useEffect(() => { onBackRef.current = onBack; }, [onBack]);

  useEffect(() => {
    if (!isActive) return;

    ensureListener();
    const handler: BackHandler = () => onBackRef.current();
    backStack.push(handler);
    ensureGuardPushed();

    return () => {
      const idx = backStack.lastIndexOf(handler);
      if (idx !== -1) backStack.splice(idx, 1);
      // Deliberadamente NÃO mexe no histórico do navegador aqui — ver
      // explicação no topo do arquivo.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
}
