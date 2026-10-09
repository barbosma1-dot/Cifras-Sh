/**
 * Detecção de páginas de PARTITURA em PDFs (T6).
 *
 * Como funciona: renderiza a página em baixa resolução, converte para tons de
 * cinza e procura PENTAGRAMAS — grupos de 5 linhas horizontais longas,
 * finas e com espaçamento igual entre si. Funciona tanto para PDF digital
 * (linhas vetoriais) quanto para página escaneada/foto, porque olha para os
 * pixels, não para a estrutura do PDF.
 *
 * `findStaves` é uma função pura (só recebe pixels) para poder ser testada
 * fora do navegador. `detectScorePage` é o invólucro que renderiza a página
 * com o PDF.js.
 */

export interface StaffGroup {
  /** y (px) da 1ª e da 5ª linha do pentagrama */
  top: number;
  bottom: number;
}

export interface FindStavesOptions {
  /** Pixel mais escuro que isto conta como "tinta" (0–255). */
  darkThreshold?: number;
  /** Largura mínima da linha, como fração da largura da página. */
  minLineWidthFrac?: number;
  /** Espaço em branco (px) tolerado dentro de uma mesma linha. */
  maxGapPx?: number;
  /** Espessura máxima (px) de uma linha de pentagrama. */
  maxLineThicknessPx?: number;
  /** Espaçamento mínimo/máximo (px) entre as 5 linhas. */
  minSpacingPx?: number;
  maxSpacingPx?: number;
  /** Quanto o espaçamento pode variar dentro do mesmo pentagrama (fração). */
  spacingTolerance?: number;
  /**
   * O pentagrama precisa estar ISOLADO: a distância até a linha vizinha de
   * cima/de baixo deve ser pelo menos este múltiplo do espaçamento interno.
   * É o que separa uma partitura de uma folha pautada ou tabela, onde as
   * linhas continuam com o mesmo espaçamento.
   */
  isolationFactor?: number;
  /**
   * Páginas escaneadas costumam sair levemente tortas: tenta também
   * inclinações de até ±maxSkewDeg graus, em passos de skewStepDeg.
   */
  maxSkewDeg?: number;
  skewStepDeg?: number;
}

const DEFAULTS: Required<FindStavesOptions> = {
  darkThreshold: 150,
  minLineWidthFrac: 0.25,
  maxGapPx: 3,
  maxLineThicknessPx: 4,
  minSpacingPx: 2.5,
  maxSpacingPx: 16,
  spacingTolerance: 0.3,
  isolationFactor: 1.8,
  maxSkewDeg: 2,
  skewStepDeg: 0.5,
};

/**
 * Maior sequência de pixels escuros ao longo de uma linha (possivelmente
 * inclinada: `slope` = tan do ângulo), tolerando pequenos buracos.
 */
function longestDarkRun(
  gray: ArrayLike<number>,
  y: number,
  width: number,
  height: number,
  slope: number,
  threshold: number,
  maxGap: number
): number {
  let best = 0;
  let runStart = -1;
  let lastDark = -1;
  const half = width / 2;
  for (let x = 0; x < width; x++) {
    const yy = slope === 0 ? y : y + Math.round((x - half) * slope);
    const dark = yy >= 0 && yy < height && gray[yy * width + x] < threshold;
    if (dark) {
      if (runStart === -1) runStart = x;
      lastDark = x;
    } else if (runStart !== -1 && x - lastDark > maxGap) {
      best = Math.max(best, lastDark - runStart + 1);
      runStart = -1;
    }
  }
  if (runStart !== -1) best = Math.max(best, lastDark - runStart + 1);
  return best;
}

