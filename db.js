/**
 * ============================================================
 *  REFUGIOS PWA — Motor de Base de Datos Local (IndexedDB)
 *  Gestiona almacenamiento offline de registros, usuarios y cola de sync
 * ============================================================
 */

const DB_NAME = 'RefugiosPWA';
const DB_VERSION = 1;

const STORE_REGISTROS   = 'registros';
const STORE_USUARIOS    = 'usuarios';
const STORE_COLA_SYNC   = 'cola_sync';
const STORE_CONFIG      = 'config';

let _db = null;

/**
 * Abre (o crea) la base de datos IndexedDB
 */
function abrirDB() {
  return new Promise((resolve, reject) => {
    if (_db) { resolve(_db); return; }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Tabla de registros de refugiados
      if (!db.objectStoreNames.contains(STORE_REGISTROS)) {
        const storeReg = db.createObjectStore(STORE_REGISTROS, { keyPath: 'localId', autoIncrement: true });
        storeReg.createIndex('ci', 'ci', { unique: false });
        storeReg.createIndex('syncStatus', 'syncStatus', { unique: false });
        storeReg.createIndex('fechaRegistro', 'fechaRegistro', { unique: false });
      }

      // Tabla de usuarios (para login offline)
      if (!db.objectStoreNames.contains(STORE_USUARIOS)) {
        db.createObjectStore(STORE_USUARIOS, { keyPath: 'usuario' });
      }

      // Cola de sincronización pendiente
      if (!db.objectStoreNames.contains(STORE_COLA_SYNC)) {
        db.createObjectStore(STORE_COLA_SYNC, { keyPath: 'id', autoIncrement: true });
      }

      // Configuración de la app
      if (!db.objectStoreNames.contains(STORE_CONFIG)) {
        db.createObjectStore(STORE_CONFIG, { keyPath: 'clave' });
      }
    };

    req.onsuccess = (event) => {
      _db = event.target.result;
      resolve(_db);
    };

    req.onerror = (event) => {
      console.error('[DB] Error al abrir IndexedDB:', event.target.error);
      reject(event.target.error);
    };
  });
}

/**
 * Ejecuta una transacción y devuelve una promesa
 */
function txn(storeName, mode, callback) {
  return abrirDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = callback(store);
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror  = () => reject(req.error);
      } else {
        tx.oncomplete = () => resolve();
        tx.onerror    = () => reject(tx.error);
      }
    });
  });
}

// ─── USUARIOS ──────────────────────────────────────────────

/**
 * Guarda/actualiza credenciales del usuario en local para login offline
 * @param {Object} usuario - { usuario, nombre, rol, passHash }
 */
function db_guardarUsuario(usuario) {
  return txn(STORE_USUARIOS, 'readwrite', store => store.put(usuario));
}

/**
 * Obtiene credenciales del usuario por nombre de usuario
 */
function db_obtenerUsuario(username) {
  return txn(STORE_USUARIOS, 'readonly', store => store.get(username));
}

/**
 * Obtiene todos los usuarios locales
 */
function db_obtenerTodosUsuarios() {
  return txn(STORE_USUARIOS, 'readonly', store => store.getAll());
}

// ─── REGISTROS ─────────────────────────────────────────────

/**
 * Guarda un registro localmente con estado de sincronización
 */
function db_guardarRegistro(data) {
  const registro = {
    ...data,
    syncStatus: 'pendiente', // 'pendiente' | 'sincronizado'
    localId: undefined, // autoincrement
    fechaLocal: new Date().toISOString()
  };
  return txn(STORE_REGISTROS, 'readwrite', store => store.add(registro));
}

/**
 * Obtiene todos los registros locales (sincronizados y pendientes)
 */
function db_obtenerTodosRegistros() {
  return txn(STORE_REGISTROS, 'readonly', store => store.getAll());
}

/**
 * Obtiene solo los registros pendientes de sincronización
 */
function db_obtenerPendientes() {
  return abrirDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_REGISTROS, 'readonly');
      const store = tx.objectStore(STORE_REGISTROS);
      const idx = store.index('syncStatus');
      const req = idx.getAll('pendiente');
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  });
}

/**
 * Marca un registro como sincronizado
 */
function db_marcarSincronizado(localId) {
  return abrirDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_REGISTROS, 'readwrite');
      const store = tx.objectStore(STORE_REGISTROS);
      const req = store.get(localId);
      req.onsuccess = () => {
        const record = req.result;
        if (record) {
          record.syncStatus = 'sincronizado';
          store.put(record);
          resolve();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

/**
 * Cuenta registros pendientes
 */
function db_contarPendientes() {
  return db_obtenerPendientes().then(p => p.length);
}

/**
 * Borra todos los registros locales (usado al cargar del servidor)
 */
function db_limpiarRegistros() {
  return txn(STORE_REGISTROS, 'readwrite', store => store.clear());
}

// ─── CONFIGURACIÓN ─────────────────────────────────────────

function db_setConfig(clave, valor) {
  return txn(STORE_CONFIG, 'readwrite', store => store.put({ clave, valor }));
}

function db_getConfig(clave) {
  return txn(STORE_CONFIG, 'readonly', store => store.get(clave))
    .then(result => result ? result.valor : null);
}

// ─── HASH DE CONTRASEÑA (simple, para login offline) ───────

async function hashPassword(password) {
  const msgBuffer = new TextEncoder().encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
