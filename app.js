
        const URL = "https://script.google.com/macros/s/AKfycbyayX83bhc4VbTCDIsI79u_E-B7_XRdcXw4EBLjptPA3K1n8FqOokQKp0oOVDKKqahg/exec";

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
            for (let nombre of posiblesNombres) {
                const normalized = nombre.toLowerCase().trim();
                if (reg[normalized] !== undefined && reg[normalized] !== null) {
                    return reg[normalized];
                }
            }
            for (let key in reg) {
                const keyLower = key.toLowerCase().trim();
                for (let nombre of posiblesNombres) {
                    if (keyLower.includes(nombre.toLowerCase().trim())) {
                        return reg[key];
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
            document.getElementById("cors-helper-panel").style.display = "none";
            
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
                alumnos = rawAlumnos.map(a => ({
                    dni: obtenerPropiedadAlumno(a, ['dni']),
                    nombre: obtenerPropiedadAlumno(a, ['nombre', 'nombre y apellido', 'estudiante']),
                    curso: obtenerPropiedadAlumno(a, ['curso', 'año', 'ano']),
                    division: obtenerPropiedadAlumno(a, ['division', 'división', 'div']),
                    turno: obtenerPropiedadAlumno(a, ['turno']),
                    especialidad: obtenerPropiedadAlumno(a, ['especialidad', 'orientacion', 'orientación']),
                    estado: obtenerPropiedadAlumno(a, ['estado', 'asistencia'])
                }));

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
                document.getElementById("cors-helper-panel").style.display = "block";
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
                    
                    const rolBox = document.getElementById("rolActivo");
                    rolBox.textContent = `👤 ${nombreSel}`;
                    rolBox.style.display = "block";
                    
                    document.getElementById("logoutBtn").style.display = "block";
                    passInput.value = "";
                    render();
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
            document.getElementById("rolActivo").style.display = "none";
            document.getElementById("logoutBtn").style.display = "none";
            
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
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                if (audioCtx.state === 'suspended') {
                    audioCtx.resume();
                }
                
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
            const esTarde = String(a.estado || "").toUpperCase() === "TARDE";
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
                    ${esTarde ? `<div class="badge-tarde">⏰ TARDE${a.horaLlegadaTarde ? ` - ${a.horaLlegadaTarde}` : ''}</div>` : ''}
                    <span class="nombre">${a.nombre}</span>
                    <div class="curso-info">Curso: ${a.curso || '-'} ${a.division || ''} | DNI: ${a.dni}</div>
            `;

            // Mostrar estado
            if (esAusente) {
                html += `<div class="label-ausente">${textoEstado}</div>`;
            } else if (esRetiro) {
                html += `<div class="estado-retiro">${textoEstado}</div>`;
            } else if (esTarde && !regSalida) {
                html += `<div class="label-tarde">${textoEstado}</div>`;
                if (a.horaLlegadaTarde) {
                    html += `<div class="hora-llegada-tarde">🕐 Llegó a las ${a.horaLlegadaTarde}</div>`;
                }
            } else if (regSalida) {
                const causaDestino = obtenerPropiedadSalida(regSalida, ['causa', 'destino', 'motivo', 'lugar']) || "Salida";
                const mostrarTimer = esSalidaConCronometro(causaDestino);
                const badgeTipo = mostrarTimer ? 'timed' : 'not-timed';
                const badgeTexto = mostrarTimer ? 'Cronómetro activo' : 'Salida sin cronómetro';

                html += `<div class="motivo-destacado">${textoEstado}</div>`;
                html += `<div class="causa-badge ${badgeTipo}">${badgeTexto}</div>`;
                if (mostrarTimer) {
                    html += `
                        <div class="timer-box" id="timer-${cleanDni(a.dni)}">🕒 Calculando...</div>
                    `;
                } else {
                    html += `<div class="timer-note">Recreos y otras salidas no se cronometran en este panel; registra el regreso normalmente.</div>`;
                }
            } else {
                html += `
                    <div class="estado-aula">${textoEstado}</div>
                `;
            }

            // Mostrar botones de acción (salida/regreso para todos excepto AUSENTE y RETIRO)
            if (regSalida) {
                html += `
                    <button class="btn-card regreso" onclick="registrarRegreso('${a.dni}')">
                        REGISTRAR REGRESO
                    </button>
                `;
            } else if (!esAusente && !esRetiro) {
                html += `
                    <button class="btn-card" onclick="registrarSalida('${a.dni}')">
                        REGISTRAR SALIDA
                    </button>
                `;
            }

            // Opciones de preceptor
            const esPreceptor = String(usuarioActivo.rol || usuarioActivo.cargo || "").toUpperCase() === "PRECEPTOR" || true;
            if (esPreceptor && !esAusente && !esRetiro && !regSalida) {
                html += `
                    <div class="acciones-preceptor">
                        <button class="btn-mini rojo" onclick="cambiarEstadoPreceptor('${a.dni}', 'AUSENTE')">AUSENTE</button>
                        <button class="btn-mini naranja" onclick="cambiarEstadoPreceptor('${a.dni}', 'LLEGADA TARDE')">TARDE</button>
                        <button class="btn-mini azul" onclick="cambiarEstadoPreceptor('${a.dni}', 'RETIRO PADRE/TUTOR')">RETIRO</button>
                    </div>
                `;
                if (esTarde) {
                    html += `
                        <div class="acciones-preceptor" style="margin-top: 10px;">
                            <button class="btn-mini azul" onclick="cambiarEstadoPreceptor('${a.dni}', 'PRESENTE')" style="width:100%">REINCORPORAR (PRESENTE)</button>
                        </div>
                    `;
                }
            } else if (esPreceptor && (esAusente || esRetiro)) {
                html += `
                    <div class="acciones-preceptor">
                        <button class="btn-mini azul" onclick="cambiarEstadoPreceptor('${a.dni}', 'PRESENTE')" style="width:100%">REINCORPORAR (PRESENTE)</button>
                    </div>
                `;
            }

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
            const response = await fetch(URL, {
                method: "POST",
                mode: "cors",
                redirect: "follow",
                headers: {
                    "Content-Type": "text/plain;charset=utf-8"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            return await response.json();
        }

        async function registrarSalida(dni) {
            const alumno = alumnos.find(a => cleanDni(a.dni) === cleanDni(dni));
            if (!alumno) return;

            const causaPorDefecto = document.getElementById("causa").value || "Baño";
            const causa = prompt(`Indique destino para ${alumno.nombre}:`, causaPorDefecto);
            if (causa === null) return; 

            mostrarIndicadorActualizacion(true);
            try {
                const motivoSalida = obtenerCausaSalida();
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
                
                if (accion === "LLEGADA TARDE") {
                    payload.horaLlegadaTarde = horaFormato;
                }
                
                const result = await enviarTransaccionPost(payload);

                if (!result.ok) throw new Error(result.error);

                if (accion === "AUSENTE") {
                    alumno.estado = "AUSENTE";
                } else if (accion === "LLEGADA TARDE") {
                    alumno.estado = "TARDE";
                    alumno.horaLlegadaTarde = horaFormato;
                } else if (accion === "RETIRO PADRE/TUTOR") {
                    alumno.estado = "RETIRO";
                } else if (accion === "PRESENTE") {
                    alumno.estado = "";
                    alumno.horaLlegadaTarde = "";
                }
                ultimoHashDatos = null;

                showToast(`Estado de ${alumno.nombre} actualizado a ${accion}.`);
                actualizarTarjetaAlumno(alumno);
                actualizarContadores();
                mostrarIndicadorActualizacion(false);
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
                
                const fechaFormat = h.fechahora || h.fecha || "00/00/0000 00:00";
                const alumnoStr = h.alumno || h.nombre || "Alumno";
                const accionStr = h.accion || "Cambio";
                const usuarioStr = h.usuario || h.docente || "Preceptor";

                item.innerHTML = `
                    <div>
                        <strong>${alumnoStr}</strong> <span style="color:var(--accent)">[${accionStr}]</span>
                        <div style="font-size:11px; color:var(--muted)">Usuario: ${usuarioStr}</div>
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
                filas += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${h.fechahora || h.fecha || '-'}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">${h.alumno || h.nombre || '-'}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${h.accion || '-'}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${h.usuario || h.docente || '-'}</td>
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
                            </tr>
                        </thead>
                        <tbody>
                            ${filas || '<tr><td colspan="4" style="text-align:center; padding: 20px;">Sin registros</td></tr>'}
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
  
