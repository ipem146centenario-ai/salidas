/* =========================================================
   app.js - SISTEMA COMPLETO IPEM 146
   VERSION PROFESIONAL + PRECEPTOR
========================================================= */

const URL =
  "https://script.google.com/macros/s/AKfycbw6ZfthoxnpLFGctC5CoO78bAD-i0-0SK1G1_bYcoT5beaQK3Vil_m2U53zOw6PhllC/exec";

/* =========================================================
   VARIABLES
========================================================= */

let alumnos = [];
let docentes = [];
let salidas = [];
let historial = [];

let usuarioActivo = null;

let timers = {};

let procesando = false;

/* =========================================================
   INIT
========================================================= */

window.addEventListener("load", () => {

  // TEMA
  if (localStorage.getItem("modoTema") === "claro") {

    document.body.classList.add("light-mode");

    const btn = document.getElementById("themeToggle");

    if (btn) btn.innerHTML = "☀️";
  }

  // SESIÓN
  const sesionGuardada =
    localStorage.getItem("sesionActiva");

  if (sesionGuardada) {

    usuarioActivo = JSON.parse(sesionGuardada);

    activarSistema();
  }

  cargarDatos();
});

/* =========================================================
   CARGAR DATOS
========================================================= */

async function cargarDatos() {

  try {

    const loader =
      document.getElementById("loader");

    loader.style.display = "flex";

    const response = await fetch(URL);

    if (!response.ok) {
      throw new Error("Error");
    }

    const data = await response.json();

    alumnos = data.alumnos || [];

    docentes = data.docentes || [];

    salidas = data.salidas || [];

    historial = data.historial || [];

    cargarDocentes();

    cargarFiltros();

    render();

    renderHistorial();

    loader.style.display = "none";

  } catch (error) {

    console.error(error);

    document.getElementById("loader").innerHTML = `
      <div style="
        color:red;
        font-size:20px;
        text-align:center;
      ">
        ❌ Error de conexión
      </div>
    `;
  }
}

/* =========================================================
   LOGIN
========================================================= */

async function verificarAcceso() {

  if (procesando) return;

  procesando = true;

  const btn =
    document.getElementById("btnLogin");

  btn.disabled = true;

  btn.classList.add("loading");

  const nombre =
    document.getElementById("docentes").value;

  const pin =
    document.getElementById("passDocente").value;

  const user = docentes.find(
    (d) =>
      d.nombre === nombre &&
      String(d.password) === String(pin)
  );

  await new Promise(r => setTimeout(r, 600));

  if (user) {

    usuarioActivo = user;

    localStorage.setItem(
      "sesionActiva",
      JSON.stringify(user)
    );

    activarSistema();

    showToast(
      `✅ Bienvenido ${user.nombre}`
    );

  } else {

    const input =
      document.getElementById("passDocente");

    input.classList.add("shake");

    setTimeout(() => {
      input.classList.remove("shake");
    }, 500);

    showToast(
      "❌ PIN incorrecto",
      "error"
    );
  }

  btn.disabled = false;

  btn.classList.remove("loading");

  procesando = false;
}

/* =========================================================
   ACTIVAR SISTEMA
========================================================= */

function activarSistema() {

  document.querySelector(
    ".grupo-sesion"
  ).style.display = "none";

  [
    "logoutBtn",
    "seccion-filtros",
    "contador-container",
    "buscador-box",
    "historial-container",
    "changePassBtn"
  ].forEach((id) => {

    const el = document.getElementById(id);

    if (el) {
      el.style.display = "block";
    }
  });

  // ROL
  const rolBox =
    document.getElementById("rolActivo");

  if (rolBox) {

    rolBox.innerHTML =
      `👤 ${usuarioActivo.nombre}
       (${usuarioActivo.rol || "Docente"})`;
  }

  render();
}

/* =========================================================
   RENDER
========================================================= */

