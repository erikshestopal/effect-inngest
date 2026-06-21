import { defineNativeExample, eventCase } from "./_support.ts";

export default defineNativeExample(() => ({
  id: "067-schema-client-send",
  functions: [],
  cases: [
    eventCase({
      events: [
        {
          name: "examples/067-schema-client-send/demo/client-event",
          data: { url: "https://example.com/client-send" },
        },
      ],
      expect: [],
    }),
  ],
}));
