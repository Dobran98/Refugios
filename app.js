
// ─── PWA: SERVICE WORKER REGISTRATION ────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('./sw.js').then(function(reg) {
      console.log('[PWA] Service Worker registrado:', reg.scope);
    }).catch(function(err) {
      console.warn('[PWA] Error al registrar SW:', err);
    });
  });
}

// ─── PWA: INSTALL PROMPT ──────────────────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', function(e) {
  e.preventDefault();
  deferredPrompt = e;
  // Mostrar botón de instalación si existe
  const installBtn = document.getElementById('btnInstalarApp');
  if (installBtn) installBtn.classList.remove('hidden');
});

function instalarApp() {
  if (!deferredPrompt) {
    showToast('La app ya está instalada o tu navegador no lo soporta', 'info');
    return;
  }
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(function(choice) {
    if (choice.outcome === 'accepted') {
      showToast('¡App instalada exitosamente!', 'success');
    }
    deferredPrompt = null;
    const installBtn = document.getElementById('btnInstalarApp');
    if (installBtn) installBtn.classList.add('hidden');
  });
}

// ─── OVERRIDE: sincronizarPendientes para usar API PWA ───
// (la función original en el JS usa la cola localStorage)
// Aquí se hace el puente entre la cola local y api.js

/**
 * ============================================================
 *  SISTEMA DE GESTIÓN DE REFUGIOS — JAVASCRIPT
 *  Lógica frontend: navegación, formulario, tabla, dashboard,
 *  CRUD usuarios, exportación XLSX, cola offline
 * ============================================================
 */

// ─── ESTADO GLOBAL ────────────────────────────────────────
let currentUser = null;
let allRegistros = [];
let currentPage = 1;
const ROWS_PER_PAGE = 20;
let chartEdades = null;
let chartGenero = null;
let isOnline = navigator.onLine;
let editCorrelativo = null;

// ─── INICIALIZACIÓN ───────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  // Verificar sesión existente
  const session = sessionStorage.getItem('refugio_session');
  if (session) {
    try {
      currentUser = JSON.parse(session);
      mostrarApp();
    } catch(e) {
      sessionStorage.removeItem('refugio_session');
    }
  }

  // Ocultar loader
  setTimeout(function() {
    document.getElementById('appLoader').classList.add('hidden');
  }, 800);

  // Eventos de conectividad
  window.addEventListener('online', function() {
    isOnline = true;
    document.getElementById('offlineBar').classList.remove('show');
    sincronizarPendientes();
    showToast('Conexión restablecida', 'success');
  });

  window.addEventListener('offline', function() {
    isOnline = false;
    actualizarBarraOffline();
    showToast('Sin conexión — Los registros se guardarán localmente', 'warning');
  });

  // Enter en login
  document.getElementById('loginPass').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('loginUser').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') document.getElementById('loginPass').focus();
  });
});

// ─── AUTENTICACIÓN ────────────────────────────────────────

function handleLogin() {
  const usuario = document.getElementById('loginUser').value.trim();
  const contrasena = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');
  const btn = document.getElementById('loginBtn');

  if (!usuario || !contrasena) {
    errorEl.textContent = 'Complete todos los campos';
    errorEl.classList.add('show');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 0.8s linear infinite;">sync</span> Verificando...';
  errorEl.classList.remove('show');

  api_login(usuario, contrasena).then(function(result) {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">login</span> Iniciar Sesión';
    if (result) {
      currentUser = result;
      sessionStorage.setItem('refugio_session', JSON.stringify(result));
      mostrarApp();
      showToast('Bienvenido, ' + result.nombre, 'success');
    } else {
      errorEl.textContent = 'Usuario o contraseña incorrectos';
      errorEl.classList.add('show');
    }
  }).catch(function(err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">login</span> Iniciar Sesión';
    errorEl.textContent = 'Error de conexión. Intente nuevamente.';
    errorEl.classList.add('show');
  });
}

function handleLogout() {
  currentUser = null;
  sessionStorage.removeItem('refugio_session');
  document.getElementById('appSection').classList.add('hidden');
  document.getElementById('loginSection').style.display = '';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').classList.remove('show');

  // Destruir charts
  if (chartEdades) { chartEdades.destroy(); chartEdades = null; }
  if (chartGenero) { chartGenero.destroy(); chartGenero = null; }
}

function mostrarApp() {
  document.getElementById('loginSection').style.display = 'none';
  document.getElementById('appSection').classList.remove('hidden');

  // Actualizar info de usuario
  document.getElementById('userName').textContent = currentUser.nombre;
  document.getElementById('userRole').textContent = currentUser.rol;
  document.getElementById('userAvatar').textContent = (currentUser.nombre || 'U').charAt(0).toUpperCase();

  // Mostrar/ocultar elementos admin
  const esAdmin = currentUser.rol === 'admin';
  document.querySelectorAll('.admin-only').forEach(function(el) {
    if (esAdmin) {
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  });

  // Cargar datos
  cargarRegistros();
  if (esAdmin) {
    cargarUsuarios();
    cargarConfiguracionFamilias();
  }
  
  // Cargar datos de diagnóstico de la hoja
  ejecutarDiagnosticoConexion();

  // Verificar pendientes offline
  actualizarBarraOffline();
  if (isOnline) sincronizarPendientes();

  navigateTo('formulario');
}

function ejecutarDiagnosticoConexion() {
  const panel = document.getElementById('debugInfoPanel');
  if (!panel) return;
  
  if (navigator.onLine) {
    gasRequest('obtenerDebugInfo', {}).then(function(info) {
      if (info && info.exito) {
        panel.innerHTML = 
          '<span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;color:#4caf50;margin-right:4px;">cloud_done</span> Conectado<br>' +
          '📂 Documento: <strong>' + escapeHtml(info.spreadsheetName) + '</strong><br>' +
          '📄 Pestaña: <strong>' + escapeHtml(info.sheetName) + '</strong><br>' +
          '📊 Registros: <strong>' + info.rowCount + '</strong>';
      } else {
        panel.innerHTML = '<span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;color:#f44336;margin-right:4px;">error_outline</span> Error de hoja';
      }
    }).catch(function(err) {
      panel.innerHTML = '<span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;color:#f44336;margin-right:4px;">wifi_off</span> Sin conexión al servidor';
    });
  } else {
    panel.innerHTML = '<span class="material-icons-outlined" style="font-size:14px;vertical-align:middle;color:#ff9800;margin-right:4px;">wifi_off</span> Sin internet — Modo offline activo';
  }
}

// ─── NAVEGACIÓN SPA ───────────────────────────────────────

function navigateTo(seccion) {
  // Ocultar todas las secciones
  document.querySelectorAll('.section').forEach(function(s) {
    s.classList.remove('active');
  });

  // Desactivar nav items
  document.querySelectorAll('.nav-item').forEach(function(n) {
    n.classList.remove('active');
  });

  // Activar sección y nav
  var seccionEl = document.getElementById('seccion' + seccion.charAt(0).toUpperCase() + seccion.slice(1));
  if (seccionEl) seccionEl.classList.add('active');

  var navItem = document.querySelector('.nav-item[data-section="' + seccion + '"]');
  if (navItem) navItem.classList.add('active');

  // Cargar datos según sección
  if (seccion === 'dashboard' && currentUser && currentUser.rol === 'admin') {
    cargarDashboard();
  }
  if (seccion === 'duplicados') {
    analizarDuplicados();
  }

  // Cerrar sidebar en mobile
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('show');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('show');
}

// ─── FORMULARIO ───────────────────────────────────────────

function toggleEmbarazo() {
  var sexo = document.getElementById('fSexo').value;
  var chk = document.getElementById('fEmbarazo');
  var label = document.getElementById('embarazoLabel');

  if (sexo === 'Femenino') {
    chk.disabled = false;
    label.textContent = chk.checked ? 'Sí' : 'No';
  } else {
    chk.disabled = true;
    chk.checked = false;
    label.textContent = 'No aplica';
  }
}

// Event listener para cambiar texto del switch
document.addEventListener('change', function(e) {
  if (e.target.id === 'fEmbarazo') {
    document.getElementById('embarazoLabel').textContent = e.target.checked ? 'Sí' : 'No';
  }
});

function toggleMotivoOtro() {
  var motivo = document.getElementById('fMotivo').value;
  var grupoOtro = document.getElementById('grupoMotivoOtro');
  var inputOtro = document.getElementById('fMotivoOtro');

  if (motivo === 'Otro') {
    grupoOtro.classList.remove('hidden');
    inputOtro.required = true;
    inputOtro.focus();
  } else {
    grupoOtro.classList.add('hidden');
    inputOtro.required = false;
    inputOtro.value = '';
  }
}

function limpiarFormulario() {
  document.getElementById('registroForm').reset();
  document.getElementById('fEmbarazo').disabled = true;
  document.getElementById('embarazoLabel').textContent = 'No aplica';
  
  // Resetear selectores geográficos
  inicializarOpcionesGeograficas();
  
  // Ocultar y limpiar el campo de motivo "Otro"
  var grupoOtro = document.getElementById('grupoMotivoOtro');
  if (grupoOtro) {
    grupoOtro.classList.add('hidden');
  }
  var inputOtro = document.getElementById('fMotivoOtro');
  if (inputOtro) {
    inputOtro.required = false;
    inputOtro.value = '';
  }
}

function guardarRegistro() {
  // Validación
  var nombre = document.getElementById('fNombre').value.trim();
  var edad = document.getElementById('fEdad').value;
  var edadUnidad = document.getElementById('fEdadUnidad').value;
  var sexo = document.getElementById('fSexo').value;
  var motivo = document.getElementById('fMotivo').value;

  if (!nombre) { showToast('Ingrese el nombre completo', 'error'); document.getElementById('fNombre').focus(); return; }
  if (edad === '' || edad === null) { showToast('Ingrese la edad', 'error'); document.getElementById('fEdad').focus(); return; }
  if (!sexo) { showToast('Seleccione el sexo', 'error'); document.getElementById('fSexo').focus(); return; }
  if (!motivo) { showToast('Seleccione el motivo de refugio', 'error'); document.getElementById('fMotivo').focus(); return; }

  if (motivo === 'Otro') {
    var motivoOtro = document.getElementById('fMotivoOtro').value.trim();
    if (!motivoOtro) {
      showToast('Especifique el motivo de refugio', 'error');
      document.getElementById('fMotivoOtro').focus();
      return;
    }
    motivo = motivoOtro;
  }

  var edadFinal = (edadUnidad === 'MESES') ? (edad + ' MESES') : parseInt(edad);

  var data = {
    nombreCompleto: nombre,
    telefono: document.getElementById('fTelefono').value.trim(),
    telefonoEmergencia: document.getElementById('fTelEmergencia').value.trim(),
    edad: edadFinal,
    sexo: sexo,
    ci: document.getElementById('fCI').value.trim(),
    codigoFamilia: document.getElementById('fCodigoFamilia').value.trim().toUpperCase(),
    cedulaCustodio: document.getElementById('fCedulaCustodio').value.trim(),
    estado: document.getElementById('fEstado').value.trim(),
    municipio: document.getElementById('fMunicipio').value.trim(),
    parroquia: document.getElementById('fParroquia').value.trim(),
    sector: document.getElementById('fSector').value.trim(),
    comuna: document.getElementById('fComuna').value.trim(),
    patologias: document.getElementById('fPatologias').value.trim(),
    motivoRefugio: motivo,
    pertenencias: document.getElementById('fPertenencias').value.trim(),
    necesidadesBasicas: document.getElementById('fNecesidades').value.trim(),
    totalIntegrantes: parseInt(document.getElementById('fIntegrantes').value) || 1,
    familias: parseInt(document.getElementById('fFamilias').value) || 1,
    observacion: document.getElementById('fObservacion').value.trim(),
    embarazo: document.getElementById('fEmbarazo').checked,
    tallaZapatos: document.getElementById('fTallaZapatos').value.trim(),
    tallaCamisa: document.getElementById('fTallaCamisa').value.trim(),
    tallaPantalon: document.getElementById('fTallaPantalon').value.trim(),
    registradoPor: currentUser ? currentUser.nombre : 'Desconocido'
  };

  // Función para ejecutar el guardado final (nuevo o editado)
  function ejecutarGuardado() {
    var btn = document.getElementById('btnGuardar');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 0.8s linear infinite;">sync</span> Guardando...';

    if (editCorrelativo !== null) {
      // Modo Edición
      if (!isOnline || !navigator.onLine) {
        showToast('La edición no está disponible en modo offline', 'error');
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
        return;
      }

      gasRequest('editarRegistro', { correlativo: editCorrelativo, data: data }).then(function(result) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
        if (result && result.exito) {
          showToast(result.mensaje, 'success');
          cancelarEdicion();
          cargarRegistros();
        } else {
          showToast(result ? result.mensaje : 'Error al actualizar', 'error');
        }
      }).catch(function(err) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
        showToast('Error al actualizar registro', 'error');
      });
    } else {
      // Modo Registro Nuevo
      if (!isOnline || !navigator.onLine) {
        guardarEnColaOffline(data);
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
        limpiarFormulario();
        showToast('Registro guardado localmente (se sincronizará al conectarse)', 'warning');
        return;
      }

      api_guardarRegistro(data).then(function(result) {
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
        showToast(result.mensaje || 'Registro guardado', 'success');
        limpiarFormulario();
        cargarRegistros();
        document.getElementById('fNombre').focus();
      }).catch(function(err) {
        guardarEnColaOffline(data);
        btn.disabled = false;
        btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
        limpiarFormulario();
        showToast('Error de conexión — Registro guardado localmente', 'warning');
      });
    }
  }

  // Detección inteligente de duplicados por Cédula (CI)
  var ci = data.ci;
  if (ci) {
    var duplicado = allRegistros.find(function(r) {
      if (editCorrelativo !== null && parseInt(r['N°']) === parseInt(editCorrelativo)) {
        return false; // Ignorar el mismo registro en edición
      }
      return r['CI'] && String(r['CI']).trim() === ci;
    });

    if (duplicado) {
      document.getElementById('lblDuplicadoCI').textContent = ci;
      document.getElementById('lblDuplicadoNombre').textContent = duplicado['NOMBRE COMPLETO'];
      document.getElementById('btnConfirmarDuplicado').onclick = function() {
        cerrarModalDuplicado();
        ejecutarGuardado();
      };
      document.getElementById('modalConfirmarDuplicado').classList.add('show');
      return;
    }
  }

  // Si no hay duplicado o no tiene CI, guardar directamente
  ejecutarGuardado();
}

// ─── COLA OFFLINE ─────────────────────────────────────────

function guardarEnColaOffline(data) {
  var cola = JSON.parse(localStorage.getItem('refugio_cola_offline') || '[]');
  data._timestamp = new Date().toISOString();
  cola.push(data);
  localStorage.setItem('refugio_cola_offline', JSON.stringify(cola));
  actualizarBarraOffline();
}

