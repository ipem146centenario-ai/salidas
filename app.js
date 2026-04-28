const URL = "https://script.google.com/macros/s/AKfycbyflxL8Bpa4CqyvpU29ad5SAdPCrwrYFMiiJLqmsKaJYWWazOiVTAQNxL2h9raQ9DFueg/exec"; // REEMPLAZA CON TU URL
let alumnos = [], docentes = [], salidas = [], usuarioActivo = null;

fetch(URL).then(r => r.json()).then(data => {
    alumnos = data.alumnos || [];
    docentes = data.docentes || [];
    salidas = data.salidas || [];
    cargarDocentes();
    cargarFiltros();
});

function cargarDocentes() {
    const sel = document.getElementById("docentes");
    sel.innerHTML = `<option value="">Usuario...</option>`;
    docentes.forEach(d => sel.innerHTML += `<option value="${d.nombre}">${d.nombre}</option>`);
}

function verificarAcceso() {
    const nom = document.getElementById("docentes").value;
    const pin = document.getElementById("passDocente").value;
    const user = docentes.find(d => d.nombre === nom && String(d.password) === String(pin));

    if (user) {
        usuarioActivo = user; 
        document.querySelector(".grupo-sesion").style.display = "none";
        document.getElementById("btn-logout").style.display = "inline-block";
        document.getElementById("seccion-filtros").style.display = "block";
        document.getElementById("status-container").style.display = "block";
        document.getElementById("user-role").innerText = user.tipo.toUpperCase();
        render();
    } else { alert("❌ PIN INCORRECTO"); }
}

function cargarFiltros() {
    ["fCurso", "fDivision", "fTurno", "fEspecialidad"].forEach(id => {
        const key = id.replace('f', '').toLowerCase();
        const sel = document.getElementById(id);
        sel.innerHTML = `<option value="">${key.toUpperCase()}</option>`;
        [...new Set(alumnos.map(a => a[key]))].sort().forEach(v => {
            if(v) sel.innerHTML += `<option value="${v}">${v}</option>`;
        });
        sel.onchange = render;
    });
}

// ... (mismo inicio de carga de datos) ...

function render() {
    const grid = document.getElementById("grid");
    const curso = document.getElementById("fCurso").value;
    if (!usuarioActivo || !curso) return;

    grid.innerHTML = "";
    const esPreceptor = usuarioActivo.tipo.toLowerCase() === "preceptor";

    alumnos.filter(a => a.curso == curso) // + filtros de division, etc
    .forEach(a => {
        const registro = salidas.find(s => s.dni == a.dni && !s.regreso);
        
        // Prioridad: Si en la Columna N dice AUSENTE
        const esAusente = a.ausente === "AUSENTE"; 
        
        const div = document.createElement("div");
        div.className = `alumno ${registro ? "out" : "in"} ${esAusente ? "ausente" : ""}`;
        
        let checkHTML = esPreceptor ? 
            `<input type="checkbox" class="ausente-check" ${esAusente ? "checked" : ""} 
             onclick="toggleAusencia(event, '${a.dni}')">` : "";

        // Lógica de texto de estado corregida
        let estadoLabel = "";
        if (esAusente) {
            estadoLabel = `<div class="label-ausente">❌ AUSENTE</div>`;
        } else if (registro) {
            estadoLabel = `<div class="motivo-destacado">${registro.causa.toUpperCase()}</div>`;
        } else {
            estadoLabel = `<div class="estado-aula">● EN AULA</div>`;
        }

        div.innerHTML = `${checkHTML}<span class="nombre">${a.nombre}</span>${estadoLabel}`;
        
        if (esAusente) {
            div.onclick = () => { if(!esPreceptor) alert("Alumno Ausente."); };
        } else {
            div.onclick = () => procesarAccion(a, registro);
        }
        grid.appendChild(div);
    });
}

function toggleAusencia(event, dni) {
    event.stopPropagation(); // Evita que se dispare la salida normal
    const nuevoEstado = event.target.checked ? "AUSENTE" : "PRESENTE";
    
    fetch(URL, { 
        method: "POST", 
        body: JSON.stringify({ 
            dni: dni, 
            tipoAccion: "asistencia", // IDENTIFICADOR CRÍTICO
            estado: nuevoEstado 
        }) 
    }).then(() => render());
}
function procesarAccion(alumno, registro) {
    const causaSel = document.getElementById("causa").value;
    if (!registro && !causaSel) return alert("⚠️ Seleccioná un DESTINO.");

    const data = { ...alumno, docente: usuarioActivo.nombre, tipo: registro ? "regreso" : "salida", causa: registro ? "" : causaSel };

    fetch(URL, { method: "POST", body: JSON.stringify(data) }).then(() => {
        if (registro) { registro.regreso = "OK"; } 
        else { salidas.push({ dni: alumno.dni, regreso: "", causa: causaSel }); }
        render();
    });
}

function cerrarSesion() { location.reload(); }