const URL = "https://script.google.com/macros/s/AKfycbyQ8IvEWgpl5Vj--Zal4-144FBQEtB3Mkpm-zcAISK33iW28peCTELMkqwlo6qJ1fnc/exec";
        // Si querés validar las peticiones desde el servidor, pon aquí el mismo secret que en GAS.
        // Dejar como 'REPLACE_WITH_SECRET' para no enviar secret.
        const CLIENT_SECRET = 'REPLACE_WITH_SECRET';

        let alumnos = [];
        let docentes = [];
        let salidas = [];
        let historial = [];

        let usuarioActivo = null;
        let timers = {};
        let ultimoAudioPlay = 0; // Throttle para el sonido de alarma
        let autoRefreshTimer = null;
        let isRefreshing = false;
        let ultimoHashDatos = null;
        let ultimoActualizado = null;
        let sharedAudioCtx = null; // Reusar AudioContext
        let pendingRequests = [];
        let queueTimer = null;
        let queueProcessing = false;

        /* =========================================================
           INIT
        ========================================================= */
        window.addEventListener("load", () => {
            iniciarAutoActualizacion();
            cargarDatos();
            toggleCausaAdicional();
            if (localStorage.getItem("theme") === "light") {
                document.body.classList.add("light-mode");
                document.getElementById("themeToggle").innerText = "☀️";
            }
        });

        function iniciarAutoActualizacion() {
            if (autoRefreshTimer) {
                clearInterval(autoRefreshTimer);
            }
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

        function toggleCausaAdicional() {
            const causaSelect = document.getElementById("causa");
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
            const causaSelect = document.getElementById("causa");
            const causaAdicional = document.getElementById("causa-adicional");
            if (!causaSelect) return "Baño";

            const causa = causaSelect.value || "Baño";
            const detalle = causaAdicional ? causaAdicional.value.trim() : "";

            if (causa === "Otro") {
                return detalle ? `Otro: ${detalle}` : "Otro";
            }

            return detalle ? `${causa} (${detalle})` : causa;
        }

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

        function manualRefresh() {
            if (isRefreshing) return;
            const button = document.getElementById("manualRefreshBtn");
            if (button) button.disabled = true;
            mostrarIndicadorActualizacion(true);
            cargarDatos(true, true).finally(() => {
                if (button) button.disabled = false;
            });
        }

        function actualizarUltimaActualizacion(fecha = new Date()) {
            ultimoActualizado = fecha;
            const status = document.getElementById("last-updated");
            if (!status) return;
            status.textContent = `Última actualización: ${fecha.toLocaleDateString()} ${fecha.toLocaleTimeString()}`;
        }

        function stableStringify(value) {
            if (value === null || typeof value !== "object") {
                return JSON.stringify(value);
            }
            if (Array.isArray(value)) {
                return '[' + value.map(stableStringify).join(',') + ']';
            }
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
            // si ya contiene '/', asumir formato dd/MM/yyyy o similar y devolver tal cual
            if (typeof val === 'string' && val.indexOf('/') !== -1) return val;
            // si es número (timestamp) convertir
            if (typeof val === 'number') return new Date(val).toLocaleString();
            // intentar parsear ISO o string reconocible
            try {
                const d = new Date(val);
                if (!isNaN(d.getTime())) return d.toLocaleString();
            } catch (e) { /* ignore */ }
            return String(val);
        }

        // Formatea cualquier valor de hora/fecha en formato legible HH:MM o dd/MM HH:MM
        function formatHora(val) {
            if (!val && val !== 0) return '';
            const s = String(val).trim();
            if (!s) return '';

            // Si parece solo hora HH:MM o HH:MM:SS -> devolver solo HH:MM
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.substring(0, 5);

            let d = null;
            if (typeof val === 'number') {
                d = new Date(val);
            } else {
                // dd/MM/yyyy -> yyyy-MM-dd para parseo seguro
                const norm = s.replace(/(\d{2})\/(\d{2})\/(\d{4})/, '$3-$2-$1');
                try { d = new Date(norm); } catch(e) {}
                if (!d || isNaN(d.getTime())) {
                    try { d = new Date(s); } catch(e) {}
                }
            }

            if (d && !isNaN(d.getTime())) {
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const mo = String(d.getMonth() + 1).padStart(2, '0');
                // Si la hora es medianoche exacta, probablemente es solo fecha → mostrar dd/MM
                if (hh === '00' && mm === '00') return `${dd}/${mo}`;
                return `${dd}/${mo} ${hh}:${mm}`;
            }

            return s;
        }

        /* =========================================================
           DIALOGOS Y MODALES PERSONALIZADOS
        ========================================================= */
        function mostrarConfirmacion(titulo, mensaje) {
            return new Promise((resolve) => {
                const modal = document.getElementById("custom-confirm-modal");
                const titleEl = document.getElementById("confirm-modal-title");
                const messageEl = document.getElementById("confirm-modal-message");
                const btnYes = document.getElementById("confirm-modal-btn-yes");
                const btnNo = document.getElementById("confirm-modal-btn-no");

                titleEl.textContent = titulo;
                messageEl.textContent = mensaje;
                modal.style.display = "flex";

                function cleanup() {
                    modal.style.display = "none";
                    btnYes.onclick = null;
                    btnNo.onclick = null;
                }

                btnYes.onclick = () => {
                    cleanup();
                    resolve(true);
                };
                btnNo.onclick = () => {
                    cleanup();
                    resolve(false);
                };
            });
        }

        // Modal para pedir nombre del tutor/padre (reemplaza prompt)
        function mostrarModalTutor(nombreAlumno) {
            return new Promise((resolve) => {
                const modal = document.getElementById('tutor-modal');
                const input = document.getElementById('tutor-name-input');
                const error = document.getElementById('tutor-name-error');
                const btnOk = document.getElementById('tutor-modal-btn-ok');
                const btnCancel = document.getElementById('tutor-modal-btn-cancel');
                const title = document.getElementById('tutor-modal-title');

                if (!modal || !input || !btnOk || !btnCancel) {
                    resolve(null);
                    return;
                }

                title.textContent = `Retiro de ${nombreAlumno}`;
                input.value = '';
                error.style.display = 'none';
                // pause auto-refresh while modal is open
                pauseAutoRefresh();
                modal.style.display = 'flex';
                setTimeout(() => input.focus(), 50);

                function cleanup() {
                    modal.style.display = 'none';
                    btnOk.onclick = null;
                    btnCancel.onclick = null;
                }

                btnCancel.onclick = () => {
                    cleanup();
                    resolve(null);
                };

                btnOk.onclick = () => {
                    const val = input.value.trim();
                    if (!val) {
                        error.style.display = 'block';
                        input.focus();
                        return;
                    }
                    cleanup();
                    resolve(val);
                };
                function cleanup() {
                    modal.style.display = 'none';
                    btnOk.onclick = null;
                    btnCancel.onclick = null;
                    // resume auto-refresh after modal closes
                    resumeAutoRefresh();
                }
            });
        }

        // Modal para seleccionar estado (AUSENTE / LLEGADA TARDE / RETIRO / PRESENTE)
        function mostrarModalEstado(nombreAlumno) {
            return new Promise((resolve) => {
                const modal = document.getElementById('estado-modal');
                const title = document.getElementById('estado-modal-title');
                const btnAusente = document.getElementById('estado-btn-ausente');
                const btnTarde = document.getElementById('estado-btn-tarde');
                const btnRetiro = document.getElementById('estado-btn-retiro');
                const btnPresente = document.getElementById('estado-btn-presente');
                const btnCancel = document.getElementById('estado-modal-btn-cancel');

                if (!modal) { resolve(null); return; }

                title.textContent = `Cambiar estado — ${nombreAlumno}`;
                // Pause auto-refresh while modal open
                pauseAutoRefresh();
                modal.style.display = 'flex';

                function cleanup() {
                    modal.style.display = 'none';
                    btnAusente.onclick = null;
                    btnTarde.onclick = null;
                    btnRetiro.onclick = null;
                    btnPresente.onclick = null;
                    btnCancel.onclick = null;
                    // resume auto-refresh
                    resumeAutoRefresh();
                }

                btnCancel.onclick = () => { cleanup(); resolve(null); };
                btnAusente.onclick = () => { cleanup(); resolve('AUSENTE'); };
                btnTarde.onclick = () => { cleanup(); resolve('LLEGADA TARDE'); };
                btnRetiro.onclick = () => { cleanup(); resolve('RETIRO PADRE/TUTOR'); };
                btnPresente.onclick = () => { cleanup(); resolve('PRESENTE'); };
                const btnSalida = document.getElementById('estado-btn-salida');
                const btnRegreso = document.getElementById('estado-btn-regreso');
                if (btnSalida) btnSalida.onclick = () => { cleanup(); resolve('SALIDA'); };
                if (btnRegreso) btnRegreso.onclick = () => { cleanup(); resolve('REGRESO'); };
            });
        }

        // POPOVER: show contextual menu anchored to a button
        let popoverVisible = false;
        let popoverOutsideHandler = null;
        let popoverAnchorBtn = null;
        let popoverKeyHandler = null;

        function openPopoverForButton(btn, dni) {
            const pop = document.getElementById('popover-menu');
            if (!pop) return;
            const rect = btn.getBoundingClientRect();
            // position popover below the button, adjust if near edges
            const margin = 8;
            pop.style.display = 'block';
            // pause auto-refresh while popover open
            pauseAutoRefresh();
            pop.classList.remove('visible');

            // small delay to allow size measurement
            requestAnimationFrame(() => {
                const popRect = pop.getBoundingClientRect();
                let left = rect.left + (rect.width/2) - (popRect.width/2);
                let top = rect.bottom + margin;
                if (left < 8) left = 8;
                if (left + popRect.width > window.innerWidth - 8) left = window.innerWidth - popRect.width - 8;
                if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - margin;
                pop.style.left = `${left}px`;
                pop.style.top = `${top}px`;
                pop.dataset.dni = dni || '';
                // set dni on each popover item
                pop.querySelectorAll('.popover-item').forEach(item => {
                    item.dataset.dni = dni || '';
                });
                pop.classList.add('visible');
                popoverVisible = true;
                popoverAnchorBtn = btn;
                try { btn.setAttribute('aria-expanded', 'true'); } catch(e){}

                // focus first item for accessibility
                const items = Array.from(pop.querySelectorAll('.popover-item'));
                if (items.length) {
                    items.forEach(it => it.setAttribute('role', 'menuitem'));
                    // programmatic focus
                    items[0].tabIndex = -1;
                    items[0].focus();
                }

                // attach outside click handler
                popoverOutsideHandler = (ev) => {
                    if (!pop.contains(ev.target) && !btn.contains(ev.target)) hidePopover();
                };
                document.addEventListener('click', popoverOutsideHandler);
                document.addEventListener('keydown', popoverEscHandler);

                // keyboard navigation inside popover (Arrow keys + Enter)
                popoverKeyHandler = (ev) => {
                    if (!popoverVisible) return;
                    const items = Array.from(pop.querySelectorAll('.popover-item'));
                    if (!items.length) return;
                    const idx = items.indexOf(document.activeElement);
                    if (ev.key === 'ArrowDown') {
                        ev.preventDefault();
                        const next = items[(idx + 1) % items.length]; next.focus();
                    } else if (ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        const prev = items[(idx - 1 + items.length) % items.length]; prev.focus();
                    } else if (ev.key === 'Home') {
                        ev.preventDefault(); items[0].focus();
                    } else if (ev.key === 'End') {
                        ev.preventDefault(); items[items.length - 1].focus();
                    } else if (ev.key === 'Enter' || ev.key === ' ') {
                        // let click handler process it
                        ev.preventDefault(); document.activeElement.click();
                    }
                };
                document.addEventListener('keydown', popoverKeyHandler);
            });
        }

        // Pause auto-refresh while modals or popover are open
        function pauseAutoRefresh() {
            detenerAutoActualizacion();
        }
        function resumeAutoRefresh() {
            iniciarAutoActualizacion();
        }

        function popoverEscHandler(e) {
            if (e.key === 'Escape') hidePopover();
        }

        function hidePopover() {
            const pop = document.getElementById('popover-menu');
            if (!pop) return;
            pop.classList.remove('visible');
            pop.style.display = 'none';
            pop.dataset.dni = '';
            pop.querySelectorAll('.popover-item').forEach(item => delete item.dataset.dni);
            popoverVisible = false;
            if (popoverOutsideHandler) {
                document.removeEventListener('click', popoverOutsideHandler);
                popoverOutsideHandler = null;
            }
            document.removeEventListener('keydown', popoverEscHandler);
            if (popoverKeyHandler) {
                document.removeEventListener('keydown', popoverKeyHandler);
                popoverKeyHandler = null;
            }
            if (popoverAnchorBtn) {
                try { popoverAnchorBtn.removeAttribute('aria-expanded'); } catch(e){}
                try { popoverAnchorBtn.focus(); } catch(e){}
                popoverAnchorBtn = null;
            }
            // resume auto-refresh when popover closes
            resumeAutoRefresh();
        }

        // Handle clicks on popover items (delegate)
        document.addEventListener('click', function(e) {
            const pop = document.getElementById('popover-menu');
            if (!pop) return;
            const item = e.target.closest('.popover-item');
            if (!item || !pop.contains(item)) return;
            const action = item.dataset.action;
            const dni = item.dataset.dni;
            const accion = item.dataset.accion;
            hidePopover();
            if (action === 'registrarSalida') {
                registrarSalida(dni);
            } else if (action === 'registrarRegreso') {
                registrarRegreso(dni);
            } else if (action === 'limpiarHoraTarde') {
                limpiarHoraLlegada(dni);
            } else if (action === 'preceptor') {
                cambiarEstadoPreceptor(dni, accion);
            }
        });

        async function limpiarHoraLlegada(dni) {
            const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
            if (!alumno) return;
            const confirmar = await mostrarConfirmacion('Limpiar hora', `¿Borrar la hora de llegada tarde de ${alumno.nombre}?`);
            if (!confirmar) return;
            // borrar localmente
            alumno.horaLlegadaTarde = '';
            // enviar al servidor para sincronizar
            const payload = {
                tipoAccion: 'limpiarHoraLlegada',
                dni: cleanDni(alumno.dni),
                nombre: alumno.nombre,
                docente: usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : ''
            };
            const result = await enviarTransaccionPost(payload);
            if (result && result.queued) {
                showToast('Petición encolada: la hora se limpiará cuando haya conexión.');
            } else {
                showToast('Hora de llegada tardea borrada.');
            }
            historial.push({
                fechahora: new Date().toLocaleString(),
                alumno: alumno.nombre,
                accion: 'LIMPIAR HORA TARDE',
                usuario: usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : 'Sistema',
                detalle: '',
                tipoAccion: 'preceptor',
                tipo: '',
                dni: cleanDni(alumno.dni),
                docente: usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : '',
                estado: alumno.estado || '',
                horaLlegadaTarde: alumno.horaLlegadaTarde || '',
                quienRetira: alumno.retiroPor || '',
                horaRetiro: alumno.horaRetiro || '',
                queued: false
            });
            actualizarTarjetaAlumno(alumno);
            renderHistorial();
            actualizarContadores();
        }

        // SVG icon helpers
        function svgDoor() {
            return `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3 21V3h12v18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M21 7v14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M18 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" fill="currentColor"/>
            </svg>`;
        }
        function svgReturn() {
            return `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M21 15v4a2 2 0 0 1-2 2H7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M3 13l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }
        function svgCross() {
            return `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }
        function svgClock() {
            return `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/>
                <path d="M12 7v6l4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }
        function svgFamily() {
            return `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M16 11a3 3 0 1 0-6 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M6 21v-2a4 4 0 0 1 4-4h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M18 21v-2a2 2 0 0 0-2-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }
        function svgCheck() {
            return `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
        }

        function showToast(message, type = "success") {
            const container = document.getElementById("toast-container");
            const toast = document.createElement("div");
            toast.className = `toast ${type === "error" ? "error" : ""}`;
            toast.innerText = message;
            container.appendChild(toast);

            setTimeout(() => {
                toast.classList.add("hide");
                setTimeout(() => toast.remove(), 400);
            }, 3500);
        }

        function cleanDni(val) {
            if (val === null || val === undefined) return "";
            let s = String(val).trim().split('.')[0]; 
            return s.replace(/[^0-9a-zA-Z]/g, ""); 
        }

        /* =========================================================
           RESOLVER PROPIEDADES DINÁMICAS (Tolerante a acentos y mayúsculas)
        ========================================================= */
        function obtenerPropiedadAlumno(obj, posiblesCabeceras) {
            if (!obj) return "";
            for (let nombre of posiblesCabeceras) {
                // Eliminar acentos, pasar a minúsculas y quitar espacios sobrantes
                const normalizedTarget = nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                for (let key in obj) {
                    const normalizedKey = key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
                    if (normalizedKey === normalizedTarget) {
                        return obj[key];
                    }
                }
            }
            return "";
        }

        function obtenerPropiedadSalida(reg, posiblesNombres) {
            if (!reg) return "";
            // Construir mapa de claves normalizadas para búsquedas robustas
            const mapa = {};
            for (let key in reg) {
                try {
                    const k = String(key).toLowerCase().trim();
                    mapa[k] = reg[key];
                } catch (e) {
                    mapa[key] = reg[key];
                }
            }

            for (let nombre of posiblesNombres) {
                const normalized = String(nombre).toLowerCase().trim();
                if (mapa[normalized] !== undefined && mapa[normalized] !== null) {
                    return mapa[normalized];
                }
            }

            for (let key in mapa) {
                for (let nombre of posiblesNombres) {
                    if (key.includes(String(nombre).toLowerCase().trim())) {
                        return mapa[key];
                    }
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
                    if (valStr.includes(":") || valStr.includes("T")) {
                        return reg[k];
                    }
                }
            }
            
            for (let key in reg) {
                const val = String(reg[key]).trim();
                const hasDate = val.includes("/") || val.includes("-");
                const hasTime = val.includes(":");
                if (hasDate && hasTime) {
                    return reg[key];
                }
            }
            
            for (let key in reg) {
                const keyLower = key.toLowerCase();
                if (keyLower.includes("fecha") || keyLower.includes("salida") || keyLower.includes("hora")) {
                    if (reg[key]) return reg[key];
                }
            }
            return "";
        }

        async function cargarDatos(silent = false, forceToast = false) {
            if (isRefreshing) return;
            isRefreshing = true;
            if (!silent) {
                mostrarLoader(true, "Conectando con Google Sheets...");
            } else {
                mostrarIndicadorActualizacion(true);
            }
            const corsPanel = document.getElementById("cors-helper-panel");
            if (corsPanel) corsPanel.style.display = "none";
            
            try {
                const response = await fetch(URL + "?_ts=" + Date.now(), {
                    method: "GET",
                    mode: "cors",
                    redirect: "follow",
                    headers: {
                        "Accept": "application/json"
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP status ${response.status}`);
                }

                const data = await response.json();
                console.log("Datos recibidos de la API:", data);

                if (!data.ok) {
                    throw new Error(data.error || "Respuesta incorrecta de Google Sheets");
                }

                const hashActual = stableStringify(data);
                if (ultimoHashDatos && hashActual === ultimoHashDatos) {
                    actualizarUltimaActualizacion(new Date());
                    if (!silent || forceToast) {
                        showToast("No hay cambios en los datos.");
                    }
                    return;
                }

                ultimoHashDatos = hashActual;
                actualizarUltimaActualizacion(new Date());

                // Normalización inteligente de los alumnos para evitar incompatibilidades de acentos de cabecera
                const rawAlumnos = data.alumnos || [];
                // Mantener campos locales (como horaLlegadaTarde) si existen en la sesión
                alumnos = rawAlumnos.map(a => {
                    const dniVal = obtenerPropiedadAlumno(a, ['dni']);
                    const nombreVal = obtenerPropiedadAlumno(a, ['nombre', 'nombre y apellido', 'estudiante']);
                    const cursoVal = obtenerPropiedadAlumno(a, ['curso', 'año', 'ano']);
                    const divisionVal = obtenerPropiedadAlumno(a, ['division', 'división', 'div']);
                    const turnoVal = obtenerPropiedadAlumno(a, ['turno']);
                    const espVal = obtenerPropiedadAlumno(a, ['especialidad', 'orientacion', 'orientación']);
                    const estadoVal = obtenerPropiedadAlumno(a, ['estado', 'asistencia']);

                    const existing = (alumnos || []).find(e => cleanDni(e.dni) === cleanDni(dniVal));

                    // Priorizar valor remoto si existe, sino conservar el local (horaLlegadaTarde)
                    const horaRemota = obtenerPropiedadAlumno(a, ['horaLlegadaTarde', 'hora llegada', 'horaLlegada', 'hora']);
                    const horaLlegadaTardeFinal = horaRemota ? horaRemota : (existing ? existing.horaLlegadaTarde : '');

                    return {
                        dni: dniVal,
                        nombre: nombreVal,
                        curso: cursoVal,
                        division: divisionVal,
                        turno: turnoVal,
                        especialidad: espVal,
                        estado: estadoVal,
                        horaLlegadaTarde: horaLlegadaTardeFinal,
                        retiroPor: existing ? existing.retiroPor : undefined,
                        horaRetiro: existing ? existing.horaRetiro : undefined
                    };
                });

                docentes = data.docentes || [];
                salidas = data.salidas || [];
                historial = data.historial || [];

                actualizarFiltros();
                actualizarSelectorDocentes();
                render();
                renderHistorial();

                if (!silent || forceToast) {
                    showToast("Datos Sincronizados.");
                }
            } catch (error) {
                console.error("Error al cargar datos:", error);
                const corsPanelErr = document.getElementById("cors-helper-panel");
                if (corsPanelErr) corsPanelErr.style.display = "block";
                showToast("Error de conexión. Revisa las instrucciones en pantalla.", "error");
            } finally {
                if (!silent) {
                    mostrarLoader(false);
                } else {
                    mostrarIndicadorActualizacion(false);
                }
                isRefreshing = false;
            }
        }

        function mostrarLoader(show, text = "Cargando sistema...") {
            const loader = document.getElementById("loader");
            const loaderText = document.getElementById("loader-text");
            if (loaderText) loaderText.textContent = text;
            if (show) loader.classList.remove("hidden");
            else loader.classList.add("hidden");
        }

        function actualizarSelectorDocentes() {
            const select = document.getElementById("docentes");
            if (!select) return;
            select.innerHTML = '<option value="">Seleccione Usuario...</option>';
            
            docentes.forEach(d => {
                const nombreDocente = d.nombre || d.usuario || "Sin Nombre";
                const opt = document.createElement("option");
                opt.value = nombreDocente;
                opt.textContent = nombreDocente;
                select.appendChild(opt);
            });
        }

        function actualizarFiltros() {
            const cursos = [...new Set(alumnos.map(a => a.curso).filter(Boolean))].sort();
            const divisiones = [...new Set(alumnos.map(a => a.division).filter(Boolean))].sort();
            const turnos = [...new Set(alumnos.map(a => a.turno).filter(Boolean))].sort();
            const especialidades = [...new Set(alumnos.map(a => a.especialidad).filter(Boolean))].sort();

            cargarOpcionesFiltro("fCurso", cursos, "Todos los Cursos");
            cargarOpcionesFiltro("fDivision", divisiones, "Todas las Divisiones");
            cargarOpcionesFiltro("fTurno", turnos, "Todos los Turnos");
            cargarOpcionesFiltro("fEspecialidad", especialidades, "Todas las Especialidades");
        }

        function cargarOpcionesFiltro(id, lista, porDefecto) {
            const select = document.getElementById(id);
            if (!select) return;
            const valAnterior = select.value;
            select.innerHTML = `<option value="">-- ${porDefecto} --</option>`;
            lista.forEach(item => {
                const opt = document.createElement("option");
                opt.value = item;
                opt.textContent = item;
                select.appendChild(opt);
            });
            if (lista.includes(valAnterior)) {
                select.value = valAnterior;
            }
        }

        function verificarAcceso() {
            const selectDocente = document.getElementById("docentes");
            const passInput = document.getElementById("passDocente");

            const nombreSel = selectDocente.value;
            const pinSel = passInput.value.trim();

            if (!nombreSel) {
                showToast("Por favor, selecciona un usuario.", "error");
                return;
            }

            const docenteEncontrado = docentes.find(d => {
                const nombreDoc = d.nombre || d.usuario || "";
                return nombreDoc.toLowerCase() === nombreSel.toLowerCase();
            });

            if (docenteEncontrado) {
                const pinCorrecto = String(docenteEncontrado.pin || docenteEncontrado.clave || "").trim();
                
                if (pinCorrecto === pinSel) {
                    usuarioActivo = docenteEncontrado;
                    showToast(`¡Bienvenido/a, ${nombreSel}!`);
                    
                    document.getElementById("seccion-login").style.display = "none";
                    document.getElementById("seccion-filtros").style.display = "block";
                    document.getElementById("contador-container").style.display = "block";
                    document.getElementById("buscador-box").style.display = "block";
                    document.getElementById("historial-container").style.display = "block";

                    // Paneles exclusivos del directivo
                    const esDirectivo = esRolDirectivo(docenteEncontrado);
                    document.getElementById("panel-alertas").style.display = esDirectivo ? "block" : "none";
                    document.getElementById("panel-dashboard").style.display = esDirectivo ? "block" : "none";
                    if (esDirectivo) {
                        actualizarFiltrosDashboard();
                        actualizarDashboard();
                        actualizarAlertas();
                    }
                    
                    const rolBox = document.getElementById("rolActivo");
                    rolBox.textContent = `👤 ${nombreSel}`;
                    rolBox.style.display = "block";
                    
                    document.getElementById("logoutBtn").style.display = "block";
                    passInput.value = "";
                    // refresh data from server so new user sees latest horarios/estados
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
            document.getElementById("seccion-login").style.display = "block";
            document.getElementById("seccion-filtros").style.display = "none";
            document.getElementById("contador-container").style.display = "none";
            document.getElementById("buscador-box").style.display = "none";
            document.getElementById("historial-container").style.display = "none";
            document.getElementById("resumen-container").style.display = "none";
            document.getElementById("rolActivo").style.display = "none";
            document.getElementById("logoutBtn").style.display = "none";
            document.getElementById("panel-alertas").style.display = "none";
            document.getElementById("panel-dashboard").style.display = "none";
            
            Object.keys(timers).forEach(k => clearInterval(timers[k]));
            timers = {};
            
            render();
            showToast("Sesión cerrada.");
        }

        function parsearFechaGAS(strFecha) {
            if (!strFecha) return new Date();
            if (strFecha instanceof Date) return strFecha;
            if (typeof strFecha === 'number') return new Date(strFecha);

            const str = String(strFecha).trim();

            const regexDmy = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
            const match = str.match(regexDmy);
            if (match) {
                const dia = parseInt(match[1], 10);
                const mes = parseInt(match[2], 10) - 1; 
                const anio = parseInt(match[3], 10);
                const hora = parseInt(match[4], 10);
                const min = parseInt(match[5], 10);
                const seg = match[6] ? parseInt(match[6], 10) : 0;
                return new Date(anio, mes, dia, hora, min, seg);
            }

            const parsed = new Date(strFecha);
            if (!isNaN(parsed.getTime())) return parsed;

            return new Date(); 
        }

        function reproducirAlarmaOscilador() {
            try {
                if (!sharedAudioCtx) {
                    sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                const audioCtx = sharedAudioCtx;
                if (audioCtx.state === 'suspended') audioCtx.resume();
                
                const playBeep = (delay, frequency, duration) => {
                    const osc = audioCtx.createOscillator();
                    const gainNode = audioCtx.createGain();
                    
                    osc.type = "sine";
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
                
                playBeep(0.0, 1000, 0.25);
                playBeep(0.35, 1000, 0.25);
                playBeep(0.70, 800, 0.50);
            } catch (e) {
                console.error("Error al sintetizar alarma:", e);
            }
        }

        function getFiltrosActivos() {
            return {
                curso: document.getElementById("fCurso").value,
                division: document.getElementById("fDivision").value,
                turno: document.getElementById("fTurno").value,
                especialidad: document.getElementById("fEspecialidad").value,
                busqueda: document.getElementById("buscador").value.toLowerCase().trim()
            };
        }

        function alumnoCoincideFiltro(alumno, filtros) {
            if (filtros.curso && alumno.curso !== filtros.curso) return false;
            if (filtros.division && alumno.division !== filtros.division) return false;
            if (filtros.turno && alumno.turno !== filtros.turno) return false;
            if (filtros.especialidad && alumno.especialidad !== filtros.especialidad) return false;
            if (filtros.busqueda) {
                const nombreMatch = String(alumno.nombre || "").toLowerCase().includes(filtros.busqueda);
                const dniMatch = cleanDni(alumno.dni).includes(cleanDni(filtros.busqueda));
                if (!nombreMatch && !dniMatch) return false;
            }
            return true;
        }

        function crearTarjetaAlumno(alumno, regSalida) {
            const dniLimpio = cleanDni(alumno.dni);
            const div = document.createElement("div");
            div.id = `alumno-${dniLimpio}`;
            div.dataset.dni = dniLimpio;
            div.dataset.nombre = alumno.nombre || '';
            const { html, estadoClase } = construirTarjetaAlumnoHTML(alumno, regSalida);
            div.className = `alumno ${estadoClase}`;
            div.innerHTML = html;
            return div;
        }

        function actualizarCartasVisibles() {
            const grid = document.getElementById("grid");
            if (!grid) return;
            if (!usuarioActivo) {
                grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--muted);">
                    Por favor, inicia sesión para gestionar las salidas de los alumnos.
                </div>`;
                return;
            }

            const filtros = getFiltrosActivos();
            const alumnosVisibles = alumnos.filter(a => alumnoCoincideFiltro(a, filtros));
            const visibleDnis = new Set();
            let placeholder = document.getElementById("grid-empty-msg");

            if (alumnosVisibles.length === 0) {
                if (!placeholder) {
                    placeholder = document.createElement("div");
                    placeholder.id = "grid-empty-msg";
                    placeholder.style.cssText = "grid-column: 1/-1; text-align: center; padding: 40px; color: var(--muted);";
                    placeholder.innerHTML = "No se encontraron alumnos con estos filtros o búsqueda.";
                    grid.appendChild(placeholder);
                } else {
                    placeholder.style.display = "";
                }
            } else if (placeholder) {
                placeholder.style.display = "none";
            }

            alumnosVisibles.forEach((a) => {
                const dniLimpio = cleanDni(a.dni);
                visibleDnis.add(dniLimpio);
                const regSalida = obtenerRegistroSalida(a);
                let cardEl = document.getElementById(`alumno-${dniLimpio}`);

                if (!cardEl) {
                    cardEl = crearTarjetaAlumno(a, regSalida);
                } else {
                    const { html, estadoClase } = construirTarjetaAlumnoHTML(a, regSalida);
                    cardEl.className = `alumno ${estadoClase}`;
                    cardEl.innerHTML = html;
                    cardEl.style.display = "";
                }

                grid.appendChild(cardEl);

                // Añadir listener delegado por tarjeta para botones (evita handlers inline)
                if (!cardEl.dataset.listenerAttached) {
                    cardEl.addEventListener('click', async function(e) {
                        const btn = e.target.closest('button');
                        if (btn) {
                            const action = btn.dataset.action;
                            const dniBtn = btn.dataset.dni;
                            if (!action) return;

                            if (action === 'registrarSalida') {
                                registrarSalida(dniBtn);
                            } else if (action === 'registrarRegreso') {
                                registrarRegreso(dniBtn);
                            } else if (action === 'openPopover') {
                                e.stopPropagation();
                                openPopoverForButton(btn, dniBtn);
                            } else if (action === 'preceptor') {
                                const accion = btn.dataset.accion;
                                cambiarEstadoPreceptor(dniBtn, accion);
                            }
                        } else {
                            // Click en tarjeta (no en botón): abrir modal de cambio de estado si es preceptor
                            const esPreceptor = usuarioActivo && (String(usuarioActivo.rol || usuarioActivo.cargo || "").toUpperCase() === "PRECEPTOR");
                            if (!esPreceptor) return;
                            const dniCard = this.dataset.dni;
                            const nombreCard = this.dataset.nombre || '';
                            const seleccion = await mostrarModalEstado(nombreCard);
                            if (!seleccion) return;
                            if (seleccion === 'SALIDA') {
                                registrarSalida(dniCard);
                            } else if (seleccion === 'REGRESO') {
                                registrarRegreso(dniCard);
                            } else {
                                cambiarEstadoPreceptor(dniCard, seleccion);
                            }
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
                if (!visibleDnis.has(cardDni)) {
                    card.style.display = "none";
                }
            });
        }

        function render() {
            actualizarCartasVisibles();
            actualizarContadores();
            actualizarResumen();
        }

        // Listas globales para los popups del resumen
        let _listaAusentes = [];
        let _listaTarde = [];
        let _listaSalidas = [];
        let _listaRetirados = [];

        function actualizarResumen() {
            const resumenContainer = document.getElementById("resumen-container");
            if (!resumenContainer) return;

            if (!usuarioActivo) {
                resumenContainer.style.display = "none";
                return;
            }

            const filtros = getFiltrosActivos();
            const alumnosVisibles = alumnos.filter(a => alumnoCoincideFiltro(a, filtros));

            _listaAusentes = alumnosVisibles.filter(a =>
                String(a.estado || "").toUpperCase() === "AUSENTE"
            ).sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

            _listaTarde = alumnosVisibles.filter(a =>
                /TARDE/i.test(String(a.estado || "")) && String(a.estado || "").toUpperCase() !== "AUSENTE"
            ).sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

            _listaSalidas = alumnosVisibles.filter(a => {
                if (String(a.estado || "").toUpperCase() === "AUSENTE") return false;
                return !!obtenerRegistroSalida(a);
            }).map(a => {
                const reg = obtenerRegistroSalida(a);
                return Object.assign({}, a, {
                    _causa: obtenerPropiedadSalida(reg, ['causa', 'destino', 'motivo', 'lugar']) || '',
                    _horaSalida: detectarFechaSalida(reg) || ''
                });
            }).sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

            _listaRetirados = alumnosVisibles.filter(a =>
                /RETIRO/i.test(String(a.estado || ""))
            ).sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), 'es', { sensitivity: 'base' }));

            const btnAusentes   = document.getElementById("btn-resumen-ausentes");
            const btnTarde      = document.getElementById("btn-resumen-tarde");
            const btnSalidas    = document.getElementById("btn-resumen-salidas");
            const btnRetirados  = document.getElementById("btn-resumen-retirados");
            const countAusentes  = document.getElementById("resumen-ausentes-count");
            const countTarde     = document.getElementById("resumen-tarde-count");
            const countSalidas   = document.getElementById("resumen-salidas-count");
            const countRetirados = document.getElementById("resumen-retirados-count");

            if (btnAusentes) {
                if (_listaAusentes.length > 0) {
                    btnAusentes.style.display = "";
                    if (countAusentes) countAusentes.textContent = _listaAusentes.length;
                } else {
                    btnAusentes.style.display = "none";
                }
            }

            if (btnTarde) {
                if (_listaTarde.length > 0) {
                    btnTarde.style.display = "";
                    if (countTarde) countTarde.textContent = _listaTarde.length;
                } else {
                    btnTarde.style.display = "none";
                }
            }

            if (btnSalidas) {
                if (_listaSalidas.length > 0) {
                    btnSalidas.style.display = "";
                    if (countSalidas) countSalidas.textContent = _listaSalidas.length;
                } else {
                    btnSalidas.style.display = "none";
                }
            }

            if (btnRetirados) {
                if (_listaRetirados.length > 0) {
                    btnRetirados.style.display = "";
                    if (countRetirados) countRetirados.textContent = _listaRetirados.length;
                } else {
                    btnRetirados.style.display = "none";
                }
            }

            const hayDatos = _listaAusentes.length > 0 || _listaTarde.length > 0 || _listaSalidas.length > 0 || _listaRetirados.length > 0;
            resumenContainer.style.display = hayDatos ? "" : "none";
        }
        function obtenerAlumnosVisibles() {
            const fCurso = document.getElementById("fCurso").value;
            const fDivision = document.getElementById("fDivision").value;
            const fTurno = document.getElementById("fTurno").value;
            const fEsp = document.getElementById("fEspecialidad").value;
            const busqueda = document.getElementById("buscador").value.toLowerCase().trim();

            return alumnos.filter((a) => {
                if (fCurso && a.curso !== fCurso) return false;
                if (fDivision && a.division !== fDivision) return false;
                if (fTurno && a.turno !== fTurno) return false;
                if (fEsp && a.especialidad !== fEsp) return false;
                if (busqueda) {
                    const nombreMatch = String(a.nombre || "").toLowerCase().includes(busqueda);
                    const dniMatch = cleanDni(a.dni).includes(cleanDni(busqueda));
                    if (!nombreMatch && !dniMatch) return false;
                }
                return true;
            });
        }

        function obtenerRegistroSalida(alumno) {
            return salidas.find((s) => {
                const rowDni = s.dni || s.DNI || s['dni'] || '';
                const rowRegreso = obtenerPropiedadSalida(s, ['regreso', 'retorno', 'fin']);
                const rowEstado = obtenerPropiedadSalida(s, ['estado', 'status']);
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

        function construirTarjetaAlumnoHTML(a, regSalida) {
            let estadoClase = "in";
            let textoEstado = "🟢 EN AULA";
            const esAusente = String(a.estado || "").toUpperCase() === "AUSENTE";
            const esTarde = /TARDE/i.test(String(a.estado || ""));
            const esRetiro = String(a.estado || "").toUpperCase() === "RETIRO";

            // Determinar clase de estado para la tarjeta
            if (esAusente) {
                estadoClase = "ausente";
            } else if (esRetiro) {
                estadoClase = "retiro";
            } else if (regSalida) {
                estadoClase = "out";
            } else {
                estadoClase = "in";
            }

            // Determinar texto de estado
            if (esAusente) {
                textoEstado = "❌ AUSENTE";
            } else if (esRetiro) {
                textoEstado = "👨‍👩‍👦 RETIRADO";
            } else if (regSalida) {
                const causaDestino = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "Salida";
                textoEstado = `🚪 AFUERA (${causaDestino})${esTarde ? ' — ⏰ LLEGÓ TARDE' : ''}`;
            } else if (esTarde) {
                textoEstado = "⏰ LLEGÓ TARDE";
            } else {
                textoEstado = "🟢 EN AULA";
            }

            let html = `
                <div>
                    ${ (esTarde || a.horaLlegadaTarde) ? `<div class="late-pill">⏰ LLEGÓ TARDE${a.horaLlegadaTarde ? ` — ${escapeHtml(formatHora(a.horaLlegadaTarde))}` : ''}</div>` : '' }
                    <span class="nombre">${escapeHtml(a.nombre)}</span>
                    <div class="curso-info">Curso: ${escapeHtml(a.curso) || '-'} ${escapeHtml(a.division) || ''} | DNI: ${escapeHtml(a.dni)}</div>
            `;

            // Mostrar estado (las badges CSS ya indican RETIRADO/AUSENTE)
            if (esAusente) {
                // Badge visually indicates AUSENTE; no duplicate label
            } else if (esRetiro) {
                // Badge visually indicates RETIRADO; no duplicate label
            } else if (esTarde) {
                // Late indicator handled by single .late-pill element above
            } else if (regSalida) {
                const causaDestino = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "Salida";
                const mostrarTimer = esSalidaConCronometro(causaDestino);
                const badgeTipo = mostrarTimer ? 'timed' : 'not-timed';
                const badgeTexto = mostrarTimer ? 'Cronómetro activo' : 'Salida sin cronómetro';
                html += `<div class="motivo-destacado">${escapeHtml(textoEstado)}</div>`;
                html += `<div class="causa-badge ${badgeTipo}">${escapeHtml(badgeTexto)}</div>`;
                if (mostrarTimer) {
                    html += `
                        <div class="timer-box" id="timer-${cleanDni(a.dni)}">🕒 Calculando...</div>
                    `;
                } else {
                    html += `<div class="timer-note">Recreos y otras salidas no se cronometran en este panel; registra el regreso normalmente.</div>`;
                }
            } else {
                html += `
                    <div class="estado-aula">${escapeHtml(textoEstado)}</div>
                `;
            }

            // Mostrar información de retiro si existe
            if (a.retiroPor) {
                html += `<div class="retiro-info">Retirado por: ${escapeHtml(a.retiroPor)}${a.horaRetiro ? ` — ${escapeHtml(formatHora(a.horaRetiro))}` : ''}</div>`;
            }
            // Mostrar solo el botón "Más" (⋯) que abre el popover con todas las acciones
            html += `
                <div class="card-actions" style="margin-top:12px; display:flex; justify-content:flex-end;">
                    <button class="more-btn" data-action="openPopover" data-dni="${escapeHtml(a.dni)}" title="Más acciones" aria-label="Más acciones" aria-expanded="false">⋯</button>
                </div>
            `;

            // Not showing preceptor buttons inline; use card click to change estado if usuario es preceptor

            html += `</div>`;
            return { html, estadoClase };
        }

        function actualizarContadores() {
            const fCurso = document.getElementById("fCurso").value;
            const fDivision = document.getElementById("fDivision").value;
            const fTurno = document.getElementById("fTurno").value;
            const fEsp = document.getElementById("fEspecialidad").value;
            const busqueda = document.getElementById("buscador").value.toLowerCase().trim();

            let totalInscriptos = 0;
            let totalAula = 0;
            let totalAfuera = 0;
            let totalAusentes = 0;

            alumnos.forEach((a) => {
                if (fCurso && a.curso !== fCurso) return;
                if (fDivision && a.division !== fDivision) return;
                if (fTurno && a.turno !== fTurno) return;
                if (fEsp && a.especialidad !== fEsp) return;
                if (busqueda) {
                    const nombreMatch = String(a.nombre || "").toLowerCase().includes(busqueda);
                    const dniMatch = cleanDni(a.dni).includes(cleanDni(busqueda));
                    if (!nombreMatch && !dniMatch) return;
                }

                totalInscriptos++;
                const regSalida = obtenerRegistroSalida(a);

                if (a.estado === "AUSENTE" || a.estado === "RETIRO") {
                    totalAusentes++;
                } else if (regSalida) {
                    totalAfuera++;
                } else {
                    totalAula++;
                }
            });

            document.getElementById("total-alumnos").textContent = totalInscriptos;
            document.getElementById("en-aula").textContent = totalAula;
            document.getElementById("afuera").textContent = totalAfuera;
            document.getElementById("ausentes").textContent = totalAusentes;
        }

        function actualizarTarjetaAlumno(alumno) {
            const dniLimpio = cleanDni(alumno.dni);
            const cardEl = document.getElementById(`alumno-${dniLimpio}`);
            const regSalida = obtenerRegistroSalida(alumno);
            const { html, estadoClase } = construirTarjetaAlumnoHTML(alumno, regSalida);

            if (cardEl) {
                cardEl.className = `alumno ${estadoClase}`;
                cardEl.innerHTML = html;
                if (regSalida) {
                    const causaSalida = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "";
                    if (esSalidaConCronometro(causaSalida)) {
                        const timestampSalida = detectarFechaSalida(regSalida);
                        iniciarCronometro(dniLimpio, timestampSalida);
                    } else if (timers[dniLimpio]) {
                        clearInterval(timers[dniLimpio]);
                        delete timers[dniLimpio];
                    }
                }
                actualizarContadores();
            }
        }

        function iniciarCronometro(dniLimpio, fechaSalidaStr) {
            if (timers[dniLimpio]) {
                clearInterval(timers[dniLimpio]);
            }

            if (!fechaSalidaStr) {
                const timerEl = document.getElementById(`timer-${dniLimpio}`);
                if (timerEl) timerEl.textContent = "🕒 Sin Hora";
                return;
            }

            const fechaInicio = parsearFechaGAS(fechaSalidaStr);

            function actualizarVisual() {
                const timerEl = document.getElementById(`timer-${dniLimpio}`);
                const cardEl = document.getElementById(`alumno-${dniLimpio}`);
                if (!timerEl || !cardEl) {
                    clearInterval(timers[dniLimpio]);
                    delete timers[dniLimpio];
                    return;
                }

                const transcurridoMs = new Date() - fechaInicio;
                const totalSegundos = Math.floor(transcurridoMs / 1000);
                const totalSegundosAbs = Math.max(0, totalSegundos);
                
                const minutos = Math.floor(totalSegundosAbs / 60);
                const segundos = totalSegundosAbs % 60;

                const textoTiempo = `${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;
                timerEl.textContent = `🕒 ${textoTiempo}`;

                if (minutos >= 15) {
                    cardEl.classList.add("tiempo-agotado-bg");
                    timerEl.classList.remove("tiempo-critico");
                    timerEl.textContent = `🚨 EXCEDIDO: ${textoTiempo}`;
                    
                    const ahora = Date.now();
                    if (ahora - ultimoAudioPlay > 12000) { 
                        ultimoAudioPlay = ahora;
                        reproducirAlarmaOscilador();
                        document.getElementById("alertSound").play().catch(() => {});
                    }
                } else if (minutos >= 12) {
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

        async function enviarTransaccionPost(payload) {
            try {
                // Adjuntar secret si está configurado y no viene en el payload
                try { if (typeof CLIENT_SECRET === 'string' && CLIENT_SECRET && !payload.secret) payload.secret = CLIENT_SECRET; } catch(e){}
                // Asegurar que siempre figure un identificador de quien realiza la acción
                try { if (!payload.docente) payload.docente = (usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario) : 'ANONIMO'); } catch(e){}
                const response = await fetch(URL, {
                    method: "POST",
                    mode: "cors",
                    redirect: "follow",
                    headers: {
                        // Usar text/plain por compatibilidad con Google Apps Script endpoints
                        "Content-Type": "text/plain;charset=utf-8"
                    },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                // Intentar parsear JSON, si falla devolver texto crudo para diagnósticos
                try {
                    return await response.json();
                } catch (e) {
                    const txt = await response.text();
                    try {
                        const parsed = JSON.parse(txt);
                        return parsed;
                    } catch (e2) {
                        console.warn('Respuesta no-JSON recibida del servidor:', txt);
                        return { ok: true, raw: txt };
                    }
                }
            } catch (e) {
                console.warn('Network error, encolando petición:', e && e.message);
                try { payload.queued = true; } catch(err){}
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
                        method: "POST",
                        mode: "cors",
                        redirect: "follow",
                        headers: { "Content-Type": "text/plain;charset=utf-8" },
                        body: JSON.stringify(item.payload)
                    });
                    if (resp.ok) {
                        pendingRequests.shift();
                        showToast('Petición en la cola enviada con éxito.');
                        // actualizar datos inmediatamente para reflejar cambios a todos los usuarios
                        try { cargarDatos(true).catch(() => {}); } catch(e){}
                    }
                } catch (e) {
                    // no-op, se reintentará en el siguiente ciclo
                } finally {
                    queueProcessing = false;
                    if (pendingRequests.length === 0) {
                        clearInterval(queueTimer);
                        queueTimer = null;
                        // cuando la cola queda vacía, forzar recarga para asegurar sincronía entre usuarios
                        try { cargarDatos(true).catch(() => {}); } catch(e){}
                    }
                }
            }, 10000);
        }

        async function registrarSalida(dni) {
            const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
            if (!alumno) return;

            // Asegurarse que hay un usuario activo
            if (!usuarioActivo) {
                showToast('Debe iniciar sesión antes de registrar salidas.', 'error');
                return;
            }

            // No usar prompt: tomar causa desde el selector de la interfaz
            let motivoSalida = obtenerCausaSalida();
            if (!motivoSalida) motivoSalida = "Baño";

            mostrarIndicadorActualizacion(true);
            try {
                const result = await enviarTransaccionPost({
                    tipoAccion: "movimiento",
                    tipo: "salida",
                    dni: cleanDni(alumno.dni), 
                    nombre: alumno.nombre,
                    curso: alumno.curso,
                    division: alumno.division,
                    turno: alumno.turno,
                    especialidad: alumno.especialidad,
                    docente: usuarioActivo.nombre || usuarioActivo.usuario,
                    causa: motivoSalida
                });

                if (!result.ok) throw new Error(result.error);

                const nuevaSalida = {
                    dni: alumno.dni,
                    salida: new Date().toISOString(),
                    regreso: "",
                    estado: "AFUERA",
                    causa: motivoSalida
                };
                salidas.push(nuevaSalida);
                ultimoHashDatos = null;

                showToast(`Salida registrada correctamente para ${alumno.nombre}.`);
                actualizarTarjetaAlumno(alumno);
                actualizarContadores();
                mostrarIndicadorActualizacion(false);
                if (!result.queued) {
                    cargarDatos(true).catch(() => {});
                }
            } catch (error) {
                console.error(error);
                showToast("Error al registrar salida: " + error.message, "error");
                mostrarIndicadorActualizacion(false);
            }
        }

        async function registrarRegreso(dni) {
            const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
            if (!alumno) return;

            const dniLimpio = cleanDni(dni);
            if (timers[dniLimpio]) {
                clearInterval(timers[dniLimpio]);
                delete timers[dniLimpio];
            }

            mostrarIndicadorActualizacion(true);
            try {
                const result = await enviarTransaccionPost({
                    tipoAccion: "movimiento",
                    tipo: "regreso",
                    dni: dniLimpio, 
                    nombre: alumno.nombre,
                    docente: usuarioActivo.nombre || usuarioActivo.usuario
                });

                if (!result.ok) throw new Error(result.error);

                const registro = salidas.slice().reverse().find((s) => {
                    const rowDni = s.dni || s.DNI || s['dni'] || '';
                    const rowRegreso = obtenerPropiedadSalida(s, ['regreso', 'retorno', 'fin']);
                    return cleanDni(rowDni) === dniLimpio && (!rowRegreso || rowRegreso === "");
                });
                if (registro) {
                    registro.regreso = new Date().toISOString();
                    registro.estado = "EN AULA";
                }
                ultimoHashDatos = null;

                showToast(`Regreso de ${alumno.nombre} registrado con éxito.`);
                actualizarTarjetaAlumno(alumno);
                actualizarContadores();
                mostrarIndicadorActualizacion(false);
                if (!result.queued) {
                    cargarDatos(true).catch(() => {});
                }
            } catch (error) {
                console.error(error);
                showToast("Error al registrar regreso: " + error.message, "error");
                mostrarIndicadorActualizacion(false);
            }
        }

        async function marcarRecreoParaTodos() {
            const confirmar = await mostrarConfirmacion(
                "Recreo para todos",
                "¿Registrar recreo para todos los alumnos visibles?"
            );
            if (!confirmar) return;

            const alumnosVisibles = obtenerAlumnosVisibles().filter((a) => {
                const regSalida = obtenerRegistroSalida(a);
                return !regSalida && a.estado !== "AUSENTE" && a.estado !== "RETIRO";
            });

            if (!alumnosVisibles.length) {
                showToast("No hay alumnos en aula para enviar a recreo.", "error");
                return;
            }

            mostrarIndicadorActualizacion(true);
            let ok = 0;
            let fail = 0;

            for (const alumno of alumnosVisibles) {
                try {
                    const motivoSalida = "Recreo";
                    const result = await enviarTransaccionPost({
                        tipoAccion: "movimiento",
                        tipo: "salida",
                        dni: cleanDni(alumno.dni),
                        nombre: alumno.nombre,
                        curso: alumno.curso,
                        division: alumno.division,
                        turno: alumno.turno,
                        especialidad: alumno.especialidad,
                        docente: usuarioActivo.nombre || usuarioActivo.usuario,
                        causa: motivoSalida
                    });

                    if (!result.ok) throw new Error(result.error || "Error en servidor");

                    salidas.push({
                        dni: alumno.dni,
                        salida: new Date().toISOString(),
                        regreso: "",
                        estado: "AFUERA",
                        causa: motivoSalida
                    });
                    ok++;
                } catch (error) {
                    console.error(error);
                    fail++;
                }
            }

            ultimoHashDatos = null;
            render();
            mostrarIndicadorActualizacion(false);
            if (ok > 0) showToast(`Recreo registrado para ${ok} alumno${ok === 1 ? '' : 's'}.`);
            if (fail > 0) showToast(`${fail} movimiento${fail === 1 ? '' : 's'} fallaron.`, "error");
        }

        async function marcarAulaParaTodos() {
            const confirmar = await mostrarConfirmacion(
                "Aula para todos",
                "¿Registrar regreso a aula para todos los alumnos visibles que están fuera?"
            );
            if (!confirmar) return;

            const alumnosVisibles = obtenerAlumnosVisibles().filter((a) => obtenerRegistroSalida(a) && a.estado !== "AUSENTE" && a.estado !== "RETIRO");
            if (!alumnosVisibles.length) {
                showToast("No hay alumnos fuera para traer de regreso.", "error");
                return;
            }

            mostrarIndicadorActualizacion(true);
            let ok = 0;
            let fail = 0;

            for (const alumno of alumnosVisibles) {
                try {
                    const result = await enviarTransaccionPost({
                        tipoAccion: "movimiento",
                        tipo: "regreso",
                        dni: cleanDni(alumno.dni),
                        nombre: alumno.nombre,
                        docente: usuarioActivo.nombre || usuarioActivo.usuario
                    });

                    if (!result.ok) throw new Error(result.error || "Error en servidor");

                    const registro = salidas.slice().reverse().find((s) => {
                        const rowDni = s.dni || s.DNI || s['dni'] || '';
                        const rowRegreso = obtenerPropiedadSalida(s, ['regreso', 'retorno', 'fin']);
                        const rowEstado = obtenerPropiedadSalida(s, ['estado', 'status']);
                        return (
                            cleanDni(rowDni) === cleanDni(alumno.dni) &&
                            (!rowRegreso || rowRegreso === "" || String(rowEstado).toUpperCase() === "AFUERA")
                        );
                    });

                    if (registro) {
                        registro.regreso = new Date().toISOString();
                        registro.estado = "EN AULA";
                    }
                    ok++;
                } catch (error) {
                    console.error(error);
                    fail++;
                }
            }

            ultimoHashDatos = null;
            render();
            mostrarIndicadorActualizacion(false);
            if (ok > 0) showToast(`Aula registrada para ${ok} alumno${ok === 1 ? '' : 's'}.`);
            if (fail > 0) showToast(`${fail} movimiento${fail === 1 ? '' : 's'} fallaron.`, "error");
        }

        async function cambiarEstadoPreceptor(dni, accion) {
            const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
            if (!alumno) return;

            const confirmar = await mostrarConfirmacion(
                "Actualizar Asistencia", 
                `¿Estás seguro de registrar a ${alumno.nombre} como "${accion}"?`
            );
            if (!confirmar) return;

            mostrarIndicadorActualizacion(true);
            try {
                const ahora = new Date();
                const horaFormato = ahora.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
                const payload = {
                    tipoAccion: "preceptor",
                    accion: accion,
                    dni: cleanDni(alumno.dni), 
                    nombre: alumno.nombre,
                    docente: usuarioActivo.nombre || usuarioActivo.usuario
                };

                // Si es RETIRO, pedir nombre de quien retira (tutor/padre)
                if (accion === "RETIRO PADRE/TUTOR") {
                    const quienRetira = await mostrarModalTutor(alumno.nombre);
                    if (quienRetira === null) {
                        mostrarIndicadorActualizacion(false);
                        return; // cancelado por usuario
                    }
                    payload.quienRetira = quienRetira;
                    payload.horaRetiro = horaFormato;
                }
                
                if (accion === "LLEGADA TARDE") {
                    payload.horaLlegadaTarde = horaFormato;
                }
                
                const result = await enviarTransaccionPost(payload);

                    if (!result.ok) throw new Error(result.error);

                if (accion === "AUSENTE") {
                    alumno.estado = "AUSENTE";
                } else if (accion === "LLEGADA TARDE") {
                    // Marcar como presente pero registrar la hora de llegada tarde
                    alumno.estado = ""; // contar como presente
                    alumno.horaLlegadaTarde = horaFormato;
                    payload.horaLlegadaTarde = horaFormato;
                } else if (accion === "RETIRO PADRE/TUTOR") {
                    alumno.estado = "RETIRO";
                    alumno.retiroPor = payload.quienRetira || "Tutor/Apoderado";
                    alumno.horaRetiro = payload.horaRetiro || horaFormato;
                } else if (accion === "PRESENTE") {
                    alumno.estado = "";
                    // No borrar `horaLlegadaTarde` para mantener registro visible permanentemente
                }
                ultimoHashDatos = null;

                showToast(`Estado de ${alumno.nombre} actualizado a ${accion}.`);
                // Añadir entrada local al historial para visibilidad inmediata
                historial.push({
                    fechahora: new Date().toLocaleString(),
                    alumno: alumno.nombre,
                    accion: accion,
                    usuario: usuarioActivo.nombre || usuarioActivo.usuario,
                    detalle: accion === 'RETIRO PADRE/TUTOR' ? alumno.retiroPor : (accion === 'LLEGADA TARDE' ? alumno.horaLlegadaTarde : ''),
                    tipoAccion: payload.tipoAccion || payload.tipoAccion || '',
                    tipo: payload.tipo || '',
                    dni: cleanDni(alumno.dni),
                    docente: payload.docente || usuarioActivo.nombre || usuarioActivo.usuario || '',
                    estado: alumno.estado || '',
                    horaLlegadaTarde: payload.horaLlegadaTarde || alumno.horaLlegadaTarde || '',
                    quienRetira: payload.quienRetira || alumno.retiroPor || '',
                    horaRetiro: payload.horaRetiro || alumno.horaRetiro || '',
                    queued: !!(result && result.queued)
                });

                actualizarTarjetaAlumno(alumno);
                renderHistorial();
                actualizarContadores();
                mostrarIndicadorActualizacion(false);
                if (!result.queued) {
                    cargarDatos(true).catch(() => {});
                }
            } catch (error) {
                console.error(error);
                showToast("Error al actualizar estado: " + error.message, "error");
                mostrarIndicadorActualizacion(false);
            }
        }

        function renderHistorial() {
            const container = document.getElementById("historial");
            if (!container) return;
            container.innerHTML = "";

            if (historial.length === 0) {
                container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--muted); font-size:13px;">
                    No hay movimientos registrados hoy.
                </div>`;
                return;
            }

            const listadoAMostrar = [...historial].reverse().slice(0, 50);

            listadoAMostrar.forEach(h => {
                const item = document.createElement("div");
                item.className = "historial-item";
                
                const fechaFormat = escapeHtml(h.fechahora || h.fecha || "00/00/0000 00:00");
                const alumnoRaw = h.alumno || h.nombre || "Alumno";
                const alumnoStr = escapeHtml(String(alumnoRaw).toUpperCase());
                const accionStr = escapeHtml(h.accion || "Cambio");
                const usuarioStr = escapeHtml(h.usuario || h.docente || "Preceptor");
                const tipoAccionStr = escapeHtml(h.tipoAccion || h.tipoaccion || '');
                const dniStr = escapeHtml(h.dni || '');
                const docenteHist = escapeHtml(h.docente || '');
                const estadoHist = escapeHtml(h.estado || '');
                const quienRetiraHist = escapeHtml(h.quienRetira || h.quienretira || '');
                const queuedHist = (h.queued === true || h.queued === '1' || h.queued === 1) ? 'Sí' : (h.queued ? escapeHtml(String(h.queued)) : 'No');

                // Mostrar horas en ISO si ya vienen así, sino formatear
                const formatTimeForDisplay = (val) => {
                    if (!val && val !== 0) return '';
                    if (typeof val === 'string' && /\d{4}-\d{2}-\d{2}T/.test(val)) return val;
                    return formatDateField(val);
                };
                const horaTardeDisplay = formatTimeForDisplay(h.horaLlegadaTarde || h.horallegadatarde || '');
                const horaRetiroDisplay = formatTimeForDisplay(h.horaRetiro || h.horaretiro || '');

                const linea1 = `${alumnoStr} <span style="color:var(--accent)">[${escapeHtml('CAMBIO ESTADO: ' + (accionStr || ''))}]</span>`;
                const linea2 = `Usuario: ${usuarioStr}`;
                const linea3 = [dniStr ? `DNI: ${dniStr}` : null, docenteHist ? `Docente: ${docenteHist}` : null].filter(Boolean).join(' · ');
                const linea4Parts = [];
                if (estadoHist) linea4Parts.push(`Estado: ${estadoHist}`);
                if (quienRetiraHist) linea4Parts.push(`QuienRetira: ${quienRetiraHist}`);
                if (horaRetiroDisplay) linea4Parts.push(`HoraRetiro: ${horaRetiroDisplay}`);
                linea4Parts.push(`queued: ${queuedHist}`);
                const linea4 = linea4Parts.join(' · ');

                item.innerHTML = `
                    <div>
                        <div style="font-size:14px">${linea1}</div>
                        <div style="font-size:12px; color:var(--muted); margin-top:6px">${linea2}</div>
                        <div style="font-size:12px; color:var(--muted)">${linea3}</div>
                        <div style="font-size:12px; color:var(--muted)">${linea4}</div>
                    </div>
                    <span style="font-size:12px; font-weight:700; color:var(--muted)">${fechaFormat}</span>
                `;
                container.appendChild(item);
            });
        }

        async function limpiarHistorialView() {
            const confirmar = await mostrarConfirmacion(
                "Limpiar Pantalla", 
                "¿Deseas ocultar temporalmente la vista de movimientos en la pantalla? Esto no altera la hoja de cálculo."
            );
            if (confirmar) {
                document.getElementById("historial").innerHTML = `
                    <div style="text-align: center; padding: 20px; color: var(--muted); font-size:13px;">
                        Vista limpia. Recarga los datos para volver a visualizarlos.
                    </div>
                `;
            }
        }

        function exportHistorialPDF() {
            const printWindow = window.open("", "_blank");
            let filas = "";

            historial.forEach(h => {
                const fecha = escapeHtml(formatDateField(h.fechahora || h.fecha || '')) || '-';
                const alumno = escapeHtml(h.alumno || h.nombre || '-');
                const accion = escapeHtml(h.accion || '-');
                const operador = escapeHtml(h.usuario || h.docente || '-');
                const tipoAccion = escapeHtml(h.tipoAccion || h.tipoaccion || '');
                const tipo = escapeHtml(h.tipo || '');
                const dni = escapeHtml(h.dni || '');
                const estado = escapeHtml(h.estado || '');
                const horaLlegada = escapeHtml(formatDateField(h.horaLlegadaTarde || h.horallegadatarde || ''));
                const quienRetira = escapeHtml(h.quienRetira || h.quienretira || '');
                const horaRetiro = escapeHtml(formatDateField(h.horaRetiro || h.horaretiro || ''));
                const queued = (h.queued === true || h.queued === '1' || h.queued === 1) ? 'Sí' : (h.queued ? escapeHtml(String(h.queued)) : 'No');

                filas += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${fecha}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">${alumno}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${accion}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${operador}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${tipoAccion}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${tipo}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${dni}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${estado}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${horaLlegada}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${quienRetira}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${horaRetiro}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${queued}</td>
                    </tr>
                `;
            });

            printWindow.document.write(`
                <html>
                <head>
                    <title>Reporte de Salidas - IPEM 146</title>
                    <style>
                        body { font-family: 'Plus Jakarta Sans', Arial, sans-serif; padding: 30px; color: #1e293b; }
                        h1 { color: #0284c7; font-size: 24px; margin-bottom: 5px; }
                        p { font-size: 14px; color: #64748b; margin-top: 0; margin-bottom: 30px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
                        th { background-color: #f1f5f9; text-align: left; padding: 12px 10px; font-weight: bold; border-bottom: 2px solid #cbd5e1; }
                    </style>
                </head>
                <body>
                    <h1>📄 REPORTE DE MOVIMIENTOS</h1>
                    <p>IPEM 146 "CENTENARIO" - Registro emitido el ${new Date().toLocaleDateString()} a las ${new Date().toLocaleTimeString()}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Fecha/Hora</th>
                                <th>Alumno</th>
                                <th>Acción</th>
                                <th>Operador</th>
                                <th>tipoAccion</th>
                                <th>tipo</th>
                                <th>DNI</th>
                                <th>Estado</th>
                                <th>HoraLlegadaTarde</th>
                                <th>QuienRetira</th>
                                <th>HoraRetiro</th>
                                <th>queued</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filas || '<tr><td colspan="12" style="text-align:center; padding: 20px;">Sin registros</td></tr>'}
                        </tbody>
                    </table>
                    <script>
                        window.onload = function() {
                            window.print();
                        }
                    <\/script>
                </body>
                </html>
            `);
            printWindow.document.close();
        }

        function toggleTheme() {
            const isLight = document.body.classList.toggle("light-mode");
            const btn = document.getElementById("themeToggle");
            
            if (isLight) {
                btn.innerText = "☀️";
                localStorage.setItem("theme", "light");
            } else {
                btn.innerText = "🌙";
                localStorage.setItem("theme", "dark");
            }
        }

        function toggleMostrarPin() {
            const input = document.getElementById("passDocente");
            const btn = document.querySelector(".pin-input-wrapper .btn-toggle-pin");
            
            if (input.type === "password") {
                input.type = "text";
                btn.innerText = "🙈";
            } else {
                input.type = "password";
                btn.innerText = "👁️";
            }
        }

        /* =========================================================
           POPUP LISTA AUSENTES / TARDE
        ========================================================= */
        function abrirPopupLista(tipo, lista) {
            let existente = document.getElementById('popup-lista-modal');
            if (existente) existente.remove();

            const esAusente  = tipo === 'ausente';
            const esSalida   = tipo === 'salida';
            const esTarde    = tipo === 'tarde';
            const esRetiro   = tipo === 'retiro';

            const titulo      = esAusente ? '❌ AUSENTES' : esSalida ? '🚪 AFUERA' : esRetiro ? '👪 RETIRADOS' : '⏰ LLEGADA TARDE';
            const colorTitulo = esAusente ? 'var(--red,#ef4444)' : esSalida ? 'var(--accent,#0284c7)' : esRetiro ? 'var(--retiro-color,#8b5cf6)' : 'var(--warning,#f59e0b)';

            // Opciones únicas para los filtros
            const optsUniq = (campo) => [...new Set(lista.map(a => String(a[campo] || '')).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
            const cursos       = optsUniq('curso');
            const divisiones   = optsUniq('division');
            const turnos       = optsUniq('turno');
            const especialidades = optsUniq('especialidad');

            const usuario = usuarioActivo ? (usuarioActivo.nombre || usuarioActivo.usuario || '') : '';

            function buildSelect(id, opts, placeholder) {
                const ops = opts.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
                return `<select class="pl-filtro-select" id="${id}"><option value="">${placeholder}</option>${ops}</select>`;
            }

            function renderFilas(listaFiltrada) {
                if (!listaFiltrada.length) return '<div class="pl-empty">Sin resultados para los filtros aplicados.</div>';
                return listaFiltrada.map((a, i) => {
                    const nombre = escapeHtml(a.nombre || '-');
                    const dni    = escapeHtml(cleanDni(a.dni) || '-');
                    const curso  = escapeHtml([a.curso, a.division].filter(Boolean).join(' ') || '-');
                    const turno  = escapeHtml(a.turno || '-');
                    const esp    = escapeHtml(a.especialidad || '');
                    const estado = escapeHtml(a.estado || '-');

                    let extras = '';
                    if (esAusente) {
                        const horaRetiroFmt = escapeHtml(formatHora(a.horaRetiro));
                        extras = `<div class="pl-fila-extra">
                            <span class="pl-tag pl-tag-rojo">Estado: ${estado}</span>
                            ${a.retiroPor ? `<span class="pl-tag pl-tag-gris">👤 Retiro: ${escapeHtml(a.retiroPor)}</span>` : ''}
                            ${horaRetiroFmt ? `<span class="pl-tag pl-tag-gris">🕒 ${horaRetiroFmt}</span>` : ''}
                        </div>`;
                    }
                    if (esTarde) {
                        const horaLlegadaFmt = escapeHtml(formatHora(a.horaLlegadaTarde));
                        extras = `<div class="pl-fila-extra">
                            ${horaLlegadaFmt ? `<span class="pl-tag pl-tag-naranja">⏰ Llegada: ${horaLlegadaFmt}</span>` : ''}
                            <span class="pl-tag pl-tag-gris">Estado: ${estado}</span>
                        </div>`;
                    }
                    if (esSalida) {
                        const causa    = escapeHtml(a._causa || 'Sin motivo');
                        const horaFmt  = escapeHtml(formatHora(a._horaSalida));
                        extras = `<div class="pl-fila-extra">
                            <span class="pl-tag pl-tag-azul">📍 ${causa}</span>
                            ${horaFmt ? `<span class="pl-tag pl-tag-gris">🕒 ${horaFmt}</span>` : ''}
                            ${(a.estado && /TARDE/i.test(a.estado)) ? `<span class="pl-tag pl-tag-naranja">⏰ Llegó tarde</span>` : ''}
                        </div>`;
                    }
                    if (esRetiro) {
                        const horaRetiroFmt = escapeHtml(formatHora(a.horaRetiro));
                        extras = `<div class="pl-fila-extra">
                            <span class="pl-tag pl-tag-retiro">👪 RETIRADO</span>
                            ${a.retiroPor ? `<span class="pl-tag pl-tag-gris">👤 ${escapeHtml(a.retiroPor)}</span>` : ''}
                            ${horaRetiroFmt ? `<span class="pl-tag pl-tag-gris">🕒 ${horaRetiroFmt}</span>` : ''}
                        </div>`;
                    }

                    return `<div class="pl-fila">
                        <div class="pl-num">${i + 1}</div>
                        <div class="pl-info">
                            <div class="pl-nombre">${nombre}</div>
                            <div class="pl-meta">
                                <span>DNI: ${dni}</span>
                                <span>${curso}</span>
                                <span>Turno: ${turno}</span>
                                ${esp ? `<span>${esp}</span>` : ''}
                            </div>
                            ${extras}
                        </div>
                    </div>`;
                }).join('');
            }

            const modal = document.createElement('div');
            modal.id = 'popup-lista-modal';
            modal.className = 'custom-modal';
            modal.style.cssText = 'display:flex; z-index:9999;';
            modal.innerHTML = `
                <div class="custom-modal-content pl-modal-content">

                    <!-- HEADER -->
                    <div class="pl-header">
                        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                            <span style="font-size:18px; font-weight:800; color:${colorTitulo};">${titulo}</span>
                            <span class="pl-count-badge" id="pl-count-visible" style="background:${colorTitulo};">${lista.length}</span>
                            ${usuario ? `<span class="pl-tag pl-tag-gris" style="font-size:11px;">👤 ${escapeHtml(usuario)}</span>` : ''}
                        </div>
                        <button onclick="cerrarPopupLista()" class="pl-close-btn" title="Cerrar">✕</button>
                    </div>

                    <!-- FILTROS -->
                    <div class="pl-filtros-bar">
                        ${cursos.length > 1       ? buildSelect('pl-f-curso',  cursos,       'Curso') : ''}
                        ${divisiones.length > 1   ? buildSelect('pl-f-div',    divisiones,   'División') : ''}
                        ${turnos.length > 1        ? buildSelect('pl-f-turno',  turnos,       'Turno') : ''}
                        ${especialidades.length > 1 ? buildSelect('pl-f-esp',  especialidades,'Especialidad') : ''}
                        <button class="pl-filtro-clear" id="pl-f-clear" style="display:none;" onclick="plLimpiarFiltros()">✕ Limpiar</button>
                    </div>

                    <!-- LISTA -->
                    <div class="pl-body">
                        <div class="pl-lista" id="pl-lista-body">
                            ${renderFilas(lista)}
                        </div>
                    </div>

                    <div class="pl-footer">
                        <span id="pl-footer-count" style="font-size:12px; color:var(--muted);">${lista.length} alumno${lista.length !== 1 ? 's' : ''}</span>
                        <button class="btn-mini azul" onclick="cerrarPopupLista()">Cerrar</button>
                    </div>
                </div>
            `;

            modal.addEventListener('click', (e) => {
                if (e.target === modal) cerrarPopupLista();
            });

            document.body.appendChild(modal);
            pauseAutoRefresh();

            // Attach filter listeners after DOM insert
            function plAplicarFiltros() {
                const vCurso = (document.getElementById('pl-f-curso')  || {}).value || '';
                const vDiv   = (document.getElementById('pl-f-div')    || {}).value || '';
                const vTurno = (document.getElementById('pl-f-turno')  || {}).value || '';
                const vEsp   = (document.getElementById('pl-f-esp')    || {}).value || '';
                const hayFiltro = vCurso || vDiv || vTurno || vEsp;

                const btnClear = document.getElementById('pl-f-clear');
                if (btnClear) btnClear.style.display = hayFiltro ? '' : 'none';

                const filtrada = lista.filter(a => {
                    if (vCurso && String(a.curso || '') !== vCurso) return false;
                    if (vDiv   && String(a.division || '') !== vDiv) return false;
                    if (vTurno && String(a.turno || '') !== vTurno) return false;
                    if (vEsp   && String(a.especialidad || '') !== vEsp) return false;
                    return true;
                });

                const body = document.getElementById('pl-lista-body');
                if (body) body.innerHTML = renderFilas(filtrada);

                const badge = document.getElementById('pl-count-visible');
                if (badge) badge.textContent = filtrada.length;

                const footer = document.getElementById('pl-footer-count');
                if (footer) footer.textContent = `${filtrada.length} alumno${filtrada.length !== 1 ? 's' : ''}${hayFiltro ? ' (filtrado)' : ''}`;
            }

            window.plLimpiarFiltros = function() {
                ['pl-f-curso','pl-f-div','pl-f-turno','pl-f-esp'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.value = '';
                });
                plAplicarFiltros();
            };

            ['pl-f-curso','pl-f-div','pl-f-turno','pl-f-esp'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.addEventListener('change', plAplicarFiltros);
            });
        }

        function cerrarPopupLista() {
            const modal = document.getElementById('popup-lista-modal');
            if (modal) modal.remove();
            resumeAutoRefresh();
        }
        /* =========================================================
           DIRECTIVO — ROL Y HELPERS
        ========================================================= */
        function esRolDirectivo(usuario) {
            if (!usuario) return false;
            const rol = String(usuario.rol || usuario.cargo || usuario.perfil || '').toUpperCase().trim();
            return rol === 'DIRECTIVO' || rol === 'DIRECTOR' || rol === 'DIRECTORA' ||
                   rol === 'VICE' || rol === 'VICEDIRECTOR' || rol === 'VICEDIRECTORA' ||
                   rol === 'ADMINISTRADOR' || rol === 'ADMIN';
        }

        /* =========================================================
           PANEL DE ALERTAS ACTIVAS
        ========================================================= */
        function actualizarAlertas() {
            const lista = document.getElementById('alertas-lista');
            const badge = document.getElementById('alertas-badge');
            if (!lista) return;

            const alertas = [];
            const ahora = new Date();

            alumnos.forEach(a => {
                const regSalida = obtenerRegistroSalida(a);

                // Alerta: tiempo de baño excedido (> 15 min)
                if (regSalida) {
                    const causa = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || '';
                    if (esSalidaConCronometro(causa)) {
                        const fechaSalida = parsearFechaGAS(detectarFechaSalida(regSalida));
                        const minutos = Math.floor((ahora - fechaSalida) / 60000);
                        if (minutos >= 15) {
                            alertas.push({
                                tipo: 'tiempo',
                                icono: '🚨',
                                colorClass: 'alerta-roja',
                                titulo: `Tiempo excedido — ${escapeHtml(a.nombre)}`,
                                detalle: `${escapeHtml([a.curso, a.division].filter(Boolean).join(' '))} · Lleva <strong>${minutos} min</strong> en baño`,
                                turno: a.turno || ''
                            });
                        } else if (minutos >= 12) {
                            alertas.push({
                                tipo: 'tiempo',
                                icono: '⚠️',
                                colorClass: 'alerta-naranja',
                                titulo: `Por exceder tiempo — ${escapeHtml(a.nombre)}`,
                                detalle: `${escapeHtml([a.curso, a.division].filter(Boolean).join(' '))} · Lleva <strong>${minutos} min</strong> en baño`,
                                turno: a.turno || ''
                            });
                        }
                    }
                }

                // Alerta: ausentes sin justificar
                if (String(a.estado || '').toUpperCase() === 'AUSENTE') {
                    alertas.push({
                        tipo: 'ausente',
                        icono: '❌',
                        colorClass: 'alerta-roja',
                        titulo: `Ausente — ${escapeHtml(a.nombre)}`,
                        detalle: `${escapeHtml([a.curso, a.division].filter(Boolean).join(' '))} · ${escapeHtml(a.turno || '')}`,
                        turno: a.turno || ''
                    });
                }

                // Alerta: alumnos afuera con salida autorizada (más de 30 min)
                if (regSalida) {
                    const causa = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || '';
                    if (/autorizada|enfermería|emergencia/i.test(causa)) {
                        const fechaSalida = parsearFechaGAS(detectarFechaSalida(regSalida));
                        const minutos = Math.floor((ahora - fechaSalida) / 60000);
                        if (minutos >= 30) {
                            alertas.push({
                                tipo: 'salida-larga',
                                icono: '📍',
                                colorClass: 'alerta-azul',
                                titulo: `Salida prolongada — ${escapeHtml(a.nombre)}`,
                                detalle: `${escapeHtml([a.curso, a.division].filter(Boolean).join(' '))} · <strong>${escapeHtml(causa)}</strong> hace ${minutos} min`,
                                turno: a.turno || ''
                            });
                        }
                    }
                }
            });

            if (badge) badge.textContent = alertas.length;
            if (badge) badge.style.background = alertas.length > 0 ? 'var(--red)' : 'var(--green)';

            if (alertas.length === 0) {
                lista.innerHTML = '<div class="alertas-empty">Sin alertas activas ✅</div>';
                return;
            }

            // Ordenar: rojas primero
            const orden = { 'alerta-roja': 0, 'alerta-naranja': 1, 'alerta-azul': 2 };
            alertas.sort((a, b) => (orden[a.colorClass] || 9) - (orden[b.colorClass] || 9));

            lista.innerHTML = alertas.map(al => `
                <div class="alerta-item ${al.colorClass}">
                    <span class="alerta-icono">${al.icono}</span>
                    <div class="alerta-info">
                        <div class="alerta-nombre">${al.titulo}</div>
                        <div class="alerta-detalle">${al.detalle}</div>
                    </div>
                    ${al.turno ? `<span class="alerta-turno">${escapeHtml(al.turno)}</span>` : ''}
                </div>
            `).join('');
        }

        /* =========================================================
           DASHBOARD GLOBAL POR CURSO
        ========================================================= */
        function actualizarFiltrosDashboard() {
            const turnos = [...new Set(alumnos.map(a => a.turno).filter(Boolean))].sort();
            const especialidades = [...new Set(alumnos.map(a => a.especialidad).filter(Boolean))].sort();

            const selTurno = document.getElementById('dashboard-filtro-turno');
            const selEsp = document.getElementById('dashboard-filtro-esp');
            if (!selTurno || !selEsp) return;

            const vt = selTurno.value;
            const ve = selEsp.value;

            selTurno.innerHTML = '<option value="">Todos los turnos</option>' +
                turnos.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
            selEsp.innerHTML = '<option value="">Todas las especialidades</option>' +
                especialidades.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');

            if (turnos.includes(vt)) selTurno.value = vt;
            if (especialidades.includes(ve)) selEsp.value = ve;
        }

        function actualizarDashboard() {
            const grid = document.getElementById('dashboard-grid');
            if (!grid) return;

            const filtroTurno = (document.getElementById('dashboard-filtro-turno') || {}).value || '';
            const filtroEsp   = (document.getElementById('dashboard-filtro-esp')   || {}).value || '';

            // Agrupar alumnos por curso+división
            const grupos = {};
            alumnos.forEach(a => {
                if (filtroTurno && a.turno !== filtroTurno) return;
                if (filtroEsp && a.especialidad !== filtroEsp) return;

                const key = `${a.curso || '?'}|${a.division || '?'}|${a.turno || ''}|${a.especialidad || ''}`;
                if (!grupos[key]) grupos[key] = { curso: a.curso, division: a.division, turno: a.turno, especialidad: a.especialidad, alumnos: [] };
                grupos[key].alumnos.push(a);
            });

            const keys = Object.keys(grupos).sort((a, b) => {
                const ga = grupos[a], gb = grupos[b];
                const t = String(ga.turno || '').localeCompare(String(gb.turno || ''), 'es');
                if (t !== 0) return t;
                const c = String(ga.curso || '').localeCompare(String(gb.curso || ''), 'es');
                if (c !== 0) return c;
                return String(ga.division || '').localeCompare(String(gb.division || ''), 'es');
            });

            if (keys.length === 0) {
                grid.innerHTML = '<div style="color:var(--muted); font-size:13px; padding:20px;">No hay cursos para mostrar con estos filtros.</div>';
                return;
            }

            grid.innerHTML = keys.map(key => {
                const g = grupos[key];
                const total    = g.alumnos.length;
                const ausentes = g.alumnos.filter(a => String(a.estado || '').toUpperCase() === 'AUSENTE').length;
                const afuera   = g.alumnos.filter(a => String(a.estado || '').toUpperCase() !== 'AUSENTE' && !!obtenerRegistroSalida(a)).length;
                const tarde    = g.alumnos.filter(a => /TARDE/i.test(String(a.estado || '')) && String(a.estado || '').toUpperCase() !== 'AUSENTE').length;
                const aula     = total - ausentes - afuera;
                const pctAula  = total > 0 ? Math.round((aula / total) * 100) : 0;

                // Barra de ocupación visual
                const pctAfuera  = total > 0 ? (afuera  / total) * 100 : 0;
                const pctAusente = total > 0 ? (ausentes / total) * 100 : 0;
                const pctAula2   = Math.max(0, 100 - pctAfuera - pctAusente);

                const labelCurso = [g.curso, g.division].filter(Boolean).join(' ');
                const subLabel   = [g.turno, g.especialidad].filter(Boolean).join(' · ');

                const alertaClase = ausentes > 0 || afuera > 2 ? 'dash-card-alerta' : '';

                return `<div class="dash-card ${alertaClase}">
                    <div class="dash-card-top">
                        <div>
                            <div class="dash-curso">${escapeHtml(labelCurso)}</div>
                            ${subLabel ? `<div class="dash-sub">${escapeHtml(subLabel)}</div>` : ''}
                        </div>
                        <div class="dash-total-badge">${total}</div>
                    </div>
                    <div class="dash-barra">
                        <div class="dash-barra-aula"   style="width:${pctAula2.toFixed(1)}%"   title="En aula"></div>
                        <div class="dash-barra-afuera" style="width:${pctAfuera.toFixed(1)}%"  title="Afuera"></div>
                        <div class="dash-barra-ausente" style="width:${pctAusente.toFixed(1)}%" title="Ausente"></div>
                    </div>
                    <div class="dash-stats">
                        <div class="dash-stat dash-stat-aula">
                            <strong>${aula}</strong><span>en aula</span>
                        </div>
                        <div class="dash-stat dash-stat-afuera">
                            <strong>${afuera}</strong><span>afuera</span>
                        </div>
                        <div class="dash-stat dash-stat-ausente">
                            <strong>${ausentes}</strong><span>ausentes</span>
                        </div>
                        ${tarde > 0 ? `<div class="dash-stat dash-stat-tarde"><strong>${tarde}</strong><span>tarde</span></div>` : ''}
                    </div>
                </div>`;
            }).join('');
        }

        // Hook en render() para actualizar dashboard y alertas si el directivo está logueado
        const _renderOriginal = render;
        render = function() {
            _renderOriginal();
            if (usuarioActivo && esRolDirectivo(usuarioActivo)) {
                actualizarDashboard();
                actualizarAlertas();
            }
        };