function render() {

  const grid =
    document.getElementById("grid");

  if (!grid) return;

  const curso =
    document.getElementById("fCurso").value;

  const busqueda =
    document.getElementById("buscador")
      .value
      .toLowerCase();

  if (!curso) {

    grid.innerHTML = `
      <div class="panel"
           style="text-align:center">
        📚 Seleccione curso
      </div>
    `;

    return;
  }

  const filtrados = alumnos.filter((a) => {

    return (
      a.curso == curso &&
      (
        a.nombre.toLowerCase()
          .includes(busqueda) ||
        String(a.dni)
          .includes(busqueda)
      )
    );
  });

  actualizarContadores(filtrados);

  grid.innerHTML = "";

  const fragment =
    document.createDocumentFragment();

  filtrados.forEach((a) => {

    const reg = salidas.find(
      (s) =>
        s.dni == a.dni &&
        !s.regreso
    );

    const div =
      document.createElement("div");

    div.id = `card-${a.dni}`;

    // ESTADO
    let estado = "in";

    if (a.estado === "AUSENTE") {
      estado = "ausente";
    }

    else if (
      a.estado === "TARDE"
    ) {
      estado = "tarde";
    }

    else if (reg) {
      estado = "out";
    }

    div.className =
      `alumno ${estado}`;

    let html = `
      <span class="nombre">
        ${a.nombre}
      </span>
    `;

    // =====================
    // AUSENTE
    // =====================

    if (a.estado === "AUSENTE") {

      html += `
        <div class="label-ausente">
          ❌ AUSENTE
        </div>
      `;
    }

    // =====================
    // TARDE
    // =====================

    else if (a.estado === "TARDE") {

      html += `
        <div class="motivo-destacado">
          ⏰ LLEGADA TARDE
        </div>
      `;
    }

    // =====================
    // AFUERA
    // =====================

    else if (reg) {

      html += `
        <div class="motivo-destacado">
          🚪 ${reg.causa.toUpperCase()}
        </div>
      `;

      if (
        reg.causa.toLowerCase() === "baño"
      ) {

        html += `
          <div class="timer-box">
            ⏳
            <span id="timer-${a.dni}">
              15:00
            </span>
          </div>
        `;

        iniciarCronometro(
          a.dni,
          reg.inicioTime
        );
      }
    }

    // =====================
    // EN AULA
    // =====================

    else {

      html += `
        <div class="estado-aula">
          ✅ EN AULA
        </div>
      `;
    }

    // =====================
    // BOTONES PRECEPTOR
    // =====================

    if (
      usuarioActivo &&
      usuarioActivo.rol === "Preceptor"
    ) {

      html += `
        <div class="acciones-preceptor">

          <button
            class="btn-mini rojo"
            onclick="marcarAusente('${a.dni}')">

            AUS

          </button>

          <button
            class="btn-mini naranja"
            onclick="marcarTarde('${a.dni}')">

            TARDE

          </button>

          <button
            class="btn-mini azul"
            onclick="retiroTutor('${a.dni}')">

            RETIRO

          </button>

        </div>
      `;
    }

    div.innerHTML = html;

    // CLICK NORMAL
    if (a.estado !== "AUSENTE") {

      div.onclick = (e) => {

        if (
          e.target.tagName !== "BUTTON"
        ) {

          procesarAccion(
            a,
            reg,
            div
          );
        }
      };
    }

    fragment.appendChild(div);
  });

  grid.appendChild(fragment);
}

/* =========================================================
   PROCESAR ACCIÓN
========================================================= */