function obtenerColaPendiente() {
  return JSON.parse(localStorage.getItem('refugio_cola_offline') || '[]');
}

function limpiarCola() {
  localStorage.removeItem('refugio_cola_offline');
  actualizarBarraOffline();
}

function actualizarBarraOffline() {
  var cola = obtenerColaPendiente();
  var bar = document.getElementById('offlineBar');
  var countEl = document.getElementById('pendingCount');

  if (!isOnline || !navigator.onLine) {
    bar.classList.add('show');
    countEl.textContent = cola.length + ' pendiente(s)';
  } else if (cola.length > 0) {
    bar.classList.add('show');
    bar.innerHTML = '<span class="material-icons-outlined">sync</span> Sincronizando ' + cola.length + ' registro(s) pendiente(s)...';
  } else {
    bar.classList.remove('show');
  }
}

function sincronizarPendientes() {
  var cola = obtenerColaPendiente();
  if (cola.length === 0) return;

  actualizarBarraOffline();

  api_sincronizarPendientes().then(function(result) {
    if (result.sincronizados > 0) {
      limpiarCola();
      showToast('Sincronizados ' + result.sincronizados + ' registros', 'success');
      cargarRegistros();
      document.getElementById('offlineBar').classList.remove('show');
    }
  }).catch(function(err) {
    showToast('No se pudo sincronizar. Se reintentará.', 'warning');
  });
}

// ─── TABLA DE REGISTROS ───────────────────────────────────

function cargarRegistros() {
  api_obtenerRegistros().then(function(registros) {
    allRegistros = registros || [];
    currentPage = 1;
    renderizarTabla();
    document.getElementById('totalBadge').textContent = allRegistros.length;
    inicializarOpcionesGeograficas();
    analizarDuplicados();
  }).catch(function(err) {
    showToast('Error al cargar registros', 'error');
  });
}

function renderizarTabla() {
  var tbody = document.getElementById('tableBody');
  var emptyState = document.getElementById('emptyTable');
  var paginationEl = document.getElementById('pagination');

  // Aplicar filtro
  var searchTerm = (document.getElementById('searchInput').value || '').toLowerCase();
  var fechaInicioVal = document.getElementById('filterFechaInicio').value;
  var fechaFinVal = document.getElementById('filterFechaFin').value;

  var dateInicio = fechaInicioVal ? new Date(fechaInicioVal + 'T00:00:00') : null;
  var dateFin = fechaFinVal ? new Date(fechaFinVal + 'T23:59:59') : null;

  var filtrados = allRegistros.filter(function(r) {
    var matchText = true;
    if (searchTerm) {
      matchText = (
        (r['NOMBRE COMPLETO'] || '').toLowerCase().includes(searchTerm) ||
        (r['CI'] || '').toString().toLowerCase().includes(searchTerm) ||
        (r['ESTADO'] || '').toLowerCase().includes(searchTerm) ||
        (r['MUNICIPIO'] || '').toLowerCase().includes(searchTerm) ||
        (r['PARROQUIA'] || '').toLowerCase().includes(searchTerm) ||
        (r['SECTOR'] || '').toLowerCase().includes(searchTerm)
      );
    }

    var matchFecha = true;
    if (dateInicio || dateFin) {
      var rFecha = parseSheetDate(r['FECHA_REGISTRO']);
      if (rFecha) {
        if (dateInicio && rFecha < dateInicio) matchFecha = false;
        if (dateFin && rFecha > dateFin) matchFecha = false;
      } else {
        matchFecha = false;
      }
    }

    return matchText && matchFecha;
  });

  document.getElementById('totalRegistrosLabel').textContent = filtrados.length;

  if (filtrados.length === 0) {
    tbody.innerHTML = '';
    emptyState.style.display = '';
    paginationEl.innerHTML = '';
    return;
  }

  emptyState.style.display = 'none';

  // Paginación
  var totalPages = Math.ceil(filtrados.length / ROWS_PER_PAGE);
  if (currentPage > totalPages) currentPage = totalPages;
  var start = (currentPage - 1) * ROWS_PER_PAGE;
  var pageData = filtrados.slice(start, start + ROWS_PER_PAGE);

  // Renderizar filas
  var html = '';
  pageData.forEach(function(r) {
    html += '<tr>';
    html += '<td>' + (r['N°'] || '') + '</td>';
    html += '<td title="' + escapeHtml(r['NOMBRE COMPLETO'] || '') + '">' + escapeHtml(r['NOMBRE COMPLETO'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['TELÉFONO'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['TELÉFONO DE EMERGENCIA'] || '') + '</td>';
    html += '<td style="text-align:center;">' + (r['EDAD'] || 0) + '</td>';
    html += '<td>' + escapeHtml(r['SEXO'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['CI'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['ESTADO'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['MUNICIPIO'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['PARROQUIA'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['SECTOR'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['COMUNA'] || '') + '</td>';
    html += '<td title="' + escapeHtml(r['PATOLOGÍAS'] || '') + '">' + escapeHtml(r['PATOLOGÍAS'] || '') + '</td>';
    html += '<td>' + escapeHtml(r['MOTIVO DE REFUGIO'] || '') + '</td>';
    html += '<td title="' + escapeHtml(r['PERTENENCIAS'] || '') + '">' + escapeHtml(r['PERTENENCIAS'] || '') + '</td>';
    html += '<td title="' + escapeHtml(r['NECESIDADES BÁSICAS'] || '') + '">' + escapeHtml(r['NECESIDADES BÁSICAS'] || '') + '</td>';
    html += '<td style="text-align:center;">' + (r['TOTAL INTEGRANTES'] || 0) + '</td>';
    html += '<td style="text-align:center;">' + (r['FAMILIAS'] || 0) + '</td>';
    html += '<td title="' + escapeHtml(r['OBSERVACION'] || '') + '">' + escapeHtml(r['OBSERVACION'] || '') + '</td>';
    html += '<td>' + escapeHtml(formatFecha(r['FECHA_REGISTRO'])) + '</td>';

    html += '<td class="actions-cell">';
    html += '<button class="btn-icon btn-secondary" onclick="cargarRegistroEnFormulario(' + r['N°'] + ')" title="Editar">';
    html += '<span class="material-icons-outlined">edit</span></button>';

    if (currentUser && currentUser.rol === 'admin') {
      html += '<button class="btn-icon btn-danger" onclick="confirmarEliminar(' + r['N°'] + ')" title="Eliminar" style="margin-left: 4px;">';
      html += '<span class="material-icons-outlined">delete</span></button>';
    }
    html += '</td>';

    html += '</tr>';
  });
  tbody.innerHTML = html;

  // Paginación controles
  renderizarPaginacion(totalPages);
}

function renderizarPaginacion(totalPages) {
  var pag = document.getElementById('pagination');
  if (totalPages <= 1) { pag.innerHTML = ''; return; }

  var html = '';
  html += '<button ' + (currentPage === 1 ? 'disabled' : '') + ' onclick="irAPagina(' + (currentPage - 1) + ')"><span class="material-icons-outlined" style="font-size:16px;">chevron_left</span></button>';

  var startPage = Math.max(1, currentPage - 2);
  var endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    html += '<button onclick="irAPagina(1)">1</button>';
    if (startPage > 2) html += '<span class="pagination-info">...</span>';
  }

  for (var i = startPage; i <= endPage; i++) {
    html += '<button class="' + (i === currentPage ? 'active' : '') + '" onclick="irAPagina(' + i + ')">' + i + '</button>';
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="pagination-info">...</span>';
    html += '<button onclick="irAPagina(' + totalPages + ')">' + totalPages + '</button>';
  }

  html += '<button ' + (currentPage === totalPages ? 'disabled' : '') + ' onclick="irAPagina(' + (currentPage + 1) + ')"><span class="material-icons-outlined" style="font-size:16px;">chevron_right</span></button>';

  pag.innerHTML = html;
}

function irAPagina(page) {
  currentPage = page;
  renderizarTabla();
  window.scrollTo(0, 0);
}

function filtrarTabla() {
  currentPage = 1;
  renderizarTabla();
}

// ─── ELIMINAR REGISTRO ────────────────────────────────────

function confirmarEliminar(correlativo) {
  document.getElementById('confirmTitulo').textContent = 'Eliminar Registro';
  document.getElementById('confirmMensaje').textContent = '¿Está seguro que desea eliminar el registro N° ' + correlativo + '? Esta acción no se puede deshacer.';
  document.getElementById('confirmBtn').setAttribute('onclick', 'ejecutarEliminar(' + correlativo + ')');
  document.getElementById('modalConfirmar').classList.add('show');
}

function ejecutarEliminar(correlativo) {
  cerrarModalConfirmar();
  if (!navigator.onLine) {
    showToast('La eliminación requiere conexión a internet', 'warning');
    return;
  }
  gasRequest('eliminarRegistro', { correlativo: correlativo }).then(function(result) {
    if (result && result.exito) {
      showToast(result.mensaje, 'success');
      cargarRegistros();
    } else {
      showToast(result ? result.mensaje : 'Error al eliminar', 'error');
    }
  }).catch(function(err) {
    showToast('Error al eliminar', 'error');
  });
}

function cerrarModalConfirmar() {
  document.getElementById('modalConfirmar').classList.remove('show');
}

// ─── DASHBOARD ────────────────────────────────────────────

// Variables para descarga de análisis del Dashboard
var dashboardStatsFiltrados = null;
var dashboardRegistrosFiltrados = null;
var dashboardRangoFechas = null;

function cargarDashboard() {
  filtrarDashboard();
}

function filtrarDashboard() {
  var fechaInicioVal = document.getElementById('dbFechaInicio').value;
  var fechaFinVal = document.getElementById('dbFechaFin').value;

  var dateInicio = fechaInicioVal ? new Date(fechaInicioVal + 'T00:00:00') : null;
  var dateFin = fechaFinVal ? new Date(fechaFinVal + 'T23:59:59') : null;

  // Filtrar localmente sobre todos los registros
  var filtrados = allRegistros.filter(function(r) {
    var matchFecha = true;
    if (dateInicio || dateFin) {
      var rFecha = parseSheetDate(r['FECHA_REGISTRO']);
      if (rFecha) {
        if (dateInicio && rFecha < dateInicio) matchFecha = false;
        if (dateFin && rFecha > dateFin) matchFecha = false;
      } else {
        matchFecha = false;
      }
    }
    return matchFecha;
  });

  const stats = calcularEstadisticasFront(filtrados);
  
  // Guardar en globales para descargas
  dashboardStatsFiltrados = stats;
  dashboardRegistrosFiltrados = filtrados;
  dashboardRangoFechas = { inicio: fechaInicioVal, fin: fechaFinVal };

  // Actualizar tarjetas animadas y gráficos
  actualizarTarjetas(stats);
  actualizarGraficos(stats);
}

function limpiarFiltrosDashboard() {
  document.getElementById('dbFechaInicio').value = '';
  document.getElementById('dbFechaFin').value = '';
  filtrarDashboard();
}

function calcularEstadisticasFront(registrosFiltrados) {
  const total = registrosFiltrados.length;
  
  // Determinar si hay filtros activos en el dashboard
  var fechaInicioVal = document.getElementById('dbFechaInicio') ? document.getElementById('dbFechaInicio').value : '';
  var fechaFinVal = document.getElementById('dbFechaFin') ? document.getElementById('dbFechaFin').value : '';
  var estaFiltrando = fechaInicioVal || fechaFinVal;

  // Si no se está filtrando, partimos de la cantidad base manual
  var baseFamilias = (!estaFiltrando && configFamiliasGlobal && configFamiliasGlobal.base) ? parseInt(configFamiliasGlobal.base) : 0;
  var fechaBaseStr = (!estaFiltrando && configFamiliasGlobal && configFamiliasGlobal.fecha) ? configFamiliasGlobal.fecha : '';
  var dateBase = fechaBaseStr ? new Date(fechaBaseStr + 'T00:00:00') : null;

  const stats = {
    totalPersonas: total,
    ninos: { masculino: 0, femenino: 0, total: 0 },
    adolescentes: { masculino: 0, femenino: 0, total: 0 },
    embarazadas: 0,
    recienNacidos: 0,
    adultos: { masculino: 0, femenino: 0, total: 0 },
    adultosMayores: { masculino: 0, femenino: 0, total: 0 },
    totalFamilias: baseFamilias,
    totalIntegrantes: 0,
    patologias: { total: 0, masculino: 0, femenino: 0 }
  };

  registrosFiltrados.forEach(function(r) {
    var edadKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "edad";
    }) || 'EDAD';
    var sexoKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "sexo";
    }) || 'SEXO';
    var embarazoKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "embarazo";
    }) || 'EMBARAZO';
    var familiasKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "familias";
    }) || 'FAMILIAS';
    var integrantesKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "total integrantes";
    }) || 'TOTAL INTEGRANTES';
    var patologiaKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "patologias";
    }) || 'PATOLOGÍAS';

    var edadRaw = String(r[edadKey] || '').trim().toUpperCase();
    var edad = (edadRaw.indexOf('MES') !== -1 || edadRaw.endsWith('M')) ? 0 : (parseInt(edadRaw) || 0);
    var sexoRaw = String(r[sexoKey] || '').trim().toLowerCase();
    var esM = (sexoRaw.startsWith('m') || sexoRaw.includes('masc') || sexoRaw === 'h' || sexoRaw.includes('hombre'));
    var esF = (sexoRaw.startsWith('f') || sexoRaw.includes('fem') || sexoRaw === 'mujer');
    var embarazo = String(r[embarazoKey] || '').trim().toUpperCase() === 'SÍ' || r[embarazoKey] === true;

    if (edad === 0) {
      stats.recienNacidos++;
    }

    if (edad >= 0 && edad <= 12) {
      stats.ninos.total++;
      if (esM) stats.ninos.masculino++;
      if (esF) stats.ninos.femenino++;
    } else if (edad >= 13 && edad <= 18) {
      stats.adolescentes.total++;
      if (esM) stats.adolescentes.masculino++;
      if (esF) stats.adolescentes.femenino++;
    } else if (edad >= 19 && edad <= 55) {
      stats.adultos.total++;
      if (esM) stats.adultos.masculino++;
      if (esF) stats.adultos.femenino++;
    } else if (edad >= 56) {
      stats.adultosMayores.total++;
      if (esM) stats.adultosMayores.masculino++;
      if (esF) stats.adultosMayores.femenino++;
    }

    if (embarazo && esF) {
      stats.embarazadas++;
    }

    // Contabilizar familias
    var familiasEnRegistro = parseInt(r[familiasKey]) || 0;
    if (dateBase) {
      var rFecha = parseSheetDate(r['FECHA_REGISTRO']);
      if (rFecha && rFecha >= dateBase) {
        stats.totalFamilias += familiasEnRegistro;
      }
    } else {
      stats.totalFamilias += familiasEnRegistro;
    }

    stats.totalIntegrantes += parseInt(r[integrantesKey]) || 0;

    // Contabilizar patologías
    var patVal = String(r[patologiaKey] || '').trim();
    var tienePatologia = patVal && !/^(ninguna|ninguno|no|no aplica|n\/a|sin patologia|s\/p|-)$/i.test(patVal);
    if (tienePatologia) {
      stats.patologias.total++;
      if (esM) stats.patologias.masculino++;
      if (esF) stats.patologias.femenino++;
    }
  });

  return stats;
}

