import { useMemo, useState, type FormEvent } from "react";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { userReportCategoryLabels, summarizeUserReport } from "../../shared/user-report";
import { downloadCsv } from "./csv";
import { downloadXlsx, type ExcelCell } from "./excel";
import { trpc } from "./trpc";

const roleLabels: Record<string, string> = {
  ALUMNO: "Alumno",
  DOCENTE: "Docente",
  NO_DOCENTE: "No docente",
  INVITADO_ESPECIAL: "Invitado",
  ADMINISTRADOR_LOCAL: "Administrador local",
  SUPERVISOR: "Supervisor"
};
const scholarshipLabels: Record<string, string> = {
  SIN_BECA: "Sin beca",
  MEDIA_BECA: "Media beca",
  BECA_COMPLETA: "Beca completa"
};
const statusLabels: Record<string, string> = {
  PENDING: "Pendiente",
  ACTIVE: "Activa",
  SUSPENDED: "Suspendida"
};

export function UsersReportPage() {
  const [filters, setFilters] = useState({
    dateFrom: "", dateTo: "", role: "", scholarshipType: "", status: "", search: ""
  });
  const report = trpc.administration.usersReport.useMutation();
  const rows = (report.data?.rows ?? []).map((row) => ({
    ...row,
    role: String(row.role),
    scholarshipType: row.scholarshipType == null ? null : String(row.scholarshipType)
  }));
  const summary = useMemo(() => summarizeUserReport(rows), [rows]);
  const reportRows: ExcelCell[][] = [
    ["Informe de usuarios", "Generado", report.data?.generatedAt ?? ""],
    ["Período de registro", `${filters.dateFrom || "Sin límite"} — ${filters.dateTo || "Sin límite"}`],
    ["Rol", filters.role ? roleLabels[filters.role] : "Todos"],
    ["Beca", filters.scholarshipType ? scholarshipLabels[filters.scholarshipType] : "Todas"],
    ["Estado", filters.status ? statusLabels[filters.status] : "Todos"],
    ["Total de usuarios", summary.total],
    ...Object.entries(summary.categories).map(([category, total]) => [
      userReportCategoryLabels[category as keyof typeof userReportCategoryLabels], total
    ]),
    [],
    ["Nombre", "Apellido", "DNI", "Correo", "Perfil", "Beca", "Estado de cuenta", "Fecha de registro"],
    ...rows.map((row) => [
      String(row.firstName), String(row.lastName), String(row.dni ?? ""), String(row.email),
      roleLabels[String(row.role)] ?? String(row.role),
      row.scholarshipType ? scholarshipLabels[String(row.scholarshipType)] ?? String(row.scholarshipType) : "No aplica",
      statusLabels[String(row.status)] ?? String(row.status),
      new Date(String(row.createdAt)).toLocaleString("es-AR")
    ])
  ];

  function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    report.mutate({
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      role: filters.role ? filters.role as "ALUMNO" | "DOCENTE" | "NO_DOCENTE" | "INVITADO_ESPECIAL" | "ADMINISTRADOR_LOCAL" | "SUPERVISOR" : undefined,
      scholarshipType: filters.scholarshipType ? filters.scholarshipType as "SIN_BECA" | "MEDIA_BECA" | "BECA_COMPLETA" : undefined,
      status: filters.status ? filters.status as "PENDING" | "ACTIVE" | "SUSPENDED" : undefined,
      search: filters.search.trim() || undefined
    });
  }

  const filename = `informe-usuarios-${filters.dateFrom || "inicio"}-${filters.dateTo || "actual"}`;
  return <section className="users-report-page">
    <header className="page-intro">
      <span className="eyebrow">INFORMES ADMINISTRATIVOS</span>
      <h1>Informes de usuarios</h1>
      <p>Consultá perfiles y becas según los datos registrados. Las becas reflejan aprobaciones vigentes al cierre del período o al día de generación.</p>
    </header>
    <section className="surface-card form-panel no-print">
      <form className="admin-form" onSubmit={generate}>
        <div className="form-grid">
          <label className="field">Desde<input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label className="field">Hasta<input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
          <label className="field">Perfil<select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">Todos</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">Beca<select value={filters.scholarshipType} onChange={(event) => setFilters({ ...filters, scholarshipType: event.target.value })}><option value="">Todas</option>{Object.entries(scholarshipLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">Estado de cuenta<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="field">Buscar<input maxLength={100} value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Nombre, DNI o correo" /></label>
        </div>
        <button className="button button-primary" disabled={report.isPending}>{report.isPending ? "Generando…" : "Generar informe"} <Download size={16} /></button>
        {report.error && <p className="form-error" role="alert">{report.error.message}</p>}
      </form>
    </section>
    {report.data && <section className="surface-card form-panel report-print">
      <div className="surface-heading"><div><span className="eyebrow">RESULTADO</span><h2>Informe de usuarios</h2><p>Generado: {new Date(report.data.generatedAt).toLocaleString("es-AR")} · Período de altas: {filters.dateFrom || "sin límite"} — {filters.dateTo || "sin límite"}</p></div>
        <div className="report-actions no-print">
          <button className="button button-secondary" onClick={() => downloadCsv(`${filename}.csv`, reportRows)}><Download size={15} /> CSV</button>
          <button className="button button-secondary" onClick={() => void downloadXlsx(`${filename}.xlsx`, "Usuarios", reportRows)}><FileSpreadsheet size={15} /> Excel</button>
          <button className="button button-secondary" onClick={() => window.print()}><Printer size={15} /> Imprimir / PDF</button>
        </div>
      </div>
      <div className="metric-grid users-report-totals">
        <article className="metric-card"><span>Total de usuarios</span><strong>{summary.total}</strong></article>
        {Object.entries(summary.categories).map(([category, count]) => <article className="metric-card" key={category}><span>{userReportCategoryLabels[category as keyof typeof userReportCategoryLabels]}</span><strong>{count}</strong></article>)}
      </div>
      {!rows.length ? <p className="catalog-status">No hay usuarios para los filtros seleccionados.</p> : <div className="table-wrap"><table>
        <thead><tr><th>Nombre</th><th>Apellido</th><th>DNI</th><th>Correo</th><th>Perfil</th><th>Beca</th><th>Estado</th><th>Fecha de alta</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={String(row.id)}>
          <td>{String(row.firstName)}</td><td>{String(row.lastName)}</td><td>{String(row.dni ?? "—")}</td>
          <td>{String(row.email)}</td><td>{roleLabels[String(row.role)] ?? String(row.role)}</td>
          <td>{row.scholarshipType ? scholarshipLabels[String(row.scholarshipType)] ?? String(row.scholarshipType) : "No aplica"}</td>
          <td>{statusLabels[String(row.status)] ?? String(row.status)}</td>
          <td>{new Date(String(row.createdAt)).toLocaleDateString("es-AR")}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}
  </section>;
}
