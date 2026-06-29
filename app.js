// =====================================================
// CONFIGURACIÓN — reemplazá con tu URL de Google Apps Script
// =====================================================
const URL = "https://script.google.com/macros/s/AKfycbyQ8IvEWgpl5Vj--Zal4-144FBQEtB3Mkpm-zcAISK33iW28peCTELMkqwlo6qJ1fnc/exec";
const CLIENT_SECRET = 'REPLACE_WITH_SECRET';

// =====================================================
// ESTADO GLOBAL
// =====================================================
let alumnos         = [];
let docentes        = [];
let salidas         = [];
let historial       = [];
let usuarioActivo   = null;
let timers          = {};
let ultimoAudioPlay = 0;
let autoRefreshTimer  = null;
let isRefreshing      = false;
let ultimoHashDatos   = null;
let ultimoActualizado = null;
let sharedAudioCtx    = null;
let pendingRequests   = [];
let queueTimer        = null;
let queueProcessing   = false;

// =====================================================
// INIT
// =====================================================
window.addEventListener("load", () => {
    iniciarAutoActualizacion();
    cargarDatos();
    toggleCausaAdicional();
    if (localStorage.getItem("theme") === "light") {
        document.body.classList.add("light-mode");
        document.getElementById("themeToggle").innerText = "☀️";
    }
});

// =====================================================
// AUTO-REFRESH
// =====================================================
function iniciarAutoActualizacion() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
        if (!isRefreshing) {
            mostrarIndicadorActualizacion(true);
            cargarDatos(true);
        }
    }, 5000);
}

function detenerAutoActualizacion() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

function pauseAutoRefresh()  { detenerAutoActualizacion(); }
function resumeAutoRefresh() { iniciarAutoActualizacion(); }

// =====================================================
// INDICADOR DE ACTUALIZACIÓN
// =====================================================
function mostrarIndicadorActualizacion(show) {
    const status = document.getElementById("refresh-status");
    if (!status) return;
    if (show) {
        status.classList.remove("hidden");
        status.classList.add("pulsing");
    } else {
        status.classList.add("hidden");
        status.classList.remove("pulsing");
    }
}

function actualizarUltimaActualizacion(fecha = new Date()) {
    ultimoActualizado = fecha;
    const status = document.getElementById("last-updated");
    if (!status) return;
    status.textContent = `Última actualización: ${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString()}`;
}

function manualRefresh() {
    if (isRefreshing) return;
    const button = document.getElementById("manualRefreshBtn");
    if (button) button.disabled = true;
    mostrarIndicadorActualizacion(true);
    cargarDatos(true, true).finally(() => {
        if (button) button.disabled = false;
    });
}

// =====================================================
// UTILIDADES
// =====================================================
function stableStringify(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(key => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}';
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDateField(val) {
    if (!val && val !== 0) return '';
    if (typeof val === 'string' && val.indexOf('/') !== -1) return val;
    if (typeof val === 'number') return new Date(val).toLocaleString();
    try {
        const d = new Date(val);
        if (!isNaN(d.getTime())) return d.toLocaleString();
    } catch (e) { /* ignore */ }
    return String(val);
}

function cleanDni(val) {
    if (val === null || val === undefined) return "";
    let s = String(val).trim().split('.')[0];
    return s.replace(/[^0-9a-zA-Z]/g, "");
}

// =====================================================
// RESOLUCIÓN DE PROPIEDADES (tolerante a acentos)
// =====================================================
function obtenerPropiedadAlumno(obj, posiblesCabeceras) {
    if (!obj) return "";
    for (let nombre of posiblesCabeceras) {
        const normalizedTarget = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        for (let key in obj) {
            const normalizedKey = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
            if (normalizedKey === normalizedTarget) return obj[key];
        }
    }
    return "";
}

function obtenerPropiedadSalida(reg, posiblesNombres) {
    if (!reg) return "";
    const mapa = {};
    for (let key in reg) {
        try { mapa[String(key).toLowerCase().trim()] = reg[key]; } catch (e) { mapa[key] = reg[key]; }
    }
    for (let nombre of posiblesNombres) {
        const normalized = String(nombre).toLowerCase().trim();
        if (mapa[normalized] !== undefined && mapa[normalized] !== null) return mapa[normalized];
    }
    for (let key in mapa) {
        for (let nombre of posiblesNombres) {
            if (key.includes(String(nombre).toLowerCase().trim())) return mapa[key];
        }
    }
    return "";
}

function detectarFechaSalida(reg) {
    if (!reg) return "";
    const exactKeys = ['salida', 'fechahora', 'fecha/hora', 'timestamp', 'inicio', 'fecha'];
    for (let k of exactKeys) {
        if (reg[k] !== undefined && reg[k] !== null && String(reg[k]).trim() !== "") {
            const valStr = String(reg[k]).trim();
            if (valStr.includes(":") || valStr.includes("T")) return reg[k];
        }
    }
    for (let key in reg) {
        const val = String(reg[key]).trim();
        if ((val.includes("/") || val.includes("-")) && val.includes(":")) return reg[key];
    }
    for (let key in reg) {
        const keyLower = key.toLowerCase();
        if (keyLower.includes("fecha") || keyLower.includes("salida") || keyLower.includes("hora")) {
            if (reg[key]) return reg[key];
        }
    }
    return "";
}

// =====================================================
// MODALES Y DIÁLOGOS
// =====================================================
function mostrarConfirmacion(titulo, mensaje) {
    return new Promise((resolve) => {
        const modal    = document.getElementById("custom-confirm-modal");
        const titleEl  = document.getElementById("confirm-modal-title");
        const messageEl = document.getElementById("confirm-modal-message");
        const btnYes   = document.getElementById("confirm-modal-btn-yes");
        const btnNo    = document.getElementById("confirm-modal-btn-no");

        titleEl.textContent   = titulo;
        messageEl.textContent = mensaje;
        modal.style.display   = "flex";
        pauseAutoRefresh();

        function cleanup() {
            modal.style.display = "none";
            btnYes.onclick = null;
            btnNo.onclick  = null;
            resumeAutoRefresh();
        }

        btnYes.onclick = () => { cleanup(); resolve(true); };
        btnNo.onclick  = () => { cleanup(); resolve(false); };
    });
}

function mostrarModalTutor(nombreAlumno) {
    return new Promise((resolve) => {
        const modal     = document.getElementById('tutor-modal');
        const input     = document.getElementById('tutor-name-input');
        const error     = document.getElementById('tutor-name-error');
        const btnOk     = document.getElementById('tutor-modal-btn-ok');
        const btnCancel = document.getElementById('tutor-modal-btn-cancel');
        const title     = document.getElementById('tutor-modal-title');

        if (!modal || !input || !btnOk || !btnCancel) { resolve(null); return; }

        title.textContent      = `Retiro de ${nombreAlumno}`;
        input.value            = '';
        error.style.display    = 'none';
        modal.style.display    = 'flex';
        pauseAutoRefresh();
        setTimeout(() => input.focus(), 50);

        function cleanup() {
            modal.style.display = 'none';
            btnOk.onclick       = null;
            btnCancel.onclick   = null;
            resumeAutoRefresh();
        }

        btnCancel.onclick = () => { cleanup(); resolve(null); };
        btnOk.onclick = () => {
            const val = input.value.trim();
            if (!val) { error.style.display = 'block'; input.focus(); return; }
            cleanup();
            resolve(val);
        };
    });
}

function mostrarModalEstado(nombreAlumno) {
    return new Promise((resolve) => {
        const modal      = document.getElementById('estado-modal');
        const title      = document.getElementById('estado-modal-title');
        const btnAusente = document.getElementById('estado-btn-ausente');
        const btnTarde   = document.getElementById('estado-btn-tarde');
        const btnRetiro  = document.getElementById('estado-btn-retiro');
        const btnPresente = document.getElementById('estado-btn-presente');
        const btnCancel  = document.getElementById('estado-modal-btn-cancel');
        const btnSalida  = document.getElementById('estado-btn-salida');
        const btnRegreso = document.getElementById('estado-btn-regreso');

        if (!modal) { resolve(null); return; }

        title.textContent   = `Cambiar estado — ${nombreAlumno}`;
        modal.style.display = 'flex';
        pauseAutoRefresh();

        function cleanup() {
            modal.style.display = 'none';
            [btnAusente, btnTarde, btnRetiro, btnPresente, btnCancel, btnSalida, btnRegreso]
                .forEach(b => { if (b) b.onclick = null; });
            resumeAutoRefresh();
        }

        btnCancel.onclick  = () => { cleanup(); resolve(null); };
        btnAusente.onclick = () => { cleanup(); resolve('AUSENTE'); };
        btnTarde.onclick   = () => { cleanup(); resolve('LLEGADA TARDE'); };
        btnRetiro.onclick  = () => { cleanup(); resolve('RETIRO PADRE/TUTOR'); };
        btnPresente.onclick = () => { cleanup(); resolve('PRESENTE'); };
        if (btnSalida)  btnSalida.onclick  = () => { cleanup(); resolve('SALIDA'); };
        if (btnRegreso) btnRegreso.onclick  = () => { cleanup(); resolve('REGRESO'); };
    });
}

// =====================================================
// POPOVER CONTEXTUAL (⋯)
// =====================================================
let popoverVisible       = false;
let popoverOutsideHandler = null;
let popoverAnchorBtn     = null;
let popoverKeyHandler    = null;

function openPopoverForButton(btn, dni) {
    const pop = document.getElementById('popover-menu');
    if (!pop) return;
    pop.style.display = 'block';
    pop.classList.remove('visible');
    pauseAutoRefresh();

    requestAnimationFrame(() => {
        const rect    = btn.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        const margin  = 8;
        let left = rect.left + (rect.width / 2) - (popRect.width / 2);
        let top  = rect.bottom + margin;

        if (left < 8) left = 8;
        if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
        if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - margin;

        pop.style.left  = `${left}px`;
        pop.style.top   = `${top}px`;
        pop.dataset.dni = dni || '';
        pop.querySelectorAll('.popover-item').forEach(item => { item.dataset.dni = dni || ''; });
        pop.classList.add('visible');
        popoverVisible   = true;
        popoverAnchorBtn = btn;
        try { btn.setAttribute('aria-expanded', 'true'); } catch (e) {}

        const items = Array.from(pop.querySelectorAll('.popover-item'));
        items.forEach(it => it.setAttribute('role', 'menuitem'));
        if (items.length) { items[0].tabIndex = -1; items[0].focus(); }

        popoverOutsideHandler = (ev) => {
            if (!pop.contains(ev.target) && !btn.contains(ev.target)) hidePopover();
        };
        document.addEventListener('click', popoverOutsideHandler);
        document.addEventListener('keydown', popoverEscHandler);

        popoverKeyHandler = (ev) => {
            if (!popoverVisible) return;
            const its = Array.from(pop.querySelectorAll('.popover-item'));
            if (!its.length) return;
            const idx = its.indexOf(document.activeElement);
            if (ev.key === 'ArrowDown') { ev.preventDefault(); its[(idx + 1) % its.length].focus(); }
            else if (ev.key === 'ArrowUp') { ev.preventDefault(); its[(idx - 1 + its.length) % its.length].focus(); }
            else if (ev.key === 'Home') { ev.preventDefault(); its[0].focus(); }
            else if (ev.key === 'End')  { ev.preventDefault(); its[its.length - 1].focus(); }
            else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); document.activeElement.click(); }
        };
        document.addEventListener('keydown', popoverKeyHandler);
    });
}