function descargarReporteDashboard() {
  const stats = dashboardStatsFiltrados || calcularEstadisticasFront(allRegistros);
  const rangoText = (dashboardRangoFechas && (dashboardRangoFechas.inicio || dashboardRangoFechas.fin))
    ? ('Rango: ' + (dashboardRangoFechas.inicio || 'Inicio') + ' al ' + (dashboardRangoFechas.fin || 'Fin'))
    : 'Rango: Todos los registros';

  const rows = [
    ['REPORTE Y ANÁLISIS DE DASHBOARD - SISTEMA DE REFUGIOS'],
    [rangoText],
    ['Fecha de Generación: ' + formatFecha(new Date())],
    [],
    ['INDICADOR', 'TOTAL', 'MASCULINO', 'FEMENINO'],
    ['Total Personas Caracterizadas', stats.totalPersonas, '', ''],
    ['Niños (0-12 años)', stats.ninos.total, stats.ninos.masculino, stats.ninos.femenino],
    ['Adolescentes (13-18 años)', stats.adolescentes.total, stats.adolescentes.masculino, stats.adolescentes.femenino],
    ['Adultos (19-55 años)', stats.adultos.total, stats.adultos.masculino, stats.adultos.femenino],
    ['Adultos Mayores (56+ años)', stats.adultosMayores.total, stats.adultosMayores.masculino, stats.adultosMayores.femenino],
    ['Mujeres Embarazadas', stats.embarazadas, '', stats.embarazadas],
    ['Recién Nacidos', stats.recienNacidos, '', ''],
    ['Total Familias Atendidas (con base)', stats.totalFamilias, '', ''],
    ['Total Integrantes de Familias', stats.totalIntegrantes, '', ''],
    ['Personas con Patologías', stats.patologias.total, stats.patologias.masculino, stats.patologias.femenino]
  ];

  // Crear libro de trabajo
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  
  // Agregar anchos de columna
  ws['!cols'] = [
    { wch: 35 }, // INDICADOR
    { wch: 10 }, // TOTAL
    { wch: 15 }, // MASCULINO
    { wch: 15 }  // FEMENINO
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Resumen Estadístico");

  // Agregar el listado detallado de personas filtradas en otra pestaña
  const registrosDetalle = dashboardRegistrosFiltrados || allRegistros;
  if (registrosDetalle.length > 0) {
    const listRows = [
      ['N°', 'NOMBRE COMPLETO', 'CI', 'EDAD', 'SEXO', 'ESTADO', 'MUNICIPIO', 'PARROQUIA', 'SECTOR', 'COMUNA', 'FECHA REGISTRO', 'TALLA ZAPATOS', 'TALLA CAMISA', 'TALLA PANTALÓN']
    ];
    registrosDetalle.forEach(function(r) {
      listRows.push([
        r['N°'] || '',
        r['NOMBRE COMPLETO'] || '',
        r['CI'] || '',
        r['EDAD'] || '',
        r['SEXO'] || '',
        r['ESTADO'] || '',
        r['MUNICIPIO'] || '',
        r['PARROQUIA'] || '',
        r['SECTOR'] || '',
        r['COMUNA'] || '',
        r['FECHA_REGISTRO'] || '',
        r['TALLA DE ZAPATOS'] || '',
        r['TALLA DE CAMISA'] || '',
        r['TALLA DE PANTALÓN'] || ''
      ]);
    });
    const wsList = XLSX.utils.aoa_to_sheet(listRows);
    XLSX.utils.book_append_sheet(wb, wsList, "Personas Detallado");
  }

  // Guardar archivo
  const filename = 'Analisis_Dashboard_' + (new Date().toISOString().slice(0,10)) + '.xlsx';
  XLSX.writeFile(wb, filename);
  showToast('Análisis descargado como ' + filename, 'success');
}

function actualizarTarjetas(stats) {
  animarNumero('statTotal', stats.totalPersonas);
  animarNumero('statNinos', stats.ninos.total);
  document.getElementById('statNinosM').textContent = stats.ninos.masculino;
  document.getElementById('statNinosF').textContent = stats.ninos.femenino;

  animarNumero('statAdolescentes', stats.adolescentes.total);
  document.getElementById('statAdolM').textContent = stats.adolescentes.masculino;
  document.getElementById('statAdolF').textContent = stats.adolescentes.femenino;

  animarNumero('statEmbarazadas', stats.embarazadas);
  animarNumero('statRecienNacidos', stats.recienNacidos);

  animarNumero('statAdultos', stats.adultos.total);
  document.getElementById('statAdultosM').textContent = stats.adultos.masculino;
  document.getElementById('statAdultosF').textContent = stats.adultos.femenino;

  animarNumero('statMayores', stats.adultosMayores.total);
  document.getElementById('statMayoresM').textContent = stats.adultosMayores.masculino;
  document.getElementById('statMayoresF').textContent = stats.adultosMayores.femenino;

  // Nuevas tarjetas: Familias y Patologías
  animarNumero('statFamilias', stats.totalFamilias);
  animarNumero('statPatologias', stats.patologias.total);
  if (document.getElementById('statPatologiasM')) {
    document.getElementById('statPatologiasM').textContent = stats.patologias.masculino;
  }
  if (document.getElementById('statPatologiasF')) {
    document.getElementById('statPatologiasF').textContent = stats.patologias.femenino;
  }
}

function animarNumero(elementId, targetValue) {
  var el = document.getElementById(elementId);
  var start = parseInt(el.textContent) || 0;
  var diff = targetValue - start;
  if (diff === 0) { el.textContent = targetValue; return; }

  var duration = 600;
  var startTime = null;

  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    var eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(start + diff * eased);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

function actualizarGraficos(stats) {
  // Chart 1: Distribución por grupo etario (Doughnut)
  var ctxEdades = document.getElementById('chartEdades').getContext('2d');
  if (chartEdades) chartEdades.destroy();

  chartEdades = new Chart(ctxEdades, {
    type: 'doughnut',
    data: {
      labels: ['Niños (0-12)', 'Adolescentes (13-18)', 'Adultos (19-55)', 'Adultos Mayores (56+)'],
      datasets: [{
        data: [stats.ninos.total, stats.adolescentes.total, stats.adultos.total, stats.adultosMayores.total],
        backgroundColor: [
          'rgba(24, 255, 255, 0.8)',
          'rgba(92, 107, 192, 0.8)',
          'rgba(255, 171, 0, 0.8)',
          'rgba(255, 82, 82, 0.8)'
        ],
        borderColor: 'rgba(15, 21, 37, 0.8)',
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#9fa8da',
            font: { family: 'Inter', size: 11 },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 10
          }
        },
        tooltip: {
          backgroundColor: 'rgba(21, 29, 50, 0.95)',
          titleColor: '#e8eaf6',
          bodyColor: '#9fa8da',
          borderColor: 'rgba(92, 107, 192, 0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' }
        }
      },
      cutout: '65%'
    }
  });

  // Chart 2: Distribución por género (Bar)
  var ctxGenero = document.getElementById('chartGenero').getContext('2d');
  if (chartGenero) chartGenero.destroy();

  chartGenero = new Chart(ctxGenero, {
    type: 'bar',
    data: {
      labels: ['Niños', 'Adolescentes', 'Adultos', 'A. Mayores'],
      datasets: [
        {
          label: 'Masculino',
          data: [stats.ninos.masculino, stats.adolescentes.masculino, stats.adultos.masculino, stats.adultosMayores.masculino],
          backgroundColor: 'rgba(92, 107, 192, 0.7)',
          borderColor: 'rgba(92, 107, 192, 1)',
          borderWidth: 1,
          borderRadius: 6
        },
        {
          label: 'Femenino',
          data: [stats.ninos.femenino, stats.adolescentes.femenino, stats.adultos.femenino, stats.adultosMayores.femenino],
          backgroundColor: 'rgba(255, 64, 129, 0.7)',
          borderColor: 'rgba(255, 64, 129, 1)',
          borderWidth: 1,
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#9fa8da',
            font: { family: 'Inter', size: 11 },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 10
          }
        },
        tooltip: {
          backgroundColor: 'rgba(21, 29, 50, 0.95)',
          titleColor: '#e8eaf6',
          bodyColor: '#9fa8da',
          borderColor: 'rgba(92, 107, 192, 0.3)',
          borderWidth: 1,
          cornerRadius: 8,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(92, 107, 192, 0.08)' },
          ticks: { color: '#9fa8da', font: { family: 'Inter', size: 11 } }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(92, 107, 192, 0.08)' },
          ticks: {
            color: '#9fa8da',
            font: { family: 'Inter', size: 11 },
            stepSize: 1
          }
        }
      }
    }
  });
}

// ─── EXPORTAR XLSX ────────────────────────────────────────

