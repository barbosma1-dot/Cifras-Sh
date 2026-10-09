/**
 * Divisão de voz (T5b): quais linhas da cifra cada voz canta.
 * Guardada em `chord_annotations` com `kind = 'voice'` e
 * `payload = { voice, text? }`. `text` só existe quando a voz canta uma
 * letra DIFERENTE da letra principal (senão aparece só a barra colorida).
 */

export type VoiceId = 'tenor' | 'contralto' | 'soprano' | 'baixo' | 'masculino' | 'feminino';

export interface VoiceDef {
  id: VoiceId;
  label: string;
  /** Cor da barra. */
  color: string;
  /** Cor do texto sobre fundo branco (amarelo puro não tem contraste). */
  ink: string;
  /** Cor do marca-texto sobre a sílaba (clara, para a letra continuar legível). */
  hl: string;
}

// Ordem = ordem dos chips.
export const VOICES: VoiceDef[] = [
  { id: 'tenor', label: 'Tenor', color: '#16a34a', ink: '#15803d', hl: '#86efac' }, // verde
  { id: 'contralto', label: 'Contralto', color: '#eab308', ink: '#a16207', hl: '#fde047' }, // amarelo
  { id: 'soprano', label: 'Soprano', color: '#9333ea', ink: '#7e22ce', hl: '#d8b4fe' }, // roxo
  { id: 'baixo', label: 'Baixo', color: '#111827', ink: '#111827', hl: '#9ca3af' }, // preto
  { id: 'masculino', label: 'Masculino', color: '#2563eb', ink: '#1d4ed8', hl: '#93c5fd' }, // azul
  { id: 'feminino', label: 'Feminino', color: '#ec4899', ink: '#be185d', hl: '#f9a8d4' } // rosa
];

const BY_ID = new Map(VOICES.map(v => [v.id, v]));

export function voiceDef(id: VoiceId): VoiceDef {
  return BY_ID.get(id)!;
}

export function isVoiceId(v: unknown): v is VoiceId {
  return typeof v === 'string' && BY_ID.has(v as VoiceId);
}

export const VOICE_TEXT_MAX = 600;

export interface VoicePayload {
  voice: VoiceId | null;
  text: string;
}

/** Lê o payload com segurança (vem do banco, pode estar vazio/errado). */
export function readVoicePayload(payload: unknown): VoicePayload {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  return {
    voice: isVoiceId(p.voice) ? p.voice : null,
    text: typeof p.text === 'string' ? p.text.slice(0, VOICE_TEXT_MAX) : ''
  };
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** A letra digitada difere da letra principal do trecho? (ignora acento, caixa, pontuação e quebras) */
export function lyricDiffers(text: string, mainLyric: string): boolean {
  const t = norm(text);
  return t !== '' && t !== norm(mainLyric);
}

/** Monta o payload a salvar: `text` só entra quando realmente difere. */
export function buildVoicePayload(voice: VoiceId, text: string, mainLyric: string): Record<string, unknown> {
  const clean = text.trim().slice(0, VOICE_TEXT_MAX);
  return lyricDiffers(clean, mainLyric) ? { voice, text: clean } : { voice };
}

export interface VoiceMark {
  id: string;
  voice: VoiceId;
  /** Primeira/última linha do trecho (para rótulo e letra repetida). */
  first: boolean;
  last: boolean;
  /** Letra própria da voz (vazia = canta a letra principal). */
  text: string;
}
