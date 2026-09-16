import type { Customer, Invoice, QbInvoice } from "../../domain/types.js";

/**
 * Mock QuickBooks Online (Module I, sample mode). Stands in for the QBO REST
 * API: "creating" an invoice returns a QBO-shaped object and a ledger record
 * that the platform stores, and "reading payments" returns the sample file's
 * payments. Replace this module with the real client later; the service layer
 * only depends on these two functions.
 */

export interface QboInvoiceResponse {
  Invoice: {
    Id: string;
    DocNumber: string;
    TxnDate: string;
    CustomerRef: { value: string; name: string };
    TotalAmt: number;
    Balance: number;
    Line: {
      DetailType: "SalesItemLineDetail";
      Amount: number;
      Description: string;
      SalesItemLineDetail: { Qty: number; UnitPrice: number };
    }[];
  };
  time: string;
}

export function createQuickBooksInvoice(
  invoice: Invoice,
  customer: Customer,
  productName: (productId: string) => string,
  sequence: number,
  now: Date,
): { ledger: QbInvoice; response: QboInvoiceResponse } {
  const qbId = String(2000 + sequence);
  const response: QboInvoiceResponse = {
    Invoice: {
      Id: qbId,
      DocNumber: invoice.invoiceNumber,
      TxnDate: invoice.issueDate,
      CustomerRef: { value: customer.quickbooksCustomerId ?? `CUST-${customer.code}`, name: customer.name },
      TotalAmt: invoice.total,
      Balance: invoice.total,
      Line: invoice.lines.map((l) => ({
        DetailType: "SalesItemLineDetail" as const,
        Amount: l.lineTotal,
        Description: `${productName(l.productId)} ${l.billedGallons} gal (${l.basis}) @ $${l.pricePerGallon.toFixed(4)} + freight/fees/taxes`,
        SalesItemLineDetail: { Qty: l.billedGallons, UnitPrice: l.pricePerGallon },
      })),
    },
    time: now.toISOString(),
  };
  const ledger: QbInvoice = {
    id: qbId,
    invoiceId: invoice.id,
    docNumber: invoice.invoiceNumber,
    customerRef: response.Invoice.CustomerRef.value,
    totalAmt: invoice.total,
    balance: invoice.total,
    txnDate: invoice.issueDate,
    status: "open",
  };
  return { ledger, response };
}

export interface SamplePayment {
  quickbooksPaymentId: string;
  docNumber: string;
  amount: number | "full";
  receivedAt: string;
  method: string;
}
