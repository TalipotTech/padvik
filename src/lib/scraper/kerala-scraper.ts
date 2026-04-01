// Kerala SCERT scraper — scert.kerala.gov.in
// TODO: Implement

import { BaseScraper } from "./base-scraper";

export class KeralaScraper extends BaseScraper {
  name = "Kerala SCERT Scraper";
  boardCode = "KL_SCERT";

  async scrape(): Promise<number> {
    throw new Error("Kerala SCERT scraper not implemented yet");
  }
}
