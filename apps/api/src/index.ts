import { createApp } from "./app";
import { getAppConfig } from "./config/app-config";

const config = getAppConfig();
const app = createApp();

app.listen(config.port, () => {
  console.log(`API listening on port ${config.port}`);
});
