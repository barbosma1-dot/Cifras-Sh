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

## Em andamento
- Nada.

## Pendente (ordem)
- T3 Auto rolagem: já existe `scrollSpeed` no `ChordViewer` (~linhas 899 e 1180); revisar UX (play/pausa, velocidade por BPM, pausa ao toque).
- T4 Shape dos acordes (violão/ukulele, SVG, modal ao tocar no acorde, respeitar transposição; `transposeChord` em `ChordViewer` ~linha 115).
- T5a Tabela `chord_annotations` + camada Comentários (título + trecho), escopo missão/usuário, RLS.
- T5b Camada Divisão de voz: Tenor (verde), Contralto (amarelo), Soprano (roxo), Baixo (preto), Masculino (azul), Feminino (rosa); barras sob a letra + letra repetida só quando diferir; chips ligáveis; modo foco.
- T6 Partitura na importação de PDF: detectar páginas, gerar PDF separado (pdf-lib), anexar com `type: 'score'`.

## Migrações SQL a rodar
- Nenhuma até agora.

## Riscos e dúvidas
- Build/lint não verificados (ver T1). Registro npm e open.spotify.com bloqueados neste ambiente.
