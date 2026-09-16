import { slaState } from "./lib/sla";
import { classifyLocal } from "./lib/localClassify";

test("SLA remaining labels breach after deadline", () => {
  const st = slaState(Date.now() - 1000, "Pending");
  expect(st.breached).toBe(true);
  expect(st.label).toBe("SLA BREACHED");
});

test("resolved grievances are not treated as SLA breach", () => {
  const st = slaState(Date.now() - 1000, "Resolved");
  expect(st.breached).toBe(false);
});

test("local classifier routes transformer sparking as electricity emergency", () => {
  const r = classifyLocal("Transformer is sparking and smoking near crowded houses");
  expect(r.department).toBe("Electricity");
  expect(r.emergency).toBe(true);
  expect(r.severity).toBe("Critical");
});
