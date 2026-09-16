"use client";
import { useState } from "react";
import { useOpsContext } from "@/components/ops-context";
import { Field, FormSheet, NativeSelect } from "@/components/ops/primitives";
import { SAMPLE_SHEETS } from "@/lib/guide";
import { ppg, signed } from "@/lib/ops";

interface UploadResult {
  run: { summary: string; source?: string };
  imported: { supplierCode: string; terminalCode: string; productCode: string; pricePerGallon: number; previous: number | null; change: number | null }[];
  skipped: { postingRef: string; reason: string }[];
  sheet: { filename: string; format: string; lines: number; supplier?: string; effectiveAt: string; unparsed: { line: string; reason: string }[] };
}

const toBase64 = (f: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

/** Module A: a supplier's daily rack sheet, uploaded as they send it and imported like the feed. */
export function RackSheetUploadSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { state, act, busy } = useOpsContext();
  const [file, setFile] = useState<File | null>(null);
  const [supplierCode, setSupplierCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const submit = async () => {
    setError(null);
    setResult(null);
    if (!file) {
      setError("Choose a rack sheet first.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Files up to 8 MB.");
      return;
    }
    try {
      const contentBase64 = await toBase64(file);
      const r = await act<UploadResult>("rack-prices/upload", { filename: file.name, contentType: file.type, contentBase64, supplierCode: supplierCode || undefined });
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <FormSheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setResult(null);
          setError(null);
        }
      }}
      title="Upload rack sheet"
      description="Your supplier's daily posting as they send it: a CSV or Excel export, a PDF price notice, or pasted text. Prices go through the same import as the feed, so the price board recalculates, and a sheet uploaded twice imports nothing new."
      onSubmit={submit}
      submitLabel="Import prices"
      busy={busy === "rack-prices/upload"}
      error={error}
      wide
    >
      <Field label="Rack sheet" hint="CSV, Excel, PDF, or text">
        <input
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf,text/csv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-accent"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Field label="Supplier" hint="Only needed when the sheet does not name one">
        <NativeSelect value={supplierCode} onChange={(e) => setSupplierCode(e.target.value)}>
          <option value="">As named on the sheet</option>
          {state.suppliers.map((s) => <option key={s.id} value={s.code}>{s.name}</option>)}
        </NativeSelect>
      </Field>
      <p className="text-xs text-muted-foreground">
        Try a sample:{" "}
        {SAMPLE_SHEETS.map((s, i) => (
          <span key={s.href}>
            {i > 0 ? " · " : ""}
            <a className="text-link hover:underline" href={s.href} download title={s.note}>{s.name}</a>
          </span>
        ))}
        .
      </p>
      {result ? (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm">
          <div className="font-medium">{result.run.summary}</div>
          <div className="text-xs text-muted-foreground">
            {result.sheet.filename} · {result.sheet.format === "rows" ? "read by column" : "read line by line"} · {result.sheet.lines} row(s){result.sheet.supplier ? ` · supplier ${result.sheet.supplier}` : ""}
          </div>
          {result.imported.length ? (
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th className="py-1 pr-2">Terminal</th><th className="py-1 pr-2">Supplier</th><th className="py-1 pr-2">Product</th><th className="py-1 pr-2 text-right">Rack</th><th className="py-1 text-right">Change</th></tr></thead>
              <tbody>
                {result.imported.map((x, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1 pr-2">{x.terminalCode}</td>
                    <td className="py-1 pr-2">{x.supplierCode}</td>
                    <td className="py-1 pr-2">{x.productCode}</td>
                    <td className="py-1 pr-2 text-right font-medium">{ppg(x.pricePerGallon)}</td>
                    <td className="py-1 text-right text-muted-foreground">{x.change === null ? "new" : signed(x.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {result.skipped.length ? (
            <div className="text-xs">
              <div className="font-medium">Skipped</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{result.skipped.slice(0, 12).map((s) => <li key={s.postingRef}>{s.reason}</li>)}</ul>
            </div>
          ) : null}
          {result.sheet.unparsed.length ? (
            <div className="text-xs">
              <div className="font-medium">Not understood</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">{result.sheet.unparsed.slice(0, 8).map((u, i) => <li key={i}>“{u.line}”: {u.reason}</li>)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </FormSheet>
  );
}
