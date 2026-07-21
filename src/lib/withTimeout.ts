/**
 * Corre uma promise (ou "thenable", como os retornos do supabase-js) contra um
 * timeout. Se o tempo estourar antes da promise original resolver, rejeita
 * com um erro claro em vez de deixar a tela travada esperando para sempre.
 *
 * Isso é essencial em conexões "falsas" (wifi/4G conectado mas sem internet
 * de verdade), onde o fetch nativo pode demorar dezenas de segundos até
 * falhar sozinho.
 */
export function withTimeout<T>(
  promiseLike: PromiseLike<T>,
  ms: number,
  message = 'Tempo de conexão esgotado.'
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);

    Promise.resolve(promiseLike).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}
