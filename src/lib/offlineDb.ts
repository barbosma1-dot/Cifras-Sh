import { Repertoire, Chord } from '../types';

// Armazenamento offline de repertórios usando IndexedDB.
// Cada registro guarda o repertório + todas as cifras (com o conteúdo/letra)
// já resolvidas, para que a tela funcione 100% sem rede.

const DB_NAME = 'cifra-sh-offline';
const DB_VERSION = 1;
const STORE_REPERTOIRES = 'offline_repertoires';

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE_REPERTOIRES, mode);
      const store = tx.objectStore(STORE_REPERTOIRES);
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
  await runTransaction<IDBValidKey>('readwrite', (store) => store.put(record));
}

/** Busca um repertório salvo offline. Retorna null se não existir ou se der erro. */
export async function getOfflineRepertoire(id: string): Promise<OfflineRepertoireRecord | null> {
  try {
    const result = await runTransaction<OfflineRepertoireRecord | undefined>('readonly', (store) =>
      store.get(id)
    );
    return result ?? null;
  } catch (err) {
    console.error('Erro ao ler repertório offline:', err);
    return null;
  }
}

/** Remove um repertório do armazenamento offline. */
export async function removeOfflineRepertoire(id: string): Promise<void> {
  await runTransaction<undefined>('readwrite', (store) => store.delete(id));
}

/** Lista todos os repertórios salvos offline (mais recentes primeiro). */
export async function listOfflineRepertoires(): Promise<OfflineRepertoireRecord[]> {
  try {
    const result = await runTransaction<OfflineRepertoireRecord[]>('readonly', (store) =>
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