function exportarXLSX() {
  if (allRegistros.length === 0) {
    showToast('No hay registros para exportar', 'warning');
    return;
  }

  // Obtener filtros actuales para la exportación consolidada
  var searchTerm = (document.getElementById('searchInput').value || '').toLowerCase();
  var fechaInicioVal = document.getElementById('filterFechaInicio').value;
  var fechaFinVal = document.getElementById('filterFechaFin').value;

  var dateInicio = fechaInicioVal ? new Date(fechaInicioVal + 'T00:00:00') : null;
  var dateFin = fechaFinVal ? new Date(fechaFinVal + 'T23:59:59') : null;

  var registrosAExportar = allRegistros.filter(function(r) {
    var matchText = true;
    if (searchTerm) {
      matchText = (
        (r['NOMBRE COMPLETO'] || '').toLowerCase().includes(searchTerm) ||
        (r['CI'] || '').toString().toLowerCase().includes(searchTerm) ||
        (r['ESTADO'] || '').toLowerCase().includes(searchTerm) ||
        (r['MUNICIPIO'] || '').toLowerCase().includes(searchTerm) ||
        (r['PARROQUIA'] || '').toLowerCase().includes(searchTerm) ||
        (r['SECTOR'] || '').toLowerCase().includes(searchTerm)
      );
    }

    var matchFecha = true;
    if (dateInicio || dateFin) {
      var rFecha = parseSheetDate(r['FECHA_REGISTRO']);
      if (rFecha) {
        if (dateInicio && rFecha < dateInicio) matchFecha = false;
        if (dateFin && rFecha > dateFin) matchFecha = false;
      } else {
        matchFecha = false;
      }
    }

    return matchText && matchFecha;
  });

  if (registrosAExportar.length === 0) {
    showToast('No hay registros que coincidan con los filtros para exportar', 'warning');
    return;
  }

  // Preparar datos
  var headers = [
    'N°', 'NOMBRE COMPLETO', 'TELÉFONO', 'TELÉFONO DE EMERGENCIA',
    'EDAD', 'SEXO', 'CI', 'ESTADO', 'MUNICIPIO', 'PARROQUIA',
    'SECTOR', 'COMUNA', 'PATOLOGÍAS', 'MOTIVO DE REFUGIO',
    'PERTENENCIAS', 'NECESIDADES BÁSICAS', 'TOTAL INTEGRANTES',
    'FAMILIAS', 'OBSERVACION', 'EMBARAZO', 'FECHA DE REGISTRO', 'REGISTRADO POR',
    'TALLA ZAPATOS', 'TALLA CAMISA', 'TALLA PANTALÓN'
  ];

  var wsData = [headers];

  registrosAExportar.forEach(function(r) {
    wsData.push([
      r['N°'] || '',
      r['NOMBRE COMPLETO'] || '',
      r['TELÉFONO'] || '',
      r['TELÉFONO DE EMERGENCIA'] || '',
      r['EDAD'] || 0,
      r['SEXO'] || '',
      r['CI'] || '',
      r['ESTADO'] || '',
      r['MUNICIPIO'] || '',
      r['PARROQUIA'] || '',
      r['SECTOR'] || '',
      r['COMUNA'] || '',
      r['PATOLOGÍAS'] || '',
      r['MOTIVO DE REFUGIO'] || '',
      r['PERTENENCIAS'] || '',
      r['NECESIDADES BÁSICAS'] || '',
      r['TOTAL INTEGRANTES'] || 0,
      r['FAMILIAS'] || 0,
      r['OBSERVACION'] || '',
      r['EMBARAZO'] || '',
      formatFecha(r['FECHA_REGISTRO']),
      r['REGISTRADO_POR'] || '',
      r['TALLA DE ZAPATOS'] || '',
      r['TALLA DE CAMISA'] || '',
      r['TALLA DE PANTALÓN'] || ''
    ]);
  });

  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(wsData);

  // Ancho de columnas
  ws['!cols'] = [
    {wch: 5}, {wch: 30}, {wch: 15}, {wch: 15}, {wch: 6},
    {wch: 12}, {wch: 14}, {wch: 18}, {wch: 18}, {wch: 18},
    {wch: 18}, {wch: 18}, {wch: 25}, {wch: 18}, {wch: 25},
    {wch: 25}, {wch: 12}, {wch: 10}, {wch: 30}, {wch: 12},
    {wch: 20}, {wch: 20}, {wch: 15}, {wch: 15}, {wch: 15}
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Registros');

  // Generar nombre de archivo dinámico
  var nombreArchivo = 'Refugio_Consolidado';
  if (fechaInicioVal && fechaFinVal) {
    nombreArchivo += '_' + fechaInicioVal + '_a_' + fechaFinVal;
  } else if (fechaInicioVal) {
    nombreArchivo += '_desde_' + fechaInicioVal;
  } else if (fechaFinVal) {
    nombreArchivo += '_hasta_' + fechaFinVal;
  } else {
    nombreArchivo += '_Completo';
  }
  var fechaActual = new Date().toISOString().split('T')[0];
  nombreArchivo += '_' + fechaActual + '.xlsx';

  XLSX.writeFile(wb, nombreArchivo);
  showToast('Archivo XLSX descargado exitosamente (' + registrosAExportar.length + ' registros)', 'success');
}

// ─── CRUD USUARIOS ────────────────────────────────────────

function cargarUsuarios() {
  if (!navigator.onLine) {
    showToast('La gestión de usuarios requiere conexión', 'warning');
    return;
  }
  gasRequest('obtenerUsuarios', {}).then(function(result) {
    if (result && result.usuarios) {
      renderizarUsuarios(result.usuarios);
    } else if (Array.isArray(result)) {
      renderizarUsuarios(result);
    }
  }).catch(function(err) {
    showToast('Error al cargar usuarios', 'error');
  });
}

function renderizarUsuarios(usuarios) {
  var tbody = document.getElementById('usersTableBody');
  var html = '';

  usuarios.forEach(function(u) {
    html += '<tr>';
    html += '<td><strong>' + escapeHtml(u.usuario) + '</strong></td>';
    html += '<td>' + escapeHtml(u.nombre) + '</td>';
    html += '<td><span class="role-badge ' + u.rol + '">' + u.rol + '</span></td>';
    html += '<td class="actions-cell">';

    // Editar
    html += '<button class="btn-icon btn-secondary" onclick="abrirModalEditarUsuario(\'' + escapeHtml(u.usuario) + '\', \'' + escapeHtml(u.nombre) + '\')" title="Editar">';
    html += '<span class="material-icons-outlined">edit</span></button>';

    // Cambiar contraseña
    html += '<button class="btn-icon btn-secondary" onclick="abrirModalContrasena(\'' + escapeHtml(u.usuario) + '\')" title="Cambiar contraseña" style="margin-left:4px;">';
    html += '<span class="material-icons-outlined">lock_reset</span></button>';

    // Eliminar (no admin principal)
    if (u.usuario !== 'admin') {
      html += '<button class="btn-icon btn-danger" onclick="confirmarEliminarUsuario(\'' + escapeHtml(u.usuario) + '\')" title="Eliminar" style="margin-left:4px;">';
      html += '<span class="material-icons-outlined">delete</span></button>';
    }

    html += '</td>';
    html += '</tr>';
  });

  tbody.innerHTML = html;
}

function abrirModalUsuario() {
  document.getElementById('modalUsuarioTitulo').textContent = 'Nuevo Sistematizador';
  document.getElementById('muUsuarioOriginal').value = '';
  document.getElementById('muUsuario').value = '';
  document.getElementById('muNombre').value = '';
  document.getElementById('muContrasena').value = '';
  document.getElementById('muUsuario').disabled = false;
  document.getElementById('modalUsuario').classList.add('show');
}

function abrirModalEditarUsuario(usuario, nombre) {
  document.getElementById('modalUsuarioTitulo').textContent = 'Editar Usuario';
  document.getElementById('muUsuarioOriginal').value = usuario;
  document.getElementById('muUsuario').value = usuario;
  document.getElementById('muNombre').value = nombre;
  document.getElementById('muContrasena').value = '';
  document.getElementById('muUsuario').disabled = (usuario === 'admin');
  document.getElementById('modalUsuario').classList.add('show');
}

function cerrarModalUsuario() {
  document.getElementById('modalUsuario').classList.remove('show');
}

function guardarUsuario() {
  var original = document.getElementById('muUsuarioOriginal').value;
  var usuario = document.getElementById('muUsuario').value.trim();
  var nombre = document.getElementById('muNombre').value.trim();
  var contrasena = document.getElementById('muContrasena').value;

  if (!usuario || !nombre) {
    showToast('Complete usuario y nombre', 'error');
    return;
  }

  var btn = document.getElementById('btnGuardarUsuario');
  btn.disabled = true;

  if (original) {
    // Editar
    var data = { usuario: usuario, nombre: nombre };
    if (contrasena) data.contrasena = contrasena;

    gasRequest('editarUsuario', { usuarioOriginal: original, data: data }).then(function(result) {
      btn.disabled = false;
      if (result && result.exito) {
        showToast(result.mensaje, 'success');
        cerrarModalUsuario();
        cargarUsuarios();
      } else {
        showToast(result ? result.mensaje : 'Error al editar', 'error');
      }
    }).catch(function(err) {
      btn.disabled = false;
      showToast('Error al editar usuario', 'error');
    });
  } else {
    // Crear
    if (!contrasena) {
      showToast('La contraseña es obligatoria', 'error');
      btn.disabled = false;
      return;
    }

    gasRequest('crearUsuario', { usuario: usuario, contrasena: contrasena, nombre: nombre }).then(function(result) {
      btn.disabled = false;
      if (result && result.exito) {
        showToast(result.mensaje, 'success');
        cerrarModalUsuario();
        cargarUsuarios();
      } else {
        showToast(result ? result.mensaje : 'Error al crear', 'error');
      }
    }).catch(function(err) {
      btn.disabled = false;
      showToast('Error al crear usuario', 'error');
    });
  }
}

// ─── CAMBIAR CONTRASEÑA ───────────────────────────────────

function abrirModalContrasena(usuario) {
  document.getElementById('mcUsuario').value = usuario;
  document.getElementById('mcNuevaPass').value = '';
  document.getElementById('mcConfirmPass').value = '';
  document.getElementById('modalContrasena').classList.add('show');
}

function cerrarModalContrasena() {
  document.getElementById('modalContrasena').classList.remove('show');
}

function cambiarContrasena() {
  var usuario = document.getElementById('mcUsuario').value;
  var nueva = document.getElementById('mcNuevaPass').value;
  var confirm = document.getElementById('mcConfirmPass').value;

  if (!nueva) {
    showToast('Ingrese la nueva contraseña', 'error');
    return;
  }

  if (nueva !== confirm) {
    showToast('Las contraseñas no coinciden', 'error');
    return;
  }

  if (nueva.length < 4) {
    showToast('La contraseña debe tener al menos 4 caracteres', 'error');
    return;
  }

  gasRequest('cambiarContrasena', { usuario: usuario, nuevaContrasena: nueva }).then(function(result) {
    if (result && result.exito) {
      showToast(result.mensaje, 'success');
      cerrarModalContrasena();
    } else {
      showToast(result ? result.mensaje : 'Error al cambiar', 'error');
    }
  }).catch(function(err) {
    showToast('Error al cambiar contraseña', 'error');
  });
}

// ─── ELIMINAR USUARIO ─────────────────────────────────────

function confirmarEliminarUsuario(usuario) {
  document.getElementById('confirmTitulo').textContent = 'Eliminar Usuario';
  document.getElementById('confirmMensaje').textContent = '¿Está seguro que desea eliminar al usuario "' + usuario + '"? Esta acción no se puede deshacer.';
  document.getElementById('confirmBtn').setAttribute('onclick', 'ejecutarEliminarUsuario(\'' + usuario + '\')');
  document.getElementById('modalConfirmar').classList.add('show');
}

function ejecutarEliminarUsuario(usuario) {
  cerrarModalConfirmar();
  gasRequest('eliminarUsuario', { usuario: usuario }).then(function(result) {
    if (result && result.exito) {
      showToast(result.mensaje, 'success');
      cargarUsuarios();
    } else {
      showToast(result ? result.mensaje : 'Error al eliminar', 'error');
    }
  }).catch(function(err) {
    showToast('Error al eliminar usuario', 'error');
  });
}

// ─── UTILIDADES ───────────────────────────────────────────

function parseSheetDate(dateStr) {
  if (!dateStr) return null;
  if (dateStr instanceof Date) return dateStr;
  
  // Si viene en formato ISO (timestamp offline)
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    var d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d;
  }
  
  // Parsear formato 'dd/MM/yyyy HH:mm:ss' o 'dd/MM/yyyy'
  if (typeof dateStr === 'string') {
    var parts = dateStr.split(' ');
    var dateParts = parts[0].split('/');
    if (dateParts.length === 3) {
      var day = parseInt(dateParts[0], 10);
      var month = parseInt(dateParts[1], 10) - 1;
      var year = parseInt(dateParts[2], 10);
      
      var hour = 0, min = 0, sec = 0;
      if (parts[1]) {
        var timeParts = parts[1].split(':');
        hour = parseInt(timeParts[0], 10) || 0;
        min = parseInt(timeParts[1], 10) || 0;
        sec = parseInt(timeParts[2], 10) || 0;
      }
      return new Date(year, month, day, hour, min, sec);
    }
  }
  
  var d2 = new Date(dateStr);
  return isNaN(d2.getTime()) ? null : d2;
}

function formatFecha(dateVal) {
  if (!dateVal) return '';
  if (dateVal instanceof Date) {
    var day = ('0' + dateVal.getDate()).slice(-2);
    var month = ('0' + (dateVal.getMonth() + 1)).slice(-2);
    var year = dateVal.getFullYear();
    var hours = ('0' + dateVal.getHours()).slice(-2);
    var minutes = ('0' + dateVal.getMinutes()).slice(-2);
    return day + '/' + month + '/' + year + ' ' + hours + ':' + minutes;
  }
  
  if (typeof dateVal === 'string' && dateVal.includes('T')) {
    var d = new Date(dateVal);
    if (!isNaN(d.getTime())) {
      return formatFecha(d);
    }
  }
  
  return String(dateVal);
}

function limpiarFiltrosFecha() {
  document.getElementById('filterFechaInicio').value = '';
  document.getElementById('filterFechaFin').value = '';
  filtrarTabla();
}

function cerrarModalDuplicado() {
  document.getElementById('modalConfirmarDuplicado').classList.remove('show');
}

function cargarRegistroEnFormulario(correlativo) {
  var r = allRegistros.find(function(item) {
    return parseInt(item['N°']) === parseInt(correlativo);
  });

  if (!r) {
    showToast('Registro no encontrado', 'error');
    return;
  }

  // Ocultar botones de guardado continuo en modo edición
  document.querySelectorAll('.create-only').forEach(function(el) {
    el.classList.add('hidden');
  });

  editCorrelativo = correlativo;
  document.getElementById('lblEditCorrelativo').textContent = correlativo;
  document.getElementById('bannerEdicion').classList.remove('hidden');
  
  var btn = document.getElementById('btnGuardar');
  btn.innerHTML = '<span class="material-icons-outlined">save</span> Actualizar Registro';

  document.getElementById('fNombre').value = r['NOMBRE COMPLETO'] || '';
  document.getElementById('fTelefono').value = r['TELÉFONO'] || '';
  document.getElementById('fTelEmergencia').value = r['TELÉFONO DE EMERGENCIA'] || '';
  const edadRaw = r['EDAD'] !== undefined ? String(r['EDAD']).trim() : '';
  if (edadRaw.toUpperCase().indexOf('MES') !== -1) {
    document.getElementById('fEdad').value = parseInt(edadRaw) || 0;
    document.getElementById('fEdadUnidad').value = 'MESES';
  } else {
    document.getElementById('fEdad').value = edadRaw;
    document.getElementById('fEdadUnidad').value = 'AÑOS';
  }
  document.getElementById('fSexo').value = r['SEXO'] || '';
  document.getElementById('fCI').value = r['CI'] || '';
  document.getElementById('fCodigoFamilia').value = r['CÓDIGO DE FAMILIA'] || '';
  document.getElementById('fCedulaCustodio').value = r['CÉDULA DE CUSTODIO'] || '';
  
  var chkEmbarazo = document.getElementById('fEmbarazo');
  var labelEmbarazo = document.getElementById('embarazoLabel');
  if (r['SEXO'] === 'Femenino') {
    chkEmbarazo.disabled = false;
    chkEmbarazo.checked = (r['EMBARAZO'] === 'SÍ');
    labelEmbarazo.textContent = chkEmbarazo.checked ? 'Sí' : 'No';
  } else {
    chkEmbarazo.disabled = true;
    chkEmbarazo.checked = false;
    labelEmbarazo.textContent = 'No aplica';
  }

  establecerValorGeografico('Estado', r['ESTADO'] || '');
  establecerValorGeografico('Municipio', r['MUNICIPIO'] || '');
  establecerValorGeografico('Parroquia', r['PARROQUIA'] || '');
  document.getElementById('fSector').value = r['SECTOR'] || '';
  establecerValorGeografico('Comuna', r['COMUNA'] || '');
  document.getElementById('fPatologias').value = r['PATOLOGÍAS'] || '';
  
  var fMotivo = document.getElementById('fMotivo');
  var motivoVal = r['MOTIVO DE REFUGIO'] || '';
  var grupoOtro = document.getElementById('grupoMotivoOtro');
  var inputOtro = document.getElementById('fMotivoOtro');
  
  if (motivoVal === 'Terremoto' || motivoVal === 'Vivienda no habitable') {
    fMotivo.value = motivoVal;
    grupoOtro.classList.add('hidden');
    inputOtro.required = false;
    inputOtro.value = '';
  } else if (motivoVal) {
    fMotivo.value = 'Otro';
    grupoOtro.classList.remove('hidden');
    inputOtro.required = true;
    inputOtro.value = motivoVal;
  } else {
    fMotivo.value = '';
    grupoOtro.classList.add('hidden');
    inputOtro.required = false;
    inputOtro.value = '';
  }

  document.getElementById('fPertenencias').value = r['PERTENENCIAS'] || '';
  document.getElementById('fNecesidades').value = r['NECESIDADES BÁSICAS'] || '';
  document.getElementById('fTallaZapatos').value = r['TALLA DE ZAPATOS'] || '';
  document.getElementById('fTallaCamisa').value = r['TALLA DE CAMISA'] || '';
  document.getElementById('fTallaPantalon').value = r['TALLA DE PANTALÓN'] || '';
  document.getElementById('fIntegrantes').value = r['TOTAL INTEGRANTES'] || 1;
  document.getElementById('fFamilias').value = r['FAMILIAS'] || 1;
  document.getElementById('fObservacion').value = r['OBSERVACION'] || '';

  actualizarEstadoCustodio();
  navigateTo('formulario');
}

function cancelarEdicion() {
  editCorrelativo = null;
  document.getElementById('bannerEdicion').classList.add('hidden');
  
  // Mostrar botones de guardado continuo al salir del modo edición
  document.querySelectorAll('.create-only').forEach(function(el) {
    el.classList.remove('hidden');
  });

  var btn = document.getElementById('btnGuardar');
  btn.innerHTML = '<span class="material-icons-outlined">save</span> Guardar Registro';
  limpiarFormulario();
}

