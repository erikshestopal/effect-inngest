/**
 * This module provides types and functions for defining Inngest functions.
 *
 * Functions are the core building blocks of Inngest applications. Each function
 * defines what events trigger it and optional configuration like retries,
 * concurrency limits, rate limiting, and more.
 *
 * @example
 * ```ts
 * import { Effect, Schema } from "effect"
 * import { InngestEvent, InngestFunction, InngestGroup, Inngest } from "effect-inngest"
 *
 * const UserCreated = InngestEvent.make(
 *   "user/created",
 *   Schema.Struct({
 *     userId: Schema.String,
 *     email: Schema.String,
 *   }),
 * )
 *
 * // Define functions
 * const SendWelcomeEmail = InngestFunction.make("send-welcome-email", {
 *   trigger: { event: UserCreated },
 *   retries: 3,
 * })
 *
 * // Create a group
 * const MyGroup = InngestGroup.make(SendWelcomeEmail)
 *
 * // Implement handlers
 * const HandlersLive = MyGroup.toLayer({
 *   "send-welcome-email": ({ event }) =>
 *     Effect.gen(function* () {
 *       yield* sendEmail(event.data.email)
 *     }),
 * })
 * ```
 *
 * @module InngestFunction
 * @since 0.1.0
 */
export * as InngestFunction from "./Function.js";

/**
 * Public event schema helpers.
 *
 * @module InngestEvent
 * @since 0.1.0
 */
export * as InngestEvent from "./Event.js";

/**
 * This module provides types and functions for grouping Inngest functions
 * and creating handler layers.
 *
 * Groups aggregate functions and provide a way to define handlers as a single
 * layer that can be composed with the rest of your Effect application.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { InngestGroup } from "effect-inngest"
 *
 * const MyGroup = InngestGroup.make(ProcessOrder, SendNotification)
 *
 * const HandlersLive = MyGroup.toLayer({
 *   "process-order": (event) => Effect.succeed({ processed: true }),
 *   "send-notification": (event) => Effect.void,
 * })
 * ```
 *
 * @module InngestGroup
 * @since 0.1.0
 */
export * as InngestGroup from "./Group.js";

/**
 * This module provides the InngestClient service for communicating with Inngest.
 *
 * The client handles event sending, function registration, and API communication.
 * It supports both development (local dev server) and cloud modes, with automatic
 * mode detection from environment variables.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { HttpClient } from "@effect/platform"
 * import { InngestClient } from "effect-inngest"
 *
 * // Create a layer with explicit config
 * const ClientLive = InngestClient.layer({
 *   id: "my-app",
 *   eventKey: "my-event-key",
 * })
 *
 * // Or use environment variables
 * const ClientFromEnv = InngestClient.layerFromEnv
 *
 * // Use in your program
 * const program = Effect.gen(function* () {
 *   const client = yield* InngestClient.InngestClient
 *   yield* client.sendEvent([{ name: "user/created", data: { userId: "123" } }])
 * })
 * ```
 *
 * @module InngestClient
 * @since 0.1.0
 */
export * as InngestClient from "./Client.js";

/**
 * Durable workflow operations used inside handlers.
 *
 * @module Inngest
 * @since 0.1.0
 */
export * as Inngest from "./Inngest.js";

/**
 * This module provides integration with `@effect/platform` HttpApi.
 *
 * Use `InngestHttpApi.InngestApiGroup` to add Inngest endpoints to your HttpApi,
 * then use `InngestHttpApi.layerGroup` to implement the handlers.
 *
 * @example
 * ```ts
 * import { HttpApi, HttpApiBuilder } from "@effect/platform"
 * import { InngestHttpApi, InngestGroup, InngestClient } from "effect-inngest"
 * import { Layer } from "effect"
 *
 * // Add InngestApiGroup to your HttpApi
 * class MyApi extends HttpApi.make("my-api")
 *   .add(InngestHttpApi.InngestApiGroup.prefix("/api/inngest")) {}
 *
 * // Create the implementation layer
 * const InngestLayer = InngestHttpApi.layerGroup(MyApi, MyFunctions)
 *
 * // Wire it up with HttpApiBuilder
 * const ApiLive = HttpApiBuilder.api(MyApi).pipe(
 *   Layer.provide(InngestLayer),
 *   Layer.provide(FunctionsLayer),
 *   Layer.provide(InngestClient.layer({ id: "my-app" })),
 * )
 * ```
 *
 * @module InngestHttpApi
 * @since 0.1.0
 */
export * as InngestHttpApi from "./HttpApi.js";

/**
 * Internal Inngest events that the platform sends automatically.
 * Use these as triggers to react to function lifecycle events.
 *
 * @example
 * ```ts
 * import { Effect } from "effect"
 * import { InngestFunction, InngestEvents } from "effect-inngest"
 *
 * // React to function failures
 * const HandleFailure = InngestFunction.make("handle-failure", {
 *   trigger: { event: InngestEvents.FunctionFailed },
 * })
 * ```
 *
 * @module InngestEvents
 * @since 0.1.0
 */
export * as InngestEvents from "./Events.js";

/**
 * Error thrown to indicate that an operation should not be retried.
 * Use this when you know retrying won't help (e.g., validation errors, auth failures).
 *
 * @since 0.1.0
 * @category errors
 */
export { NonRetriableError } from "./internal/errors.js";

/**
 * Error thrown to indicate that an operation should be retried after a specific delay.
 * Use this for rate limiting or when you know when a resource will become available.
 *
 * @since 0.1.0
 * @category errors
 */
export { RetryAfterError } from "./internal/errors.js";
