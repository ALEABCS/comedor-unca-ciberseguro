type CsvValue = string | number | boolean | null | undefined;

export function serializeCsv(rows: readonly (readonly CsvValue[])[]): string {
  const body = rows.map((row) => row.map((value) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }).join(";")).join("\r\n");
  return `\uFEFF${body}\r\n`;
}

export function downloadCsv(filename: string, rows: readonly (readonly CsvValue[])[]): void {
  const file = new Blob([serializeCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
