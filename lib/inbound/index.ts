// lib/inbound/index.ts

export * from "./vendorParser";
export * from "./parsers";

// exports explicites (optionnel mais pratique)
export {
  parseTeltonikaExcel,
  parseQuicklinkExcel,
  parseTrustedExcel,
  parseDigitalMatterExcel,
  parseVendorExcel,
} from "./parsers";