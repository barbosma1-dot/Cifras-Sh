import { useState, useEffect, useRef } from 'react';
import { useBackButton } from '../hooks/useBackButton';
import {
  X,
  Settings2,
  Youtube,
  Play,
  Pause,
  ArrowLeft,
  ArrowRight,
  Type,
  Maximize2,
  Minimize2,
  Music2,
  Volume2,
  MousePointer2,
  ChevronUp,
  ChevronDown,
  Layout,
  PlusSquare,
  BookText,
  Check,
  Loader2,
  FileDown,
  Music,
  FileText,
  Pencil
} from 'lucide-react';
import { Chord, ChordBook } from '../types';
import {
  motion,
  AnimatePresence
} from 'motion/react';
import { supabase } from '../lib/supabase';

// Ícone da "logo" do Spotify (círculo + três ondas), desenhado como SVG
// próprio — a mesma ideia de usar um ícone de marca pra indicar visualmente
// "isto abre o Spotify" (igual ao ícone `Youtube` do lucide-react já usado
// ao lado, que também é só uma representação/identificação da marca, não
// uma imagem oficial baixada do Spotify).
function SpotifyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} xmlns="http://www.w3.org/2000/svg">
      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.72-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// MELHORIAS PARA MELLODIAS ALTERNATIVAS
// ---------------------------------------------------------------------------

/**
 * Detecta os marcadores preservados pelo importador de Laudes.
 *
 * Exemplos:
 *
 * — 1ª Opção —
 * — 2ª Opção —
 * — Opção Canto 34 e 600 —
 * — Miserere (Salmo 50) —
 */
function getMelodyOptionLabel(
  line: string
): string | null {
  const plain =
    line
      .replace(
        /\[[^\]]*\]/g,
        ''
      )
      .replace(
        /^[\s—–-]+|[\s—–-]+$/g,
        ''
      )
      .trim();

  if (!plain) {
    return null;
  }

  const normalized =
    plain
      .normalize('NFD')
      .replace(
        /[\u0300-\u036f]/g,
        ''
      )
      .toLowerCase();

  if (
    /^\d+[ºªa]?\s+opcao$/.test(
      normalized
    ) ||
    /^opcao\s+.+/.test(
      normalized
    ) ||
    /^miserere\s*\(\s*salmo\s*50/.test(
      normalized
    )
  ) {
    return plain;
  }

  return null;
}

// ---------------------------------------------------------------------------
// TRANSPOSE / NOTATION
// ---------------------------------------------------------------------------

