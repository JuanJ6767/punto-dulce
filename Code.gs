/**
 * =========================================================================
 * 🌸 PALETERÍA PUNTO DULCE - BACKEND GOOGLE APPS SCRIPT (Code.gs)
 * =========================================================================
 * Maneja Inventario, Producción, Ventas (POS), Cuentas por Cobrar (Fiado)
 * y Cancelaciones/Mermas con sincronización bidireccional.
 */

function doGet(e) {
  try {
    const page = (e && e.parameter && e.parameter.p) ? e.parameter.p : '';
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : '';
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'getInventario') {
      return obtenerInventario(ss);
    } else if (action === 'getCuentasPorCobrar') {
      return obtenerCuentasPorCobrar(ss);
    } else if (action === 'getEstadisticas') {
      return obtenerEstadisticas(ss);
    } else if (action === 'getVentasHoy') {
      return obtenerVentasHoy(ss);
    } else if (action === 'ping') {
      return respuestaJson({ ok: true, mensaje: 'Punto Dulce API activa' });
    }

    // Servir interfaz web interactiva
    if (page === 'produccion' || page === 'taller') {
      return HtmlService.createHtmlOutputFromFile('produccion')
        .setTitle('🌸 Paletería Punto Dulce - Control de Producción')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    } else {
      return HtmlService.createHtmlOutputFromFile('ventas')
        .setTitle('🌸 Paletería Punto Dulce - Punto de Venta (POS)')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
        .addMetaTag('viewport', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');
    }
  } catch (err) {
    // Si aún no se han creado los archivos HTML en Apps Script, responder con el inventario
    return obtenerInventario(SpreadsheetApp.getActiveSpreadsheet());
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    // Esperar hasta 15 segundos para evitar colisiones de doble clic
    lock.waitLock(15000);

    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    let resultado;
    switch (action) {
      case 'registrarVenta':
        resultado = registrarVenta(ss, postData.venta);
        break;
      case 'cancelarVenta':
        resultado = cancelarVenta(ss, postData.cancelacion);
        break;
      case 'registrarAbonoDeuda':
        resultado = registrarAbonoDeuda(ss, postData.abono);
        break;
      case 'ajustarStock':
        resultado = ajustarStock(ss, postData);
        break;
      case 'deshacerMovimiento':
        resultado = deshacerMovimiento(ss, postData);
        break;
      case 'guardarSabor':
        resultado = guardarSabor(ss, postData.saborData);
        break;
      default:
        resultado = { ok: false, error: 'Acción no reconocida en doPost: ' + action };
    }

    return respuestaJson(resultado);
  } catch (err) {
    return respuestaJson({ ok: false, error: err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// -------------------------------------------------------------------------
// FUNCIONES DE NEGOCIO
// -------------------------------------------------------------------------

/**
 * Obtiene el inventario completo desde la hoja "Inventario"
 */
function obtenerInventario(ss) {
  const sheet = ss.getSheetByName('Inventario');
  if (!sheet) return respuestaJson({ ok: false, error: 'No existe la hoja Inventario' });

  const data = sheet.getDataRange().getValues();
  const inventario = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row[0]) continue; // ID vacío
    inventario.push({
      fila: i + 1,
      id: String(row[0]),
      sabor: String(row[1]),
      categoria: String(row[2]),
      precio: Number(row[3]) || 0,
      stock: Number(row[4]) || 0,
      stockMinimo: Number(row[5]) || 3,
      stockMaximo: Number(row[6]) || 20,
      emoji: String(row[7] || '🍧'),
      color: String(row[8] || '#FFF0F6'),
      activo: row[9] !== false && row[9] !== 'FALSE',
      ultimaActualizacion: row[10] ? String(row[10]) : ''
    });
  }

  return respuestaJson({ ok: true, timestamp: new Date().toISOString(), inventario: inventario });
}

/**
 * Registra una venta, descuenta inventario y si es fiado lo anota en Cuentas_Por_Cobrar
 */
function registrarVenta(ss, venta) {
  const sheetVentas = ss.getSheetByName('Ventas') || ss.insertSheet('Ventas');
  const sheetInv = ss.getSheetByName('Inventario');
  const now = new Date();

  // Asegurar cabeceras en Ventas
  if (sheetVentas.getLastRow() === 0) {
    sheetVentas.appendRow([
      'Fecha', 'Hora', 'Folio', 'Total_Dinero', 'Total_Piezas',
      'Metodo_Pago', 'Estado_Pago', 'Cliente_Deudor', 'Abono_Inicial',
      'Saldo_Pendiente', 'Resumen_Productos', 'Notas', 'ID_Transaccion'
    ]);
  }

  // Descontar inventario
  const invData = sheetInv.getDataRange().getValues();
  const resumenItems = [];

  if (Array.isArray(venta.items)) {
    venta.items.forEach(function(item) {
      resumenItems.push(item.cantidad + 'x ' + item.sabor);
      for (let r = 1; r < invData.length; r++) {
        if (String(invData[r][0]) === String(item.id)) {
          const stockActual = Number(invData[r][4]) || 0;
          const nuevoStock = Math.max(0, stockActual - Number(item.cantidad));
          sheetInv.getRange(r + 1, 5).setValue(nuevoStock);
          sheetInv.getRange(r + 1, 11).setValue(now);
          break;
        }
      }
    });
  }

  const resumenStr = resumenItems.join(', ');
  const estadoPago = venta.metodoPago === 'Fiado' ? 'Pendiente' : 'Pagado';
  const deudor = venta.deudor || '';
  const abono = Number(venta.abonoInicial) || 0;
  const saldo = venta.metodoPago === 'Fiado' ? Math.max(0, Number(venta.totalDinero) - abono) : 0;

  // Registrar en hoja Ventas
  sheetVentas.appendRow([
    now.toLocaleDateString(),
    now.toLocaleTimeString(),
    venta.folio || ('#PD-' + Date.now().toString().slice(-4)),
    Number(venta.totalDinero) || 0,
    Number(venta.totalPiezas) || 0,
    venta.metodoPago || 'Efectivo',
    estadoPago,
    deudor,
    abono,
    saldo,
    resumenStr,
    venta.notas || '',
    venta.idVenta || ('VEN-' + Date.now())
  ]);

  // Registrar desglose por sabor en Ventas_Detalle para el Dashboard
  try {
    const sheetDetalle = ss.getSheetByName('Ventas_Detalle') || ss.insertSheet('Ventas_Detalle');
    if (sheetDetalle.getLastRow() === 0) {
      sheetDetalle.appendRow(['Fecha', 'Hora', 'Folio', 'ID_Sabor', 'Sabor', 'Categoria', 'Cantidad', 'Precio_Unitario', 'Subtotal', 'Metodo_Pago']);
    }
    if (Array.isArray(venta.items)) {
      const fechaStr = Utilities.formatDate(now, ss.getSpreadsheetTimeZone() || 'GMT-6', 'yyyy-MM-dd');
      const horaStr = Utilities.formatDate(now, ss.getSpreadsheetTimeZone() || 'GMT-6', 'HH:mm:ss');
      venta.items.forEach(function(item) {
        const cant = Number(item.cantidad) || 0;
        const prec = Number(item.precio) || 0;
        sheetDetalle.appendRow([
          fechaStr,
          horaStr,
          venta.folio || ('#PD-' + Date.now().toString().slice(-4)),
          item.id,
          item.sabor,
          item.categoria || '',
          cant,
          prec,
          cant * prec,
          venta.metodoPago || 'Efectivo'
        ]);
      });
    }
  } catch (errDetalle) {
    console.warn('Error al guardar en Ventas_Detalle:', errDetalle);
  }

  // Si quedó a deber, registrar en pestaña "Cuentas_Por_Cobrar"
  if (venta.metodoPago === 'Fiado' && saldo > 0) {
    registrarEnCuentasPorCobrar(ss, {
      fecha: now,
      folio: venta.folio,
      deudor: deudor,
      total: venta.totalDinero,
      abono: abono,
      saldo: saldo,
      resumen: resumenStr,
      idVenta: venta.idVenta
    });
  }

  return { ok: true, mensaje: 'Venta registrada con éxito', folio: venta.folio };
}

/**
 * Registra o actualiza en la pestaña Cuentas_Por_Cobrar
 */
function registrarEnCuentasPorCobrar(ss, datos) {
  let sheet = ss.getSheetByName('Cuentas_Por_Cobrar');
  if (!sheet) {
    sheet = ss.insertSheet('Cuentas_Por_Cobrar');
    sheet.appendRow([
      'Fecha', 'Hora', 'Folio', 'Compañero_Deudor', 'Monto_Total',
      'Total_Abonado', 'Saldo_Pendiente', 'Estado', 'Detalle_Pedido', 'ID_Venta'
    ]);
  }

  sheet.appendRow([
    datos.fecha.toLocaleDateString(),
    datos.fecha.toLocaleTimeString(),
    datos.folio,
    datos.deudor,
    datos.total,
    datos.abono,
    datos.saldo,
    datos.saldo <= 0 ? 'Liquidado' : 'Pendiente',
    datos.resumen,
    datos.idVenta
  ]);
}

/**
 * Obtiene lista de deudores y cuentas pendientes
 */
function obtenerCuentasPorCobrar(ss) {
  const sheet = ss.getSheetByName('Cuentas_Por_Cobrar');
  if (!sheet) return respuestaJson({ ok: true, deudas: [] });

  const data = sheet.getDataRange().getValues();
  const deudas = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[0] || r[7] === 'Liquidado') continue;
    deudas.push({
      fila: i + 1,
      fecha: String(r[0]),
      hora: String(r[1]),
      folio: String(r[2]),
      deudor: String(r[3]),
      total: Number(r[4]) || 0,
      abonado: Number(r[5]) || 0,
      saldo: Number(r[6]) || 0,
      estado: String(r[7]),
      detalle: String(r[8]),
      idVenta: String(r[9])
    });
  }
  return respuestaJson({ ok: true, deudas: deudas });
}

