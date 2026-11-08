# 🌸 Paletería Punto Dulce - Control de Inventario y Ventas

Sistema integral móvil y web conectado a Google Sheets y Google Apps Script.

## 🔗 Enlaces del Proyecto
- **Hoja de Cálculo Central**: [Google Sheets - Paletería Punto Dulce](https://docs.google.com/spreadsheets/d/1WDA_i76wUv63sJ5NEBb3MfYZc4sM0UouSsWn22kd_f0/edit)
- **API Backend (Google Apps Script)**: `https://script.google.com/macros/s/AKfycbyFCoHM5pWYEam0ebz1lFtltAEanl8wR6AZvMgFHdI66kI4MRVhZi6gWv-XNdj49_A/exec`
- **Conversación de Origen**: `v1/default/jetski_remote_agents_3p/0b20a44c-946b-43e3-b78d-02034b9c1779`

## 📱 Módulos Disponibles

### 1. Interfaz de Producción (`produccion.html`)
Diseñada específicamente para el registro ágil en taller/cocina:
- **Contador y Stock en Vivo**: Muestra visual clara del stock de cada uno de los 24 sabores.
- **Seguridad Antierrores**: Modal de confirmación obligatoria antes de registrar producción, previniendo toques accidentales.
- **Protección de Red**: Manejo de doble clic y reintentos ante conexiones inestables.
- **Categorización**: Sabores base leche ($15 y $18) y base agua ($15 y $18).

### 2. Interfaz de Mostrador / Punto de Venta (`ventas.html`)
Diseñada para atención rápida a clientes:
- **Grid de Productos**: Botones táctiles con emoji, color y precio. Deshabilita automáticamente sabores agotados en tiempo real.
- **Carrito Dinámico**: Total acumulado y desglose de piezas.
- **Calculadora de Cambio**: Botones rápidos de denominaciones ($50, $100, $200, $500, Exacto) y cálculo inmediato de feria/cambio.
- **Ticket y Corte de Caja**: Resumen de ventas del turno y registro en la base de datos de Google Sheets.
