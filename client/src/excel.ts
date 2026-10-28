import * as ExcelJS from "exceljs";

export type ExcelCell = string | number | boolean | null | undefined;

export async function downloadXlsx(
  filename: string,
  sheetName: string,
  rows: readonly (readonly ExcelCell[])[]
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
  for (const row of rows) sheet.addRow([...row]);
  const headerIndex = Math.max(0, rows.findIndex((row) =>
    ["Nombre", "Pago", "SERVICIO"].includes(String(row[0] ?? ""))
  ));
  sheet.views = [{ state: "frozen", ySplit: headerIndex + 1 }];
  const header = sheet.getRow(headerIndex + 1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF25634B" } };
  sheet.columns = rows[0]?.map((_, index) => {
    const longest = rows.reduce((width, row) => Math.max(width, String(row[index] ?? "").length), 10);
    return { width: Math.min(longest + 2, 42) };
  }) ?? [];
  if (rows[headerIndex]?.length) {
    sheet.autoFilter = {
      from: { row: headerIndex + 1, column: 1 },
      to: { row: sheet.rowCount, column: rows[headerIndex].length }
    };
  }
  const file = await workbook.xlsx.writeBuffer();
  const blob = new Blob([file], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