function guardarRegistroYContinuar(tipo) {
  var nombre = document.getElementById('fNombre').value.trim();
  var edad = document.getElementById('fEdad').value;
  var sexo = document.getElementById('fSexo').value;
  var motivo = document.getElementById('fMotivo').value;

  if (!nombre) { showToast('Ingrese el nombre completo', 'error'); document.getElementById('fNombre').focus(); return; }
  if (edad === '' || edad === null) { showToast('Ingrese la edad', 'error'); document.getElementById('fEdad').focus(); return; }
  if (!sexo) { showToast('Seleccione el sexo', 'error'); document.getElementById('fSexo').focus(); return; }
  if (!motivo) { showToast('Seleccione el motivo de refugio', 'error'); document.getElementById('fMotivo').focus(); return; }

  if (motivo === 'Otro') {
    var motivoOtro = document.getElementById('fMotivoOtro').value.trim();
    if (!motivoOtro) {
      showToast('Especifique el motivo de refugio', 'error');
      document.getElementById('fMotivoOtro').focus();
      return;
    }
    motivo = motivoOtro;
  }

  var cfInput = document.getElementById('fCodigoFamilia');
  if (!cfInput.value.trim()) {
    var rand = Math.floor(1000 + Math.random() * 9000);
    cfInput.value = 'FAM-' + rand;
  }

  var cedulaActual = document.getElementById('fCI').value.trim();

  var edadUnidad = document.getElementById('fEdadUnidad').value;
  var edadFinal = (edadUnidad === 'MESES') ? (edad + ' MESES') : parseInt(edad);

  var data = {
    nombreCompleto: nombre,
    telefono: document.getElementById('fTelefono').value.trim(),
    telefonoEmergencia: document.getElementById('fTelEmergencia').value.trim(),
    edad: edadFinal,
    sexo: sexo,
    ci: cedulaActual,
    codigoFamilia: cfInput.value.trim().toUpperCase(),
    cedulaCustodio: document.getElementById('fCedulaCustodio').value.trim(),
    estado: document.getElementById('fEstado').value.trim(),
    municipio: document.getElementById('fMunicipio').value.trim(),
    parroquia: document.getElementById('fParroquia').value.trim(),
    sector: document.getElementById('fSector').value.trim(),
    comuna: document.getElementById('fComuna').value.trim(),
    patologias: document.getElementById('fPatologias').value.trim(),
    motivoRefugio: motivo,
    pertenencias: document.getElementById('fPertenencias').value.trim(),
    necesidadesBasicas: document.getElementById('fNecesidades').value.trim(),
    totalIntegrantes: parseInt(document.getElementById('fIntegrantes').value) || 1,
    familias: parseInt(document.getElementById('fFamilias').value) || 1,
    observacion: document.getElementById('fObservacion').value.trim(),
    embarazo: document.getElementById('fEmbarazo').checked,
    tallaZapatos: document.getElementById('fTallaZapatos').value.trim(),
    tallaCamisa: document.getElementById('fTallaCamisa').value.trim(),
    tallaPantalon: document.getElementById('fTallaPantalon').value.trim(),
    registradoPor: currentUser ? currentUser.nombre : 'Desconocido'
  };

  function ejecutarGuardadoContinuar() {
    var btnId = tipo === 'familiar' ? 'btnGuardarYFamiliar' : 'btnGuardarYMenor';
    var btn = document.getElementById(btnId);
    var oldText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 0.8s linear infinite;">sync</span> Guardando...';

    if (!isOnline || !navigator.onLine) {
      guardarEnColaOffline(data);
      btn.disabled = false;
      btn.innerHTML = oldText;
      prepararFormularioSiguiente(tipo, data, cedulaActual);
      showToast('Registro guardado localmente', 'warning');
      return;
    }

    api_guardarRegistro(data).then(function(result) {
      btn.disabled = false;
      btn.innerHTML = oldText;
      showToast(result.mensaje || 'Registro guardado', 'success');
      prepararFormularioSiguiente(tipo, data, cedulaActual);
      cargarRegistros();
    }).catch(function(err) {
      guardarEnColaOffline(data);
      btn.disabled = false;
      btn.innerHTML = oldText;
      prepararFormularioSiguiente(tipo, data, cedulaActual);
      showToast('Error de conexión — Guardado localmente', 'warning');
    });
  }

  if (cedulaActual) {
    var duplicado = allRegistros.find(function(r) {
      return r['CI'] && String(r['CI']).trim() === cedulaActual;
    });

    if (duplicado) {
      document.getElementById('lblDuplicadoCI').textContent = cedulaActual;
      document.getElementById('lblDuplicadoNombre').textContent = duplicado['NOMBRE COMPLETO'];
      document.getElementById('btnConfirmarDuplicado').onclick = function() {
        cerrarModalDuplicado();
        ejecutarGuardadoContinuar();
      };
      document.getElementById('modalConfirmarDuplicado').classList.add('show');
      return;
    }
  }

  ejecutarGuardadoContinuar();
}

function prepararFormularioSiguiente(tipo, dataGuardada, cedulaRepresentante) {
  // Limpiar datos individuales
  document.getElementById('fNombre').value = '';
  document.getElementById('fEdad').value = '';
  document.getElementById('fSexo').value = '';
  document.getElementById('fCI').value = '';
  document.getElementById('fPatologias').value = '';
  document.getElementById('fObservacion').value = '';
  
  var chkEmbarazo = document.getElementById('fEmbarazo');
  chkEmbarazo.checked = false;
  chkEmbarazo.disabled = true;
  document.getElementById('embarazoLabel').textContent = 'No aplica';

  if (tipo === 'menor') {
    document.getElementById('fCedulaCustodio').disabled = false;
    document.getElementById('btnBuscarCustodio').disabled = false;
    if (cedulaRepresentante) {
      document.getElementById('fCedulaCustodio').value = cedulaRepresentante;
    } else {
      document.getElementById('fCedulaCustodio').value = dataGuardada.cedulaCustodio || '';
    }
  } else {
    document.getElementById('fCedulaCustodio').value = '';
    document.getElementById('fCedulaCustodio').disabled = true;
    document.getElementById('btnBuscarCustodio').disabled = true;
  }

  document.getElementById('fNombre').focus();
  showToast('Formulario listo para registrar el siguiente integrante', 'info');
}

function actualizarEstadoCustodio() {
  var edadInput = document.getElementById('fEdad').value;
  var edadUnidad = document.getElementById('fEdadUnidad').value;
  var inputCustodio = document.getElementById('fCedulaCustodio');
  var btnCustodio = document.getElementById('btnBuscarCustodio');
  
  var esMenor = false;
  if (edadInput !== '') {
    if (edadUnidad === 'MESES') {
      esMenor = true;
    } else {
      esMenor = parseInt(edadInput) < 18;
    }
  }

  if (esMenor) {
    inputCustodio.disabled = false;
    btnCustodio.disabled = false;
  } else {
    inputCustodio.disabled = true;
    inputCustodio.value = '';
    btnCustodio.disabled = true;
  }
}

function abrirBuscarFamiliar() {
  var tbody = document.getElementById('familiarTableBody');
  tbody.innerHTML = '';
  renderizarTablaModalFamiliar(allRegistros);
  document.getElementById('searchFamiliarInput').value = '';
  document.getElementById('modalBuscarFamiliar').classList.add('show');
}

function cerrarBuscarFamiliar() {
  document.getElementById('modalBuscarFamiliar').classList.remove('show');
}

function renderizarTablaModalFamiliar(registros) {
  var tbody = document.getElementById('familiarTableBody');
  var html = '';
  
  if (registros.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No hay familiares registrados</td></tr>';
    return;
  }
  
  registros.forEach(function(r) {
    html += '<tr>';
    html += '<td>' + (r['N°'] || '') + '</td>';
    html += '<td><strong>' + escapeHtml(r['NOMBRE COMPLETO'] || '') + '</strong></td>';
    html += '<td>' + escapeHtml(r['CI'] || 'No posee') + '</td>';
    html += '<td><span class="badge" style="background:var(--surface-400); color:var(--accent-gold); font-size:0.75rem; padding: 2px 8px; border-radius: 10px;">' + escapeHtml(r['CÓDIGO DE FAMILIA'] || 'Sin código') + '</span></td>';
    html += '<td>';
    html += '<button type="button" class="btn btn-primary btn-sm" onclick="asociarFamiliar(' + r['N°'] + ')" style="padding:4px 8px; font-size:0.75rem;">Asociar</button>';
    html += '</td>';
    html += '</tr>';
  });
  
  tbody.innerHTML = html;
}

function filtrarModalFamiliar() {
  var query = document.getElementById('searchFamiliarInput').value.toLowerCase().trim();
  var filtrados = allRegistros.filter(function(r) {
    if (!query) return true;
    return (
      (r['NOMBRE COMPLETO'] || '').toLowerCase().includes(query) ||
      (r['CI'] || '').toString().toLowerCase().includes(query) ||
      (r['CÓDIGO DE FAMILIA'] || '').toLowerCase().includes(query)
    );
  });
  renderizarTablaModalFamiliar(filtrados);
}

function asociarFamiliar(correlativo) {
  var f = allRegistros.find(function(item) {
    return parseInt(item['N°']) === parseInt(correlativo);
  });
  
  if (!f) {
    showToast('Familiar no encontrado', 'error');
    return;
  }
  
  if (f['CÓDIGO DE FAMILIA']) {
    document.getElementById('fCodigoFamilia').value = f['CÓDIGO DE FAMILIA'];
  } else {
    var CF = f['CI'] ? 'FAM-' + f['CI'] : 'FAM-' + f['N°'];
    document.getElementById('fCodigoFamilia').value = CF;
  }
  
  document.getElementById('fCedulaCustodio').value = f['CI'] || '';
  
  if (!document.getElementById('fEstado').value) document.getElementById('fEstado').value = f['ESTADO'] || '';
  if (!document.getElementById('fMunicipio').value) document.getElementById('fMunicipio').value = f['MUNICIPIO'] || '';
  if (!document.getElementById('fParroquia').value) document.getElementById('fParroquia').value = f['PARROQUIA'] || '';
  if (!document.getElementById('fSector').value) document.getElementById('fSector').value = f['SECTOR'] || '';
  if (!document.getElementById('fComuna').value) document.getElementById('fComuna').value = f['COMUNA'] || '';
  
  cerrarBuscarFamiliar();
  showToast('Familiar asociado correctamente', 'success');
}

function generarCodigoFamilia() {
  var rand = Math.floor(1000 + Math.random() * 9000);
  var CF = 'FAM-' + rand;
  
  var existe = allRegistros.some(function(r) {
    return r['CÓDIGO DE FAMILIA'] === CF;
  });
  
  if (existe) {
    generarCodigoFamilia();
  } else {
    document.getElementById('fCodigoFamilia').value = CF;
    showToast('Código de familia generado: ' + CF, 'info');
  }
}

function generarReporteTexto() {
  // Inicializar radio buttons del modal de reporte
  var radios = document.getElementsByName('repFechaOpt');
  radios.forEach(function(r) {
    if (r.value === 'filtro') r.checked = true;
  });
  
  // Establecer la fecha de hoy en el date input de reporte
  var hoyStr = new Date().toISOString().slice(0, 10);
  document.getElementById('repFechaInput').value = hoyStr;
  
  actualizarReporteTexto();
  document.getElementById('modalReporteTexto').classList.add('show');
}

function cambiarFechaEspecificaReporte() {
  // Al cambiar el date input, forzar a seleccionar la opción "Fecha específica"
  var radios = document.getElementsByName('repFechaOpt');
  radios.forEach(function(r) {
    if (r.value === 'especifica') r.checked = true;
  });
  actualizarReporteTexto();
}