function popoverEscHandler(e) { if (e.key === 'Escape') hidePopover(); }

function hidePopover() {
    const pop = document.getElementById('popover-menu');
    if (!pop) return;
    pop.classList.remove('visible');
    pop.style.display = 'none';
    pop.dataset.dni   = '';
    pop.querySelectorAll('.popover-item').forEach(item => delete item.dataset.dni);
    popoverVisible = false;

    if (popoverOutsideHandler) { document.removeEventListener('click', popoverOutsideHandler); popoverOutsideHandler = null; }
    document.removeEventListener('keydown', popoverEscHandler);
    if (popoverKeyHandler) { document.removeEventListener('keydown', popoverKeyHandler); popoverKeyHandler = null; }
    if (popoverAnchorBtn) {
        try { popoverAnchorBtn.removeAttribute('aria-expanded'); } catch (e) {}
        try { popoverAnchorBtn.focus(); } catch (e) {}
        popoverAnchorBtn = null;
    }
    resumeAutoRefresh();
}

// Delegación de clics en popover
document.addEventListener('click', function (e) {
    const pop  = document.getElementById('popover-menu');
    if (!pop) return;
    const item = e.target.closest('.popover-item');
    if (!item || !pop.contains(item)) return;
    const action = item.dataset.action;
    const dni    = item.dataset.dni;
    const accion = item.dataset.accion;
    hidePopover();
    if      (action === 'registrarSalida')  registrarSalida(dni);
    else if (action === 'registrarRegreso') registrarRegreso(dni);
    else if (action === 'limpiarHoraTarde') limpiarHoraLlegada(dni);
    else if (action === 'preceptor')        cambiarEstadoPreceptor(dni, accion);
});

async function limpiarHoraLlegada(dni) {
    const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
    if (!alumno) return;
    const confirmar = await mostrarConfirmacion('Limpiar hora', `¿Borrar la hora de llegada tarde de ${alumno.nombre}?`);
    if (!confirmar) return;
    alumno.horaLlegadaTarde = '';
    const payload = {
        tipoAccion: 'limpiarHoraLlegada',
        dni:        cleanDni(alumno.dni),
        nombre:     alumno.nombre,
        docente:    usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : ''
    };
    const result = await enviarTransaccionPost(payload);
    showToast(result && result.queued ? 'Petición encolada: la hora se limpiará cuando haya conexión.' : 'Hora de llegada tarde borrada.');
    historial.push({
        fechahora:       new Date().toLocaleString(),
        alumno:          alumno.nombre,
        accion:          'LIMPIAR HORA TARDE',
        usuario:         usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : 'Sistema',
        detalle:         '',
        tipoAccion:      'preceptor',
        tipo:            '',
        dni:             cleanDni(alumno.dni),
        docente:         usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : '',
        estado:          alumno.estado || '',
        horaLlegadaTarde: '',
        quienRetira:     alumno.retiroPor || '',
        horaRetiro:      alumno.horaRetiro || '',
        queued:          false
    });
    actualizarTarjetaAlumno(alumno);
    renderHistorial();
    actualizarContadores();
}

// =====================================================
// TOAST
// =====================================================
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    const toast     = document.createElement("div");
    toast.className = `toast ${type === "error" ? "error" : ""}`;
    toast.innerText = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("hide");
        setTimeout(() => toast.remove(), 400);
    }, 3500);
}

