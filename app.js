// ---------- Utilidades ----------
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const leerBuffer = (archivo) => new Promise((ok, mal) => {
  const lector = new FileReader();
  lector.onload = () => ok(lector.result);
  lector.onerror = () => mal(new Error("No se pudo leer el archivo."));
  lector.readAsArrayBuffer(archivo);
});

function leerCSV(texto) {
  const lineas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  if (!lineas.length) return [];
  const sep = lineas[0].includes("\t") ? "\t" : (lineas[0].includes(";") && !lineas[0].includes(",")) ? ";" : ",";
  return lineas.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}

// Devuelve { nombreHoja: filas[][] } (un CSV tiene una sola "hoja")
async function leerTabla(archivo) {
  if (!/\.xlsx?$/i.test(archivo.name)) {
    return { Datos: leerCSV(new TextDecoder("utf-8").decode(await leerBuffer(archivo))) };
  }
  if (typeof XLSX === "undefined") throw new Error("No se pudo cargar el lector de Excel (se necesita conexión a internet). Guarda la hoja como CSV e inténtalo de nuevo.");
  const libro = XLSX.read(await leerBuffer(archivo), { type: "array" });
  const hojas = {};
  libro.SheetNames.forEach((n) => {
    hojas[n] = XLSX.utils.sheet_to_json(libro.Sheets[n], { header: 1, raw: true, defval: "" })
      .map((fila) => fila.map((c) => String(c).trim()));
  });
  return hojas;
}

