// ICSE/ISC scraper — cisce.org
// TODO: Implement

import { BaseScraper } from "./base-scraper";

export class IcseScraper extends BaseScraper {
  name = "ICSE Scraper";
  boardCode = "ICSE";

  async scrape(): Promise<number> {
    throw new Error("ICSE scraper not implemented yet");
  }
}
