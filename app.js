// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const leerArchivo = (input) => new Promise((ok) => {
  const lector = new FileReader();
  lector.onload = () => ok(lector.result);
  lector.readAsText(input.files[0]);
});

function leerCSV(texto) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  const sep = lineas[0].includes("\t") ? "\t" : (lineas[0].includes(";") && !lineas[0].includes(",")) ? ";" : ",";
  return lineas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

function mezclar(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 1. Validación ----------
function validarDataset(filas) {
  const errores = [];
  if (filas.length < 3) errores.push("El dataset necesita encabezado y al menos 2 instancias.");
  const columnas = filas[0].length;
  if (columnas < 2) errores.push("El dataset necesita al menos 1 atributo y 1 columna de clase.");
  filas.slice(1).forEach((f, i) => {
    if (f.length !== columnas) errores.push(`Fila ${i + 2}: tiene ${f.length} columnas y se esperaban ${columnas}.`);
    else if (f.some((v) => v === "" || v === "?")) errores.push(`Fila ${i + 2}: contiene valores vacíos.`);
  });
  if (errores.length === 0) {
    const clases = new Set(filas.slice(1).map((f) => f[columnas - 1]));
    if (clases.size < 2) errores.push("La columna de clase debe tener al menos 2 clases distintas.");
  }
  return errores;
}

function detectarTipos(datos) {
  const nAtr = datos[0].length - 1;
  const tipos = [];
  for (let j = 0; j < nAtr; j++) {
    tipos.push(datos.every((f) => isFinite(Number(f[j]))) ? "num" : "cat");
  }
  return tipos;
}

function validarPrueba(filas, encabezado, tipos) {
  const errores = [];
  const nAtr = tipos.length;
  const columnas = filas[0].length;
  if (columnas !== nAtr && columnas !== nAtr + 1) {
    return [`El archivo de pruebas tiene ${columnas} columnas y se esperaban ${nAtr} o ${nAtr + 1}.`];
  }
  const datos = filas.slice(1);
  if (datos.length === 0) errores.push("El archivo de pruebas no tiene instancias.");
  datos.forEach((f, i) => {
    if (f.length !== columnas) errores.push(`Prueba, fila ${i + 2}: número de columnas incorrecto.`);
    else if (f.some((v) => v === "" || v === "?")) errores.push(`Prueba, fila ${i + 2}: contiene valores vacíos.`);
    else tipos.forEach((t, j) => {
      if (t === "num" && !isFinite(Number(f[j]))) errores.push(`Prueba, fila ${i + 2}: "${encabezado[j]}" debe ser numérico.`);
    });
  });
  return errores;
}

function validarParametros(modo, metodo, porcentaje, continuas, intervalos) {
  const errores = [];
  if (modo === "mismo" && metodo !== "cruzada" && !(Number.isInteger(porcentaje) && porcentaje >= 1 && porcentaje <= 99)) {
    errores.push("El porcentaje de entrenamiento debe ser un entero entre 1 y 99.");
  }
  if (continuas !== "normal" && !(Number.isInteger(intervalos) && intervalos >= 2)) {
    errores.push("El número de intervalos debe ser un entero mayor o igual a 2.");
  }
  return errores;
}

// ---------- 2. Clasificación ----------
// Bordes de los intervalos (k intervalos = k-1 bordes)
function calcularBordes(valores, metodo, k) {
  const v = valores.map(Number).sort((a, b) => a - b);
  const bordes = [];
  for (let i = 1; i < k; i++) {
    if (metodo === "ancho") bordes.push(v[0] + (i * (v[v.length - 1] - v[0])) / k);
    else bordes.push(v[Math.floor((i * v.length) / k)]);
  }
  return bordes;
}

// Convierte columnas numéricas a números o a intervalos (según el método)
function preparar(train, test, tipos, metodo, k) {
  const tr = train.map((f) => f.slice());
  const te = test.map((f) => f.slice());
  const tiposNuevos = tipos.slice();
  tipos.forEach((t, j) => {
    if (t !== "num") return;
    if (metodo === "normal") {
      tr.forEach((f) => (f[j] = Number(f[j])));
      te.forEach((f) => (f[j] = Number(f[j])));
    } else {
      const bordes = calcularBordes(tr.map((f) => f[j]), metodo, k);
      const intervalo = (x) => "I" + bordes.filter((b) => Number(x) >= b).length;
      tr.forEach((f) => (f[j] = intervalo(f[j])));
      te.forEach((f) => (f[j] = intervalo(f[j])));
      tiposNuevos[j] = "cat";
    }
  });
  return { tr, te, tiposNuevos };
}

function entrenar(tr, tipos) {
  const nAtr = tipos.length;
  const clases = [...new Set(tr.map((f) => f[nAtr]))];
  const modelo = { clases, prior: {}, atributos: [] };
  clases.forEach((c) => (modelo.prior[c] = tr.filter((f) => f[nAtr] === c).length / tr.length));

  tipos.forEach((t, j) => {
    const info = { tipo: t, porClase: {} };
    if (t === "cat") info.valores = new Set(tr.map((f) => f[j])).size;
    clases.forEach((c) => {
      const col = tr.filter((f) => f[nAtr] === c).map((f) => f[j]);
      if (t === "num") {
        const mu = col.reduce((a, b) => a + b, 0) / col.length;
        const varianza = col.reduce((a, b) => a + (b - mu) ** 2, 0) / col.length;
        info.porClase[c] = { mu, varianza: Math.max(varianza, 1e-6) };
      } else {
        const conteo = {};
        col.forEach((v) => (conteo[v] = (conteo[v] || 0) + 1));
        info.porClase[c] = { conteo, total: col.length };
      }
    });
    modelo.atributos.push(info);
  });
  return modelo;
}

function predecir(modelo, fila) {
  let mejor = null, mejorPuntaje = -Infinity;
  modelo.clases.forEach((c) => {
    let puntaje = Math.log(modelo.prior[c]);
    modelo.atributos.forEach((a, j) => {
      const p = a.porClase[c];
      if (a.tipo === "num") {
        // Función de densidad normal (en logaritmo)
        puntaje += -0.5 * Math.log(2 * Math.PI * p.varianza) - (fila[j] - p.mu) ** 2 / (2 * p.varianza);
      } else {
        // Suavizado de Laplace
        puntaje += Math.log(((p.conteo[fila[j]] || 0) + 1) / (p.total + a.valores));
      }
    });
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = c; }
  });
  return mejor;
}