// =====================================================
// CARGA DE DATOS
// =====================================================
async function cargarDatos(silent = false, forceToast = false) {
    if (isRefreshing) return;
    isRefreshing = true;
    if (!silent) mostrarLoader(true, "Conectando con Google Sheets...");
    else         mostrarIndicadorActualizacion(true);

    const corsPanel = document.getElementById("cors-helper-panel");
    if (corsPanel) corsPanel.style.display = "none";

    try {
        const response = await fetch(URL + "?_ts=" + Date.now(), {
            method:   "GET",
            mode:     "cors",
            redirect: "follow",
            headers:  { "Accept": "application/json" }
        });

        if (!response.ok) throw new Error(`HTTP status ${response.status}`);

        const data = await response.json();
        if (!data.ok) throw new Error(data.error || "Respuesta incorrecta de Google Sheets");

        const hashActual = stableStringify(data);
        if (ultimoHashDatos && hashActual === ultimoHashDatos) {
            actualizarUltimaActualizacion(new Date());
            if (!silent || forceToast) showToast("No hay cambios en los datos.");
            return;
        }

        ultimoHashDatos = hashActual;
        actualizarUltimaActualizacion(new Date());

        const rawAlumnos = data.alumnos || [];
        alumnos = rawAlumnos.map(a => {
            const dniVal      = obtenerPropiedadAlumno(a, ['dni']);
            const nombreVal   = obtenerPropiedadAlumno(a, ['nombre', 'nombre y apellido', 'estudiante']);
            const cursoVal    = obtenerPropiedadAlumno(a, ['curso', 'año', 'ano']);
            const divisionVal = obtenerPropiedadAlumno(a, ['division', 'división', 'div']);
            const turnoVal    = obtenerPropiedadAlumno(a, ['turno']);
            const espVal      = obtenerPropiedadAlumno(a, ['especialidad', 'orientacion', 'orientación']);
            const estadoVal   = obtenerPropiedadAlumno(a, ['estado', 'asistencia']);
            const existing    = (alumnos || []).find(e => cleanDni(e.dni) === cleanDni(dniVal));
            const horaRemota  = obtenerPropiedadAlumno(a, ['horaLlegadaTarde', 'hora llegada', 'horaLlegada', 'hora']);

            return {
                dni:             dniVal,
                nombre:          nombreVal,
                curso:           cursoVal,
                division:        divisionVal,
                turno:           turnoVal,
                especialidad:    espVal,
                estado:          estadoVal,
                horaLlegadaTarde: horaRemota ? horaRemota : (existing ? existing.horaLlegadaTarde : ''),
                retiroPor:       existing ? existing.retiroPor : undefined,
                horaRetiro:      existing ? existing.horaRetiro : undefined
            };
        });

        docentes = data.docentes || [];
        salidas  = data.salidas  || [];
        historial = data.historial || [];

        actualizarFiltros();
        actualizarSelectorDocentes();
        render();
        renderHistorial();

        if (!silent || forceToast) showToast("Datos Sincronizados.");
    } catch (error) {
        console.error("Error al cargar datos:", error);
        const corsPanelErr = document.getElementById("cors-helper-panel");
        if (corsPanelErr) corsPanelErr.style.display = "block";
        showToast("Error de conexión. Revisa las instrucciones en pantalla.", "error");
    } finally {
        if (!silent) mostrarLoader(false);
        else         mostrarIndicadorActualizacion(false);
        isRefreshing = false;
    }
}

function mostrarLoader(show, text = "Cargando sistema...") {
    const loader     = document.getElementById("loader");
    const loaderText = document.getElementById("loader-text");
    if (loaderText) loaderText.textContent = text;
    if (show) loader.classList.remove("hidden");
    else      loader.classList.add("hidden");
}

// =====================================================
// SELECTORES / FILTROS
// =====================================================
function actualizarSelectorDocentes() {
    const select = document.getElementById("docentes");
    if (!select) return;
    select.innerHTML = '<option value="">Seleccione Usuario...</option>';
    docentes.forEach(d => {
        const nombreDocente = d.nombre || d.usuario || "Sin Nombre";
        const opt = document.createElement("option");
        opt.value       = nombreDocente;
        opt.textContent = nombreDocente;
        select.appendChild(opt);
    });
}

function actualizarFiltros() {
    const cursos       = [...new Set(alumnos.map(a => a.curso).filter(Boolean))].sort();
    const divisiones   = [...new Set(alumnos.map(a => a.division).filter(Boolean))].sort();
    const turnos       = [...new Set(alumnos.map(a => a.turno).filter(Boolean))].sort();
    const especialidades = [...new Set(alumnos.map(a => a.especialidad).filter(Boolean))].sort();

    cargarOpcionesFiltro("fCurso",       cursos,         "Todos los Cursos");
    cargarOpcionesFiltro("fDivision",    divisiones,     "Todas las Divisiones");
    cargarOpcionesFiltro("fTurno",       turnos,         "Todos los Turnos");
    cargarOpcionesFiltro("fEspecialidad", especialidades, "Todas las Especialidades");
}

function cargarOpcionesFiltro(id, lista, porDefecto) {
    const select = document.getElementById(id);
    if (!select) return;
    const valAnterior = select.value;
    select.innerHTML = `<option value="">-- ${porDefecto} --</option>`;
    lista.forEach(item => {
        const opt = document.createElement("option");
        opt.value       = item;
        opt.textContent = item;
        select.appendChild(opt);
    });
    if (lista.includes(valAnterior)) select.value = valAnterior;
}

function toggleCausaAdicional() {
    const causaSelect    = document.getElementById("causa");
    const causaAdicional = document.getElementById("causa-adicional");
    if (!causaSelect || !causaAdicional) return;
    if (causaSelect.value === "Otro") {
        causaAdicional.style.display = "block";
        causaAdicional.focus();
    } else {
        causaAdicional.style.display = "none";
        causaAdicional.value = "";
    }
}

function obtenerCausaSalida() {
    const causaSelect    = document.getElementById("causa");
    const causaAdicional = document.getElementById("causa-adicional");
    if (!causaSelect) return "Baño";
    const causa   = causaSelect.value || "Baño";
    const detalle = causaAdicional ? causaAdicional.value.trim() : "";
    if (causa === "Otro") return detalle ? `Otro: ${detalle}` : "Otro";
    return detalle ? `${causa} (${detalle})` : causa;
}

// =====================================================
// LOGIN / LOGOUT
// =====================================================
function verificarAcceso() {
    const selectDocente = document.getElementById("docentes");
    const passInput     = document.getElementById("passDocente");
    const nombreSel     = selectDocente.value;
    const pinSel        = passInput.value.trim();

    if (!nombreSel) { showToast("Por favor, selecciona un usuario.", "error"); return; }

    const docenteEncontrado = docentes.find(d => {
        const nombreDoc = d.nombre || d.usuario || "";
        return nombreDoc.toLowerCase() === nombreSel.toLowerCase();
    });

    if (docenteEncontrado) {
        const pinCorrecto = String(docenteEncontrado.pin || docenteEncontrado.clave || "").trim();
        if (pinCorrecto === pinSel) {
            usuarioActivo = docenteEncontrado;
            showToast(`¡Bienvenido/a, ${nombreSel}!`);

            document.getElementById("seccion-login").style.display      = "none";
            document.getElementById("seccion-filtros").style.display    = "block";
            document.getElementById("contador-container").style.display = "block";
            document.getElementById("buscador-box").style.display       = "block";
            document.getElementById("historial-container").style.display = "block";

            const rolBox = document.getElementById("rolActivo");
            rolBox.textContent  = `👤 ${nombreSel}`;
            rolBox.style.display = "block";

            document.getElementById("logoutBtn").style.display = "block";
            passInput.value = "";

            cargarDatos(true).then(() => render()).catch(() => render());
        } else {
            showToast("PIN incorrecto.", "error");
            const inputEl = document.getElementById("passDocente");
            inputEl.classList.add("shake");
            setTimeout(() => inputEl.classList.remove("shake"), 400);
        }
    } else {
        showToast("Error al encontrar los datos del docente.", "error");
    }
}

function cerrarSesion() {
    usuarioActivo = null;

    // Detener todos los cronómetros activos
    Object.keys(timers).forEach(k => {
        clearInterval(timers[k]);
        delete timers[k];
    });
    timers = {};

    // Ocultar secciones que requieren login
    document.getElementById("seccion-login").style.display       = "block";
    document.getElementById("seccion-filtros").style.display     = "none";
    document.getElementById("contador-container").style.display  = "none";
    document.getElementById("buscador-box").style.display        = "none";
    document.getElementById("historial-container").style.display = "none";
    document.getElementById("resumen-container").style.display   = "none";

    // Ocultar indicadores de sesión
    const rolBox = document.getElementById("rolActivo");
    if (rolBox) rolBox.style.display = "none";
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) logoutBtn.style.display = "none";

    // Limpiar grid
    const grid = document.getElementById("grid");
    if (grid) grid.innerHTML = "";

    // Limpiar buscador
    const buscador = document.getElementById("buscador");
    if (buscador) buscador.value = "";

    showToast("Sesión cerrada correctamente.");
    render();
}

function toggleMostrarPin() {
    const input = document.getElementById("passDocente");
    const btn   = document.querySelector(".pin-input-wrapper .btn-toggle-pin");
    if (input.type === "password") { input.type = "text";     btn.innerText = "🙈"; }
    else                           { input.type = "password"; btn.innerText = "👁️"; }
}

