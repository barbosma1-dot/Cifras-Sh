# HANDOFF — Cifras-Sh (atualizado em 2026-10-09)

## Concluído
### T1 — Botão "Orações Eucarísticas" na seção "Or Eucaristica" do repertório
- Arquivo alterado: `src/components/RepertoireDetail.tsx` (arquivo completo)
- O que mudou: no cabeçalho de cada seção do repertório, se o nome da seção casa com `/eucar/i`, aparece o botão "Orações Eucarísticas" (ícone Heart, laranja) ao lado de "Adicionar". Abre o `LiturgyViewer` com `https://www.catolicoorante.com.br/oeucaristicas.html`, via o `setOpenLiturgyResource` que já existia. Visível também para convidados (`isGuest`).
- Já existia e não foi tocado: botão no `ChordViewer` (detecção por título da cifra) e botão no painel lateral do repertório.
- Como testar: abrir um repertório de Missa com ao menos uma música na seção "Or Eucaristica"; o botão deve aparecer no cabeçalho dessa seção e abrir o visualizador.
- Limitação: seções sem nenhum item não são renderizadas (`if (sectionItems.length === 0) return null`), então o botão só aparece quando a seção tem pelo menos um item. Se quiser o botão mesmo com a seção vazia, é preciso alterar essa condição para a seção Eucarística.
- NÃO VERIFICADO: `npm run lint` e `npm run build` não rodaram. O registro npm não respondeu neste ambiente, então as dependências não foram instaladas. Rodar `npm install && npm run lint && npm run build` localmente.

### T2 — Capa do Spotify
- Arquivos NOVOS: `src/lib/spotifyCover.ts`, `functions/api/spotify-oembed.ts`
- Arquivos alterados (completos): `src/components/ChordViewer.tsx`, `src/components/ChordEditor.tsx`, `vite.config.ts`
- Funcionamento: `fetchSpotifyCover(url)` usa cache em localStorage; senão busca `https://open.spotify.com/oembed?url=` direto; se falhar (CORS), usa `/api/spotify-oembed` (Cloudflare Pages Function, só aceita links open.spotify.com). Sem capa = tela segue normal.
- UI: painel do Spotify no `ChordViewer` mostra capa + título acima do player; `ChordEditor` mostra prévia da capa abaixo do campo "Link Spotify" (espera de 600 ms ao digitar).
- PWA: `vite.config.ts` ganhou regra CacheFirst `spotify-covers` (i.scdn.co e spotifycdn.com) para a capa aparecer offline após a primeira vez.
- NÃO VERIFICADO: o oEmbed do Spotify não pôde ser testado aqui (rede bloqueada), então não sei se a busca direta passa por CORS; o fallback pela função cobre isso. Também faltam `lint`/`build`.
- Não feito: função equivalente em `netlify/functions/` (o deploy atual é Cloudflare Pages, que usa `functions/api/`). Só criar se voltar a usar Netlify.
- Testar: editar uma cifra, colar `https://open.spotify.com/track/...` e ver a capa; abrir a cifra, tocar no ícone do Spotify e ver capa + título; depois ficar offline e reabrir.

### T3 — Auto rolagem
- Arquivo alterado (completo): `src/components/ChordViewer.tsx`
- Diagnóstico: o `scrollSpeed` antigo nunca tinha botão (ninguém chamava `setScrollSpeed`) e usava `scrollTop += 1` em `setInterval`, que não anda em celulares com rolagem fracionária. Foi substituído.
- Agora: estados `autoScrollOn` e `autoScrollLevel` (1–10, salvo em localStorage `chord_autoscroll_level`); motor com `requestAnimationFrame` e acumulador fracionário (nível 1 ≈ 13 px/s, nível 10 ≈ 76 px/s); pausa enquanto toca/arrasta ou usa a roda do mouse e retoma ~1,2 s depois; para sozinho no fim da cifra; desliga ao trocar de cifra.
- UI: pílula flutuante inferior (play/pausa, −, nível, +), visível também no modo imersivo; a área de rolagem ganhou `pb-24` para a última linha não ficar atrás da pílula.
- Não feito (decisão): sugerir velocidade pelo BPM — não há relação direta entre BPM e leitura; fica como melhoria futura se você quiser definir uma regra.
- Testar: abrir uma cifra longa, tocar em play, mudar a velocidade, tocar na tela (deve pausar e retomar), chegar ao fim (para sozinho), trocar de cifra (desliga). Testar no celular.
- NÃO VERIFICADO: lint/build (npm indisponível aqui) e teste real em dispositivo.