// Entrena con 'train' y predice 'test'
function correrFold(train, test, tipos, metodo, k) {
  const { tr, te, tiposNuevos } = preparar(train, test, tipos, metodo, k);
  const modelo = entrenar(tr, tiposNuevos);
  return te.map((f) => predecir(modelo, f));
}

// ---------- Métodos de validación ----------
function dividirSimple(datos, pct) {
  const m = mezclar(datos);
  const corte = Math.round((m.length * pct) / 100);
  return [{ train: m.slice(0, corte), test: m.slice(corte) }];
}

function dividirEstratificada(datos, pct, nAtr) {
  const train = [], test = [];
  [...new Set(datos.map((f) => f[nAtr]))].forEach((c) => {
    const grupo = mezclar(datos.filter((f) => f[nAtr] === c));
    const corte = Math.round((grupo.length * pct) / 100);
    train.push(...grupo.slice(0, corte));
    test.push(...grupo.slice(corte));
  });
  return [{ train, test }];
}

function dividirCruzada(datos) {
  const m = mezclar(datos);
  const mitad = Math.floor(m.length / 2);
  const a = m.slice(0, mitad), b = m.slice(mitad);
  return [{ train: a, test: b }, { train: b, test: a }];
}

// ---------- 3. Métricas ----------
function calcularMetricas(reales, predichos, clases) {
  const matriz = {}; // matriz[predicho][real]
  clases.forEach((p) => { matriz[p] = {}; clases.forEach((r) => (matriz[p][r] = 0)); });
  reales.forEach((r, i) => matriz[predichos[i]][r]++);

  let aciertos = 0;
  const filas = clases.map((c) => {
    const tp = matriz[c][c];
    const totalPred = clases.reduce((s, r) => s + matriz[c][r], 0);
    const totalReal = clases.reduce((s, p) => s + matriz[p][c], 0);
    const precision = totalPred ? tp / totalPred : 0;
    const recall = totalReal ? tp / totalReal : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    aciertos += tp;
    return { clase: c, precision, recall, f1, soporte: totalReal };
  });
  const prom = (k) => filas.reduce((s, f) => s + f[k], 0) / filas.length;
  return {
    matriz, filas,
    promedio: { precision: prom("precision"), recall: prom("recall"), f1: prom("f1"), soporte: reales.length },
    accuracy: aciertos / reales.length,
  };
}

// ---------- Mostrar resultados ----------
function mostrarMatriz(m, clases) {
  let h = "<table><tr><th>Predicho \\ Real</th>" + clases.map((c) => `<th>${esc(c)}</th>`).join("") + "<th>Total</th></tr>";
  clases.forEach((p) => {
    h += `<tr><th>${esc(p)}</th>` + clases.map((r) => `<td class="${p === r ? "diag" : ""}">${m[p][r]}</td>`).join("");
    h += `<td>${clases.reduce((s, r) => s + m[p][r], 0)}</td></tr>`;
  });
  h += '<tr class="total"><td>Total</td>' + clases.map((r) => `<td>${clases.reduce((s, p) => s + m[p][r], 0)}</td>`).join("");
  h += `<td>${clases.reduce((s, p) => s + clases.reduce((t, r) => t + m[p][r], 0), 0)}</td></tr></table>`;
  $("matriz").innerHTML = h;
}

function mostrarMetricas(res) {
  const f = (x) => x.toFixed(2);
  let h = "<table><tr><th>Categoría</th><th>Precisión</th><th>Exhaustividad</th><th>Medida F1</th><th>Soporte</th></tr>";
  res.filas.forEach((r) => (h += `<tr><td>${esc(r.clase)}</td><td>${f(r.precision)}</td><td>${f(r.recall)}</td><td>${f(r.f1)}</td><td>${r.soporte}</td></tr>`));
  const p = res.promedio;
  h += `<tr class="total"><td>Promedio / total</td><td>${f(p.precision)}</td><td>${f(p.recall)}</td><td>${f(p.f1)}</td><td>${p.soporte}</td></tr></table>`;
  $("metricas").innerHTML = h;
  $("accuracy").textContent = (res.accuracy * 100).toFixed(2) + "%";
}