/**
 * Obtiene las ventas registradas hoy desde la hoja "Ventas" para sincronización híbrida
 */
function obtenerVentasHoy(ss) {
  const sheet = ss.getSheetByName('Ventas');
  if (!sheet) return respuestaJson({ ok: true, ventas: [], maxFolio: 0 });

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return respuestaJson({ ok: true, ventas: [], maxFolio: 0 });

  const hoyStr = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone() || 'GMT-6', 'yyyy-MM-dd');
  const ventas = [];
  let maxFolioNum = 0;

  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (!r[2]) continue; // Folio vacío

    // Interpretar fecha de la fila
    let fechaFilaStr = '';
    if (r[0] instanceof Date) {
      fechaFilaStr = Utilities.formatDate(r[0], ss.getSpreadsheetTimeZone() || 'GMT-6', 'yyyy-MM-dd');
    } else {
      fechaFilaStr = String(r[0]);
    }

    // Extraer número de folio para calcular el siguiente correlativo
    const folioStr = String(r[2]);
    const matchNum = folioStr.match(/#?PD-?(\d+)/i);
    if (matchNum && matchNum[1]) {
      const n = parseInt(matchNum[1], 10);
      if (n > maxFolioNum) maxFolioNum = n;
    }

    // Filtrar solo las ventas del día
    const esHoy = fechaFilaStr === hoyStr || fechaFilaStr.includes(new Date().toLocaleDateString());
    if (esHoy) {
      ventas.push({
        id: String(r[12] || ('VEN-ROW-' + (i + 1))),
        folio: folioStr,
        totalDinero: Number(r[3]) || 0,
        totalPiezas: Number(r[4]) || 0,
        metodoPago: String(r[5] || 'Efectivo'),
        estadoPago: String(r[6] || 'Pagado'),
        deudor: String(r[7] || ''),
        abonoInicial: Number(r[8]) || 0,
        saldoDeudor: Number(r[9]) || 0,
        resumen: String(r[10] || ''),
        nota: String(r[11] || ''),
        hora: r[1] instanceof Date ? Utilities.formatDate(r[1], ss.getSpreadsheetTimeZone() || 'GMT-6', 'HH:mm') : String(r[1] || ''),
        fecha: fechaFilaStr,
        surtido: false
      });
    }
  }

  // Devolver las más recientes primero
  ventas.reverse();

  return respuestaJson({
    ok: true,
    ventas: ventas,
    maxFolio: maxFolioNum,
    totalVentasHoy: ventas.length
  });
}

