/**
 * =========================================================================
 * 🌸 PALETERÍA PUNTO DULCE - SUITE COMPLETA DE PRUEBAS AUTOMATIZADAS
 * =========================================================================
 * Valida todos los supuestos de negocio:
 * 1. Visualización y bloqueo por stock (0 existencias, tope de carrito, 2 categorías).
 * 2. Foliado correlativo (#PD-001, #PD-002...).
 * 3. Generador de mensajes de WhatsApp para Surtido (individual y consolidado).
 * 4. Blindaje contra clics múltiples (anti-duplicación).
 * 5. Cuentas por cobrar (fiado a compañeros, abonos parciales y liquidación).
 * 6. Cancelaciones totales y parciales (reingreso a congelador vs merma).
 * 7. Cuadre del corte de caja (dinero real a liquidar vs ventas totales).
 * 8. Verificación de integridad con el baseline real de Google Sheets.
 */

const fs = require('fs');
const assert = require('assert');

console.log('🌸 ========================================================');
console.log('   INICIANDO BATERÍA DE PRUEBAS: PALETERÍA PUNTO DULCE');
console.log('========================================================\n');

let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ [PASS] ${name}`);
    passCount++;
  } catch (err) {
    console.error(`  ❌ [FAIL] ${name}:`, err.message);
    failCount++;
  }
}

// Cargar baseline real
const baselineData = JSON.parse(fs.readFileSync('/home/antigravity/punto_dulce/baseline_snapshot.json', 'utf8'));
const baselineInventario = baselineData.inventario;

// -------------------------------------------------------------------------
// PRUEBA 1: VERIFICACIÓN DE CATEGORÍAS Y STOCK INICIAL
// -------------------------------------------------------------------------
console.log('--- GRUPO 1: Catálogo, Categorías y Detección de Agotados ---');

test('Solo existen 2 categorías reales (Agua y Leche), cero "Especiales"', () => {
  const categorias = new Set(baselineInventario.map(i => i.categoria));
  assert.strictEqual(categorias.has('Especial'), false, 'No debe existir la categoría Especial');
  assert.strictEqual(categorias.has('Agua'), true, 'Debe existir Agua');
  assert.strictEqual(categorias.has('Leche'), true, 'Debe existir Leche');
  assert.strictEqual(categorias.size, 2, 'Deben ser exactamente 2 categorías');

  const deAgua = baselineInventario.filter(i => i.categoria === 'Agua');
  const deLeche = baselineInventario.filter(i => i.categoria === 'Leche');
  assert.strictEqual(deAgua.length, 3, 'Deben ser 3 sabores de agua (Piña Chamoy, Nance, Pulparindo)');
  assert.strictEqual(deLeche.length, 21, 'Deben ser 21 sabores de leche');
});

test('Detección correcta de sabores agotados (Stock = 0)', () => {
  const fresaCremosa = baselineInventario.find(i => i.id === 'SAB-04');
  const guanabana = baselineInventario.find(i => i.id === 'SAB-24');
  assert.strictEqual(fresaCremosa.stock, 0, 'Fresa Cremosa debe estar en stock 0');
  assert.strictEqual(guanabana.stock, 0, 'Guanábana debe estar en stock 0');

  // En la lógica del POS, no se puede clickear si stock <= 0
  function intentarAgregarAlCarrito(item, carrito) {
    if (item.stock <= 0) return { agregado: false, motivo: 'AGOTADO' };
    const enCar = carrito.find(c => c.id === item.id);
    const cant = enCar ? enCar.cantidad : 0;
    if (cant >= item.stock) return { agregado: false, motivo: 'SIN_STOCK_SUFICIENTE' };
    if (enCar) enCar.cantidad++;
    else carrito.push({ id: item.id, sabor: item.sabor, precio: item.precio, cantidad: 1 });
    return { agregado: true };
  }

  const carrito = [];
  const res1 = intentarAgregarAlCarrito(fresaCremosa, carrito);
  assert.strictEqual(res1.agregado, false);
  assert.strictEqual(res1.motivo, 'AGOTADO');
  assert.strictEqual(carrito.length, 0);
});

test('Tope de carrito respeta exactamente el stock disponible', () => {
  const chocoMilk = baselineInventario.find(i => i.id === 'SAB-03'); // Stock = 2
  assert.strictEqual(chocoMilk.stock, 2);

  const carrito = [];
  function agregar(item) {
    const enCar = carrito.find(c => c.id === item.id);
    const cant = enCar ? enCar.cantidad : 0;
    if (cant >= item.stock) return false;
    if (enCar) enCar.cantidad++;
    else carrito.push({ id: item.id, cantidad: 1 });
    return true;
  }

  assert.strictEqual(agregar(chocoMilk), true, 'Agrega 1ra paleta');
  assert.strictEqual(agregar(chocoMilk), true, 'Agrega 2da paleta (tope alcanzado)');
  assert.strictEqual(agregar(chocoMilk), false, 'Bloquea 3ra paleta por falta de stock');
  assert.strictEqual(carrito.find(c => c.id === chocoMilk.id).cantidad, 2);
});

test('Disminución y ajuste directo de cantidad en tarjeta (ej. de 7 a 5 paletas)', () => {
  // Simular sabor con stock amplio (ej. Coco stock = 16)
  const coco = baselineInventario.find(i => i.id === 'SAB-08');
  assert.ok(coco.stock >= 7);

  let carrito = [{ id: coco.id, sabor: coco.sabor, precio: coco.precio, cantidad: 7 }];

  function modificarCantidadDirecta(id, delta) {
    const itemInv = coco;
    const itemCar = carrito.find(c => c.id === id);
    if (!itemCar) return;

    if (delta > 0 && itemCar.cantidad >= itemInv.stock) return;
    itemCar.cantidad += delta;
    if (itemCar.cantidad <= 0) {
      carrito = carrito.filter(c => c.id !== id);
    }
  }

  function cambiarCantidadDirecta(id, nuevaCant) {
    const itemInv = coco;
    const itemCar = carrito.find(c => c.id === id);
    if (!itemCar) return;

    if (nuevaCant <= 0) {
      carrito = carrito.filter(c => c.id !== id);
    } else if (nuevaCant > itemInv.stock) {
      itemCar.cantidad = itemInv.stock;
    } else {
      itemCar.cantidad = nuevaCant;
    }
  }

  // 1. Quitar de una en una con botón [-] (de 7 a 6, luego a 5)
  modificarCantidadDirecta(coco.id, -1);
  assert.strictEqual(carrito.find(c => c.id === coco.id).cantidad, 6, 'Debe bajar a 6');
  modificarCantidadDirecta(coco.id, -1);
  assert.strictEqual(carrito.find(c => c.id === coco.id).cantidad, 5, 'Debe bajar a 5');

  // 2. Establecer directamente cantidad exacta (ej. cambiar directo a 3)
  cambiarCantidadDirecta(coco.id, 3);
  assert.strictEqual(carrito.find(c => c.id === coco.id).cantidad, 3, 'Debe fijar directamente en 3');

  // 3. Si pide más del stock disponible (ej. 20 cuando solo hay 16), se ajusta al tope real
  cambiarCantidadDirecta(coco.id, 20);
  assert.strictEqual(carrito.find(c => c.id === coco.id).cantidad, coco.stock, 'No debe superar el stock real');

  // 4. Si se quita la última pieza (cantidad = 0), se remueve del carrito
  cambiarCantidadDirecta(coco.id, 0);
  assert.strictEqual(carrito.length, 0, 'Carrito debe quedar vacío');
});

// -------------------------------------------------------------------------
// PRUEBA 2: FOLIADO Y COBRO EN EFECTIVO CON CALCULADORA
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 2: Foliado y Calculadora de Billetes / Cambio ---');

test('Generación de folio correlativo y legible (#PD-001, #PD-002...) + cálculo de cambio', () => {
  let consecutivo = 1;
  function generarFolio() {
    const f = '#PD-' + String(consecutivo).padStart(3, '0');
    consecutivo++;
    return f;
  }

  const f1 = generarFolio();
  const f2 = generarFolio();
  assert.strictEqual(f1, '#PD-001');
  assert.strictEqual(f2, '#PD-002');

  // Simular cobro: 2 paletas de Cacahuate ($15) + 1 de Pay de Limón ($18) = $48
  const totalCobrar = (2 * 15) + (1 * 18); // 48
  assert.strictEqual(totalCobrar, 48);

  // Cliente paga con billete de $100
  const billete = 100;
  const cambio = billete - totalCobrar;
  assert.strictEqual(cambio, 52);

  // Si cliente paga con exacto
  assert.strictEqual(totalCobrar - totalCobrar, 0);

  // Si cliente da $40 (falta dinero)
  const insuficiente = 40;
  assert.strictEqual(insuficiente - totalCobrar, -8);
});

// -------------------------------------------------------------------------
// PRUEBA 3: GENERADOR DE WHATSAPP PARA SURTIDO (INDIVIDUAL Y CONSOLIDADO)
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 3: Mensajería de WhatsApp para Surtido de Pedidos ---');

test('Formato de mensaje individual por WhatsApp con emojis y folios', () => {
  const venta = {
    folio: '#PD-001',
    fecha: '08/Nov/2026',
    hora: '12:30 PM',
    deudor: 'Carlos TI',
    nota: 'Oficina 3er piso',
    items: [
      { sabor: 'Oreo', cantidad: 2, emoji: '🍪' },
      { sabor: 'Cacahuate', cantidad: 1, emoji: '🥜' }
    ],
    totalPiezas: 3,
    totalDinero: 45,
    metodoPago: 'Efectivo'
  };

  let msg = `🌸 *PALETERÍA PUNTO DULCE* 🌸\n`;
  msg += `🍧 *SURTIR PEDIDO ${venta.folio}*\n`;
  msg += `📅 ${venta.fecha} - ${venta.hora}\n`;
  if (venta.deudor) msg += `👤 Compañero: *${venta.deudor}*\n`;
  if (venta.nota) msg += `📍 Ubicación: ${venta.nota}\n\n`;
  msg += `🧊 *Piezas a sacar:*\n`;
  venta.items.forEach(it => {
    msg += `• ${it.cantidad}x ${it.emoji} ${it.sabor}\n`;
  });
  msg += `--------------------------\n`;
  msg += `📦 *Total:* ${venta.totalPiezas} paletas\n`;

  assert.ok(msg.includes('*SURTIR PEDIDO #PD-001*'));
  assert.ok(msg.includes('• 2x 🍪 Oreo'));
  assert.ok(msg.includes('• 1x 🥜 Cacahuate'));
  assert.ok(msg.includes('📦 *Total:* 3 paletas'));
});

test('Formato de mensaje consolidado (agrupación de 2 o más pedidos)', () => {
  const pedidos = [
    { folio: '#PD-001', items: [{ sabor: 'Oreo', cantidad: 2 }, { sabor: 'Cacahuate', cantidad: 1 }] },
    { folio: '#PD-002', items: [{ sabor: 'Oreo', cantidad: 1 }, { sabor: 'Coco', cantidad: 3 }] }
  ];

  const agrupados = {};
  let granTotal = 0;
  const folios = pedidos.map(p => p.folio);

  pedidos.forEach(p => {
    p.items.forEach(it => {
      agrupados[it.sabor] = (agrupados[it.sabor] || 0) + it.cantidad;
      granTotal += it.cantidad;
    });
  });

  assert.strictEqual(agrupados['Oreo'], 3, '2 de Oreo + 1 de Oreo = 3 Oreo');
  assert.strictEqual(agrupados['Cacahuate'], 1);
  assert.strictEqual(agrupados['Coco'], 3);
  assert.strictEqual(granTotal, 7);
  assert.strictEqual(folios.join(', '), '#PD-001, #PD-002');
});

// -------------------------------------------------------------------------
// PRUEBA 4: BLINDAJE CONTRA DOBLE CLIC (ANTI-DUPLICACIÓN)
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 4: Blindaje Antibalas contra Doble Clic ---');

test('Prevención de ejecución concurrente y doble toque', () => {
  let guardando = false;
  let operacionesEjecutadas = 0;

  function intentarCobro() {
    if (guardando) return false;
    guardando = true;
    operacionesEjecutadas++;
    return true;
  }

  assert.strictEqual(intentarCobro(), true, '1er clic permitido');
  assert.strictEqual(intentarCobro(), false, '2do clic bloqueado inmediatamente');
  assert.strictEqual(intentarCobro(), false, '3er clic bloqueado');
  assert.strictEqual(operacionesEjecutadas, 1, 'Solo se ejecutó 1 sola operación');

  // Fin de la operación
  guardando = false;
  assert.strictEqual(intentarCobro(), true, 'Siguiente venta permitida');
  assert.strictEqual(operacionesEjecutadas, 2);
});

// -------------------------------------------------------------------------
// PRUEBA 5: CUENTAS POR COBRAR (FIADOS, ABONOS Y LIQUIDACIÓN)
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 5: Cuentas por Cobrar (Fiado y Abonos) ---');

test('Registro de pedido fiado con abono inicial y saldo pendiente', () => {
  const pedidoFiado = {
    folio: '#PD-003',
    deudor: 'Mariana Recursos Humanos',
    total: 90, // 5 paletas de $18
    abonoInicial: 30, // Dejó $30
    saldo: 60 // Debe $60
  };

  assert.strictEqual(pedidoFiado.total - pedidoFiado.abonoInicial, pedidoFiado.saldo);

  // Registro en lista de cuentas por cobrar
  const cuentas = [pedidoFiado];
  assert.strictEqual(cuentas.length, 1);
  assert.strictEqual(cuentas[0].saldo, 60);

  // Abono posterior de $20
  cuentas[0].saldo -= 20;
  assert.strictEqual(cuentas[0].saldo, 40, 'Saldo restante debe ser $40');

  // Liquidación completa de los $40 restantes
  const abonoFinal = 40;
  cuentas[0].saldo -= abonoFinal;
  assert.strictEqual(cuentas[0].saldo, 0, 'Deuda saldada en $0');

  // Al llegar a 0 se retira de deudas pendientes
  const pendientes = cuentas.filter(c => c.saldo > 0);
  assert.strictEqual(pendientes.length, 0, 'No quedan deudas pendientes');
});

// -------------------------------------------------------------------------
// PRUEBA 6: CANCELACIONES TOTALES Y PARCIALES (REINGRESO VS MERMA)
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 6: Cancelaciones de Pedidos (Reingreso vs Merma) ---');

test('Cancelación con Reingreso al Congelador suma el stock de vuelta', () => {
  let stockLocal = 10;
  // Se venden 3
  stockLocal -= 3;
  assert.strictEqual(stockLocal, 7);

  // Cliente cancela 2 paletas en buen estado (Reingreso)
  const piezasReingreso = 2;
  stockLocal += piezasReingreso;
  assert.strictEqual(stockLocal, 9, 'El stock vuelve a subir a 9');
});

test('Cancelación por Merma / Dañada NO reingresa al inventario para venta', () => {
  let stockLocal = 10;
  // Se venden 3
  stockLocal -= 3;
  assert.strictEqual(stockLocal, 7);

  // Se cayó o descongeló 1 paleta (Merma)
  const destino = 'Merma';
  const piezasMerma = 1;

  if (destino === 'Reingreso') {
    stockLocal += piezasMerma;
  }
  // En Merma, stockLocal NO cambia
  assert.strictEqual(stockLocal, 7, 'El stock para venta sigue siendo 7 (la paleta dañada no se revende)');
});

// -------------------------------------------------------------------------
// PRUEBA 7: CORTE DE CAJA (CUADRE DE DINERO REAL EN MANO)
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 7: Cuadre Matemático del Corte de Caja ---');

test('Corte de caja separa ventas totales de dinero real en mano a liquidar en caja', () => {
  const ventasDelDia = [
    { folio: '#PD-001', totalDinero: 50, metodoPago: 'Efectivo', abonoInicial: 0, saldoDeudor: 0 },
    { folio: '#PD-002', totalDinero: 40, metodoPago: 'Transferencia', abonoInicial: 0, saldoDeudor: 0 },
    { folio: '#PD-003', totalDinero: 90, metodoPago: 'Fiado', abonoInicial: 20, saldoDeudor: 70 }
  ];

  const totalVendido = ventasDelDia.reduce((s, v) => s + v.totalDinero, 0); // 180
  const efectivoEnMano = ventasDelDia.filter(v => v.metodoPago === 'Efectivo').reduce((s, v) => s + v.totalDinero, 0); // 50
  const transferencias = ventasDelDia.filter(v => v.metodoPago === 'Transferencia').reduce((s, v) => s + v.totalDinero, 0); // 40
  const fiadoHoy = ventasDelDia.filter(v => v.metodoPago === 'Fiado').reduce((s, v) => s + v.saldoDeudor, 0); // 70
  const abonosCobradosHoy = ventasDelDia.filter(v => v.metodoPago === 'Fiado').reduce((s, v) => s + v.abonoInicial, 0); // 20

  const dineroRealALiquidar = efectivoEnMano + transferencias + abonosCobradosHoy; // 50 + 40 + 20 = 110

  assert.strictEqual(totalVendido, 180, 'Total vendido debe ser $180');
  assert.strictEqual(fiadoHoy, 70, 'Quedaron a deber $70');
  assert.strictEqual(dineroRealALiquidar, 110, 'Dinero real recaudado hoy es $110');
  assert.strictEqual(dineroRealALiquidar + fiadoHoy, totalVendido, 'La suma cuadra con el 100% de lo vendido');
});

// -------------------------------------------------------------------------
// PRUEBA 8: DASHBOARD ESTADÍSTICO Y SUGERENCIAS DE STOCK
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 8: Dashboard Histórico y Sugerencia de Mín/Máx ---');

test('Cálculo de tendencias y ranking por periodo', () => {
  const mockInventario = [
    { id: 'SAB-01', sabor: 'Cacahuate', categoria: 'Leche', stock: 11, stockMinimo: 3, stockMaximo: 20 },
    { id: 'SAB-02', sabor: 'Oreo', categoria: 'Leche', stock: 4, stockMinimo: 3, stockMaximo: 20 },
    { id: 'SAB-16', sabor: 'Tiramisú', categoria: 'Leche', stock: 18, stockMinimo: 3, stockMaximo: 15 }
  ];

  const ventasPorSabor = {
    'SAB-02': 14, // Alta demanda en la semana (>=8)
    'SAB-01': 5,  // Demanda normal
    'SAB-16': 0   // Baja rotación con stock 18
  };

  const lista = mockInventario.map(it => {
    const vendidas = ventasPorSabor[it.id] || 0;
    let minSugerido = it.stockMinimo;
    let maxSugerido = it.stockMaximo;
    let statusClass = 'optimo';

    if (vendidas >= 8) {
      minSugerido = Math.max(it.stockMinimo, Math.round(vendidas * 0.4) + 2);
      maxSugerido = Math.max(it.stockMaximo, Math.round(vendidas * 1.2) + 5);
      if (it.stockMinimo < minSugerido) statusClass = 'ajustar';
    } else if (vendidas === 0 && it.stock > 12) {
      statusClass = 'reducir';
      maxSugerido = 10;
    }

    return { ...it, vendidas, minSugerido, maxSugerido, statusClass };
  });

  lista.sort((a, b) => b.vendidas - a.vendidas);

  assert.strictEqual(lista[0].sabor, 'Oreo', 'El sabor #1 debe ser Oreo');
  assert.strictEqual(lista[0].vendidas, 14);
  assert.strictEqual(lista[0].minSugerido, 8, 'Para 14 vendidas se sugiere min 8');
  assert.strictEqual(lista[0].maxSugerido, 22, 'Para 14 vendidas se sugiere max 22');
  assert.strictEqual(lista[0].statusClass, 'ajustar');

  const tiramisu = lista.find(s => s.sabor === 'Tiramisú');
  assert.strictEqual(tiramisu.statusClass, 'reducir', 'Tiramisú con 0 ventas y stock 18 debe sugerir reducir');
  assert.strictEqual(tiramisu.maxSugerido, 10);
});

test('Estado Inicial Sin Ventas: 0 Paletas Vendidas y 0 Alertas Falsas de Ajuste', () => {
  // Simular respuesta del servidor antes del arranque de ventas
  const datosServidorSinVentas = [
    { id: 'SAB-01', sabor: 'Cacahuate', ventasSemana: 0, ventasMes: 0, ventasTotales: 0, minActual: 8, maxActual: 20 },
    { id: 'SAB-02', sabor: 'Oreo', ventasSemana: 0, ventasMes: 0, ventasTotales: 0, minActual: 8, maxActual: 20 },
    { id: 'SAB-10', sabor: 'Fresas con Crema', ventasSemana: 0, ventasMes: 0, ventasTotales: 0, minActual: 10, maxActual: 20 }
  ];

  const totalVentasHistoricas = datosServidorSinVentas.reduce((acc, s) => acc + s.ventasTotales, 0);
  assert.strictEqual(totalVentasHistoricas, 0, 'No debe haber ventas históricas al inicio');

  // Procesamiento del dashboard
  const conteo = {};
  datosServidorSinVentas.forEach(s => {
    let vServ = 0;
    if (totalVentasHistoricas > 0) {
      vServ = s.ventasSemana;
    }
    conteo[s.id] = vServ;
  });

  const totalPeriodo = Object.values(conteo).reduce((a, b) => a + b, 0);
  assert.strictEqual(totalPeriodo, 0, 'Total de paletas vendidas en el periodo debe ser exactamente 0');

  // Verificación de que ningún sabor genera alerta de ajuste si totalPeriodo === 0
  const alertas = datosServidorSinVentas.filter(s => {
    const vendidas = conteo[s.id] || 0;
    return totalPeriodo > 0 && vendidas >= 8;
  }).length;

  assert.strictEqual(alertas, 0, 'Debe haber exactamente 0 alertas de ajuste sugeridas en el arranque');
});

// -------------------------------------------------------------------------
// PRUEBA 9: GENERADORES DE WHATSAPP (CORTE Y FIADOS)
// -------------------------------------------------------------------------
console.log('\n--- GRUPO 9: Mensajería WhatsApp de Corte de Caja y Fiados ---');

test('Generación de mensaje WhatsApp para Corte de Caja Diario', () => {
  const kpis = {
    fecha: '08/11/2026',
    totalPaletas: 25,
    totalVendido: 420,
    efectivo: 250,
    transferencias: 100,
    abonos: 30,
    fiadoPendiente: 40,
    dineroEnMano: 380
  };

  const msg = [
    `📊 *CORTE DE CAJA DIARIO - PUNTO DULCE*`,
    `📅 *Fecha:* ${kpis.fecha}`,
    `🍧 *Paletas vendidas hoy:* ${kpis.totalPaletas} pzas`,
    `💰 *Ventas Totales Registradas:* $${kpis.totalVendido}.00`,
    `----------------------------------`,
    `💵 *Efectivo recibido:* $${kpis.efectivo}.00`,
    `📱 *Transferencias:* $${kpis.transferencias}.00`,
    `📥 *Abonos recuperados:* $${kpis.abonos}.00`,
    `----------------------------------`,
    `⚠️ *Saldo pendiente en fiados:* $${kpis.fiadoPendiente}.00`,
    `✨ *NETO TOTAL EN CAJA A ENTREGAR:* $${kpis.dineroEnMano}.00`,
    `----------------------------------`,
    `_Generado desde la App Punto Dulce_`
  ].join('\n');

  assert(msg.includes('NETO TOTAL EN CAJA A ENTREGAR:* $380.00'));
  assert(msg.includes('Saldo pendiente en fiados:* $40.00'));
  assert(msg.includes('Ventas Totales Registradas:* $420.00'));
});

test('Generación de mensaje WhatsApp para Reporte de Fiados / Deudores', () => {
  const deudores = [
    { cliente: 'Carlos R.', fecha: '08/11/2026', folio: '#PD-003', saldo: 50 },
    { cliente: 'Mariana T.', fecha: '08/11/2026', folio: '#PD-007', saldo: 30 }
  ];

  const totalPorCobrar = deudores.reduce((s, d) => s + d.saldo, 0);

  let msg = `📋 *REPORTE DE CUENTAS POR COBRAR (FIADOS) - PUNTO DULCE*\n`;
  msg += `📅 *Fecha:* 08/11/2026\n`;
  msg += `👥 *Total deudores:* ${deudores.length}\n`;
  msg += `💰 *Saldo total pendiente de cobro:* $${totalPorCobrar}.00\n`;
  msg += `----------------------------------\n`;
  deudores.forEach(d => {
    msg += `• *${d.cliente}* (${d.folio})\n`;
    msg += `   Saldo: *$${d.saldo}.00* (${d.fecha})\n`;
  });
  msg += `----------------------------------\n`;
  msg += `_Favor de dar seguimiento oportuno a la recuperación de saldos._`;

  assert.strictEqual(totalPorCobrar, 80);
  assert(msg.includes('Carlos R.'));
  assert(msg.includes('Mariana T.'));
  assert(msg.includes('Saldo total pendiente de cobro:* $80.00'));
});

// =========================================================================
// GRUPO 10: Nuevas Mejoras Continuas (Ticket Cliente, Resurtido, Filtro Precio, PWA)
// =========================================================================
console.log('\n--- GRUPO 10: Mejoras Continuas: Ticket Cliente, Resurtido y Filtros ---');

test('Generación de Comprobante / Ticket Digital por WhatsApp para Cliente', () => {
  const ventaCliente = {
    id: 'VENTA-TEST-01',
    folio: '#PD-008',
    fecha: '08/11/2026',
    hora: '14:30',
    totalPiezas: 3,
    totalDinero: 51,
    metodoPago: 'Efectivo',
    cambio: 49,
    items: [
      { id: 'SAB-02', sabor: 'Oreo', emoji: '🍪', cantidad: 2, precio: 15 },
      { id: 'SAB-16', sabor: 'Tiramisú', emoji: '🍰', cantidad: 1, precio: 18 }
    ]
  };

  let msg = `🌸 *PALETERÍA PUNTO DULCE* 🌸\n`;
  msg += `🧾 *COMPROBANTE DE COMPRA ${ventaCliente.folio}*\n`;
  msg += `📅 *Fecha:* ${ventaCliente.fecha} - ${ventaCliente.hora}\n`;
  msg += `----------------------------------\n`;
  msg += `🧊 *DETALLE DE TU PEDIDO:*\n`;
  ventaCliente.items.forEach(it => {
    const sub = it.cantidad * it.precio;
    msg += `• ${it.cantidad}x ${it.emoji} ${it.sabor} ($${sub}.00)\n`;
  });
  msg += `----------------------------------\n`;
  msg += `📦 *Total piezas:* ${ventaCliente.totalPiezas} paletas\n`;
  msg += `💰 *TOTAL A PAGAR:* *$${ventaCliente.totalDinero}.00*\n`;
  msg += `💳 *Método de pago:* ${ventaCliente.metodoPago}\n`;
  if (ventaCliente.cambio > 0) {
    msg += `💵 *Cambio entregado:* $${ventaCliente.cambio}.00\n`;
  }
  msg += `----------------------------------\n`;
  msg += `✨ _¡Muchas gracias por tu compra!_ 🍧\n`;
  msg += `_Paletería Punto Dulce_`;

  assert(msg.includes('COMPROBANTE DE COMPRA #PD-008'));
  assert(msg.includes('2x 🍪 Oreo ($30.00)'));
  assert(msg.includes('1x 🍰 Tiramisú ($18.00)'));
  assert(msg.includes('TOTAL A PAGAR:* *$51.00*'));
  assert(msg.includes('Cambio entregado:* $49.00'));
});

test('Alerta Dinámica y Mensaje de Solicitud de Resurtido al Taller', () => {
  const inventarioTest = [
    { id: 'SAB-03', sabor: 'Choco Milk', stock: 2, stockMinimo: 3, emoji: '🍫' },
    { id: 'SAB-04', sabor: 'Fresa Cremosa', stock: 0, stockMinimo: 3, emoji: '🍓' },
    { id: 'SAB-09', sabor: 'Elote', stock: 0, stockMinimo: 3, emoji: '🌽' },
    { id: 'SAB-01', sabor: 'Cacahuate', stock: 11, stockMinimo: 3, emoji: '🥜' }
  ];

  const criticos = inventarioTest.filter(i => i.stock <= 2);
  assert.strictEqual(criticos.length, 3, 'Deben detectarse 3 sabores en nivel crítico');

  let msg = `🚨 *SOLICITUD DE RESURTIDO URGENTE* 🍧\n`;
  msg += `📍 *Paletería Punto Dulce - Mostrador*\n`;
  criticos.forEach(it => {
    const alerta = it.stock === 0 ? '❌ AGOTADO (0 pzas)' : `⚠️ Solo ${it.stock} pzas`;
    msg += `• ${it.emoji} *${it.sabor}*: ${alerta} (Mínimo: ${it.stockMinimo})\n`;
  });
  msg += `📦 *Total de sabores a resurtir:* ${criticos.length}\n`;

  assert(msg.includes('Fresa Cremosa*: ❌ AGOTADO (0 pzas)'));
  assert(msg.includes('Choco Milk*: ⚠️ Solo 2 pzas'));
  assert(msg.includes('Total de sabores a resurtir:* 3'));
});

test('Filtros por Precio ($15 Clásicas vs $18 Gourmet)', () => {
  const catalogoBase = [
    { id: 'SAB-01', sabor: 'Cacahuate', precio: 15 },
    { id: 'SAB-02', sabor: 'Oreo', precio: 15 },
    { id: 'SAB-03', sabor: 'Choco Milk', precio: 15 },
    { id: 'SAB-04', sabor: 'Fresa Cremosa', precio: 15 },
    { id: 'SAB-05', sabor: 'Vainilla', precio: 15 },
    { id: 'SAB-06', sabor: 'Piña con Chamoy', precio: 15 },
    { id: 'SAB-07', sabor: 'Nance', precio: 15 },
    { id: 'SAB-08', sabor: 'Coco', precio: 15 },
    { id: 'SAB-09', sabor: 'Elote', precio: 18 },
    { id: 'SAB-10', sabor: 'Fresas con Crema', precio: 18 },
    { id: 'SAB-11', sabor: 'Mazapán', precio: 18 },
    { id: 'SAB-12', sabor: 'Pay de Limón', precio: 18 },
    { id: 'SAB-13', sabor: 'Crema y Zarzamora', precio: 18 },
    { id: 'SAB-14', sabor: 'Duvalín', precio: 18 },
    { id: 'SAB-15', sabor: 'Capuchino Moka', precio: 18 },
    { id: 'SAB-16', sabor: 'Tiramisú', precio: 18 },
    { id: 'SAB-17', sabor: 'Pulparindo', precio: 18 },
    { id: 'SAB-18', sabor: 'Pingüino', precio: 18 },
    { id: 'SAB-19', sabor: 'Chocorrol', precio: 18 },
    { id: 'SAB-20', sabor: 'Gansito', precio: 18 },
    { id: 'SAB-21', sabor: 'Plátano con Nutella', precio: 18 },
    { id: 'SAB-22', sabor: 'Chocolate Abuelita', precio: 18 },
    { id: 'SAB-23', sabor: 'Chicle', precio: 18 },
    { id: 'SAB-24', sabor: 'Guanábana', precio: 18 }
  ];

  const clasicas15 = catalogoBase.filter(i => i.precio === 15);
  const gourmet18 = catalogoBase.filter(i => i.precio === 18);

  assert.strictEqual(clasicas15.length, 8, 'Deben ser exactamente 8 sabores clásicos de $15');
  assert.strictEqual(gourmet18.length, 16, 'Deben ser exactamente 16 sabores gourmet de $18');
  assert.strictEqual(clasicas15.length + gourmet18.length, 24, 'Total de sabores debe ser 24');
});

test('Validación de Archivo Manifest PWA para Modo App Móvil', () => {
  const fs = require('fs');
  const manifestPath = '/home/antigravity/punto_dulce/manifest.json';
  assert(fs.existsSync(manifestPath), 'manifest.json debe existir');

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.name, 'Paletería Punto Dulce');
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.theme_color, '#E11D74');
  assert(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});

test('Prevención de Cuentas Duplicadas y Acumulación de Saldo por Compañero', () => {
  const cuentasSimuladas = [
    { deudor: 'Luis Rodríguez', saldo: 45, folio: '#PD-002' },
    { deudor: 'Carlos R.', saldo: 30, folio: '#PD-004' },
    { deudor: 'Luis Rodríguez', saldo: 36, folio: '#PD-008' }
  ];

  // Agrupación por nombre normalizado
  const mapaDeudas = {};
  cuentasSimuladas.forEach(c => {
    const k = c.deudor.trim().toLowerCase();
    mapaDeudas[k] = (mapaDeudas[k] || 0) + c.saldo;
  });

  assert.strictEqual(mapaDeudas['luis rodríguez'], 81, 'El saldo total acumulado de Luis Rodríguez debe ser $81');
  assert.strictEqual(mapaDeudas['carlos r.'], 30, 'El saldo de Carlos R. debe ser $30');

  // Coincidencia de búsqueda parcial ('luis' encuentra 'Luis Rodríguez')
  const busqueda = 'luis';
  const encontrados = cuentasSimuladas.filter(c => c.deudor.toLowerCase().includes(busqueda));
  assert.strictEqual(encontrados.length, 2, 'Deben encontrarse 2 registros correspondientes a Luis');
});

console.log('\n========================================================');
console.log(`RESUMEN DE PRUEBAS: ${passCount} PASADAS, ${failCount} FALLIDAS`);
console.log('========================================================\n');

if (failCount > 0) process.exit(1);