function mostrarPredicciones(filas, predichos, encabezado, nAtr) {
  let h = "<table><tr><th>#</th>" + encabezado.slice(0, nAtr).map((e) => `<th>${esc(e)}</th>`).join("") + "<th>Clase predicha</th></tr>";
  filas.forEach((f, i) => {
    h += `<tr><td>${i + 1}</td>` + f.slice(0, nAtr).map((v) => `<td>${esc(v)}</td>`).join("") + `<td><strong>${esc(predichos[i])}</strong></td></tr>`;
  });
  $("tablaPred").innerHTML = h + "</table>";
}

function mostrarErrores(lista) {
  $("errores").innerHTML = lista.slice(0, 8).map((e) => `<p>${esc(e)}</p>`).join("") +
    (lista.length > 8 ? `<p>… y ${lista.length - 8} errores más.</p>` : "");
}

// ---------- Interfaz ----------
function actualizarControles() {
  const modo = document.querySelector('input[name="modo"]:checked').value;
  $("metodo").disabled = modo !== "mismo";
  $("porcentaje").disabled = modo !== "mismo" || $("metodo").value === "cruzada";
  $("lblPorcentaje").style.opacity = $("porcentaje").disabled ? 0.4 : 1;
  $("testFile").disabled = modo !== "externo";
  $("lblIntervalos").hidden = $("continuas").value === "normal";
}
document.querySelectorAll('input[name="modo"]').forEach((r) => r.addEventListener("change", actualizarControles));
$("metodo").addEventListener("change", actualizarControles);
$("continuas").addEventListener("change", actualizarControles);
actualizarControles();

$("analizar").addEventListener("click", async () => {
  mostrarErrores([]);
  $("resultados").hidden = true;
  $("predicciones").hidden = true;

  const modo = document.querySelector('input[name="modo"]:checked').value;
  const metodo = $("metodo").value;
  const porcentaje = Number($("porcentaje").value);
  const continuas = $("continuas").value;
  const intervalos = Number($("intervalos").value);

  // Validación de parámetros y archivos
  let errores = validarParametros(modo, metodo, porcentaje, continuas, intervalos);
  if (!$("datasetFile").files.length) errores.push("Selecciona un archivo de dataset.");
  if (modo === "externo" && !$("testFile").files.length) errores.push("Selecciona un archivo de pruebas.");
  if (errores.length) return mostrarErrores(errores);

  const filas = leerCSV(await leerArchivo($("datasetFile")));
  errores = validarDataset(filas);
  if (errores.length) return mostrarErrores(errores);

  const encabezado = filas[0];
  const datos = filas.slice(1);
  const nAtr = encabezado.length - 1;
  const tipos = detectarTipos(datos);

  let reales = [], predichos = [], clases = [], info = "", filasPrueba = null, conClase = true;

  if (modo === "mismo") {
    const folds = metodo === "cruzada" ? dividirCruzada(datos)
      : metodo === "estratificada" ? dividirEstratificada(datos, porcentaje, nAtr)
      : dividirSimple(datos, porcentaje);
    if (folds.some((f) => f.train.length === 0 || f.test.length === 0)) {
      return mostrarErrores(["La división deja el entrenamiento o las pruebas vacías. Cambia el porcentaje."]);
    }
    folds.forEach((fold) => {
      predichos.push(...correrFold(fold.train, fold.test, tipos, continuas, intervalos));
      reales.push(...fold.test.map((f) => f[nAtr]));
    });
    clases = [...new Set(datos.map((f) => f[nAtr]))].sort();
    info = `Método: ${metodo}. Entrenamiento: ${folds[0].train.length} instancias. Pruebas: ${reales.length} instancias.`;
  } else {
    const filasTest = leerCSV(await leerArchivo($("testFile")));
    errores = validarPrueba(filasTest, encabezado, tipos);
    if (errores.length) return mostrarErrores(errores);
    filasPrueba = filasTest.slice(1);
    conClase = filasTest[0].length === nAtr + 1;
    predichos = correrFold(datos, filasPrueba, tipos, continuas, intervalos);
    if (conClase) {
      reales = filasPrueba.map((f) => f[nAtr]);
      clases = [...new Set([...datos.map((f) => f[nAtr]), ...reales])].sort();
    }
    info = `Entrenado con ${datos.length} instancias del dataset. Instancias de prueba: ${filasPrueba.length}.`;
    mostrarPredicciones(filasPrueba, predichos, encabezado, nAtr);
    $("predicciones").hidden = false;
  }

  if (conClase) {
    const res = calcularMetricas(reales, predichos, clases);
    mostrarMatriz(res.matriz, clases);
    mostrarMetricas(res);
    $("info").textContent = info;
    $("resultados").hidden = false;
  }
});
