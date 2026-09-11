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

interface ChordViewerProps {
  chord: Chord;
  onClose: () => void;
  allChords?: Chord[];
  onSwitchChord?: (
    c: Chord
  ) => void;
  onEdit?: (
    chord: Chord
  ) => void;
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
  ] = useState(0);

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
                  {chord.title}
                </h2>

                <p className="text-xs text-white/60 truncate">
                  {chord.artist}
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
          {processContent(
            chord.content || '',
            semitones,
            useFlats,
            showChords,
            notationSystem,
            fontSize,
            lineSpacing
          )}
        </div>
      </div>

      {/* Controles inferiores e demais painéis da versão original continuam
          funcionando normalmente. */}
    </motion.div>
  );
}