async function procesarAccion(
  alumno,
  registro,
  elemento
) {

  if (procesando) return;

  const causa =
    document.getElementById("causa")
      .value;

  if (!registro && !causa) {

    showToast(
      "📍 Seleccione destino",
      "error"
    );

    return;
  }

  procesando = true;

  elemento.classList.add("loading");

  const data = {

    dni: alumno.dni,

    nombre: alumno.nombre,

    docente: usuarioActivo.nombre,

    tipo: registro
      ? "regreso"
      : "salida",

    causa: registro
      ? ""
      : causa,

    tipoAccion: "movimiento"
  };

  try {

    await fetch(URL, {

      method: "POST",

      body: JSON.stringify(data)
    });

    // HISTORIAL
    agregarHistorial(
      alumno.nombre,
      registro
        ? "REGRESO"
        : causa,
      usuarioActivo.nombre
    );

    // REGRESO
    if (registro) {

      clearInterval(
        timers[alumno.dni]
      );

      delete timers[alumno.dni];

      salidas = salidas.filter(
        (s) =>
          s.dni != alumno.dni
      );

      showToast(
        "✅ Regreso registrado"
      );
    }

    // SALIDA
    else {

      salidas.push({

        dni: alumno.dni,

        causa,

        inicioTime: new Date()
      });

      showToast(
        "🚪 Salida registrada"
      );
    }

    render();

  } catch (error) {

    console.error(error);

    showToast(
      "❌ Error",
      "error"
    );
  }

  procesando = false;
}

/* =========================================================
   PRECEPTOR
========================================================= */

function marcarAusente(dni) {

  const alumno =
    alumnos.find((a) => a.dni == dni);

  if (!alumno) return;

  alumno.estado = "AUSENTE";

  agregarHistorial(
    alumno.nombre,
    "AUSENTE",
    usuarioActivo.nombre
  );

  render();

  showToast("❌ Ausente");
}

function marcarTarde(dni) {

  const alumno =
    alumnos.find((a) => a.dni == dni);

  if (!alumno) return;

  alumno.estado = "TARDE";

  agregarHistorial(
    alumno.nombre,
    "LLEGADA TARDE",
    usuarioActivo.nombre
  );

  render();

  showToast("⏰ Llegada tarde");
}

function retiroTutor(dni) {

  const alumno =
    alumnos.find((a) => a.dni == dni);

  if (!alumno) return;

  alumno.estado = "RETIRO";

  agregarHistorial(
    alumno.nombre,
    "RETIRO PADRE/TUTOR",
    usuarioActivo.nombre
  );

  render();

  showToast("👨‍👩‍👦 Retiro");
}

/* =========================================================
   HISTORIAL
========================================================= */

function agregarHistorial(
  alumno,
  accion,
  usuario
) {

  historial.unshift({

    alumno,

    accion,

    usuario,

    hora:
      new Date()
        .toLocaleTimeString()
  });

  renderHistorial();
}

function renderHistorial() {

  const box =
    document.getElementById("historial");

  if (!box) return;

  box.innerHTML = "";

  historial
    .slice(0, 30)
    .forEach((h) => {

      box.innerHTML += `
        <div class="historial-item">

          <strong>
            ${h.alumno}
          </strong>

          - ${h.accion}

          <br>

          👤 ${h.usuario}

          • 🕒 ${h.hora}

        </div>
      `;
    });
}

function limpiarHistorial() {

  historial = [];

  renderHistorial();

  showToast("🗑 Historial limpio");
}

/* =========================================================
   CAMBIAR CONTRASEÑA
========================================================= */

function cambiarPassword() {

  const actual =
    prompt("Contraseña actual");

  if (
    String(actual) !==
    String(usuarioActivo.password)
  ) {

    showToast(
      "❌ Contraseña incorrecta",
      "error"
    );

    return;
  }

  const nueva =
    prompt("Nueva contraseña");

  if (!nueva || nueva.length < 4) {

    showToast(
      "⚠ Mínimo 4 caracteres",
      "error"
    );

    return;
  }

  usuarioActivo.password = nueva;

  localStorage.setItem(
    "sesionActiva",
    JSON.stringify(usuarioActivo)
  );

  showToast(
    "🔐 Contraseña cambiada"
  );
}

/* =========================================================
   CRONÓMETRO
========================================================= */