/**
 * Registra un abono a una deuda existente
 */
function registrarAbonoDeuda(ss, abono) {
  const sheet = ss.getSheetByName('Cuentas_Por_Cobrar');
  if (!sheet) return { ok: false, error: 'No existe hoja Cuentas_Por_Cobrar' };

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === String(abono.folio) || String(data[i][9]) === String(abono.idVenta)) {
      const actualAbonado = Number(data[i][5]) || 0;
      const total = Number(data[i][4]) || 0;
      const nuevoAbonado = actualAbonado + Number(abono.monto);
      const nuevoSaldo = Math.max(0, total - nuevoAbonado);
      const estado = nuevoSaldo === 0 ? 'Liquidado' : 'Pendiente';

      sheet.getRange(i + 1, 6).setValue(nuevoAbonado);
      sheet.getRange(i + 1, 7).setValue(nuevoSaldo);
      sheet.getRange(i + 1, 8).setValue(estado);

      // Bitácora de abonos
      const sheetAbonos = ss.getSheetByName('Bitacora_Abonos') || ss.insertSheet('Bitacora_Abonos');
      if (sheetAbonos.getLastRow() === 0) {
        sheetAbonos.appendRow(['Fecha', 'Hora', 'Folio', 'Deudor', 'Monto_Abonado', 'Saldo_Restante']);
      }
      sheetAbonos.appendRow([
        new Date().toLocaleDateString(),
        new Date().toLocaleTimeString(),
        abono.folio,
        data[i][3],
        abono.monto,
        nuevoSaldo
      ]);

      return { ok: true, nuevoSaldo: nuevoSaldo, estado: estado };
    }
  }
  return { ok: false, error: 'No se encontró el registro de la deuda' };
}

