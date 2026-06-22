import { createApp } from "./app.js";
import { getAppConfig } from "./config/app-config.js";

const config = getAppConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
