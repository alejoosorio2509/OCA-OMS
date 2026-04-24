-- CreateTable
CREATE TABLE "Levantamiento" (
    "id" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "nivelTension" TEXT,
    "tipo" TEXT,
    "unidadSolicitante" TEXT,
    "proyecto" TEXT,
    "estado" TEXT,
    "subestado" TEXT,
    "subestacion" TEXT,
    "circuito" TEXT,
    "noCd" TEXT,
    "direccion" TEXT,
    "municipio" TEXT,
    "zona" TEXT,
    "alcance" TEXT,
    "fechaSolicitud" TIMESTAMP(3),
    "fechaAprobacionAlcanceSt" TIMESTAMP(3),
    "fechaEstimacionCostos" TIMESTAMP(3),
    "fechaAprobacionValorizacionSt" TIMESTAMP(3),
    "fechaPrevalidacion" TIMESTAMP(3),
    "fechaAsignacion" TIMESTAMP(3),
    "fechaPrimerElemento" TIMESTAMP(3),
    "fechaEntregaPostproceso" TIMESTAMP(3),
    "fechaAprobacionPostproceso" TIMESTAMP(3),
    "fechaGestion" TIMESTAMP(3),
    "fechaDevolucion" TIMESTAMP(3),
    "usuarioSolicitante" TEXT,
    "usuarioAsigna" TEXT,
    "gestor" TEXT,
    "observacionGestor" TEXT,
    "cuadrilla" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Levantamiento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Levantamiento_orderCode_key" ON "Levantamiento"("orderCode");

-- CreateIndex
CREATE INDEX "Levantamiento_orderCode_idx" ON "Levantamiento"("orderCode");
