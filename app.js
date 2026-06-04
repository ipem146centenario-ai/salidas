const URL =
  "https://script.google.com/macros/s/AKfycbyayX83bhc4VbTCDIsI79u_E-B7_XRdcXw4EBLjptPA3K1n8FqOokQKp0oOVDKKqahg/exec";

let alumnos = [];
let docentes = [];
let salidas = [];
let historial = [];

let usuarioActivo = null;
let timers = {};
let ultimoAudioPlay = 0; // Throttle para el sonido de alarma

/* =========================================================
           INIT
        ========================================================= */
window.addEventListener("load", () => {
  cargarDatos();
  if (localStorage.getItem("theme") === "light") {
    document.body.classList.add("light-mode");
    document.getElementById("themeToggle").innerText = "☀️";
  }
});

/* =========================================================
           DIALOGOS Y MODALES PERSONALIZADOS (100% CUMPLIENDO REGLAS)
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
  let s = String(val).trim().split(".")[0];
  return s.replace(/[^0-9a-zA-Z]/g, "");
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

  // 1. Prioridad: Columnas conocidas
  const exactKeys = [
    "salida",
    "fechahora",
    "fecha/hora",
    "timestamp",
    "inicio",
    "fecha",
  ];
  for (let k of exactKeys) {
    if (
      reg[k] !== undefined &&
      reg[k] !== null &&
      String(reg[k]).trim() !== ""
    ) {
      const valStr = String(reg[k]).trim();
      if (valStr.includes(":") || valStr.includes("T")) {
        return reg[k];
      }
    }
  }

  // 2. Coincidencia por contenido: Buscar celdas con barras/guiones y horas (:)
  for (let key in reg) {
    const val = String(reg[key]).trim();
    const hasDate = val.includes("/") || val.includes("-");
    const hasTime = val.includes(":");
    if (hasDate && hasTime) {
      return reg[key];
    }
  }

  // 3. Fallback: Buscar palabras de fechas
  for (let key in reg) {
    const keyLower = key.toLowerCase();
    if (
      keyLower.includes("fecha") ||
      keyLower.includes("salida") ||
      keyLower.includes("hora")
    ) {
      if (reg[key]) return reg[key];
    }
  }
  return "";
}

async function cargarDatos() {
  mostrarLoader(true, "Conectando con Google Sheets...");
  document.getElementById("cors-helper-panel").style.display = "none";

  try {
    const response = await fetch(URL + "?_ts=" + Date.now(), {
      method: "GET",
      mode: "cors",
      redirect: "follow",
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP status ${response.status}`);
    }

    const data = await response.json();
    console.log("Datos recibidos de la API:", data);

    if (!data.ok) {
      throw new Error(data.error || "Respuesta incorrecta de Google Sheets");
    }

    alumnos = data.alumnos || [];
    docentes = data.docentes || [];
    salidas = data.salidas || [];
    historial = data.historial || [];

    actualizarFiltros();
    actualizarSelectorDocentes();
    render();
    renderHistorial();

    showToast("Datos Sincronizados.");
  } catch (error) {
    console.error("Error al cargar datos:", error);
    document.getElementById("cors-helper-panel").style.display = "block";
    showToast(
      "Error de conexión. Revisa las instrucciones en pantalla.",
      "error",
    );
  } finally {
    mostrarLoader(false);
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

  docentes.forEach((d) => {
    const nombreDocente = d.nombre || d.usuario || "Sin Nombre";
    const opt = document.createElement("option");
    opt.value = nombreDocente;
    opt.textContent = nombreDocente;
    select.appendChild(opt);
  });
}

function actualizarFiltros() {
  const cursos = [
    ...new Set(alumnos.map((a) => a.curso).filter(Boolean)),
  ].sort();
  const divisiones = [
    ...new Set(alumnos.map((a) => a.division).filter(Boolean)),
  ].sort();
  const turnos = [
    ...new Set(alumnos.map((a) => a.turno).filter(Boolean)),
  ].sort();
  const especialidades = [
    ...new Set(alumnos.map((a) => a.especialidad).filter(Boolean)),
  ].sort();

  cargarOpcionesFiltro("fCurso", cursos, "Todos los Cursos");
  cargarOpcionesFiltro("fDivision", divisiones, "Todas las Divisiones");
  cargarOpcionesFiltro("fTurno", turnos, "Todos los Turnos");
  cargarOpcionesFiltro(
    "fEspecialidad",
    especialidades,
    "Todas las Especialidades",
  );
}

function cargarOpcionesFiltro(id, lista, porDefecto) {
  const select = document.getElementById(id);
  const valAnterior = select.value;
  select.innerHTML = `<option value="">-- ${porDefecto} --</option>`;
  lista.forEach((item) => {
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

  const docenteEncontrado = docentes.find((d) => {
    const nombreDoc = d.nombre || d.usuario || "";
    return nombreDoc.toLowerCase() === nombreSel.toLowerCase();
  });

  if (docenteEncontrado) {
    const pinCorrecto = String(
      docenteEncontrado.pin || docenteEncontrado.clave || "",
    ).trim();

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

  Object.keys(timers).forEach((k) => clearInterval(timers[k]));
  timers = {};

  render();
  showToast("Sesión cerrada.");
}

function parsearFechaGAS(strFecha) {
  if (!strFecha) return new Date();
  if (strFecha instanceof Date) return strFecha;
  if (typeof strFecha === "number") return new Date(strFecha);

  const str = String(strFecha).trim();

  // Patrón estrictamente latino dd/MM/yyyy HH:mm:ss o con guiones
  const regexDmy =
    /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/;
  const match = str.match(regexDmy);
  if (match) {
    const dia = parseInt(match[1], 10);
    const mes = parseInt(match[2], 10) - 1; // Enero es 0
    const anio = parseInt(match[3], 10);
    const hora = parseInt(match[4], 10);
    const min = parseInt(match[5], 10);
    const seg = match[6] ? parseInt(match[6], 10) : 0;
    return new Date(anio, mes, dia, hora, min, seg);
  }

  // Fallback para fechas estandarizadas ISO
  const parsed = new Date(strFecha);
  if (!isNaN(parsed.getTime())) return parsed;

  return new Date();
}

function reproducirAlarmaOscilador() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    const playBeep = (delay, frequency, duration) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.value = frequency;

      gainNode.gain.setValueAtTime(0, audioCtx.currentTime + delay);
      gainNode.gain.linearRampToValueAtTime(
        0.5,
        audioCtx.currentTime + delay + 0.05,
      );
      gainNode.gain.linearRampToValueAtTime(
        0.5,
        audioCtx.currentTime + delay + duration - 0.05,
      );
      gainNode.gain.linearRampToValueAtTime(
        0,
        audioCtx.currentTime + delay + duration,
      );

      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);

      osc.start(audioCtx.currentTime + delay);
      osc.stop(audioCtx.currentTime + delay + duration);
    };

    // Patrón de doble sonido continuo escolar
    playBeep(0.0, 1000, 0.25);
    playBeep(0.35, 1000, 0.25);
    playBeep(0.7, 800, 0.5);
  } catch (e) {
    console.error("Error al sintetizar alarma:", e);
  }
}

function render() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  if (!usuarioActivo) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--muted);">
                    Por favor, inicia sesión para gestionar las salidas de los alumnos.
                </div>`;
    return;
  }

  const fCurso = document.getElementById("fCurso").value;
  const fDivision = document.getElementById("fDivision").value;
  const fTurno = document.getElementById("fTurno").value;
  const fEsp = document.getElementById("fEspecialidad").value;
  const busqueda = document
    .getElementById("buscador")
    .value.toLowerCase()
    .trim();

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
      const nombreMatch = String(a.nombre || "")
        .toLowerCase()
        .includes(busqueda);
      const dniMatch = cleanDni(a.dni).includes(cleanDni(busqueda));
      if (!nombreMatch && !dniMatch) return;
    }

    totalInscriptos++;

    const regSalida = salidas.find((s) => {
      const rowDni = s.dni || s.DNI || s["dni"] || "";
      const rowRegreso = obtenerPropiedadSalida(s, [
        "regreso",
        "retorno",
        "fin",
      ]);
      const rowEstado = obtenerPropiedadSalida(s, ["estado", "status"]);
      return (
        cleanDni(rowDni) === cleanDni(a.dni) &&
        (!rowRegreso ||
          rowRegreso === "" ||
          String(rowEstado).toUpperCase() === "AFUERA")
      );
    });

    const div = document.createElement("div");
    div.id = `alumno-${cleanDni(a.dni)}`;

    let estadoClase = "in";
    let textoEstado = "🟢 EN AULA";

    if (a.estado === "AUSENTE") {
      estadoClase = "ausente";
      textoEstado = "❌ AUSENTE";
      totalAusentes++;
    } else if (a.estado === "TARDE") {
      estadoClase = "ausente";
      textoEstado = "⏰ LLEGÓ TARDE";
      totalAusentes++;
    } else if (a.estado === "RETIRO") {
      estadoClase = "retiro";
      textoEstado = "👨‍👩‍👦 RETIRADO";
      totalAusentes++;
    } else if (regSalida) {
      estadoClase = "out";
      const causaDestino =
        obtenerPropiedadSalida(regSalida, [
          "causa",
          "destino",
          "motivo",
          "lugar",
        ]) || "Salida";
      textoEstado = `🚪 AFUERA (${causaDestino})`;
      totalAfuera++;
    } else {
      totalAula++;
    }

    div.className = `alumno ${estadoClase}`;

    let html = `
                    <div>
                        <span class="nombre">${a.nombre}</span>
                        <div class="curso-info">Curso: ${a.curso || "-"} ${a.division || ""} | DNI: ${a.dni}</div>
                `;

    if (a.estado === "AUSENTE" || a.estado === "TARDE") {
      html += `<div class="label-ausente">${textoEstado}</div>`;
    } else if (a.estado === "RETIRO") {
      html += `<div class="estado-retiro">${textoEstado}</div>`;
    } else if (regSalida) {
      html += `
                        <div class="motivo-destacado">${textoEstado}</div>
                        <div class="timer-box" id="timer-${cleanDni(a.dni)}">🕒 Calculando...</div>
                        <button class="btn-card regreso" onclick="registrarRegreso('${a.dni}')">
                            REGISTRAR REGRESO
                        </button>
                    `;
    } else {
      html += `
                        <div class="estado-aula">${textoEstado}</div>
                        <button class="btn-card" onclick="registrarSalida('${a.dni}')">
                            REGISTRAR SALIDA
                        </button>
                    `;
    }

    const esPreceptor =
      String(usuarioActivo.rol || usuarioActivo.cargo || "").toUpperCase() ===
        "PRECEPTOR" || true;
    if (
      esPreceptor &&
      a.estado !== "AUSENTE" &&
      a.estado !== "RETIRO" &&
      !regSalida
    ) {
      html += `
                        <div class="acciones-preceptor">
                            <button class="btn-mini rojo" onclick="cambiarEstadoPreceptor('${a.dni}', 'AUSENTE')">AUSENTE</button>
                            <button class="btn-mini naranja" onclick="cambiarEstadoPreceptor('${a.dni}', 'LLEGADA TARDE')">TARDE</button>
                            <button class="btn-mini azul" onclick="cambiarEstadoPreceptor('${a.dni}', 'RETIRO PADRE/TUTOR')">RETIRO</button>
                        </div>
                    `;
    } else if (
      esPreceptor &&
      (a.estado === "AUSENTE" || a.estado === "TARDE" || a.estado === "RETIRO")
    ) {
      html += `
                        <div class="acciones-preceptor">
                            <button class="btn-mini azul" onclick="cambiarEstadoPreceptor('${a.dni}', 'PRESENTE')" style="width:100%">REINCORPORAR (PRESENTE)</button>
                        </div>
                    `;
    }

    html += `</div>`;
    div.innerHTML = html;
    grid.appendChild(div);

    if (regSalida) {
      const timestampSalida = detectarFechaSalida(regSalida);
      iniciarCronometro(cleanDni(a.dni), timestampSalida);
    }
  });

  document.getElementById("total-alumnos").textContent = totalInscriptos;
  document.getElementById("en-aula").textContent = totalAula;
  document.getElementById("afuera").textContent = totalAfuera;
  document.getElementById("ausentes").textContent = totalAusentes;
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

    const textoTiempo = `${minutos.toString().padStart(2, "0")}:${segundos.toString().padStart(2, "0")}`;
    timerEl.textContent = `🕒 ${textoTiempo}`;

    // Acción y Alarma a los 15 minutos (900 segundos)
    if (minutos >= 15) {
      cardEl.classList.add("tiempo-agotado-bg");
      timerEl.classList.remove("tiempo-critico");
      timerEl.textContent = `🚨 EXCEDIDO: ${textoTiempo}`;

      const ahora = Date.now();
      if (ahora - ultimoAudioPlay > 12000) {
        // Sonar cada 12 segundos
        ultimoAudioPlay = ahora;

        // 1. Alarma nativa hardware (Infallible)
        reproducirAlarmaOscilador();

        // 2. Alarma audio fallback
        document
          .getElementById("alertSound")
          .play()
          .catch(() => {});
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
      "Content-Type": "text/plain;charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return await response.json();
}

async function registrarSalida(dni) {
  const alumno = alumnos.find((a) => cleanDni(a.dni) === cleanDni(dni));
  if (!alumno) return;

  const causaPorDefecto = document.getElementById("causa").value || "Baño";
  const causa = prompt(
    `Indique destino para ${alumno.nombre}:`,
    causaPorDefecto,
  );
  if (causa === null) return;

  mostrarLoader(true, "Registrando salida en la nube...");
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
      causa: causa || causaPorDefecto,
    });

    if (!result.ok) throw new Error(result.error);

    showToast(`Salida registrada correctamente para ${alumno.nombre}.`);
    await cargarDatos();
  } catch (error) {
    console.error(error);
    showToast("Error al registrar salida: " + error.message, "error");
    mostrarLoader(false);
  }
}

async function registrarRegreso(dni) {
  const alumno = alumnos.find((a) => cleanDni(a.dni) === cleanDni(dni));
  if (!alumno) return;

  const dniLimpio = cleanDni(dni);
  if (timers[dniLimpio]) {
    clearInterval(timers[dniLimpio]);
    delete timers[dniLimpio];
  }

  mostrarLoader(true, "Registrando regreso en la nube...");
  try {
    const result = await enviarTransaccionPost({
      tipoAccion: "movimiento",
      tipo: "regreso",
      dni: dniLimpio,
      nombre: alumno.nombre,
      docente: usuarioActivo.nombre || usuarioActivo.usuario,
    });

    if (!result.ok) throw new Error(result.error);

    showToast(`Regreso de ${alumno.nombre} registrado con éxito.`);
    await cargarDatos();
  } catch (error) {
    console.error(error);
    showToast("Error al registrar regreso: " + error.message, "error");
    mostrarLoader(false);
  }
}

async function cambiarEstadoPreceptor(dni, accion) {
  const alumno = alumnos.find((a) => cleanDni(a.dni) === cleanDni(dni));
  if (!alumno) return;

  const confirmar = await mostrarConfirmacion(
    "Actualizar Asistencia",
    `¿Estás seguro de registrar a ${alumno.nombre} como "${accion}"?`,
  );
  if (!confirmar) return;

  mostrarLoader(true, "Actualizando asistencia...");
  try {
    const result = await enviarTransaccionPost({
      tipoAccion: "preceptor",
      accion: accion,
      dni: cleanDni(alumno.dni),
      nombre: alumno.nombre,
      docente: usuarioActivo.nombre || usuarioActivo.usuario,
    });

    if (!result.ok) throw new Error(result.error);

    showToast(`Estado de ${alumno.nombre} actualizado a ${accion}.`);
    await cargarDatos();
  } catch (error) {
    console.error(error);
    showToast("Error al actualizar estado: " + error.message, "error");
    mostrarLoader(false);
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

  listadoAMostrar.forEach((h) => {
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
    "¿Deseas ocultar temporalmente la vista de movimientos en la pantalla? Esto no altera la hoja de cálculo.",
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
  historial.forEach((h) => {
    filas += `
                    <tr>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${h.fechahora || h.fecha || "-"}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd; font-weight: bold;">${h.alumno || h.nombre || "-"}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${h.accion || "-"}</td>
                        <td style="padding: 10px; border-bottom: 1px solid #ddd;">${h.usuario || h.docente || "-"}</td>
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
