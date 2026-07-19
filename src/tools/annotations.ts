export const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true
} as const;

export const remoteReadAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: true,
  idempotentHint: true
} as const;

export const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
  idempotentHint: false
} as const;

export const remoteWriteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: true,
  idempotentHint: false
} as const;
