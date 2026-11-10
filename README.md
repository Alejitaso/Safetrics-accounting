# Safetrics

Aplicación local para administrar ventas contraentrega y gastos de un negocio de comercio electrónico, con cálculo de utilidad en tiempo real y reportes en PDF y Excel.

> Proyecto de demostración. Todos los datos, nombres y cifras de ejemplo son ficticios.
>
> Está pensado para **despliegue local**: se ejecuta en tu propio equipo con `Iniciar Safetrics.bat` y no usa servicios externos.

**Stack:** Node.js · Express · MongoDB (Mongoose) · React + Vite · PDFKit · ExcelJS.

## Requisitos

- Node.js 20 o posterior y npm
- MongoDB local en `mongodb://127.0.0.1:27017`

## Inicio rápido

```bash
npm install
npm run dev
```

Abre `http://localhost:5173`. La API queda en `http://127.0.0.1:4000/api` (comprobación en `/api/salud`).

### Despliegue local con el .bat (Windows)

Haz doble clic en `Iniciar Safetrics.bat`. Comprueba que MongoDB esté activo, inicia solo los servidores que no estén corriendo (API y web) y abre la interfaz en el navegador. Mantén abiertas sus ventanas mientras uses la app; al cerrarlas se detienen los servidores. No instala Node.js ni MongoDB.

### Configuración (.env)

Los valores predeterminados funcionan sin configurar nada. Para cambiarlos, copia `backend/.env.example` como `backend/.env` y ajusta:

| Variable | Ejemplo | Descripción |
| --- | --- | --- |
| `BACKEND_PORT` | `4000` | Puerto de la API |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/safetrics` | Conexión a MongoDB |

El archivo `backend/.env` está en `.gitignore`; no subas credenciales reales.

Pruebas del backend: `npm test --workspace=backend`.

## Módulos

Resumen, Ventas, Productos, Gastos, Suscripciones, Gastos prolongados, Comparativas, Catálogos, Respaldo y Configuración.

- **Ventas y productos:** estados (en espera, pagada, devuelta, cancelada), fechas de pago y devolución, flete de devoluciones, productos base con variantes y paginación.
- **Gastos:** pagos únicos, gastos prolongados repartidos por día y suscripciones con cobros automáticos (diarios, semanales, mensuales o anuales).
- **Comparativas:** compara meses o rangos personalizados con las mismas cifras de Resumen.
- **Reporte completo:** PDF (carta vertical) y Excel para hoy, ayer, semana, mes, año o un rango, con comparación contra el periodo anterior.
- **Exportación:** cada sección se descarga en Excel o PDF, generados localmente.
- **Respaldo:** copias automáticas en JSON de la base de datos.

## Fórmulas

Un solo motor de cálculo (`shared/finance.mjs`) lo usan la interfaz y los reportes, de modo que todas las pantallas dan las mismas cifras.

| Indicador | Cálculo |
| --- | --- |
| Venta neta | precios de los pedidos pagados y en espera (sin devueltos ni cancelados) |
| Neto por entregar | valor esperado de esos pedidos |
| Costo producto | venta neta − neto por entregar |
| Gastos totales | suscripciones + publicidad y otros + fletes de devolución |
| Costo total | costo producto + gastos totales |
| Ganancia esperada | neto por entregar − gastos totales |
| Recibido neto | recibido de la plataforma − fletes de devolución |
| Utilidad neta | recibido de la plataforma − gastos totales |

Criterios: lo vendido cuenta en la fecha del pedido; lo recibido, en la fecha de pago; una devolución, en su fecha de devolución, y resta su flete; cada cobro de suscripción y cada gasto prolongado se reparten por día.

## Estructura

```
backend/   API Express, modelos, exportaciones y pruebas
frontend/  Interfaz React (Vite)
shared/    Motor de cálculo compartido
```

## Licencia

MIT. Consulta `LICENSE`.