function transposeChord(
  chord: string,
  semitones: number,
  useFlats: boolean,
  notation:
    | 'english'
    | 'latin'
) {
  const notesEnglish = [
    'C',
    'C#',
    'D',
    'D#',
    'E',
    'F',
    'F#',
    'G',
    'G#',
    'A',
    'A#',
    'B'
  ];

  const notesEnglishFlat = [
    'C',
    'Db',
    'D',
    'Eb',
    'E',
    'F',
    'Gb',
    'G',
    'Ab',
    'A',
    'Bb',
    'B'
  ];

  const notesLatin = [
    'Dó',
    'Dó#',
    'Ré',
    'Ré#',
    'Mi',
    'Fá',
    'Fá#',
    'Sol',
    'Sol#',
    'Lá',
    'Lá#',
    'Si'
  ];

  const notesLatinFlat = [
    'Dó',
    'Réb',
    'Ré',
    'Mib',
    'Mi',
    'Fá',
    'Solb',
    'Sol',
    'Láb',
    'Lá',
    'Sib',
    'Si'
  ];

  return chord.replace(
    /[A-G][b#]?|Dó[#]?|Ré[b#]?|Mi[b]?|Fá[#]?|Sol[b#]?|Lá[b#]?|Si[b]?/g,
    match => {
      const findIndex =
        (m: string) => {
          let idx =
            notesEnglish.indexOf(m);

          if (idx === -1) {
            idx =
              notesEnglishFlat.indexOf(
                m
              );
          }

          if (idx === -1) {
            idx =
              notesLatin.indexOf(m);
          }

          if (idx === -1) {
            idx =
              notesLatinFlat.indexOf(m);
          }

          return idx;
        };

      const index =
        findIndex(match);

      if (index === -1) {
        return match;
      }

      let newIndex =
        (index + semitones) % 12;

      if (newIndex < 0) {
        newIndex += 12;
      }

      if (
        notation === 'latin'
      ) {
        return useFlats
          ? notesLatinFlat[
              newIndex
            ]
          : notesLatin[
              newIndex
            ];
      }

      return useFlats
        ? notesEnglishFlat[
            newIndex
          ]
        : notesEnglish[
            newIndex
          ];
    }
  );
}

// ---------------------------------------------------------------------------
// PROCESSAMENTO DO CONTEÚDO
// ---------------------------------------------------------------------------

function processContent(
  content: string,
  semitones: number,
  useFlats: boolean,
  showChords: boolean,
  notation:
    | 'english'
    | 'latin',
  fontSize: number,
  lineSpacing: number
) {
  const lines =
    content.split('\n');

  let insideChorus = false;

  type LineInfo = {
    isChorus: boolean;
    skip: boolean;
    el: JSX.Element | null;
  };

  const lineInfos:
    LineInfo[] = [];

  lines.forEach(
    (line, i) => {
      /*
       * ================================================================
       * NOVO:
       * MELLODIAS ALTERNATIVAS SÃO RENDERIZADAS COMO SEPARADORES.
       * ================================================================
       */
      const melodyOption =
        getMelodyOptionLabel(
          line
        );

      if (melodyOption) {
        lineInfos.push({
          isChorus: false,
          skip: false,
          el: (
            <div
              key={i}
              className="
                my-4
                rounded-xl
                border
                border-brand-orange/30
                bg-orange-50
                px-3
                py-2
                text-center
              "
            >
              <div
                className="
                  text-[10px]
                  font-black
                  uppercase
                  tracking-widest
                  text-brand-orange
                "
              >
                Melodia alternativa
              </div>

              <div
                className="
                  mt-0.5
                  text-sm
                  font-extrabold
                  text-slate-800
                "
              >
                {melodyOption}
              </div>
            </div>
          )
        });

        return;
      }

      const strippedLower =
        line
          .replace(
            /\[.*?\]/g,
            ''
          )
          .trim()
          .toLowerCase();

      const isChorusStart =
        /^(refrão|refrao|coro|chorus)\b/.test(
          strippedLower
        );

      const isChorusEnd =
        /^(fim|end)\b/.test(
          strippedLower
        );

      const isOtherSectionLabel =
        /^(estrofe|verso|intro|solo|ponte|final|instrumental|vocalize|inst|passagem|dedilhado|ritmo)\b\s*:?\s*$/.test(
          strippedLower
        );

      const isDoubleBlank =
        strippedLower === '' &&
        i > 0 &&
        lines[i - 1].trim() === '';

      if (isChorusStart) {
        insideChorus = true;
      } else if (
        isChorusEnd ||
        isOtherSectionLabel ||
        isDoubleBlank
      ) {
        insideChorus = false;
      }

      if (isChorusEnd) {
        lineInfos.push({
          isChorus: false,
          skip: true,
          el: null
        });

        return;
      }

      const isChorus =
        insideChorus;

      const hasChordPro =
        line.includes('[') &&
        line.includes(']');

      if (hasChordPro) {
        if (!showChords) {
          lineInfos.push({
            isChorus,
            skip: false,
            el: (
              <div
                key={i}
                className="lyrics-line"
                style={{
                  paddingBottom:
                    `${lineSpacing * 0.3}em`
                }}
              >
                {line.replace(
                  /\[.*?\]/g,
                  ''
                )}
              </div>
            )
          });

          return;
        }

        const segments: {
          chord: string;
          text: string;
        }[] = [];

        const parts =
          line.split(
            /(\[.*?\])/g
          );

        let currentChord = '';

        for (
          const part of parts
        ) {
          if (
            part.startsWith('[') &&
            part.endsWith(']')
          ) {
            currentChord =
              part.slice(
                1,
                -1
              );
          } else {
            segments.push({
              chord:
                currentChord,
              text: part
            });

            currentChord = '';
          }
        }

        lineInfos.push({
          isChorus,
          skip: false,
          el: (
            <div
              key={i}
              className="
                chord-pro-line
                flex
                flex-wrap
                items-start
              "
              style={{
                marginBottom:
                  `${lineSpacing * 0.5}em`
              }}
            >
              {segments.map(
                (
                  seg,
                  sidx
                ) => {
                  const chordLabel =
                    seg.chord
                      ? transposeChord(
                          seg.chord,
                          semitones,
                          useFlats,
                          notation
                        )
                      : '';

                  const minWidth =
                    chordLabel
                      ? `${chordLabel.length + 1}ch`
                      : undefined;

                  return (
                    <div
                      key={sidx}
                      className="
                        flex
                        flex-col
                      "
                      style={{
                        minWidth,
                        marginRight:
                          chordLabel
                            ? '0.35em'
                            : 0
                      }}
                    >
                      <span
                        className="
                          text-brand-orange
                          font-bold
                          text-[0.85em]
                          leading-none
                          h-[1.2em]
                          whitespace-pre
                        "
                      >
                        {chordLabel ||
                          '\u00A0'}
                      </span>

                      <span
                        className="
                          lyrics-text
                          whitespace-pre
                        "
                      >
                        {seg.text ||
                          (
                            sidx ===
                            segments.length - 1
                              ? ''
                              : '\u00A0'
                          )}
                      </span>
                    </div>
                  );
                }
              )}
            </div>
          )
        });

        return;
      }

      const isChordLine =
        /^\s*([A-G][b#]?[m7majdimaugsus0-9/]*\s+)*[A-G][b#]?[m7majdimaugsus0-9/]*\s*$/.test(
          line
        );

      if (isChordLine) {
        if (!showChords) {
          lineInfos.push({
            isChorus,
            skip: true,
            el: null
          });

          return;
        }

        const transposed =
          transposeChord(
            line,
            semitones,
            useFlats,
            notation
          );

        lineInfos.push({
          isChorus,
          skip: false,
          el: (
            <div
              key={i}
              className="
                chord-line
                font-bold
                text-brand-orange
              "
              style={{
                height: '1.2em'
              }}
            >
              {transposed}
            </div>
          )
        });

        return;
      }

      lineInfos.push({
        isChorus,
        skip: false,
        el: (
          <div
            key={i}
            className="lyrics-line"
            style={{
              paddingBottom:
                `${lineSpacing * 0.3}em`
            }}
          >
            {line}
          </div>
        )
      });
    }
  );

  /*
   * Agrupa o refrão.
   */
  const elements:
    JSX.Element[] = [];

  let i = 0;
  let groupIdx = 0;

  while (
    i < lineInfos.length
  ) {
    const info =
      lineInfos[i];

    if (info.skip) {
      i++;
      continue;
    }

    if (info.isChorus) {
      const group:
        JSX.Element[] = [];

      while (
        i < lineInfos.length &&
        lineInfos[i].isChorus
      ) {
        if (
          !lineInfos[i].skip &&
          lineInfos[i].el
        ) {
          group.push(
            lineInfos[i]
              .el as JSX.Element
          );
        }

        i++;
      }

      if (
        group.length > 0
      ) {
        elements.push(
          <div
            key={`chorus-${groupIdx++}`}
            className="
              font-bold
              border-l-4
              border-brand-orange
              bg-orange-50/50
              rounded-r-2xl
              pl-3
              pr-3
              py-3
              my-3
            "
          >
            {group}
          </div>
        );
      }
    } else {
      if (info.el) {
        elements.push(
          info.el
        );
      }

      i++;
    }
  }

  return elements;
}

// Tom só de um item de repertório específico (não da cifra global) — ver
// RepertoireItem.display_key em types.ts.
type ChordWithDisplayKey = Chord & { display_key?: string | null };

interface ChordViewerProps {
  chord: ChordWithDisplayKey;
  onClose: () => void;
  allChords?: ChordWithDisplayKey[];
  onSwitchChord?: (
    c: ChordWithDisplayKey
  ) => void;
  onEdit?: (
    chord: ChordWithDisplayKey
  ) => void;
}

/** Índice (0-11) da nota, aceitando nomenclatura em inglês/latina, sustenido/bemol.
 * Ignora sufixos como "m" (menor) — só a fundamental importa pro transporte. */
function getNoteIndex(key: string): number {
  const notesEnglish = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const notesEnglishFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const notesLatin = ['Dó', 'Dó#', 'Ré', 'Ré#', 'Mi', 'Fá', 'Fá#', 'Sol', 'Sol#', 'Lá', 'Lá#', 'Si'];
  const notesLatinFlat = ['Dó', 'Réb', 'Ré', 'Mib', 'Mi', 'Fá', 'Solb', 'Sol', 'Láb', 'Lá', 'Sib', 'Si'];

  const match = key.trim().match(
    /^([A-G][b#]?|Dó[#]?|Ré[b#]?|Mi[b]?|Fá[#]?|Sol[b#]?|Lá[b#]?|Si[b]?)/
  );
  const note = match ? match[1] : key.trim();

  let idx = notesEnglish.indexOf(note);
  if (idx === -1) idx = notesEnglishFlat.indexOf(note);
  if (idx === -1) idx = notesLatin.indexOf(note);
  if (idx === -1) idx = notesLatinFlat.indexOf(note);
  return idx;
}

/** Diferença em semitons entre o tom original da cifra e o tom desejado
 * (ex.: tom deste repertório). Retorna 0 se algum dos dois não for reconhecido. */
function getSemitoneDiff(originalKey: string | undefined, targetKey: string | undefined): number {
  if (!originalKey || !targetKey) return 0;
  const from = getNoteIndex(originalKey);
  const to = getNoteIndex(targetKey);
  if (from === -1 || to === -1) return 0;
  return ((to - from) % 12 + 12) % 12;
}

/** Converte um link do YouTube (watch?v=, youtu.be/, shorts/, ou já embed)
 * numa URL de embed. Retorna null se não conseguir reconhecer o formato
 * (nesse caso o botão cai pra um link "abrir no YouTube"). */
function extractYoutubeVideoId(url: string): string | null {
  try {
    const m = url.match(
      /(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/
    );
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function getYoutubeEmbedUrl(url: string): string | null {
  const id = extractYoutubeVideoId(url);
  // modestbranding+rel=0 reduzem a marca do YouTube nos controles do player,
  // mas o card de "Assista no YouTube" com os ícones de compartilhar/assistir
  // mais tarde que aparece ANTES de dar play em faixas de canais "Tópicos"
  // (áudio oficial gerado automaticamente pelo YouTube/selo/gravadora) é
  // controlado pelo dono do vídeo e pelo próprio YouTube dentro do iframe —
  // como é um domínio diferente (cross-origin), não tem como o nosso site
  // enxergar ou substituir esses botões por outros nossos.
  return id ? `https://www.youtube.com/embed/${id}?modestbranding=1&rel=0` : null;
}

/** Link da página normal (não embed) do vídeo no YouTube — é lá que existe o
 * botão nativo "Salvar" (adicionar a uma playlist), que não está disponível
 * dentro do player embutido. */
function getYoutubeWatchUrl(url: string): string | null {
  const id = extractYoutubeVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

/** Converte um link do Spotify (track, album ou playlist) numa URL de embed
 * oficial (open.spotify.com/embed/...) — toca direto no app, sem precisar de
 * chave de API (é o player público do Spotify). Retorna null se não
 * reconhecer o formato (cai pro link "abrir no Spotify"). */
function getSpotifyEmbedUrl(url: string): string | null {
  try {
    const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([a-zA-Z0-9]+)/);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
    return null;
  } catch {
    return null;
  }
}

export default function ChordViewer({
  chord,
  onClose,
  allChords,
  onSwitchChord,
  onEdit
}: ChordViewerProps) {
  useBackButton(
    true,
    onClose
  );

  const [
    semitones,
    setSemitones
  ] = useState(() => getSemitoneDiff(chord.original_key, chord.display_key ?? undefined));

  // Ao trocar de música (ex.: navegando pelo repertório com onSwitchChord),
  // reaplica o tom certo pra cada uma: o do repertório (display_key), se
  // houver, senão o original da própria cifra.
  useEffect(() => {
    setSemitones(getSemitoneDiff(chord.original_key, chord.display_key ?? undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chord.id, chord.display_key]);

  const [
    useFlats,
    setUseFlats
  ] = useState(false);

  const [
    notationSystem,
    setNotationSystem
  ] = useState<
    'english' | 'latin'
  >('english');

  const [
    fontSize,
    setFontSize
  ] = useState(16);

  const [
    lineSpacing,
    setLineSpacing
  ] = useState(1.5);

  const [
    columns,
    setColumns
  ] = useState(false);

  const [
    showChords,
    setShowChords
  ] = useState(true);

  const [
    showYoutube,
    setShowYoutube
  ] = useState(false);

  const [
    showSpotify,
    setShowSpotify
  ] = useState(false);

  const [
    showMedia,
    setShowMedia
  ] = useState(false);

  const [
    showBookSelector,
    setShowBookSelector
  ] = useState(false);

  const [
    userBooks,
    setUserBooks
  ] = useState<ChordBook[]>(
    []
  );

  const [
    loadingBooks,
    setLoadingBooks
  ] = useState(false);

  const [
    addingToBook,
    setAddingToBook
  ] = useState<
    string | null
  >(null);

  const [
    notification,
    setNotification
  ] = useState<{
    message: string;
    type:
      | 'success'
      | 'error';
  } | null>(null);

  const [
    scrollSpeed,
    setScrollSpeed
  ] = useState(0);

  // Metrônomo: toca o beat pelo alto-falante/fone do celular, usando o BPM e
  // compasso cadastrados na cifra. Usa Web Audio API com um agendador
  // "lookahead" para manter o tempo preciso mesmo com o app em segundo plano.
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [metronomeBpm, setMetronomeBpm] = useState(chord.bpm || 96);
  const metronomeBpmRef = useRef(metronomeBpm);
  useEffect(() => {
    metronomeBpmRef.current = metronomeBpm;
  }, [metronomeBpm]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const nextNoteTimeRef = useRef(0);
  const currentBeatRef = useRef(0);
  const metronomeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setMetronomeBpm(chord.bpm || 96);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chord.id]);

  const beatsPerMeasure = (() => {
    const num = parseInt((chord.time_signature || '4/4').split('/')[0], 10);
    return Number.isFinite(num) && num > 0 ? num : 4;
  })();

  const scheduleClick = (beatNumber: number, time: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const isAccent = beatNumber % beatsPerMeasure === 0;
    osc.frequency.value = isAccent ? 1500 : 1000;
    gain.gain.setValueAtTime(isAccent ? 0.5 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  };

  const metronomeScheduler = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const scheduleAheadTime = 0.1; // segundos
    while (nextNoteTimeRef.current < ctx.currentTime + scheduleAheadTime) {
      scheduleClick(currentBeatRef.current, nextNoteTimeRef.current);
      const secondsPerBeat = 60.0 / metronomeBpmRef.current;
      nextNoteTimeRef.current += secondsPerBeat;
      currentBeatRef.current = (currentBeatRef.current + 1) % beatsPerMeasure;
    }
    metronomeTimerRef.current = window.setTimeout(metronomeScheduler, 25);
  };

  const toggleMetronome = () => {
    if (metronomeOn) {
      setMetronomeOn(false);
      if (metronomeTimerRef.current) {
        clearTimeout(metronomeTimerRef.current);
        metronomeTimerRef.current = null;
      }
      audioCtxRef.current?.close();
      audioCtxRef.current = null;
      return;
    }
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;
    currentBeatRef.current = 0;
    nextNoteTimeRef.current = ctx.currentTime + 0.05;
    setMetronomeOn(true);
    metronomeScheduler();
  };

  // Ao trocar de música ou fechar a tela, garante que o metrônomo pare.
  useEffect(() => {
    return () => {
      if (metronomeTimerRef.current) clearTimeout(metronomeTimerRef.current);
      audioCtxRef.current?.close();
    };
  }, []);

  // Ao trocar de música, para o metrônomo (o BPM/compasso mudam de uma
  // cifra pra outra, então não faz sentido manter o clique tocando).
  useEffect(() => {
    if (metronomeTimerRef.current) {
      clearTimeout(metronomeTimerRef.current);
      metronomeTimerRef.current = null;
    }
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    setMetronomeOn(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chord.id]);

  const [
    showTools,
    setShowTools
  ] = useState(false);

  const [
    immersive,
    setImmersive
  ] = useState(false);

  const scrollRef =
    useRef<HTMLDivElement>(
      null
    );

  useEffect(() => {
    if (notification) {
      const timer =
        setTimeout(
          () =>
            setNotification(
              null
            ),
          3000
        );

      return () =>
        clearTimeout(timer);
    }
  }, [
    notification
  ]);

  useEffect(() => {
    if (
      showBookSelector
    ) {
      fetchUserBooks();
    }
  }, [
    showBookSelector
  ]);

  async function fetchUserBooks() {
    setLoadingBooks(true);

    try {
      const {
        data: { user }
      } =
        await supabase.auth.getUser();

      if (!user) return;

      const {
        data,
        error
      } =
        await supabase.rpc(
          'get_accessible_chord_books',
          {
            p_user_id:
              user.id
          }
        );

      if (error) {
        const {
          data: fallback
        } =
          await supabase
            .from(
              'chord_books'
            )
            .select('*');

        setUserBooks(
          fallback || []
        );
      } else {
        setUserBooks(
          data
        );
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBooks(
        false
      );
    }
  }

  const handleAddToBook =
    async (
      bookId: string
    ) => {
      setAddingToBook(
        bookId
      );

      try {
        const { error } =
          await supabase
            .from(
              'chord_book_items'
            )
            .insert([
              {
                book_id:
                  bookId,
                chord_id:
                  chord.id
              }
            ]);

        if (
          error &&
          error.code !==
            '23505'
        ) {
          throw error;
        }

        setNotification({
          message:
            'Cifra adicionada!',
          type:
            'success'
        });

        setTimeout(
          () =>
            setAddingToBook(
              null
            ),
          1000
        );
      } catch (err) {
        console.error(err);

        setNotification({
          message:
            'Erro ao adicionar cifra ao caderno',
          type:
            'error'
        });

        setAddingToBook(
          null
        );
      }
    };

  const currentIndex =
    allChords?.findIndex(
      c =>
        c.id ===
        chord.id
    ) ?? -1;

  useEffect(() => {
    if (
      scrollSpeed === 0
    ) {
      return;
    }

    const interval =
      setInterval(() => {
        if (
          scrollRef.current
        ) {
          scrollRef.current.scrollTop +=
            1;
        }
      }, 100 / scrollSpeed);

    return () =>
      clearInterval(
        interval
      );
  }, [
    scrollSpeed
  ]);

  const handleNext =
    () => {
      if (
        allChords &&
        currentIndex <
          allChords.length - 1
      ) {
        onSwitchChord?.(
          allChords[
            currentIndex + 1
          ]
        );

        setSemitones(0);

        if (
          scrollRef.current
        ) {
          scrollRef.current.scrollTop = 0;
        }
      }
    };

  const nextChord =
    allChords &&
    currentIndex <
      allChords.length - 1
      ? allChords[
          currentIndex + 1
        ]
      : null;

  const handlePrev =
    () => {
      if (
        allChords &&
        currentIndex > 0
      ) {
        onSwitchChord?.(
          allChords[
            currentIndex - 1
          ]
        );

        setSemitones(0);
      }
    };

  return (
    <motion.div
      initial={{
        opacity: 0
      }}
      animate={{
        opacity: 1
      }}
      className="
        fixed
        inset-0
        z-[60]
        bg-white
        flex
        flex-col
      "
    >
      {/* O restante da interface original do ChordViewer permanece igual. */}

      {/* Botão de sair do modo imersivo/tela cheia — antes não existia
          NENHUMA forma de sair (o header com o botão de fechar fica
          escondido junto com o resto quando `immersive` liga), então uma
          vez dentro só dava pra sair fechando a aba/voltando pelo sistema.
          Fica bem discreto (alta transparência) pra não atrapalhar a
          leitura, mas sempre visível e clicável num canto fixo. */}
      <AnimatePresence>
        {immersive && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.35 }}
            whileHover={{ opacity: 0.9 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setImmersive(false)}
            title="Sair da tela cheia"
            className="
              fixed
              top-3
              right-3
              z-[70]
              p-2.5
              rounded-full
              bg-black/40
              text-white
              backdrop-blur-sm
              shadow-lg
            "
          >
            <Minimize2 className="w-5 h-5" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Header Controls */}
      <AnimatePresence>
        {!immersive && (
          <motion.div
            initial={{
              opacity: 0,
              y: -20
            }}
            animate={{
              opacity: 1,
              y: 0
            }}
            exit={{
              opacity: 0,
              y: -20
            }}
            transition={{
              duration: 0.2
            }}
            className="
              bg-brand-blue
              text-white
              shrink-0
              px-3
              md:px-8
              pt-3
              pb-2
              md:py-4
              flex
              flex-col
              gap-2
            "
          >
            <div className="flex items-center gap-3">
              <button
                onClick={
                  onClose
                }
                className="
                  p-2
                  hover:bg-white/10
                  rounded-lg
                  shrink-0
                "
              >
                <ArrowLeft
                  className="w-6 h-6"
                />
              </button>

              <div className="min-w-0 flex-1">
                <h2 className="font-bold text-lg leading-tight truncate">
                  {chord.title || 'Sem música definida'}
                </h2>

                <p className="text-xs text-white/60 truncate">
                  {chord.artist}
                  {allChords && allChords.length > 1 && currentIndex > -1 && (
                    <span className="text-white/40"> · {currentIndex + 1} de {allChords.length}</span>
                  )}
                </p>
              </div>

              <button
                onClick={() =>
                  setImmersive(
                    true
                  )
                }
                className="
                  p-2
                  rounded-lg
                  transition-colors
                  hover:bg-white/10
                  shrink-0
                "
                title="Ocultar Menus"
              >
                <Maximize2
                  className="w-6 h-6"
                />
              </button>

              <button
                onClick={() =>
                  setShowTools(
                    !showTools
                  )
                }
                className={`
                  p-2
                  rounded-lg
                  transition-colors
                  shrink-0
                  ${
                    showTools
                      ? 'bg-brand-orange text-white'
                      : 'hover:bg-white/10'
                  }
                `}
                title="Ferramentas"
              >
                <Settings2
                  className="w-6 h-6"
                />
              </button>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 flex-wrap min-w-0">
                {chord.category
                  ?.split(',')
                  .map(cat => (
                    <span
                      key={cat}
                      className="
                        text-[8px]
                        font-black
                        bg-white/20
                        text-white
                        px-1.5
                        py-0.5
                        rounded
                        uppercase
                        tracking-wider
                        whitespace-nowrap
                      "
                    >
                      {cat.trim()}
                    </span>
                  ))}
              </div>

              <div className="
                flex
                items-center
                gap-1
                overflow-x-auto
                no-scrollbar
                shrink-0
                max-w-full
              ">
                {onEdit && (
                  <button
                    onClick={() =>
                      onEdit(
                        chord
                      )
                    }
                    className="
                      p-2
                      rounded-lg
                      transition-colors
                      hover:bg-white/10
                      shrink-0
                    "
                    title="Editar Cifra"
                  >
                    <Pencil
                      className="w-6 h-6"
                    />
                  </button>
                )}

                <button
                  onClick={() =>
                    setShowChords(
                      !showChords
                    )
                  }
                  className={`
                    p-2
                    rounded-lg
                    transition-all
                    flex
                    items-center
                    gap-2
                    shrink-0
                    ${
                      showChords
                        ? 'bg-brand-orange text-white'
                        : 'hover:bg-white/10 text-white'
                    }
                  `}
                  title={
                    showChords
                      ? 'Ocultar Cifras'
                      : 'Exibir Cifras'
                  }
                >
                  {showChords ? (
                    <Music2 className="w-6 h-6" />
                  ) : (
                    <BookText className="w-6 h-6" />
                  )}
                </button>

                <button
                  onClick={() =>
                    setShowBookSelector(
                      !showBookSelector
                    )
                  }
                  className={`
                    p-2
                    rounded-lg
                    transition-colors
                    shrink-0
                    ${
                      showBookSelector
                        ? 'bg-white text-brand-blue'
                        : 'hover:bg-white/10'
                    }
                  `}
                  title="Adicionar ao Caderno"
                >
                  <PlusSquare
                    className="w-6 h-6"
                  />
                </button>

                {chord.youtube_url && (
                  <button
                    onClick={() =>
                      setShowYoutube(
                        !showYoutube
                      )
                    }
                    className={`
                      p-2
                      rounded-lg
                      transition-colors
                      shrink-0
                      ${
                        showYoutube
                          ? 'bg-red-500 text-white'
                          : 'hover:bg-white/10'
                      }
                    `}
                    title="YouTube"
                  >
                    <Youtube
                      className="w-6 h-6"
                    />
                  </button>
                )}

                {chord.spotify_url && (
                  <button
                    onClick={() => setShowSpotify(!showSpotify)}
                    className={`
                      p-2
                      rounded-lg
                      transition-colors
                      shrink-0
                      ${
                        showSpotify
                          ? 'bg-[#1DB954] text-white'
                          : 'hover:bg-white/10'
                      }
                    `}
                    title="Spotify"
                  >
                    <SpotifyIcon
                      className="w-6 h-6"
                    />
                  </button>
                )}

                {(
                  chord.audio_url ||
                  chord.attachment_url ||
                  (
                    Array.isArray(
                      chord.attachments
                    ) &&
                    chord.attachments
                      .length > 0
                  )
                ) && (
                  <button
                    onClick={() =>
                      setShowMedia(
                        !showMedia
                      )
                    }
                    className={`
                      p-2
                      rounded-lg
                      transition-colors
                      shrink-0
                      ${
                        showMedia
                          ? 'bg-emerald-500 text-white'
                          : 'hover:bg-white/10'
                      }
                    `}
                    title="Mídias e Anexos"
                  >
                    <Music
                      className="w-6 h-6"
                    />
                  </button>
                )}

                <div className="
                  hidden
                  md:flex
                  gap-1
                  bg-white/10
                  p-1
                  rounded-xl
                  shrink-0
                ">
                  <button
                    onClick={() =>
                      setSemitones(
                        s =>
                          s - 1
                      )
                    }
                    className="
                      px-3
                      py-1
                      hover:bg-white/10
                      rounded-lg
                      text-sm
                      font-bold
                    "
                  >
                    -
                  </button>

                  <span className="
                    px-2
                    py-1
                    text-xs
                    font-mono
                    bg-brand-orange
                    rounded-lg
                    min-w-[3rem]
                    text-center
                  ">
                    {semitones > 0
                      ? '+'
                      : ''}
                    {semitones}
                    {' '}
                    ST
                  </span>

                  <button
                    onClick={() =>
                      setSemitones(
                        s =>
                          s + 1
                      )
                    }
                    className="
                      px-3
                      py-1
                      hover:bg-white/10
                      rounded-lg
                      text-sm
                      font-bold
                    "
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel de Ferramentas — o botão da engrenagem (Settings2) só
          trocava a própria cor até agora; não existia nenhum painel ligado
          a `showTools`. Aqui entram os controles que no desktop já existiam
          (fixos, "hidden md:flex") mas no celular não tinham como ser
          acessados: transpor, tamanho da fonte, espaçamento, notação,
          sustenido/bemol e colunas. */}
      <AnimatePresence>
        {showTools && !immersive && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-slate-800 text-white"
          >
            {/* Navegar entre as músicas do repertório: mesmo painel do
                controle de tom, para não sobrepor o texto da cifra. */}
            {allChords && allChords.length > 1 && (
              <div className="px-4 pt-4 flex justify-center">
                <div className="flex items-center gap-2 bg-white/10 rounded-xl p-1">
                  <button
                    onClick={handlePrev}
                    disabled={currentIndex <= 0}
                    title={currentIndex > 0 ? `Anterior: ${allChords[currentIndex - 1].title}` : undefined}
                    className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <span className="px-2 py-1 text-xs font-mono bg-brand-orange rounded-lg min-w-[4.5rem] text-center">
                    {currentIndex + 1} de {allChords.length}
                  </span>
                  <button
                    onClick={handleNext}
                    disabled={!nextChord}
                    title={nextChord ? `Próxima: ${nextChord.title}` : undefined}
                    className="p-1.5 hover:bg-white/10 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            <div className="p-4 flex justify-center md:hidden">
              <div className="flex items-center gap-1 bg-white/10 rounded-xl p-1">
                <button
                  onClick={() => setSemitones(s => s - 1)}
                  className="px-3 py-1.5 hover:bg-white/10 rounded-lg text-sm font-bold"
                >
                  -
                </button>
                <span className="px-2 py-1 text-xs font-mono bg-brand-orange rounded-lg min-w-[3rem] text-center">
                  {semitones > 0 ? '+' : ''}{semitones} ST
                </span>
                <button
                  onClick={() => setSemitones(s => s + 1)}
                  className="px-3 py-1.5 hover:bg-white/10 rounded-lg text-sm font-bold"
                >
                  +
                </button>
              </div>
            </div>

            {/* Metrônomo: toca o beat pelo alto-falante/fone, no BPM e
                compasso cadastrados na cifra. Só aparece se a cifra tiver
                um BPM salvo. */}
            {!!chord.bpm && (
              <div className="px-4 pb-4 flex justify-center">
                <div className="flex items-center gap-2 bg-white/10 rounded-xl p-1">
                  <button
                    onClick={toggleMetronome}
                    className={`p-1.5 rounded-lg ${metronomeOn ? 'bg-brand-orange text-white' : 'hover:bg-white/10'}`}
                    title={metronomeOn ? 'Parar metrônomo' : 'Tocar metrônomo'}
                  >
                    {metronomeOn ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </button>
                  <button
                    onClick={() => setMetronomeBpm(b => Math.max(20, b - 1))}
                    className="px-2 py-1.5 hover:bg-white/10 rounded-lg text-sm font-bold"
                  >
                    -
                  </button>
                  <span className="px-2 py-1 text-xs font-mono bg-white/10 rounded-lg min-w-[4.5rem] text-center">
                    {metronomeBpm} BPM
                  </span>
                  <button
                    onClick={() => setMetronomeBpm(b => Math.min(300, b + 1))}
                    className="px-2 py-1.5 hover:bg-white/10 rounded-lg text-sm font-bold"
                  >
                    +
                  </button>
                  <span className="px-2 py-1 text-[10px] font-mono text-white/60">
                    {chord.time_signature || '4/4'}
                  </span>
                </div>
              </div>
            )}

            <div className="px-4 pb-4 grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center justify-between bg-white/10 rounded-xl px-3 py-2">
                <span className="font-bold">Fonte</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setFontSize(s => Math.max(10, s - 1))} className="px-2 py-0.5 hover:bg-white/20 rounded font-bold">-</button>
                  <span className="font-mono w-8 text-center">{fontSize}px</span>
                  <button onClick={() => setFontSize(s => Math.min(32, s + 1))} className="px-2 py-0.5 hover:bg-white/20 rounded font-bold">+</button>
                </div>
              </div>

              <div className="flex items-center justify-between bg-white/10 rounded-xl px-3 py-2">
                <span className="font-bold">Espaço</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => setLineSpacing(s => Math.max(1, Math.round((s - 0.1) * 10) / 10))} className="px-2 py-0.5 hover:bg-white/20 rounded font-bold">-</button>
                  <span className="font-mono w-8 text-center">{lineSpacing.toFixed(1)}</span>
                  <button onClick={() => setLineSpacing(s => Math.min(3, Math.round((s + 0.1) * 10) / 10))} className="px-2 py-0.5 hover:bg-white/20 rounded font-bold">+</button>
                </div>
              </div>

              <button
                onClick={() => setNotationSystem(n => n === 'english' ? 'latin' : 'english')}
                className="flex items-center justify-between bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 font-bold"
              >
                <span>Notação</span>
                <span className="font-mono">{notationSystem === 'english' ? 'C D E' : 'Dó Ré Mi'}</span>
              </button>

              <button
                onClick={() => setUseFlats(f => !f)}
                className="flex items-center justify-between bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 font-bold"
              >
                <span>Acidentes</span>
                <span className="font-mono">{useFlats ? 'Bemóis' : 'Sustenidos'}</span>
              </button>

              <button
                onClick={() => setColumns(c => !c)}
                className="col-span-2 flex items-center justify-between bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 font-bold"
              >
                <span>Duas colunas</span>
                <span className="font-mono">{columns ? 'Ativado' : 'Desativado'}</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel do YouTube — mesmo caso: `showYoutube` só mudava a cor do
          próprio botão, sem nenhum vídeo embutido em lugar nenhum. */}
      <AnimatePresence>
        {showYoutube && chord.youtube_url && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-black"
          >
            <div className="aspect-video max-w-2xl mx-auto">
              {getYoutubeEmbedUrl(chord.youtube_url) ? (
                <iframe
                  src={getYoutubeEmbedUrl(chord.youtube_url) as string}
                  className="w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  title="YouTube"
                />
              ) : (
                <a
                  href={chord.youtube_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center h-full text-white underline text-sm"
                >
                  Abrir vídeo no YouTube
                </a>
              )}
            </div>
            {/* O botão nativo de "assistir mais tarde"/compartilhar que
                aparece dentro do player embutido é do próprio YouTube — não
                dá pra trocar por um botão nosso (vídeo de outro domínio,
                dentro de um iframe). Este botão abaixo abre a página real do
                vídeo no YouTube, onde existe o botão "Salvar" de verdade
                para adicionar a uma playlist. */}
            {getYoutubeWatchUrl(chord.youtube_url) && (
              <div className="max-w-2xl mx-auto px-2 pb-2 pt-1 bg-black">
                <a
                  href={getYoutubeWatchUrl(chord.youtube_url) as string}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl transition-colors"
                >
                  <Youtube className="w-4 h-4" />
                  Adicionar a uma playlist no YouTube
                </a>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel do Spotify — mesma ideia do painel do YouTube acima, com o
          player público de embed do próprio Spotify (não precisa de chave
          de API pra tocar prévia/faixa completa de quem tem o app/conta). */}
      <AnimatePresence>
        {showSpotify && chord.spotify_url && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-black"
          >
            <div className="max-w-2xl mx-auto p-2">
              {getSpotifyEmbedUrl(chord.spotify_url) ? (
                <iframe
                  src={getSpotifyEmbedUrl(chord.spotify_url) as string}
                  className="w-full rounded-xl"
                  height="352"
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  title="Spotify"
                />
              ) : (
                <a
                  href={chord.spotify_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center h-20 text-white underline text-sm"
                >
                  Abrir no Spotify
                </a>
              )}
              {/* O player embutido do Spotify não tem botão de "adicionar à
                  playlist" (limitação da própria plataforma, igual ao
                  YouTube acima). Este botão abre a faixa na página real do
                  Spotify, onde dá pra usar o "..." → "Adicionar à playlist"
                  (inclusive criar uma nova ali mesmo). */}
              <a
                href={chord.spotify_url}
                target="_blank"
                rel="noreferrer"
                className="mt-2 flex items-center justify-center gap-2 py-2.5 bg-[#1DB954] hover:bg-[#1ed760] text-white font-bold text-xs rounded-xl transition-colors"
              >
                <SpotifyIcon className="w-4 h-4" />
                Criar ou adicionar à playlist no Spotify
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Painel de Mídias e Anexos — mesmo caso de `showMedia`, sem nenhum
          conteúdo ligado ao estado até agora. */}
      <AnimatePresence>
        {showMedia && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden bg-slate-800 text-white"
          >
            {/* Botão de fechar fixo — com muitos áudios/anexos na lista (caso
                de "ver todos os arquivos relacionados"), o painel fica mais
                alto que a tela e o botão de alternar lá em cima (ícone verde
                na barra de ferramentas) sai de vista ao rolar pra baixo. Sem
                nenhum controle de fechar dentro do próprio painel, não tinha
                como "desligar" essa tela sem rolar de volta até o topo. Este
                botão é `fixed`, então continua alcançável em qualquer ponto
                da rolagem — mesma ideia do botão de sair do modo imersivo
                logo acima. */}
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMedia(false)}
              title="Fechar mídias e anexos"
              className="
                fixed
                bottom-4
                right-4
                z-[70]
                p-3
                rounded-full
                bg-emerald-600
                text-white
                shadow-lg
                hover:bg-emerald-700
                transition-colors
              "
            >
              <X className="w-5 h-5" />
            </motion.button>

            <div className="p-4 space-y-3">
              {chord.audio_url && (
                <div>
                  <p className="text-[10px] font-bold text-white/60 uppercase mb-1">Áudio</p>
                  <audio controls src={chord.audio_url} className="w-full" />
                </div>
              )}
              {chord.attachment_url && (
                <a
                  href={chord.attachment_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 text-sm font-bold"
                >
                  <FileText className="w-4 h-4" /> Abrir anexo
                </a>
              )}
              {Array.isArray(chord.attachments) && chord.attachments.map((att, i) => (
                <div key={att.id || i}>
                  {att.type === 'audio' ? (
                    <div>
                      <p className="text-[10px] font-bold text-white/60 uppercase mb-1">{att.name}</p>
                      <audio controls src={att.url} className="w-full" />
                    </div>
                  ) : (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-2 text-sm font-bold"
                    >
                      <FileText className="w-4 h-4" /> {att.name}
                    </a>
                  )}
                </div>
              ))}
              {!chord.audio_url && !chord.attachment_url && (!chord.attachments || chord.attachments.length === 0) && (
                <p className="text-white/50 text-sm text-center py-2">Nenhuma mídia anexada.</p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Conteúdo do viewer */}
      <div
        ref={scrollRef}
        className="
          flex-1
          overflow-y-auto
          px-4
          md:px-8
          py-5
        "
      >
        <div
          className={
            columns
              ? 'max-w-6xl mx-auto columns-2 gap-8'
              : 'max-w-4xl mx-auto'
          }
          style={{
            fontSize:
              `${fontSize}px`,
            lineHeight:
              lineSpacing
          }}
        >
          {chord.content ? (
            processContent(
              chord.content,
              semitones,
              useFlats,
              showChords,
              notationSystem,
              fontSize,
              lineSpacing
            )
          ) : (
            // Antes, uma cifra sem `content` (seção do repertório ainda sem
            // música definida, ou cifra removida da biblioteca) caía aqui e
            // ficava tudo em branco, sem nenhuma explicação — pior ainda pra
            // quem abre o link público sem estar logado, sem acesso a nenhum
            // outro contexto do app.
            <div className="flex flex-col items-center justify-center text-center py-16 text-white/50">
              <Music className="w-8 h-8 mb-3 opacity-60" />
              <p className="font-bold text-white/70">Nenhuma letra ou cifra disponível</p>
              <p className="text-sm mt-1">Essa música ainda não foi definida para esta seção do repertório.</p>
            </div>
          )}

          {/* Botão para avançar para a próxima música do repertório/caderno,
              posicionado logo após a letra — some quando não há próxima. */}
          {nextChord && (
            <button
              onClick={handleNext}
              className="
                w-full
                mt-10
                mb-4
                flex
                items-center
                justify-between
                gap-3
                bg-brand-blue
                hover:bg-brand-blue/90
                rounded-2xl
                px-5
                py-4
                text-left
                shadow-lg
                shadow-brand-blue/20
                transition-colors
              "
            >
              <div className="overflow-hidden">
                <p className="text-[10px] font-bold text-white/70 uppercase tracking-wider">
                  Próxima música
                </p>
                <p className="font-bold text-white truncate">
                  {nextChord.title}
                </p>
              </div>
              <ArrowRight className="w-5 h-5 text-white shrink-0" />
            </button>
          )}
        </div>
      </div>

      {/* Controles inferiores e demais painéis da versão original continuam
          funcionando normalmente. */}

      {/* Modal "Adicionar ao Caderno" — `showBookSelector` já buscava os
          cadernos (fetchUserBooks) e `handleAddToBook` já salvava, mas não
          havia nenhuma tela que os usasse. */}
      {showBookSelector && (
        <div
          className="fixed inset-0 z-[170] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowBookSelector(false)}
        >
          <div
            className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-black text-slate-800 mb-4">Adicionar ao Caderno</h3>
            {loadingBooks ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-brand-blue" />
              </div>
            ) : userBooks.length === 0 ? (
              <p className="text-slate-400 text-sm text-center py-4">Você ainda não tem nenhum caderno.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto custom-scrollbar">
                {userBooks.map(book => (
                  <button
                    key={book.id}
                    onClick={() => handleAddToBook(book.id)}
                    disabled={addingToBook === book.id}
                    className="w-full flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100 rounded-xl text-left font-bold text-slate-700 disabled:opacity-50 transition-colors"
                  >
                    {book.name}
                    {addingToBook === book.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-brand-blue" />
                    ) : (
                      <Check className="w-4 h-4 text-slate-300" />
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowBookSelector(false)}
              className="w-full mt-4 py-2.5 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Notificação — o estado e o timer de auto-fechar já existiam, mas
          nada renderizava a mensagem na tela. */}
      {notification && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] px-5 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-4 flex items-center gap-2 font-bold text-sm ${
          notification.type === 'success' ? 'bg-emerald-500 text-white border-emerald-400' : 'bg-red-500 text-white border-red-400'
        }`}>
          {notification.message}
        </div>
      )}
    </motion.div>
  );
}
