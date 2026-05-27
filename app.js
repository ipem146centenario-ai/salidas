/* =========================================================
   APP.JS COMPLETO CORREGIDO (CON ACCESO, FILTROS Y TIMERS)
========================================================= */

const URL =
"https://script.google.com/macros/s/AKfycbyYcYF196pO6ytMWtKGGRgJodyZ6rYcBGPwfEEGfHf_zBfLwHvglf2tZhgXMd1lK3c/exec";

/* =========================================================
   VARIABLES GLOBALES
========================================================= */

let alumnos = [];
let docentes = [];
let salidas = [];
let historial = [];

let usuarioActivo = null; // Almacenará al usuario logueado

let timers = {};

let procesando = false;

/* =========================================================
   INIT / DISPARADOR INICIAL
========================================================= */

window.addEventListener("load", () => {
  mostrarLoader(false);
  cargarDatos();
});

/* =========================================================
   CARGAR DATOS DESDE GOOGLE APPS SCRIPT
========================================================= */

async function cargarDatos() {
  mostrarLoader(true);
  try {
    const response = await fetch(URL);

    if (!response.ok) {
      throw new Error("Error conexión de red");
    }

    const data = await response.json();
    console.log("Datos recibidos:", data);

    if (!data.ok) {
      throw new Error(data.error);
    }

    alumnos = data.alumnos || [];
    docentes = data.docentes || [];
    salidas = data.salidas || [];
    historial = data.historial || [];

    // Inicializaciones aditivas de interfaz
    poblarSelectDocentes();
    poblarFiltros();
    actualizarContadores();
    
    // Evalúa si se mantiene bloqueado o despliega la grilla de alumnos
    evaluarEstadoPantalla();

  } catch (error) {
    console.error("Error en cargarDatos:", error);
    alert("ERROR DE RED: " + error.message + "\n\nVerifique que la Web App en Google Script esté publicada con acceso para 'Cualquiera' (Anyone).");
  } finally {
    mostrarLoader(false);
  }
}

/* =========================================================
   SISTEMA DE CONTROL DE ACCESO (LOGIN Y CAPTURA)
========================================================= */

function poblarSelectDocentes() {
  const select = document.getElementById("docentes");
  if (!select) return;
  
  select.innerHTML = '<option value="">Seleccione Usuario...</option>';
  
  docentes.forEach(d => {
    const nombreDocente = d.nombre || d.usuario || d.docente;
    if (nombreDocente) {
      const opt = document.createElement("option");
      opt.value = String(nombreDocente).trim();
      opt.textContent = String(nombreDocente).trim();
      select.appendChild(opt);
    }
  });
}

function verificarAcceso() {
  const select = document.getElementById("docentes");
  const inputPass = document.getElementById("passDocente");

  if (!select || !inputPass) return;

  const usuarioSel = select.value;
  const pinIngresado = inputPass.value.trim();

  if (!usuarioSel || !pinIngresado) {
    alert("Por favor, seleccione su usuario e ingrese el PIN.");
    inputPass.classList.add("shake");
    setTimeout(() => inputPass.classList.remove("shake"), 400);
    return;
  }

  // Validación cruzada contra la hoja DOCENTES
  const docente = docentes.find(d => (d.nombre === usuarioSel || d.usuario === usuarioSel));
  const pinCorrecto = docente ? String(docente.pin || docente.password || '').trim() : '';

  if (docente && pinCorrecto === pinIngresado) {
    usuarioActivo = docente;
    
    evaluarEstadoPantalla();
    
    const rBox = document.getElementById("rolActivo");
    if (rBox) {
      rBox.textContent = `👤 ${usuarioActivo.nombre} (${String(usuarioActivo.rol || 'Preceptor').toUpperCase()})`;
    }
  } else {
    alert("PIN de acceso incorrecto.");
    inputPass.value = "";
    inputPass.classList.add("shake");
    setTimeout(() => inputPass.classList.remove("shake"), 400);
  }
}

