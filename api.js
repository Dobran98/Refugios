/**
 * ============================================================
 *  REFUGIOS PWA — Capa de API (Offline / Online)
 *  Abstrae todas las llamadas al backend GAS y decide si
 *  usar IndexedDB (offline) o el servidor (online).
 * ============================================================
 */

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwIjdQI3LcmW5BOFqoABWrJ4wR6-d4LiV3oiX1_GKNIDtR-8raOhAoEoCzUJbkQMx41/exec';

// ─── ESTADO ────────────────────────────────────────────────

let _sincronizando = false;

function estaOnline() {
  return navigator.onLine;
}

// ─── AUTENTICACIÓN ─────────────────────────────────────────

/**
 * Login: primero busca en IndexedDB, si hay internet valida en el servidor
 * @returns {Object|null} Usuario o null
 */
async function api_login(username, password) {
  const passHash = await hashPassword(password);

  // 1. Verificar credenciales locales (funciona sin internet)
  const localUser = await db_obtenerUsuario(username.trim().toLowerCase());
  if (localUser && localUser.passHash === passHash) {
    console.log('[API] Login offline exitoso para:', username);
    return { usuario: localUser.usuario, nombre: localUser.nombre, rol: localUser.rol };
  }

  // 2. Si hay internet, validar en el servidor
  if (estaOnline()) {
    try {
      const result = await gasRequest('login', { usuario: username, contrasena: password });
      if (result && result.exito && result.usuario) {
        // Guardar credenciales para uso offline futuro
        await db_guardarUsuario({
          usuario: result.usuario.usuario.toLowerCase(),
          nombre: result.usuario.nombre,
          rol: result.usuario.rol,
          passHash: passHash
        });
        return result.usuario;
      }
    } catch (e) {
      console.error('[API] Error al validar en servidor:', e);
    }
  }

  return null;
}

// ─── REGISTROS ─────────────────────────────────────────────

/**
 * Guarda un registro — siempre local, luego intenta sincronizar
 */
async function api_guardarRegistro(data) {
  // Asignar fecha local si no tiene
  if (!data.fechaRegistro) {
    const ahora = new Date();
    data.fechaRegistro = ahora.toLocaleDateString('es-VE') + ' ' + ahora.toLocaleTimeString('es-VE');
  }

  // Guardar en IndexedDB
  const localId = await db_guardarRegistro(data);
  console.log('[API] Registro guardado localmente con localId:', localId);

  // Si hay internet, sincronizar inmediatamente
  if (estaOnline()) {
    try {
      await api_sincronizarPendientes();
    } catch (e) {
      console.warn('[API] No se pudo sincronizar inmediatamente. Quedó pendiente.');
    }
  }

  return { exito: true, mensaje: 'Registro guardado localmente.' };
}

/**
 * Obtiene registros: si hay internet, del servidor. Si no, de IndexedDB.
 */
async function api_obtenerRegistros() {
  if (estaOnline()) {
    try {
      const result = await gasRequest('obtenerRegistros', {});
      if (result && result.exito && Array.isArray(result.registros)) {
        return result.registros;
      }
    } catch (e) {
      console.warn('[API] Error al obtener del servidor, usando caché local:', e);
    }
  }

  // Fallback: retornar registros locales
  const locales = await db_obtenerTodosRegistros();
  // Filtrar solo los de hoy para no confundir (no tenemos historial completo offline)
  return locales.filter(r => r.syncStatus === 'pendiente').map(r => ({
    'N°': r.localId,
    'NOMBRE COMPLETO': r.nombreCompleto || '',
    'TELÉFONO': r.telefono || '',
    'TELÉFONO DE EMERGENCIA': r.telefonoEmergencia || '',
    'EDAD': r.edad || '',
    'SEXO': r.sexo || '',
    'CI': r.ci || '',
    'ESTADO': r.estado || '',
    'MUNICIPIO': r.municipio || '',
    'PARROQUIA': r.parroquia || '',
    'SECTOR': r.sector || '',
    'COMUNA': r.comuna || '',
    'PATOLOGÍAS': r.patologias || '',
    'MOTIVO DE REFUGIO': r.motivoRefugio || '',
    'PERTENENCIAS': r.pertenencias || '',
    'NECESIDADES BÁSICAS': r.necesidadesBasicas || '',
    'TOTAL INTEGRANTES': r.totalIntegrantes || 0,
    'FAMILIAS': r.familias || 0,
    'OBSERVACION': r.observacion || '',
    'EMBARAZO': r.embarazo ? 'SÍ' : 'NO',
    'FECHA_REGISTRO': r.fechaRegistro || r.fechaLocal || '',
    'REGISTRADO_POR': r.registradoPor || '',
    'CÓDIGO DE FAMILIA': r.codigoFamilia || '',
    'CÉDULA DE CUSTODIO': r.cedulaCustodio || '',
    'TALLA DE ZAPATOS': r.tallaZapatos || '',
    'TALLA DE CAMISA': r.tallaCamisa || '',
    'TALLA DE PANTALÓN': r.tallaPantalon || '',
    '_offline': true,
    '_pendiente': r.syncStatus === 'pendiente'
  }));
}

/**
 * Sincroniza todos los registros pendientes con el servidor GAS
 */
async function api_sincronizarPendientes() {
  if (_sincronizando) return { sincronizados: 0, mensaje: 'Sincronización en progreso' };
  if (!estaOnline()) return { sincronizados: 0, mensaje: 'Sin conexión' };

  const pendientes = await db_obtenerPendientes();
  if (pendientes.length === 0) return { sincronizados: 0, mensaje: 'No hay pendientes' };

  _sincronizando = true;

  try {
    // Limpiar campos internos de IndexedDB antes de enviar
    const dataParaEnviar = pendientes.map(r => {
      const { localId, syncStatus, fechaLocal, ...data } = r;
      return data;
    });

    const result = await gasRequest('guardarRegistrosMultiples', {
      registros: dataParaEnviar,
      fechaPersonalizada: null
    });

    if (result && result.exito) {
      // Marcar todos como sincronizados
      for (const reg of pendientes) {
        await db_marcarSincronizado(reg.localId);
      }
      await db_setConfig('ultimaSync', new Date().toISOString());
      console.log('[API] Sincronizados', pendientes.length, 'registros');
      return { sincronizados: pendientes.length, mensaje: result.mensaje };
    } else {
      return { sincronizados: 0, mensaje: result?.mensaje || 'Error en sincronización' };
    }
  } finally {
    _sincronizando = false;
  }
}

/**
 * Cuenta cuántos registros están pendientes de sincronización
 */
async function api_contarPendientes() {
  return db_contarPendientes();
}

// ─── PETICIONES AL SERVIDOR GAS ────────────────────────────

/**
 * Realiza una petición HTTP al Web App de GAS publicado
 * El GAS expone un endpoint doPost() que despacha las acciones
 */
async function gasRequest(accion, params) {
  const payload = { accion, ...params };

  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, // GAS requiere text/plain para evitar CORS preflight
    body: JSON.stringify(payload),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Respuesta inválida del servidor: ' + text.substring(0, 200));
  }
}
