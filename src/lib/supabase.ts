/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
export { supabaseUrl };

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('missing-url')) {
  console.error('CRITICAL: Supabase credentials missing or invalid. Check your environment variables.');
  if (typeof window !== 'undefined') {
    // We can't use alert in iframe safely but we can log clearly
    console.log('%c STOP! Supabase is not configured. %c Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.', 'color: white; background: red; font-size: 20px', 'color: red; font-size: 14px');
  }
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    }
  }
);

// O Supabase/PostgREST devolve no máximo 1000 linhas por requisição por
// padrão — silenciosamente, sem erro nenhum. Com mais de 1000 cifras salvas,
// um `.select('*').order('title')` simples corta o resto da lista sem
// avisar; como a ordenação é alfabética por título, isso aparecia como
// "sumiram as músicas depois da letra R" (ou qualquer letra em que o caderno
// passasse de 1000 itens), quando na verdade elas continuam salvas no banco
// — só não estavam sendo buscadas.
//
// `fetchAllRows` pagina em blocos de 1000 usando `.range()`, repetindo a
// busca até uma página voltar incompleta (ou vazia), garantindo que TODAS as
// linhas sejam carregadas, não só as primeiras 1000. Uso:
//
//   const { data, error } = await fetchAllRows<Chord>((from, to) =>
//     supabase.from('chords').select('*').order('title').range(from, to)
//   );
const SUPABASE_PAGE_SIZE = 1000;

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: any; error: any }>
): Promise<{ data: T[]; error: any }> {
  let all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await buildQuery(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) return { data: all, error };
    const batch = (data as T[]) || [];
    all = all.concat(batch);
    if (batch.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return { data: all, error: null };
}