### T4 — Shape dos acordes (violão e ukulele)
- Arquivos NOVOS: `src/lib/chordShapes.ts`, `src/components/ChordDiagram.tsx`, `src/components/ChordShapeModal.tsx`, `scripts/checkChordShapes.ts`
- Arquivo alterado (completo): `src/components/ChordViewer.tsx` (importa o modal; `processContent` ganhou o parâmetro opcional `onChordClick`; acordes inline `[C]` e linhas só de acordes viram botões; estado `shapeChord`).
- Funcionamento: toque num acorde → modal com nome, notas, abas Violão/Ukulele (escolha salva em localStorage `chord_shape_instrument`) e diagrama SVG (× abafada, ○ solta, ● dedo, barra = pestana, número da casa quando passa da 5ª). O acorde chega já transposto e na notação escolhida (inglesa/latina), então acompanha a transposição.
- Motor (`chordShapes.ts`): `parseChord` aceita inglês e latim ("Dó#m7/Sol"), bemol/sustenido, barra e sinônimos (maj7/M7/7M/Δ, dim/°, aug/+, sus, add9…). Formas por deslocamento de formas base (E, A, C, D, G no violão; C, A, F, G, D no ukulele); tipos sem forma base (ukulele dim/aug/6/m6/add9/9/dim7/m7b5, violão dim7/m7b5) usam busca exaustiva da forma mais fácil. Sufixo desconhecido (ex.: C13) mostra a forma mais próxima com aviso. Baixo de acorde com barra: usa forma cujo grave bate; senão mostra o acorde base com aviso "toque essa nota no baixo".
- Verificação feita: `bun scripts/checkChordShapes.ts` → 382 formas conferidas (12 fundamentais × 16 tipos × 2 instrumentos), 0 com nota fora do acorde ou nota essencial faltando; só `5` (power chord) no ukulele (A#5, B5) fica sem desenho, de propósito. Diagramas renderizados em Chromium e conferidos visualmente (violão e ukulele).
- Limitações: não mostra dedilhado (qual dedo), só posições; não há "canhoto"; só uma forma por acorde (sem alternativas); violão sem 11/13 (cai em 7).
- NÃO VERIFICADO: `lint`/`build` completos (npm indisponível; o `tsc` isolado só acusou erros por falta dos tipos do React, nenhum no código novo) e o modal rodando no app real.
- Testar: abrir uma cifra com acordes, tocar num acorde (inline e em linha só de acordes), trocar Violão/Ukulele, transpor o tom e tocar de novo, trocar para notação latina, fechar com o botão voltar do celular.

## Em andamento
- Nada.

## Pendente (ordem)
- T5a Tabela `chord_annotations` + camada Comentários (título + trecho), escopo missão/usuário, RLS.
- T5b Camada Divisão de voz: Tenor (verde), Contralto (amarelo), Soprano (roxo), Baixo (preto), Masculino (azul), Feminino (rosa); barras sob a letra + letra repetida só quando diferir; chips ligáveis; modo foco.
- T6 Partitura na importação de PDF: detectar páginas, gerar PDF separado (pdf-lib — ainda NÃO está no package.json; adicionar `"pdf-lib": "^1.17.1"`), anexar com `type: 'score'`.

## Migrações SQL a rodar
- Nenhuma até agora.

## Riscos e dúvidas
- Build/lint não verificados (ver T1). Registro npm e open.spotify.com bloqueados neste ambiente.
