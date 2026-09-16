import { ops } from "../domain/store.js";
import type { Carrier, Customer, DeliveryLocation, Product, Supplier, Terminal } from "../domain/types.js";
import { tokenOverlap } from "../domain/store.js";

/** Name-or-id resolvers so the copilot can pass what the user said. */

export function resolveCustomer(ref: string): Customer {
  const byId = ops.find<Customer>("customers", ref);
  if (byId) return byId;
  const c = ops.findCustomerByName(ref);
  if (!c) throw new Error(`Customer not found: "${ref}". Known customers: ${ops.all<Customer>("customers").map((x) => x.name).join(", ")}`);
  return c;
}

export function resolveProduct(ref: string): Product {
  const byId = ops.find<Product>("products", ref);
  if (byId) return byId;
  const p = ops.findProductByName(ref);
  if (!p) throw new Error(`Product not recognized: "${ref}". Products: ${ops.all<Product>("products").map((x) => `${x.name} (${x.code})`).join(", ")}`);
  return p;
}

export function resolveTerminal(ref: string): Terminal {
  const all = ops.all<Terminal>("terminals");
  const t =
    all.find((x) => x.id === ref || x.code.toLowerCase() === ref.toLowerCase()) ??
    all.find((x) => x.name.toLowerCase().includes(ref.toLowerCase()) || x.city.toLowerCase().includes(ref.toLowerCase()));
  if (!t) throw new Error(`Terminal not found: "${ref}". Terminals: ${all.map((x) => `${x.name} (${x.code})`).join(", ")}`);
  return t;
}

export function resolveSupplier(ref: string): Supplier {
  const all = ops.all<Supplier>("suppliers");
  const s = all.find((x) => x.id === ref || x.code.toLowerCase() === ref.toLowerCase()) ?? all.find((x) => x.name.toLowerCase().includes(ref.toLowerCase()));
  if (!s) throw new Error(`Supplier not found: "${ref}". Suppliers: ${all.map((x) => `${x.name} (${x.code})`).join(", ")}`);
  return s;
}

export function resolveCarrier(ref: string): Carrier {
  const all = ops.all<Carrier>("carriers");
  const c = all.find((x) => x.id === ref || x.code.toLowerCase() === ref.toLowerCase()) ?? all.find((x) => x.name.toLowerCase().includes(ref.toLowerCase()));
  if (!c) throw new Error(`Carrier not found: "${ref}". Carriers: ${all.map((x) => `${x.name} (${x.code})`).join(", ")}`);
  return c;
}

export function resolveLocation(customer: Customer, ref?: string): DeliveryLocation {
  const mine = ops.all<DeliveryLocation>("deliveryLocations").filter((l) => l.customerId === customer.id);
  if (!ref) {
    if (mine.length === 1) return mine[0];
    throw new Error(`${customer.name} has ${mine.length} delivery locations; specify one: ${mine.map((l) => `${l.name} (${l.city})`).join(", ")}`);
  }
  const q = ref.toLowerCase();
  const l =
    mine.find((x) => x.id === ref || x.name.toLowerCase() === q) ??
    mine.find((x) => x.name.toLowerCase().includes(q) || x.city.toLowerCase().includes(q)) ??
    mine.sort((a, b) => tokenOverlap(`${b.name} ${b.city}`, ref) - tokenOverlap(`${a.name} ${a.city}`, ref))[0];
  if (!l || (mine.length > 1 && tokenOverlap(`${l.name} ${l.city}`, ref) === 0 && !l.name.toLowerCase().includes(q) && !l.city.toLowerCase().includes(q)))
    throw new Error(`Location "${ref}" not found for ${customer.name}. Options: ${mine.map((x) => `${x.name} (${x.city})`).join(", ")}`);
  return l;
}

export const money = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const ppg = (n: number): string => `$${n.toFixed(4)}/gal`;
