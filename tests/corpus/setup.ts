import { test as setup } from "@playwright/test";
import { rmSync } from "node:fs";

import { RESULTS } from "./load";

/** A form that fails before scoring must not be reported with the last run's numbers. */
setup("clear the last run's results", () => {
  rmSync(RESULTS, { recursive: true, force: true });
});
