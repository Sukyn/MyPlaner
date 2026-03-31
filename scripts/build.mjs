import { buildSite } from "./planner-data.mjs";

const { distDir, plannerData } = await buildSite();

console.log(
  `Built planner to ${distDir} (${plannerData.days.length} days, ${plannerData.totals.totalItems} scheduled items)`
);
