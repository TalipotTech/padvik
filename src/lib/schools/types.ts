/**
 * Schools directory types.
 */

export type SchoolSource = "cbse_github" | "udise" | "sametham" | "icse_scrape" | "cbse_saras" | "manual";

export interface RawSchoolRecord {
  name: string;
  udiseCode?: string;
  cbseAffiliationNo?: string;
  icseCode?: string;
  stateBoardCode?: string;
  boardCode?: string;
  address?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  latitude?: number;
  longitude?: number;
  managementType?: string;
  schoolCategory?: string;
  medium?: string[];
  classesFrom?: number;
  classesTo?: number;
  genderType?: string;
  isResidential?: boolean;
  phone?: string;
  email?: string;
  website?: string;
  principalName?: string;
  studentCount?: number;
  teacherCount?: number;
  source: SchoolSource;
  sourceUrl?: string;
  rawData: Record<string, unknown>;
}

export interface ImportResult {
  source: SchoolSource;
  totalRecords: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
  durationMs: number;
}
