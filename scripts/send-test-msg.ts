import { runMessageNotification } from "../src/lib/message-notification.functions";
const result = await runMessageNotification(
  "88888888-8888-8888-8888-888888888881",
  "15f705ca-8003-467d-8b38-48b1795a6ba3",
);
console.log("RESULT:", JSON.stringify(result, null, 2));