// =====================================================
// PARSEO DE FECHA (Google Apps Script)
// =====================================================
function parsearFechaGAS(strFecha) {
    if (!strFecha) return new Date();
    if (strFecha instanceof Date) return strFecha;
    if (typeof strFecha === 'number') return new Date(strFecha);
    const str   = String(strFecha).trim();
    const regex = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
    const match = str.match(regex);
    if (match) {
        return new Date(
            parseInt(match[3], 10),
            parseInt(match[2], 10) - 1,
            parseInt(match[1], 10),
            parseInt(match[4], 10),
            parseInt(match[5], 10),
            match[6] ? parseInt(match[6], 10) : 0
        );
    }
    const parsed = new Date(strFecha);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
}

// =====================================================
// SONIDO DE ALARMA
// =====================================================
function reproducirAlarmaOscilador() {
    try {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioCtx = sharedAudioCtx;
        if (audioCtx.state === 'suspended') audioCtx.resume();

        const playBeep = (delay, frequency, duration) => {
            const osc      = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            osc.type           = "sine";
            osc.frequency.value = frequency;
            gainNode.gain.setValueAtTime(0, audioCtx.currentTime + delay);
            gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + delay + 0.05);
            gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + delay + duration - 0.05);
            gainNode.gain.linearRampToValueAtTime(0, audioCtx.currentTime + delay + duration);
            osc.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            osc.start(audioCtx.currentTime + delay);
            osc.stop(audioCtx.currentTime + delay + duration);
        };

        playBeep(0.0,  1000, 0.25);
        playBeep(0.35, 1000, 0.25);
        playBeep(0.70, 800,  0.50);
    } catch (e) {
        console.error("Error al sintetizar alarma:", e);
    }
}

// =====================================================
// FILTROS ACTIVOS
// =====================================================
function getFiltrosActivos() {
    return {
        curso:       document.getElementById("fCurso").value,
        division:    document.getElementById("fDivision").value,
        turno:       document.getElementById("fTurno").value,
        especialidad: document.getElementById("fEspecialidad").value,
        busqueda:    document.getElementById("buscador").value.toLowerCase().trim()
    };
}

function alumnoCoincideFiltro(alumno, filtros) {
    if (filtros.curso       && alumno.curso       !== filtros.curso)       return false;
    if (filtros.division    && alumno.division    !== filtros.division)    return false;
    if (filtros.turno       && alumno.turno       !== filtros.turno)       return false;
    if (filtros.especialidad && alumno.especialidad !== filtros.especialidad) return false;
    if (filtros.busqueda) {
        const nombreMatch = String(alumno.nombre || "").toLowerCase().includes(filtros.busqueda);
        const dniMatch    = cleanDni(alumno.dni).includes(cleanDni(filtros.busqueda));
        if (!nombreMatch && !dniMatch) return false;
    }
    return true;
}

// =====================================================
// OBTENER REGISTRO DE SALIDA ACTIVO
// =====================================================
function obtenerRegistroSalida(alumno) {
    return salidas.find(s => {
        const rowDni    = s.dni || s.DNI || '';
        const rowRegreso = obtenerPropiedadSalida(s, ['regreso', 'retorno', 'fin']);
        const rowEstado  = obtenerPropiedadSalida(s, ['estado', 'status']);
        return (
            cleanDni(rowDni) === cleanDni(alumno.dni) &&
            (!rowRegreso || rowRegreso === "" || String(rowEstado).toUpperCase() === "AFUERA")
        );
    });
}

function esSalidaConCronometro(causa) {
    if (!causa) return false;
    return /ba[nñ]o/i.test(String(causa));
}

// =====================================================
// CONSTRUCCIÓN DE TARJETA HTML
// =====================================================
function construirTarjetaAlumnoHTML(a, regSalida) {
    const esAusente = String(a.estado || "").toUpperCase() === "AUSENTE";
    const esTarde   = /TARDE/i.test(String(a.estado || ""));
    const esRetiro  = String(a.estado || "").toUpperCase() === "RETIRO";

    let estadoClase = "in";
    if      (esAusente)  estadoClase = "ausente";
    else if (esRetiro)   estadoClase = "retiro";
    else if (regSalida)  estadoClase = "out";

    let textoEstado = "🟢 EN AULA";
    if (esAusente) {
        textoEstado = "❌ AUSENTE";
    } else if (esRetiro) {
        textoEstado = "👨‍👩‍👦 RETIRADO";
    } else if (regSalida) {
        const causaDestino = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "Salida";
        textoEstado = `🚪 AFUERA (${causaDestino})${esTarde ? ' — ⏰ LLEGÓ TARDE' : ''}`;
    } else if (esTarde) {
        textoEstado = "⏰ LLEGÓ TARDE";
    }

    let html = `<div>
        ${(esTarde || a.horaLlegadaTarde) ? `<div class="late-pill">⏰ LLEGÓ TARDE${a.horaLlegadaTarde ? ` — ${escapeHtml(a.horaLlegadaTarde)}` : ''}</div>` : ''}
        <span class="nombre">${escapeHtml(a.nombre)}</span>
        <div class="curso-info">Curso: ${escapeHtml(a.curso) || '-'} ${escapeHtml(a.division) || ''} | DNI: ${escapeHtml(a.dni)}</div>
    `;

    if (!esAusente && !esRetiro) {
        if (regSalida) {
            const causaDestino = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "Salida";
            const mostrarTimer = esSalidaConCronometro(causaDestino);
            html += `<div class="motivo-destacado">${escapeHtml(textoEstado)}</div>`;
            html += `<div class="causa-badge ${mostrarTimer ? 'timed' : 'not-timed'}">${mostrarTimer ? 'Cronómetro activo (60 seg)' : 'Salida sin cronómetro'}</div>`;
            if (mostrarTimer) {
                html += `<div class="timer-box" id="timer-${cleanDni(a.dni)}">🕒 Calculando...</div>`;
            } else {
                html += `<div class="timer-note">Registra el regreso normalmente.</div>`;
            }
        } else if (esTarde) {
            // late-pill ya mostrado arriba
        } else {
            html += `<div class="estado-aula">${escapeHtml(textoEstado)}</div>`;
        }
    }

    if (a.retiroPor) {
        html += `<div class="retiro-info">Retirado por: ${escapeHtml(a.retiroPor)}${a.horaRetiro ? ` — ${escapeHtml(a.horaRetiro)}` : ''}</div>`;
    }

    html += `
        <div class="card-actions" style="margin-top:12px; display:flex; justify-content:flex-end;">
            <button class="more-btn" data-action="openPopover" data-dni="${escapeHtml(a.dni)}"
                title="Más acciones" aria-label="Más acciones" aria-expanded="false">⋯</button>
        </div>
    </div>`;

    return { html, estadoClase };
}

// =====================================================
// RENDER PRINCIPAL
// =====================================================
function render() {
    actualizarCartasVisibles();
    actualizarContadores();
    actualizarResumen();
}