function evaluarEstadoPantalla() {
  const panelLogin = document.querySelector(".grupo-sesion");
  const seccionFiltros = document.getElementById("seccion-filtros");
  const contadorContainer = document.getElementById("contador-container");
  const buscadorBox = document.getElementById("buscador-box");
  const logoutBtn = document.getElementById("logoutBtn");
  const changePassBtn = document.getElementById("changePassBtn");
  const grid = document.getElementById("grid");

  if (!usuarioActivo) {
    // Si no hay sesión, se oculta todo el panel operativo por seguridad
    if (panelLogin) panelLogin.style.display = "block";
    if (seccionFiltros) seccionFiltros.style.display = "none";
    if (contadorContainer) contadorContainer.style.display = "none";
    if (buscadorBox) buscadorBox.style.display = "none";
    if (logoutBtn) logoutBtn.style.display = "none";
    if (changePassBtn) changePassBtn.style.display = "none";
    if (grid) grid.innerHTML = `<div style="text-align:center; width:100%; color:var(--muted); padding:40px; font-weight:700;">Debe seleccionar usuario e ingresar su PIN para acceder al control de alumnos.</div>`;
  } else {
    // Si hay sesión activa, habilitamos el software de gestión
    if (panelLogin) panelLogin.style.display = "none";
    if (seccionFiltros) seccionFiltros.style.display = "block";
    if (contadorContainer) contadorContainer.style.display = "block";
    if (buscadorBox) buscadorBox.style.display = "block";
    if (logoutBtn) logoutBtn.style.display = "block";
    if (changePassBtn) changePassBtn.style.display = "block";
    
    render();
    renderHistorial();
  }
}

function cerrarSesion() {
  usuarioActivo = null;
  const inputPass = document.getElementById("passDocente");
  if (inputPass) inputPass.value = "";
  const selectDoc = document.getElementById("docentes");
  if (selectDoc) selectDoc.value = "";
  
  const rBox = document.getElementById("rolActivo");
  if (rBox) rBox.textContent = "";

  evaluarEstadoPantalla();
}

/* =========================================================
   POBLAR FILTROS DINÁMICOS EN CASCADA
========================================================= */

function poblarFiltros() {
  const fCurso = document.getElementById("fCurso");
  const fDivision = document.getElementById("fDivision");
  const fTurno = document.getElementById("fTurno");
  const fEspecialidad = document.getElementById("fEspecialidad");

  if (!fCurso || !fDivision || !fTurno || !fEspecialidad) return;

  const cursos = ["-- CURSO --", ...new Set(alumnos.map(a => a.curso).filter(Boolean))];
  const divisiones = ["-- DIVISIÓN --", ...new Set(alumnos.map(a => a.division || a.div).filter(Boolean))];
  const turnos = ["-- TURNO --", ...new Set(alumnos.map(a => a.turno).filter(Boolean))];
  const especialidades = ["-- ESPECIALIDAD --", ...new Set(alumnos.map(a => a.especialidad || a.esp).filter(Boolean))];

  llenarSelectOptions(fCurso, cursos);
  llenarSelectOptions(fDivision, divisiones);
  llenarSelectOptions(fTurno, turnos);
  llenarSelectOptions(fEspecialidad, especialidades);

  [fCurso, fDivision, fTurno, fEspecialidad].forEach(elem => {
    elem.removeEventListener("change", render);
    elem.addEventListener("change", render);
  });
}

function llenarSelectOptions(elemento, lista) {
  elemento.innerHTML = "";
  lista.forEach(val => {
    const opt = document.createElement("option");
    opt.value = val.includes("--") ? "" : val;
    opt.textContent = val;
    elemento.appendChild(opt);
  });
}

/* =========================================================
   ACTUALIZAR CONTADORES ESTADÍSTICOS
========================================================= */

function actualizarContadores() {
  const total = alumnos.length;
  const ausentes = alumnos.filter(a => String(a.estado).toUpperCase() === "AUSENTE").length;
  const afuera = salidas.length;
  const enAula = total - ausentes - afuera;

  const eTotal = document.getElementById("total-alumnos");
  const eAula = document.getElementById("en-aula");
  const eAfuera = document.getElementById("afuera");
  const eAusente = document.getElementById("ausentes");

  if (eTotal) eTotal.textContent = total;
  if (eAula) eAula.textContent = enAula < 0 ? 0 : enAula;
  if (eAfuera) eAfuera.textContent = afuera;
  if (eAusente) eAusente.textContent = ausentes;
}

/* =========================================================
   RENDER DE TARJETAS (GRIDS Y ESTADOS FILTRADOS)
========================================================= */