/**
 * Cancelación total o parcial de un pedido
 * Opciones para las piezas: 'Reingreso' (vuelven a stock) o 'Merma' (dañadas)
 */
function cancelarVenta(ss, can) {
  const sheetVentas = ss.getSheetByName('Ventas');
  const sheetInv = ss.getSheetByName('Inventario');
  const sheetMermas = ss.getSheetByName('Mermas') || ss.insertSheet('Mermas');

  if (sheetMermas.getLastRow() === 0) {
    sheetMermas.appendRow(['Fecha', 'Hora', 'Folio_Origen', 'Sabor', 'Cantidad', 'Motivo', 'Costo_Estimado']);
  }

  const now = new Date();

  // Reingresar stock o registrar merma
  if (Array.isArray(can.itemsDevueltos)) {
    const invData = sheetInv.getDataRange().getValues();
    can.itemsDevueltos.forEach(function(item) {
      if (can.destino === 'Reingreso') {
        // Sumar al inventario
        for (let r = 1; r < invData.length; r++) {
          if (String(invData[r][0]) === String(item.id)) {
            const stockActual = Number(invData[r][4]) || 0;
            sheetInv.getRange(r + 1, 5).setValue(stockActual + Number(item.cantidad));
            sheetInv.getRange(r + 1, 11).setValue(now);
            break;
          }
        }
      } else {
        // Merma / Dañada
        sheetMermas.appendRow([
          now.toLocaleDateString(),
          now.toLocaleTimeString(),
          can.folio || '',
          item.sabor,
          item.cantidad,
          can.motivo || 'Cancelación de venta / Dañada',
          item.precio || 0
        ]);
      }
    });
  }

  // Registrar en historial de cancelaciones
  const sheetCanc = ss.getSheetByName('Cancelaciones') || ss.insertSheet('Cancelaciones');
  if (sheetCanc.getLastRow() === 0) {
    sheetCanc.appendRow(['Fecha', 'Hora', 'Folio_Venta', 'Tipo', 'Destino_Piezas', 'Piezas', 'Importe_Ajustado', 'Motivo']);
  }
  sheetCanc.appendRow([
    now.toLocaleDateString(),
    now.toLocaleTimeString(),
    can.folio,
    can.tipo || 'Total',
    can.destino || 'Reingreso',
    can.piezasCanceladas || 0,
    can.importeAjustado || 0,
    can.motivo || 'Cancelado por mostrador'
  ]);

  return { ok: true, mensaje: 'Cancelación procesada correctamente' };
}

/**
 * Ajustar stock desde la app de Producción
 */
function ajustarStock(ss, data) {
  const sheetInv = ss.getSheetByName('Inventario');
  const sheetMov = ss.getSheetByName('Movimientos_Produccion') || ss.insertSheet('Movimientos_Produccion');
  const now = new Date();

  if (sheetMov.getLastRow() === 0) {
    sheetMov.appendRow(['Fecha', 'Hora', 'ID_Sabor', 'Sabor', 'Cambio', 'Stock_Resultante', 'Tipo', 'Notas', 'ID_Movimiento']);
  }

  const invData = sheetInv.getDataRange().getValues();
  let stockNuevo = 0;
  let nombreSabor = '';

  for (let r = 1; r < invData.length; r++) {
    if (String(invData[r][0]) === String(data.idSabor)) {
      nombreSabor = String(invData[r][1]);
      const stockActual = Number(invData[r][4]) || 0;
      stockNuevo = Math.max(0, stockActual + Number(data.delta));
      sheetInv.getRange(r + 1, 5).setValue(stockNuevo);
      sheetInv.getRange(r + 1, 11).setValue(now);
      break;
    }
  }

  sheetMov.appendRow([
    now.toLocaleDateString(),
    now.toLocaleTimeString(),
    data.idSabor,
    nombreSabor,
    data.delta,
    stockNuevo,
    data.tipoMovimiento || 'Producción',
    data.notas || '',
    data.idMovimiento || ('MOV-' + Date.now())
  ]);

  return { ok: true, stockNuevo: stockNuevo };
}

