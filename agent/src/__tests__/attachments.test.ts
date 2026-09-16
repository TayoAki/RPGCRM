import { describe, it, expect } from "vitest";
import { extractAttachment, parseCsv, rowToLabeledText } from "../intake/attachments.js";
import { mergeParsed } from "../intake/parser.js";
import { runEmailIntake } from "../services/orders.js";
import { freshStore, NOW } from "./helpers.js";

const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

describe("attachment extraction (Module H)", () => {
  it("reads CSV with quotes and maps spreadsheet headers to parser labels", () => {
    const rows = parseCsv('customer,deliver to,gallons,"requested date",notes\n"Lone Star Aggregates","Pit 4, Ennis",7500,2026-09-20,"Call ""the gate"" first"\n');
    expect(rows).toHaveLength(1);
    expect(rows[0]["deliver to"]).toBe("Pit 4, Ennis");
    expect(rows[0].notes).toBe('Call "the gate" first');
    const text = rowToLabeledText({ Store: "Store 21", "Deliver to": "Store 21 - Cleburne", Product: "Premium 93", Gallons: "4000", "Requested date": "2026-09-20", PO: "QSM-7746", Notes: "" });
    expect(text.split("\n")).toEqual(["Location: Store 21 - Cleburne", "Product: Premium 93", "Gallons: 4000", "Requested date: 2026-09-20", "PO: QSM-7746"]);
  });

  it("extracts text from the sample PDF and rows from the sample workbook", async () => {
    const pdf = await extractAttachment({ filename: "PO-TRC-5591.pdf", contentType: "application/pdf", file: "attachments/PO-TRC-5591.pdf" });
    expect(pdf.kind).toBe("text");
    if (pdf.kind === "text") expect(pdf.text).toContain("PO: TRC-5591");
    const xlsx = await extractAttachment({ filename: "store-fuel-orders.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", file: "attachments/store-fuel-orders.xlsx" });
    expect(xlsx.kind).toBe("rows");
    if (xlsx.kind === "rows") {
      expect(xlsx.rows).toHaveLength(2);
      expect(xlsx.rows[0]["Deliver to"]).toBe("Store 21 - Cleburne");
    }
    const img = await extractAttachment({ filename: "photo.jpg", contentType: "image/jpeg", contentBase64: Buffer.from("not really an image").toString("base64") });
    expect(img.kind).toBe("unsupported");
  });

  it("fills attachment drafts from the body without overriding what the attachment said", () => {
    const merged = mergeParsed(
      { gallons: 6000, customerPo: "TRC-5591", fieldConfidence: { gallons: 0.95, po: 0.95 } },
      { gallons: 100, customerId: "cust-trc", customerName: "Trinity River Contractors", specialInstructions: "Gate code 4411", fieldConfidence: { gallons: 0.7, customer: 0.9, notes: 0.9 } },
    );
    expect(merged.gallons).toBe(6000);
    expect(merged.customerId).toBe("cust-trc");
    expect(merged.customerName).toBe("Trinity River Contractors");
    expect(merged.specialInstructions).toBe("Gate code 4411");
    expect(merged.fieldConfidence.customer).toBe(0.9);
    expect(merged.fieldConfidence.gallons).toBe(0.95);
  });

  it("turns attached schedules, purchase orders, and workbooks into review-queue drafts", async () => {
    const store = freshStore();
    const { queued, run } = await runEmailIntake(store, NOW);
    const csv = queued.filter((q) => q.parsed.source?.attachment === "fuel-schedule.csv");
    expect(csv.map((q) => q.parsed.source?.row)).toEqual([2, 3, 4]);
    expect(csv.map((q) => q.parsed.gallons)).toEqual([6500, 6500, 500]);
    expect(csv.every((q) => q.parsed.customerId === "cust-ptf" && q.parsed.deliveryLocationId === "loc-ptf-fw")).toBe(true);
    expect(csv[2].parsed.productId).toBe("p-def");
    expect(csv[0].parsed.requestedDate).toBe(day(1));
    expect(csv[0].parsed.customerPo).toBe("PTF-0911");
    expect(csv[0].attachments?.[0]).toMatchObject({ filename: "fuel-schedule.csv", status: "parsed", drafts: 3 });

    const po = queued.find((q) => q.parsed.source?.attachment === "PO-TRC-5591.pdf")!;
    expect(po.parsed).toMatchObject({ customerId: "cust-trc", deliveryLocationId: "loc-trc-dallas", productId: "p-ulsd", gallons: 6000, customerPo: "TRC-5591", requestedDate: day(2) });
    expect(po.parsed.specialInstructions).toContain("skid tanks");
    expect(po.confidence).toBeGreaterThanOrEqual(0.85);

    const sheet = queued.filter((q) => q.parsed.source?.attachment === "store-fuel-orders.xlsx");
    expect(sheet.map((q) => q.parsed.deliveryLocationId)).toEqual(["loc-qsm-21", "loc-qsm-33"]);
    expect(sheet.map((q) => q.parsed.productId)).toEqual(["p-unl87", "p-prm93"]);
    expect(sheet[0].parsed.specialInstructions).toBe("Before 10am");

    const photo = queued.find((q) => q.attachments?.some((a) => a.filename === "yard-tank.jpg"))!;
    expect(photo.attachments?.[0].status).toBe("unsupported");
    expect(photo.parsed.source).toBeUndefined();
    expect(run.summary).toContain("(6 from attachments)");
  });
});
