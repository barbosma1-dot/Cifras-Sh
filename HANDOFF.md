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

### T5a — Comentários (título + trecho) com escopo missão/usuário
- Arquivos NOVOS: `T5A_chord_annotations.sql`, `src/lib/chordAnnotations.ts`, `src/components/ChordComments.tsx`
- Arquivo alterado (completo): `src/components/ChordViewer.tsx` (import do hook, `processContent` ganhou o parâmetro opcional `lineDecor`, item "Comentários" no menu ⋮, `{comments.ui}` no fim; em modo de seleção os acordes não abrem o shape).
- Banco: tabela `chord_annotations` (`kind` 'comment'|'voice', `scope` 'user'|'mission', `mission_id`, `title`, `body`, `line_start/line_end` 0-based, `excerpt`, `payload jsonb`). Já pronta para o T5b (voz) sem nova migração. RLS: pessoal só o dono vê (nem o admin); da missão, todo membro lê e só coordenador/editor/admin da missão (ou admin geral) cria/edita/apaga. Visitante de link compartilhado não acessa.
- Fluxo: menu ⋮ → Comentários → "Novo comentário" → tocar na linha (tocar numa segunda amplia o intervalo; terceira toque recomeça) → Continuar → título (obrigatório), nota (opcional), "Só eu" ou "Missão" → Salvar. Linhas comentadas ganham barra lateral (âmbar = só eu, azul = missão, roxo = ambos) e selo com a contagem; tocar no selo abre o comentário. No painel: Ir ao trecho, Editar, Apagar (com confirmação).
- Trecho resiliente: guarda o texto (`excerpt`). Se a cifra for editada e as linhas mudarem, `resolveAnchor` reencontra o trecho (tolerante a acento/caixa/pontuação); se não achar, o comentário continua no painel com aviso "trecho alterado".
- Offline: leitura pelo cache em localStorage (`chord_annotations:<user>:<cifra>`); criar/editar/apagar exige conexão.
- Verificação feita: lógica de ancoragem testada com script (ok/moved/lost/fuzzy/duplicado, 100% passou). `tsc` só acusa ruído por falta dos tipos do React/Supabase (nenhum erro de sintaxe ou nome nos arquivos novos).
- NÃO VERIFICADO: `npm run lint`/`build`, a migração rodando no Supabase e a UI no app real (sem npm/rede aqui).
- Decisões que valem confirmar: (1) membro comum só LÊ comentários da missão (não cria); (2) "trecho" = linhas inteiras, não seleção de palavras; (3) comentário só aparece para quem está logado.
- Testar: rodar `T5A_chord_annotations.sql`; abrir cifra → ⋮ → Comentários → novo (Só eu); repetir com Missão como coordenador; abrir como membro comum e conferir que lê mas não cria na missão; editar a letra da cifra e ver o selo acompanhar; ficar offline e reabrir.

### T5b — Divisão de voz
- Arquivos NOVOS: `src/lib/voiceDivision.ts`, `src/components/AnnotationParts.tsx`, `src/components/ChordVoices.tsx`
- Arquivos alterados (completos): `src/lib/chordAnnotations.ts` (cache por tipo; criar/editar aceitam `kind` e `payload`), `src/components/ChordComments.tsx` (o mesmo hook cuida de comentários e vozes; `ScopeChip` e o seletor "Quem vê" foram para `AnnotationParts.tsx`), `src/components/ChordViewer.tsx` (item "Divisão de voz" no menu ⋮; mais espaço no rodapé quando os chips aparecem).
- Banco: SEM migração nova. Usa `chord_annotations` com `kind='voice'` e `payload = { voice, text? }`; mesma RLS do T5a (só eu / missão).
- Cores: Tenor verde, Contralto amarelo, Soprano roxo, Baixo preto, Masculino azul, Feminino rosa.
- Fluxo: menu ⋮ → Divisão de voz → "Nova divisão" → tocar na linha (ou em duas, para um intervalo) → Continuar → escolher a voz → opcional "Esta voz canta uma letra diferente" → "Só eu" ou "Missão" → Salvar.
- Na cifra: barra colorida sob cada linha da voz, com o nome da voz na primeira linha do trecho. A letra da voz só é repetida (embaixo, na cor da voz) quando difere da letra principal; se o texto digitado for igual ao da cifra (ignorando acento, caixa e pontuação), só a barra é salva.
- Chips (barra fixa no rodapé, só aparecem se a cifra tem divisão): tocar liga/desliga cada voz (escolha lembrada no aparelho, `chord_voice_hidden`). "Foco": destaca uma voz e esmaece as linhas que ela não canta; no foco, tocar num chip troca a voz em destaque.
- Mesmo reancoramento do T5a se a cifra for editada (trecho reencontrado, ou aviso "trecho alterado" no painel). Offline: leitura pelo cache (`chord_annotations_voice:<user>:<cifra>`).
- Verificação feita: lógica de voz testada com script (cores, payload inválido, "letra diferente" ignorando acento/pontuação/quebra, corte de texto) — passou. `tsc` sem erros reais nos arquivos novos (só ruído da falta de tipos do React/Supabase).
- NÃO VERIFICADO: `lint`/`build` completos e a tela rodando no app real (sem npm/rede aqui). Conferir visualmente as barras com várias vozes na mesma linha e os chips em tela pequena.
- Limitações: a voz marca linhas inteiras (não pedaços de linha); a barra ocupa a largura toda da linha; sem exportação das divisões para o PDF.
- Testar: criar divisão de Soprano nas linhas 1–2 e de Tenor na 2–3 (a linha 2 deve mostrar as duas barras); ligar "letra diferente" em uma e ver a letra aparecer sob a barra; desligar chips; usar Foco; abrir como membro comum da missão (lê, não cria na missão); editar a letra da cifra e ver as barras acompanharem.

## Em andamento
- Nada.

## Pendente (ordem)
- T6 Partitura na importação de PDF: detectar páginas, gerar PDF separado (pdf-lib — ainda NÃO está no package.json; adicionar `"pdf-lib": "^1.17.1"`), anexar com `type: 'score'`.

## Migrações SQL a rodar
- `T5A_chord_annotations.sql` (idempotente; cria `chord_annotations`, funções `annotation_*`, trigger e RLS). Serve para T5a e T5b; nada novo para rodar no T5b.

## Riscos e dúvidas
- Build/lint não verificados (ver T1). Comentários e Divisão de voz só funcionam depois da migração T5A. Registro npm e open.spotify.com bloqueados neste ambiente.
