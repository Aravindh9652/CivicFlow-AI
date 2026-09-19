export const API_URL =
  process.env.REACT_APP_API_URL || "https://civicflow-backend-hi63.onrender.com";

export const ADMIN_EMAILS = (
  process.env.REACT_APP_ADMIN_EMAILS ||
  "admin@grievancenet.com,admin@civicflow.ai,authority@civicflow.ai,siva@gmail.com"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const SLA_DEFAULT = {
  Critical: 15,
  High: 120,
  Medium: 1440,
  Low: 4320,
};
