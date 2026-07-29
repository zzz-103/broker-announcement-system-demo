/**
 * Stable compatibility barrel. New code should import the smallest domain
 * module directly; existing components can keep this entry unchanged.
 */
export * from "./contracts";
export * from "./core";
export * from "./auth";
export * from "./datasets";
export * from "./jobs";
export * from "./admin";
