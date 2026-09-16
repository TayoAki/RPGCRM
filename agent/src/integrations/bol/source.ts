import { loadSample } from "../../samples/loader.js";

/**
 * Where BOLs come from (Module E). The platform ingests one normalized shape;
 * a source only has to produce it. Today: the sample file, or DTN when
 * configured (see dtn.ts). Other suppliers' portals or terminal exports would
 * be further sources with the same interface.
 */

export interface BolFeedLine {
  productCode: string;
  grossGallons: number;
  netGallons: number;
  /** $/gal supplier cost; "{{RACK}}" means "use the rack posted at lift time". */
  supplierCostPerGallon?: number | "{{RACK}}";
  taxesPerGallon?: number;
  feesPerGallon?: number;
}

export interface BolFeedRecord {
  bolNumber: string;
  supplierCode: string;
  terminalCode: string;
  carrierCode: string;
  liftedAt: string;
  destinationText: string;
  customerRef: string;
  lines: BolFeedLine[];
  /** Source-side identifier for audit (e.g. dtn:<bol number>). */
  externalRef?: string;
}

export interface SkippedRecord {
  ref: string;
  reason: string;
}

export interface BolSourceStatus {
  kind: "sample" | "dtn";
  name: string;
  configured: boolean;
  mode?: string;
  detail?: string;
}

export interface BolFetchResult {
  records: BolFeedRecord[];
  skipped: SkippedRecord[];
  /** Human-readable note about this fetch (files read, endpoint called). */
  detail?: string;
}

export interface BolSource {
  describe(): BolSourceStatus;
  fetch(now: Date): Promise<BolFetchResult>;
}

/** The sample feed under agent/samples/bol-feed.json. */
export function sampleBolSource(): BolSource {
  return {
    describe: () => ({ kind: "sample", name: "Sample feed", configured: true, detail: "agent/samples/bol-feed.json; set DTN_BOL_MODE to pull from DTN instead" }),
    async fetch(now) {
      const file = loadSample<{ bols: BolFeedRecord[] }>("bol-feed.json", now);
      return { records: file.bols, skipped: [], detail: `${file.bols.length} BOL(s) in the sample feed` };
    },
  };
}