function actualizarReporteTexto() {
  var opt = 'filtro';
  var radios = document.getElementsByName('repFechaOpt');
  for (var i = 0; i < radios.length; i++) {
    if (radios[i].checked) {
      opt = radios[i].value;
      break;
    }
  }

  var dateInicio = null;
  var dateFin = null;
  var rangoTituloText = "Histórico completo";

  if (opt === 'filtro') {
    var fechaInicioVal = document.getElementById('filterFechaInicio').value;
    var fechaFinVal = document.getElementById('filterFechaFin').value;
    dateInicio = fechaInicioVal ? new Date(fechaInicioVal + 'T00:00:00') : null;
    dateFin = fechaFinVal ? new Date(fechaFinVal + 'T23:59:59') : null;
    if (fechaInicioVal || fechaFinVal) {
      rangoTituloText = 'Filtros: ' + (fechaInicioVal || 'Inicio') + ' al ' + (fechaFinVal || 'Fin');
    }
  } else if (opt === 'hoy') {
    var hoyVal = new Date().toISOString().slice(0, 10);
    dateInicio = new Date(hoyVal + 'T00:00:00');
    dateFin = new Date(hoyVal + 'T23:59:59');
    rangoTituloText = 'Fecha: ' + formatFechaString(hoyVal);
  } else if (opt === 'especifica') {
    var espVal = document.getElementById('repFechaInput').value;
    if (espVal) {
      dateInicio = new Date(espVal + 'T00:00:00');
      dateFin = new Date(espVal + 'T23:59:59');
      rangoTituloText = 'Fecha: ' + formatFechaString(espVal);
    } else {
      rangoTituloText = 'Fecha específica: No seleccionada';
    }
  }

  var filtrados = allRegistros.filter(function(r) {
    var matchFecha = true;
    if (dateInicio || dateFin) {
      var rFecha = parseSheetDate(r['FECHA_REGISTRO']);
      if (rFecha) {
        if (dateInicio && rFecha < dateInicio) matchFecha = false;
        if (dateFin && rFecha > dateFin) matchFecha = false;
      } else {
        matchFecha = false;
      }
    }
    return matchFecha;
  });

  var stats = {
    lactantes: { M: 0, F: 0, total: 0 },
    ninos: { M: 0, F: 0, total: 0 },
    adol: { M: 0, F: 0, total: 0 },
    adultos: { M: 0, F: 0, total: 0 },
    mayores: { M: 0, F: 0, total: 0 }
  };

  var totalEmbarazadas = 0;
  var embPorEdad = { lactantes: 0, ninas: 0, adol: 0, adultos: 0, mayores: 0 };

  var totalConPatologias = 0;
  var patPorEdad = { lactantes: 0, ninas: 0, adol: 0, adultos: 0, mayores: 0 };
  var listaPatologiasSet = [];

  filtrados.forEach(function(r) {
    var edadKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "edad";
    }) || 'EDAD';
    var sexoKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "sexo";
    }) || 'SEXO';
    var embarazoKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "embarazo";
    }) || 'EMBARAZO';
    var patologiaKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "patologias";
    }) || 'PATOLOGÍAS';

    var edadRaw = String(r[edadKey] || '').trim().toUpperCase();
    var edad = (edadRaw.indexOf('MES') !== -1 || edadRaw.endsWith('M')) ? 0 : (parseInt(edadRaw) || 0);
    var sexoRaw = String(r[sexoKey] || '').trim().toLowerCase();
    var esM = (sexoRaw.startsWith('m') || sexoRaw.includes('masc') || sexoRaw === 'h' || sexoRaw.includes('hombre'));
    var esF = (sexoRaw.startsWith('f') || sexoRaw.includes('fem') || sexoRaw === 'mujer');
    var embarazo = String(r[embarazoKey] || '').trim().toUpperCase() === 'SÍ' || r[embarazoKey] === true;

    // Etarios
    if (edad >= 0 && edad <= 3) {
      stats.lactantes.total++;
      if (esM) stats.lactantes.M++;
      if (esF) stats.lactantes.F++;
    } else if (edad >= 4 && edad <= 12) {
      stats.ninos.total++;
      if (esM) stats.ninos.M++;
      if (esF) stats.ninos.F++;
    } else if (edad >= 13 && edad <= 17) {
      stats.adol.total++;
      if (esM) stats.adol.M++;
      if (esF) stats.adol.F++;
    } else if (edad >= 18 && edad <= 64) {
      stats.adultos.total++;
      if (esM) stats.adultos.M++;
      if (esF) stats.adultos.F++;
    } else if (edad >= 65) {
      stats.mayores.total++;
      if (esM) stats.mayores.M++;
      if (esF) stats.mayores.F++;
    }

    // Embarazadas
    if (embarazo && esF) {
      totalEmbarazadas++;
      if (edad >= 0 && edad <= 3) {
        embPorEdad.lactantes++;
      } else if (edad >= 4 && edad <= 12) {
        embPorEdad.ninas++;
      } else if (edad >= 13 && edad <= 17) {
        embPorEdad.adol++;
      } else if (edad >= 18 && edad <= 64) {
        embPorEdad.adultos++;
      } else if (edad >= 65) {
        embPorEdad.mayores++;
      }
    }

    // Patologías
    var patVal = String(r[patologiaKey] || '').trim();
    var tienePatologia = patVal && !/^(ninguna|ninguno|no|no aplica|n\/a|sin patologia|s\/p|-)$/i.test(patVal);
    if (tienePatologia) {
      totalConPatologias++;
      if (edad >= 0 && edad <= 3) {
        patPorEdad.lactantes++;
      } else if (edad >= 4 && edad <= 12) {
        patPorEdad.ninas++;
      } else if (edad >= 13 && edad <= 17) {
        patPorEdad.adol++;
      } else if (edad >= 18 && edad <= 64) {
        patPorEdad.adultos++;
      } else if (edad >= 65) {
        patPorEdad.mayores++;
      }

      var parts = patVal.split(/[,;\-\/]/);
      parts.forEach(function(part) {
        var cleanPart = part.trim().toUpperCase();
        if (cleanPart && !/^(NINGUNA|NINGUNO|NO|NO APLICA|N\/A|SIN PATOLOGIA|S\/P|-)$/i.test(cleanPart)) {
          if (listaPatologiasSet.indexOf(cleanPart) === -1) {
            listaPatologiasSet.push(cleanPart);
          }
        }
      });
    }
  });

  var reporte = '';
  reporte += '📌 Data de los Centros de Refugio\n\n';
  reporte += 'Rango del reporte: ' + rangoTituloText + '\n\n';
  reporte += 'CANTIDAD TOTAL DE PERSONAS CARACTERIZADAS: ' + filtrados.length + '\n';
  reporte += '------------------------\n';
  reporte += 'Niños lactantes (0-3)\n\n';
  reporte += 'Cantidad total: ' + stats.lactantes.total + '\n\n';
  reporte += '📝Masculinos: ' + stats.lactantes.M + '\n';
  reporte += '📝Femeninos: ' + stats.lactantes.F + '\n';
  reporte += '------------------------\n';
  reporte += 'Niños (4-12)\n\n';
  reporte += 'Cantidad total: ' + stats.ninos.total + '\n\n';
  reporte += '📝Masculinos: ' + stats.ninos.M + '\n';
  reporte += '📝Femeninos: ' + stats.ninos.F + '\n';
  reporte += '------------------------\n';
  reporte += 'Adolescentes (13-17)\n\n';
  reporte += 'Cantidad total: ' + stats.adol.total + '\n\n';
  reporte += '📝Masculinos: ' + stats.adol.M + '\n';
  reporte += '📝Femeninos: ' + stats.adol.F + '\n';
  reporte += '------------------------\n';
  reporte += 'Adultos (18-64)\n\n';
  reporte += 'Cantidad total: ' + stats.adultos.total + '\n\n';
  reporte += '📝Masculinos: ' + stats.adultos.M + '\n';
  reporte += '📝Femeninos: ' + stats.adultos.F + '\n';
  reporte += '------------------------\n';
  reporte += 'Tercera edad (65-en adelante)\n\n';
  reporte += 'Cantidad total: ' + stats.mayores.total + '\n\n';
  reporte += '📝Masculinos: ' + stats.mayores.M + '\n';
  reporte += '📝Femeninos: ' + stats.mayores.F + '\n';
  reporte += '------------------------\n';
  reporte += '🤰 Mujeres Embarazadas\n\n';
  reporte += 'Cantidad total: ' + totalEmbarazadas + '\n\n';
  reporte += '📝Niñas lactantes (0-3): ' + embPorEdad.lactantes + '\n';
  reporte += '📝Niñas (4-12): ' + embPorEdad.ninas + '\n';
  reporte += '📝Adolescentes (13-17): ' + embPorEdad.adol + '\n';
  reporte += '📝Adultas (18-64): ' + embPorEdad.adultos + '\n';
  reporte += '📝Tercera edad (65+): ' + embPorEdad.mayores + '\n';
  reporte += '------------------------\n';
  reporte += '🩺 Personas con Patologías\n\n';
  reporte += 'Cantidad total: ' + totalConPatologias + '\n\n';
  reporte += '📝Niños lactantes (0-3): ' + patPorEdad.lactantes + '\n';
  reporte += '📝Niños (4-12): ' + patPorEdad.ninas + '\n';
  reporte += '📝Adolescentes (13-17): ' + patPorEdad.adol + '\n';
  reporte += '📝Adultos (18-64): ' + patPorEdad.adultos + '\n';
  reporte += '📝Tercera edad (65+): ' + patPorEdad.mayores + '\n';
  reporte += '------------------------\n';
  reporte += '📋 Catálogo de Patologías Registradas:\n';
  if (listaPatologiasSet.length > 0) {
    listaPatologiasSet.sort();
    listaPatologiasSet.forEach(function(pat, idx) {
      reporte += (idx + 1) + '. ' + pat + '\n';
    });
  } else {
    reporte += 'Ninguna patología registrada.\n';
  }

  document.getElementById('txtReporteCuerpo').value = reporte;
}

// Auxiliar para formatear fecha de YYYY-MM-DD a DD/MM/YYYY
function formatFechaString(dateStr) {
  if (!dateStr) return '';
  var parts = dateStr.split('-');
  if (parts.length === 3) {
    return parts[2] + '/' + parts[1] + '/' + parts[0];
  }
  return dateStr;
}

function copiarReporteAlPortapapeles() {
  var textarea = document.getElementById('txtReporteCuerpo');
  textarea.select();
  textarea.setSelectionRange(0, 99999);
  
  try {
    navigator.clipboard.writeText(textarea.value);
    showToast('Reporte copiado al portapapeles', 'success');
  } catch(e) {
    document.execCommand('copy');
    showToast('Reporte copiado al portapapeles', 'success');
  }
}

function cerrarModalReporte() {
  document.getElementById('modalReporteTexto').classList.remove('show');
}

