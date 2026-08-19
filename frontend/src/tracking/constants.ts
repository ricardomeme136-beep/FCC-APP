// Shared by activeContext.ts and backgroundLocationTask.ts — kept in its own
// file (no other exports) so importing the task name never pulls in the
// task definition itself, avoiding a circular import between the two.
export const WASTEFLOW_BACKGROUND_LOCATION = "WASTEFLOW_BACKGROUND_LOCATION";