// Ubica la tabla dentro de una hoja: el encabezado es la primera fila "ancha"
// y la tabla termina en la primera fila completamente vacía.
function extraerTabla(filas) {
  const llenas = (f) => f.filter((c) => c !== "").length;
  const ancho = Math.max(0, ...filas.slice(0, 15).map(llenas));
  const ini = filas.findIndex((f) => llenas(f) >= Math.max(2, ancho * 0.6));
  if (ini < 0) return [];
  let fin = ini + 1;
  while (fin < filas.length && llenas(filas[fin]) > 0) fin++;
  const bloque = filas.slice(ini, fin);
  const cols = bloque[0].map((c, j) => (c !== "" ? j : -1)).filter((j) => j >= 0);
  return bloque.map((f) => cols.map((j) => f[j] ?? ""));
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
  const datos = filas.slice(1);
  if (datos.length === 0) errores.push("El archivo de pruebas no tiene instancias.");
  datos.forEach((f, i) => {
    if (f.slice(0, tipos.length).some((v) => v === "" || v === "?")) errores.push(`Prueba, fila ${i + 2}: contiene valores vacíos.`);
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
  const suma = (f) => clases.reduce((s, c) => s + f(c), 0);
  const max = Math.max(1, ...clases.flatMap((p) => clases.map((r) => m[p][r])));
  let h = "<table><tr><th>Predicho \\ Real</th>" + clases.map((c) => `<th>${esc(c)}</th>`).join("") + "<th>Total</th></tr>";
  clases.forEach((p) => {
    h += `<tr><th>${esc(p)}</th>` + clases.map((r) =>
      `<td class="${p === r ? "diag" : m[p][r] ? "fallo" : ""}" style="--i:${(m[p][r] / max).toFixed(2)}">${m[p][r]}</td>`).join("");
    h += `<td>${suma((r) => m[p][r])}</td></tr>`;
  });
  h += '<tr class="total"><td>Total</td>' + clases.map((r) => `<td>${suma((p) => m[p][r])}</td>`).join("");
  h += `<td>${suma((p) => suma((r) => m[p][r]))}</td></tr></table>`;
  $("matriz").innerHTML = h;
}

function mostrarMetricas(res) {
  const f = (x) => x.toFixed(2);
  const celda = (x) => `<td>${f(x)}<span class="bar"><i style="width:${Math.round(x * 100)}%"></i></span></td>`;
  let h = "<table><tr><th>Categoría</th><th>Precisión</th><th>Exhaustividad</th><th>Medida F1</th><th>Soporte</th></tr>";
  res.filas.forEach((r) => (h += `<tr><td>${esc(r.clase)}</td>${celda(r.precision)}${celda(r.recall)}${celda(r.f1)}<td>${r.soporte}</td></tr>`));
  const p = res.promedio;
  h += `<tr class="total"><td>Promedio / total</td>${celda(p.precision)}${celda(p.recall)}${celda(p.f1)}<td>${p.soporte}</td></tr></table>`;
  $("metricas").innerHTML = h;
  $("accuracy").textContent = (res.accuracy * 100).toFixed(2) + "%";
  $("aciertos").textContent = `${Math.round(res.accuracy * p.soporte)} de ${p.soporte} instancias correctas`;
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
const estado = { dataset: null, prueba: null };
const PATRON = { dataset: /entrena|train|dataset|datos|data/i, prueba: /prueba|test/i };
const ids = { dataset: ["hojaDataset", "resumenDataset"], prueba: ["hojaPrueba", "resumenPrueba"] };

function ponerOpciones(sel, items) {
  sel.innerHTML = items.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join("");
}

function elegirHoja(hojas, patron) {
  const nombres = Object.keys(hojas);
  return nombres.find((n) => patron.test(n)) ||
    nombres.find((n) => { const t = extraerTabla(hojas[n]); return t.length >= 3 && t[0].length >= 2; }) || nombres[0];
}

// Una columna ID (nombre típico o numeración consecutiva) no aporta a la clasificación
function esColumnaId(nombre, col) {
  if (/^(id|#|folio|n[uú]m(ero)?|no\.?)$/i.test(nombre)) return true;
  return col.length > 2 && Number.isInteger(Number(col[0])) && col.every((v, i) => Number(v) === Number(col[0]) + i);
}

function refrescarAtributos() {
  const tabla = estado.dataset && estado.dataset.tabla;
  if (!tabla || !tabla.length) { $("atributos").innerHTML = ""; return; }
  const clase = Number($("columnaClase").value);
  $("atributos").innerHTML = tabla[0].map((nombre, j) => {
    if (j === clase) return "";
    const marcado = esColumnaId(nombre, tabla.slice(1).map((f) => f[j])) ? "" : "checked";
    return `<label class="chip"><input type="checkbox" value="${j}" ${marcado}><span>${esc(nombre)}</span></label>`;
  }).join("");
}

function refrescarTabla(clave) {
  const e = estado[clave];
  if (!e) return;
  const [selId, resId] = ids[clave];
  e.tabla = extraerTabla(e.hojas[$(selId).value]);
  $(resId).textContent = e.tabla.length
    ? `${e.tabla.length - 1} instancias · ${e.tabla[0].length} columnas`
    : "No se encontró una tabla en esta hoja.";
  if (clave === "dataset") {
    const h = e.tabla[0] || [];
    ponerOpciones($("columnaClase"), h.map((n, j) => [j, n]));
    const i = h.findIndex((n) => /^(clase|class|target|etiqueta|label)/i.test(n));
    $("columnaClase").value = String(i >= 0 ? i : h.length - 1);
    refrescarAtributos();
  }
}

async function cargar(clave, input) {
  const [selId] = ids[clave];
  const sel = $(selId);
  const caja = sel.closest(".hoja");
  estado[clave] = null;
  caja.hidden = true;
  if (clave === "dataset") $("columnas").hidden = true;
  mostrarErrores([]);
  if (!input.files.length) return;
  try {
    const hojas = await leerTabla(input.files[0]);
    estado[clave] = { hojas };
    const nombres = Object.keys(hojas);
    ponerOpciones(sel, nombres.map((n) => [n, n]));
    sel.value = elegirHoja(hojas, PATRON[clave]);
    sel.closest("label").hidden = nombres.length < 2;
    caja.hidden = false;
    if (clave === "dataset") $("columnas").hidden = false;
    refrescarTabla(clave);
  } catch (err) {
    mostrarErrores([err.message]);
  }
}

function actualizarControles() {
  const modo = document.querySelector('input[name="modo"]:checked').value;
  $("metodo").disabled = modo !== "mismo";
  $("porcentaje").disabled = modo !== "mismo" || $("metodo").value === "cruzada";
  $("lblPorcentaje").style.opacity = $("porcentaje").disabled ? 0.4 : 1;
  $("testFile").disabled = modo !== "externo";
  $("opcionesMismo").classList.toggle("apagado", modo !== "mismo");
  $("opcionesExterno").classList.toggle("apagado", modo !== "externo");
  $("lblIntervalos").hidden = $("continuas").value === "normal";
}
document.querySelectorAll('input[name="modo"]').forEach((r) => r.addEventListener("change", actualizarControles));
$("metodo").addEventListener("change", actualizarControles);
$("continuas").addEventListener("change", actualizarControles);
$("datasetFile").addEventListener("change", (e) => cargar("dataset", e.target));
$("testFile").addEventListener("change", (e) => cargar("prueba", e.target));
$("hojaDataset").addEventListener("change", () => refrescarTabla("dataset"));
$("hojaPrueba").addEventListener("change", () => refrescarTabla("prueba"));
$("columnaClase").addEventListener("change", refrescarAtributos);
actualizarControles();

$("analizar").addEventListener("click", () => {
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
  const T = estado.dataset && estado.dataset.tabla;
  if (!T || !T.length) errores.push("Selecciona un archivo de dataset con una tabla válida.");
  if (modo === "externo" && !(estado.prueba && estado.prueba.tabla && estado.prueba.tabla.length)) errores.push("Selecciona un archivo de pruebas con una tabla válida.");
  const cols = [...document.querySelectorAll("#atributos input:checked")].map((i) => Number(i.value));
  if (T && T.length && !cols.length) errores.push("Marca al menos un atributo.");
  if (errores.length) return mostrarErrores(errores);

  // Dataset = columnas de atributos elegidas + columna de clase al final
  const claseIdx = Number($("columnaClase").value);
  const filas = T.map((f) => [...cols.map((j) => f[j]), f[claseIdx]]);
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
    // Las columnas del archivo de pruebas se buscan por nombre de encabezado
    const TP = estado.prueba.tabla;
    const nombres = TP[0].map((h) => h.toLowerCase());
    const pos = encabezado.slice(0, nAtr).map((h) => nombres.indexOf(h.toLowerCase()));
    const faltan = encabezado.slice(0, nAtr).filter((h, i) => pos[i] < 0);
    if (faltan.length) return mostrarErrores([`Al archivo de pruebas le faltan estas columnas: ${faltan.join(", ")}.`]);
    const nombreClase = encabezado[nAtr].toLowerCase();
    const ci = nombres.findIndex((h, j) => !pos.includes(j) && h.startsWith(nombreClase));
    conClase = ci >= 0;
    const filasTest = [encabezado.slice(0, conClase ? nAtr + 1 : nAtr),
      ...TP.slice(1).map((f) => [...pos.map((j) => f[j]), ...(conClase ? [f[ci]] : [])])];
    errores = validarPrueba(filasTest, encabezado, tipos);
    if (errores.length) return mostrarErrores(errores);
    filasPrueba = filasTest.slice(1);
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
    $("resultados").scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