function actualizarCartasVisibles() {
    const grid = document.getElementById("grid");
    if (!grid) return;

    if (!usuarioActivo) {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--muted);">
            Por favor, inicia sesión para gestionar las salidas de los alumnos.
        </div>`;
        return;
    }

    const filtros         = getFiltrosActivos();
    const alumnosVisibles = alumnos.filter(a => alumnoCoincideFiltro(a, filtros));
    const visibleDnis     = new Set();
    let placeholder       = document.getElementById("grid-empty-msg");

    if (alumnosVisibles.length === 0) {
        if (!placeholder) {
            placeholder = document.createElement("div");
            placeholder.id            = "grid-empty-msg";
            placeholder.style.cssText = "grid-column:1/-1; text-align:center; padding:40px; color:var(--muted);";
            placeholder.innerHTML     = "No se encontraron alumnos con estos filtros o búsqueda.";
            grid.appendChild(placeholder);
        } else {
            placeholder.style.display = "";
        }
    } else if (placeholder) {
        placeholder.style.display = "none";
    }

    alumnosVisibles.forEach(a => {
        const dniLimpio = cleanDni(a.dni);
        visibleDnis.add(dniLimpio);
        const regSalida = obtenerRegistroSalida(a);
        let cardEl = document.getElementById(`alumno-${dniLimpio}`);

        if (!cardEl) {
            cardEl    = document.createElement("div");
            cardEl.id = `alumno-${dniLimpio}`;
            cardEl.dataset.dni    = dniLimpio;
            cardEl.dataset.nombre = a.nombre || '';
        }

        const { html, estadoClase } = construirTarjetaAlumnoHTML(a, regSalida);
        cardEl.className = `alumno ${estadoClase}`;
        cardEl.innerHTML = html;
        cardEl.style.display = "";
        grid.appendChild(cardEl);

        if (!cardEl.dataset.listenerAttached) {
            cardEl.addEventListener('click', async function (e) {
                const btn = e.target.closest('button');
                if (btn) {
                    const action = btn.dataset.action;
                    const dniBtn = btn.dataset.dni;
                    if (!action) return;
                    if      (action === 'registrarSalida')  registrarSalida(dniBtn);
                    else if (action === 'registrarRegreso') registrarRegreso(dniBtn);
                    else if (action === 'openPopover')      { e.stopPropagation(); openPopoverForButton(btn, dniBtn); }
                    else if (action === 'preceptor')        cambiarEstadoPreceptor(dniBtn, btn.dataset.accion);
                } else {
                    const esPreceptor = usuarioActivo && (String(usuarioActivo.rol || usuarioActivo.cargo || "").toUpperCase() === "PRECEPTOR");
                    if (!esPreceptor) return;
                    const dniCard    = this.dataset.dni;
                    const nombreCard = this.dataset.nombre || '';
                    const seleccion  = await mostrarModalEstado(nombreCard);
                    if (!seleccion) return;
                    if      (seleccion === 'SALIDA')  registrarSalida(dniCard);
                    else if (seleccion === 'REGRESO') registrarRegreso(dniCard);
                    else                              cambiarEstadoPreceptor(dniCard, seleccion);
                }
            });
            cardEl.dataset.listenerAttached = '1';
        }

        if (regSalida) {
            const causaSalida = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "";
            if (esSalidaConCronometro(causaSalida)) {
                iniciarCronometro(dniLimpio, detectarFechaSalida(regSalida));
            } else if (timers[dniLimpio]) {
                clearInterval(timers[dniLimpio]);
                delete timers[dniLimpio];
            }
        } else if (timers[dniLimpio]) {
            clearInterval(timers[dniLimpio]);
            delete timers[dniLimpio];
        }
    });

    grid.querySelectorAll(".alumno").forEach(card => {
        const cardDni = card.id.replace(/^alumno-/, "");
        if (!visibleDnis.has(cardDni)) card.style.display = "none";
    });
}

// =====================================================
// CONTADORES
// =====================================================
function actualizarContadores() {
    const filtros = getFiltrosActivos();
    let totalInscriptos = 0, totalAula = 0, totalAfuera = 0, totalAusentes = 0;

    alumnos.forEach(a => {
        if (!alumnoCoincideFiltro(a, filtros)) return;
        totalInscriptos++;
        const regSalida = obtenerRegistroSalida(a);
        if (a.estado === "AUSENTE" || a.estado === "RETIRO") totalAusentes++;
        else if (regSalida) totalAfuera++;
        else totalAula++;
    });

    document.getElementById("total-alumnos").textContent = totalInscriptos;
    document.getElementById("en-aula").textContent       = totalAula;
    document.getElementById("afuera").textContent        = totalAfuera;
    document.getElementById("ausentes").textContent      = totalAusentes;
}

function obtenerAlumnosVisibles() {
    return alumnos.filter(a => alumnoCoincideFiltro(a, getFiltrosActivos()));
}

// =====================================================
// RESUMEN
// =====================================================
function actualizarResumen() {
    const resumenContainer = document.getElementById("resumen-container");
    if (!resumenContainer) return;
    if (!usuarioActivo) { resumenContainer.style.display = "none"; return; }

    const filtros         = getFiltrosActivos();
    const alumnosVisibles = alumnos.filter(a => alumnoCoincideFiltro(a, filtros));

    const ausentes = alumnosVisibles
        .filter(a => String(a.estado || "").toUpperCase() === "AUSENTE")
        .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

    const tarde = alumnosVisibles
        .filter(a => /TARDE/i.test(String(a.estado || "")) && String(a.estado || "").toUpperCase() !== "AUSENTE")
        .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

    const afuera = alumnosVisibles
        .filter(a => String(a.estado || "").toUpperCase() !== "AUSENTE" && !!obtenerRegistroSalida(a))
        .map(a => {
            const reg = obtenerRegistroSalida(a);
            return Object.assign({}, a, {
                _causa:     obtenerPropiedadSalida(reg, ['causa', 'destino', 'motivo', 'lugar']) || '',
                _horaSalida: detectarFechaSalida(reg) || ''
            });
        })
        .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

    // Ausentes
    const boxAusentes   = document.getElementById("resumen-ausentes-box");
    const listaAusentes = document.getElementById("resumen-ausentes-lista");
    const countAusentes = document.getElementById("resumen-ausentes-count");
    if (ausentes.length > 0) {
        boxAusentes.style.display = "";
        countAusentes.textContent = ausentes.length;
        listaAusentes.innerHTML   = ausentes.map(a =>
            `<span class="resumen-chip resumen-chip-ausente">${escapeHtml(a.nombre)}${a.curso ? ` <em>${escapeHtml(a.curso)} ${escapeHtml(a.division || '')}</em>` : ''}</span>`
        ).join('');
        const tituloAusentes = boxAusentes.querySelector('.resumen-titulo');
        if (tituloAusentes) { tituloAusentes.style.cursor = 'pointer'; tituloAusentes.onclick = () => abrirPopupLista('ausente', ausentes); }
    } else { boxAusentes.style.display = "none"; }

    // Tarde
    const boxTarde   = document.getElementById("resumen-tarde-box");
    const listaTarde = document.getElementById("resumen-tarde-lista");
    const countTarde = document.getElementById("resumen-tarde-count");
    if (tarde.length > 0) {
        boxTarde.style.display = "";
        countTarde.textContent = tarde.length;
        listaTarde.innerHTML   = tarde.map(a =>
            `<span class="resumen-chip resumen-chip-tarde">${escapeHtml(a.nombre)}${a.horaLlegadaTarde ? ` <em>${escapeHtml(a.horaLlegadaTarde)}</em>` : ''}${a.curso ? ` <em>${escapeHtml(a.curso)} ${escapeHtml(a.division || '')}</em>` : ''}</span>`
        ).join('');
        const tituloTarde = boxTarde.querySelector('.resumen-titulo');
        if (tituloTarde) { tituloTarde.style.cursor = 'pointer'; tituloTarde.onclick = () => abrirPopupLista('tarde', tarde); }
    } else { boxTarde.style.display = "none"; }

    // Afuera
    const boxSalidas   = document.getElementById("resumen-salidas-box");
    const listaSalidas = document.getElementById("resumen-salidas-lista");
    const countSalidas = document.getElementById("resumen-salidas-count");
    if (afuera.length > 0 && boxSalidas) {
        boxSalidas.style.display = "";
        countSalidas.textContent = afuera.length;
        listaSalidas.innerHTML   = afuera.map(a =>
            `<span class="resumen-chip resumen-chip-salida">${escapeHtml(a.nombre)}${a._causa ? ` <em>${escapeHtml(a._causa)}</em>` : ''}${a.curso ? ` <em>${escapeHtml(a.curso)} ${escapeHtml(a.division || '')}</em>` : ''}</span>`
        ).join('');
        const tituloSalidas = boxSalidas.querySelector('.resumen-titulo');
        if (tituloSalidas) { tituloSalidas.style.cursor = 'pointer'; tituloSalidas.onclick = () => abrirPopupLista('salida', afuera); }
    } else if (boxSalidas) { boxSalidas.style.display = "none"; }

    resumenContainer.style.display = (ausentes.length > 0 || tarde.length > 0 || afuera.length > 0) ? "" : "none";
}

// =====================================================
// ACTUALIZAR TARJETA INDIVIDUAL
// =====================================================
function actualizarTarjetaAlumno(alumno) {
    const dniLimpio = cleanDni(alumno.dni);
    const cardEl    = document.getElementById(`alumno-${dniLimpio}`);
    const regSalida = obtenerRegistroSalida(alumno);
    const { html, estadoClase } = construirTarjetaAlumnoHTML(alumno, regSalida);

    if (cardEl) {
        cardEl.className = `alumno ${estadoClase}`;
        cardEl.innerHTML = html;
        if (regSalida) {
            const causaSalida = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "";
            if (esSalidaConCronometro(causaSalida)) {
                iniciarCronometro(dniLimpio, detectarFechaSalida(regSalida));
            } else if (timers[dniLimpio]) {
                clearInterval(timers[dniLimpio]);
                delete timers[dniLimpio];
            }
        }
        actualizarContadores();
    }
}

// =====================================================
// CRONÓMETRO — límite 60 SEGUNDOS
// =====================================================
function iniciarCronometro(dniLimpio, fechaSalidaStr) {
    if (timers[dniLimpio]) clearInterval(timers[dniLimpio]);

    if (!fechaSalidaStr) {
        const timerEl = document.getElementById(`timer-${dniLimpio}`);
        if (timerEl) timerEl.textContent = "🕒 Sin Hora";
        return;
    }

    const fechaInicio = parsearFechaGAS(fechaSalidaStr);

    function actualizarVisual() {
        const timerEl = document.getElementById(`timer-${dniLimpio}`);
        const cardEl  = document.getElementById(`alumno-${dniLimpio}`);
        if (!timerEl || !cardEl) {
            clearInterval(timers[dniLimpio]);
            delete timers[dniLimpio];
            return;
        }

        const transcurridoMs    = new Date() - fechaInicio;
        const totalSegundos     = Math.floor(transcurridoMs / 1000);
        const totalSegundosAbs  = Math.max(0, totalSegundos);
        const minutos           = Math.floor(totalSegundosAbs / 60);
        const segundos          = totalSegundosAbs % 60;
        const textoTiempo       = `${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;

        timerEl.textContent = `🕒 ${textoTiempo}`;

        // ⚠️ LÍMITE: 60 SEGUNDOS (1 minuto)
        if (totalSegundosAbs >= 60) {
            cardEl.classList.add("tiempo-agotado-bg");
            timerEl.classList.remove("tiempo-critico");
            timerEl.textContent = `🚨 EXCEDIDO: ${textoTiempo}`;

            const ahora = Date.now();
            if (ahora - ultimoAudioPlay > 12000) {
                ultimoAudioPlay = ahora;
                reproducirAlarmaOscilador();
                document.getElementById("alertSound").play().catch(() => {});
            }
        } else if (totalSegundosAbs >= 45) {
            // Aviso a partir de los 45 segundos
            cardEl.classList.remove("tiempo-agotado-bg");
            timerEl.classList.add("tiempo-critico");
        } else {
            cardEl.classList.remove("tiempo-agotado-bg");
            timerEl.classList.remove("tiempo-critico");
        }
    }

    actualizarVisual();
    timers[dniLimpio] = setInterval(actualizarVisual, 1000);
}

