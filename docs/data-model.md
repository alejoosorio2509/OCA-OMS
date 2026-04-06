# Modelo de datos (Prisma)

Fuente de verdad: [schema.prisma](file:///e:/Prueba/ansALEJO/server/prisma/schema.prisma)

## Entidades principales

### User

Responsable de autenticación y permisos.

- `role`: `ADMIN | USER`
- Flags de acceso: `canOrders`, `canCargues`, `canExportes`, `canUsers`

### WorkOrder

Orden de trabajo.

Claves y campos relevantes:

- `code` (único)
- `status` (enum `WorkOrderStatus`)
- Fechas: `assignedAt`, `gestionAt`, `startedAt`, `completedAt`, `cancelledAt`
- Campos operativos de cargues:
  - `gestorCc`, `gestorNombre`
  - `tipoIncremento`, `oportunidad`, `ansOportunidad`
  - `estadoSecundario`, `diasDescuento`

Relaciones:

- `history`: `WorkOrderHistory[]`
- `novedades`: `Novedad[]`

### WorkOrderHistory

Historial de cambios de estado y notas operativas.

- `fromStatus`, `toStatus`
- `note`, `noteDetail`
- Ventana de novedad (string): `fechaInicio`, `fechaFin`

### Novedad

Pausas/soportes asociados a una OT.

- `fechaInicio`, `fechaFin?`
- `descripcion`, `detalle`
- `soportePath?` (imagen/archivo en `/uploads`)

### Calendar

Tabla que define el “número de día” usado en cálculos.

- `date` (única)
- `dayNumber` (Inicio)
- `dayNumberFin?` (Fin; si es null se usa `dayNumber`)

### RecorridoIncremento

Datos para descuentos por recorridos (ENEL u otros responsables) y trazabilidad.

- Natural key: `@@unique([orderCode, nombreIncremento, fechaInicio])`
- Campo calculado: `diasEnel?`

### ActividadBaremo

Detalle de baremo por código de OT y campos de cálculo.

- `totalBarSum?`, `ansRef?`, `ansCalc?`
- `baremo` (Json)

### CargueJob

Job persistente de cargue.

- `status`: `QUEUED | RUNNING | DONE | ERROR`
- `type`: tipo de cargue (string)
- Archivo: `fileName`, `fileBytes`, `fileMime?`, `fileSize?`
- Progreso: `progressRows`, `progressSuccess`, `progressErrors`
- Resultado/error: `result?`, `error?`

## Enums

- `WorkOrderStatus`: incluye estados internos y de operación (`DRAFT`, `CREATED`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`, `EXCLUDED`, `FACTURADA`, `GESTIONADA`, `CERRADA`, `ASIGNADA`, `EN_EJECUCION`, `DEVUELTA`)
- `WorkOrderCriticality`: `LOW | MEDIUM | HIGH | CRITICAL`
- `UserRole`: `ADMIN | USER`
- `CargueJobStatus`: `QUEUED | RUNNING | DONE | ERROR`
