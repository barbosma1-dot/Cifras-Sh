# HANDOFF — Cifras-Sh (atualizado em 2026-10-09)

## Concluído
### T1 — Botão "Orações Eucarísticas" na seção "Or Eucaristica" do repertório
- Arquivo alterado: `src/components/RepertoireDetail.tsx` (arquivo completo)
- O que mudou: no cabeçalho de cada seção do repertório, se o nome da seção casa com `/eucar/i`, aparece o botão "Orações Eucarísticas" (ícone Heart, laranja) ao lado de "Adicionar". Abre o `LiturgyViewer` com `https://www.catolicoorante.com.br/oeucaristicas.html`, via o `setOpenLiturgyResource` que já existia. Visível também para convidados (`isGuest`).
- Já existia e não foi tocado: botão no `ChordViewer` (detecção por título da cifra) e botão no painel lateral do repertório.
- Como testar: abrir um repertório de Missa com ao menos uma música na seção "Or Eucaristica"; o botão deve aparecer no cabeçalho dessa seção e abrir o visualizador.
- Limitação: seções sem nenhum item não são renderizadas (`if (sectionItems.length === 0) return null`), então o botão só aparece quando a seção tem pelo menos um item. Se quiser o botão mesmo com a seção vazia, é preciso alterar essa condição para a seção Eucarística.
- NÃO VERIFICADO: `npm run lint` e `npm run build` não rodaram. O registro npm não respondeu neste ambiente, então as dependências não foram instaladas. Rodar `npm install && npm run lint && npm run build` localmente.

## Em andamento
- Nada.

## Pendente (ordem)
- T2 Capa do Spotify via oEmbed (`https://open.spotify.com/oembed?url=`); painel Spotify do `ChordViewer` (~linha 1708) e campo do `ChordEditor` (~linha 990). Possível CORS: passar por função em `functions/api/` e `netlify/functions/`.
- T3 Auto rolagem: já existe `scrollSpeed` no `ChordViewer` (~linhas 899 e 1180); revisar UX (play/pausa, velocidade por BPM, pausa ao toque).
- T4 Shape dos acordes (violão/ukulele, SVG, modal ao tocar no acorde, respeitar transposição; `transposeChord` em `ChordViewer` ~linha 115).
- T5a Tabela `chord_annotations` + camada Comentários (título + trecho), escopo missão/usuário, RLS.
- T5b Camada Divisão de voz: Tenor (verde), Contralto (amarelo), Soprano (roxo), Baixo (preto), Masculino (azul), Feminino (rosa); barras sob a letra + letra repetida só quando diferir; chips ligáveis; modo foco.
- T6 Partitura na importação de PDF: detectar páginas, gerar PDF separado (pdf-lib), anexar com `type: 'score'`.

## Migrações SQL a rodar
- Nenhuma até agora.

## Riscos e dúvidas
- Build/lint não verificados (ver T1).