/**
 * Deshacer el último movimiento de producción
 */
function deshacerMovimiento(ss, data) {
  const sheetInv = ss.getSheetByName('Inventario');
  const sheetMov = ss.getSheetByName('Movimientos_Produccion') || ss.insertSheet('Movimientos_Produccion');
  const now = new Date();

  const invData = sheetInv.getDataRange().getValues();
  let stockNuevo = 0;
  let nombreSabor = '';

  for (let r = 1; r < invData.length; r++) {
    if (String(invData[r][0]) === String(data.idSabor)) {
      nombreSabor = String(invData[r][1]);
      const stockActual = Number(invData[r][4]) || 0;
      // Revertir el delta original
      stockNuevo = Math.max(0, stockActual - Number(data.deltaOriginal));
      sheetInv.getRange(r + 1, 5).setValue(stockNuevo);
      sheetInv.getRange(r + 1, 11).setValue(now);
      break;
    }
  }

  sheetMov.appendRow([
    now.toLocaleDateString(),
    now.toLocaleTimeString(),
    data.idSabor,
    nombreSabor,
    -Number(data.deltaOriginal),
    stockNuevo,
    '↩️ Reversa / Deshacer',
    'Cancelación de movimiento previo',
    data.idMovimiento || ('REV-' + Date.now())
  ]);

  return { ok: true, stockNuevo: stockNuevo };
}

/**
 * Guardar o editar un sabor
 */
function guardarSabor(ss, item) {
  const sheet = ss.getSheetByName('Inventario');
  const data = sheet.getDataRange().getValues();
  let encontrado = false;

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === String(item.id)) {
      sheet.getRange(r + 1, 2).setValue(item.sabor);
      sheet.getRange(r + 1, 3).setValue(item.categoria);
      sheet.getRange(r + 1, 4).setValue(item.precio);
      sheet.getRange(r + 1, 6).setValue(item.stockMinimo);
      sheet.getRange(r + 1, 7).setValue(item.stockMaximo);
      if (item.emoji) sheet.getRange(r + 1, 8).setValue(item.emoji);
      encontrado = true;
      break;
    }
  }

  if (!encontrado) {
    sheet.appendRow([
      item.id, item.sabor, item.categoria, item.precio, item.stock || 0,
      item.stockMinimo || 3, item.stockMaximo || 20, item.emoji || '🍧',
      item.color || '#FFF0F6', true, new Date()
    ]);
  }

  return { ok: true };
}

/**
 * Obtiene el análisis y dashboard histórico de demanda y sugerencias de stock
 */
function obtenerEstadisticas(ss) {
  const sheetDash = ss.getSheetByName('Dashboard_Historico');
  if (!sheetDash) {
    return respuestaJson({ ok: false, error: 'Dashboard no inicializado' });
  }

  const values = sheetDash.getDataRange().getValues();
  const sabores = [];

  for (let r = 3; r < values.length; r++) {
    const row = values[r];
    if (!row[0]) continue;
    sabores.push({
      id: String(row[0]),
      sabor: String(row[1]),
      categoria: String(row[2]),
      stockActual: Number(row[3]) || 0,
      ventasSemana: Number(row[4]) || 0,
      ventasMes: Number(row[5]) || 0,
      minActual: Number(row[6]) || 3,
      maxActual: Number(row[7]) || 20,
      ventasTrimestre: Number(row[8]) || 0,
      ventasTotales: Number(row[9]) || 0,
      minSugerido: Number(row[10]) || Number(row[6]) || 3,
      maxSugerido: Number(row[11]) || Number(row[7]) || 20,
      nivelDemanda: String(row[12] || 'Sin ventas aún')
    });
  }

  // Ordenar por ventas totales
  sabores.sort(function(a, b) { return b.ventasTotales - a.ventasTotales; });

  const totalPaletasVendidas = sabores.reduce(function(s, x) { return s + x.ventasTotales; }, 0);

  return respuestaJson({
    ok: true,
    timestamp: new Date().toISOString(),
    estadisticas: {
      sabores: sabores,
      totalPaletasVendidas: totalPaletasVendidas,
      topSabor: (sabores.length > 0 && totalPaletasVendidas > 0) ? sabores[0].sabor : 'Sin ventas aún'
    }
  });
}

function respuestaJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