function showToast(message, type) {
  var container = document.getElementById('toastContainer');
  var icons = {
    success: 'check_circle',
    error: 'error',
    warning: 'warning',
    info: 'info'
  };

  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');
  toast.innerHTML = '<span class="material-icons-outlined">' + (icons[type] || 'info') + '</span><span>' + escapeHtml(message) + '</span>';

  container.appendChild(toast);

  setTimeout(function() {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 4000);
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  var str = String(text);
  var div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

// ─── IMPORTACIÓN EXCEL (XLSX) ─────────────────────────────
const CAMPOS_SISTEMA = {
  nombreCompleto: "Nombre Completo",
  ci: "Cédula de Identidad",
  edad: "Edad",
  sexo: "Sexo",
  telefono: "Teléfono",
  telefonoEmergencia: "Teléfono de Emergencia",
  codigoFamilia: "Código de Familia",
  cedulaCustodio: "Cédula de Custodio",
  estado: "Estado",
  municipio: "Municipio",
  parroquia: "Parroquia",
  sector: "Sector",
  comuna: "Comuna",
  patologias: "Patologías",
  motivoRefugio: "Motivo de Refugio",
  pertenencias: "Pertenencias",
  necesidadesBasicas: "Necesidades Básicas",
  totalIntegrantes: "Total Integrantes",
  familias: "Familias",
  observacion: "Observación",
  embarazo: "Embarazo"
};

const ALIASES_IMPORT = {
  nombreCompleto: ["nombre", "nombres", "nombre completo", "nombre y apellido", "nombre_completo", "nombreyapellido", "nombreyapellidos", "paciente", "afectado"],
  ci: ["ci", "cedula", "cedula de identidad", "cédula", "cédula de identidad", "documento", "identidad", "nro documento", "nro_documento", "identificacion", "dni"],
  edad: ["edad", "años", "anios", "edad_años"],
  sexo: ["sexo", "genero", "género", "sexo_genero"],
  telefono: ["telefono", "teléfono", "tlf", "celular", "nro telefono", "nro_telefono", "telefono movil"],
  telefonoEmergencia: ["telefono de emergencia", "teléfono de emergencia", "contacto emergencia", "telefono_emergencia", "tlf_emergencia", "tlf emergencia", "contacto"],
  codigoFamilia: ["codigo de familia", "código de familia", "codigo familia", "codigo_familia", "cod_familia", "familia_codigo", "codfamilia"],
  cedulaCustodio: ["cedula de custodio", "cédula de custodio", "cedula custodio", "cedula_custodio", "custodio", "cedula representante", "cédula representante", "cedulacustodio"],
  estado: ["estado"],
  municipio: ["municipio"],
  parroquia: ["parroquia"],
  sector: ["sector", "barrio", "comunidad", "direccion", "dirección"],
  comuna: ["comuna"],
  patologias: ["patologias", "patologías", "enfermedades", "patologia", "enfermedad", "enfermedadcronica"],
  motivoRefugio: ["motivo de refugio", "motivo", "causa", "motivo_refugio", "porque busca refugio", "motivo refugio", "causa_refugio"],
  pertenencias: ["pertenencias", "bienes", "pertenencias_bienes"],
  necesidadesBasicas: ["necesidades basicas", "necesidades básicas", "necesidades", "necesidad", "necesidades_basicas", "requiere"],
  totalIntegrantes: ["total integrantes", "integrantes", "total_integrantes", "cantidad integrantes", "personas_grupo", "totalintegrantes"],
  familias: ["familias", "cantidad familias", "nro familias", "familias_cantidad", "grupo_familiar"],
  observacion: ["observacion", "observaciones", "observacion_adicional", "comentarios", "nota", "notas", "observacionesadicionales"],
  embarazo: ["embarazo", "embarazada", "esta embarazada", "embarazada?", "gestando", "gestacion"]
};

let importWorkbook = null;
let rawExcelData = [];
let importHeaders = [];
let importRows = [];
let importMapping = {};

function abrirModalImportar() {
  document.getElementById('importFile').value = '';
  document.getElementById('importStep1').classList.remove('hidden');
  document.getElementById('importStep2').classList.add('hidden');
  document.getElementById('btnAtrasImportar').classList.add('hidden');
  document.getElementById('btnConfirmarImportar').classList.add('hidden');
  
  // Resetear fecha de importación
  var radios = document.getElementsByName('importFechaOpt');
  radios.forEach(function(r) {
    if (r.value === 'hoy') r.checked = true;
  });
  document.getElementById('wrapperImportFechaInput').classList.add('hidden');
  document.getElementById('importFechaEspecifica').value = '';

  document.getElementById('modalImportar').classList.add('show');
}

function cerrarModalImportar() {
  document.getElementById('modalImportar').classList.remove('show');
}

function actualizarVisibilidadFechaImport() {
  const opt = document.querySelector('input[name="importFechaOpt"]:checked').value;
  const wrapper = document.getElementById('wrapperImportFechaInput');
  if (opt === 'especifica') {
    wrapper.classList.remove('hidden');
    const input = document.getElementById('importFechaEspecifica');
    if (!input.value) {
      input.value = new Date().toISOString().slice(0, 10);
    }
  } else {
    wrapper.classList.add('hidden');
  }
}

function irAtrasImportar() {
  document.getElementById('importFile').value = '';
  document.getElementById('importStep1').classList.remove('hidden');
  document.getElementById('importStep2').classList.add('hidden');
  document.getElementById('btnAtrasImportar').classList.add('hidden');
  document.getElementById('btnConfirmarImportar').classList.add('hidden');
}

function normalizeString(str) {
  if (!str) return "";
  return String(str)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function procesarArchivoImportar(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      importWorkbook = XLSX.read(data, { type: 'array' });
      
      if (importWorkbook.SheetNames.length === 0) {
        showToast('El archivo Excel no contiene hojas de trabajo.', 'error');
        return;
      }

      // Inicializar selector de hojas
      const sheetSelect = document.getElementById('importSheetSelect');
      let optionsHtml = '';
      for (let i = 0; i < importWorkbook.SheetNames.length; i++) {
        optionsHtml += '<option value="' + escapeHtml(importWorkbook.SheetNames[i]) + '">' + escapeHtml(importWorkbook.SheetNames[i]) + '</option>';
      }
      sheetSelect.innerHTML = optionsHtml;

      // Mostrar selector solo si hay más de 1 hoja
      const selectorContainer = document.getElementById('importSheetSelectorContainer');
      if (importWorkbook.SheetNames.length > 1) {
        selectorContainer.classList.remove('hidden');
      } else {
        selectorContainer.classList.add('hidden');
      }

      // Cargar primera hoja por defecto
      cargarHojaExcel(importWorkbook.SheetNames[0]);
    } catch (err) {
      showToast('Error al leer el archivo Excel: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function cambiarHojaExcel(sheetName) {
  cargarHojaExcel(sheetName);
}

function cargarHojaExcel(sheetName) {
  const worksheet = importWorkbook.Sheets[sheetName];
  if (!worksheet) return;

  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  if (jsonData.length === 0) {
    showToast('La hoja seleccionada está vacía.', 'warning');
    rawExcelData = [];
    importHeaders = [];
    importRows = [];
    inicializarEmparejamiento();
    return;
  }

  rawExcelData = jsonData;
  document.getElementById('importHeaderRow').value = 1;
  document.getElementById('importHeaderRow').max = rawExcelData.length;

  actualizarDatosPorFilaEncabezado(1);
}

function cambiarFilaEncabezados(val) {
  const fila = parseInt(val) || 1;
  if (fila < 1 || fila > rawExcelData.length) {
    return;
  }
  actualizarDatosPorFilaEncabezado(fila);
}

function actualizarDatosPorFilaEncabezado(filaNum) {
  const idx = filaNum - 1;
  
  importHeaders = (rawExcelData[idx] || []).map(function(h) {
    return String(h === null || h === undefined ? '' : h).trim();
  });
  
  importRows = rawExcelData.slice(idx + 1);

  if (importHeaders.length === 0 || importHeaders.every(h => h === '')) {
    showToast('Advertencia: La fila de encabezados seleccionada está vacía.', 'warning');
  }

  inicializarEmparejamiento();
}

function inicializarEmparejamiento() {
  importMapping = {};
  
  // Realizar emparejamiento automático por campo
  for (const campo in CAMPOS_SISTEMA) {
    let indexAuto = -1;
    const aliases = ALIASES_IMPORT[campo] || [];
    
    for (let i = 0; i < importHeaders.length; i++) {
      const headerNorm = normalizeString(importHeaders[i]);
      
      if (headerNorm === normalizeString(campo) || headerNorm === normalizeString(CAMPOS_SISTEMA[campo])) {
        indexAuto = i;
        break;
      }
      
      const matchesAlias = aliases.some(alias => normalizeString(alias) === headerNorm);
      if (matchesAlias) {
        indexAuto = i;
        break;
      }
    }
    
    importMapping[campo] = indexAuto;
  }

  renderizarMappingUI();
  renderizarVistaPrevia();

  document.getElementById('importStep1').classList.add('hidden');
  document.getElementById('importStep2').classList.remove('hidden');
  document.getElementById('btnAtrasImportar').classList.remove('hidden');
  
  const btnConfirm = document.getElementById('btnConfirmarImportar');
  btnConfirm.innerHTML = '<span class="material-icons-outlined">check_circle</span> Importar ' + importRows.length + ' registro(s)';
  btnConfirm.disabled = false;
  btnConfirm.classList.remove('hidden');
}

function renderizarMappingUI() {
  const container = document.getElementById('importMappingContainer');
  let html = '';

  for (const campo in CAMPOS_SISTEMA) {
    const label = CAMPOS_SISTEMA[campo];
    const preselectedIdx = importMapping[campo];

    html += '<div class="mapping-row">';
    html += '<label>' + escapeHtml(label) + '</label>';
    html += '<select class="form-control" style="padding: 6px 12px; font-size: 0.8rem;" onchange="actualizarMapping(\'' + campo + '\', this.value)">';
    html += '<option value="-1">(Ninguno / Omitir)</option>';
    
    for (let i = 0; i < importHeaders.length; i++) {
      const selected = (i === preselectedIdx) ? 'selected' : '';
      html += '<option value="' + i + '" ' + selected + '>' + escapeHtml(importHeaders[i]) + '</option>';
    }
    
    html += '</select>';
    html += '</div>';
  }

  container.innerHTML = html;
}

function actualizarMapping(campo, val) {
  importMapping[campo] = parseInt(val);
  renderizarVistaPrevia();
}

function renderizarVistaPrevia() {
  const thead = document.getElementById('importPreviewHead');
  const tbody = document.getElementById('importPreviewBody');

  let headHtml = '<tr>';
  const camposActivos = [];
  
  for (const campo in CAMPOS_SISTEMA) {
    if (importMapping[campo] !== -1) {
      headHtml += '<th>' + escapeHtml(CAMPOS_SISTEMA[campo]) + '</th>';
      camposActivos.push(campo);
    }
  }
  
  if (camposActivos.length === 0) {
    thead.innerHTML = '<tr><th>Sin columnas emparejadas</th></tr>';
    tbody.innerHTML = '<tr><td>Por favor, asocie al menos una columna de su Excel para visualizar la vista previa.</td></tr>';
    return;
  }
  
  headHtml += '</tr>';
  thead.innerHTML = headHtml;

  const numRows = Math.min(3, importRows.length);
  let bodyHtml = '';

  for (let r = 0; r < numRows; r++) {
    bodyHtml += '<tr>';
    const row = importRows[r];
    
    for (let c = 0; c < camposActivos.length; c++) {
      const campo = camposActivos[c];
      const colIdx = importMapping[campo];
      const rawVal = row[colIdx];
      const valStr = procesarValorImportar(campo, rawVal);
      bodyHtml += '<td>' + escapeHtml(valStr) + '</td>';
    }
    
    bodyHtml += '</tr>';
  }
  
  tbody.innerHTML = bodyHtml;
}

function procesarValorImportar(campo, rawVal) {
  if (rawVal === undefined || rawVal === null) return '';
  
  if (campo === 'edad') {
    return parseInt(rawVal) || 0;
  }
  if (campo === 'sexo') {
    const val = String(rawVal).trim().toLowerCase();
    if (val.startsWith('m') || val.includes('masc')) return 'Masculino';
    if (val.startsWith('f') || val.includes('fem')) return 'Femenino';
    return String(rawVal).trim();
  }
  if (campo === 'telefono' || campo === 'telefonoEmergencia' || campo === 'cedulaCustodio') {
    return String(rawVal).trim().replace(/[^0-9]/g, '');
  }
  if (campo === 'codigoFamilia') {
    return String(rawVal).trim().toUpperCase();
  }
  if (campo === 'embarazo') {
    if (typeof rawVal === 'boolean') return rawVal ? 'SÍ' : 'NO';
    const val = String(rawVal).trim().toLowerCase();
    if (val === 'si' || val === 'sí' || val === 'yes' || val === 'true' || val === 's' || val === 'y' || val === '1') {
      return 'SÍ';
    }
    return 'NO';
  }
  if (campo === 'totalIntegrantes' || campo === 'familias') {
    return parseInt(rawVal) || 1;
  }
  return String(rawVal).trim();
}

function ejecutarImportacion() {
  const camposActivos = [];
  for (const campo in importMapping) {
    if (importMapping[campo] !== -1) {
      camposActivos.push(campo);
    }
  }

  if (camposActivos.length === 0) {
    showToast('Debe asociar al menos una columna para poder realizar la importación.', 'error');
    return;
  }

  const omitirDuplicados = document.getElementById('chkImportOmitirDuplicados').checked;
  const omitirSinNombre = document.getElementById('chkImportOmitirSinNombre').checked;

  let totalDuplicados = 0;
  let totalSinNombre = 0;

  const mappedRegistros = [];
  for (let r = 0; r < importRows.length; r++) {
    const row = importRows[r];
    if (!row || row.length === 0 || row.every(val => val === null || val === undefined || String(val).trim() === '')) {
      continue;
    }

    const registro = {};
    for (const campo in CAMPOS_SISTEMA) {
      const colIdx = importMapping[campo];
      if (colIdx !== -1 && colIdx !== undefined) {
        const rawVal = row[colIdx];
        
        if (campo === 'edad') {
          registro.edad = parseInt(rawVal) || 0;
        } else if (campo === 'totalIntegrantes') {
          registro.totalIntegrantes = parseInt(rawVal) || 1;
        } else if (campo === 'familias') {
          registro.familias = parseInt(rawVal) || 1;
        } else if (campo === 'embarazo') {
          if (typeof rawVal === 'boolean') {
            registro.embarazo = rawVal;
          } else {
            const val = String(rawVal || '').trim().toLowerCase();
            registro.embarazo = (val === 'si' || val === 'sí' || val === 'yes' || val === 'true' || val === 's' || val === 'y' || val === '1');
          }
        } else if (campo === 'sexo') {
          const val = String(rawVal || '').trim().toLowerCase();
          if (val.startsWith('m') || val.includes('masc')) {
            registro.sexo = 'Masculino';
          } else if (val.startsWith('f') || val.includes('fem')) {
            registro.sexo = 'Femenino';
          } else {
            registro.sexo = String(rawVal || '').trim();
          }
        } else {
          registro[campo] = String(rawVal || '').trim();
        }
      } else {
        if (campo === 'edad') registro.edad = 0;
        else if (campo === 'totalIntegrantes') registro.totalIntegrantes = 1;
        else if (campo === 'familias') registro.familias = 1;
        else if (campo === 'embarazo') registro.embarazo = false;
        else registro[campo] = '';
      }
    }
    
    // Omitir sin nombre completo
    if (omitirSinNombre && !registro.nombreCompleto) {
      totalSinNombre++;
      continue;
    }

    // Omitir duplicados por CI
    if (omitirDuplicados && registro.ci) {
      const ciStr = String(registro.ci).trim();
      if (ciStr) {
        const existeDB = allRegistros.some(function(item) {
          return String(item['CI'] || '').trim() === ciStr;
        });
        const existeImportado = mappedRegistros.some(function(item) {
          return String(item.ci || '').trim() === ciStr;
        });
        if (existeDB || existeImportado) {
          totalDuplicados++;
          continue;
        }
      }
    }

    registro.registradoPor = currentUser ? currentUser.nombre : 'Importador XLSX';
    mappedRegistros.push(registro);
  }

  if (mappedRegistros.length === 0) {
    let warnMsg = 'No se encontraron registros nuevos válidos para importar.';
    if (totalDuplicados > 0 || totalSinNombre > 0) {
      warnMsg += ' (Se omitieron: ' + totalDuplicados + ' duplicados y ' + totalSinNombre + ' sin nombre)';
    }
    showToast(warnMsg, 'warning');
    return;
  }

  // Leer fecha personalizada si aplica
  let fechaPersonalizada = null;
  const fechaOpt = document.querySelector('input[name="importFechaOpt"]:checked').value;
  if (fechaOpt === 'especifica') {
    fechaPersonalizada = document.getElementById('importFechaEspecifica').value;
  }

  const btn = document.getElementById('btnConfirmarImportar');
  const btnText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 0.8s linear infinite;">sync</span> Importando...';

  gasRequest('guardarRegistrosMultiples', { registros: mappedRegistros, fechaPersonalizada: fechaPersonalizada }).then(function(result) {
    btn.disabled = false;
    btn.innerHTML = btnText;
    if (result && result.exito) {
      let msg = result.mensaje;
      if (totalDuplicados > 0 || totalSinNombre > 0) {
        msg += ' (Omitidos: ' + totalDuplicados + ' duplicados, ' + totalSinNombre + ' sin nombre)';
      }
      showToast(msg, 'success');
      cerrarModalImportar();
      cargarRegistros();
      if (currentUser && currentUser.rol === 'admin') {
        cargarDashboard();
      }
    } else {
      showToast('Error al importar: ' + (result ? result.mensaje : 'desconocido'), 'error');
    }
  }).catch(function(err) {
    btn.disabled = false;
    btn.innerHTML = btnText;
    showToast('Error de red al importar registros: ' + err.message, 'error');
  });
}

// ─── CAMPOS GEOGRÁFICOS INTELIGENTES ──────────────────────────

function inicializarOpcionesGeograficas() {
  const estados = [...new Set(allRegistros.map(function(r) {
    return String(r['ESTADO'] || '').trim().toUpperCase();
  }).filter(Boolean))].sort();

  const estadoSelect = document.getElementById('fEstadoSelect');
  let html = '<option value="">Seleccione...</option>';
  estados.forEach(function(est) {
    html += '<option value="' + escapeHtml(est) + '">' + escapeHtml(est) + '</option>';
  });
  html += '<option value="OTRO">Otro...</option>';
  estadoSelect.innerHTML = html;

  document.getElementById('fEstado').value = '';
  document.getElementById('wrapperEstadoOtro').classList.add('hidden');

  actualizarMunicipioOpciones('');
}

function actualizarMunicipioOpciones(estado, valorSeleccionado) {
  const municipioSelect = document.getElementById('fMunicipioSelect');
  const wrapper = document.getElementById('wrapperMunicipioOtro');
  const input = document.getElementById('fMunicipio');

  if (!estado || estado === 'OTRO') {
    let optionsHtml = '';
    if (estado === 'OTRO') {
      optionsHtml = '<option value="OTRO">Otro...</option>';
      municipioSelect.innerHTML = optionsHtml;
      municipioSelect.value = 'OTRO';
      wrapper.classList.remove('hidden');
      input.value = valorSeleccionado || '';
      actualizarParroquiaOpciones('OTRO', 'OTRO', valorSeleccionado);
    } else {
      optionsHtml = '<option value="">Seleccione estado primero...</option><option value="OTRO">Otro...</option>';
      municipioSelect.innerHTML = optionsHtml;
      municipioSelect.value = '';
      wrapper.classList.add('hidden');
      input.value = '';
      actualizarParroquiaOpciones('', '');
    }
    return;
  }

  const municipios = [...new Set(allRegistros.filter(function(r) {
    return String(r['ESTADO'] || '').trim().toUpperCase() === estado;
  }).map(function(r) {
    return String(r['MUNICIPIO'] || '').trim().toUpperCase();
  }).filter(Boolean))].sort();

  let html = '<option value="">Seleccione...</option>';
  municipios.forEach(function(mun) {
    html += '<option value="' + escapeHtml(mun) + '">' + escapeHtml(mun) + '</option>';
  });
  html += '<option value="OTRO">Otro...</option>';
  municipioSelect.innerHTML = html;

  if (valorSeleccionado) {
    const valUpper = String(valorSeleccionado).trim().toUpperCase();
    if (municipios.indexOf(valUpper) !== -1) {
      municipioSelect.value = valUpper;
      input.value = valUpper;
      wrapper.classList.add('hidden');
      actualizarParroquiaOpciones(estado, valUpper);
    } else {
      municipioSelect.value = 'OTRO';
      input.value = valorSeleccionado;
      wrapper.classList.remove('hidden');
      actualizarParroquiaOpciones(estado, 'OTRO', valorSeleccionado);
    }
  } else {
    municipioSelect.value = '';
    input.value = '';
    wrapper.classList.add('hidden');
    actualizarParroquiaOpciones(estado, '');
  }
}

function actualizarParroquiaOpciones(estado, municipio, valorSeleccionado) {
  const parroquiaSelect = document.getElementById('fParroquiaSelect');
  const wrapper = document.getElementById('wrapperParroquiaOtro');
  const input = document.getElementById('fParroquia');

  if (!estado || estado === 'OTRO' || !municipio || municipio === 'OTRO') {
    let optionsHtml = '';
    if (municipio === 'OTRO' || estado === 'OTRO') {
      optionsHtml = '<option value="OTRO">Otro...</option>';
      parroquiaSelect.innerHTML = optionsHtml;
      parroquiaSelect.value = 'OTRO';
      wrapper.classList.remove('hidden');
      input.value = valorSeleccionado || '';
      actualizarComunaOpciones('OTRO', 'OTRO', 'OTRO', valorSeleccionado);
    } else {
      optionsHtml = '<option value="">Seleccione municipio primero...</option><option value="OTRO">Otro...</option>';
      parroquiaSelect.innerHTML = optionsHtml;
      parroquiaSelect.value = '';
      wrapper.classList.add('hidden');
      input.value = '';
      actualizarComunaOpciones('', '', '');
    }
    return;
  }

  const parroquias = [...new Set(allRegistros.filter(function(r) {
    return String(r['ESTADO'] || '').trim().toUpperCase() === estado &&
           String(r['MUNICIPIO'] || '').trim().toUpperCase() === municipio;
  }).map(function(r) {
    return String(r['PARROQUIA'] || '').trim().toUpperCase();
  }).filter(Boolean))].sort();

  let html = '<option value="">Seleccione...</option>';
  parroquias.forEach(function(parr) {
    html += '<option value="' + escapeHtml(parr) + '">' + escapeHtml(parr) + '</option>';
  });
  html += '<option value="OTRO">Otro...</option>';
  parroquiaSelect.innerHTML = html;

  if (valorSeleccionado) {
    const valUpper = String(valorSeleccionado).trim().toUpperCase();
    if (parroquias.indexOf(valUpper) !== -1) {
      parroquiaSelect.value = valUpper;
      input.value = valUpper;
      wrapper.classList.add('hidden');
      actualizarComunaOpciones(estado, municipio, valUpper);
    } else {
      parroquiaSelect.value = 'OTRO';
      input.value = valorSeleccionado;
      wrapper.classList.remove('hidden');
      actualizarComunaOpciones(estado, municipio, 'OTRO', valorSeleccionado);
    }
  } else {
    parroquiaSelect.value = '';
    input.value = '';
    wrapper.classList.add('hidden');
    actualizarComunaOpciones(estado, municipio, '');
  }
}

function actualizarComunaOpciones(estado, municipio, parroquia, valorSeleccionado) {
  const comunaSelect = document.getElementById('fComunaSelect');
  const wrapper = document.getElementById('wrapperComunaOtro');
  const input = document.getElementById('fComuna');

  if (!estado || estado === 'OTRO' || !municipio || municipio === 'OTRO' || !parroquia || parroquia === 'OTRO') {
    let optionsHtml = '';
    if (parroquia === 'OTRO' || municipio === 'OTRO' || estado === 'OTRO') {
      optionsHtml = '<option value="OTRO">Otro...</option>';
      comunaSelect.innerHTML = optionsHtml;
      comunaSelect.value = 'OTRO';
      wrapper.classList.remove('hidden');
      input.value = valorSeleccionado || '';
    } else {
      optionsHtml = '<option value="">Seleccione parroquia primero...</option><option value="OTRO">Otro...</option>';
      comunaSelect.innerHTML = optionsHtml;
      comunaSelect.value = '';
      wrapper.classList.add('hidden');
      input.value = '';
    }
    return;
  }

  const comunas = [...new Set(allRegistros.filter(function(r) {
    return String(r['ESTADO'] || '').trim().toUpperCase() === estado &&
           String(r['MUNICIPIO'] || '').trim().toUpperCase() === municipio &&
           String(r['PARROQUIA'] || '').trim().toUpperCase() === parroquia;
  }).map(function(r) {
    return String(r['COMUNA'] || '').trim().toUpperCase();
  }).filter(Boolean))].sort();

  let html = '<option value="">Seleccione...</option>';
  comunas.forEach(function(com) {
    html += '<option value="' + escapeHtml(com) + '">' + escapeHtml(com) + '</option>';
  });
  html += '<option value="OTRO">Otro...</option>';
  comunaSelect.innerHTML = html;

  if (valorSeleccionado) {
    const valUpper = String(valorSeleccionado).trim().toUpperCase();
    if (comunas.indexOf(valUpper) !== -1) {
      comunaSelect.value = valUpper;
      input.value = valUpper;
      wrapper.classList.add('hidden');
    } else {
      comunaSelect.value = 'OTRO';
      input.value = valorSeleccionado;
      wrapper.classList.remove('hidden');
    }
  } else {
    comunaSelect.value = '';
    input.value = '';
    wrapper.classList.add('hidden');
  }
}

function cambiarSeleccionGeografica(campo) {
  const select = document.getElementById('f' + campo + 'Select');
  const input = document.getElementById('f' + campo);
  const wrapper = document.getElementById('wrapper' + campo + 'Otro');
  const val = select.value;

  if (val === 'OTRO') {
    wrapper.classList.remove('hidden');
    input.value = '';
    input.focus();
    
    if (campo === 'Estado') {
      actualizarMunicipioOpciones('OTRO');
    } else if (campo === 'Municipio') {
      const estado = document.getElementById('fEstadoSelect').value;
      actualizarParroquiaOpciones(estado, 'OTRO');
    } else if (campo === 'Parroquia') {
      const estado = document.getElementById('fEstadoSelect').value;
      const municipio = document.getElementById('fMunicipioSelect').value;
      actualizarComunaOpciones(estado, municipio, 'OTRO');
    }
  } else {
    wrapper.classList.add('hidden');
    input.value = val;

    if (campo === 'Estado') {
      actualizarMunicipioOpciones(val);
    } else if (campo === 'Municipio') {
      const estado = document.getElementById('fEstadoSelect').value;
      actualizarParroquiaOpciones(estado, val);
    } else if (campo === 'Parroquia') {
      const estado = document.getElementById('fEstadoSelect').value;
      const municipio = document.getElementById('fMunicipioSelect').value;
      actualizarComunaOpciones(estado, municipio, val);
    }
  }
}

function establecerValorGeografico(campo, valor) {
  const select = document.getElementById('f' + campo + 'Select');
  const input = document.getElementById('f' + campo);
  const wrapper = document.getElementById('wrapper' + campo + 'Otro');
  const valUpper = String(valor).trim().toUpperCase();

  if (!valor) {
    select.value = "";
    input.value = "";
    wrapper.classList.add('hidden');
    
    if (campo === 'Estado') {
      actualizarMunicipioOpciones('');
    } else if (campo === 'Municipio') {
      actualizarParroquiaOpciones('', '');
    } else if (campo === 'Parroquia') {
      actualizarComunaOpciones('', '', '');
    }
    return;
  }

  // Buscar si la opción existe
  let existe = false;
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].value === valUpper) {
      existe = true;
      break;
    }
  }

  if (existe) {
    select.value = valUpper;
    input.value = valUpper;
    wrapper.classList.add('hidden');
  } else {
    // Si no existe, agregarla dinámicamente o seleccionar OTRO
    select.value = 'OTRO';
    input.value = valor;
    wrapper.classList.remove('hidden');
  }

  if (campo === 'Estado') {
    actualizarMunicipioOpciones(valUpper, valUpper === 'OTRO' ? valor : '');
  } else if (campo === 'Municipio') {
    const estado = document.getElementById('fEstadoSelect').value;
    actualizarParroquiaOpciones(estado, valUpper, valUpper === 'OTRO' ? valor : '');
  } else if (campo === 'Parroquia') {
    const estado = document.getElementById('fEstadoSelect').value;
    const municipio = document.getElementById('fMunicipioSelect').value;
    actualizarComunaOpciones(estado, municipio, valUpper, valUpper === 'OTRO' ? valor : '');
  }
}

function analizarDuplicados() {
  const container = document.getElementById('listaDuplicadosContainer');
  const badge = document.getElementById('duplicatesBadge');
  if (!container) return;

  // 1. Agrupar registros por CI (Cédula de Identidad)
  const ciGroups = {};
  allRegistros.forEach(function(r) {
    const ciKey = Object.keys(r).find(function(k) {
      return k.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") === "ci";
    }) || 'CI';
    
    let ci = String(r[ciKey] || '').trim().toUpperCase();
    
    // Ignorar vacíos, sin información y otros marcadores comunes de datos faltantes
    if (!ci || ci === 'SIN INFORMACION' || ci === 'SIN CEDULA' || ci === 'SIN CÉDULA' || ci === '0' || ci === 'X' || ci === 'NO TIENE' || ci === '-') {
      return;
    }
    
    if (!ciGroups[ci]) {
      ciGroups[ci] = [];
    }
    ciGroups[ci].push(r);
  });

  // 2. Filtrar grupos que tengan más de un registro (duplicados reales)
  const duplicadosList = [];
  for (const ci in ciGroups) {
    if (ciGroups[ci].length > 1) {
      duplicadosList.push({
        ci: ci,
        nombre: ciGroups[ci][0]['NOMBRE COMPLETO'] || 'SIN NOMBRE',
        items: ciGroups[ci]
      });
    }
  }

  // Ordenar por el nombre del primer registro
  duplicadosList.sort(function(a, b) {
    return a.nombre.localeCompare(b.nombre);
  });

  // 3. Actualizar contadores del Badge
  if (badge) {
    badge.textContent = duplicadosList.length;
    if (duplicadosList.length > 0) {
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  // 4. Renderizar la lista de duplicados
  if (duplicadosList.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
        <span class="material-icons-outlined" style="font-size: 48px; color: var(--accent-gold); margin-bottom: 12px;">verified</span>
        <p style="font-weight: 600; margin: 0; color: var(--text-primary);">¡Felicidades! Base de datos limpia</p>
        <p style="font-size: 0.85rem; margin: 4px 0 0 0;">No se encontraron registros con números de Cédula duplicados.</p>
      </div>
    `;
    return;
  }

  let html = '<div style="display: flex; flex-direction: column; gap: 20px;">';
  
  duplicadosList.forEach(function(grupo) {
    html += `
      <div class="card" style="border: 1px solid var(--border-subtle); background: var(--surface-200); border-radius: var(--radius-lg); overflow: hidden;">
        <div style="background: rgba(239, 83, 80, 0.12); padding: 12px 16px; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="color: #ef5350; font-size: 0.95rem; display: inline-flex; align-items: center; gap: 6px;">
              <span class="material-icons-outlined" style="font-size:18px;">warning</span>
              Cédula Duplicada: ${escapeHtml(grupo.ci)}
            </strong>
            <span style="font-size: 0.8rem; color: var(--text-secondary); margin-left: 12px;">Nombre de referencia: <strong>${escapeHtml(grupo.nombre)}</strong></span>
          </div>
          <span class="badge" style="background: #ef5350; color: #fff; padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.75rem;">
            ${grupo.items.length} Coincidencias
          </span>
        </div>
        <div style="padding: 0; overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; margin: 0; font-size: 0.85rem; color: var(--text-primary);">
            <thead>
              <tr style="background: var(--surface-300); text-align: left; border-bottom: 1px solid var(--border-subtle);">
                <th style="padding: 10px 16px; width: 60px;">N°</th>
                <th style="padding: 10px 16px;">Nombre Completo</th>
                <th style="padding: 10px 16px;">Ubicación (Estado/Sector)</th>
                <th style="padding: 10px 16px; width: 150px;">Fecha Registro</th>
                <th style="padding: 10px 16px; width: 140px;">Registrado Por</th>
                <th style="padding: 10px 16px; width: 110px; text-align: center;">Acciones</th>
              </tr>
            </thead>
            <tbody>
    `;

    grupo.items.forEach(function(item) {
      const corr = item['N°'] || '';
      const nom = item['NOMBRE COMPLETO'] || '';
      const ubi = (item['ESTADO'] || '') + ' - ' + (item['SECTOR'] || '');
      const fec = item['FECHA_REGISTRO'] || '';
      const por = item['REGISTRADO_POR'] || '';

      html += `
              <tr style="border-bottom: 1px solid var(--border-subtle); background: var(--surface-100);">
                <td style="padding: 10px 16px; font-weight: bold; color: var(--accent-gold);">${corr}</td>
                <td style="padding: 10px 16px;">${escapeHtml(nom)}</td>
                <td style="padding: 10px 16px; color: var(--text-secondary);">${escapeHtml(ubi)}</td>
                <td style="padding: 10px 16px; font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(fec)}</td>
                <td style="padding: 10px 16px; font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(por)}</td>
                <td style="padding: 10px 16px; text-align: center;">
                  <button class="btn btn-secondary btn-xs" onclick="cargarRegistroEnFormulario(${corr})" title="Editar registro" style="padding: 4px 8px; font-size: 0.7rem; margin-right: 4px; display: inline-flex; align-items: center; justify-content: center; min-width: 28px;">
                    <span class="material-icons-outlined" style="font-size:12px;">edit</span>
                  </button>
                  <button class="btn btn-danger btn-xs" onclick="confirmarEliminar(${corr})" title="Eliminar registro" style="padding: 4px 8px; font-size: 0.7rem; background: #ef5350; display: inline-flex; align-items: center; justify-content: center; min-width: 28px; border: none; border-radius: var(--radius-sm); color: white; cursor: pointer;">
                    <span class="material-icons-outlined" style="font-size:12px;">delete</span>
                  </button>
                </td>
              </tr>
      `;
    });

    html += `
            </tbody>
          </table>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// ─── CONFIGURACIÓN DE FAMILIAS BASE (LÍNEA BASE) ────────────
let configFamiliasGlobal = { base: 0, fecha: "" };

function cargarConfiguracionFamilias() {
  // Cargar de localStorage primero (offline)
  var local = localStorage.getItem('refugio_config_familias');
  if (local) {
    try {
      configFamiliasGlobal = JSON.parse(local);
    } catch(e) {}
  }
  
  if (navigator.onLine) {
    gasRequest('obtenerConfigFamilias', {}).then(function(res) {
      if (res && res.familiasBase !== undefined) {
        configFamiliasGlobal = {
          base: parseInt(res.familiasBase) || 0,
          fecha: res.familiasBaseFecha || ""
        };
        localStorage.setItem('refugio_config_familias', JSON.stringify(configFamiliasGlobal));
        
        var seccionDb = document.getElementById('seccionDashboard');
        if (seccionDb && seccionDb.classList.contains('active')) {
          filtrarDashboard();
        }
      }
    }).catch(function(err) {
      console.warn("Error offline al obtener config familias:", err);
    });
  }
}

function abrirModalConfigFamilias() {
  document.getElementById('cfgFamiliasBase').value = configFamiliasGlobal.base || 0;
  document.getElementById('cfgFamiliasBaseFecha').value = configFamiliasGlobal.fecha || "";
  document.getElementById('modalConfigFamilias').classList.add('show');
}

function cerrarModalConfigFamilias() {
  document.getElementById('modalConfigFamilias').classList.remove('show');
}

function guardarConfiguracionFamiliasFront() {
  var base = parseInt(document.getElementById('cfgFamiliasBase').value) || 0;
  var fecha = document.getElementById('cfgFamiliasBaseFecha').value;

  if (!fecha) {
    showToast('La fecha de inicio es obligatoria', 'error');
    return;
  }

  var btn = document.getElementById('btnGuardarConfigFamilias');
  var oldText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 0.8s linear infinite;">sync</span> Guardando...';

  configFamiliasGlobal = { base: base, fecha: fecha };
  localStorage.setItem('refugio_config_familias', JSON.stringify(configFamiliasGlobal));

  if (navigator.onLine) {
    gasRequest('guardarConfigFamilias', { base: base, fecha: fecha }).then(function(res) {
      btn.disabled = false;
      btn.innerHTML = oldText;
      if (res && res.exito) {
        showToast(res.mensaje, 'success');
        cerrarModalConfigFamilias();
        filtrarDashboard();
      } else {
        showToast(res ? res.mensaje : 'Error al guardar', 'error');
      }
    }).catch(function(err) {
      btn.disabled = false;
      btn.innerHTML = oldText;
      showToast('Guardado localmente (sin conexión con el servidor)', 'warning');
      cerrarModalConfigFamilias();
      filtrarDashboard();
    });
  } else {
    btn.disabled = false;
    btn.innerHTML = oldText;
    showToast('Guardado localmente (modo offline)', 'warning');
    cerrarModalConfigFamilias();
    filtrarDashboard();
  }
}