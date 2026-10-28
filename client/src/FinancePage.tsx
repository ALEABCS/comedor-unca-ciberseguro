import { useState } from "react";
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  FileSpreadsheet,
  Printer,
  Search,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import { moneyCentsToDecimal, parseMoneyToCents } from "../../shared/finance";
import {
  paymentMethodLabels,
  paymentMethodValues,
  type PaymentMethod,
} from "../../shared/payment-methods";
import type { AuthUser } from "../../server/trpc";
import { downloadCsv } from "./csv";
import { downloadXlsx, type ExcelCell } from "./excel";
import { trpc } from "./trpc";

type FinancePageProps = {
  user: Pick<AuthUser, "id" | "role">;
  canCashManage: boolean;
  canReconcile: boolean;
  canExport: boolean;
  canAdjust: boolean;
};

const financialStatuses = [
  "SIN_EVENTO",
  "PENDIENTE",
  "ACREDITADO",
  "DIFERENCIA",
] as const;
const paymentStatuses = [
  "PENDIENTE",
  "APROBADO",
  "RECHAZADO",
  "REEMBOLSADO",
] as const;

function formatMoney(value: unknown, currency = "ARS") {
  return `${currency} ${Number(value ?? 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FinancePage({
  user,
  canCashManage,
  canReconcile,
  canExport,
  canAdjust,
}: FinancePageProps) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    dateFrom: "",
    dateTo: "",
    service: "",
    person: "",
    paymentId: "",
    reservationId: "",
    method: "",
    paymentStatus: "",
    financialStatus: "",
    reviewerId: "",
    cashShiftId: "",
    amountFrom: "",
    amountTo: "",
  });
  const [cashUserId, setCashUserId] = useState("");
  const [cashReservationIds, setCashReservationIds] = useState<string[]>([]);
  const [receivedAmount, setReceivedAmount] = useState("");
  const [cashNote, setCashNote] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0.00");
  const [openingNote, setOpeningNote] = useState("");
  const [countedCash, setCountedCash] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [selectedPaymentId, setSelectedPaymentId] = useState("");
  const [adjustmentPaymentId, setAdjustmentPaymentId] = useState("");
  const [adjustmentType, setAdjustmentType] = useState<
    "DEVOLUCION" | "AJUSTE" | "ANULACION"
  >("DEVOLUCION");
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [executionReference, setExecutionReference] = useState("");
  const [receipt, setReceipt] = useState<{
    receiptNumber: number;
    amount: string;
    currency: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [exportMode, setExportMode] = useState<"CSV" | "XLSX" | "PRINT">("CSV");
  const utils = trpc.useUtils();
  const filterInput = {
    page,
    pageSize: 50,
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
    service: filters.service ? filters.service as "ALMUERZO" | "CENA" : undefined,
    person: filters.person || undefined,
    paymentId: filters.paymentId || undefined,
    reservationId: filters.reservationId || undefined,
    method: filters.method
      ? (filters.method as PaymentMethod | "EFECTIVO")
      : undefined,
    paymentStatus: filters.paymentStatus
      ? (filters.paymentStatus as (typeof paymentStatuses)[number])
      : undefined,
    financialStatus: filters.financialStatus
      ? (filters.financialStatus as (typeof financialStatuses)[number])
      : undefined,
    reviewerId: filters.reviewerId || undefined,
    cashShiftId: filters.cashShiftId || undefined,
    amountFrom: filters.amountFrom || undefined,
    amountTo: filters.amountTo || undefined,
  };
  const transactions = trpc.finance.transactions.useQuery(filterInput);
  const summary = trpc.finance.summary.useQuery({
    dateFrom: filters.dateFrom || undefined,
    dateTo: filters.dateTo || undefined,
  });
  const detail = trpc.finance.detail.useQuery(
    { id: selectedPaymentId || "00000000-0000-4000-8000-000000000000" },
    { enabled: Boolean(selectedPaymentId) },
  );
  const adjustmentDetail = trpc.finance.detail.useQuery(
    { id: adjustmentPaymentId || "00000000-0000-4000-8000-000000000000" },
    { enabled: Boolean(adjustmentPaymentId) },
  );
  const shifts = trpc.finance.cashShifts.useQuery(undefined, {
    enabled: canCashManage,
    refetchInterval: 15_000,
  });
  const cashReceivables = trpc.finance.cashReceivables.useQuery(undefined, {
    enabled: canCashManage,
  });
  const exportFinancial = trpc.finance.export.useMutation({
    onSuccess: (report) => {
      setExportedReport(report);
      const rows: ExcelCell[][] = [
        ["Informe de conciliación financiera", "Generado", report.generatedAt],
        ["Período de pagos", `${report.filters.dateFrom ?? "Sin límite"} — ${report.filters.dateTo ?? "Sin límite"}`],
        ["Servicio", report.filters.service ?? "Todos"],
        ["Pagos incluidos", report.totals.payments],
        ["Importe esperado", report.totals.expectedAmount],
        ["Importe declarado", report.totals.declaredAmount],
        ["Importe acreditado", report.totals.accreditedAmount],
        ["Pendientes", report.totals.pending],
        ["Rechazados", report.totals.rejected],
        ["Reembolsados", report.totals.refunded],
        ["Diferencias", report.totals.differences],
        ["Pagos agrupados sin imputación verificable para este servicio", report.totals.unallocatedForService],
        [],
        ["Pago", "Persona", "DNI", "Servicios", "Reservas", "Medio", "Referencia", "Esperado", "Declarado", "Acreditado", "Estado de pago", "Estado financiero"]
      ];
      rows.push(...report.rows.map((row) => [
        String(row.id), String(row.person), String(row.dni ?? ""), String(row.services ?? ""),
        String(row.reservationIds ?? ""), String(row.method), String(row.reference),
        String(row.expectedAmount ?? ""), String(row.declaredAmount ?? ""), String(row.accreditedAmount ?? ""),
        String(row.paymentStatus), String(row.financialStatus ?? "SIN_EVENTO")
      ]));
      const filename = `conciliacion-financiera-${report.filters.dateFrom ?? "inicio"}-${report.filters.dateTo ?? "actual"}${report.filters.service ? `-${report.filters.service.toLowerCase()}` : ""}`;
      if (exportMode === "CSV") downloadCsv(`${filename}.csv`, rows);
      if (exportMode === "XLSX") void downloadXlsx(`${filename}.xlsx`, "Conciliación", rows);
      if (exportMode === "PRINT") window.setTimeout(() => window.print(), 100);
    }
  });
  type FinancialExport = NonNullable<typeof exportFinancial.data>;
  const [exportedReport, setExportedReport] = useState<FinancialExport | null>(null);
  const requestAdjustment = trpc.finance.requestAdjustment.useMutation({
    onSuccess: async () => {
      setAdjustmentAmount("");
      setAdjustmentReason("");
      setNotice("La solicitud quedó pendiente de autorización del Supervisor.");
      await utils.finance.detail.invalidate();
      await utils.finance.transactions.invalidate();
    },
  });
  const reviewAdjustment = trpc.finance.reviewAdjustment.useMutation({
    onSuccess: async () => {
      setNotice("La decisión del Supervisor quedó registrada y auditada.");
      await utils.finance.detail.invalidate();
      await utils.finance.transactions.invalidate();
      await utils.finance.summary.invalidate();
    },
  });
  const executeAdjustment = trpc.finance.recordAdjustmentExecution.useMutation({
    onSuccess: async () => {
      setExecutionReference("");
      setNotice(
        "La ejecución fue registrada con su referencia; solo ahora aparece como realizada.",
      );
      await utils.finance.detail.invalidate();
      await utils.finance.transactions.invalidate();
      await utils.finance.summary.invalidate();
    },
  });
  const openCashShift = trpc.finance.openCashShift.useMutation({
    onSuccess: async () => {
      setNotice("Caja abierta.");
      await utils.finance.cashShifts.invalidate();
    },
  });
  const registerCash = trpc.finance.registerCash.useMutation({
    onSuccess: async (result) => {
      setReceipt({
        receiptNumber: result.receiptNumber,
        amount: result.amount,
        currency: result.currency,
      });
      setCashReservationIds([]);
      setReceivedAmount("");
      setCashNote("");
      await utils.finance.transactions.invalidate();
      await utils.finance.summary.invalidate();
      await utils.finance.cashShifts.invalidate();
      await utils.finance.cashReceivables.invalidate();
    },
  });
  const closeCashShift = trpc.finance.closeCashShift.useMutation({
    onSuccess: async (result) => {
      setNotice(
        `Caja cerrada. Teórico ${formatMoney(result.expectedCash)} · contado ${formatMoney(result.countedCash)} · diferencia ${formatMoney(result.difference)}.`,
      );
      setCountedCash("");
      setCloseNote("");
      await utils.finance.cashShifts.invalidate();
      await utils.finance.summary.invalidate();
    },
  });
  const reviewDifference = trpc.finance.reviewCashDifference.useMutation({
    onSuccess: async () => {
      setNotice("La diferencia quedó revisada y auditada.");
      await utils.finance.cashShifts.invalidate();
    },
  });
  const voidReceipt = trpc.finance.voidCashReceipt.useMutation({
    onSuccess: async () => {
      setNotice("El recibo se anuló con motivo y registro compensatorio.");
      await utils.finance.transactions.invalidate();
      await utils.finance.summary.invalidate();
      await utils.finance.cashShifts.invalidate();
      await utils.finance.cashReceivables.invalidate();
    },
  });

  const records = transactions.data?.rows ?? [];
  const openShift = (shifts.data ?? []).find(
    (shift) => shift.status === "ABIERTA" && String(shift.openedBy) === user.id,
  );
  const selectedUserReservations = (cashReceivables.data ?? []).filter(
    (reservation) => String(reservation.userId) === cashUserId,
  );
  const selectedReservations = selectedUserReservations.filter((reservation) =>
    cashReservationIds.includes(String(reservation.reservationId)),
  );
  const expectedCashCents = selectedReservations.reduce((sum, reservation) => {
    const cents = parseMoneyToCents(String(reservation.amount));
    return cents === null ? sum : sum + cents;
  }, 0);
  const expectedCash = moneyCentsToDecimal(expectedCashCents);
  const adjustmentData = adjustmentDetail.data!;

  function toggleCashReservation(id: string) {
    setCashReservationIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
  }

  return (
    <>
      <header className="page-intro">
        <div>
          <span className="eyebrow">CONTROL FINANCIERO</span>
          <h1>Conciliación financiera</h1>
          <p>
            Separá importes esperados, declarados, documentados y efectivamente
            acreditados.
          </p>
        </div>
        <ShieldCheck size={25} aria-hidden="true" />
      </header>
      <section
        className="metric-grid finance-summary-grid"
        aria-label="Resumen financiero"
      >
        <article className="metric-card">
          <span>Saldo esperado</span>
          <strong>{formatMoney(summary.data?.expectedOutstanding)}</strong>
          <small>Reservas pendientes o rechazadas</small>
        </article>
        <article className="metric-card">
          <span>Declarado pendiente</span>
          <strong>{formatMoney(summary.data?.declaredPending)}</strong>
          <small>Sin acreditación confirmada</small>
        </article>
        <article className="metric-card">
          <span>Documentado pendiente</span>
          <strong>{formatMoney(summary.data?.documentedPending)}</strong>
          <small>Comprobante revisado, dinero pendiente</small>
        </article>
        <article className="metric-card">
          <span>Acreditado</span>
          <strong>{formatMoney(summary.data?.accreditedTotal)}</strong>
          <small>Verificación explícita registrada</small>
        </article>
        <article className="metric-card">
          <span>Devoluciones ejecutadas</span>
          <strong>{formatMoney(summary.data?.executedRefunds)}</strong>
          <small>Solo con ejecución documentada</small>
        </article>
        <article className="metric-card">
          <span>Efectivo confirmado</span>
          <strong>{formatMoney(summary.data?.confirmedCash)}</strong>
          <small>Recibos confirmados en caja</small>
        </article>
        <article className="metric-card">
          <span>Histórico por revisar</span>
          <strong>{String(summary.data?.legacyApprovedForReview ?? 0)}</strong>
          <small>Pagos aprobados antes del registro financiero</small>
        </article>
      </section>

      <section className="surface-card catalog-tools finance-filters">
        <div className="surface-heading">
          <div>
            <span className="eyebrow">BÚSQUEDA Y FILTROS</span>
            <h3>Operaciones financieras</h3>
          </div>
          {canExport && (
            <div className="report-actions no-print">
              {(["CSV", "XLSX", "PRINT"] as const).map((mode) => (
                <button
                  key={mode}
                  className="button button-secondary"
                  type="button"
                  disabled={exportFinancial.isPending}
                  onClick={() => {
                    setExportMode(mode);
                    void exportFinancial.mutateAsync({
                      dateFrom: filters.dateFrom || undefined,
                      dateTo: filters.dateTo || undefined,
                      service: filters.service ? filters.service as "ALMUERZO" | "CENA" : undefined
                    });
                  }}
                >
                  {exportFinancial.isPending && exportMode === mode ? "Preparando…" :
                    mode === "CSV" ? <><Download size={15} /> Exportar CSV</> :
                      mode === "XLSX" ? <><FileSpreadsheet size={15} /> Exportar Excel</> :
                        <><Printer size={15} /> Imprimir / PDF</>}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="form-grid">
          <label className="field">
            Desde
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, dateFrom: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Hasta
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, dateTo: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Servicio
            <select
              value={filters.service}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, service: event.target.value });
              }}
            >
              <option value="">Todos</option>
              <option value="ALMUERZO">Almuerzo</option>
              <option value="CENA">Cena</option>
            </select>
          </label>
          <label className="field">
            Persona
            <input
              value={filters.person}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, person: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Pago
            <input
              value={filters.paymentId}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, paymentId: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Reserva UUID
            <input
              value={filters.reservationId}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, reservationId: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Medio
            <select
              value={filters.method}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, method: event.target.value });
              }}
            >
              <option value="">Todos</option>
              {paymentMethodValues.map((method) => (
                <option key={method} value={method}>
                  {paymentMethodLabels[method]}
                </option>
              ))}
              <option value="EFECTIVO">Efectivo</option>
            </select>
          </label>
          <label className="field">
            Estado de pago
            <select
              value={filters.paymentStatus}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, paymentStatus: event.target.value });
              }}
            >
              <option value="">Todos</option>
              {paymentStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Acreditación
            <select
              value={filters.financialStatus}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, financialStatus: event.target.value });
              }}
            >
              <option value="">Todos</option>
              {financialStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Responsable UUID
            <input
              value={filters.reviewerId}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, reviewerId: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Caja UUID
            <input
              value={filters.cashShiftId}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, cashShiftId: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Importe desde
            <input
              inputMode="decimal"
              value={filters.amountFrom}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, amountFrom: event.target.value });
              }}
            />
          </label>
          <label className="field">
            Importe hasta
            <input
              inputMode="decimal"
              value={filters.amountTo}
              onChange={(event) => {
                setPage(1);
                setFilters({ ...filters, amountTo: event.target.value });
              }}
            />
          </label>
        </div>
        {exportFinancial.error && (
          <div className="inline-error">{exportFinancial.error.message}</div>
        )}
      </section>

      {exportedReport && (
        <section className="surface-card form-panel report-print finance-report-print">
          <div className="surface-heading">
            <div>
              <span className="eyebrow">INFORME FINANCIERO</span>
              <h2>Conciliación financiera</h2>
              <p>
                Generado {new Date(exportedReport.generatedAt).toLocaleString("es-AR")} ·
                Período {exportedReport.filters.dateFrom ?? "sin límite"} — {exportedReport.filters.dateTo ?? "sin límite"} ·
                Servicio {exportedReport.filters.service ?? "todos"}
              </p>
            </div>
            <button className="button button-secondary no-print" onClick={() => window.print()}><Printer size={15} /> Imprimir / Guardar PDF</button>
          </div>
          <div className="finance-report-totals">
            <p>Pagos: <strong>{exportedReport.totals.payments}</strong></p>
            <p>Esperado: <strong>{formatMoney(exportedReport.totals.expectedAmount)}</strong></p>
            <p>Declarado: <strong>{formatMoney(exportedReport.totals.declaredAmount)}</strong></p>
            <p>Acreditado: <strong>{formatMoney(exportedReport.totals.accreditedAmount)}</strong></p>
            <p>Pendientes: <strong>{exportedReport.totals.pending}</strong></p>
            <p>Rechazados: <strong>{exportedReport.totals.rejected}</strong></p>
            <p>Reembolsados: <strong>{exportedReport.totals.refunded}</strong></p>
            <p>Diferencias: <strong>{exportedReport.totals.differences}</strong></p>
            {exportedReport.totals.unallocatedForService > 0 && <p>Pagos agrupados sin imputación verificable para este servicio: <strong>{exportedReport.totals.unallocatedForService}</strong></p>}
          </div>
          {!exportedReport.rows.length ? <p>No hay operaciones para estos filtros.</p> : <div className="table-wrap"><table>
            <thead><tr><th>Pago</th><th>Persona</th><th>DNI</th><th>Servicios</th><th>Reservas</th><th>Medio</th><th>Referencia</th><th>Esperado</th><th>Declarado</th><th>Acreditado</th><th>Estado pago</th><th>Estado financiero</th></tr></thead>
            <tbody>{exportedReport.rows.map((row) => <tr key={String(row.id)}>
              <td>{String(row.id)}</td><td>{String(row.person)}</td><td>{String(row.dni ?? "—")}</td>
              <td>{String(row.services ?? "—")}</td><td>{String(row.reservationIds ?? "—")}</td>
              <td>{String(row.method)}</td><td>{String(row.reference)}</td>
              <td>{row.expectedAmount == null ? "—" : formatMoney(row.expectedAmount, String(row.currency))}</td>
              <td>{row.declaredAmount == null ? "Sin imputación verificable" : formatMoney(row.declaredAmount, String(row.currency))}</td>
              <td>{row.accreditedAmount == null ? "—" : formatMoney(row.accreditedAmount, String(row.currency))}</td>
              <td>{String(row.paymentStatus)}</td><td>{String(row.financialStatus ?? "SIN_EVENTO")}</td>
            </tr>)}</tbody>
          </table></div>}
        </section>
      )}

      <section className="surface-card table-card">
        <div className="surface-heading">
          <div>
            <span className="eyebrow">DETALLE DE OPERACIONES</span>
            <h3>Pagos e imputaciones</h3>
          </div>
          <span className="row-count">
            {transactions.data?.total ?? 0} operaciones
          </span>
        </div>
        {transactions.isLoading ? (
          <div className="loading-rows">
            <span className="spinner" />
          </div>
        ) : transactions.error ? (
          <div className="inline-error">{transactions.error.message}</div>
        ) : !records.length ? (
          <div className="empty-state">
            <span>
              <Search size={22} />
            </span>
            <h3>Sin operaciones</h3>
            <p>No hay pagos para estos filtros.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>PERSONA / PAGO</th>
                  <th>MEDIO / REFERENCIA</th>
                  <th>ESPERADO</th>
                  <th>DECLARADO</th>
                  <th>DOCUMENTADO</th>
                  <th>ACREDITADO</th>
                  <th>ESTADO</th>
                  {canAdjust && <th>AJUSTES</th>}
                </tr>
              </thead>
              <tbody>
                {records.map((row) => (
                  <tr key={String(row.id)}>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setSelectedPaymentId(String(row.id))}
                      >
                        <strong>
                          {String(row.firstName)} {String(row.lastName)}
                        </strong>
                      </button>
                      <small>{String(row.id)}</small>
                      <small>
                        {String(row.reservationIds ?? "Sin reserva vinculada")}
                      </small>
                    </td>
                    <td>
                      {String(row.method)}
                      <small>{String(row.reference)}</small>
                    </td>
                    <td>
                      {formatMoney(row.expectedAmount, String(row.currency))}
                    </td>
                    <td>
                      {formatMoney(row.declaredAmount, String(row.currency))}
                    </td>
                    <td>
                      {row.documentedAmount == null
                        ? "—"
                        : formatMoney(
                            row.documentedAmount,
                            String(row.currency),
                          )}
                    </td>
                    <td>
                      {row.accreditedAmount == null
                        ? "—"
                        : formatMoney(
                            row.accreditedAmount,
                            String(row.currency),
                          )}
                    </td>
                    <td>
                      <span className="finance-event-label">
                        {String(
                          row.latestFinanceEvent ??
                            (row.paymentStatus === "APROBADO"
                              ? "HISTÓRICO_POR_REVISAR"
                              : "PENDIENTE"),
                        )}
                      </span>
                    </td>
                    {canAdjust && (
                      <td>
                        <button
                          className="table-action"
                          onClick={() => {
                            setAdjustmentPaymentId(String(row.id));
                            setAdjustmentType("DEVOLUCION");
                            setAdjustmentAmount("");
                            setAdjustmentReason("");
                          }}
                        >
                          Ajuste / devolución
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="catalog-pagination">
          <span>
            Página {page} · {transactions.data?.total ?? 0} resultados
          </span>
          <div>
            <button
              className="icon-button"
              aria-label="Página anterior"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Página siguiente"
              disabled={page * 50 >= (transactions.data?.total ?? 0)}
              onClick={() => setPage((current) => current + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </section>

      {canCashManage && (
        <section className="surface-card table-card finance-cash-section">
          <div className="surface-heading">
            <div>
              <span className="eyebrow">EFECTIVO</span>
              <h3>Caja y jornada</h3>
            </div>
            <Wallet size={20} aria-hidden="true" />
          </div>
          {(shifts.data ?? [])
            .filter(
              (shift) => shift.status === "ABIERTA" || shift.difference != null,
            )
            .map((shift) => (
              <article className="finance-shift-row" key={String(shift.id)}>
                <div>
                  <strong>
                    {String(shift.status)} · {String(shift.openerFirstName)}{" "}
                    {String(shift.openerLastName)}
                  </strong>
                  <small>
                    {String(shift.id)} · Apertura {String(shift.openedAt)}
                  </small>
                  <small>
                    Inicial {formatMoney(shift.openingBalance)} · ingresos
                    confirmados {formatMoney(shift.totalCash)}
                  </small>
                  {shift.status === "CERRADA" && (
                    <small>
                      Teórico {formatMoney(shift.expectedCash)} · contado{" "}
                      {formatMoney(shift.countedCash)} · diferencia{" "}
                      {formatMoney(shift.difference)}
                    </small>
                  )}
                </div>
                {shift.status === "ABIERTA" &&
                  (String(shift.openedBy) === user.id || canReconcile) && (
                    <form
                      className="finance-inline-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void closeCashShift.mutateAsync({
                          id: String(shift.id),
                          countedCash,
                          note: closeNote || undefined,
                        });
                      }}
                    >
                      <label className="field">
                        Efectivo contado
                        <input
                          required
                          inputMode="decimal"
                          value={countedCash}
                          onChange={(event) =>
                            setCountedCash(event.target.value)
                          }
                        />
                      </label>
                      <label className="field">
                        Observación
                        <textarea
                          maxLength={1000}
                          value={closeNote}
                          onChange={(event) => setCloseNote(event.target.value)}
                        />
                      </label>
                      <button
                        className="button button-primary"
                        disabled={closeCashShift.isPending}
                      >
                        Cerrar caja
                      </button>
                    </form>
                  )}
                {shift.status === "CERRADA" &&
                  Number(shift.difference) !== 0 &&
                  !shift.reviewedAt &&
                  canReconcile && (
                    <button
                      className="table-action"
                      onClick={() => {
                        const note = window.prompt(
                          "Motivo de revisión de la diferencia (mínimo 5 caracteres):",
                        );
                        if (note)
                          void reviewDifference.mutate({
                            id: String(shift.id),
                            note,
                          });
                      }}
                    >
                      Revisar diferencia
                    </button>
                  )}
                {shift.reviewedAt && (
                  <span className="finance-reviewed">
                    <CheckCircle2 size={15} /> Revisada por Supervisor
                  </span>
                )}
              </article>
            ))}
          {!openShift && (
            <form
              className="admin-form admin-form-inline"
              onSubmit={(event) => {
                event.preventDefault();
                void openCashShift.mutate({
                  openingBalance,
                  note: openingNote || undefined,
                });
              }}
            >
              <label className="field">
                Saldo inicial contado
                <input
                  required
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                />
              </label>
              <label className="field">
                Observación de apertura
                <textarea
                  maxLength={1000}
                  value={openingNote}
                  onChange={(event) => setOpeningNote(event.target.value)}
                />
              </label>
              <button
                className="button button-primary"
                disabled={openCashShift.isPending}
              >
                Abrir caja
              </button>
            </form>
          )}
          {openShift && (
            <form
              className="admin-form finance-cash-receipt-form"
              onSubmit={(event) => {
                event.preventDefault();
                void registerCash.mutateAsync({
                  userId: cashUserId,
                  reservationIds: cashReservationIds,
                  receivedAmount,
                  note: cashNote || undefined,
                });
              }}
            >
              <h4>
                <Banknote size={17} /> Registrar efectivo
              </h4>
              <label className="field">
                Persona
                <select
                  required
                  value={cashUserId}
                  onChange={(event) => {
                    setCashUserId(event.target.value);
                    setCashReservationIds([]);
                    setReceivedAmount("");
                  }}
                >
                  <option value="">Seleccionar persona</option>
                  {Array.from(
                    new Map(
                      (cashReceivables.data ?? []).map((row) => [
                        String(row.userId),
                        `${String(row.firstName)} ${String(row.lastName)} · ${String(row.dni ?? "sin DNI")}`,
                      ]),
                    ).entries(),
                  ).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="finance-reservation-options">
                {selectedUserReservations.map((row) => (
                  <label key={String(row.reservationId)}>
                    <input
                      type="checkbox"
                      checked={cashReservationIds.includes(
                        String(row.reservationId),
                      )}
                      onChange={() =>
                        toggleCashReservation(String(row.reservationId))
                      }
                    />
                    <span>
                      {String(row.serviceDate)} · {String(row.service)} ·{" "}
                      {formatMoney(row.amount, String(row.currency))}
                    </span>
                  </label>
                ))}
              </div>
              <div className="finance-cash-expected">
                <span>Importe esperado seleccionado</span>
                <strong>{formatMoney(expectedCash)}</strong>
              </div>
              <label className="field">
                Efectivo recibido
                <input
                  required
                  inputMode="decimal"
                  value={receivedAmount}
                  onChange={(event) => setReceivedAmount(event.target.value)}
                />
              </label>
              <label className="field">
                Observación
                <textarea
                  maxLength={1000}
                  value={cashNote}
                  onChange={(event) => setCashNote(event.target.value)}
                />
              </label>
              <button
                className="button button-primary"
                disabled={
                  registerCash.isPending ||
                  !cashUserId ||
                  !cashReservationIds.length
                }
              >
                {registerCash.isPending
                  ? "Registrando…"
                  : "Confirmar recepción y emitir recibo"}
              </button>
            </form>
          )}
          {openCashShift.error && (
            <div className="form-error">{openCashShift.error.message}</div>
          )}
          {registerCash.error && (
            <div className="form-error">{registerCash.error.message}</div>
          )}
          {closeCashShift.error && (
            <div className="form-error">{closeCashShift.error.message}</div>
          )}
          {reviewDifference.error && (
            <div className="form-error">{reviewDifference.error.message}</div>
          )}
          {voidReceipt.error && (
            <div className="form-error">{voidReceipt.error.message}</div>
          )}
        </section>
      )}

      {notice && (
        <div className="notice-message" role="status">
          {notice}
        </div>
      )}
      {receipt && (
        <div className="modal-backdrop">
          <section
            className="modal-card cash-receipt-print"
            role="dialog"
            aria-modal="true"
            aria-label="Recibo de efectivo"
          >
            <div className="modal-head">
              <h2>Recibo de efectivo</h2>
              <button
                className="icon-button"
                onClick={() => setReceipt(null)}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>
            <div className="cash-receipt-paper">
              <strong>COMEDOR UNIVERSITARIO UNCA</strong>
              <h3>
                RECIBO N.º {String(receipt.receiptNumber).padStart(8, "0")}
              </h3>
              <p>Recepción de efectivo confirmada</p>
              <strong>{formatMoney(receipt.amount, receipt.currency)}</strong>
              <small>
                La caja y el responsable quedan identificados en el sistema.
              </small>
              <a href={`/api/cash/receipts/${receipt.receiptNumber}`} target="_blank" rel="noreferrer">Verificar recibo</a>
            </div>
            <button
              className="button button-primary button-full"
              onClick={() => window.print()}
            >
              Imprimir recibo
            </button>
          </section>
        </div>
      )}

      {selectedPaymentId && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSelectedPaymentId("");
          }}
        >
          <section
            className="modal-card finance-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Detalle financiero"
          >
            <div className="modal-head">
              <h2>Historial financiero</h2>
              <button
                className="icon-button"
                onClick={() => setSelectedPaymentId("")}
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            </div>
            {detail.isLoading ? (
              <div className="loading-rows">
                <span className="spinner" />
              </div>
            ) : detail.error ? (
              <div className="inline-error">{detail.error.message}</div>
            ) : (
              detail.data && (
                <div className="finance-detail-content">
                  <div className="finance-detail-identity">
                    <strong>
                      {String(detail.data.payment.firstName)}{" "}
                      {String(detail.data.payment.lastName)}
                    </strong>
                    <span>
                      {String(detail.data.payment.email)} ·{" "}
                      {String(detail.data.payment.dni ?? "sin DNI")}
                    </span>
                    <code>{String(detail.data.payment.id)}</code>
                  </div>
                  <h3>Importe por reserva</h3>
                  <div className="finance-detail-list">
                    {detail.data.reservations.map((row) => (
                      <div key={String(row.id)}>
                        <span>
                          {String(row.serviceDate)} · {String(row.service)} ·{" "}
                          {String(row.id)}
                        </span>
                        <strong>
                          {formatMoney(
                            row.expectedAmount,
                            String(row.currency),
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                  {detail.data.cashReceipts.length > 0 && (
                    <>
                      <h3>Recibos de efectivo</h3>
                      <div className="finance-detail-list">
                        {detail.data.cashReceipts.map((item) => (
                          <div key={String(item.id)}>
                            <span>
                              Recibo{" "}
                              {String(item.receiptNumber).padStart(8, "0")} ·{" "}
                              {String(item.status)} · caja{" "}
                              {String(item.cashShiftId)}
                              {item.voidReason
                                ? ` · ${String(item.voidReason)}`
                                : ""}
                            </span>
                            <strong>
                              {formatMoney(item.amount, String(item.currency))}
                            </strong>
                            {canReconcile && item.status === "CONFIRMADO" && (
                              <button
                                className="table-action danger-action"
                                onClick={() => {
                                  const reason = window.prompt(
                                    "Motivo de anulación del recibo (mínimo 5 caracteres):",
                                  );
                                  if (reason)
                                    voidReceipt.mutate({
                                      id: String(item.id),
                                      reason,
                                    });
                                }}
                              >
                                Anular recibo
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  <h3>Eventos auditables</h3>
                  <ol className="finance-event-list">
                    {detail.data.events.map((event) => (
                      <li key={String(event.id)}>
                        <div>
                          <strong>{String(event.eventType)}</strong>
                          <span>
                            {String(event.createdAt)} · {String(event.actorId)}
                          </span>
                          {event.reference && (
                            <small>Ref. {String(event.reference)}</small>
                          )}
                          {event.note && <small>{String(event.note)}</small>}
                        </div>
                        {event.amount != null && (
                          <strong>
                            {formatMoney(event.amount, String(event.currency))}
                          </strong>
                        )}
                      </li>
                    ))}
                  </ol>
                  <h3>Comprobantes presentados</h3>
                  {detail.data.evidence.length ? (
                    <ul className="finance-evidence-list">
                      {detail.data.evidence.map((item) => (
                        <li key={String(item.id)}>
                          <a
                            href={`/api/payments/${encodeURIComponent(selectedPaymentId)}/evidence/${encodeURIComponent(String(item.id))}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {String(item.reference)} · {String(item.createdAt)}{" "}
                            ·{" "}
                            {formatMoney(
                              item.declaredAmount,
                              String(item.currency),
                            )}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="section-copy">
                      No hay comprobantes históricos archivados para este pago.
                    </p>
                  )}
                </div>
              )
            )}
          </section>
        </div>
      )}
    </>
  );
  {
    adjustmentPaymentId && (
      <div
        className="modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAdjustmentPaymentId("");
        }}
      >
        <section
          className="modal-card finance-detail-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Ajustes y devoluciones"
        >
          <div className="modal-head">
            <h2>Ajustes y devoluciones</h2>
            <button
              className="icon-button"
              onClick={() => setAdjustmentPaymentId("")}
              aria-label="Cerrar"
            >
              <X size={18} />
            </button>
          </div>
          {adjustmentDetail.isLoading ? (
            <div className="loading-rows">
              <span className="spinner" />
            </div>
          ) : adjustmentDetail.error ? (
            <div className="inline-error">{adjustmentDetail.error?.message}</div>
          ) : (
            adjustmentData && (
              <div className="finance-detail-content">
                <div className="finance-detail-identity">
                  <strong>
                    {String(adjustmentData.payment.firstName)}{" "}
                    {String(adjustmentData.payment.lastName)}
                  </strong>
                  <code>{String(adjustmentData.payment.id)}</code>
                </div>
                <h3>Solicitar registro</h3>
                <p className="section-copy">
                  Solicitar o autorizar una devolución no confirma que el dinero
                  haya sido transferido. La ejecución requiere una referencia
                  institucional verificable.
                </p>
                <form
                  className="modal-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void requestAdjustment.mutateAsync({
                      paymentReferenceId: adjustmentPaymentId,
                      adjustmentType,
                      amount: adjustmentAmount,
                      reason: adjustmentReason,
                    });
                  }}
                >
                  <label className="field">
                    Tipo
                    <select
                      value={adjustmentType}
                      onChange={(event) =>
                        setAdjustmentType(
                          event.target.value as typeof adjustmentType,
                        )
                      }
                    >
                      <option value="DEVOLUCION">Devolución</option>
                      <option value="AJUSTE">Ajuste</option>
                      <option value="ANULACION">Anulación</option>
                    </select>
                  </label>
                  <label className="field">
                    Importe
                    <input
                      required
                      inputMode="decimal"
                      pattern="[0-9]{1,8}([.][0-9]{1,2})?"
                      value={adjustmentAmount}
                      onChange={(event) =>
                        setAdjustmentAmount(event.target.value)
                      }
                    />
                  </label>
                  <label className="field">
                    Motivo
                    <textarea
                      required
                      minLength={5}
                      maxLength={1000}
                      value={adjustmentReason}
                      onChange={(event) =>
                        setAdjustmentReason(event.target.value)
                      }
                    />
                  </label>
                  <button
                    className="button button-secondary button-full"
                    disabled={requestAdjustment.isPending}
                  >
                    {requestAdjustment.isPending
                      ? "Enviando…"
                      : "Solicitar ajuste"}
                  </button>
                </form>
                {detail.data?.events.some(
                  (event) => event.eventType === "ACREDITACION_CONFIRMADA",
                ) ? null : (
                  <div className="notice-message" role="status">
                    No hay acreditación financiera confirmada; la solicitud será
                    rechazada por el servidor.
                  </div>
                )}
                {adjustmentData.adjustments.length > 0 && (
                  <>
                    <h3>Historial de ajustes</h3>
                    <div className="finance-detail-list">
                      {adjustmentData.adjustments.map((item) => (
                        <div key={String(item.id)}>
                          <span>
                            {String(item.adjustmentType)} ·{" "}
                            {String(item.status)} · {String(item.reason)}
                            <small>
                              {item.executionReference
                                ? `Ref. ejecución ${String(item.executionReference)}`
                                : "Sin ejecución registrada"}
                            </small>
                          </span>
                          <strong>
                            {formatMoney(item.amount, String(item.currency))}
                          </strong>
                          {canAdjust && item.status === "SOLICITADA" && (
                            <span className="table-actions">
                              <button
                                className="table-action"
                                onClick={() =>
                                  void reviewAdjustment.mutate({
                                    id: String(item.id),
                                    decision: "AUTORIZADA",
                                  })
                                }
                              >
                                Autorizar
                              </button>
                              <button
                                className="table-action danger-action"
                                onClick={() =>
                                  void reviewAdjustment.mutate({
                                    id: String(item.id),
                                    decision: "RECHAZADA",
                                  })
                                }
                              >
                                Rechazar
                              </button>
                            </span>
                          )}
                          {canAdjust && item.status === "AUTORIZADA" && (
                            <span className="finance-inline-form">
                              <label className="field">
                                Referencia de ejecución
                                <input
                                  required
                                  minLength={3}
                                  maxLength={191}
                                  value={executionReference}
                                  onChange={(event) =>
                                    setExecutionReference(event.target.value)
                                  }
                                />
                              </label>
                              <button
                                className="table-action"
                                disabled={
                                  executeAdjustment.isPending ||
                                  !executionReference.trim()
                                }
                                onClick={() =>
                                  void executeAdjustment.mutate({
                                    id: String(item.id),
                                    executionReference,
                                  })
                                }
                              >
                                Registrar ejecución verificada
                              </button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {requestAdjustment.error && (
                  <div className="form-error">
                    {requestAdjustment.error?.message}
                  </div>
                )}
                {reviewAdjustment.error && (
                  <div className="form-error">
                    {reviewAdjustment.error?.message}
                  </div>
                )}
                {executeAdjustment.error && (
                  <div className="form-error">
                    {executeAdjustment.error?.message}
                  </div>
                )}
              </div>
            )
          )}
        </section>
      </div>
    );
  }
}
