const URL = "https://script.google.com/macros/s/AKfycbyflxL8Bpa4CqyvpU29ad5SAdPCrwrYFMiiJLqmsKaJYWWazOiVTAQNxL2h9raQ9DFueg/exec";

let alumnos = [];
let docentes = [];
let salidas = [];
let usuarioActivo = null;

fetch(URL)
.then(r => r.json())
.then(data => {

    alumnos = data.alumnos || [];
    docentes = data.docentes || [];
    salidas = data.salidas || [];

    cargarDocentes();
    cargarFiltros();

});

function cargarDocentes(){

    const sel = document.getElementById("docentes");

    sel.innerHTML = `<option value="">Usuario...</option>`;

    docentes.forEach(d => {

        sel.innerHTML += `
            <option value="${d.nombre}">
                ${d.nombre}
            </option>
        `;

    });

}

function verificarAcceso(){

    const nom = document.getElementById("docentes").value;
    const pin = document.getElementById("passDocente").value;

    const user = docentes.find(
        d => d.nombre === nom &&
        String(d.password) === String(pin)
    );

    if(user){

        usuarioActivo = user;

        document.querySelector(".grupo-sesion").style.display = "none";

        document.getElementById("seccion-filtros").style.display = "block";

        document.getElementById("status-container").style.display = "block";

        document.getElementById("user-role").innerText =
        user.tipo.toUpperCase();

        render();

    }else{

        alert("❌ PIN INCORRECTO");

    }

}

function cargarFiltros(){

    ["fCurso","fDivision","fTurno","fEspecialidad"]
    .forEach(id => {

        const key = id.replace('f','').toLowerCase();

        const sel = document.getElementById(id);

        sel.innerHTML = `<option value="">${key.toUpperCase()}</option>`;

        [...new Set(alumnos.map(a => a[key]))]
        .sort()
        .forEach(v => {

            if(v){

                sel.innerHTML += `
                    <option value="${v}">
                        ${v}
                    </option>
                `;

            }

        });

        sel.onchange = render;

    });

}

function render(){

    const grid = document.getElementById("grid");

    const curso = document.getElementById("fCurso").value;
    const division = document.getElementById("fDivision").value;
    const turno = document.getElementById("fTurno").value;
    const especialidad = document.getElementById("fEspecialidad").value;

    if(!usuarioActivo || !curso) return;

    grid.innerHTML = "";

    const esPreceptor =
    usuarioActivo.tipo.toLowerCase() === "preceptor";

    alumnos
    .filter(a => {

        return (!curso || a.curso == curso) &&
               (!division || a.division == division) &&
               (!turno || a.turno == turno) &&
               (!especialidad || a.especialidad == especialidad);

    })
    .forEach(a => {

        const registro =
        salidas.find(s => s.dni == a.dni && !s.regreso);

        const esAusente = a.ausente === "AUSENTE";

        const div = document.createElement("div");

        div.className =
        `alumno ${registro ? "out" : "in"} ${esAusente ? "ausente" : ""}`;

        let checkHTML = "";

        if(esPreceptor){

            checkHTML = `
                <input
                    type="checkbox"
                    class="ausente-check"
                    ${esAusente ? "checked" : ""}
                    onclick="toggleAusencia(event, '${a.dni}')"
                >
            `;

        }

        let estadoLabel = "";

        if(esAusente){

            estadoLabel = `
                <div class="label-ausente">
                    ❌ AUSENTE
                </div>
            `;

        }else if(registro){

            estadoLabel = `
                <div class="motivo-destacado">
                    ${registro.causa.toUpperCase()}
                </div>
            `;

        }else{

            estadoLabel = `
                <div class="estado-aula">
                    ● EN AULA
                </div>
            `;

        }

        div.innerHTML = `
            ${checkHTML}
            <span class="nombre">${a.nombre}</span>
            ${estadoLabel}
        `;

        if(esAusente){

            div.onclick = () => {

                if(!esPreceptor){
                    alert("Alumno Ausente.");
                }

            };

        }else{

            div.onclick = () =>
            procesarAccion(a, registro);

        }

        grid.appendChild(div);

    });

}

function toggleAusencia(event, dni){

    event.stopPropagation();

    const nuevoEstado =
    event.target.checked ? "AUSENTE" : "PRESENTE";

    fetch(URL,{
        method:"POST",
        body:JSON.stringify({
            dni:dni,
            tipoAccion:"asistencia",
            estado:nuevoEstado
        })
    })
    .then(() => render());

}

function procesarAccion(alumno, registro){

    const causaSel =
    document.getElementById("causa").value;

    if(!registro && !causaSel){

        return alert("⚠️ Seleccioná un DESTINO.");

    }

    const data = {

        ...alumno,

        docente:usuarioActivo.nombre,

        tipo:registro ? "regreso" : "salida",

        causa:registro ? "" : causaSel

    };

    fetch(URL,{
        method:"POST",
        body:JSON.stringify(data)
    })
    .then(() => {

        if(registro){

            registro.regreso = "OK";

        }else{

            salidas.push({
                dni:alumno.dni,
                regreso:"",
                causa:causaSel
            });

        }

        render();

    });

}

function cerrarSesion(){

    location.reload();

}

function togglePassword(){

    const input =
    document.getElementById("passDocente");

    const btn =
    document.querySelector(".toggle-pass");

    if(input.type === "password"){

        input.type = "text";
        btn.innerHTML = "🙈";

    }else{

        input.type = "password";
        btn.innerHTML = "👁";

    }

}

function mostrarCambioPassword(){

    const panel =
    document.getElementById("panel-password");

    if(panel.style.display === "none"){

        panel.style.display = "flex";

    }else{

        panel.style.display = "none";

    }

}

function cambiarPassword(){

    const docente =
    document.getElementById("docentes").value;

    const actual =
    document.getElementById("actualPass").value;

    const nueva =
    document.getElementById("nuevaPass").value;

    const repetir =
    document.getElementById("repetirPass").value;

    if(!docente){

        return alert("⚠️ Seleccioná un usuario.");

    }

    const user = docentes.find(
        d =>
        d.nombre === docente &&
        String(d.password) === String(actual)
    );

    if(!user){

        return alert("❌ Contraseña actual incorrecta.");

    }

    if(nueva.length < 4){

        return alert("⚠️ La nueva contraseña es muy corta.");

    }

    if(nueva !== repetir){

        return alert("⚠️ Las contraseñas no coinciden.");

    }

    fetch(URL,{
        method:"POST",
        body:JSON.stringify({
            tipoAccion:"cambiarPassword",
            docente:docente,
            nuevaPassword:nueva
        })
    })
    .then(() => {

        alert("✅ Contraseña actualizada.");

        user.password = nueva;

        document.getElementById("actualPass").value = "";
        document.getElementById("nuevaPass").value = "";
        document.getElementById("repetirPass").value = "";

        document.getElementById("panel-password")
        .style.display = "none";

    });

}