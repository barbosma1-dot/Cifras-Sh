import { Repertoire, Chord, ChordBook } from '../types';

// Armazenamento offline de repertórios e cadernos usando IndexedDB.
// Cada registro guarda o repertório/caderno + todas as cifras (com o
// conteúdo/letra) já resolvidas, para que a tela funcione 100% sem rede.
//
// IMPORTANTE: áudios e PDFs/anexos NUNCA são baixados para o dispositivo.
// Só guardamos o texto da cifra (letra/cifrado). Os campos audio_url,
// attachment_url e attachments são removidos antes de salvar (ver
// stripMediaForOffline), então esses arquivos continuam exigindo internet
// mesmo com o caderno salvo offline — isso é proposital, para não lotar o
// armazenamento do celular com mídia pesada.

const DB_NAME = 'cifra-sh-offline';
const DB_VERSION = 2;
const STORE_REPERTOIRES = 'offline_repertoires';
const STORE_CHORDBOOKS = 'offline_chordbooks';

export interface OfflineRepertoireItem extends Chord {
  item_id: string;
  section: string;
  order_index: number;
}

export interface OfflineRepertoireRecord {
  id: string; // repertoire id
  repertoire: Repertoire;
  items: OfflineRepertoireItem[];
  savedAt: string;
}

// Cifra sem os campos de mídia (áudio/anexos) — é isso que fica salvo no
// dispositivo para um caderno offline.
export type OfflineChord = Omit<Chord, 'audio_url' | 'attachment_url' | 'attachments'>;

export interface OfflineChordBookRecord {
  id: string; // chord book id
  chordBook: ChordBook;
  chords: OfflineChord[];
  savedAt: string;
}

/** Remove áudio e anexos (PDF/imagem/texto) antes de gravar offline — esses
 * arquivos continuam disponíveis apenas com internet. */
function stripMediaForOffline(chord: Chord): OfflineChord {
  const { audio_url, attachment_url, attachments, ...rest } = chord;
  return rest;
}

function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('Armazenamento offline não é suportado neste navegador.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_REPERTOIRES)) {
        db.createObjectStore(STORE_REPERTOIRES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHORDBOOKS)) {
        db.createObjectStore(STORE_CHORDBOOKS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const request = action(store);

      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** Salva (ou atualiza) um repertório completo para uso offline. */
export async function saveRepertoireOffline(
  repertoire: Repertoire,
  items: OfflineRepertoireItem[]
): Promise<void> {
  const record: OfflineRepertoireRecord = {
    id: repertoire.id,
    repertoire,
    items,
    savedAt: new Date().toISOString(),
  };
  await runTransaction<IDBValidKey>(STORE_REPERTOIRES, 'readwrite', (store) => store.put(record));
}

/** Busca um repertório salvo offline. Retorna null se não existir ou se der erro. */
export async function getOfflineRepertoire(id: string): Promise<OfflineRepertoireRecord | null> {
  try {
    const result = await runTransaction<OfflineRepertoireRecord | undefined>(
      STORE_REPERTOIRES,
      'readonly',
      (store) => store.get(id)
    );
    return result ?? null;
  } catch (err) {
    console.error('Erro ao ler repertório offline:', err);
    return null;
  }
}

/** Remove um repertório do armazenamento offline. */
export async function removeOfflineRepertoire(id: string): Promise<void> {
  await runTransaction<undefined>(STORE_REPERTOIRES, 'readwrite', (store) => store.delete(id));
}

/** Lista todos os repertórios salvos offline (mais recentes primeiro). */
export async function listOfflineRepertoires(): Promise<OfflineRepertoireRecord[]> {
  try {
    const result = await runTransaction<OfflineRepertoireRecord[]>(STORE_REPERTOIRES, 'readonly', (store) =>
      store.getAll()
    );
    return (result || []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch (err) {
    console.error('Erro ao listar repertórios offline:', err);
    return [];
  }
}

/** Verifica rapidamente se um repertório específico já está salvo offline. */
export async function isRepertoireOffline(id: string): Promise<boolean> {
  const record = await getOfflineRepertoire(id);
  return !!record;
}

// ---------------------------------------------------------------------------
// Cadernos de cifras (ChordBook) offline
// ---------------------------------------------------------------------------

/** Salva (ou atualiza) um caderno completo para uso offline.
 * Áudios, PDFs e demais anexos são descartados de propósito — só o texto
 * das cifras fica disponível sem internet. */
export async function saveChordBookOffline(chordBook: ChordBook, chords: Chord[]): Promise<void> {
  const record: OfflineChordBookRecord = {
    id: chordBook.id,
    chordBook,
    chords: chords.map(stripMediaForOffline),
    savedAt: new Date().toISOString(),
  };
  await runTransaction<IDBValidKey>(STORE_CHORDBOOKS, 'readwrite', (store) => store.put(record));
}

/** Busca um caderno salvo offline. Retorna null se não existir ou se der erro. */
export async function getOfflineChordBook(id: string): Promise<OfflineChordBookRecord | null> {
  try {
    const result = await runTransaction<OfflineChordBookRecord | undefined>(
      STORE_CHORDBOOKS,
      'readonly',
      (store) => store.get(id)
    );
    return result ?? null;
  } catch (err) {
    console.error('Erro ao ler caderno offline:', err);
    return null;
  }
}

/** Remove um caderno do armazenamento offline. */
export async function removeOfflineChordBook(id: string): Promise<void> {
  await runTransaction<undefined>(STORE_CHORDBOOKS, 'readwrite', (store) => store.delete(id));
}

/** Lista todos os cadernos salvos offline (mais recentes primeiro). */
export async function listOfflineChordBooks(): Promise<OfflineChordBookRecord[]> {
  try {
    const result = await runTransaction<OfflineChordBookRecord[]>(STORE_CHORDBOOKS, 'readonly', (store) =>
      store.getAll()
    );
    return (result || []).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch (err) {
    console.error('Erro ao listar cadernos offline:', err);
    return [];
  }
}

/** Verifica rapidamente se um caderno específico já está salvo offline. */
export async function isChordBookOffline(id: string): Promise<boolean> {
  const record = await getOfflineChordBook(id);
  return !!record;
}