function iniciarCronometro(
  dni,
  inicio
) {

  if (timers[dni]) {

    clearInterval(
      timers[dni]
    );
  }

  const LIMITE = 15 * 60;

  timers[dni] = setInterval(() => {

    const restante =
      LIMITE -
      Math.floor(
        (
          Date.now() -
          new Date(inicio)
            .getTime()
        ) / 1000
      );

    const display =
      document.getElementById(
        `timer-${dni}`
      );

    const card =
      document.getElementById(
        `card-${dni}`
      );

    if (!display || !card) {

      clearInterval(
        timers[dni]
      );

      return;
    }

    if (restante <= 0) {

      display.innerText =
        "⛔ TIEMPO";

      card.classList.add(
        "tiempo-agotado"
      );

      return;
    }

    const m =
      Math.floor(restante / 60);

    const s =
      restante % 60;

    display.innerText =
      `${m}:${s < 10 ? "0" : ""}${s}`;

  }, 1000);
}

/* =========================================================
   CONTADORES
========================================================= */

function actualizarContadores(
  filtrados
) {

  const total =
    filtrados.length;

  const ausentes =
    filtrados.filter(
      (a) =>
        a.estado === "AUSENTE"
    ).length;

  const afuera =
    filtrados.filter(
      (a) =>
        salidas.find(
          (s) =>
            s.dni == a.dni
        )
    ).length;

  document.getElementById(
    "total-alumnos"
  ).innerText = total;

  document.getElementById(
    "en-aula"
  ).innerText =
    total - ausentes - afuera;

  document.getElementById(
    "afuera"
  ).innerText = afuera;

  document.getElementById(
    "ausentes"
  ).innerText = ausentes;
}

/* =========================================================
   DOCENTES
========================================================= */

function cargarDocentes() {

  const select =
    document.getElementById(
      "docentes"
    );

  select.innerHTML =
    `<option value="">
      Seleccione Usuario...
    </option>`;

  docentes.forEach((d) => {

    select.innerHTML += `
      <option value="${d.nombre}">
        ${d.nombre}
        (${d.rol || "Docente"})
      </option>
    `;
  });
}

/* =========================================================
   FILTROS
========================================================= */

function cargarFiltros() {

  [
    "fCurso",
    "fDivision",
    "fTurno",
    "fEspecialidad"
  ].forEach((id) => {

    const key =
      id.replace("f", "")
        .toLowerCase();

    const select =
      document.getElementById(id);

    select.innerHTML =
      `<option value="">
        ${key.toUpperCase()}
      </option>`;

    [
      ...new Set(
        alumnos.map(
          (a) => a[key]
        )
      )
    ]
    .sort()
    .forEach((v) => {

      if (v) {

        select.innerHTML += `
          <option value="${v}">
            ${v}
          </option>
        `;
      }
    });

    select.onchange = render;
  });
}

/* =========================================================
   TOAST
========================================================= */

function showToast(
  mensaje,
  tipo = "success"
) {

  const container =
    document.getElementById(
      "toast-container"
    );

  const toast =
    document.createElement("div");

  toast.className =
    `toast ${
      tipo === "error"
        ? "error"
        : ""
    }`;

  toast.innerText = mensaje;

  container.appendChild(toast);

  setTimeout(() => {

    toast.classList.add("hide");

    setTimeout(() => {

      toast.remove();

    }, 400);

  }, 2500);
}

/* =========================================================
   THEME
========================================================= */

function toggleTheme() {

  document.body.classList.toggle(
    "light-mode"
  );

  const claro =
    document.body.classList.contains(
      "light-mode"
    );

  localStorage.setItem(
    "modoTema",
    claro
      ? "claro"
      : "oscuro"
  );

  document.getElementById(
    "themeToggle"
  ).innerHTML =
    claro
      ? "☀️"
      : "🌙";
}

/* =========================================================
   LOGOUT
========================================================= */

function cerrarSesion() {

  Object.keys(timers)
    .forEach((k) => {

      clearInterval(
        timers[k]
      );
    });

  timers = {};

  usuarioActivo = null;

  localStorage.removeItem(
    "sesionActiva"
  );

  showToast(
    "👋 Sesión cerrada"
  );

  setTimeout(() => {

    location.reload();

  }, 700);
}