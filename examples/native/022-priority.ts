import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample((inngest) => {
  const PriorityFn = inngest.createFunction(
    {
      id: "priority-handler",
      triggers: [{ event: "examples/022-priority/demo/priority" }],
      priority: { run: "event.data.plan == 'enterprise' ? 100 : 0" },
    },
    async ({ event }) => {
      const plan = typeof event.data.plan === "string" ? event.data.plan : "";
      return { processed: `Processed ${plan} plan` };
    },
  );

  return {
    id: "022-priority",
    functions: [PriorityFn],
    cases: [
      eventCase({
        events: [{ name: "examples/022-priority/demo/priority", data: { plan: "enterprise" } }],
        expect: [{ functionId: "examples-022-priority-priority-handler" }],
      }),
    ],
  };
});