// =====================================================
// ENVÍO DE TRANSACCIONES POST
// =====================================================
async function enviarTransaccionPost(payload) {
    try {
        try { if (typeof CLIENT_SECRET === 'string' && CLIENT_SECRET && !payload.secret) payload.secret = CLIENT_SECRET; } catch (e) {}
        try { if (!payload.docente) payload.docente = (usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : 'ANONIMO'); } catch (e) {}

        const response = await fetch(URL, {
            method:   "POST",
            mode:     "cors",
            redirect: "follow",
            headers:  { "Content-Type": "text/plain;charset=utf-8" },
            body:     JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        try { return await response.json(); }
        catch (e) {
            const txt = await response.text();
            try   { return JSON.parse(txt); }
            catch { console.warn('Respuesta no-JSON:', txt); return { ok: true, raw: txt }; }
        }
    } catch (e) {
        console.warn('Network error, encolando petición:', e && e.message);
        try { payload.queued = true; } catch (err) {}
        enqueueRequest(payload);
        return { ok: true, queued: true };
    }
}

function enqueueRequest(payload) {
    pendingRequests.push({ payload, ts: Date.now() });
    showToast('Petición encolada por fallo de red. Se reintentará.', 'error');
    if (!queueTimer) startQueueProcessor();
}

function startQueueProcessor() {
    if (queueTimer) return;
    queueTimer = setInterval(async () => {
        if (queueProcessing || pendingRequests.length === 0) return;
        queueProcessing = true;
        const item = pendingRequests[0];
        try {
            const resp = await fetch(URL, {
                method:   "POST",
                mode:     "cors",
                redirect: "follow",
                headers:  { "Content-Type": "text/plain;charset=utf-8" },
                body:     JSON.stringify(item.payload)
            });
            if (resp.ok) {
                pendingRequests.shift();
                showToast('Petición en la cola enviada con éxito.');
                try { cargarDatos(true).catch(() => {}); } catch (e) {}
            }
        } catch (e) { /* se reintentará */ }
        finally {
            queueProcessing = false;
            if (pendingRequests.length === 0) {
                clearInterval(queueTimer);
                queueTimer = null;
                try { cargarDatos(true).catch(() => {}); } catch (e) {}
            }
        }
    }, 10000);
}

// =====================================================
// REGISTRAR SALIDA
// =====================================================
async function registrarSalida(dni) {
    const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
    if (!alumno) return;
    if (!usuarioActivo) { showToast('Debe iniciar sesión antes de registrar salidas.', 'error'); return; }

    let motivoSalida = obtenerCausaSalida();
    if (!motivoSalida) motivoSalida = "Baño";

    mostrarIndicadorActualizacion(true);
    try {
        const result = await enviarTransaccionPost({
            tipoAccion:   "movimiento",
            tipo:         "salida",
            dni:          cleanDni(alumno.dni),
            nombre:       alumno.nombre,
            curso:        alumno.curso,
            division:     alumno.division,
            turno:        alumno.turno,
            especialidad: alumno.especialidad,
            docente:      usuarioActivo.nombre || usuarioActivo.usuario,
            causa:        motivoSalida
        });

        if (!result.ok) throw new Error(result.error);

        salidas.push({ dni: alumno.dni, salida: new Date().toISOString(), regreso: "", estado: "AFUERA", causa: motivoSalida });
        ultimoHashDatos = null;

        showToast(`Salida registrada correctamente para ${alumno.nombre}.`);
        actualizarTarjetaAlumno(alumno);
        actualizarContadores();
        mostrarIndicadorActualizacion(false);
        if (!result.queued) cargarDatos(true).catch(() => {});
    } catch (error) {
        console.error(error);
        showToast("Error al registrar salida: " + error.message, "error");
        mostrarIndicadorActualizacion(false);
    }
}

// =====================================================
// REGISTRAR REGRESO
// =====================================================
async function registrarRegreso(dni) {
    const alumno   = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
    if (!alumno) return;
    const dniLimpio = cleanDni(dni);

    if (timers[dniLimpio]) { clearInterval(timers[dniLimpio]); delete timers[dniLimpio]; }

    mostrarIndicadorActualizacion(true);
    try {
        const result = await enviarTransaccionPost({
            tipoAccion: "movimiento",
            tipo:       "regreso",
            dni:        dniLimpio,
            nombre:     alumno.nombre,
            docente:    usuarioActivo.nombre || usuarioActivo.usuario
        });

        if (!result.ok) throw new Error(result.error);

        const registro = salidas.slice().reverse().find(s => {
            const rowDni    = s.dni || s.DNI || '';
            const rowRegreso = obtenerPropiedadSalida(s, ['regreso', 'retorno', 'fin']);
            const rowEstado  = obtenerPropiedadSalida(s, ['estado', 'status']);
            return (
                cleanDni(rowDni) === dniLimpio &&
                (!rowRegreso || rowRegreso === "" || String(rowEstado).toUpperCase() === "AFUERA")
            );
        });
        if (registro) { registro.regreso = new Date().toISOString(); registro.estado = "EN AULA"; }
        ultimoHashDatos = null;

        showToast(`Regreso de ${alumno.nombre} registrado con éxito.`);
        actualizarTarjetaAlumno(alumno);
        actualizarContadores();
        mostrarIndicadorActualizacion(false);
        if (!result.queued) cargarDatos(true).catch(() => {});
    } catch (error) {
        console.error(error);
        showToast("Error al registrar regreso: " + error.message, "error");
        mostrarIndicadorActualizacion(false);
    }
}

// =====================================================
// MARCAR RECREO / AULA PARA TODOS
// =====================================================
async function marcarRecreoParaTodos() {
    const confirmar = await mostrarConfirmacion("Recreo para todos", "¿Registrar recreo para todos los alumnos visibles?");
    if (!confirmar) return;

    const alumnosVisibles = obtenerAlumnosVisibles().filter(a => !obtenerRegistroSalida(a) && a.estado !== "AUSENTE" && a.estado !== "RETIRO");
    if (!alumnosVisibles.length) { showToast("No hay alumnos en aula para enviar a recreo.", "error"); return; }

    mostrarIndicadorActualizacion(true);
    let ok = 0, fail = 0;

    for (const alumno of alumnosVisibles) {
        try {
            const result = await enviarTransaccionPost({
                tipoAccion: "movimiento", tipo: "salida",
                dni: cleanDni(alumno.dni), nombre: alumno.nombre,
                curso: alumno.curso, division: alumno.division,
                turno: alumno.turno, especialidad: alumno.especialidad,
                docente: usuarioActivo.nombre || usuarioActivo.usuario,
                causa: "Recreo"
            });
            if (!result.ok) throw new Error(result.error || "Error");
            salidas.push({ dni: alumno.dni, salida: new Date().toISOString(), regreso: "", estado: "AFUERA", causa: "Recreo" });
            ok++;
        } catch { fail++; }
    }

    ultimoHashDatos = null;
    render();
    mostrarIndicadorActualizacion(false);
    if (ok   > 0) showToast(`Recreo registrado para ${ok} alumno${ok === 1 ? '' : 's'}.`);
    if (fail > 0) showToast(`${fail} movimiento${fail === 1 ? '' : 's'} fallaron.`, "error");
}

async function marcarAulaParaTodos() {
    const confirmar = await mostrarConfirmacion("Aula para todos", "¿Registrar regreso a aula para todos los alumnos fuera?");
    if (!confirmar) return;

    const alumnosVisibles = obtenerAlumnosVisibles().filter(a => obtenerRegistroSalida(a) && a.estado !== "AUSENTE" && a.estado !== "RETIRO");
    if (!alumnosVisibles.length) { showToast("No hay alumnos fuera para traer de regreso.", "error"); return; }

    mostrarIndicadorActualizacion(true);
    let ok = 0, fail = 0;

    for (const alumno of alumnosVisibles) {
        try {
            const result = await enviarTransaccionPost({
                tipoAccion: "movimiento", tipo: "regreso",
                dni: cleanDni(alumno.dni), nombre: alumno.nombre,
                docente: usuarioActivo.nombre || usuarioActivo.usuario
            });
            if (!result.ok) throw new Error(result.error || "Error");
            const reg = salidas.slice().reverse().find(s => {
                const rowDni    = s.dni || s.DNI || '';
                const rowRegreso = obtenerPropiedadSalida(s, ['regreso', 'retorno', 'fin']);
                const rowEstado  = obtenerPropiedadSalida(s, ['estado', 'status']);
                return cleanDni(rowDni) === cleanDni(alumno.dni) && (!rowRegreso || rowRegreso === "" || String(rowEstado).toUpperCase() === "AFUERA");
            });
            if (reg) { reg.regreso = new Date().toISOString(); reg.estado = "EN AULA"; }
            ok++;
        } catch { fail++; }
    }

    ultimoHashDatos = null;
    render();
    mostrarIndicadorActualizacion(false);
    if (ok   > 0) showToast(`Aula registrada para ${ok} alumno${ok === 1 ? '' : 's'}.`);
    if (fail > 0) showToast(`${fail} movimiento${fail === 1 ? '' : 's'} fallaron.`, "error");
}

// =====================================================
// CAMBIAR ESTADO PRECEPTOR
// =====================================================
async function cambiarEstadoPreceptor(dni, accion) {
    const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
    if (!alumno) return;

    const confirmar = await mostrarConfirmacion("Actualizar Asistencia", `¿Estás seguro de registrar a ${alumno.nombre} como "${accion}"?`);
    if (!confirmar) return;

    mostrarIndicadorActualizacion(true);
    try {
        const ahora       = new Date();
        const horaFormato = ahora.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const payload     = {
            tipoAccion: "preceptor",
            accion,
            dni:     cleanDni(alumno.dni),
            nombre:  alumno.nombre,
            docente: usuarioActivo.nombre || usuarioActivo.usuario
        };

        if (accion === "RETIRO PADRE/TUTOR") {
            const quienRetira = await mostrarModalTutor(alumno.nombre);
            if (quienRetira === null) { mostrarIndicadorActualizacion(false); return; }
            payload.quienRetira = quienRetira;
            payload.horaRetiro  = horaFormato;
        }
        if (accion === "LLEGADA TARDE") payload.horaLlegadaTarde = horaFormato;

        const result = await enviarTransaccionPost(payload);
        if (!result.ok) throw new Error(result.error);

        if      (accion === "AUSENTE")         { alumno.estado = "AUSENTE"; }
        else if (accion === "LLEGADA TARDE")   { alumno.estado = ""; alumno.horaLlegadaTarde = horaFormato; }
        else if (accion === "RETIRO PADRE/TUTOR") { alumno.estado = "RETIRO"; alumno.retiroPor = payload.quienRetira; alumno.horaRetiro = payload.horaRetiro; }
        else if (accion === "PRESENTE")        { alumno.estado = ""; }
        ultimoHashDatos = null;

        showToast(`Estado de ${alumno.nombre} actualizado a ${accion}.`);
        historial.push({
            fechahora:       new Date().toLocaleString(),
            alumno:          alumno.nombre,
            accion,
            usuario:         usuarioActivo.nombre || usuarioActivo.usuario,
            detalle:         accion === 'RETIRO PADRE/TUTOR' ? alumno.retiroPor : (accion === 'LLEGADA TARDE' ? alumno.horaLlegadaTarde : ''),
            tipoAccion:      payload.tipoAccion,
            tipo:            '',
            dni:             cleanDni(alumno.dni),
            docente:         payload.docente,
            estado:          alumno.estado || '',
            horaLlegadaTarde: payload.horaLlegadaTarde || alumno.horaLlegadaTarde || '',
            quienRetira:     payload.quienRetira || alumno.retiroPor || '',
            horaRetiro:      payload.horaRetiro  || alumno.horaRetiro || '',
            queued:          !!(result && result.queued)
        });

        actualizarTarjetaAlumno(alumno);
        renderHistorial();
        actualizarContadores();
        mostrarIndicadorActualizacion(false);
        if (!result.queued) cargarDatos(true).catch(() => {});
    } catch (error) {
        console.error(error);
        showToast("Error al actualizar estado: " + error.message, "error");
        mostrarIndicadorActualizacion(false);
    }
}

// =====================================================
// HISTORIAL
// =====================================================
function renderHistorial() {
    const container = document.getElementById("historial");
    if (!container) return;
    container.innerHTML = "";

    if (historial.length === 0) {
        container.innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">No hay movimientos registrados hoy.</div>`;
        return;
    }

    const listadoAMostrar = [...historial].reverse().slice(0, 50);
    listadoAMostrar.forEach(h => {
        const item     = document.createElement("div");
        item.className = "historial-item";

        const fechaFormat   = escapeHtml(h.fechahora || h.fecha || "00/00/0000 00:00");
        const alumnoStr     = escapeHtml(String(h.alumno || h.nombre || "Alumno").toUpperCase());
        const accionStr     = escapeHtml(h.accion || "Cambio");
        const usuarioStr    = escapeHtml(h.usuario || h.docente || "Preceptor");
        const dniStr        = escapeHtml(h.dni || '');
        const docenteHist   = escapeHtml(h.docente || '');
        const estadoHist    = escapeHtml(h.estado || '');
        const quienRetiraHist = escapeHtml(h.quienRetira || h.quienretira || '');
        const queuedHist    = (h.queued === true || h.queued === '1' || h.queued === 1) ? 'Sí' : 'No';
        const horaTardeDisplay  = formatDateField(h.horaLlegadaTarde || '');
        const horaRetiroDisplay = formatDateField(h.horaRetiro || '');

        const linea4Parts = [];
        if (estadoHist)        linea4Parts.push(`Estado: ${estadoHist}`);
        if (quienRetiraHist)   linea4Parts.push(`QuienRetira: ${quienRetiraHist}`);
        if (horaRetiroDisplay) linea4Parts.push(`HoraRetiro: ${horaRetiroDisplay}`);
        linea4Parts.push(`queued: ${queuedHist}`);

        item.innerHTML = `
            <div>
                <div style="font-size:14px">${alumnoStr} <span style="color:var(--accent)">[${escapeHtml('CAMBIO ESTADO: ' + accionStr)}]</span></div>
                <div style="font-size:12px; color:var(--muted); margin-top:6px">Usuario: ${usuarioStr}</div>
                <div style="font-size:12px; color:var(--muted)">${[dniStr ? `DNI: ${dniStr}` : null, docenteHist ? `Docente: ${docenteHist}` : null].filter(Boolean).join(' · ')}</div>
                <div style="font-size:12px; color:var(--muted)">${linea4Parts.join(' · ')}</div>
            </div>
            <span style="font-size:12px; font-weight:700; color:var(--muted)">${fechaFormat}</span>
        `;
        container.appendChild(item);
    });
}

async function limpiarHistorialView() {
    const confirmar = await mostrarConfirmacion("Limpiar Pantalla", "¿Deseas ocultar temporalmente la vista de movimientos?");
    if (confirmar) {
        document.getElementById("historial").innerHTML = `<div style="text-align:center; padding:20px; color:var(--muted); font-size:13px;">Vista limpia. Recarga los datos para volver a visualizarlos.</div>`;
    }
}

function exportHistorialPDF() {
    const printWindow = window.open("", "_blank");
    let filas = "";

    historial.forEach(h => {
        const fecha       = escapeHtml(formatDateField(h.fechahora || h.fecha || '')) || '-';
        const alumno      = escapeHtml(h.alumno || h.nombre || '-');
        const accion      = escapeHtml(h.accion || '-');
        const operador    = escapeHtml(h.usuario || h.docente || '-');
        const tipoAccion  = escapeHtml(h.tipoAccion || h.tipoaccion || '');
        const tipo        = escapeHtml(h.tipo || '');
        const dni         = escapeHtml(h.dni || '');
        const estado      = escapeHtml(h.estado || '');
        const horaLlegada = escapeHtml(formatDateField(h.horaLlegadaTarde || ''));
        const quienRetira = escapeHtml(h.quienRetira || h.quienretira || '');
        const horaRetiro  = escapeHtml(formatDateField(h.horaRetiro || ''));
        const queued      = (h.queued === true || h.queued === '1' || h.queued === 1) ? 'Sí' : 'No';

        filas += `<tr>
            <td>${fecha}</td><td><strong>${alumno}</strong></td><td>${accion}</td>
            <td>${operador}</td><td>${tipoAccion}</td><td>${tipo}</td>
            <td>${dni}</td><td>${estado}</td><td>${horaLlegada}</td>
            <td>${quienRetira}</td><td>${horaRetiro}</td><td>${queued}</td>
        </tr>`;
    });

    printWindow.document.write(`
        <html><head>
        <title>Reporte de Salidas - IPEM 146</title>
        <style>
            body { font-family: Arial, sans-serif; padding: 30px; color: #1e293b; }
            h1   { color: #0284c7; font-size: 24px; margin-bottom: 5px; }
            p    { font-size: 14px; color: #64748b; margin: 0 0 30px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th { background: #f1f5f9; text-align: left; padding: 10px; border-bottom: 2px solid #cbd5e1; }
            td { padding: 8px 10px; border-bottom: 1px solid #ddd; }
        </style></head><body>
        <h1>📄 REPORTE DE MOVIMIENTOS</h1>
        <p>IPEM 146 "CENTENARIO" — ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
        <table><thead><tr>
            <th>Fecha/Hora</th><th>Alumno</th><th>Acción</th><th>Operador</th>
            <th>tipoAccion</th><th>tipo</th><th>DNI</th><th>Estado</th>
            <th>HoraLlegadaTarde</th><th>QuienRetira</th><th>HoraRetiro</th><th>queued</th>
        </tr></thead><tbody>
            ${filas || '<tr><td colspan="12" style="text-align:center; padding:20px;">Sin registros</td></tr>'}
        </tbody></table>
        <script>window.onload = function(){ window.print(); }<\/script>
        </body></html>
    `);
    printWindow.document.close();
}

// =====================================================
// TEMA
// =====================================================
function toggleTheme() {
    const isLight = document.body.classList.toggle("light-mode");
    const btn     = document.getElementById("themeToggle");
    if (isLight) { btn.innerText = "☀️"; localStorage.setItem("theme", "light"); }
    else         { btn.innerText = "🌙"; localStorage.setItem("theme", "dark"); }
}

// =====================================================
// POPUP LISTA AUSENTES / TARDE / AFUERA
// =====================================================
function abrirPopupLista(tipo, lista) {
    let existente = document.getElementById('popup-lista-modal');
    if (existente) existente.remove();

    const esAusente    = tipo === 'ausente';
    const esSalida     = tipo === 'salida';
    const titulo       = esAusente ? '❌ AUSENTES' : esSalida ? '🚪 AFUERA' : '⏰ LLEGADA TARDE';
    const colorTitulo  = esAusente ? 'var(--red)' : esSalida ? 'var(--accent)' : 'var(--warning)';

    const filas = lista.map((a, i) => {
        let infoExtra = '';
        if (!esAusente && !esSalida && a.horaLlegadaTarde) {
            infoExtra = `<span style="font-size:11px; color:var(--muted); margin-left:6px;">${escapeHtml(a.horaLlegadaTarde)}</span>`;
        }
        if (esSalida) {
            if (a._causa)     infoExtra += `<span style="font-size:11px; background:var(--accent); color:#fff; border-radius:4px; padding:1px 6px; margin-left:6px;">${escapeHtml(a._causa)}</span>`;
            if (a._horaSalida) infoExtra += `<span style="font-size:11px; color:var(--muted); margin-left:4px;">${escapeHtml(String(a._horaSalida))}</span>`;
        }
        const cursoInfo = a.curso ? `<span style="font-size:11px; color:var(--muted); margin-left:6px;">${escapeHtml(a.curso)} ${escapeHtml(a.division || '')}</span>` : '';
        return `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; padding:8px 0; border-bottom:1px solid var(--border);">
            <span style="font-size:13px; font-weight:700; color:var(--muted); min-width:22px;">${i + 1}.</span>
            <span style="flex:1; font-size:14px; font-weight:600; min-width:120px;">${escapeHtml(a.nombre)}</span>
            ${cursoInfo}${infoExtra}
        </div>`;
    }).join('');

    const modal = document.createElement('div');
    modal.id              = 'popup-lista-modal';
    modal.className       = 'custom-modal';
    modal.style.cssText   = 'display:flex; z-index:9999;';
    modal.innerHTML = `
        <div class="custom-modal-content" style="max-width:480px; width:92%; max-height:80vh; display:flex; flex-direction:column;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px;">
                <h3 style="margin:0; color:${colorTitulo}; font-size:16px;">
                    ${titulo} <span style="background:${colorTitulo}; color:#fff; border-radius:999px; padding:1px 9px; font-size:13px; margin-left:6px;">${lista.length}</span>
                </h3>
                <button onclick="cerrarPopupLista()" style="background:none; border:none; cursor:pointer; font-size:20px; color:var(--muted);" title="Cerrar">✕</button>
            </div>
            <div style="overflow-y:auto; flex:1; padding-right:4px;">
                ${filas || '<p style="text-align:center; color:var(--muted); padding:20px 0;">Sin registros.</p>'}
            </div>
            <div style="margin-top:14px; text-align:right;">
                <button class="btn-mini azul" onclick="cerrarPopupLista()">Cerrar</button>
            </div>
        </div>`;

    modal.addEventListener('click', e => { if (e.target === modal) cerrarPopupLista(); });
    document.body.appendChild(modal);
    pauseAutoRefresh();
}

function cerrarPopupLista() {
    const modal = document.getElementById('popup-lista-modal');
    if (modal) modal.remove();
    resumeAutoRefresh();
}