function render() {
  const grid = document.getElementById("grid");
  if (!grid) return;
  grid.innerHTML = "";

  // Retorno seguro si no hay login
  if (!usuarioActivo) return;

  const busqueda = document.getElementById("buscador")?.value.toLowerCase() || "";
  const cursoSel = document.getElementById("fCurso")?.value || "";
  const divSel = document.getElementById("fDivision")?.value || "";
  const turnoSel = document.getElementById("fTurno")?.value || "";
  const espSel = document.getElementById("fEspecialidad")?.value || "";

  // Filtrado paramétrico simultáneo
  const alumnosFiltrados = alumnos.filter(a => {
    const nomA = String(a.nombre || '').toLowerCase();
    const dniA = String(a.dni || '');
    const curA = String(a.curso || '');
    const divA = String(a.division || a.div || '');
    const turA = String(a.turno || '');
    const espA = String(a.especialidad || a.esp || '');

    const cumpleBuscador = nomA.includes(busqueda) || dniA.includes(busqueda);
    const cumpleCurso = !cursoSel || curA === cursoSel;
    const cumpleDiv = !divSel || divA === divSel;
    const cumpleTurno = !turnoSel || turA === turnoSel;
    const cumpleEsp = !espSel || espA === espSel;

    return cumpleBuscador && cumpleCurso && cumpleDiv && cumpleTurno && cumpleEsp;
  });

  if (alumnosFiltrados.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--muted); padding: 20px; font-weight:700;">No hay alumnos matriculados que coincidan con la selección actual.</div>`;
    return;
  }

  alumnosFiltrados.forEach((a) => {
    const reg = salidas.find((s) => {
      return (
        String(s.dni).trim() === String(a.dni).trim() &&
        (
          !s.regreso ||
          s.regreso === "" ||
          String(s.estado).toUpperCase() === "AFUERA"
        )
      );
    });

    const div = document.createElement("div");
    div.className = "alumno";

    let html = `<h3>${a.nombre}</h3>`;

    if (a.estado === "AUSENTE") {
      div.classList.add("ausente");
      html += `<div>❌ AUSENTE</div>`;
    }
    else if (a.estado === "TARDE") {
      div.classList.add("tarde");
      html += `<div>⏰ TARDE</div>`;
    }
    else if (a.estado === "RETIRO") {
      div.classList.add("retiro");
      html += `<div>👨‍👩‍👦 RETIRADO</div>`;
    }
    else if (reg) {
      div.classList.add("out");
      html += `
        <div class="motivo-destacado">🚪 ${reg.causa || "Salida"}</div>
        <div class="timer-box" id="timer-${a.dni}">⏱️ 00:00</div>
        <button class="btn-main" style="width:100%; margin-top:10px;" onclick="registrarRegreso('${a.dni}')">
          REGRESO
        </button>
      `;
      // Lanza cronómetro con parsing ISO limpio
      iniciarCronometro(a.dni, reg.timestamp || reg.fecha || reg.salida);
    }
    else {
      div.classList.add("in");
      html += `
        <button class="btn-main" style="width:100%; margin-top:10px;" onclick="registrarSalida('${a.dni}')">
          SALIDA
        </button>
      `;
    }

    div.innerHTML = html;
    grid.appendChild(div);
  });
}

/* =========================================================
   REGISTRAR SALIDA (ENLACE ESTRICTO INTERFAZ-HOJA DE REQUISITOS)
========================================================= */

async function registrarSalida(dni) {
  if (procesando || !usuarioActivo) return;

  const alumno = alumnos.find(a => String(a.dni).trim() === String(dni).trim());
  if (!alumno) return;

  // Lectura directa del selector superior (Reemplazo definitivo del prompt)
  const causaSelect = document.getElementById("causa");
  const causa = causaSelect ? causaSelect.value : "";

  if (!causa) {
    alert("Debe seleccionar un 'DESTINO REQUERIDO' de la lista superior antes de autorizar la salida.");
    if (causaSelect) causaSelect.focus();
    return;
  }

  procesando = true;
  mostrarLoader(true);

  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipoAccion: "movimiento",
        tipo: "salida",
        dni: String(alumno.dni).trim(),
        nombre: alumno.nombre,
        // Inyección de columnas estructurales mapeadas de tu Sheets
        curso: alumno.curso || "",
        division: alumno.division || alumno.div || "",
        turno: alumno.turno || "",
        especialidad: alumno.especialidad || alumno.esp || "",
        docente: usuarioActivo.nombre, 
        causa: causa
      })
    });

    const result = await response.json();
    console.log("Salida confirmada:", result);

    if (!result.ok) throw new Error(result.error);

    // Limpia la causa seleccionada para el próximo alumno
    if (causaSelect) causaSelect.value = "";
    await cargarDatos();

  } catch (error) {
    console.error(error);
    alert("No se pudo registrar la salida: " + error.message);
  } finally {
    procesando = false;
    mostrarLoader(false);
  }
}