function findStavesAtSlope(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  o: Required<FindStavesOptions>,
  slope: number
): StaffGroup[] {
  const minRun = Math.max(20, Math.floor(width * o.minLineWidthFrac));

  // 1) linhas (y) que têm um traço horizontal longo
  const rowIsLine: boolean[] = new Array(height).fill(false);
  for (let y = 0; y < height; y++) {
    rowIsLine[y] =
      longestDarkRun(gray, y, width, height, slope, o.darkThreshold, o.maxGapPx) >= minRun;
  }

  // 2) junta linhas vizinhas (uma linha de pentagrama ocupa 1–3 px);
  //    blocos grossos (faixas pretas, caixas preenchidas) são descartados
  const centers: number[] = [];
  let y = 0;
  while (y < height) {
    if (!rowIsLine[y]) {
      y++;
      continue;
    }
    let end = y;
    while (end + 1 < height && rowIsLine[end + 1]) end++;
    const thickness = end - y + 1;
    if (thickness <= o.maxLineThicknessPx) centers.push((y + end) / 2);
    y = end + 1;
  }

  // 3) grupos de 5 linhas com espaçamento parecido
  const staves: StaffGroup[] = [];
  let i = 0;
  while (i + 4 < centers.length) {
    const gaps = [
      centers[i + 1] - centers[i],
      centers[i + 2] - centers[i + 1],
      centers[i + 3] - centers[i + 2],
      centers[i + 4] - centers[i + 3],
    ];
    const mean = gaps.reduce((a, b) => a + b, 0) / 4;
    const gapBefore = i > 0 ? centers[i] - centers[i - 1] : Infinity;
    const gapAfter = i + 5 < centers.length ? centers[i + 5] - centers[i + 4] : Infinity;
    const ok =
      mean >= o.minSpacingPx &&
      mean <= o.maxSpacingPx &&
      gaps.every(g => Math.abs(g - mean) <= mean * o.spacingTolerance) &&
      gapBefore >= mean * o.isolationFactor &&
      gapAfter >= mean * o.isolationFactor;
    if (ok) {
      staves.push({ top: centers[i], bottom: centers[i + 4] });
      i += 5; // não reaproveita linhas de um pentagrama já contado
    } else {
      i += 1;
    }
  }
  return staves;
}

/**
 * Procura pentagramas numa imagem em tons de cinza (1 byte por pixel,
 * linha por linha). Devolve a posição vertical de cada um. Testa primeiro a
 * página reta e, se não bastar, pequenas inclinações (scan torto); para assim
 * que achar pentagramas suficientes (3+), senão devolve a melhor tentativa.
 */
export function findStaves(
  gray: ArrayLike<number>,
  width: number,
  height: number,
  options: FindStavesOptions = {}
): StaffGroup[] {
  const o = { ...DEFAULTS, ...options };
  const angles: number[] = [0];
  for (let a = o.skewStepDeg; a <= o.maxSkewDeg + 1e-9; a += o.skewStepDeg) {
    angles.push(a, -a);
  }
  let best: StaffGroup[] = [];
  for (const deg of angles) {
    const found = findStavesAtSlope(gray, width, height, o, Math.tan((deg * Math.PI) / 180));
    if (found.length > best.length) best = found;
    if (best.length >= 3) break;
  }
  return best;
}

/** Quantos pentagramas a página precisa ter para ser tratada como partitura. */
export const MIN_STAVES_FOR_SCORE_PAGE = 2;

/** Escala de renderização usada na detecção (1.5 ≈ 108 dpi). */
export const SCORE_DETECT_SCALE = 1.5;

export interface ScoreDetection {
  isScore: boolean;
  staves: number;
}

/**
 * Renderiza a página do PDF.js e conta os pentagramas. Em caso de erro
 * (sem canvas, página corrompida) devolve "não é partitura" — a detecção é
 * sempre "melhor esforço" e nunca deve travar a importação.
 */
export async function detectScorePage(
  page: any,
  minStaves: number = MIN_STAVES_FOR_SCORE_PAGE
): Promise<ScoreDetection> {
  try {
    const viewport = page.getViewport({ scale: SCORE_DETECT_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { isScore: false, staves: 0 };

    // fundo branco: páginas com transparência viram "pretas" sem isto
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport } as any).promise;

    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let p = 0, q = 0; p < data.length; p += 4, q++) {
      gray[q] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
    }

    // libera memória do canvas (importante em PDFs de centenas de páginas)
    canvas.width = 0;
    canvas.height = 0;

    const staves = findStaves(gray, Math.ceil(viewport.width), Math.ceil(viewport.height)).length;
    return { isScore: staves >= minStaves, staves };
  } catch (err) {
    console.warn('Detecção de partitura falhou nesta página (ignorada):', err);
    return { isScore: false, staves: 0 };
  }
}