/* =========================================================
   REGISTRAR REGRESO
========================================================= */

async function registrarRegreso(dni) {
  if (procesando || !usuarioActivo) return;

  const alumno = alumnos.find(a => String(a.dni).trim() === String(dni).trim());
  if (!alumno) return;

  procesando = true;
  mostrarLoader(true);

  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tipoAccion: "movimiento",
        tipo: "regreso",
        dni: String(alumno.dni).trim(),
        nombre: alumno.nombre,
        curso: alumno.curso || "",
        division: alumno.division || alumno.div || "",
        turno: alumno.turno || "",
        especialidad: alumno.especialidad || alumno.esp || "",
        docente: usuarioActivo.nombre
      })
    });

    const result = await response.json();
    console.log("Regreso confirmado:", result);

    if (!result.ok) throw new Error(result.error);

    // Destrucción limpia del intervalo en ejecución
    if (timers[dni]) {
      clearInterval(timers[dni]);
      delete timers[dni];
    }

    await cargarDatos();

  } catch (error) {
    console.error(error);
    alert("No se pudo registrar el regreso: " + error.message);
  } finally {
    procesando = false;
    mostrarLoader(false);
  }
}

/* =========================================================
   CRONÓMETRO DE PRECISIÓN Y CONTROL DE ALERTAS VISUALES
========================================================= */

function iniciarCronometro(dni, inicioIso) {
  if (timers[dni]) {
    clearInterval(timers[dni]);
  }

  const inicio = inicioIso ? new Date(inicioIso) : new Date();

  timers[dni] = setInterval(() => {
    const ahora = new Date();
    const diferenciaMs = ahora - inicio;
    if (diferenciaMs < 0 || isNaN(diferenciaMs)) return;

    const totalSegundos = Math.floor(diferenciaMs / 1000);
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;

    const displayEl = document.getElementById(`timer-${dni}`);
    if (displayEl) {
      displayEl.textContent = `⏱️ ${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
      
      const card = displayEl.closest(".alumno");
      
      // Conexión activa con las reglas críticas de style.css
      if (minutos >= 15) {
        card?.classList.remove("tiempo-critico");
        card?.classList.add("tiempo-agotado");
        
        // Ejecuta el zumbador de alertSound únicamente en el segundo cero
        const audio = document.getElementById("alertSound");
        if (audio && segundos === 0) audio.play().catch(() => {});
      } else if (minutos >= 13) {
        card?.classList.add("tiempo-critico");
      }
    } else {
      clearInterval(timers[dni]);
    }
  }, 1000);
}

/* =========================================================
   FUNCIONES DE INTERFAZ COMPLEMENTARIAS REQUERIDAS
========================================================= */

function renderHistorial() {
  const box = document.getElementById("historial");
  const contenedorHistorial = document.getElementById("historial-container");
  if (!box) return;
  
  if (contenedorHistorial) contenedorHistorial.style.display = "block";
  box.innerHTML = "";

  const ultimos = historial.slice(-10).reverse();
  if (ultimos.length === 0) {
    box.innerHTML = `<p style="color:var(--muted); padding:10px; font-size:14px;">Sin movimientos registrados hoy en la planilla.</p>`;
    return;
  }

  ultimos.forEach(h => {
    const div = document.createElement("div");
    div.className = "historial-item";
    div.innerHTML = `⏳ <strong>${h.hora || h.timestamp || ''}</strong> - ${h.nombre || h.alumno || 'Alumno'} (${h.movimiento || h.tipo || ''}) -> <em>Destino: ${h.destino || h.causa || '-'}</em>`;
    box.appendChild(div);
  });
}

function mostrarLoader(abrir) {
  const el = document.getElementById("loader");
  if (el) el.style.display = abrir ? "flex" : "none";
}

function toggleTheme() {
  document.body.classList.toggle("light-mode");
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = document.body.classList.contains("light-mode") ? "🌙" : "☀️";
}

function cambiarPassword() { alert("Configuración de claves disponible en la administración de Google Sheets."); }
function limpiarHistorial() { alert("Para purgar el historial limpie las filas desde la hoja HISTORIAL de Google."); }
function exportHistorialPDF() { window.print(); }